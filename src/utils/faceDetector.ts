import * as faceapi from 'face-api.js';
import { ApplicationPaths } from './paths';

/**
 * Represents a face bounding box with position and dimensions
 */
export interface FaceBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * FaceDetector handles face detection, tracking, and provides square bounding boxes
 * for consistent face region extraction.
 */
export class FaceDetector {
    // State management
    private currentFaceBox: FaceBox | null = null;
    public isInitialized: boolean = false;
    public isCapturing: boolean = false;
    private initializationPromise: Promise<void> | null = null;

    // Detection configuration
    private readonly options: faceapi.TinyFaceDetectorOptions;
    private temporaryCanvas: HTMLCanvasElement | null = null;

    // Frame-based detection (not time-based)
    private frameCounter: number = 0;
    private readonly DETECTION_FRAME_INTERVAL: number = 3;

    // Rolling history for stable face tracking
    private faceBoxHistory: FaceBox[] = [];
    private readonly MAX_HISTORY_SIZE: number = 5;

    // Failure detection
    public noDetectionCount: number = 0;
    private readonly MAX_NO_DETECTION_FRAMES: number = 20;
    private onDetectionStopped: (() => void) | null = null;

    // Initial grace period for setup
    private initialGracePeriod: boolean = true;
    private readonly GRACE_PERIOD_DURATION: number = 2000;

    /**
     * Creates a new FaceDetector instance
     */
    constructor() {
        // Initialize with default TinyFaceDetector options
        this.options = new faceapi.TinyFaceDetectorOptions({
            inputSize: 224,
            scoreThreshold: 0.5
        });
    }

    /**
     * Set callback for detection stopped events
     */
    setOnDetectionStoppedCallback(callback: () => void): void {
        this.onDetectionStopped = callback;
    }

    /**
     * Initialize face detection model and environment
     * Returns a promise that resolves when initialization is complete
     */
    async initialize(): Promise<void> {
        // Prevent multiple initialization attempts
        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        this.initializationPromise = (async () => {
            try {
                // Complete initialization process
                await this.setupFaceAPIEnvironment();
                await this.loadModelWeights();
                this.createTemporaryCanvas();

                // Verify model loaded successfully
                if (!this.verifyModelLoaded()) {
                    throw new Error('Face detection model verification failed');
                }

                this.isInitialized = true;
                console.log('Face detection model initialized successfully');
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown initialization error';
                console.error(`Face detector initialization failed: ${errorMessage}`);

                // Clean up resources on failure
                this.cleanup();
                this.initializationPromise = null;

                // Propagate error to caller
                throw new Error(`Face detector initialization failed: ${errorMessage}`);
            }
        })();

        return this.initializationPromise;
    }

    /**
     * Detect face in video frame
     * Returns current face box or null if no face detected
     */
    async detectFace(videoElement: HTMLVideoElement): Promise<FaceBox | null> {
        if (!this.isInitialized || !this.temporaryCanvas) {
            console.warn('Face detector not properly initialized');
            return this.currentFaceBox;
        }

        try {
            const ctx = this.temporaryCanvas.getContext('2d');
            if (!ctx) throw new Error('Failed to get canvas context');

            // Draw video frame to temporary canvas
            ctx.drawImage(videoElement, 0, 0, this.temporaryCanvas.width, this.temporaryCanvas.height);

            // Increment detection frame counter
            this.frameCounter++;

            let detection = null;
            // Perform face detection on first frame or every DETECTION_FRAME_INTERVAL frames
            if (this.frameCounter >= this.DETECTION_FRAME_INTERVAL || this.currentFaceBox === null) {
                detection = await faceapi.detectSingleFace(this.temporaryCanvas, this.options);
                // Reset frame counter after detection
                this.frameCounter = 0;
            }

            if (detection) {
                this.noDetectionCount = 0; // Reset no-detection counter
                this.initialGracePeriod = false; // End grace period

                // Create square bounding box
                const squareBox = this.createSquareBoundingBox(detection.box, videoElement);

                // Add to history and calculate rolling median
                this.faceBoxHistory.push(squareBox);
                if (this.faceBoxHistory.length > this.MAX_HISTORY_SIZE) {
                    this.faceBoxHistory.shift();
                }
                this.currentFaceBox = this.calculateRollingMedian();
            } else {
                // Only increment no-detection counter if we actually attempted detection
                if (this.frameCounter === 0) {
                    this.noDetectionCount++;
                    if (!this.initialGracePeriod && this.noDetectionCount >= this.MAX_NO_DETECTION_FRAMES) {
                        console.warn('Face not detected for consecutive frames. Triggering stop capture.');
                        this.stopDetection();
                        this.currentFaceBox = null;

                        // Notify application about detection stop
                        if (this.onDetectionStopped) {
                            this.onDetectionStopped();
                        }
                    }
                }
                // Use the current median values if no face is detected (keep existing box)
                if (this.currentFaceBox === null) {
                    this.currentFaceBox = this.calculateRollingMedian();
                }
            }

            return this.currentFaceBox;
        } catch (error) {
            console.error('Face detection error:', error);
            this.noDetectionCount++;
            if (this.noDetectionCount >= this.MAX_NO_DETECTION_FRAMES) {
                console.warn('Face not detected for consecutive frames. Triggering stop capture.');
                this.stopDetection();
                this.currentFaceBox = null;

                // Notify application about detection stop
                if (this.onDetectionStopped) {
                    this.onDetectionStopped();
                }
            }
            return this.currentFaceBox;
        }
    }

    /**
     * Start face detection
     */
    startDetection(): void {
        if (!this.isInitialized) {
            throw new Error('Face detector not initialized');
        }

        // Reset state for new detection session
        this.stopDetection();
        this.noDetectionCount = 0;
        this.initialGracePeriod = true;
        this.frameCounter = 0;

        // Start grace period timer
        setTimeout(() => {
            this.initialGracePeriod = false;
            console.log('Face detection grace period ended');
        }, this.GRACE_PERIOD_DURATION);

        console.log('Face detection started');
    }

    /**
     * Stop face detection
     */
    stopDetection(): void {
        this.currentFaceBox = null;
        this.faceBoxHistory = []; // Clear rolling history
        this.noDetectionCount = 0; // Reset no-detection counter
        this.isCapturing = false; // Ensure capturing state is reset
        console.log('Face detection stopped');
    }

    /**
     * Get current face box
     */
    getCurrentFaceBox(): FaceBox | null {
        return this.currentFaceBox;
    }

    /**
     * Check if detector is currently detecting
     */
    isDetecting(): boolean {
        return this.isCapturing;
    }

    // Add a method to ensure proper reinitialization
    async reinitialize(): Promise<void> {
        // First dispose completely
        await this.dispose();

        // Then initialize from scratch
        await this.initialize();

        // Reset state for detection
        this.noDetectionCount = 0;
        this.initialGracePeriod = true;
        this.frameCounter = 0;
        this.faceBoxHistory = [];
        this.currentFaceBox = null;

        console.log('Face detector reinitialized from scratch');
    }

    // Enhance the setCapturingState method
    setCapturingState(isCapturing: boolean): void {
        this.isCapturing = isCapturing;

        // If turning on capturing, make sure we're in a good state
        if (isCapturing) {
            this.noDetectionCount = 0;
            this.initialGracePeriod = true;
        }

        console.log(`Face detector capturing state: ${isCapturing}`);
    }

    /**
     * Clean up resources
     */
    async dispose(): Promise<void> {
        try {
            // Clean up resources
            this.cleanup();

            // Dispose of the model if loaded
            if (faceapi.nets.tinyFaceDetector.isLoaded) {
                await faceapi.nets.tinyFaceDetector.dispose();
                console.log('Face detection model disposed');
            }

            // Reset state to allow reinitialization
            this.isInitialized = false;
            this.initializationPromise = null;
        } catch (error) {
            console.warn('Error during face detector disposal:', error);
        }
    }

    // ------------------------------------------------------------------------
    // Private Helper Methods
    // ------------------------------------------------------------------------

    /**
     * Creates a square bounding box from a detected face box
     * Expands the shorter dimension equally from center to form a square
     */
    private createSquareBoundingBox(box: faceapi.Box, videoElement: HTMLVideoElement): FaceBox {
        if (!this.temporaryCanvas) {
            throw new Error('Temporary canvas is not initialized');
        }

        const scaleX = videoElement.videoWidth / this.temporaryCanvas.width;
        const scaleY = videoElement.videoHeight / this.temporaryCanvas.height;

        // Scale the original box dimensions
        const x = Math.round(box.x * scaleX);
        const y = Math.round(box.y * scaleY);
        const width = Math.round(box.width * scaleX);
        const height = Math.round(box.height * scaleY);

        // Calculate center point
        const centerX = x + width / 2;
        const centerY = y + height / 2;

        // Use the larger dimension to create a square
        const squareSide = Math.max(width, height);

        // Calculate new square bounds centered on the original center
        let squareX = Math.round(centerX - squareSide / 2);
        let squareY = Math.round(centerY - squareSide / 2);

        // Ensure the square doesn't exceed video dimensions
        squareX = Math.max(0, squareX);
        squareY = Math.max(0, squareY);

        // Adjust square size if it would go outside video bounds
        const adjustedSquareSide = Math.min(
            squareSide,
            videoElement.videoWidth - squareX,
            videoElement.videoHeight - squareY
        );

        return {
            x: squareX,
            y: squareY,
            width: adjustedSquareSide,
            height: adjustedSquareSide
        };
    }

    /**
     * Calculate median position from face box history for stable tracking
     */
    private calculateRollingMedian(): FaceBox | null {
        if (this.faceBoxHistory.length === 0) return this.currentFaceBox;

        // Helper function to calculate median of number array
        const median = (values: number[]) => {
            const sorted = [...values].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 !== 0
                ? sorted[mid]
                : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
        };

        // Extract coordinate arrays from history
        const xs = this.faceBoxHistory.map(box => box.x);
        const ys = this.faceBoxHistory.map(box => box.y);
        const widths = this.faceBoxHistory.map(box => box.width);
        const heights = this.faceBoxHistory.map(box => box.height);

        // Create face box with median values
        return {
            x: median(xs),
            y: median(ys),
            width: median(widths),
            height: median(heights)
        };
    }

    /**
     * Creates a temporary canvas for face detection processing
     */
    private createTemporaryCanvas(): void {
        try {
            this.temporaryCanvas = document.createElement('canvas');
            this.temporaryCanvas.width = 224; // Match inputSize
            this.temporaryCanvas.height = 224;

            // Verify canvas context
            const ctx = this.temporaryCanvas.getContext('2d');
            if (!ctx) {
                throw new Error('Could not create 2D canvas context');
            }
        } catch (error) {
            console.error('Failed to create temporary canvas:', error);
            this.temporaryCanvas = null;
            throw error;
        }
    }

    /**
     * Set up face-api.js environment
     */
    private async setupFaceAPIEnvironment(): Promise<void> {
        try {
            // Ensure browser environment
            if (typeof window === 'undefined') {
                throw new Error('Face detection requires a browser environment');
            }

            // Configure environment for face-api.js
            const env = {
                Canvas: HTMLCanvasElement,
                Image: HTMLImageElement,
                ImageData: ImageData,
                Video: HTMLVideoElement,
                createCanvasElement: () => document.createElement('canvas'),
                createImageElement: () => document.createElement('img'),
                fetch: typeof fetch !== 'undefined'
                    ? fetch
                    : async () => {
                        console.warn('Fetch not available, using mock implementation');
                        return {
                            ok: false,
                            status: 404,
                            json: async () => ({}),
                            text: async () => ''
                        } as Response;
                    }
            };

            // Apply environment configuration
            faceapi.env.monkeyPatch(env);

            // Test canvas support
            const testCanvas = document.createElement('canvas');
            const ctx = testCanvas.getContext('2d');
            if (!ctx) {
                throw new Error('Canvas 2D context not supported');
            }
        } catch (error) {
            console.error('Face API environment setup failed:', error);
            throw error;
        }
    }

    /**
     * Load model weights for face detection
     */
    private async loadModelWeights(): Promise<void> {
        try {
            const modelPath = ApplicationPaths.faceApiModel();
            console.log(`Loading face detection model from: ${modelPath}`);

            // Clean up existing model to prevent memory leaks
            if (faceapi.nets.tinyFaceDetector.isLoaded) {
                await faceapi.nets.tinyFaceDetector.dispose();
            }

            // Load model weights
            await faceapi.nets.tinyFaceDetector.load(modelPath);

            console.log('Face detection model weights loaded successfully');
        } catch (error) {
            const errorMessage = error instanceof Error
                ? error.message
                : 'Unknown model loading error';
            console.error(`Model weights loading failed: ${errorMessage}`);
            throw new Error(`Model weights loading failed: ${errorMessage}`);
        }
    }

    /**
     * Verify model is loaded correctly
     */
    private verifyModelLoaded(): boolean {
        const isLoaded = faceapi.nets.tinyFaceDetector.isLoaded;
        console.log(`Face detection model loaded: ${isLoaded}`);
        return isLoaded;
    }

    /**
     * Clean up resources
     */
    private cleanup(): void {
        this.stopDetection();
        this.currentFaceBox = null;
        this.isInitialized = false;

        // Clear temporary canvas
        if (this.temporaryCanvas) {
            const ctx = this.temporaryCanvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, this.temporaryCanvas.width, this.temporaryCanvas.height);
            this.temporaryCanvas = null;
        }

        console.log('Face detector cleaned up');
    }
}