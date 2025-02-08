import * as faceapi from 'face-api.js';

export class FaceDetector {
    constructor() {
        this.currentFaceBox = null;
        this.detectionInterval = null;
        this.faceCanvas = document.getElementById('faceCanvas');
        this.faceCtx = this.faceCanvas.getContext('2d');
    }

    async initialize() {
        try {
            await faceapi.nets.tinyFaceDetector.loadFromUri('/models/face-api');
            console.log('Face detection model loaded');
        } catch (error) {
            console.error('Error loading face detection model:', error);
            throw error;
        }
    }

    async detectFace(videoElement) {
        const detection = await faceapi.detectSingleFace(
            videoElement,
            new faceapi.TinyFaceDetectorOptions({
                inputSize: 224,
                scoreThreshold: 0.5
            })
        );

        if (detection) {
            this.currentFaceBox = detection.box;
            this.drawFaceBox();
        }

        return detection?.box;
    }

    drawFaceBox() {
        // Clear previous drawing
        this.faceCtx.clearRect(0, 0, this.faceCanvas.width, this.faceCanvas.height);

        if (this.currentFaceBox)
            if (this.currentFaceBox) {
                // Draw face box
                this.faceCtx.strokeStyle = '#00ff00';
                this.faceCtx.lineWidth = 2;
                this.faceCtx.strokeRect(
                    this.currentFaceBox.x,
                    this.currentFaceBox.y,
                    this.currentFaceBox.width,
                    this.currentFaceBox.height
                );
            }
    }

    startDetection(videoElement) {
        // Update canvas dimensions to match video
        this.faceCanvas.width = videoElement.videoWidth;
        this.faceCanvas.height = videoElement.videoHeight;

        // Start detection loop
        this.detectionInterval = setInterval(
            () => this.detectFace(videoElement),
            1000 // Detect face every second
        );
    }

    stopDetection() {
        if (this.detectionInterval) {
            clearInterval(this.detectionInterval);
            this.detectionInterval = null;
        }
        this.currentFaceBox = null;
        this.faceCtx.clearRect(0, 0, this.faceCanvas.width, this.faceCanvas.height);
    }

    getCurrentFaceBox() {
        return this.currentFaceBox;
    }
}            