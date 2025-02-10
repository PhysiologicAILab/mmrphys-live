import { FaceBox } from './faceDetector';

export interface ProcessedFrame {
    data: Uint8ClampedArray;
    width: number;
    height: number;
}

export interface VideoProcessorMetrics {
    fps: number;
    processingTime: number;
    bufferUsage: number;
    droppedFrames: number;
}

export class VideoProcessor {
    public readonly videoElement: HTMLVideoElement;
    private readonly croppedCanvas: HTMLCanvasElement;
    private readonly croppedCtx: CanvasRenderingContext2D;
    private readonly processingCanvas: HTMLCanvasElement;
    private readonly processingCtx: CanvasRenderingContext2D;
    private displayCanvas: HTMLCanvasElement | null = null;
    private displayCtx: CanvasRenderingContext2D | null = null;
    private frameBuffer: ImageData[];
    private readonly frameBufferLength: number;
    private mediaStream: MediaStream | null = null;
    private metrics: VideoProcessorMetrics;
    private lastFrameTime: number = 0;
    private frameCount: number = 0;
    private metricsInterval: number | null = null;
    private lastFrameTimestamp: number = 0;
    private readonly targetFPS: number = 30;
    private readonly minBufferForInference: number = 150; // 5 seconds at 30fps

    constructor(options: { frameBufferLength?: number } = {}) {
        // Initialize video element
        this.videoElement = document.createElement('video');
        this.videoElement.playsInline = true;
        this.videoElement.muted = true;
        this.videoElement.autoplay = true;

        // Initialize canvases
        this.croppedCanvas = this.createOptimizedCanvas(256, 256);
        this.processingCanvas = this.createOptimizedCanvas(9, 9);

        // Get contexts
        const croppedCtx = this.croppedCanvas.getContext('2d', {
            willReadFrequently: true,
            alpha: false,
            desynchronized: true
        });
        const processCtx = this.processingCanvas.getContext('2d', {
            willReadFrequently: true,
            alpha: false,
            desynchronized: true
        });

        if (!croppedCtx || !processCtx) {
            throw new Error('Failed to initialize canvas contexts');
        }

        this.croppedCtx = croppedCtx;
        this.processingCtx = processCtx;

        // Initialize frame buffer
        this.frameBufferLength = options.frameBufferLength ?? 300;
        this.frameBuffer = [];

        // Initialize metrics
        this.metrics = {
            fps: 0,
            processingTime: 0,
            bufferUsage: 0,
            droppedFrames: 0
        };

        this.setupOptimizations();
        this.startMetricsTracking();
    }

    private createOptimizedCanvas(width: number, height: number): HTMLCanvasElement {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.style.transform = 'translateZ(0)';
        canvas.style.imageRendering = 'pixelated';
        return canvas;
    }

    private setupOptimizations(): void {
        // Configure processing context for efficiency
        this.processingCtx.imageSmoothingEnabled = false;
        this.processingCtx.imageSmoothingQuality = 'low';

        // Configure display context for quality
        this.croppedCtx.imageSmoothingEnabled = true;
        this.croppedCtx.imageSmoothingQuality = 'high';
    }

    private startMetricsTracking(): void {
        this.metricsInterval = window.setInterval(() => {
            const now = performance.now();
            const elapsed = now - this.lastFrameTime;

            if (elapsed >= 1000) {
                this.metrics.fps = Math.round((this.frameCount * 1000) / elapsed);
                this.metrics.bufferUsage = (this.frameBuffer.length / this.frameBufferLength) * 100;
                this.frameCount = 0;
                this.lastFrameTime = now;
            }
        }, 1000);
    }

    async startCapture(): Promise<void> {
        try {
            if (this.mediaStream) {
                throw new Error('Capture already in progress');
            }

            const constraints = {
                video: {
                    facingMode: 'user',
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: this.targetFPS }
                }
            };

            console.log('Requesting media stream with constraints:', constraints);
            this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.videoElement.srcObject = this.mediaStream;

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Video initialization timeout'));
                }, 10000);

                const onPlaying = () => {
                    clearTimeout(timeout);
                    this.videoElement.removeEventListener('playing', onPlaying);
                    console.log('Video playing started:', {
                        width: this.videoElement.videoWidth,
                        height: this.videoElement.videoHeight
                    });
                    resolve();
                };

                this.videoElement.addEventListener('playing', onPlaying);
                this.videoElement.play().catch(reject);
            });
        } catch (error) {
            await this.cleanup();
            throw error;
        }
    }

    processFrame(faceBox: FaceBox): ImageData | null {
        if (!faceBox || !this.videoElement.videoWidth) {
            return null;
        }

        const currentTime = performance.now();
        const frameInterval = 1000 / this.targetFPS;

        if (currentTime - this.lastFrameTimestamp < frameInterval) {
            return null;
        }
        this.lastFrameTimestamp = currentTime;

        try {
            // Process for display (256x256)
            this.processForDisplay(faceBox);

            // Process for inference (9x9)
            const processedFrame = this.processForInference(faceBox);

            this.frameCount++;
            return processedFrame;
        } catch (error) {
            console.error('Frame processing error:', error);
            this.metrics.droppedFrames++;
            return null;
        }
    }

    private processForDisplay(faceBox: FaceBox): void {
        // Clear the canvas
        this.croppedCtx.clearRect(0, 0, 256, 256);

        // Save context state
        this.croppedCtx.save();

        // Create oval mask
        this.croppedCtx.beginPath();
        this.croppedCtx.ellipse(128, 128, 124, 124, 0, 0, 2 * Math.PI);
        this.croppedCtx.clip();

        // Draw face region at full resolution
        this.croppedCtx.drawImage(
            this.videoElement,
            faceBox.x,
            faceBox.y,
            faceBox.width,
            faceBox.height,
            0,
            0,
            256,
            256
        );

        // Restore context state
        this.croppedCtx.restore();

        // Update display
        this.updateDisplay();
    }

    private processForInference(faceBox: FaceBox): ImageData {
        // Clear processing canvas
        this.processingCtx.clearRect(0, 0, 9, 9);

        // Draw directly to 9x9 canvas for inference
        this.processingCtx.drawImage(
            this.videoElement,
            faceBox.x,
            faceBox.y,
            faceBox.width,
            faceBox.height,
            0,
            0,
            9,
            9
        );

        return this.processingCtx.getImageData(0, 0, 9, 9);
    }

    private updateDisplay(): void {
        if (!this.displayCtx || !this.displayCanvas) {
            return;
        }

        try {
            // Draw the cropped face to display canvas
            this.displayCtx.clearRect(0, 0, 256, 256);
            this.displayCtx.drawImage(this.croppedCanvas, 0, 0);
        } catch (error) {
            console.error('Error updating display:', error);
        }
    }

    attachCanvas(canvas: HTMLCanvasElement): void {
        console.log('Attaching canvas');
        this.displayCanvas = canvas;
        this.displayCtx = canvas.getContext('2d', {
            alpha: false,
            desynchronized: true
        });

        if (!this.displayCtx) {
            throw new Error('Failed to get display canvas context');
        }

        // Set canvas size
        canvas.width = 256;
        canvas.height = 256;

        // Configure context
        this.displayCtx.imageSmoothingEnabled = true;
        this.displayCtx.imageSmoothingQuality = 'high';

        // Clear to black
        this.displayCtx.fillStyle = 'black';
        this.displayCtx.fillRect(0, 0, 256, 256);

        console.log('Canvas attached successfully');
    }

    detachCanvas(): void {
        if (this.displayCtx && this.displayCanvas) {
            this.displayCtx.fillStyle = 'black';
            this.displayCtx.fillRect(0, 0, this.displayCanvas.width, this.displayCanvas.height);
        }
        this.displayCanvas = null;
        this.displayCtx = null;
    }

    updateFrameBuffer(frame: ImageData): void {
        if (!frame) return;

        this.frameBuffer.push(frame);
        while (this.frameBuffer.length > this.frameBufferLength) {
            this.frameBuffer.shift();
        }
    }

    hasMinimumFrames(): boolean {
        return this.frameBuffer.length >= this.minBufferForInference;
    }

    getFrameBuffer(): ImageData[] {
        return this.frameBuffer;
    }

    getBufferUsagePercentage(): number {
        return (this.frameBuffer.length / this.minBufferForInference) * 100;
    }

    clearFrameBuffer(): void {
        this.frameBuffer = [];
    }

    async stopCapture(): Promise<void> {
        await this.cleanup();
    }

    private async cleanup(): Promise<void> {
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        this.videoElement.pause();
        this.videoElement.srcObject = null;

        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
            this.metricsInterval = null;
        }

        this.frameBuffer = [];
        this.metrics = {
            fps: 0,
            processingTime: 0,
            bufferUsage: 0,
            droppedFrames: 0
        };

        this.croppedCtx.clearRect(0, 0, 256, 256);
        this.processingCtx.clearRect(0, 0, 9, 9);

        if (this.displayCtx && this.displayCanvas) {
            this.displayCtx.fillStyle = 'black';
            this.displayCtx.fillRect(0, 0, this.displayCanvas.width, this.displayCanvas.height);
        }

        this.lastFrameTime = 0;
        this.frameCount = 0;
        this.lastFrameTimestamp = 0;
    }

    getMetrics(): VideoProcessorMetrics {
        return { ...this.metrics };
    }

    isCapturing(): boolean {
        return !!this.mediaStream && this.mediaStream.active;
    }
}