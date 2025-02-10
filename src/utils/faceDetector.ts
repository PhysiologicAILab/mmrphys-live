import * as faceapi from 'face-api.js';

export interface FaceBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export class FaceDetector {
    private currentFaceBox: FaceBox | null;
    private detectionInterval: number | null;
    private isInitialized: boolean;
    private lastDetectionTime: number;
    private readonly detectionThrottleMs: number;
    private initializationPromise: Promise<void> | null;
    private readonly options: faceapi.TinyFaceDetectorOptions;

    constructor() {
        this.currentFaceBox = null;
        this.detectionInterval = null;
        this.isInitialized = false;
        this.lastDetectionTime = 0;
        this.detectionThrottleMs = 1000;
        this.initializationPromise = null;
        this.options = new faceapi.TinyFaceDetectorOptions({
            inputSize: 224,
            scoreThreshold: 0.5
        });
    }

    async initialize(): Promise<void> {
        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        this.initializationPromise = (async () => {
            try {
                // Initialize face-api environment first
                await this.setupFaceAPI();

                // Load model weights
                await this.loadModelWeights();

                this.isInitialized = true;
                console.log('Face detection model loaded successfully');
            } catch (error) {
                this.isInitialized = false;
                this.initializationPromise = null;
                console.error('Face detector initialization error:', error);
                throw new Error(`Face detector initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })();

        return this.initializationPromise;
    }

    private async setupFaceAPI(): Promise<void> {
        // Ensure we're in a browser environment
        if (typeof window === 'undefined') {
            throw new Error('Browser environment required');
        }

        // Initialize face-api environment
        const env = {
            Canvas: HTMLCanvasElement,
            Image: HTMLImageElement,
            ImageData: ImageData,
            Video: HTMLVideoElement,
            createCanvasElement: () => document.createElement('canvas'),
            createImageElement: () => document.createElement('img')
        };

        // Initialize face-api environment
        faceapi.env.monkeyPatch(env);

        // Verify canvas support
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Canvas 2D context not supported');
        }
    }

    private async loadModelWeights(): Promise<void> {
        try {
            const modelPath = '/models/face-api';

            // Dispose of any existing model to prevent memory leaks
            if (faceapi.nets.tinyFaceDetector.isLoaded) {
                try {
                    await faceapi.nets.tinyFaceDetector.dispose();
                } catch {
                    // Ignore any errors during disposal
                }
            }

            // Load weights
            await faceapi.nets.tinyFaceDetector.load(modelPath);

            // Verify model is loaded
            if (!faceapi.nets.tinyFaceDetector.isLoaded) {
                throw new Error('Model failed to load');
            }
        } catch (error) {
            throw new Error(`Model weights loading failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async detectFace(videoElement: HTMLVideoElement): Promise<FaceBox | null> {
        if (!this.isInitialized) {
            throw new Error('Face detector not initialized');
        }

        const currentTime = Date.now();
        if (currentTime - this.lastDetectionTime < this.detectionThrottleMs) {
            return this.currentFaceBox;
        }

        let input: HTMLCanvasElement | null = null;
        try {
            input = await faceapi.createCanvasFromMedia(videoElement);
            // Use detectSingleFace with TinyFaceDetector options
            const detection = await faceapi.detectSingleFace(input, new faceapi.TinyFaceDetectorOptions(this.options));

            if (detection) {
                const smoothingFactor = 0.3;
                this.currentFaceBox = this.currentFaceBox ? {
                    x: Math.round(smoothingFactor * detection.box.x + (1 - smoothingFactor) * this.currentFaceBox.x),
                    y: Math.round(smoothingFactor * detection.box.y + (1 - smoothingFactor) * this.currentFaceBox.y),
                    width: Math.round(smoothingFactor * detection.box.width + (1 - smoothingFactor) * this.currentFaceBox.width),
                    height: Math.round(smoothingFactor * detection.box.height + (1 - smoothingFactor) * this.currentFaceBox.height)
                } : {
                    x: Math.round(detection.box.x),
                    y: Math.round(detection.box.y),
                    width: Math.round(detection.box.width),
                    height: Math.round(detection.box.height)
                };
            }

            this.lastDetectionTime = currentTime;
            return this.currentFaceBox;
        } catch (error) {
            console.error('Face detection error:', error);
            return this.currentFaceBox;
        } finally {
            if (input) {
                input.remove();
            }
        }
    }

    startDetection(videoElement: HTMLVideoElement): void {
        if (!this.isInitialized) {
            throw new Error('Face detector not initialized');
        }

        this.stopDetection();

        // Start continuous detection
        this.detectionInterval = window.setInterval(
            () => this.detectFace(videoElement),
            this.detectionThrottleMs
        );
    }

    stopDetection(): void {
        if (this.detectionInterval) {
            clearInterval(this.detectionInterval);
            this.detectionInterval = null;
        }
        this.currentFaceBox = null;
    }

    getCurrentFaceBox(): FaceBox | null {
        return this.currentFaceBox;
    }

    isDetecting(): boolean {
        return this.detectionInterval !== null;
    }

    async dispose(): Promise<void> {
        this.stopDetection();

        try {
            // Properly unload and reset the model
            if (faceapi.nets.tinyFaceDetector.isLoaded) {
                await faceapi.nets.tinyFaceDetector.dispose();

                // Additional reset steps
                (faceapi.nets.tinyFaceDetector as any)._modelPath = null;
                (faceapi.nets.tinyFaceDetector as any)._isLoaded = false;
            }

            // Reset internal state
            this.currentFaceBox = null;
            this.isInitialized = false;
            this.initializationPromise = null;
            this.lastDetectionTime = 0;
        } catch (error) {
            console.warn('Error during face detector disposal:', error);
        }
    }
}