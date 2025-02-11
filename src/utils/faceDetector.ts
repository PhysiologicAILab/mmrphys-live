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
    private isInitialized: boolean = false;
    private lastDetectionTime: number = 0;
    private readonly detectionThrottleMs: number = 1000; // 1 second throttle
    private initializationPromise: Promise<void> | null = null;
    private readonly options: faceapi.TinyFaceDetectorOptions;
    private isCapturing: boolean = false;
    private readonly smoothingFactor: number = 0.3;
    private temporaryCanvas: HTMLCanvasElement | null = null;
    private errorCount: number = 0;
    private readonly MAX_ERROR_THRESHOLD: number = 5;

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
                // Reset error count on new initialization
                this.errorCount = 0;

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
        // Check initialization and prerequisites
        if (!this.isInitialized || !this.temporaryCanvas) {
            console.warn('Face detector not properly initialized');
            return this.currentFaceBox;
        }

        // Throttle detection attempts
        const currentTime = Date.now();
        if (currentTime - this.lastDetectionTime < this.detectionThrottleMs) {
            return this.currentFaceBox;
        }

        try {
            // Prepare canvas for detection
            const ctx = this.temporaryCanvas.getContext('2d');
            if (!ctx) throw new Error('Failed to get canvas context');

            // Draw video frame to temporary canvas
            ctx.drawImage(videoElement, 0, 0, this.temporaryCanvas.width, this.temporaryCanvas.height);

            // Detect face
            const detection = await faceapi.detectSingleFace(this.temporaryCanvas, this.options);

            if (detection) {
                // Reset error count on successful detection
                this.errorCount = 0;

                // Scale detection box back to video dimensions
                const scaleX = videoElement.videoWidth / this.temporaryCanvas.width;
                const scaleY = videoElement.videoHeight / this.temporaryCanvas.height;

                const scaledBox = {
                    x: Math.round(detection.box.x * scaleX),
                    y: Math.round(detection.box.y * scaleY),
                    width: Math.round(detection.box.width * scaleX),
                    height: Math.round(detection.box.height * scaleY)
                };

                // Apply smoothing if we have a previous face box
                this.currentFaceBox = this.currentFaceBox
                    ? this.smoothFaceBox(scaledBox)
                    : scaledBox;
            } else {
                // Increment error count for no face detection
                this.errorCount++;

                // Check if we've exceeded error threshold
                if (this.errorCount >= this.MAX_ERROR_THRESHOLD) {
                    console.warn('Exceeded maximum face detection errors');
                    this.currentFaceBox = null;
                }
            }

            this.lastDetectionTime = currentTime;
            return this.currentFaceBox;
        } catch (error) {
            // Increment error count
            this.errorCount++;

            console.error('Face detection error:', error);

            // Check if we've exceeded error threshold
            if (this.errorCount >= this.MAX_ERROR_THRESHOLD) {
                console.warn('Exceeded maximum face detection errors');
                this.currentFaceBox = null;
                this.stopDetection();
            }

            return this.currentFaceBox;
        }
    }

    private smoothFaceBox(newBox: FaceBox): FaceBox {
        if (!this.currentFaceBox) return newBox;

        return {
            x: Math.round(this.smoothingFactor * newBox.x + (1 - this.smoothingFactor) * this.currentFaceBox.x),
            y: Math.round(this.smoothingFactor * newBox.y + (1 - this.smoothingFactor) * this.currentFaceBox.y),
            width: Math.round(this.smoothingFactor * newBox.width + (1 - this.smoothingFactor) * this.currentFaceBox.width),
            height: Math.round(this.smoothingFactor * newBox.height + (1 - this.smoothingFactor) * this.currentFaceBox.height)
        };
    }

    startDetection(videoElement: HTMLVideoElement): void {
        if (!this.isInitialized) {
            throw new Error('Face detector not initialized');
        }

        // Stop any existing detection
        this.stopDetection();

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
        this.errorCount = 0;

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

            // Dispose of model
            if (faceapi.nets.tinyFaceDetector.isLoaded) {
                await faceapi.nets.tinyFaceDetector.dispose();
                console.log('Face detection model disposed');
            }
        } catch (error) {
            console.warn('Error during face detector disposal:', error);
        }
    }
}