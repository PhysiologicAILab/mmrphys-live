/// <reference lib="webworker" />

import * as ort from 'onnxruntime-web';
import type { InferenceResult } from '../utils/modelInference';
import { SignalAnalyzer } from '../utils/signalAnalysis';

declare const self: DedicatedWorkerGlobalScope;

interface WorkerMessage {
    type: 'init' | 'inference' | 'reset' | 'getStats';
    data?: {
        frameBuffer: ImageData[];
    };
}

interface WorkerResponse {
    type: string;
    status: 'success' | 'error';
    results?: InferenceResult;
    error?: string;
}

class InferenceWorker {
    private session: ort.InferenceSession | null = null;
    private isInitialized = false;
    private inputName: string = '';

    private async configureOrtEnvironment(): Promise<void> {
        try {
            // Ensure fetch is available in the worker context
            const fetchFn = typeof self.fetch === 'function'
                ? self.fetch
                : (typeof fetch === 'function'
                    ? fetch
                    : null);

            if (!fetchFn) {
                throw new Error('Fetch is not available in this context');
            }

            // Configure WASM paths and flags
            ort.env.wasm.wasmPaths = {
                'ort-wasm.wasm': '/ort/ort-wasm.wasm',
                'ort-wasm-simd.wasm': '/ort/ort-wasm-simd.wasm',
                'ort-wasm-threaded.wasm': '/ort/ort-wasm-threaded.wasm',
                'ort-wasm-simd-threaded.wasm': '/ort/ort-wasm-simd-threaded.wasm'
            };

            // Configure WASM settings
            ort.env.wasm.numThreads = 1;
            ort.env.wasm.simd = true;

            console.log('ONNX Runtime WASM environment configured');
        } catch (error) {
            console.error('Failed to configure ONNX Runtime environment:', error);
            throw error;
        }
    }


    private async initialize(): Promise<void> {
        if (this.isInitialized) return;

        try {
            // Configure environment first
            await this.configureOrtEnvironment();

            // Load model configuration
            const configResponse = await fetch('/models/rphys/config.json');
            if (!configResponse.ok) {
                throw new Error('Failed to load model configuration');
            }
            const config = await configResponse.json();

            // Load the model
            console.log('Loading ONNX model...');
            const modelPath = '/models/rphys/SCAMPS_Multi_9x9.onnx';
            const response = await fetch(modelPath);
            if (!response.ok) {
                throw new Error(`Failed to fetch model: ${response.statusText}`);
            }
            const arrayBuffer = await response.arrayBuffer();

            // Create session with explicit options
            console.log('Creating ONNX session...');
            this.session = await ort.InferenceSession.create(arrayBuffer, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all',
                executionMode: 'sequential',
                enableCpuMemArena: true,
                enableMemPattern: true,
            });

            // Store input name
            this.inputName = this.session.inputNames[0];
            console.log('Model input names:', this.session.inputNames);

            // Test the input dimensions with dummy data
            const dummyInputs = {
                [this.inputName]: new ort.Tensor(
                    'float32',
                    new Float32Array(1 * 3 * 3 * 9 * 9),
                    [1, 3, 3, 9, 9]
                )
            };

            try {
                await this.session.run(dummyInputs);
                console.log('Input dimensions validated:', [1, 3, 3, 9, 9]);
            } catch (error) {
                console.error('Input dimension validation failed:', error);
                throw error;
            }

            // Warm up the model
            await this.warmupModel();

            this.isInitialized = true;
            console.log('ONNX session created successfully');
        } catch (error) {
            console.error('Model initialization error:', error);
            throw error;
        }
    }

    private async warmupModel(): Promise<void> {
        if (!this.session || !this.inputName) {
            throw new Error('Session not properly initialized');
        }

        try {
            // Create a small dummy input matching the expected dimensions
            // [batch_size, sequence_length, channels, height, width]
            const dummyInput = new Float32Array(1 * 3 * 3 * 9 * 9).fill(0);
            const tensorDims = [1, 3, 3, 9, 9];
            const input = new ort.Tensor('float32', dummyInput, tensorDims);
            const feeds: Record<string, ort.Tensor> = {};
            feeds[this.inputName] = input;

            await this.session.run(feeds);
            console.log('Model warmup completed successfully');
        } catch (error) {
            console.error('Model warmup failed:', error);
            throw error;
        }
    }

    private preprocessFrames(frameBuffer: ImageData[]): Float32Array {
        const batchSize = 1;
        const sequenceLength = frameBuffer.length;
        const channels = 3;
        const height = 9;
        const width = 9;

        const inputTensor = new Float32Array(
            batchSize * sequenceLength * channels * height * width
        );

        frameBuffer.forEach((frame, frameIdx) => {
            for (let c = 0; c < channels; c++) {
                for (let h = 0; h < height; h++) {
                    for (let w = 0; w < width; w++) {
                        const pixelIdx = (h * width + w) * 4;
                        const tensorIdx =
                            frameIdx * (channels * height * width) +
                            c * (height * width) +
                            h * width +
                            w;
                        inputTensor[tensorIdx] = frame.data[pixelIdx + c] / 255.0;
                    }
                }
            }
        });

        return inputTensor;
    }

    private async runInference(frameBuffer: ImageData[]): Promise<InferenceResult> {
        if (!this.session || !this.inputName || !this.isInitialized) {
            throw new Error('Worker not properly initialized');
        }

        try {
            const inputTensor = this.preprocessFrames(frameBuffer);
            const tensorDims = [1, frameBuffer.length, 3, 9, 9];
            const input = new ort.Tensor('float32', inputTensor, tensorDims);
            const feeds: Record<string, ort.Tensor> = {};
            feeds[this.inputName] = input;

            const startTime = performance.now();
            const results = await this.session.run(feeds);
            const inferenceTime = performance.now() - startTime;

            return {
                bvp: Array.from(results['rPPG'].data as Float32Array),
                resp: Array.from(results['rRSP'].data as Float32Array),
                heartRate: this.calculateRate(Array.from(results['rPPG'].data as Float32Array), 'heart'),
                respRate: this.calculateRate(Array.from(results['rRSP'].data as Float32Array), 'resp'),
                inferenceTime
            };
        } catch (error) {
            console.error('Inference error:', error);
            throw error;
        }
    }

    private calculateRate(signal: number[], type: 'heart' | 'resp'): number {
        const SAMPLING_RATE = 30; // fps
        try {
            return SignalAnalyzer.calculateRate(signal, SAMPLING_RATE, type);
        } catch (error) {
            console.error(`Error calculating ${type} rate:`, error);
            return type === 'heart' ? 75 : 15; // Return physiological defaults
        }
    }

    public async handleMessage(e: MessageEvent<WorkerMessage>): Promise<void> {
        const { type, data } = e.data;

        try {
            switch (type) {
                case 'init':
                    await this.initialize();
                    const initResponse: WorkerResponse = {
                        type: 'init',
                        status: 'success'
                    };
                    self.postMessage(initResponse);
                    break;

                case 'inference':
                    if (!this.isInitialized) {
                        throw new Error('Worker not initialized');
                    }
                    if (!data?.frameBuffer) {
                        throw new Error('No frame buffer provided');
                    }
                    const results = await this.runInference(data.frameBuffer);
                    const inferenceResponse: WorkerResponse = {
                        type: 'inference',
                        status: 'success',
                        results
                    };
                    self.postMessage(inferenceResponse);
                    break;

                case 'reset':
                    if (this.session) {
                        await this.session.release();
                        this.session = null;
                    }
                    this.isInitialized = false;
                    await this.initialize();
                    const resetResponse: WorkerResponse = {
                        type: 'reset',
                        status: 'success'
                    };
                    self.postMessage(resetResponse);
                    break;

                default:
                    throw new Error(`Unknown message type: ${type}`);
            }
        } catch (error) {
            console.error(`Error handling message type ${type}:`, error);
            const errorResponse: WorkerResponse = {
                type,
                status: 'error',
                error: error instanceof Error ? error.message : String(error)
            };
            self.postMessage(errorResponse);
        }
    }
}

// Initialize worker instance
const worker = new InferenceWorker();

// Handle messages from main thread
self.onmessage = (e: MessageEvent<WorkerMessage>) => {
    worker.handleMessage(e).catch(error => {
        console.error('Unhandled worker error:', error);
        const errorResponse: WorkerResponse = {
            type: e.data.type,
            status: 'error',
            error: error instanceof Error ? error.message : String(error)
        };
        self.postMessage(errorResponse);
    });
};