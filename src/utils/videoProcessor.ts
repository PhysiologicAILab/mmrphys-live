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
    private frameWidth: number = 72;  // Default, will be updated from config
    private frameHeight: number = 72; // Default, will be updated from config
    private frameBuffer: ImageData[] = [];
    private MIN_FRAMES_REQUIRED = 181; // Will be updated from config if available
    private readonly MAX_BUFFER_SIZE = 181;     // 181 frame for Diff
    private mediaStream: MediaStream | null = null;
    private lastFrameTime: number = 0;
    private frameCount: number = 0;
    private readonly targetFPS: number = 30;
    private frameInterval: number = 1000 / 30; // For 30 FPS
    private onFrameProcessed: ((frame: ImageData) => void) | null = null;
    private processingFrameId: number | null = null;
    public faceDetector: FaceDetector;
    private currentFaceBox: FaceBox | null = null;
    private configLoaded: boolean = false;
    private faceDetectionFrameCounter: number = 0;
    private readonly FACE_DETECTION_INTERVAL_FRAMES: number = 3;
    private frameTimestamps: number[] = [];
    private readonly FPS_WINDOW_SIZE = 30; // Calculate FPS over 30 frames
    private newFramesBuffer: ImageData[] = [];
    private _isShuttingDown = false;

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

    private calculateCurrentFPS(): number {
        if (this.frameTimestamps.length < 2) return 0;

        // Calculate FPS based on the last N frames
        const timeWindow = this.frameTimestamps[this.frameTimestamps.length - 1] -
            this.frameTimestamps[Math.max(0, this.frameTimestamps.length - this.FPS_WINDOW_SIZE)];
        const frameCount = Math.min(this.FPS_WINDOW_SIZE, this.frameTimestamps.length - 1);

        if (timeWindow === 0) return 0;
        return (frameCount * 1000) / timeWindow;
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
            // Clear frame buffer
            this.frameBuffer = [];
            this.currentFaceBox = null;
            // Reset face detection counter
            this.faceDetectionFrameCounter = 0;

            // Reset signal buffers (if applicable)
            if (this.onFrameProcessed) {
                this.onFrameProcessed = null;
            }

            // Load frame dimensions from config
            await this.loadConfigSettings();

            // Reinitialize face detector
            if (!this.faceDetector.isInitialized) {
                console.log('Reinitializing face detector...');
                await this.faceDetector.initialize();
            } else {
                // Reset face detector state if already initialized
                this.faceDetector.stopDetection();
                this.faceDetector.noDetectionCount = 0; // Reset no-detection counter
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

            return new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Video initialization timeout'));
                }, 10000);

                this.videoElement.onplaying = async () => {
                    clearTimeout(timeout);

                    // Perform immediate face detection on first frame
                    try {
                        // Wait a tiny bit for the video to be fully ready
                        await new Promise(r => setTimeout(r, 100));
                        const initialFace = await this.faceDetector.detectFace(this.videoElement);
                        this.currentFaceBox = initialFace;
                        console.log('Initial face detection completed');
                    } catch (error) {
                        console.warn('Initial face detection failed:', error);
                    }

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
        // Replace time-based detection with frame-count-based detection
        this.faceDetectionFrameCounter++;

        if (this.faceDetectionFrameCounter >= this.FACE_DETECTION_INTERVAL_FRAMES) {
            try {
                const detectedFace = await this.faceDetector.detectFace(this.videoElement);
                this.currentFaceBox = detectedFace;
                // Reset counter after detection
                this.faceDetectionFrameCounter = 0;
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
        this._isShuttingDown = false; // Reset flag when starting

        const processFrame = async () => {
            // First check if we're shutting down
            if (this._isShuttingDown) {
                console.log('[VideoProcessor] Aborting frame processing loop - shutdown in progress');
                return; // Don't request a new frame
            }
            const now = performance.now();
            if (now - this.lastFrameTime >= this.frameInterval) {
                // Update face detection if needed
                await this.updateFaceDetection();

                // Process frame
                this.processVideoFrame(now);
                this.lastFrameTime = now;
            }
            // Only request next frame if not shutting down
            if (!this._isShuttingDown) {
                this.processingFrameId = requestAnimationFrame(processFrame);
            }
        };

        this.processingFrameId = requestAnimationFrame(processFrame);
    }

    private processVideoFrame(timestamp: number): void {
        try {
            // Immediately exit if we're shutting down
            if (this._isShuttingDown) {
                return;
            }
            if (!this.configLoaded) {
                console.warn('Attempting to process frame before config is loaded');
                return;
            }

            // Record timestamp for FPS calculation
            this.frameTimestamps.push(timestamp);

            // Keep the buffer size reasonable
            if (this.frameTimestamps.length > this.FPS_WINDOW_SIZE * 2) {
                this.frameTimestamps = this.frameTimestamps.slice(-this.FPS_WINDOW_SIZE);
            }

            // Calculate and log FPS every 30 frames
            if (this.frameCount % 30 === 0) {
                const currentFPS = this.calculateCurrentFPS();
                console.log(`[VideoProcessor] Current effective FPS: ${currentFPS.toFixed(1)}`);

                // If FPS is consistently too low (below 90% of target), adjust frame interval
                if (currentFPS > 0 && currentFPS < this.targetFPS * 0.9 && this.frameTimestamps.length >= this.FPS_WINDOW_SIZE) {
                    const newInterval = Math.max(this.frameInterval * 0.95, 1000 / (this.targetFPS * 1.1));
                    console.log(`[VideoProcessor] Adjusting frame interval from ${this.frameInterval.toFixed(1)}ms to ${newInterval.toFixed(1)}ms to improve FPS`);
                    this.frameInterval = newInterval;
                }
            }

            this.frameCount++;

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

            // Update both frame buffers
            this.frameBuffer.push(frameData);
            this.newFramesBuffer.push(frameData);

            // Maintain maximum buffer size for frameBuffer
            while (this.frameBuffer.length > this.MAX_BUFFER_SIZE) {
                this.frameBuffer.shift();
            }

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
        console.log('[VideoProcessor] Stopping capture - clearing all resources');
        
        // Add a flag to immediately prevent new processing
        this._isShuttingDown = true;

        // Cancel the animation frame loop
        if (this.processingFrameId !== null) {
            cancelAnimationFrame(this.processingFrameId);
            this.processingFrameId = null;
        }

        // Explicitly tell the face detector to stop
        this.faceDetector.stopDetection();
        this.faceDetector.setCapturingState(false);

        // Stop media stream
        if (this.mediaStream) {
            // Stop all tracks in the media stream
            this.mediaStream.getTracks().forEach(track => {
                track.stop();
                console.log('[VideoProcessor] Media track stopped');
            });
            this.mediaStream = null;
        }

        // Reset the video element
        if (this.videoElement.srcObject) {
            this.videoElement.srcObject = null;
            this.videoElement.pause();
            this.videoElement.removeAttribute('src');
            this.videoElement.load();
            console.log('[VideoProcessor] Video element reset');
        }

        // Clear frame buffer and other state
        this.frameBuffer = [];
        this.newFramesBuffer = [];
        this.lastFrameTime = 0;
        this.frameCount = 0;
        this.currentFaceBox = null;
        this.frameTimestamps = [];  // Clear FPS tracking timestamps

        console.log('[VideoProcessor] Capture stopped, all resources cleared');
    }

    /**
     * Get new frames captured since last call and clear new frames buffer
     */
    public getNewFrames(): ImageData[] {
        const frames = [...this.newFramesBuffer];
        this.newFramesBuffer = [];
        return frames;
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
        // Return false if explicitly shutting down or media stream is inactive
        return !this._isShuttingDown && !!this.mediaStream?.active;
    }
}