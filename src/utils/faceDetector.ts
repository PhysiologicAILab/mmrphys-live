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

    constructor() {
        this.options = new faceapi.TinyFaceDetectorOptions({
            inputSize: 224,
            scoreThreshold: 0.5
        });
    }

    setCapturingState(state: boolean): void {
        this.isCapturing = state;
    }

    async initialize(): Promise<void> {
        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        this.initializationPromise = (async () => {
            try {
                await this.setupFaceAPI();
                await this.loadModelWeights();
                this.createTemporaryCanvas();
                this.isInitialized = true;
                console.log('Face detection model initialized successfully');
            } catch (error) {
                this.cleanup();
                this.initializationPromise = null;
                console.error('Face detector initialization error:', error);
                throw new Error(`Face detector initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })();

        return this.initializationPromise;
    }

    private createTemporaryCanvas(): void {
        if (!this.temporaryCanvas) {
            this.temporaryCanvas = document.createElement('canvas');
            this.temporaryCanvas.width = 224; // Match inputSize
            this.temporaryCanvas.height = 224;
        }
    }

    private async setupFaceAPI(): Promise<void> {
        if (typeof window === 'undefined') {
            throw new Error('Browser environment required');
        }

        const env = {
            Canvas: HTMLCanvasElement,
            Image: HTMLImageElement,
            ImageData: ImageData,
            Video: HTMLVideoElement,
            createCanvasElement: () => document.createElement('canvas'),
            createImageElement: () => document.createElement('img')
        };

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

            // Dispose of existing model if loaded
            if (faceapi.nets.tinyFaceDetector.isLoaded) {
                await faceapi.nets.tinyFaceDetector.dispose();
            }

            await faceapi.nets.tinyFaceDetector.load(modelPath);

            if (!faceapi.nets.tinyFaceDetector.isLoaded) {
                throw new Error('Model failed to load');
            }
        } catch (error) {
            throw new Error(`Model weights loading failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async detectFace(videoElement: HTMLVideoElement): Promise<FaceBox | null> {
        if (!this.isInitialized || !this.temporaryCanvas) {
            console.error('Face detector not properly initialized');
            return this.currentFaceBox;
        }

        const currentTime = Date.now();
        if (currentTime - this.lastDetectionTime < this.detectionThrottleMs) {
            return this.currentFaceBox;
        }

        try {
            // Resize and draw video frame to temporary canvas
            const ctx = this.temporaryCanvas.getContext('2d');
            if (!ctx) throw new Error('Failed to get canvas context');

            ctx.drawImage(videoElement, 0, 0, this.temporaryCanvas.width, this.temporaryCanvas.height);
            const detection = await faceapi.detectSingleFace(this.temporaryCanvas, this.options);

            if (detection) {
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
                this.currentFaceBox = this.currentFaceBox ? this.smoothFaceBox(scaledBox) : scaledBox;
            }

            this.lastDetectionTime = currentTime;
            return this.currentFaceBox;
        } catch (error) {
            console.error('Face detection error:', error);
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

        this.stopDetection();

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

    private cleanup(): void {
        this.stopDetection();
        this.currentFaceBox = null;
        this.isInitialized = false;
        this.lastDetectionTime = 0;

        if (this.temporaryCanvas) {
            const ctx = this.temporaryCanvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, this.temporaryCanvas.width, this.temporaryCanvas.height);
            this.temporaryCanvas = null;
        }
    }

    async dispose(): Promise<void> {
        this.cleanup();

        try {
            if (faceapi.nets.tinyFaceDetector.isLoaded) {
                await faceapi.nets.tinyFaceDetector.dispose();
            }
        } catch (error) {
            console.warn('Error during face detector model disposal:', error);
        }
    }
}