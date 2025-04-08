// src/utils/videoProcessor.ts
import { FaceDetector, FaceBox } from './faceDetector';
import { configService } from '@/services/configService';

export class VideoProcessor {
    private readonly videoElement: HTMLVideoElement;
    private readonly croppedCanvas: HTMLCanvasElement;
    private readonly croppedCtx: CanvasRenderingContext2D;
    private processingCanvas: HTMLCanvasElement;
    private processingCtx: CanvasRenderingContext2D;
    private displayCanvas: HTMLCanvasElement | null = null;
    private displayCtx: CanvasRenderingContext2D | null = null;
    private frameWidth: number = 9;  // Default, will be updated from config
    private frameHeight: number = 9; // Default, will be updated from config
    private frameBuffer: ImageData[] = [];
    private MIN_FRAMES_REQUIRED = 181; // Will be updated from config if available
    private readonly MAX_BUFFER_SIZE = 301;     // 10 seconds at 30 FPS +1 frame for Diff
    private mediaStream: MediaStream | null = null;
    private lastFrameTime: number = 0;
    private frameCount: number = 0;
    private displayFrameId: number | null = null;
    private readonly targetFPS: number = 30;
    private readonly frameInterval: number = 1000 / 30; // For 30 FPS
    private onFrameProcessed: ((frame: ImageData) => void) | null = null;
    private processingFrameId: number | null = null;
    private faceDetector: FaceDetector;
    private currentFaceBox: FaceBox | null = null;
    private lastFaceDetectionTime: number = 0;
    private readonly faceDetectionInterval: number = 30; // 30 ms (equal to framerate)
    private configLoaded: boolean = false;

    constructor() {
        // Initialize video element
        this.videoElement = document.createElement('video');
        this.videoElement.playsInline = true;
        this.videoElement.muted = true;
        this.videoElement.autoplay = true;

        // Initialize canvases with optimized settings
        this.croppedCanvas = this.createOptimizedCanvas(256, 256);

        // Create processing canvas with default size, will be updated in initialization
        this.processingCanvas = this.createOptimizedCanvas(this.frameWidth, this.frameHeight);

        // Get contexts with error handling
        const croppedCtx = this.croppedCanvas.getContext('2d', {
            willReadFrequently: true,
            alpha: false,
            desynchronized: true
        });
        let processCtx = this.processingCanvas.getContext('2d', {
            willReadFrequently: true,
            alpha: false,
            desynchronized: true
        });

        if (!croppedCtx || !processCtx) {
            throw new Error('Failed to get canvas contexts');
        }

        this.croppedCtx = croppedCtx;
        this.processingCtx = processCtx;

        // Initialize face detector
        this.faceDetector = new FaceDetector();

        // Configure context settings
        this.setupContexts();
    }

    private async initializeFaceDetector(): Promise<void> {
        try {
            await this.faceDetector.initialize();
            console.log('Face detector initialized successfully');
        } catch (error) {
            console.error('Face detector initialization failed:', error);
            throw error;
        }
    }

    private createOptimizedCanvas(width: number, height: number): HTMLCanvasElement {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    private setupContexts(): void {
        this.processingCtx.imageSmoothingEnabled = false;
        this.processingCtx.imageSmoothingQuality = 'low';
        this.croppedCtx.imageSmoothingEnabled = true;
        this.croppedCtx.imageSmoothingQuality = 'high';
    }

    async startCapture(): Promise<void> {
        try {
            // Load frame dimensions from config
            await this.loadConfigSettings();

            // Initialize face detector first
            await this.initializeFaceDetector();

            const constraints = {
                video: {
                    facingMode: 'user',
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: this.targetFPS }
                }
            };

            this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.videoElement.srcObject = this.mediaStream;

            return new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Video initialization timeout'));
                }, 10000);

                this.videoElement.onplaying = () => {
                    clearTimeout(timeout);
                    this.startFrameProcessing();
                    resolve();
                };

                this.videoElement.play().catch(reject);
            });
        } catch (error) {
            throw new Error(`Failed to start capture: ${error}`);
        }
    }

    private async loadConfigSettings(): Promise<void> {
        try {
            // Get frame dimensions from config
            this.frameWidth = await configService.getFrameWidth();
            this.frameHeight = await configService.getFrameHeight();
            this.MIN_FRAMES_REQUIRED = await configService.getSequenceLength();

            console.log(`[VideoProcessor] Using frame dimensions: ${this.frameWidth}x${this.frameHeight}`);
            console.log(`[VideoProcessor] Using sequence length: ${this.MIN_FRAMES_REQUIRED}`);

            // Create a new processing canvas with the correct dimensions from config
            const newProcessingCanvas = this.createOptimizedCanvas(this.frameWidth, this.frameHeight);
            const newCtx = newProcessingCanvas.getContext('2d', {
                willReadFrequently: true,
                alpha: false,
                desynchronized: true
            });

            if (!newCtx) {
                throw new Error('Failed to get processing canvas context');
            }

            // Update processing canvas and context with the new ones
            this.processingCanvas = newProcessingCanvas;
            this.processingCtx = newCtx;

            // Reset the context settings
            this.setupContexts();

            this.configLoaded = true;
        } catch (error) {
            console.error('Failed to load config settings:', error);
            throw error;
        }
    }

    private async updateFaceDetection(): Promise<void> {
        const now = performance.now();
        if (now - this.lastFaceDetectionTime >= this.faceDetectionInterval) {
            try {
                const detectedFace = await this.faceDetector.detectFace(this.videoElement);
                if (detectedFace) {
                    this.currentFaceBox = detectedFace;
                }
                this.lastFaceDetectionTime = now;
            } catch (error) {
                console.error('Face detection error:', error);
            }
        }
    }

    private getCropRegion(): { x: number; y: number; width: number; height: number } {
        if (this.currentFaceBox) {
            // Use detected face box
            return this.currentFaceBox;
        } else {
            // Fallback to center crop
            const size = Math.min(this.videoElement.videoWidth, this.videoElement.videoHeight);
            return {
                x: (this.videoElement.videoWidth - size) / 2,
                y: (this.videoElement.videoHeight - size) / 2,
                width: size,
                height: size
            };
        }
    }

    private startFrameProcessing(): void {
        // Process frames at target FPS
        const processFrame = async () => {
            const now = performance.now();
            if (now - this.lastFrameTime >= this.frameInterval) {
                // Update face detection if needed
                await this.updateFaceDetection();

                // Process frame
                this.captureAndProcessFrame();
                this.lastFrameTime = now;
            }
            this.processingFrameId = requestAnimationFrame(processFrame);
        };

        this.processingFrameId = requestAnimationFrame(processFrame);
    }

    private captureAndProcessFrame(): void {
        try {
            if (!this.configLoaded) {
                console.warn('Attempting to process frame before config is loaded');
                return;
            }

            const cropRegion = this.getCropRegion();

            // Draw cropped region to 256x256 canvas for display
            this.croppedCtx.drawImage(
                this.videoElement,
                cropRegion.x,
                cropRegion.y,
                cropRegion.width,
                cropRegion.height,
                0,
                0,
                256,
                256
            );

            // Draw to processing canvas with dimensions from config
            this.processingCtx.drawImage(
                this.croppedCanvas,
                0,
                0,
                this.frameWidth,
                this.frameHeight
            );

            // Get processed frame data
            const frameData = this.processingCtx.getImageData(
                0,
                0,
                this.frameWidth,
                this.frameHeight
            );

            // Update frame buffer
            this.updateFrameBuffer(frameData);

            // Update display if needed
            if (this.displayCtx && this.displayCanvas) {
                this.displayCtx.drawImage(this.croppedCanvas, 0, 0);
            }

            // Notify frame processed
            if (this.onFrameProcessed) {
                this.onFrameProcessed(frameData);
            }
        } catch (error) {
            console.error('Frame processing error:', error);
        }
    }

    private updateFrameBuffer(frame: ImageData): void {
        this.frameBuffer.push(frame);
        while (this.frameBuffer.length > this.MAX_BUFFER_SIZE) {
            this.frameBuffer.shift();
        }
    }

    attachCanvas(canvas: HTMLCanvasElement): void {
        if (!canvas) return;

        try {
            const ctx = canvas.getContext('2d', {
                alpha: false,
                desynchronized: true
            });

            if (!ctx) {
                throw new Error('Failed to get 2D context');
            }

            canvas.width = 256;
            canvas.height = 256;
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            this.displayCanvas = canvas;
            this.displayCtx = ctx;
        } catch (error) {
            console.error('Error attaching canvas:', error);
        }
    }

    detachCanvas(): void {
        this.displayCanvas = null;
        this.displayCtx = null;
    }

    async stopCapture(): Promise<void> {
        if (this.processingFrameId) {
            cancelAnimationFrame(this.processingFrameId);
            this.processingFrameId = null;
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        // Clean up face detector
        await this.faceDetector.dispose();

        this.videoElement.srcObject = null;
        this.frameBuffer = [];
        this.lastFrameTime = 0;
        this.frameCount = 0;
        this.currentFaceBox = null;
    }

    getCurrentFaceBox(): FaceBox | null {
        return this.currentFaceBox;
    }

    isFaceDetected(): boolean {
        return this.currentFaceBox !== null;
    }

    getFrameBuffer(): ImageData[] {
        return this.frameBuffer;
    }

    hasMinimumFrames(): boolean {
        return this.frameBuffer.length >= this.MIN_FRAMES_REQUIRED;
    }

    getBufferUsagePercentage(): number {
        return (this.frameBuffer.length / this.MIN_FRAMES_REQUIRED) * 100;
    }

    setOnFrameProcessed(callback: (frame: ImageData) => void): void {
        this.onFrameProcessed = callback;
    }

    isCapturing(): boolean {
        return !!this.mediaStream?.active;
    }
}