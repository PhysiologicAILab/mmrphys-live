import * as faceapi from 'face-api.js';

export interface FaceBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export class FaceDetector {
    private currentFaceBox: FaceBox | null = null;
    private detectionInterval: number | null = null;
    public isInitialized: boolean = false;
    private lastDetectionTime: number = 0;
    private readonly detectionThrottleMs: number = 200; // 200 ms throttle
    private initializationPromise: Promise<void> | null = null;
    private readonly options: faceapi.TinyFaceDetectorOptions;
    public isCapturing: boolean = false;
    private temporaryCanvas: HTMLCanvasElement | null = null;
    private faceBoxHistory: FaceBox[] = []; // Rolling history of face boxes
    private readonly MAX_HISTORY_SIZE: number = 10; // Maximum size of rolling history
    public noDetectionCount: number = 0; // Counter for consecutive no-detection frames
    private readonly MAX_NO_DETECTION_FRAMES: number = 20; // Threshold to stop capture
    private onDetectionStopped: (() => void) | null = null; // Callback for detection stop
    private initialGracePeriod: boolean = true;
    private readonly GRACE_PERIOD_DURATION: number = 2000; // 2 seconds in ms

    setOnDetectionStoppedCallback(callback: () => void): void {
        this.onDetectionStopped = callback;
    }

    constructor() {
        this.options = new faceapi.TinyFaceDetectorOptions({
            inputSize: 224,
            scoreThreshold: 0.5
        });
    }

    setCapturingState(state: boolean): void {
        this.isCapturing = state;
        console.log(`Capturing state set to: ${state}`);
    }

    async initialize(): Promise<void> {
        // Prevent multiple simultaneous initialization attempts
        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        this.initializationPromise = (async () => {
            try {
                // Comprehensive setup steps
                await this.setupFaceAPIEnvironment();
                await this.loadModelWeights();
                this.createTemporaryCanvas();

                // Verify model is actually loaded
                if (!this.verifyModelLoaded()) {
                    throw new Error('Face detection model verification failed');
                }

                this.isInitialized = true;
                console.log('Face detection model initialized successfully');
            } catch (error) {
                // Detailed error logging
                const errorMessage = error instanceof Error ? error.message : 'Unknown initialization error';
                console.error(`Face detector initialization failed: ${errorMessage}`);

                // Cleanup and reset
                this.cleanup();
                this.initializationPromise = null;

                // Rethrow to allow caller to handle initialization failure
                throw new Error(`Face detector initialization failed: ${errorMessage}`);
            }
        })();

        return this.initializationPromise;
    }

    private createTemporaryCanvas(): void {
        // Ensure canvas creation works in different environments
        try {
            this.temporaryCanvas = document.createElement('canvas');
            this.temporaryCanvas.width = 224; // Match inputSize
            this.temporaryCanvas.height = 224;

            // Verify canvas context
            const ctx = this.temporaryCanvas.getContext('2d');
            if (!ctx) {
                throw new Error('Could not create 2D canvas context');
            }
        } catch (error) {
            console.error('Failed to create temporary canvas:', error);
            this.temporaryCanvas = null;
            throw error;
        }
    }

    private async setupFaceAPIEnvironment(): Promise<void> {
        // Comprehensive environment setup
        try {
            // Ensure browser environment
            if (typeof window === 'undefined') {
                throw new Error('Face detection requires a browser environment');
            }

            // Robust environment configuration
            const env = {
                Canvas: HTMLCanvasElement,
                Image: HTMLImageElement,
                ImageData: ImageData,
                Video: HTMLVideoElement,
                createCanvasElement: () => document.createElement('canvas'),
                createImageElement: () => document.createElement('img'),

                // Add fallback fetch if not available
                fetch: typeof fetch !== 'undefined'
                    ? fetch
                    : async () => {
                        console.warn('Fetch not available, using mock implementation');
                        return {
                            ok: false,
                            status: 404,
                            json: async () => ({}),
                            text: async () => ''
                        } as Response;
                    }
            };

            // Patch face-api environment
            faceapi.env.monkeyPatch(env);

            // Verify canvas and context support
            const testCanvas = document.createElement('canvas');
            const ctx = testCanvas.getContext('2d');
            if (!ctx) {
                throw new Error('Canvas 2D context not supported');
            }
        } catch (error) {
            console.error('Face API environment setup failed:', error);
            throw error;
        }
    }

    private async loadModelWeights(): Promise<void> {
        try {
            const modelPath = '/models/face-api';
            console.log(`Attempting to load face detection model from: ${modelPath}`);

            // Dispose of existing model to prevent memory leaks
            if (faceapi.nets.tinyFaceDetector.isLoaded) {
                await faceapi.nets.tinyFaceDetector.dispose();
            }

            // Load model weights
            await faceapi.nets.tinyFaceDetector.load(modelPath);

            console.log('Face detection model weights loaded successfully');
        } catch (error) {
            const errorMessage = error instanceof Error
                ? error.message
                : 'Unknown model loading error';
            console.error(`Model weights loading failed: ${errorMessage}`);
            throw new Error(`Model weights loading failed: ${errorMessage}`);
        }
    }

    private verifyModelLoaded(): boolean {
        const isLoaded = faceapi.nets.tinyFaceDetector.isLoaded;
        console.log(`Face detection model loaded: ${isLoaded}`);
        return isLoaded;
    }

    async detectFace(videoElement: HTMLVideoElement): Promise<FaceBox | null> {
        if (!this.isInitialized || !this.temporaryCanvas) {
            console.warn('Face detector not properly initialized');
            return this.currentFaceBox;
        }

        const currentTime = Date.now();
        if (currentTime - this.lastDetectionTime < this.detectionThrottleMs) {
            return this.currentFaceBox;
        }

        try {
            const ctx = this.temporaryCanvas.getContext('2d');
            if (!ctx) throw new Error('Failed to get canvas context');

            ctx.drawImage(videoElement, 0, 0, this.temporaryCanvas.width, this.temporaryCanvas.height);
            const detection = await faceapi.detectSingleFace(this.temporaryCanvas, this.options);

            if (detection) {
                this.noDetectionCount = 0; // Reset no-detection counter
                this.initialGracePeriod = false; // End grace period
                const scaledBox = this.scaleBoundingBox(detection.box, videoElement);

                // Add to history and calculate rolling median
                this.faceBoxHistory.push(scaledBox);
                if (this.faceBoxHistory.length > this.MAX_HISTORY_SIZE) {
                    this.faceBoxHistory.shift();
                }
                this.currentFaceBox = this.calculateRollingMedian();
            } else {
                this.noDetectionCount++;
                if (!this.initialGracePeriod && this.noDetectionCount >= this.MAX_NO_DETECTION_FRAMES) {
                    console.warn('Face not detected for consecutive frames. Triggering stop capture.');
                    this.stopDetection();
                    this.currentFaceBox = null;

                    // Notify application about detection stop
                    if (this.onDetectionStopped) {
                        this.onDetectionStopped();
                    }
                } else {
                    // Use the current median values if no face is detected
                    this.currentFaceBox = this.calculateRollingMedian();
                }
            }

            this.lastDetectionTime = currentTime;
            return this.currentFaceBox;
        } catch (error) {
            console.error('Face detection error:', error);
            this.noDetectionCount++;
            if (this.noDetectionCount >= this.MAX_NO_DETECTION_FRAMES) {
                console.warn('Face not detected for consecutive frames. Triggering stop capture.');
                this.stopDetection();
                this.currentFaceBox = null;

                // Notify application about detection stop
                if (this.onDetectionStopped) {
                    this.onDetectionStopped();
                }
            }
            return this.currentFaceBox;
        }
    }

    private scaleBoundingBox(box: faceapi.Box, videoElement: HTMLVideoElement): FaceBox {
        if (!this.temporaryCanvas) {
            throw new Error('Temporary canvas is not initialized');
        }
        const scaleX = videoElement.videoWidth / this.temporaryCanvas.width;
        const scaleY = videoElement.videoHeight / this.temporaryCanvas.height;

        return {
            x: Math.round(box.x * scaleX),
            y: Math.round(box.y * scaleY),
            width: Math.round(box.width * scaleX),
            height: Math.round(box.height * scaleY)
        };
    }

    private calculateRollingMedian(): FaceBox | null {
        if (this.faceBoxHistory.length === 0) return this.currentFaceBox;

        const median = (values: number[]) => {
            const sorted = [...values].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 !== 0
                ? sorted[mid]
                : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
        };

        const xs = this.faceBoxHistory.map(box => box.x);
        const ys = this.faceBoxHistory.map(box => box.y);
        const widths = this.faceBoxHistory.map(box => box.width);
        const heights = this.faceBoxHistory.map(box => box.height);

        return {
            x: median(xs),
            y: median(ys),
            width: median(widths),
            height: median(heights)
        };
    }

    startDetection(videoElement: HTMLVideoElement): void {
        if (!this.isInitialized) {
            throw new Error('Face detector not initialized');
        }

        // Stop any existing detection
        this.stopDetection();

        // Reset states
        this.noDetectionCount = 0;
        this.initialGracePeriod = true;

        // Start grace period timer
        setTimeout(() => {
            this.initialGracePeriod = false;
            console.log('Face detection grace period ended');
        }, this.GRACE_PERIOD_DURATION);

        // Start continuous detection
        this.detectionInterval = window.setInterval(
            () => this.detectFace(videoElement),
            this.detectionThrottleMs
        );

        console.log('Face detection started');
    }


    stopDetection(): void {
        if (this.detectionInterval) {
            clearInterval(this.detectionInterval);
            this.detectionInterval = null;
            console.log('Face detection stopped');
        }
        this.currentFaceBox = null;
        this.faceBoxHistory = []; // Clear rolling history
        this.noDetectionCount = 0; // Reset no-detection counter
        this.isCapturing = false; // Ensure capturing state is reset
    }

    getCurrentFaceBox(): FaceBox | null {
        return this.currentFaceBox;
    }

    isDetecting(): boolean {
        return this.detectionInterval !== null;
    }

    private cleanup(): void {
        // Comprehensive cleanup
        this.stopDetection();
        this.currentFaceBox = null;
        this.isInitialized = false;
        this.lastDetectionTime = 0;

        // Clear temporary canvas
        if (this.temporaryCanvas) {
            const ctx = this.temporaryCanvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, this.temporaryCanvas.width, this.temporaryCanvas.height);
            this.temporaryCanvas = null;
        }

        console.log('Face detector cleaned up');
    }

    async dispose(): Promise<void> {
        try {
            // Stop detection and cleanup
            this.cleanup();

            // Dispose of the model if loaded
            if (faceapi.nets.tinyFaceDetector.isLoaded) {
                await faceapi.nets.tinyFaceDetector.dispose();
                console.log('Face detection model disposed');
            }

            // Reset state to allow reinitialization
            this.isInitialized = false;
            this.initializationPromise = null;
        } catch (error) {
            console.warn('Error during face detector disposal:', error);
        }
    }
}