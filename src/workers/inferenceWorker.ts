// src/workers/inferenceWorker.ts
/// <reference lib="webworker" />

import * as ort from 'onnxruntime-web';
import { ApplicationPaths, Paths } from '@/utils/paths';
import { SignalProcessor } from '../utils/signalProcessor';
import { configService, ModelConfig } from '../services/configService';

import {
    SignalBuffers,
    PerformanceMetrics,
    SignalMetrics,
    InferenceResult,
    WorkerMessage,
    ExportData
} from '../types';


// Add a global flag at the top of the file, outside the class
let isShuttingDown = false;
let globalStopRequested = false;

class InferenceWorker {
    private session: ort.InferenceSession | null = null;
    public signalProcessor: SignalProcessor | null = null;
    public isInitialized = false;
    private inputName: string = '';
    private MIN_FRAMES_REQUIRED = 181; // Will be updated from config
    private fps: number = 30;
    private modelConfig: ModelConfig | null = null;
    private frameHeight: number = 72;  // Will be updated from config
    private frameWidth: number = 72;   // Will be updated from config
    private sequenceLength: number = 181; // Will be updated from config

    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        try {
            // Configure environment
            await this.configureOrtEnvironment();

            // Initialize the signal processor
            console.log('Initializing inference worker and signal processor');
            this.signalProcessor = new SignalProcessor();

            // Load model configuration using ConfigService
            console.log('[InferenceWorker] Loading model configuration via ConfigService...');
            this.modelConfig = await configService.getConfig();

            if (!this.modelConfig) {
                throw new Error('Failed to load model configuration from ConfigService');
            }

            console.log('[InferenceWorker] Model configuration loaded:', this.modelConfig);

            // Get dimensions from config
            this.frameWidth = await configService.getFrameWidth();
            this.frameHeight = await configService.getFrameHeight();
            this.sequenceLength = await configService.getSequenceLength();
            this.MIN_FRAMES_REQUIRED = this.sequenceLength;

            console.log(`[InferenceWorker] Using dimensions: ${this.frameWidth}x${this.frameHeight}`);
            console.log(`[InferenceWorker] Using sequence length: ${this.sequenceLength}`);

            // Update sampling rate from config
            if (this.modelConfig.sampling_rate) {
                this.fps = this.modelConfig.sampling_rate;
                console.log(`[InferenceWorker] Using sampling rate: ${this.fps} FPS`);
            }

            // Create session using config values
            await this.createSession();

            // Initialize signal processor with config parameters
            this.signalProcessor = new SignalProcessor(this.fps);

            // Warm up model and processor
            await this.warmup();

            this.isInitialized = true;
            self.postMessage({ type: 'init', status: 'success' });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('[InferenceWorker] Initialization error:', errorMessage);
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
                'ort-wasm.wasm': ApplicationPaths.ortWasm('ort-wasm.wasm'),
                'ort-wasm-simd.wasm': ApplicationPaths.ortWasm('ort-wasm-simd.wasm'),
                'ort-wasm-threaded.wasm': ApplicationPaths.ortWasm('ort-wasm-threaded.wasm'),
                'ort-wasm-simd-threaded.wasm': ApplicationPaths.ortWasm('ort-wasm-simd-threaded.wasm')
            };

            ort.env.wasm.numThreads = 1;
            ort.env.wasm.simd = true;

            console.log('[InferenceWorker] ONNX Runtime environment configured');
        } catch (error) {
            console.error('[InferenceWorker] Failed to configure ONNX Runtime:', error);
            throw error;
        }
    }

    private async createSession(): Promise<void> {
        const modelPath = ApplicationPaths.rphysModel();
        console.log(`[InferenceWorker] Loading ONNX model from: ${modelPath}`);

        const modelResponse = await fetch(modelPath, {
            cache: 'force-cache',
            credentials: 'same-origin'
        });

        if (!modelResponse.ok) throw new Error(`Failed to fetch model: ${modelResponse.statusText}`);

        const modelArrayBuffer = await modelResponse.arrayBuffer();
        const modelData = new Uint8Array(modelArrayBuffer);
        console.log('[InferenceWorker] Model loaded, size:', modelData.byteLength);

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
        console.log('[InferenceWorker] Session created successfully');
        console.log('[InferenceWorker] Input names:', this.session.inputNames);
        console.log('[InferenceWorker] Output names:', this.session.outputNames);
    }

    private async warmup(): Promise<void> {
        if (!this.session || !this.signalProcessor) return;

        try {
            console.log('[InferenceWorker] Starting model warmup...');

            // Create dummy input data with the dimensions from config
            const dummyFrames = Array(this.MIN_FRAMES_REQUIRED).fill(null).map(() => {
                const imageData = new ImageData(
                    this.frameWidth,
                    this.frameHeight
                );
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
            console.log('[InferenceWorker] Warmup completed successfully');
        } catch (error) {
            console.error('[InferenceWorker] Model warmup error:', error);
            throw error;
        }
    }

    private preprocessFrames(frameBuffer: ImageData[]): ort.Tensor {
        if (frameBuffer.length < this.MIN_FRAMES_REQUIRED) {
            throw new Error(`Insufficient frames. Need ${this.MIN_FRAMES_REQUIRED}, got ${frameBuffer.length}`);
        }

        // Get the last N frames as configured
        const frames = frameBuffer.slice(-this.MIN_FRAMES_REQUIRED);

        // Check input dimensions and log warnings
        const firstFrame = frames[0];
        if (firstFrame.width !== this.frameWidth || firstFrame.height !== this.frameHeight) {
            console.warn(`[InferenceWorker] Input frame dimensions mismatch: got ${firstFrame.width}x${firstFrame.height}, expected ${this.frameWidth}x${this.frameHeight}`);
            throw new Error(`Frame dimensions mismatch: got ${firstFrame.width}x${firstFrame.height}, expected ${this.frameWidth}x${this.frameHeight}`);
        }

        // Create tensor with shape [1, 3, sequence_length, height, width] - order from config
        const shape = [1, 3, this.sequenceLength, this.frameHeight, this.frameWidth];
        const data = new Float32Array(shape.reduce((a, b) => a * b));

        // Process each frame - careful to match the exact tensor layout expected by the model
        for (let f = 0; f < frames.length; f++) {
            const frame = frames[f];

            // Fill tensor with normalized frame data in CHW format
            for (let c = 0; c < 3; c++) {
                for (let h = 0; h < this.frameHeight; h++) {
                    for (let w = 0; w < this.frameWidth; w++) {
                        const tensorIdx = c * (this.sequenceLength * this.frameHeight * this.frameWidth) +
                            f * (this.frameHeight * this.frameWidth) +
                            h * this.frameWidth + w;
                        const pixelIdx = (h * this.frameWidth + w) * 4;
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

        // Check if capture is still active
        if (!this.signalProcessor.isCapturing) {
            return null;
        }

        // FIX: Add validation for input frames
        if (!frameBuffer || frameBuffer.length < this.MIN_FRAMES_REQUIRED) {
            console.warn(`[InferenceWorker] Insufficient frames: ${frameBuffer?.length || 0}/${this.MIN_FRAMES_REQUIRED}`);
            return null;
        }
        try {
            // Start timing the inference process
            const inferenceStartTime = performance.now();

            // Prepare input tensor
            const inputTensor = this.preprocessFrames(frameBuffer);
            const feeds = { [this.inputName]: inputTensor };

            // Run inference
            const results = await this.session.run(feeds);
            const timestamp = new Date().toISOString();

            // Calculate inference time
            const inferenceTime = performance.now() - inferenceStartTime;

            // Update inference time in signal processor (this will log to console)
            if (this.signalProcessor) {
                this.signalProcessor.setInferenceTime(inferenceTime);
            }

            // Additional console log for more visibility
            console.log(`[InferenceWorker] Model inference completed in ${inferenceTime.toFixed(2)} ms`);

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
                    filtered: processedSignals.displayData.filteredBvp || [],
                    metrics: processedSignals.bvp
                },
                resp: {
                    raw: processedSignals.displayData.resp,
                    filtered: processedSignals.displayData.filteredResp || [],
                    metrics: processedSignals.resp
                },
                timestamp,
            };

        }
        catch (error) {
            console.error('[InferenceWorker] Frame processing error:', error);
            throw error;
        }
    }

    async runInference(frames: ImageData[]): Promise<void> {
        // Check if signal processor is initialized and capture is active
        if (!this.signalProcessor || !this.isInitialized || isShuttingDown || globalStopRequested) {
            return;
        }

        // Skip if capture is inactive
        if (!this.signalProcessor.isCapturing) {
            console.log('[InferenceWorker] Skipping inference because capture is inactive');
            return;
        }

        try {
            const processingStart = performance.now();
            console.log(`[InferenceWorker] Processing batch of ${frames.length} frames`);

            // Process frames and get signals
            const processedSignals = await this.processFrames(frames);

            // Check again before sending results
            if (!processedSignals || isShuttingDown || !this.signalProcessor.isCapturing) {
                return;
            }

            const totalTime = performance.now() - processingStart;

            // Log performance metrics
            console.log(`[InferenceWorker] Performance summary:`);
            console.log(`- Total processing: ${totalTime.toFixed(2)} ms`);

            // Send results to main thread
            self.postMessage({
                type: 'inferenceResult',
                status: 'success',
                bvp: {
                    raw: processedSignals.bvp.raw,
                    filtered: processedSignals.bvp.filtered,
                    metrics: processedSignals.bvp.metrics,
                },
                resp: {
                    raw: processedSignals.resp.raw,
                    filtered: processedSignals.resp.filtered,
                    metrics: processedSignals.resp.metrics,
                },
                timestamp: processedSignals.timestamp,
                performanceMetrics: {
                    averageUpdateTime: totalTime,
                    updateCount: 1,
                    bufferUtilization: 100,
                },
            });
        } catch (error) {
            console.error('[InferenceWorker] Inference error:', error);
            self.postMessage({
                type: 'inferenceResult',
                status: 'error',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    async exportData(): Promise<void> {
        try {
            console.log('[InferenceWorker] Preparing data for export...');

            // Make sure we have a signal processor, even if in shutdown state
            if (!this.signalProcessor) {
                throw new Error('Signal processor not initialized');
            }

            // Get export data from signal processor
            const data = this.signalProcessor.getExportData();

            // Check if we actually have data to export
            if (!data || !data.signals ||
                (!data.signals.bvp.raw.length && !data.signals.resp.raw.length)) {
                throw new Error('No data available to export');
            }

            // Convert data to JSON string
            const exportedData = JSON.stringify(data);
            console.log('[InferenceWorker] Data prepared for export, size:', exportedData.length);

            // Send to main thread - only send once
            self.postMessage({
                type: 'exportData',
                status: 'success',
                data: exportedData
            });

            console.log('[InferenceWorker] Export data sent to main thread');
        } catch (error) {
            console.error('[InferenceWorker] Export error:', error);
            self.postMessage({
                type: 'exportData',
                status: 'error',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    startCapture(): void {
        if (!this.signalProcessor) {
            throw new Error('Signal processor not initialized');
        }
        console.log('[InferenceWorker] Starting signal capture');
        this.signalProcessor.startCapture();

        // Add debug to verify capture state
        console.log('[InferenceWorker] Capture active:', this.signalProcessor.isCapturing);
    }

    // FIX: Improve stopCapture method to ensure immediate response
    stopCapture(): void {
        console.log('[InferenceWorker] STOP CAPTURE called');

        // Set global state first - these flags stop any new processing
        globalStopRequested = true;
        isShuttingDown = true;

        if (!this.signalProcessor) {
            console.log('[InferenceWorker] No signal processor to stop');
            // Still respond to main thread
            self.postMessage({
                type: 'stopCapture',
                status: 'success',
                message: 'Worker stopping activities'
            });
            return;
        }

        console.log('[InferenceWorker] Before stopping signal processor:', this.signalProcessor.isCapturing);

        // Stop the capture
        this.signalProcessor.stopCapture();

        // Force all flags to inactive state
        this.signalProcessor.isCapturing = false;
        // this.isInitialized = false;

        console.log('[InferenceWorker] After stopping signal processor:', this.signalProcessor.isCapturing);

        // Respond to main thread AFTER stopping everything
        self.postMessage({
            type: 'stopCapture',
            status: 'success',
            message: 'Worker stopping activities'
        });
    }

    reset(): void {
        console.log('[InferenceWorker] Full worker reset initiated');

        // Reset global flags first - CRITICAL
        isShuttingDown = false;
        globalStopRequested = false;

        // Reset signal processor if it exists
        if (this.signalProcessor) {
            this.signalProcessor.reset();
            // Ensure capture state is reset but initialized state is preserved
            this.signalProcessor.isCapturing = false;
        }

        // Restore initialization flag - extremely important
        this.isInitialized = true;

        console.log('[InferenceWorker] Worker reset complete, ready for new capture');

        // Immediately confirm reset to main thread
        self.postMessage({ type: 'reset', status: 'success' });
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
        // Special handling for reset - always process regardless of state
        if (e.data.type === 'reset') {
            console.log('[InferenceWorker] Resetting worker state');
            // Reset global flags
            isShuttingDown = false;
            globalStopRequested = false;
            worker.reset();
            self.postMessage({ type: 'reset', status: 'success' });
            return;
        }

        // Special handling for stopCapture - process this immediately with highest priority
        if (e.data.type === 'stopCapture') {
            console.log('[InferenceWorker] Emergency stop requested');
            worker.stopCapture();
            return;
        }

        // Handle export even in shutdown state - we want to be able to export after stopping
        if (e.data.type === 'exportData') {
            await worker.exportData();
            return;
        }

        // For all other messages, if we're shutting down, ignore them
        if (isShuttingDown || globalStopRequested) {
            console.log(`[InferenceWorker] Ignoring message of type ${e.data.type} - worker is shutting down`);
            return;
        }

        // For inference requests, check if we're supposed to be capturing
        if (e.data.type === 'inferenceResult' &&
            (!worker.signalProcessor || !worker.signalProcessor.isCapturing)) {
            console.log(`[InferenceWorker] Ignoring inference request - capture inactive`);
            return;
        }

        switch (e.data.type) {
            case 'init':
                await worker.initialize();
                break;
            case 'startCapture':
                worker.startCapture();
                self.postMessage({ type: 'startCapture', status: 'success' });
                break;
            case 'inferenceResult':
                await worker.runInference(e.data.frameBuffer);
                break;
            default:
                console.warn(`[InferenceWorker] Unknown message type: ${e.data.type}`);
                self.postMessage({
                    type: e.data.type,
                    status: 'error',
                    error: `Unknown message type: ${e.data.type}`
                });
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