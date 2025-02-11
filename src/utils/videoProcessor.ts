// src/utils/videoProcessor.ts

export class VideoProcessor {
    private readonly videoElement: HTMLVideoElement;
    private readonly croppedCanvas: HTMLCanvasElement;
    private readonly croppedCtx: CanvasRenderingContext2D;
    private readonly processingCanvas: HTMLCanvasElement;
    private readonly processingCtx: CanvasRenderingContext2D;
    private displayCanvas: HTMLCanvasElement | null = null;
    private displayCtx: CanvasRenderingContext2D | null = null;
    private frameBuffer: ImageData[] = [];
    private readonly MIN_FRAMES_REQUIRED = 151; // 5 seconds at 30 FPS +1 frame for Diff
    private readonly MAX_BUFFER_SIZE = 301;     // 10 seconds at 30 FPS +1 frame for Diff
    private mediaStream: MediaStream | null = null;
    private lastFrameTime: number = 0;
    private frameCount: number = 0;
    private displayFrameId: number | null = null;
    private readonly targetFPS: number = 30;
    private readonly frameInterval: number = 1000 / 30; // For 30 FPS
    private onFrameProcessed: ((frame: ImageData) => void) | null = null;
    private processingFrameId: number | null = null;

    constructor() {
        // Initialize video element
        this.videoElement = document.createElement('video');
        this.videoElement.playsInline = true;
        this.videoElement.muted = true;
        this.videoElement.autoplay = true;

        // Initialize canvases with optimized settings
        this.croppedCanvas = this.createOptimizedCanvas(256, 256);
        this.processingCanvas = this.createOptimizedCanvas(9, 9);

        // Get contexts with error handling
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
            throw new Error('Failed to get canvas contexts');
        }

        this.croppedCtx = croppedCtx;
        this.processingCtx = processCtx;

        // Configure context settings
        this.setupContexts();
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

    private startFrameProcessing(): void {
        // Process frames at target FPS
        const processFrame = () => {
            const now = performance.now();
            if (now - this.lastFrameTime >= this.frameInterval) {
                this.captureAndProcessFrame();
                this.lastFrameTime = now;
            }
            this.processingFrameId = requestAnimationFrame(processFrame);
        };

        this.processingFrameId = requestAnimationFrame(processFrame);
    }

    private captureAndProcessFrame(): void {
        try {
            // Create a center crop of the video frame
            const size = Math.min(this.videoElement.videoWidth, this.videoElement.videoHeight);
            const x = (this.videoElement.videoWidth - size) / 2;
            const y = (this.videoElement.videoHeight - size) / 2;

            // Process to 9x9
            this.processingCtx.drawImage(
                this.videoElement,
                x, y, size, size,
                0, 0, 9, 9
            );

            // Get processed frame data
            const frameData = this.processingCtx.getImageData(0, 0, 9, 9);

            // Update frame buffer
            this.updateFrameBuffer(frameData);

            // Update display if needed
            if (this.displayCtx && this.displayCanvas) {
                this.croppedCtx.drawImage(
                    this.videoElement,
                    x, y, size, size,
                    0, 0, 256, 256
                );
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

        this.videoElement.srcObject = null;
        this.frameBuffer = [];
        this.lastFrameTime = 0;
        this.frameCount = 0;
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