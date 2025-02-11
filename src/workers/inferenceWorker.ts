// src/workers/inferenceWorker.ts
/// <reference lib="webworker" />

import * as ort from 'onnxruntime-web';
import { SignalAnalyzer } from '../utils/signalAnalysis';

interface InferenceResult {
    bvp: number[];
    resp: number[];
    heartRate: number;
    respRate: number;
    inferenceTime: number;
}

class InferenceWorker {
    private session: ort.InferenceSession | null = null;
    private isInitialized = false;
    private inputName: string = '';
    private readonly MIN_FRAMES_REQUIRED = 181; // 6 seconds at 30 FPS +1 frame for Diff
    private modelConfig: any = null;

    private async configureOrtEnvironment(): Promise<void> {
        try {
            // Configure WASM paths
            ort.env.wasm.wasmPaths = {
                'ort-wasm.wasm': '/ort/ort-wasm.wasm',
                'ort-wasm-simd.wasm': '/ort/ort-wasm-simd.wasm',
                'ort-wasm-threaded.wasm': '/ort/ort-wasm-threaded.wasm',
                'ort-wasm-simd-threaded.wasm': '/ort/ort-wasm-simd-threaded.wasm'
            };

            // Configure WASM flags
            ort.env.wasm.numThreads = 1;
            ort.env.wasm.simd = true;

            console.log('ONNX Runtime environment configured');
        } catch (error) {
            console.error('Failed to configure ONNX Runtime:', error);
            throw error;
        }
    }

    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        try {
            await this.configureOrtEnvironment();

            // Load model config first
            console.log('Loading model configuration...');
            const configResponse = await fetch('/models/rphys/config.json');
            if (!configResponse.ok) throw new Error('Failed to fetch model config');
            this.modelConfig = await configResponse.json();
            console.log('Model configuration loaded:', this.modelConfig);

            // Load model
            console.log('Loading ONNX model...');
            const modelResponse = await fetch('/models/rphys/SCAMPS_Multi_9x9.onnx');
            if (!modelResponse.ok) throw new Error('Failed to fetch model');

            // Convert ArrayBuffer to Uint8Array for ONNX Runtime
            const modelArrayBuffer = await modelResponse.arrayBuffer();
            const modelData = new Uint8Array(modelArrayBuffer);
            console.log('Model loaded, size:', modelData.byteLength);

            // Create session with optimized options
            console.log('Creating ONNX session...');
            this.session = await ort.InferenceSession.create(modelData, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all',
                executionMode: 'sequential',
                enableCpuMemArena: true,
                enableMemPattern: true,
                logSeverityLevel: 0,
                logVerbosityLevel: 0,
                intraOpNumThreads: 1,
                interOpNumThreads: 1
            });

            if (!this.session) {
                throw new Error('Failed to create ONNX session');
            }

            this.inputName = this.session.inputNames[0];
            console.log('Session created successfully');
            console.log('Input names:', this.session.inputNames);
            console.log('Output names:', this.session.outputNames);

            // Warmup with correct tensor dimensions
            await this.warmupModel();

            this.isInitialized = true;
            self.postMessage({ type: 'init', status: 'success' });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Initialization error:', errorMessage);
            self.postMessage({
                type: 'init',
                status: 'error',
                error: `Initialization failed: ${errorMessage}`
            });
        }
    }

    private async warmupModel(): Promise<void> {
        if (!this.session || !this.inputName) {
            throw new Error('Session not initialized');
        }

        try {
            console.log('Starting model warmup...');

            // Create a minimal tensor with shape [1, 180, 3, 9, 9]
            // All values are normalized to be between 0 and 1
            const inputShape = [1, 3, this.MIN_FRAMES_REQUIRED - 1, 9, 9];
            const totalSize = inputShape.reduce((a, b) => a * b, 1);

            // Initialize with a constant pattern that makes sense for RGB values
            const inputData = new Float32Array(totalSize);
            for (let i = 0; i < totalSize; i++) {
                // Generate values that would be typical for normalized RGB (0-1)
                inputData[i] = 0.5; // mid-range value
            }

            // Create tensor with contiguous memory layout
            const inputTensor = new ort.Tensor('float32', inputData, inputShape);

            console.log('Created warmup tensor:', {
                dims: inputTensor.dims,
                type: inputTensor.type,
                size: inputTensor.data.length,
                dataType: inputTensor.data.constructor.name
            });

            // Create feeds object with input name from model
            const feeds: Record<string, ort.Tensor> = {};
            feeds[this.inputName] = inputTensor;

            // Run inference with simple error handling
            console.log('Running warmup inference...');
            const results = await this.session.run(feeds);

            // Basic validation of outputs
            if (!results.rPPG || !results.rRSP) {
                throw new Error('Missing expected outputs from model');
            }

            console.log('Warmup inference completed successfully');
            console.log('Output shapes:', {
                rPPG: results.rPPG.dims,
                rRSP: results.rRSP.dims
            });
        } catch (error) {
            console.error('Model warmup error:', error);
            throw error;
        }
    }

    private preprocessFrames(frameBuffer: ImageData[]): ort.Tensor {
        if (frameBuffer.length < this.MIN_FRAMES_REQUIRED) {
            throw new Error(`Insufficient frames. Need ${this.MIN_FRAMES_REQUIRED}, got ${frameBuffer.length}`);
        }

        // Get the last 181 frames
        const frames = frameBuffer.slice(-this.MIN_FRAMES_REQUIRED);
        const diffFrames = frames.slice(1).map((frame, i) => {
            const prevFrame = frames[i];
            const diffData = new Uint8ClampedArray(frame.data.length);
            for (let i = 0; i < frame.data.length; i++) {
                diffData[i] = frame.data[i] - prevFrame.data[i];
            }
            return new ImageData(diffData, frame.width, frame.height);
        });

        // Create tensor with shape [1, 3, 181, 9, 9]
        const shape = [1, 3, this.MIN_FRAMES_REQUIRED -1, 9, 9];
        const totalSize = shape.reduce((a, b) => a * b, 1);
        const data = new Float32Array(totalSize);

        // Fill tensor with normalized frame data
        // Loop order matches tensor memory layout: CHW format
        for (let c = 0; c < 3; c++) {
            for (let f = 0; f < this.MIN_FRAMES_REQUIRED - 1; f++) {
                for (let h = 0; h < 9; h++) {
                    for (let w = 0; w < 9; w++) {
                        const frameOffset = f;
                        const channelOffset = c * ((this.MIN_FRAMES_REQUIRED-1) * 9 * 9);
                        const pixelOffset = (h * 9 + w);
                        const tensorIdx = channelOffset + (frameOffset * 9 * 9) + pixelOffset;

                        // Get pixel data from the frame
                        const frame = diffFrames[f];
                        const pixelIdx = (h * 9 + w) * 4;
                        data[tensorIdx] = frame.data[pixelIdx + c] / 255.0;
                    }
                }
            }
        }

        return new ort.Tensor('float32', data, shape);
    }

    async runInference(frameBuffer: ImageData[]): Promise<InferenceResult> {
        if (!this.isInitialized || !this.session || !this.inputName) {
            throw new Error('Model not initialized');
        }

        try {
            const startTime = performance.now();

            // Create input tensor
            const inputTensor = this.preprocessFrames(frameBuffer);

            // Run inference
            const feeds: Record<string, ort.Tensor> = {};
            feeds[this.inputName] = inputTensor;

            const results = await this.session.run(feeds);

            // Process results
            const bvpSignal = Array.from(results.rPPG.data as Float32Array);
            const respSignal = Array.from(results.rRSP.data as Float32Array);

            // Calculate rates
            const heartRate = SignalAnalyzer.calculateRate(bvpSignal, 30, 'heart');
            const respRate = SignalAnalyzer.calculateRate(respSignal, 30, 'resp');

            return {
                bvp: bvpSignal,
                resp: respSignal,
                heartRate,
                respRate,
                inferenceTime: performance.now() - startTime
            };
        } catch (error) {
            console.error('Inference error:', error);
            throw new Error(`Inference failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

// Initialize worker instance
const worker = new InferenceWorker();

// Handle messages
self.onmessage = async (e: MessageEvent) => {
    try {
        switch (e.data.type) {
            case 'init':
                await worker.initialize();
                break;

            case 'inference':
                if (!e.data.frameBuffer) {
                    throw new Error('No frame buffer provided');
                }

                const results = await worker.runInference(e.data.frameBuffer);
                self.postMessage({
                    type: 'inference',
                    status: 'success',
                    results
                });
                break;

            default:
                throw new Error(`Unknown message type: ${e.data.type}`);
        }
    } catch (error) {
        self.postMessage({
            type: e.data.type,
            status: 'error',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};