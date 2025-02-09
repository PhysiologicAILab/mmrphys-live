import { FaceBox } from './faceDetector';

export interface ProcessedFrame {
    data: Uint8ClampedArray;
    width: number;
    height: number;
}

export class VideoProcessor {
    public readonly videoElement: HTMLVideoElement;
    private readonly croppedCanvas: HTMLCanvasElement;
    private readonly croppedCtx: CanvasRenderingContext2D;
    private readonly processingCanvas: HTMLCanvasElement;
    private readonly processingCtx: CanvasRenderingContext2D;
    private frameBuffer: ImageData[];
    private readonly frameBufferLength: number;

    constructor() {
        this.videoElement = document.createElement('video');
        this.videoElement.playsInline = true;
        this.videoElement.muted = true;

        this.croppedCanvas = document.createElement('canvas');
        this.croppedCanvas.width = 256;
        this.croppedCanvas.height = 256;

        const ctx = this.croppedCanvas.getContext('2d', {
            willReadFrequently: true,
            alpha: false
        });
        if (!ctx) throw new Error('Failed to get 2D context for cropped canvas');
        this.croppedCtx = ctx;

        this.processingCanvas = document.createElement('canvas');
        this.processingCanvas.width = 9;
        this.processingCanvas.height = 9;

        const processCtx = this.processingCanvas.getContext('2d', {
            willReadFrequently: true,
            alpha: false
        });
        if (!processCtx) throw new Error('Failed to get 2D context for processing canvas');
        this.processingCtx = processCtx;

        this.frameBuffer = [];
        this.frameBufferLength = 300;

        this.setupOptimizations();
    }

    private setupOptimizations(): void {
        this.croppedCtx.imageSmoothingEnabled = false;
        this.processingCtx.imageSmoothingEnabled = false;

        // Create oval mask
        this.croppedCtx.save();
        this.croppedCtx.beginPath();
        this.croppedCtx.ellipse(
            128, 128, 124, 124,
            0, 0, 2 * Math.PI
        );
        this.croppedCtx.clip();
    }

    async startCapture(): Promise<void> {
        try {
            const constraints = {
                video: {
                    facingMode: 'user',
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: 30 }
                }
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.videoElement.srcObject = stream;

            return new Promise((resolve, reject) => {
                this.videoElement.onloadedmetadata = () => {
                    this.videoElement.play().then(resolve).catch(reject);
                };
                this.videoElement.onerror = reject;
            });
        } catch (error) {
            console.error('Error starting video capture:', error);
            throw error;
        }
    }

    async stopCapture(): Promise<void> {
        if (this.videoElement.srcObject) {
            const tracks = (this.videoElement.srcObject as MediaStream).getTracks();
            tracks.forEach(track => track.stop());
            this.videoElement.srcObject = null;
        }

        this.frameBuffer = [];
        this.croppedCtx.clearRect(0, 0, 256, 256);
    }

    processFrame(faceBox: FaceBox): ImageData | null {
        if (!faceBox || !this.videoElement.videoWidth) {
            return null;
        }

        try {
            this.croppedCtx.clearRect(0, 0, 256, 256);

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
        } catch (error) {
            console.error('Error processing frame:', error);
            return null;
        }
    }

    updateFrameBuffer(frame: ImageData): void {
        if (!frame) return;

        this.frameBuffer.push(frame);
        if (this.frameBuffer.length > this.frameBufferLength) {
            this.frameBuffer.shift();
        }
    }

    getFrameBuffer(): ImageData[] {
        return this.frameBuffer;
    }

    clearFrameBuffer(): void {
        this.frameBuffer = [];
    }

    attachCanvas(canvas: HTMLCanvasElement): void {
        this.croppedCanvas.width = canvas.width;
        this.croppedCanvas.height = canvas.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(this.croppedCanvas, 0, 0);
        }
    }

    detachCanvas(): void {
        this.clearFrameBuffer();
    }
}