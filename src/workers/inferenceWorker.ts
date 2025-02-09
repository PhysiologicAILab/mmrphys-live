/// <reference lib="webworker" />

// Do not import VitalSignsModel or other files yet
import * as ort from 'onnxruntime-web';

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
    results?: any;
    error?: string;
}

class InferenceWorker {
    private session: ort.InferenceSession | null = null;
    private isInitialized = false;

    constructor() {
        // Don't automatically initialize - wait for init message
        this.configureOrtEnvironment().catch(error => {
            console.error('ONNX environment setup error:', error);
            this.sendMessage('init', 'error', null, error);
        });
    }

    private async configureOrtEnvironment(): Promise<void> {
        try {
            // Set up WASM paths first
            ort.env.wasm.wasmPaths = {
                'ort-wasm.wasm': '/ort/ort-wasm.wasm',
                'ort-wasm-simd.wasm': '/ort/ort-wasm-simd.wasm',
                'ort-wasm-threaded.wasm': '/ort/ort-wasm-threaded.wasm',
                'ort-wasm-simd-threaded.wasm': '/ort/ort-wasm-simd-threaded.wasm'
            };

            // Configure WASM settings
            ort.env.wasm.numThreads = 1;
            ort.env.wasm.simd = true;

            // Initialize WASM - this is crucial
            await ort.env.wasm.init();

            console.log('ONNX Runtime WASM environment configured');
        } catch (error) {
            console.error('Failed to configure ONNX Runtime environment:', error);
            throw error;
        }
    }

    private async initialize(): Promise<void> {
        try {
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

            this.isInitialized = true;
            console.log('ONNX session created successfully');
        } catch (error) {
            console.error('Model initialization error:', error);
            throw error;
        }
    }

    private sendMessage(type: string, status: 'success' | 'error', data?: any, error?: Error): void {
        const message: WorkerResponse = {
            type,
            status,
            results: data,
            error: error?.message
        };
        self.postMessage(message);
    }

    public async handleMessage(e: MessageEvent<WorkerMessage>): Promise<void> {
        const { type, data } = e.data;

        try {
            switch (type) {
                case 'init':
                    if (!this.isInitialized) {
                        await this.initialize();
                    }
                    this.sendMessage('init', 'success');
                    break;

                case 'inference':
                    if (!this.isInitialized || !this.session) {
                        throw new Error('Worker not initialized');
                    }
                    if (!data?.frameBuffer) {
                        throw new Error('No frame buffer provided');
                    }

                    // Add your inference logic here
                    this.sendMessage('inference', 'success', {});
                    break;

                case 'reset':
                    if (this.session) {
                        await this.session.release();
                        this.session = null;
                    }
                    this.isInitialized = false;
                    await this.initialize();
                    this.sendMessage('reset', 'success');
                    break;

                default:
                    console.warn('Unknown message type:', type);
                    break;
            }
        } catch (error) {
            console.error(`Error handling message type ${type}:`, error);
            this.sendMessage(
                type,
                'error',
                null,
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }
}

// Initialize worker instance
const worker = new InferenceWorker();

// Handle messages from main thread
self.onmessage = (e: MessageEvent<WorkerMessage>) => {
    worker.handleMessage(e);
};

// Handle unhandled rejections
self.onunhandledrejection = (event: PromiseRejectionEvent) => {
    console.error('Unhandled rejection in worker:', event.reason);
    worker.handleMessage({
        data: {
            type: 'init'
        }
    } as any);
};