// src/workers/inferenceWorker.ts
/// <reference lib="webworker" />

import * as ort from 'onnxruntime-web';
import { SignalProcessor } from '../utils/signalProcessor';
import {
    SignalBuffers,
    PerformanceMetrics,
    SignalMetrics,
    WorkerMessage,
    ExportData
} from '../types';

interface ModelConfig {
    sampling_rate: number;
    input_size: number[];
    output_names: string[];
}

interface InferenceResult {
    bvp: {
        raw: number[];
        filtered: number[];
        metrics: SignalMetrics;
    };
    resp: {
        raw: number[];
        filtered: number[];
        metrics: SignalMetrics;
    };
    timestamp: string;
    performanceMetrics: PerformanceMetrics;
}

class InferenceWorker {
    private session: ort.InferenceSession | null = null;
    private signalProcessor: SignalProcessor | null = null;
    private isInitialized = false;
    private inputName: string = '';
    private readonly MIN_FRAMES_REQUIRED = 181; // 6 seconds at 30 FPS +1 frame for Diff
    private fps: number = 30;
    private modelConfig: ModelConfig | null = null;

    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        try {
            // Configure environment
            await this.configureOrtEnvironment();

            // Load model configuration and create session
            await this.loadModelConfig();
            await this.createSession();

            // Initialize signal processor with detected FPS
            this.signalProcessor = new SignalProcessor(this.fps);

            // Warm up model and processor
            await this.warmup();

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

    private async configureOrtEnvironment(): Promise<void> {
        try {
            ort.env.wasm.wasmPaths = {
                'ort-wasm.wasm': '/ort/ort-wasm.wasm',
                'ort-wasm-simd.wasm': '/ort/ort-wasm-simd.wasm',
                'ort-wasm-threaded.wasm': '/ort/ort-wasm-threaded.wasm',
                'ort-wasm-simd-threaded.wasm': '/ort/ort-wasm-simd-threaded.wasm'
            };

            ort.env.wasm.numThreads = 1;
            ort.env.wasm.simd = true;

            console.log('ONNX Runtime environment configured');
        } catch (error) {
            console.error('Failed to configure ONNX Runtime:', error);
            throw error;
        }
    }

    private async loadModelConfig(): Promise<void> {
        console.log('Loading model configuration...');
        const configResponse = await fetch('/models/rphys/config.json');
        if (!configResponse.ok) throw new Error('Failed to fetch model config');

        const config = await configResponse.json();

        // Validate config structure
        if (!this.isValidModelConfig(config)) {
            throw new Error('Invalid model configuration format');
        }

        this.modelConfig = config;

        // Update FPS if specified in config
        if (this.modelConfig.sampling_rate) {
            this.fps = this.modelConfig.sampling_rate;
        }

        console.log('Model configuration loaded:', this.modelConfig);
    }

    // Type guard for ModelConfig
    private isValidModelConfig(config: any): config is ModelConfig {
        return (
            typeof config === 'object' &&
            config !== null &&
            typeof config.sampling_rate === 'number' &&
            Array.isArray(config.input_size) &&
            Array.isArray(config.output_names)
        );
    }

    private async createSession(): Promise<void> {
        console.log('Loading ONNX model...');
        const modelResponse = await fetch('/models/rphys/SCAMPS_Multi_9x9.onnx');
        if (!modelResponse.ok) throw new Error('Failed to fetch model');

        const modelArrayBuffer = await modelResponse.arrayBuffer();
        const modelData = new Uint8Array(modelArrayBuffer);
        console.log('Model loaded, size:', modelData.byteLength);

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
    }

    private async warmup(): Promise<void> {
        if (!this.session || !this.signalProcessor) return;

        try {
            console.log('Starting model warmup...');

            // Create dummy input data
            const dummyFrames = Array(this.MIN_FRAMES_REQUIRED).fill(null).map(() => {
                const imageData = new ImageData(9, 9);
                for (let i = 0; i < imageData.data.length; i += 4) {
                    const value = Math.floor(Math.random() * 255);
                    imageData.data[i] = value;     // R
                    imageData.data[i + 1] = value; // G
                    imageData.data[i + 2] = value; // B
                    imageData.data[i + 3] = 255;   // A
                }
                return imageData;
            });

            // Run warmup inference
            await this.processFrames(dummyFrames);
            console.log('Warmup completed successfully');
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

        // Create tensor with shape [1, 3, 181, 9, 9]
        const shape = [1, 3, this.MIN_FRAMES_REQUIRED, 9, 9];
        const data = new Float32Array(shape.reduce((a, b) => a * b));

        // Fill tensor with normalized frame data
        // Loop order matches tensor memory layout: CHW format
        for (let c = 0; c < 3; c++) {
            for (let f = 0; f < this.MIN_FRAMES_REQUIRED; f++) {
                for (let h = 0; h < 9; h++) {
                    for (let w = 0; w < 9; w++) {
                        const tensorIdx = c * (this.MIN_FRAMES_REQUIRED * 9 * 9) +
                            f * (9 * 9) +
                            h * 9 + w;
                        const frame = frames[f];
                        const pixelIdx = (h * 9 + w) * 4;
                        data[tensorIdx] = frame.data[pixelIdx + c] / 255.0;
                    }
                }
            }
        }

        return new ort.Tensor('float32', data, shape);
    }

    private async processFrames(frameBuffer: ImageData[]): Promise<SignalBuffers | null> {
        if (!this.session || !this.signalProcessor) {
            throw new Error('Worker not initialized');
        }

        // Prepare input tensor
        const inputTensor = this.preprocessFrames(frameBuffer);
        const feeds = { [this.inputName]: inputTensor };

        // Run inference
        const results = await this.session.run(feeds);
        const timestamp = new Date().toISOString();

        if (!results.rPPG || !results.rRSP) {
            throw new Error('Invalid model output');
        }

        // Convert to arrays
        const bvpSignal = Array.from(results.rPPG.data as Float32Array);
        const respSignal = Array.from(results.rRSP.data as Float32Array);

        // Process signals
        const processedSignals = this.signalProcessor.processNewSignals(bvpSignal, respSignal, timestamp);

        return {
            bvp: {
                raw: processedSignals.displayData.bvp,
                filtered: [], // You might want to add filtered data from processedSignals
                metrics: processedSignals.bvp
            },
            resp: {
                raw: processedSignals.displayData.resp,
                filtered: [], // You might want to add filtered data from processedSignals
                metrics: processedSignals.resp
            },
            timestamp
        };
    }

    async runInference(frameBuffer: ImageData[]): Promise<void> {
        if (!this.isInitialized) {
            throw new Error('Worker not initialized');
        }

        try {
            const processingStart = performance.now();

            // Process frames and get signals
            const processedSignals = await this.processFrames(frameBuffer);

            if (processedSignals) {
                // Manually construct performance metrics if method doesn't exist
                const performanceMetrics: PerformanceMetrics = {
                    averageUpdateTime: performance.now() - processingStart,
                    updateCount: 1,
                    bufferUtilization: 0
                };

                // Convert ProcessedSignals to InferenceResult
                const inferenceResult: InferenceResult = {
                    bvp: {
                        raw: processedSignals.bvp.raw,
                        filtered: processedSignals.bvp.filtered,
                        metrics: processedSignals.bvp.metrics
                    },
                    resp: {
                        raw: processedSignals.resp.raw,
                        filtered: processedSignals.resp.filtered,
                        metrics: processedSignals.resp.metrics
                    },
                    timestamp: processedSignals.timestamp,
                    performanceMetrics
                };

                // Send results to main thread
                const message: WorkerMessage = {
                    type: 'inference',
                    status: 'success',
                    results: inferenceResult
                };

                self.postMessage(message);
            }
        } catch (error) {
            const errorMessage: WorkerMessage = {
                type: 'inference',
                status: 'error',
                error: error instanceof Error ? error.message : String(error)
            };
            self.postMessage(errorMessage);
        }
    }

    async exportData(): Promise<void> {
        if (!this.signalProcessor) {
            throw new Error('Signal processor not initialized');
        }

        try {
            // Use a more robust export method
            const exportedData = JSON.stringify(
                this.signalProcessor.getExportData(),
                null,
                2 // Pretty print
            );

            self.postMessage({
                type: 'export',
                status: 'success',
                data: exportedData // Ensure string export
            });
        } catch (error) {
            console.error('Export error:', error);
            self.postMessage({
                type: 'export',
                status: 'error',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    reset(): void {
        if (this.signalProcessor) {
            this.signalProcessor.reset();
        }
    }

    async dispose(): Promise<void> {
        try {
            if (this.session) {
                await this.session.release();
                this.session = null;
            }
            this.signalProcessor = null;
            this.isInitialized = false;
            console.log('Worker resources released successfully');
        } catch (error) {
            console.error('Error disposing worker resources:', error);
            throw error;
        }
    }
}

// Create worker instance
const worker = new InferenceWorker();

// Message handler
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
                await worker.runInference(e.data.frameBuffer);
                break;

            case 'export':
                await worker.exportData();
                break;

            case 'reset':
                worker.reset();
                self.postMessage({ type: 'reset', status: 'success' });
                break;

            case 'dispose':
                await worker.dispose();
                self.postMessage({ type: 'dispose', status: 'success' });
                break;

            default:
                throw new Error(`Unknown message type: ${e.data.type}`);
        }
    } catch (error) {
        console.error('Worker error:', error);
        self.postMessage({
            type: e.data.type,
            status: 'error',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

// Error handling with proper type checking
self.addEventListener('error', (event: ErrorEvent) => {
    console.error('Worker error:', event);
    self.postMessage({
        type: 'error',
        status: 'error',
        error: event.message || 'Unknown error occurred'
    });
});

// Unhandled rejection handling with proper type checking
self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    console.error('Unhandled rejection in worker:', event.reason);
    self.postMessage({
        type: 'error',
        status: 'error',
        error: event.reason instanceof Error ? event.reason.message : String(event.reason)
    });
});

// Export empty object to satisfy TypeScript module requirements
export { };