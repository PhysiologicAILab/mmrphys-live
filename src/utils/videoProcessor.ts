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
    private readonly frameInterval = 1000 / this.targetFPS;
    private readonly minBufferForInference: number;
    private faceDetectionWorker: Worker | null = null;
    private videoProcessingWorker: Worker | null = null;
    private displayFrameId: number | null = null;
    private processingFrameId: ReturnType<typeof setTimeout> | null = null;
    private isCenterCropMode: boolean = false;

    // Existing properties
    private cropMode: 'face' | 'center' = 'face';
    private lastCropMode: 'face' | 'center' = 'face';

    // New method to set crop mode
    setCropMode(mode: 'face' | 'center'): void {
        // Only update if the mode has changed
        if (this.cropMode !== mode) {
            // Store the previous mode for potential fallback or tracking
            this.lastCropMode = this.cropMode;
            this.cropMode = mode;

            // Log the crop mode change
            console.log(`Crop mode changed from ${this.lastCropMode} to ${this.cropMode}`);
        }
    }

    constructor(options: {
        frameBufferLength?: number,
        minBufferForInference?: number
    } = {}) {
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
        this.minBufferForInference = options.minBufferForInference ?? 150; // Default to 5 seconds at 30fps
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

    private async initializeWorkers(): Promise<void> {
        return new Promise((resolve, reject) => {
            let faceWorkerInitialized = false;
            let processWorkerInitialized = false;

            // Initialize face detection worker
            this.faceDetectionWorker = new Worker(
                new URL('../workers/faceDetectionWorker.ts', import.meta.url),
                { type: 'module' }
            );

            // Initialize video processing worker
            this.videoProcessingWorker = new Worker(
                new URL('../workers/videoProcessingWorker.ts', import.meta.url),
                { type: 'module' }
            );

            // Set up message handlers with timeout
            const initTimeout = setTimeout(() => {
                reject(new Error('Worker initialization timeout'));
            }, 10000);

            // Face detection worker initialization
            this.faceDetectionWorker.onmessage = (e) => {
                if (e.data.type === 'init') {
                    if (e.data.status === 'success') {
                        faceWorkerInitialized = true;
                        checkInitComplete();
                    } else {
                        reject(new Error(`Face detection worker init failed: ${e.data.error}`));
                    }
                }
            };

            // Video processing worker initialization 
            this.videoProcessingWorker.onmessage = (e) => {
                if (e.data.type === 'init') {
                    if (e.data.status === 'success') {
                        processWorkerInitialized = true;
                        checkInitComplete();
                    } else {
                        reject(new Error(`Video processing worker init failed: ${e.data.error}`));
                    }
                }
            };

            // Check if both workers are initialized
            const checkInitComplete = () => {
                if (faceWorkerInitialized && processWorkerInitialized) {
                    clearTimeout(initTimeout);
                    resolve();
                }
            };

            // Start initialization
            this.faceDetectionWorker.postMessage({ type: 'init' });
            this.videoProcessingWorker.postMessage({ type: 'init' });
        });
    }

    private startFrameLoop(): void {
        // Separate display loop for smooth video feed
        const displayLoop = () => {
            if (this.isCapturing()) {
                const centerCrop = this.createCenterCropFaceBox();
                this.processForDisplay(centerCrop);
                this.displayFrameId = requestAnimationFrame(displayLoop);
            }
        };

        // Start display loop
        this.displayFrameId = requestAnimationFrame(displayLoop);

        // Separate processing loop at lower frequency
        const processLoop = () => {
            if (this.isCapturing() && this.videoElement.readyState >= 2) {
                const currentTime = performance.now();
                if (currentTime - this.lastFrameTimestamp >= this.frameInterval) {
                    this.captureFrameForProcessing();
                    this.lastFrameTimestamp = currentTime;
                }
                this.processingFrameId = setTimeout(processLoop, this.frameInterval);
            }
        };

        // Start processing loop
        this.processingFrameId = setTimeout(processLoop, this.frameInterval);
    }

    private captureFrameForProcessing(): void {
        try {
            // Capture frame from video
            const tempCanvas = this.createOptimizedCanvas(
                this.videoElement.videoWidth,
                this.videoElement.videoHeight
            );
            const tempCtx = tempCanvas.getContext('2d', {
                willReadFrequently: true,
                alpha: false
            });

            if (!tempCtx) return;

            // Draw current video frame
            tempCtx.drawImage(this.videoElement, 0, 0);
            const frameData = tempCtx.getImageData(
                0, 0,
                this.videoElement.videoWidth,
                this.videoElement.videoHeight
            );

            // Send to worker for processing
            this.processFrameInWorkers(frameData);
        } catch (error) {
            console.error('Error capturing frame:', error);
        }
    }

    private processFrameInWorkers(imageData: ImageData): void {
        // Add more robust error handling
        try {
            // First detect face
            const faceDetectionPromise = new Promise<{ detection: any; status: string }>((resolve, reject) => {
                if (!this.faceDetectionWorker) {
                    reject(new Error('Face detection worker not initialized'));
                    return;
                }

                // Temporarily override onmessage and onerror
                const originalOnMessage = this.faceDetectionWorker.onmessage;
                const originalOnError = this.faceDetectionWorker.onerror;

                this.faceDetectionWorker.onmessage = (e: MessageEvent) => {
                    if (e.data.type === 'detect') {
                        // Restore original handlers
                        this.faceDetectionWorker!.onmessage = originalOnMessage;
                        this.faceDetectionWorker!.onerror = originalOnError;

                        resolve({
                            detection: e.data.detection,
                            status: e.data.status
                        });
                    }
                };

                this.faceDetectionWorker.onerror = (error: ErrorEvent) => {
                    // Restore original handlers
                    this.faceDetectionWorker!.onmessage = originalOnMessage;
                    this.faceDetectionWorker!.onerror = originalOnError;

                    reject(error);
                };

                // Send message
                this.faceDetectionWorker.postMessage({
                    type: 'detect',
                    imageData,
                    width: imageData.width,
                    height: imageData.height
                }, [imageData.data.buffer]);
            });

            // Process video frame after face detection
            faceDetectionPromise
                .then(({ detection }) => {
                    return new Promise<ImageData>((resolve, reject) => {
                        if (!this.videoProcessingWorker) {
                            reject(new Error('Video processing worker not initialized'));
                            return;
                        }

                        // Clone the video frame for processing
                        const processImageData = new ImageData(
                            new Uint8ClampedArray(imageData.data),
                            imageData.width,
                            imageData.height
                        );

                        // Temporarily override onmessage and onerror
                        const originalOnMessage = this.videoProcessingWorker.onmessage;
                        const originalOnError = this.videoProcessingWorker.onerror;

                        this.videoProcessingWorker.onmessage = (e: MessageEvent) => {
                            if (e.data.type === 'process') {
                                // Restore original handlers
                                this.videoProcessingWorker!.onmessage = originalOnMessage;
                                this.videoProcessingWorker!.onerror = originalOnError;

                                if (e.data.status === 'success') {
                                    resolve(e.data.processedData);
                                } else {
                                    reject(new Error(e.data.error || 'Video processing failed'));
                                }
                            }
                        };

                        this.videoProcessingWorker.onerror = (error: ErrorEvent) => {
                            // Restore original handlers
                            this.videoProcessingWorker!.onmessage = originalOnMessage;
                            this.videoProcessingWorker!.onerror = originalOnError;

                            reject(error);
                        };

                        // Send message
                        this.videoProcessingWorker.postMessage({
                            type: 'process',
                            imageData: processImageData,
                            faceBox: detection
                        }, [processImageData.data.buffer]);
                    });
                })
                .then((processedData) => {
                    // Update frame buffer with processed data
                    this.updateFrameBuffer(processedData);
                })
                .catch((error) => {
                    console.error('Frame processing error:', error);
                });
        } catch (error) {
            console.error('Frame processing initialization error:', error);
        }
    }

    async startCapture(): Promise<void> {
        try {
            if (this.mediaStream) {
                throw new Error('Capture already in progress');
            }

            // Initialize workers first
            await this.initializeWorkers();

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

                    // Start frame loops
                    this.startFrameLoop();
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

    // Modify processFrame method to respect crop mode
    processFrame(faceBox: FaceBox | null): ImageData | null {
        // Determine how to process the frame based on crop mode
        switch (this.cropMode) {
            case 'face':
                // Existing face detection logic
                if (faceBox) {
                    return this.processForInference(faceBox);
                }
                // Fallback to center crop if no face detected
                return this.processCenterCrop();

            case 'center':
                // Always use center crop
                return this.processCenterCrop();

            default:
                // Fallback to original behavior
                return this.processForInference(faceBox);
        }
    }

    // Optional: Method to reset to previous crop mode
    resetCropMode(): void {
        this.cropMode = this.lastCropMode;
        console.log(`Crop mode reset to ${this.cropMode}`);
    }

    // Optional: Get current crop mode
    getCurrentCropMode(): 'face' | 'center' {
        return this.cropMode;
    }

    // New method to handle center crop processing
    private processCenterCrop(): ImageData {
        // Calculate center crop dimensions
        const videoWidth = this.videoElement.videoWidth;
        const videoHeight = this.videoElement.videoHeight;

        const cropSize = Math.min(videoWidth, videoHeight);
        const startX = Math.floor((videoWidth - cropSize) / 2);
        const startY = Math.floor((videoHeight - cropSize) / 2);

        const centerCropBox: FaceBox = {
            x: startX,
            y: startY,
            width: cropSize,
            height: cropSize
        };

        return this.processForInference(centerCropBox);
    }



    private createCenterCropFaceBox(): FaceBox {
        const videoWidth = this.videoElement.videoWidth;
        const videoHeight = this.videoElement.videoHeight;

        // Calculate center crop dimensions
        const cropSize = Math.min(videoWidth, videoHeight);
        const startX = (videoWidth - cropSize) / 2;
        const startY = (videoHeight - cropSize) / 2;

        return {
            x: startX,
            y: startY,
            width: cropSize,
            height: cropSize
        };
    }

    private processForDisplay(faceBox: FaceBox | null): void {
        if (!this.videoElement.videoWidth || !this.videoElement.videoHeight) return;

        // Clear the cropped canvas
        this.croppedCtx.clearRect(0, 0, 256, 256);

        // Save context state
        this.croppedCtx.save();

        // Create oval mask
        this.croppedCtx.beginPath();
        this.croppedCtx.ellipse(128, 128, 124, 124, 0, 0, 2 * Math.PI);
        this.croppedCtx.clip();

        // If no face box is provided or invalid dimensions, use center crop
        if (!faceBox || faceBox.width === 0 || faceBox.height === 0) {
            const videoWidth = this.videoElement.videoWidth;
            const videoHeight = this.videoElement.videoHeight;

            // Calculate center crop dimensions
            const cropSize = Math.min(videoWidth, videoHeight);
            const startX = Math.floor((videoWidth - cropSize) / 2);
            const startY = Math.floor((videoHeight - cropSize) / 2);

            // Draw center-cropped video frame maintaining aspect ratio
            this.croppedCtx.drawImage(
                this.videoElement,
                startX,
                startY,
                cropSize,
                cropSize,
                0,
                0,
                256,
                256
            );
        } else {
            // For face detection case, ensure proper scaling and centering
            const padding = 20; // Add some padding around the face
            const sourceX = Math.max(0, faceBox.x - padding);
            const sourceY = Math.max(0, faceBox.y - padding);
            const sourceWidth = Math.min(
                this.videoElement.videoWidth - sourceX,
                faceBox.width + 2 * padding
            );
            const sourceHeight = Math.min(
                this.videoElement.videoHeight - sourceY,
                faceBox.height + 2 * padding
            );

            // Calculate scaling to maintain aspect ratio
            const scale = Math.min(
                256 / sourceWidth,
                256 / sourceHeight
            );
            const scaledWidth = sourceWidth * scale;
            const scaledHeight = sourceHeight * scale;
            const offsetX = (256 - scaledWidth) / 2;
            const offsetY = (256 - scaledHeight) / 2;

            // Draw face region with padding
            this.croppedCtx.drawImage(
                this.videoElement,
                sourceX,
                sourceY,
                sourceWidth,
                sourceHeight,
                offsetX,
                offsetY,
                scaledWidth,
                scaledHeight
            );
        }

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
        if (!this.displayCtx || !this.displayCanvas || !this.croppedCanvas) {
            console.warn('Display context or canvas not available');
            return;
        }

        try {
            // Clear the display canvas first
            this.displayCtx.clearRect(0, 0, this.displayCanvas.width, this.displayCanvas.height);

            // Draw the cropped canvas content onto the display canvas
            this.displayCtx.save();

            // Draw from croppedCanvas to displayCanvas, maintaining the oval clip
            this.displayCtx.beginPath();
            this.displayCtx.ellipse(128, 128, 124, 124, 0, 0, 2 * Math.PI);
            this.displayCtx.clip();

            this.displayCtx.drawImage(
                this.croppedCanvas,
                0, 0, 256, 256,  // Source dimensions
                0, 0, 256, 256   // Destination dimensions
            );

            this.displayCtx.restore();
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
        if (this.displayFrameId) {
            cancelAnimationFrame(this.displayFrameId);
            this.displayFrameId = null;
        }

        if (this.processingFrameId) {
            clearTimeout(this.processingFrameId);
            this.processingFrameId = null;
        }

        // Terminate workers
        if (this.faceDetectionWorker) {
            this.faceDetectionWorker.terminate();
            this.faceDetectionWorker = null;
        }

        if (this.videoProcessingWorker) {
            this.videoProcessingWorker.terminate();
            this.videoProcessingWorker = null;
        }

        // Rest of cleanup code
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