import { InferenceResult } from '../utils/modelInference';

interface WorkerMessage {
    type: string;
    data?: {
        frameBuffer: ImageData[];
    };
}

interface WorkerResponse {
    type: string;
    status: 'success' | 'error';
    results?: InferenceResult;
    error?: string;
    performanceStats?: PerformanceStats;
}

interface PerformanceStats {
    totalInferences: number;
    averageProcessingTime: number;
    lastProcessingTime: number;
    errorCount: number;
}

class InferenceWorker {
    private model: any = null;
    private isProcessing: boolean = false;
    private processingQueue: Array<{
        frameBuffer: ImageData[];
        timestamp: number;
    }> = [];
    private performanceStats: PerformanceStats = {
        totalInferences: 0,
        averageProcessingTime: 0,
        lastProcessingTime: 0,
        errorCount: 0
    };

    constructor() {
        this.initializeAsync();
    }

    private async initializeAsync(): Promise<void> {
        try {
            console.log('Initializing inference worker...');

            // Import dependencies dynamically to ensure proper initialization
            const [ort, { VitalSignsModel }] = await Promise.all([
                import('onnxruntime-web'),
                import('../utils/modelInference')
            ]);

            // Configure ONNX Runtime environment
            await this.configureOrtEnvironment(ort);

            // Initialize the model
            this.model = new VitalSignsModel();
            await this.model.initialize();

            this.sendMessage('init', 'success');
            console.log('Inference worker initialized successfully');
        } catch (error) {
            console.error('Inference worker initialization error:', error);
            this.handleError('init', error);
        }
    }


    private async configureOrtEnvironment(ort: typeof import('onnxruntime-web')): Promise<void> {
        try {
            // Initialize ONNX Runtime environment
            if (!ort.env) {
                throw new Error('ONNX Runtime environment not available');
            }

            // Configure WASM paths
            const wasmPaths = {
                'ort-wasm.wasm': '/ort/ort-wasm.wasm',
                'ort-wasm-simd.wasm': '/ort/ort-wasm-simd.wasm',
                'ort-wasm-threaded.wasm': '/ort/ort-wasm-threaded.wasm',
                'ort-wasm-simd-threaded.wasm': '/ort/ort-wasm-simd-threaded.wasm'
            };

            // Set WASM paths
            ort.env.wasm.wasmPaths = wasmPaths;

            // Configure threading and SIMD
            ort.env.wasm.numThreads = 1;
            ort.env.wasm.simd = true;

            // Optionally set proxy configuration if needed
            ort.env.wasm.proxy = false;

            console.log('ONNX Runtime environment configured successfully');
        } catch (error) {
            console.error('Failed to configure ONNX Runtime environment:', error);
            throw error;
        }
    }

    private sendMessage(type: string, status: 'success' | 'error', data?: any, error?: Error): void {
        const message: WorkerResponse = {
            type,
            status,
            performanceStats: this.performanceStats
        };

        if (data) message.results = data;
        if (error) message.error = error.message;

        self.postMessage(message);
    }

    private handleError(type: string, error: unknown): void {
        console.error(`Worker error (${type}):`, error);
        this.performanceStats.errorCount++;
        this.sendMessage(
            type,
            'error',
            null,
            error instanceof Error ? error : new Error(String(error))
        );
    }

    private async processInference(frameBuffer: ImageData[]): Promise<InferenceResult> {
        if (!this.model) {
            throw new Error('Model not initialized');
        }

        if (!frameBuffer || frameBuffer.length < 90) {
            throw new Error('Insufficient frames for inference');
        }

        const startTime = performance.now();

        try {
            const results = await this.model.inference(frameBuffer);
            this.updatePerformanceStats(performance.now() - startTime);
            return results;
        } catch (error) {
            this.performanceStats.errorCount++;
            throw error;
        }
    }

    private updatePerformanceStats(processingTime: number): void {
        this.performanceStats.totalInferences++;
        this.performanceStats.lastProcessingTime = processingTime;
        this.performanceStats.averageProcessingTime =
            (this.performanceStats.averageProcessingTime *
                (this.performanceStats.totalInferences - 1) +
                processingTime) / this.performanceStats.totalInferences;
    }

    private async processQueue(): Promise<void> {
        if (this.processingQueue.length === 0 || this.isProcessing) {
            return;
        }

        this.isProcessing = true;
        const { frameBuffer, timestamp } = this.processingQueue.shift()!;

        try {
            const results = await this.processInference(frameBuffer);

            if (Date.now() - timestamp <= 2000) {
                this.sendMessage('inference', 'success', results);
            }
        } catch (error) {
            this.handleError('inference', error);
        } finally {
            this.isProcessing = false;
            if (this.processingQueue.length > 0) {
                setTimeout(() => this.processQueue(), 0);
            }
        }
    }

    public handleMessage(e: MessageEvent<WorkerMessage>): void {
        const { type, data } = e.data;

        switch (type) {
            case 'inference':
                if (data?.frameBuffer) {
                    this.processingQueue.push({
                        frameBuffer: data.frameBuffer,
                        timestamp: Date.now()
                    });
                    this.processQueue();
                }
                break;

            case 'getStats':
                this.sendMessage('stats', 'success', this.performanceStats);
                break;

            case 'reset':
                this.processingQueue = [];
                this.isProcessing = false;
                this.performanceStats = {
                    totalInferences: 0,
                    averageProcessingTime: 0,
                    lastProcessingTime: 0,
                    errorCount: 0
                };
                this.sendMessage('reset', 'success');
                break;
        }
    }
}

// Initialize worker
const worker = new InferenceWorker();

// Handle messages from main thread
self.onmessage = (e: MessageEvent<WorkerMessage>) => {
    worker.handleMessage(e);
};