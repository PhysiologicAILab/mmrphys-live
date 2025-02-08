import { VideoProcessor } from './videoProcessor.js';
import { FaceDetector } from './faceDetector.js';
import { SignalProcessor } from './signalProcessor.js';
import { ChartManager } from './charts.js';

class App {
    constructor() {
        this.videoProcessor = new VideoProcessor();
        this.faceDetector = new FaceDetector();
        this.signalProcessor = new SignalProcessor();
        this.chartManager = new ChartManager();

        this.isCapturing = false;
        this.inferenceWorker = null;

        this.initializeUI();
    }

    async initialize() {
        try {
            await this.faceDetector.initialize();
            await this.setupInferenceWorker();
            this.updateStatus('System ready', 'success');
        } catch (error) {
            this.updateStatus(`Initialization error: ${error.message}`, 'error');
            throw error;
        }
    }

    async setupInferenceWorker() {
        this.inferenceWorker = new Worker(
            new URL('../workers/inferenceWorker.js', import.meta.url),
            { type: 'module' }
        );

        this.inferenceWorker.onmessage = (e) => {
            const { type, status, results, error } = e.data;

            if (status === 'error') {
                this.updateStatus(`Inference error: ${error}`, 'error');
                return;
            }

            if (type === 'inference' && status === 'success') {
                this.chartManager.updateCharts(results);
                this.signalProcessor.updateBuffers(results);
            }
        };

        // Initialize the model in the worker
        this.inferenceWorker.postMessage({ type: 'init' });
    }

    initializeUI() {
        // Button elements
        this.startButton = document.getElementById('startButton');
        this.stopButton = document.getElementById('stopButton');
        this.exportButton = document.getElementById('exportButton');

        // Event listeners
        this.startButton.addEventListener('click', () => this.startCapture());
        this.stopButton.addEventListener('click', () => this.stopCapture());
        this.exportButton.addEventListener('click', () => this.exportData());

        // Initialize charts
        this.chartManager.initialize();
    }

    async startCapture() {
        try {
            await this.videoProcessor.startCapture();
            this.isCapturing = true;
            this.startButton.disabled = true;
            this.stopButton.disabled = false;
            this.exportButton.disabled = true;

            this.startProcessing();
            this.updateStatus('Capturing started', 'success');
        } catch (error) {
            this.updateStatus(`Failed to start capture: ${error.message}`, 'error');
        }
    }

    async stopCapture() {
        try {
            await this.videoProcessor.stopCapture();
            this.isCapturing = false;
            this.startButton.disabled = false;
            this.stopButton.disabled = true;
            this.exportButton.disabled = false;

            this.stopProcessing();
            this.updateStatus('Capturing stopped', 'success');
        } catch (error) {
            this.updateStatus(`Failed to stop capture: ${error.message}`, 'error');
        }
    }

    startProcessing() {
        // Start face detection loop
        this.faceDetector.startDetection(this.videoProcessor.videoElement);

        // Start frame processing loop
        this.processFrames();
    }

    stopProcessing() {
        this.faceDetector.stopDetection();
    }

    async processFrames() {
        if (!this.isCapturing) return;

        const faceBox = this.faceDetector.getCurrentFaceBox();
        if (faceBox) {
            const frameBuffer = await this.videoProcessor.captureFrameSequence(faceBox);
            if (frameBuffer.length > 0) {
                this.inferenceWorker.postMessage({
                    type: 'inference',
                    data: { frameBuffer }
                });
            }
        }

        requestAnimationFrame(() => this.processFrames());
    }

    exportData() {
        const data = this.signalProcessor.getExportData();
        const blob = new Blob([JSON.stringify(data)], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `vital_signs_${new Date().toISOString()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    updateStatus(message, type = 'info') {
        const statusElement = document.getElementById('status');
        statusElement.textContent = message;
        statusElement.className = `status-message ${type}`;
    }
}

// Initialize the application
const app = new App();
app.initialize().catch(console.error);

export default app;