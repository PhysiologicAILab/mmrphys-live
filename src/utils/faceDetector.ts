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

    constructor() {
        this.currentFaceBox = null;
        this.detectionInterval = null;
        this.isInitialized = false;
        this.lastDetectionTime = 0;
        this.detectionThrottleMs = 1000;
        this.initializationPromise = null;
    }

    async initialize(): Promise<void> {
        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        this.initializationPromise = (async () => {
            try {
                if (document.readyState !== 'complete') {
                    await new Promise(resolve => window.addEventListener('load', resolve));
                }

                const modelPath = './models/face-api';
                await this.verifyModelFiles(modelPath);
                await faceapi.nets.tinyFaceDetector.load(modelPath);

                if (!faceapi.nets.tinyFaceDetector.isLoaded) {
                    throw new Error('Model failed to load correctly');
                }

                this.isInitialized = true;
                console.log('Face detection model loaded successfully');
            } catch (error) {
                this.isInitialized = false;
                this.initializationPromise = null;
                console.error('Error loading face detection model:', error);
                throw error;
            }
        })();

        return this.initializationPromise;
    }

    private async verifyModelFiles(modelPath: string): Promise<void> {
        const manifestPath = `${modelPath}/tiny_face_detector_model-weights_manifest.json`;
        const response = await fetch(manifestPath);

        if (!response.ok) {
            throw new Error(`Failed to load manifest: HTTP ${response.status}`);
        }

        const manifestContent = await response.json();

        if (!manifestContent.weightsManifest || !Array.isArray(manifestContent.weightsManifest)) {
            throw new Error('Invalid manifest structure');
        }

        const shardPath = `${modelPath}/tiny_face_detector_model-shard1`;
        const shardResponse = await fetch(shardPath);

        if (!shardResponse.ok) {
            throw new Error('Model weights file not found');
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

        try {
            const detection = await faceapi.detectSingleFace(
                videoElement,
                new faceapi.TinyFaceDetectorOptions({
                    inputSize: 224,
                    scoreThreshold: 0.5
                })
            );

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