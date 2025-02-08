// src/js/modelInference.js
import * as ort from 'onnxruntime-web';

export class VitalSignsModel {
    constructor() {
        this.session = null;
        this.inputName = '';
        this.outputNames = [];
        this.config = null;
    }

    async initialize() {
        try {
            // Load model configuration
            const configResponse = await fetch('/models/rphys/config.json');
            this.config = await configResponse.json();

            // Initialize ONNX Runtime session
            this.session = await ort.InferenceSession.create('/models/rphys/SCAMPS_Multi_9x9.onnx');

            // Get input and output names from the model
            this.inputName = this.session.inputNames[0];
            this.outputNames = this.session.outputNames;
        } catch (error) {
            console.error('Error initializing model:', error);
            throw error;
        }
    }

    preprocessFrames(frameBuffer) {
        // Convert frame buffer to the format expected by the model
        const batchSize = 1;
        const sequence_length = frameBuffer.length;
        const height = 9;
        const width = 9;
        const channels = 3;

        // Create a float32 tensor from the frame buffer
        const inputTensor = new Float32Array(batchSize * sequence_length * channels * height * width);

        frameBuffer.forEach((frame, frameIdx) => {
            const frameData = frame.data;
            for (let c = 0; c < channels; c++) {
                for (let h = 0; h < height; h++) {
                    for (let w = 0; w < width; w++) {
                        const pixelIdx = (h * width + w) * 4; // 4 channels (RGBA)
                        const tensorIdx =
                            frameIdx * (channels * height * width) +
                            c * (height * width) +
                            h * width +
                            w;
                        // Normalize pixel values to [0, 1]
                        inputTensor[tensorIdx] = frameData[pixelIdx + c] / 255.0;
                    }
                }
            }
        });

        return inputTensor;
    }

    async inference(frameBuffer) {
        try {
            const inputTensor = this.preprocessFrames(frameBuffer);

            // Create ONNX tensor
            const tensorDims = [1, frameBuffer.length, 3, 9, 9];
            const input = new ort.Tensor('float32', inputTensor, tensorDims);

            // Run inference
            const feeds = {};
            feeds[this.inputName] = input;

            const results = await this.session.run(feeds);

            // Process outputs
            const bvpSignal = Array.from(results['bvp_signal'].data);
            const respSignal = Array.from(results['resp_signal'].data);

            // Calculate rates
            const heartRate = this.calculateHeartRate(bvpSignal);
            const respRate = this.calculateRespRate(respSignal);

            return {
                bvp: bvpSignal,
                resp: respSignal,
                heartRate,
                respRate
            };
        } catch (error) {
            console.error('Inference error:', error);
            throw error;
        }
    }

    calculateHeartRate(bvpSignal) {
        // Implement heart rate calculation from BVP signal
        // This is a simplified example - you should implement proper peak detection
        // and frequency analysis for your specific signal
        const samplingRate = this.config.sampling_rate;
        const peaks = this.findPeaks(bvpSignal);
        const avgInterval = this.calculateAverageInterval(peaks) / samplingRate;
        return Math.round(60 / avgInterval); // Convert to BPM
    }

    calculateRespRate(respSignal) {
        // Similar to heart rate calculation but for respiratory signal
        const samplingRate = this.config.sampling_rate;
        const peaks = this.findPeaks(respSignal);
        const avgInterval = this.calculateAverageInterval(peaks) / samplingRate;
        return Math.round(60 / avgInterval); // Convert to breaths per minute
    }

    findPeaks(signal) {
        const peaks = [];
        for (let i = 1; i < signal.length - 1; i++) {
            if (signal[i] > signal[i - 1] && signal[i] > signal[i + 1]) {
                peaks.push(i);
            }
        }
        return peaks;
    }

    calculateAverageInterval(peaks) {
        if (peaks.length < 2) return 0;
        let totalInterval = 0;
        for (let i = 1; i < peaks.length; i++) {
            totalInterval += peaks[i] - peaks[i - 1];
        }
        return totalInterval / (peaks.length - 1);
    }
}