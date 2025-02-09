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
    private net: faceapi.TinyFaceDetector | null;

    constructor() {
        this.currentFaceBox = null;
        this.detectionInterval = null;
        this.isInitialized = false;
        this.lastDetectionTime = 0;
        this.detectionThrottleMs = 1000;
        this.initializationPromise = null;
        this.net = null;
    }

    async initialize(): Promise<void> {
        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        this.initializationPromise = (async () => {
            try {
                // Set up environment
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    throw new Error('Could not get canvas context');
                }

                // Initialize face-api environment
                await this.setupFaceAPI();

                // Initialize the tiny face detector model
                this.net = new faceapi.TinyFaceDetector({
                    inputSize: 224,
                    scoreThreshold: 0.5
                });

                // Load model weights
                await this.loadModelWeights();

                this.isInitialized = true;
                console.log('Face detection model loaded successfully');
            } catch (error) {
                this.isInitialized = false;
                this.initializationPromise = null;
                console.error('Face detector initialization error:', error);
                throw error;
            }
        })();

        return this.initializationPromise;
    }

    private async setupFaceAPI(): Promise<void> {
        // Set up the environment for face-api.js
        const env = {
            Canvas: HTMLCanvasElement,
            Image: HTMLImageElement,
            ImageData: ImageData,
            Video: HTMLVideoElement,
            createCanvasElement: () => document.createElement('canvas'),
            createImageElement: () => document.createElement('img')
        };

        // @ts-ignore - face-api.js types are not perfect
        faceapi.env.monkeyPatch(env);
    }

    private async loadModelWeights(): Promise<void> {
        try {
            const modelPath = '/models/face-api';
            const manifestPath = `${modelPath}/tiny_face_detector_model-weights_manifest.json`;

            // Load and validate manifest
            const manifestResponse = await fetch(manifestPath, {
                cache: 'force-cache',
                credentials: 'same-origin'
            });

            if (!manifestResponse.ok) {
                throw new Error(`Failed to load model manifest: ${manifestResponse.statusText}`);
            }

            // Load the model
            await faceapi.nets.tinyFaceDetector.load(modelPath);

            // Verify model is loaded
            if (!faceapi.nets.tinyFaceDetector.isLoaded) {
                throw new Error('Face detector model failed to load');
            }
        } catch (error) {
            throw new Error(`Model weights loading failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async detectFace(videoElement: HTMLVideoElement): Promise<FaceBox | null> {
        if (!this.isInitialized || !this.net) {
            throw new Error('Face detector not initialized');
        }

        const currentTime = Date.now();
        if (currentTime - this.lastDetectionTime < this.detectionThrottleMs) {
            return this.currentFaceBox;
        }

        try {
            // Create tensor from video element
            const input = await faceapi.createCanvasFromMedia(videoElement);
            const detection = await faceapi.detectSingleFace(input, this.net);

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

            input.remove();
            this.lastDetectionTime = currentTime;
            return this.currentFaceBox;
        } catch (error) {
            console.error('Face detection error:', error);
            return this.currentFaceBox;
        }
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
}