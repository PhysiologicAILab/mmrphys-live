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
        // Initialize video element with optimized settings
        this.videoElement = document.createElement('video');
        this.videoElement.playsInline = true;
        this.videoElement.muted = true;
        this.videoElement.autoplay = true;

        // Initialize canvases with optimized contexts
        this.croppedCanvas = this.createOptimizedCanvas(256, 256);
        this.processingCanvas = this.createOptimizedCanvas(9, 9);

        // Get and validate contexts
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
        // Configure contexts for optimal performance
        [this.croppedCtx, this.processingCtx].forEach(ctx => {
            ctx.imageSmoothingEnabled = false;
            ctx.imageSmoothingQuality = 'low';
        });

        // Create and apply oval mask for face cropping
        this.croppedCtx.save();
        this.croppedCtx.beginPath();
        this.croppedCtx.ellipse(
            128, 128, 124, 124,
            0, 0, 2 * Math.PI
        );
        this.croppedCtx.clip();
        this.croppedCtx.restore();
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

            this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.videoElement.srcObject = this.mediaStream;

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Video initialization timeout'));
                }, 10000);

                this.videoElement.onloadedmetadata = async () => {
                    try {
                        await this.videoElement.play();
                        clearTimeout(timeout);
                        resolve();
                    } catch (error) {
                        clearTimeout(timeout);
                        reject(error);
                    }
                };

                this.videoElement.onerror = (event) => {
                    clearTimeout(timeout);
                    reject(new Error(`Video error: ${event.toString}`));
                };
            });
        } catch (error) {
            await this.cleanup();
            throw new Error(`Failed to start video capture: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    processFrame(faceBox: FaceBox): ImageData | null {
        if (!faceBox || !this.videoElement.videoWidth) {
            return null;
        }

        const currentTime = performance.now();
        const frameInterval = 1000 / this.targetFPS;

        // Enforce frame rate limit
        if (currentTime - this.lastFrameTimestamp < frameInterval) {
            return null;
        }
        this.lastFrameTimestamp = currentTime;

        const startTime = performance.now();

        try {
            // Save context state before clearing
            this.croppedCtx.save();

            // Clear previous frame
            this.croppedCtx.clearRect(0, 0, 256, 256);
            this.processingCtx.clearRect(0, 0, 9, 9);

            // Reapply clipping mask
            this.croppedCtx.beginPath();
            this.croppedCtx.ellipse(128, 128, 124, 124, 0, 0, 2 * Math.PI);
            this.croppedCtx.clip();

            // Draw cropped face
            this.drawFaceRegion(faceBox);

            // Restore context state
            this.croppedCtx.restore();

            // Update display immediately
            this.updateDisplay();

            // Get processed frame for inference
            const processedFrame = this.processingCtx.getImageData(0, 0, 9, 9);

            // Update metrics
            this.frameCount++;
            this.metrics.processingTime = performance.now() - startTime;

            return processedFrame;
        } catch (error) {
            console.error('Frame processing error:', error);
            this.metrics.droppedFrames++;
            return null;
        }
    }

    private drawFaceRegion(faceBox: FaceBox): void {
        // Draw to cropped canvas (display size)
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

        // Draw to processing canvas (9x9)
        this.processingCtx.drawImage(
            this.croppedCanvas,
            0,
            0,
            9,
            9
        );
    }

    private updateDisplay(): void {
        if (this.displayCtx && this.displayCanvas) {
            this.displayCtx.clearRect(0, 0, this.displayCanvas.width, this.displayCanvas.height);
            this.displayCtx.drawImage(this.croppedCanvas, 0, 0);
        }
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

    attachCanvas(canvas: HTMLCanvasElement): void {
        this.displayCanvas = canvas;
        this.displayCtx = canvas.getContext('2d', {
            alpha: false,
            desynchronized: true
        });

        if (!this.displayCtx) {
            throw new Error('Failed to get display canvas context');
        }

        this.displayCtx.imageSmoothingEnabled = true;
        this.displayCtx.imageSmoothingQuality = 'high';

        // Clear canvas to black initially
        this.displayCtx.fillStyle = 'black';
        this.displayCtx.fillRect(0, 0, canvas.width, canvas.height);
    }

    detachCanvas(): void {
        if (this.displayCtx && this.displayCanvas) {
            // Clear canvas to black when detaching
            this.displayCtx.fillStyle = 'black';
            this.displayCtx.fillRect(0, 0, this.displayCanvas.width, this.displayCanvas.height);
        }
        this.displayCanvas = null;
        this.displayCtx = null;
    }

    async stopCapture(): Promise<void> {
        await this.cleanup();
    }

    private async cleanup(): Promise<void> {
        // Stop all media tracks
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => {
                track.stop(); // Explicitly stop each track
            });
            this.mediaStream = null;
        }

        // Pause and reset video element
        this.videoElement.pause();
        this.videoElement.srcObject = null;

        // Clear metrics interval
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
            this.metricsInterval = null;
        }

        // Reset frame buffer and metrics
        this.frameBuffer = [];
        this.metrics = {
            fps: 0,
            processingTime: 0,
            bufferUsage: 0,
            droppedFrames: 0
        };

        // Clear canvases
        this.croppedCtx.clearRect(0, 0, 256, 256);
        this.processingCtx.clearRect(0, 0, 9, 9);

        // Clear display canvas if attached
        if (this.displayCtx && this.displayCanvas) {
            this.displayCtx.fillStyle = 'black';
            this.displayCtx.fillRect(0, 0, this.displayCanvas.width, this.displayCanvas.height);
        }

        // Reset frame tracking
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