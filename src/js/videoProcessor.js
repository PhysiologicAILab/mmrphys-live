export class VideoProcessor {
    constructor() {
        this.videoElement = document.getElementById('videoElement');
        this.frameCanvas = document.createElement('canvas');
        this.frameCtx = this.frameCanvas.getContext('2d');

        // Set canvas dimensions for 36x36 output
        this.frameCanvas.width = 36;
        this.frameCanvas.height = 36;
    }

    async startCapture() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'user',
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                }
            });

            this.videoElement.srcObject = stream;
            await new Promise(resolve => this.videoElement.onloadedmetadata = resolve);
            this.videoElement.play();
        } catch (error) {
            console.error('Error starting video capture:', error);
            throw error;
        }
    }

    async stopCapture() {
        if (this.videoElement.srcObject) {
            const tracks = this.videoElement.srcObject.getTracks();
            tracks.forEach(track => track.stop());
            this.videoElement.srcObject = null;
        }
    }

    captureFrame(faceBox) {
        // Draw the face region to the canvas, resizing to 36x36
        this.frameCtx.drawImage(
            this.videoElement,
            faceBox.x,
            faceBox.y,
            faceBox.width,
            faceBox.height,
            0,
            0,
            36,
            36
        );

        // Get the pixel data
        return this.frameCtx.getImageData(0, 0, 36, 36);
    }

    async captureFrameSequence(faceBox) {
        const frameBuffer = [];
        const numFrames = 300; // 10 seconds at 30 fps

        // Capture frames
        for (let i = 0; i < numFrames; i++) {
            const frame = this.captureFrame(faceBox);
            frameBuffer.push(frame);

            // Wait for next frame
            await new Promise(resolve => requestAnimationFrame(resolve));
        }

        return frameBuffer;
    }

    displayCroppedFace(frameData) {
        const croppedCanvas = document.getElementById('croppedFace');
        const ctx = croppedCanvas.getContext('2d');
        ctx.putImageData(frameData, 0, 0);
    }
}