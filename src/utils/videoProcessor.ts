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
    private readonly FACE_DISTANCE_THRESHOLD = 0.15; // 15% of frame width threshold
    private faceBoxHistory: FaceBox[] = [];
    private readonly FACE_HISTORY_SIZE = 5;
    private isVideoFileSource: boolean = false;
    private onVideoComplete: (() => void) | null = null;
    private faceDetectionActive: boolean = false;
    private lastFaceDetectionTime: number = 0;
    private readonly FACE_DETECTION_INTERVAL_MS: number = 100; // Detect faces every 100ms


    constructor() {
        // Initialize video element
        this.videoElement = document.createElement('video');
        this.videoElement.playsInline = true;
        this.videoElement.muted = true;
        this.videoElement.autoplay = true;

        this.setupVideoEventListeners();
        
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

    // Modified for video file loading
    async loadVideoFile(file: File): Promise<void> {
        // Stop any existing capture
        await this.stopCapture();

        // Set flag to indicate we're using a video file
        this.isVideoFileSource = true;

        // Create a URL for the file
        const videoURL = URL.createObjectURL(file);

        // Reset buffers
        this.frameBuffer = [];
        this.newFramesBuffer = [];
        this.frameCount = 0;
        this.faceBoxHistory = [];

        // Set the video element source
        this.videoElement.src = videoURL;
        this.videoElement.muted = true;
        this.videoElement.playbackRate = 0.8;

        // Wait for video metadata to load
        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Video loading timeout'));
            }, 10000);

            this.videoElement.onloadedmetadata = () => {
                clearTimeout(timeout);

                // Initialize face detector if needed
                const initializeAndStartProcessing = async () => {
                    if (!this.faceDetector.isInitialized) {
                        await this.faceDetector.initialize();
                    } else {
                        this.faceDetector.stopDetection();
                        this.faceDetector.noDetectionCount = 0;
                    }

                    await this.loadConfigSettings();

                    // Run initial face detection without blocking
                    try {
                        await this.videoElement.play();
                        await new Promise(r => setTimeout(r, 100));

                        // Start face detection but don't await it
                        this.faceDetector.detectFace(this.videoElement).then(initialFace => {
                            if (initialFace) {
                                this.currentFaceBox = initialFace;
                            }
                            // Reset to beginning after face detection
                            this.videoElement.currentTime = 0;
                        });

                    } catch (error) {
                        console.warn('Initial video face detection failed:', error);
                        this.videoElement.currentTime = 0;
                    }

                    // Start parallel face detection
                    this.startParallelFaceDetection();

                    // Start frame processing
                    this.startFrameProcessing();
                    resolve();
                };

                initializeAndStartProcessing().catch(reject);
            };

            this.videoElement.onerror = () => {
                clearTimeout(timeout);
                URL.revokeObjectURL(videoURL);
                reject(new Error('Failed to load video file'));
            };
        });
    }

    async startCapture(): Promise<void> {
        try {
            // Existing setup code...

            this.isVideoFileSource = false;
            await this.loadConfigSettings();

            // Initialize face detector
            if (!this.faceDetector.isInitialized) {
                console.log('Reinitializing face detector...');
                await this.faceDetector.initialize();
            } else {
                this.faceDetector.stopDetection();
                this.faceDetector.noDetectionCount = 0;
            }

            // Get media stream as before
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

                    // Perform immediate face detection on first frame, but don't block
                    try {
                        // Wait a tiny bit for the video to be fully ready
                        await new Promise(r => setTimeout(r, 100));
                        this.faceDetector.detectFace(this.videoElement).then(initialFace => {
                            if (initialFace) {
                                this.currentFaceBox = initialFace;
                                console.log('Initial face detection completed');
                            }
                        }).catch(error => {
                            console.warn('Initial face detection failed:', error);
                        });
                    } catch (error) {
                        console.warn('Setting up initial face detection failed:', error);
                    }

                    // Start separate face detection loop
                    this.startParallelFaceDetection();

                    // Start frame processing immediately without waiting for face detection
                    this.startFrameProcessing();
                    resolve();
                };

                this.videoElement.play().catch(reject);
            });
        } catch (error) {
            throw new Error(`Failed to start capture: ${error}`);
        }
    }

    // New method for parallel face detection
    private startParallelFaceDetection(): void {
        if (this.faceDetectionActive) return;

        this.faceDetectionActive = true;
        console.log('[VideoProcessor] Starting parallel face detection');

        const detectFaces = async () => {
            if (!this.faceDetectionActive || this._isShuttingDown) {
                console.log('[VideoProcessor] Face detection loop stopped');
                return;
            }

            const now = performance.now();
            // Only detect faces at specific intervals to avoid overloading
            if (now - this.lastFaceDetectionTime >= this.FACE_DETECTION_INTERVAL_MS) {
                try {
                    const detectedFace = await this.faceDetector.detectFace(this.videoElement);

                    if (detectedFace) {
                        // Only update if face moved significantly or we have few history entries
                        if (this.shouldUpdateFaceBox(detectedFace) || this.faceBoxHistory.length < 3) {
                            // Add to history
                            this.faceBoxHistory.push(detectedFace);
                            if (this.faceBoxHistory.length > this.FACE_HISTORY_SIZE) {
                                this.faceBoxHistory.shift();
                            }

                            // Update current face box with median values from history
                            if (this.faceBoxHistory.length > 0) {
                                this.currentFaceBox = this.getMedianFaceBox();
                            }
                        }
                    }

                    this.lastFaceDetectionTime = now;
                } catch (error) {
                    console.error('Face detection error:', error);
                }
            }

            // Schedule next detection
            if (!this._isShuttingDown) {
                requestAnimationFrame(detectFaces);
            }
        };

        // Start the detection loop
        detectFaces();
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

    private shouldUpdateFaceBox(newFaceBox: FaceBox): boolean {
        if (!this.currentFaceBox) return true;

        // Calculate normalized distance between centers
        const oldCenterX = this.currentFaceBox.x + this.currentFaceBox.width / 2;
        const oldCenterY = this.currentFaceBox.y + this.currentFaceBox.height / 2;
        const newCenterX = newFaceBox.x + newFaceBox.width / 2;
        const newCenterY = newFaceBox.y + newFaceBox.height / 2;

        const distanceX = Math.abs(newCenterX - oldCenterX) / this.frameWidth;
        const distanceY = Math.abs(newCenterY - oldCenterY) / this.frameHeight;
        const distance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);

        // Only update if movement is significant
        return distance > this.FACE_DISTANCE_THRESHOLD;
    }    

    private async updateFaceDetection(): Promise<void> {
        this.faceDetectionFrameCounter++;

        if (this.faceDetectionFrameCounter >= this.FACE_DETECTION_INTERVAL_FRAMES) {
            try {
                // For video files, consider pausing during detection to ensure it completes
                const wasPlaying = !this.videoElement.paused;

                if (this.isVideoFileSource && wasPlaying) {
                    this.videoElement.pause();
                }

                const detectedFace = await this.faceDetector.detectFace(this.videoElement);

                if (detectedFace) {
                    // Only update if face moved significantly or we have few history entries
                    if (this.shouldUpdateFaceBox(detectedFace) || this.faceBoxHistory.length < 3) {
                        // Add to history
                        this.faceBoxHistory.push(detectedFace);
                        if (this.faceBoxHistory.length > this.FACE_HISTORY_SIZE) {
                            this.faceBoxHistory.shift();
                        }

                        // Update current face box with median values from history
                        if (this.faceBoxHistory.length > 0) {
                            this.currentFaceBox = this.getMedianFaceBox();
                        }

                        // Log face detection for debugging
                        if (this.frameCount % 30 === 0) {
                            console.log(`[VideoProcessor] Face detected at (${detectedFace.x.toFixed(0)},${detectedFace.y.toFixed(0)}) size: ${detectedFace.width.toFixed(0)}x${detectedFace.height.toFixed(0)}`);
                        }
                    }
                } else if (this.isVideoFileSource) {
                    // For video files, use center crop if no face detected
                    const size = Math.min(this.videoElement.videoWidth, this.videoElement.videoHeight);
                    this.currentFaceBox = {
                        x: (this.videoElement.videoWidth - size) / 2,
                        y: (this.videoElement.videoHeight - size) / 2,
                        width: size,
                        height: size
                    };
                }

                // Resume video if we paused it
                if (this.isVideoFileSource && wasPlaying) {
                    await this.videoElement.play();
                }

                // Reset counter after detection
                this.faceDetectionFrameCounter = 0;
            } catch (error) {
                console.error('Face detection error:', error);
            }
        }
    }

    private getMedianFaceBox(): FaceBox {
        if (this.faceBoxHistory.length === 1) return this.faceBoxHistory[0];

        // Extract arrays of each parameter
        const xValues = this.faceBoxHistory.map(box => box.x);
        const yValues = this.faceBoxHistory.map(box => box.y);
        const widthValues = this.faceBoxHistory.map(box => box.width);
        const heightValues = this.faceBoxHistory.map(box => box.height);

        // Get median of each parameter
        return {
            x: this.getMedian(xValues),
            y: this.getMedian(yValues),
            width: this.getMedian(widthValues),
            height: this.getMedian(heightValues)
        };
    }

    private getMedian(values: number[]): number {
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
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

    private setupVideoEventListeners(): void {
        this.videoElement.addEventListener('ended', () => {
            console.log('[VideoProcessor] Video playback complete');
            // Notify any listeners that processing is complete
            if (this.onVideoComplete) {
                this.onVideoComplete();
            }
        });
    }

    // Modified frame processing to completely remove face detection from main loop
    private startFrameProcessing(): void {
        this._isShuttingDown = false;

        if (this.isVideoFileSource) {
            this.videoElement.play().catch(error => {
                console.error('Failed to play video:', error);
            });
        }

        let frameBacklog = 0;

        const processFrame = async (timestamp: number) => {
            if (this._isShuttingDown) {
                console.log('[VideoProcessor] Aborting frame processing loop');
                return;
            }

            // Implement backpressure for video files
            if (this.isVideoFileSource) {
                if (frameBacklog > 10) {
                    this.videoElement.playbackRate = Math.max(0.5, 0.8 - (frameBacklog / 60));
                    if (frameBacklog > 20) {
                        this.videoElement.pause();
                        await new Promise(r => setTimeout(r, 50));
                        this.videoElement.play().catch(e => console.error(e));
                    }
                } else if (frameBacklog < 3) {
                    this.videoElement.playbackRate = Math.min(1.0, 0.8 + (0.2 * (1 - frameBacklog / 3)));
                }
            }

            // Process frames at consistent intervals - NO face detection here
            if (this.isVideoFileSource || (timestamp - this.lastFrameTime >= this.frameInterval)) {
                // Process frame immediately - face detection happens in parallel
                this.processVideoFrame(timestamp);
                frameBacklog++;

                const oldCallback = this.onFrameProcessed;
                this.onFrameProcessed = (frame) => {
                    frameBacklog = Math.max(0, frameBacklog - 1);
                    if (oldCallback) oldCallback(frame);
                };

                this.lastFrameTime = timestamp;
            }

            // Continue processing frames
            if (!this._isShuttingDown && (!this.isVideoFileSource || !this.videoElement.ended)) {
                this.processingFrameId = requestAnimationFrame(processFrame);
            } else if (this.isVideoFileSource && this.videoElement.ended) {
                console.log('[VideoProcessor] Video playback complete');
            }
        };

        this.processingFrameId = requestAnimationFrame(processFrame);
    }

    isVideoComplete(): boolean {
        return this.isVideoFileSource && this.videoElement.ended;
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

            // Calculate and log FPS every 30 frames with improved dynamic adjustment
            if (this.frameCount % 30 === 0) {
                const currentFPS = this.calculateCurrentFPS();
                console.log(`[VideoProcessor] Current effective FPS: ${currentFPS.toFixed(1)}`);

                // Dynamic interval adjustment - both increase and decrease as needed
                if (this.frameTimestamps.length >= this.FPS_WINDOW_SIZE) {
                    if (currentFPS < this.targetFPS * 0.9) {
                        // FPS too low - decrease interval (increase framerate)
                        const newInterval = Math.max(this.frameInterval * 0.95, 1000 / (this.targetFPS * 1.1));
                        console.log(`[VideoProcessor] Adjusting frame interval from ${this.frameInterval.toFixed(1)}ms to ${newInterval.toFixed(1)}ms to improve FPS`);
                        this.frameInterval = newInterval;
                    } else if (currentFPS > this.targetFPS * 1.1) {
                        // FPS too high - increase interval (decrease framerate) to save resources
                        const newInterval = Math.min(this.frameInterval * 1.05, 1000 / (this.targetFPS * 0.9));
                        console.log(`[VideoProcessor] Adjusting frame interval from ${this.frameInterval.toFixed(1)}ms to ${newInterval.toFixed(1)}ms to stabilize FPS`);
                        this.frameInterval = newInterval;
                    }
                }
            }

            this.frameCount++;

            // Performance optimization: Skip unnecessary drawing for offscreen frames
            const isDisplayActive = !!this.displayCtx && !!this.displayCanvas;

            const cropRegion = this.getCropRegion();

            // Only draw to cropped canvas if we need it for display or for face detection
            if (isDisplayActive || this.faceDetectionFrameCounter >= this.FACE_DETECTION_INTERVAL_FRAMES - 1) {
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
            }

            // Draw to processing canvas with dimensions from config
            this.processingCtx.drawImage(
                isDisplayActive ? this.croppedCanvas : this.videoElement,
                isDisplayActive ? 0 : cropRegion.x,
                isDisplayActive ? 0 : cropRegion.y,
                isDisplayActive ? 256 : cropRegion.width,
                isDisplayActive ? 256 : cropRegion.height,
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

            // Update display if needed - only if display is active
            if (isDisplayActive && this.displayCtx) {
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

        // Stop face detection first
        this.faceDetectionActive = false;

        // Rest of the existing stopCapture code...
        this._isShuttingDown = true;

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

    public setOnVideoComplete(callback: () => void): void {
        this.onVideoComplete = callback;
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
        // Check if we're using a video file source
        if (this.isVideoFileSource) {
            // For video files, we're capturing if not shutting down and video isn't ended
            return !this._isShuttingDown && !this.videoElement.ended && this.videoElement.readyState >= 2;
        }

        // For camera capture, check media stream
        return !this._isShuttingDown && !!this.mediaStream?.active;
    }
}