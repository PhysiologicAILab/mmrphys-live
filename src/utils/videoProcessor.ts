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
    private readonly FACE_DETECTION_INTERVAL_FRAMES: number = 6;
    private frameTimestamps: number[] = [];
    private readonly FPS_WINDOW_SIZE = 30; // Calculate FPS over 30 frames
    private newFramesBuffer: ImageData[] = [];
    private _isShuttingDown = false;
    private readonly FACE_DISTANCE_THRESHOLD = 0.15; // 15% of frame width threshold
    private faceBoxHistory: FaceBox[] = [];
    private readonly FACE_HISTORY_SIZE = 5;
    private _isVideoFileSource: boolean = false;
    private onVideoComplete: (() => void) | null = null;
    private faceDetectionActive: boolean = false;

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

    public getVideoElement(): HTMLVideoElement {
        return this.videoElement;
    }

    // Add this property to be externally readable 
    public get isVideoFileSource(): boolean {
        return this._isVideoFileSource;
    }

    public resetVideoState(): void {
        // Clear any ended state and prepare for a new video
        this._isShuttingDown = false;

        if (this.videoElement) {
            this.videoElement.pause();
            this.videoElement.currentTime = 0;

            // If there was a previous video, we need to ensure the ended flag is reset
            // This can be forced by reloading the video element
            if (this.videoElement.ended) {
                this.videoElement.load();
            }
        }

        console.log('[VideoProcessor] Video state has been reset');
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
        console.log('[VideoProcessor] Loading video file:', file.name);

        // Stop any existing capture and cleanup resources
        await this.stopCapture();

        // Set flag to indicate we're using a video file
        this._isVideoFileSource = true;

        // Reset shutdown flag explicitly
        this._isShuttingDown = false;

        // Create a URL for the file
        const videoURL = URL.createObjectURL(file);

        // Reset buffers and state completely
        this.frameBuffer = [];
        this.newFramesBuffer = [];
        this.frameCount = 0;
        this.faceBoxHistory = [];
        this.frameTimestamps = [];
        this.lastFrameTime = 0;
        this.currentFaceBox = null;

        // Reset the video element's state more thoroughly
        this.videoElement.pause();
        this.videoElement.currentTime = 0;

        // If there was a previous video file, properly cleanup
        if (this.videoElement.src) {
            const oldSrc = this.videoElement.src;
            this.videoElement.removeAttribute('src');
            this.videoElement.load();

            // Release memory from any previous object URL
            if (oldSrc.startsWith('blob:')) {
                URL.revokeObjectURL(oldSrc);
            }
        }

        // Set new video source with explicit properties
        this.videoElement.src = videoURL;
        this.videoElement.muted = true;
        this.videoElement.playbackRate = 2.0; // Fast playback for video files
        this.videoElement.loop = false;      // Ensure no looping

        console.log('[VideoProcessor] Video file loaded, isVideoFileSource=true');

        // Wait for video metadata to load with better error handling
        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Video loading timeout'));
                URL.revokeObjectURL(videoURL); // Clean up the URL
            }, 10000);

            const handleError = (e: Event) => {
                clearTimeout(timeout);
                URL.revokeObjectURL(videoURL);
                reject(new Error(`Failed to load video file: ${e.type}`));
            };

            this.videoElement.onerror = (e) => {
                if (e instanceof Event) {
                    handleError(e);
                } else {
                    console.error('Unexpected error type:', e);
                }
            };

            this.videoElement.onloadedmetadata = () => {
                clearTimeout(timeout);

                console.log('[VideoProcessor] Video metadata loaded:', {
                    duration: this.videoElement.duration,
                    width: this.videoElement.videoWidth,
                    height: this.videoElement.videoHeight
                });

                // Initialize face detector and start processing in sequence
                const initializeAndStartProcessing = async () => {
                    try {
                        // Always reinitialize the face detector completely
                        if (this.faceDetector.isInitialized) {
                            this.faceDetector.stopDetection();
                            this.faceDetector.noDetectionCount = 0;
                            await this.faceDetector.dispose(); // Properly dispose the detector
                        }

                        console.log('[VideoProcessor] Reinitializing face detector...');
                        await this.faceDetector.initialize();
                        this.faceDetector.setCapturingState(true); // Ensure capturing state is set

                        // Load configuration settings
                        await this.loadConfigSettings();

                        // Run initial face detection without blocking the main flow
                        try {
                            await this.videoElement.play();
                            await new Promise(r => setTimeout(r, 100));

                            // Start face detection but don't await it
                            this.faceDetector.detectFace(this.videoElement).then(initialFace => {
                                if (initialFace) {
                                    this.currentFaceBox = initialFace;
                                    console.log('[VideoProcessor] Initial face detected in video');
                                } else {
                                    console.log('[VideoProcessor] No face detected in initial frame, using center crop');
                                    // Set default face box for center crop
                                    const size = Math.min(this.videoElement.videoWidth, this.videoElement.videoHeight);
                                    this.currentFaceBox = {
                                        x: (this.videoElement.videoWidth - size) / 2,
                                        y: (this.videoElement.videoHeight - size) / 2,
                                        width: size,
                                        height: size
                                    };
                                }

                                // Reset to beginning after face detection
                                this.videoElement.currentTime = 0;
                            }).catch(error => {
                                console.warn('[VideoProcessor] Initial face detection failed:', error);
                                this.videoElement.currentTime = 0;
                            });
                        } catch (error) {
                            console.warn('[VideoProcessor] Initial video playback failed:', error);
                            this.videoElement.currentTime = 0;
                        }

                        // Start parallel face detection
                        this.startParallelFaceDetection();

                        // Start frame processing
                        this.startFrameProcessing();

                        console.log('[VideoProcessor] Video processing initialized and started');
                        resolve();
                    } catch (error) {
                        console.error('[VideoProcessor] Failed to initialize processing:', error);
                        URL.revokeObjectURL(videoURL);
                        reject(error);
                    }
                };

                initializeAndStartProcessing().catch(error => {
                    console.error('[VideoProcessor] Initialization sequence failed:', error);
                    URL.revokeObjectURL(videoURL);
                    reject(error);
                });
            };

            // Handle complete video loading success
            this.videoElement.onloadeddata = () => {
                console.log('[VideoProcessor] Video data fully loaded');
            };
        });
    }

    async startCapture(): Promise<void> {
        try {
            // Existing setup code...

            this._isVideoFileSource = false;
            await this.loadConfigSettings();

            // // Initialize face detector
            // if (!this.faceDetector.isInitialized) {
            //     console.log('Reinitializing face detector...');
            //     await this.faceDetector.initialize();
            // } else {
            //     this.faceDetector.stopDetection();
            //     this.faceDetector.noDetectionCount = 0;
            // }

            // Always reinitialize the face detector completely
            if (this.faceDetector.isInitialized) {
                this.faceDetector.stopDetection();
                this.faceDetector.noDetectionCount = 0;
                await this.faceDetector.dispose(); // Properly dispose the detector
            }
            console.log('Reinitializing face detector...');                
            await this.faceDetector.initialize();
            this.faceDetector.setCapturingState(true); // Ensure capturing state is set


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

        // Add a counter for frame-based detection
        let parallelDetectionFrameCounter = 0;

        const detectFaces = async () => {
            if (!this.faceDetectionActive || this._isShuttingDown) {
                console.log('[VideoProcessor] Face detection loop stopped');
                return;
            }

            // Increment frame counter for frame-based detection
            parallelDetectionFrameCounter++;

            // Only detect faces at specified frame intervals instead of time-based detection
            if (parallelDetectionFrameCounter >= this.FACE_DETECTION_INTERVAL_FRAMES) {
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

                    // Reset frame counter after detection
                    parallelDetectionFrameCounter = 0;
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

                if (this._isVideoFileSource && wasPlaying) {
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
                } else if (this._isVideoFileSource) {
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
                if (this._isVideoFileSource && wasPlaying) {
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
        // Listen for video end
        this.videoElement.addEventListener('ended', () => {
            console.log('[VideoProcessor] Video playback ended');
            if (this.onVideoComplete) {
                this.onVideoComplete();
            }
        });

        // Add seeking event to help with video navigation issues
        this.videoElement.addEventListener('seeking', () => {
            console.log('[VideoProcessor] Video seeking - clearing frame buffers');
            this.newFramesBuffer = [];  // Clear new frames buffer to avoid stale frames
        });

        // Add loadeddata event to ensure we're ready to process
        this.videoElement.addEventListener('loadeddata', () => {
            console.log('[VideoProcessor] Video data loaded and ready to process');
            // Reset frame counters when a new video is loaded
            this.frameCount = 0;
            this.newFramesBuffer = [];
            this._isShuttingDown = false;
        });
    }

    // Modified frame processing to completely remove face detection from main loop
    private startFrameProcessing(): void {
        this._isShuttingDown = false;

        // Initial video playback setup for file source
        if (this._isVideoFileSource) {
            // Start with a high playback rate for maximum processing speed
            this.videoElement.playbackRate = 2.0;
            console.log('[VideoProcessor] Setting initial video playback rate to 2.0 for maximum throughput');

            this.videoElement.play().catch(error => {
                console.error('[VideoProcessor] Failed to play video:', error);
            });
        }

        // Tracking variables
        let frameBacklog = 0;
        let lastAdjustmentTime = 0;
        const ADJUSTMENT_INTERVAL = 1000; // Only adjust playback every 1 second

        const processFrame = async (timestamp: number) => {
            // Early exit if shutting down
            if (this._isShuttingDown) {
                console.log('[VideoProcessor] Aborting frame processing loop');
                return;
            }

            // For video files, use simpler playback rate management
            if (timestamp - lastAdjustmentTime > ADJUSTMENT_INTERVAL) {
                lastAdjustmentTime = timestamp;

                // Adaptive playback control based on backlog
                if (frameBacklog > 30) {
                    // Severe backlog - pause briefly to let processing catch up
                    this.videoElement.pause();
                    await new Promise(r => setTimeout(r, 100));
                    this.videoElement.play().catch(e => console.error(e));
                    frameBacklog = Math.max(0, frameBacklog - 10);
                    console.log('[VideoProcessor] Severe backlog - paused playback briefly');
                }
                else if (frameBacklog > 20) {
                    // Significant backlog - reduce playback rate but still keep it relatively high
                    this.videoElement.playbackRate = 1.0;
                    console.log('[VideoProcessor] Reducing playback rate to 1.0 due to significant backlog');
                }
                else if (frameBacklog > 10) {
                    // Moderate backlog - slightly reduce speed
                    this.videoElement.playbackRate = 1.5;
                    console.log('[VideoProcessor] Setting playback rate to 1.5 (moderate backlog)');
                }
                else {
                    // No significant backlog - run as fast as possible
                    this.videoElement.playbackRate = 2.0;

                    // If backlog is very low, try going even faster
                    if (frameBacklog < 5) {
                        this.videoElement.playbackRate = 3.0;
                        console.log('[VideoProcessor] Setting playback rate to 3.0 (minimal backlog)');
                    } else {
                        console.log('[VideoProcessor] Setting playback rate to 2.0 (normal operation)');
                    }
                }
            }

            // Determine if we should process this frame
            const shouldProcessFrame = this._isVideoFileSource ||
                (timestamp - this.lastFrameTime >= this.frameInterval);

            if (shouldProcessFrame) {
                // Process the frame
                this.processVideoFrame(timestamp);
                frameBacklog++;

                // Track when frame was processed
                this.lastFrameTime = timestamp;

                // Set up one-time callback to decrement backlog when processed
                const originalCallback = this.onFrameProcessed;
                this.onFrameProcessed = (frame) => {
                    // Decrement backlog when frame is fully processed
                    frameBacklog = Math.max(0, frameBacklog - 1);

                    // Call original callback if exists
                    if (originalCallback) originalCallback(frame);

                    // Restore original callback after this one fires
                    this.onFrameProcessed = originalCallback;
                };
            }

            // Continue processing if not complete
            const isComplete = this._isVideoFileSource && this.videoElement.ended;

            if (!this._isShuttingDown && !isComplete) {
                this.processingFrameId = requestAnimationFrame(processFrame);
            } else if (isComplete) {
                console.log('[VideoProcessor] Video playback complete');
                // Notify listeners if video playback is complete
                if (this.onVideoComplete) {
                    this.onVideoComplete();
                }
            }
        };

        // Start the frame processing loop
        this.processingFrameId = requestAnimationFrame(processFrame);
    }

    isVideoComplete(): boolean {
        // Only return true if we are actively using a video file AND it has ended
        return this._isVideoFileSource &&
            !this._isShuttingDown &&
            this.videoElement.ended;
    }   

    private processVideoFrame(timestamp: number): void {
        try {
            // Immediately exit if we're shutting down or config not loaded
            if (this._isShuttingDown || !this.configLoaded) {
                if (!this.configLoaded) {
                    console.warn('[VideoProcessor] Attempting to process frame before config is loaded');
                }
                return;
            }

            // Record timestamp for FPS calculation
            this.frameTimestamps.push(timestamp);
            if (this.frameTimestamps.length > this.FPS_WINDOW_SIZE * 2) {
                this.frameTimestamps = this.frameTimestamps.slice(-this.FPS_WINDOW_SIZE);
            }

            // Log more frequently for video files to help diagnose issues
            if (this._isVideoFileSource && this.frameCount % 30 === 0) {
                console.log(`[VideoProcessor] Processed ${this.frameCount} frames from video file`);
                console.log(`[VideoProcessor] Buffer status: frameBuffer=${this.frameBuffer.length}, newFramesBuffer=${this.newFramesBuffer.length}`);
                console.log(`[VideoProcessor] Video state: currentTime=${this.videoElement.currentTime.toFixed(2)}, duration=${this.videoElement.duration.toFixed(2)}`);
            }

            // Calculate and log FPS every 60 frames with improved dynamic adjustment
            if (this.frameCount % 60 === 0) {
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

            // Determine if display or face detection needs the cropped canvas
            const isDisplayActive = !!this.displayCtx && !!this.displayCanvas;
            const needsFaceCrop = this.faceDetectionFrameCounter >= this.FACE_DETECTION_INTERVAL_FRAMES - 1;
            const needsCroppedCanvas = isDisplayActive || needsFaceCrop;

            // Get crop region once (reused across operations)
            const cropRegion = this.getCropRegion();

            // Optimize canvas operations path based on requirements
            let frameData;

            if (needsCroppedCanvas) {
                // Path 1: We need the cropped canvas for display or face detection
                // Draw cropped region to intermediate canvas
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

                // Draw to processing canvas from the cropped canvas
                this.processingCtx.drawImage(
                    this.croppedCanvas,
                    0,
                    0,
                    256,
                    256,
                    0,
                    0,
                    this.frameWidth,
                    this.frameHeight
                );

                // Update display if active - do this directly instead of at the end
                if (isDisplayActive && this.displayCtx) {
                    this.displayCtx.drawImage(this.croppedCanvas, 0, 0);
                }
            } else {
                // Path 2: We don't need the cropped canvas, draw directly from video to processing canvas
                // This skips one unnecessary canvas operation for better performance
                this.processingCtx.drawImage(
                    this.videoElement,
                    cropRegion.x,
                    cropRegion.y,
                    cropRegion.width,
                    cropRegion.height,
                    0,
                    0,
                    this.frameWidth,
                    this.frameHeight
                );
            }

            // Get processed frame data - only do this once
            frameData = this.processingCtx.getImageData(
                0,
                0,
                this.frameWidth,
                this.frameHeight
            );

            // Verify frameData is valid before adding to buffers
            if (!frameData || frameData.width !== this.frameWidth || frameData.height !== this.frameHeight) {
                console.error('[VideoProcessor] Invalid frame data generated',
                    frameData ? `${frameData.width}x${frameData.height}` : 'null');
                return;
            }

            // Update both frame buffers in one pass - ensuring we're actually adding frames
            this.frameBuffer.push(frameData);
            this.newFramesBuffer.push(frameData);

            // For video files, keep detailed logs of buffer state to diagnose issues
            if (this._isVideoFileSource && this.frameCount % 10 === 0) {
                console.log(`[VideoProcessor] Frame buffers updated: total=${this.frameBuffer.length}, new=${this.newFramesBuffer.length}`);
            }

            // Maintain maximum buffer size for frameBuffer
            // Use a more efficient approach than while loop for large buffers
            if (this.frameBuffer.length > this.MAX_BUFFER_SIZE) {
                const extraFrames = this.frameBuffer.length - this.MAX_BUFFER_SIZE;
                this.frameBuffer = this.frameBuffer.slice(extraFrames);
            }

            // Notify frame processed - always call this for consistent behavior
            if (this.onFrameProcessed) {
                this.onFrameProcessed(frameData);
            }

            // For video files, check if we're near the end and log
            if (this._isVideoFileSource &&
                this.videoElement.duration > 0 &&
                this.videoElement.currentTime > (this.videoElement.duration * 0.95)) {
                console.log(`[VideoProcessor] Approaching end of video: ${this.videoElement.currentTime.toFixed(2)}/${this.videoElement.duration.toFixed(2)}`);
            }
        } catch (error) {
            console.error('[VideoProcessor] Frame processing error:', error);

            // Even on error, try to continue processing next frames
            // But log detailed diagnostic info to help debug
            console.error('[VideoProcessor] Error details:', {
                videoReady: this.videoElement.readyState,
                currentTime: this.videoElement.currentTime,
                isEnded: this.videoElement.ended,
                frameCount: this.frameCount,
                bufferLength: this.frameBuffer.length,
                newFramesLength: this.newFramesBuffer.length
            });
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
        this._isShuttingDown = true;

        if (this.processingFrameId !== null) {
            cancelAnimationFrame(this.processingFrameId);
            this.processingFrameId = null;
        }

        // Explicitly tell the face detector to stop
        this.faceDetector.stopDetection();
        this.faceDetector.setCapturingState(false);

        // Clear display canvas if it exists
        if (this.displayCanvas && this.displayCtx) {
            this.displayCtx.clearRect(0, 0, this.displayCanvas.width, this.displayCanvas.height);
        }

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

    // Fix 3: Add a reset method to properly reinitialize processing state
    async reset(): Promise<void> {
        // Reset all internal state
        this.frameBuffer = [];
        this.newFramesBuffer = [];
        this.lastFrameTime = 0;
        this.frameCount = 0;
        this.currentFaceBox = null;
        this.frameTimestamps = [];
        this.faceBoxHistory = [];
        this._isShuttingDown = false;
        this.faceDetectionActive = false;

        // Clear canvases
        if (this.displayCanvas && this.displayCtx) {
            this.displayCtx.clearRect(0, 0, this.displayCanvas.width, this.displayCanvas.height);
        }

        if (this.croppedCtx) {
            this.croppedCtx.clearRect(0, 0, this.croppedCanvas.width, this.croppedCanvas.height);
        }

        if (this.processingCtx) {
            this.processingCtx.clearRect(0, 0, this.processingCanvas.width, this.processingCanvas.height);
        }

        console.log('[VideoProcessor] Reset complete');
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
        if (this._isVideoFileSource) {
            // For video files, check if we're in a valid playback state
            // Don't rely just on readyState - explicitly check the video isn't ended
            // and that we're not shutting down
            return !this._isShuttingDown &&
                this.videoElement.readyState >= 2 &&
                !this.videoElement.ended &&
                this.videoElement.duration > 0;
        }

        // For camera capture, check media stream
        return !this._isShuttingDown && !!this.mediaStream?.active;
    }
}