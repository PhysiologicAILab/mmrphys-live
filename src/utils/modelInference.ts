import * as ort from 'onnxruntime-web';

export interface ModelConfig {
    sampling_rate: number;
    input_size: number[];
    output_names: string[];
    model_info: {
        name: string;
        version: string;
        description: string;
    };
    signal_parameters: {
        bvp: {
            min_rate: number;
            max_rate: number;
            buffer_size: number;
        };
        resp: {
            min_rate: number;
            max_rate: number;
            buffer_size: number;
        };
    };
}

export interface InferenceResult {
    bvp: number[];
    resp: number[];
    heartRate: number;
    respRate: number;
    inferenceTime: number;
}

export class VitalSignsModel {
    private session: ort.InferenceSession | null;
    private inputName: string;
    private config: ModelConfig | null;
    private isInitialized: boolean;
    private readonly modelOptions: ort.InferenceSession.SessionOptions;

    constructor() {
        this.session = null;
        this.inputName = '';
        this.config = null;
        this.isInitialized = false;

        // Configure ONNX Runtime session options
        this.modelOptions = {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all',
            enableCpuMemArena: true,
            enableMemPattern: true,
            executionMode: 'sequential',
            useWebGPU: false
        };
    }

    private validateConfig(config: any): config is ModelConfig {
        if (!config) return false;

        // Check required top-level fields
        if (typeof config.sampling_rate !== 'number' ||
            !Array.isArray(config.input_size) ||
            !Array.isArray(config.output_names) ||
            !config.model_info ||
            !config.signal_parameters) {
            console.error('Missing required top-level config fields');
            return false;
        }

        // Validate input_size array
        if (config.input_size.length !== 5 ||
            !config.input_size.every((dim: any) => typeof dim === 'number')) {
            console.error('Invalid input_size configuration');
            return false;
        }

        // Validate output_names
        if (!config.output_names.includes('rPPG') ||
            !config.output_names.includes('rRSP')) {
            console.error('Missing required output names');
            return false;
        }

        // Validate signal parameters
        const validateSignalParams = (params: any) => {
            return params &&
                typeof params.min_rate === 'number' &&
                typeof params.max_rate === 'number' &&
                typeof params.buffer_size === 'number';
        };

        if (!validateSignalParams(config.signal_parameters.bvp) ||
            !validateSignalParams(config.signal_parameters.resp)) {
            console.error('Invalid signal parameters configuration');
            return false;
        }

        return true;
    }

    async initialize(): Promise<void> {
        try {
            // Ensure WebAssembly support
            if (!this.checkWebAssemblySupport()) {
                throw new Error('WebAssembly is not supported in this browser');
            }

            // Initialize ONNX Runtime first
            await this.initializeOrtRuntime();

            // Then load config and model
            await this.loadConfig();
            await this.initializeSession();

            this.isInitialized = true;
        } catch (error) {
            console.error('Model initialization error:', error);
            throw new Error(`Model initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async initializeOrtRuntime(): Promise<void> {
        try {
            // Ensure ort.env is properly initialized
            if (!ort.env) {
                throw new Error('ONNX Runtime environment not available');
            }

            // Configure WASM path
            ort.env.wasm.wasmPaths = {
                'ort-wasm.wasm': '/ort/ort-wasm.wasm',
                'ort-wasm-simd.wasm': '/ort/ort-wasm-simd.wasm',
                'ort-wasm-threaded.wasm': '/ort/ort-wasm-threaded.wasm'
            };

            // Set other environment configurations
            ort.env.wasm.numThreads = 1;
            ort.env.wasm.simd = true;

            console.log('ONNX Runtime environment initialized');
        } catch (error) {
            console.error('ONNX Runtime initialization error:', error);
            throw error;
        }
    }


    private async loadConfig(): Promise<void> {
        try {
            console.log('Loading model configuration...');
            const configResponse = await fetch('/models/rphys/config.json', {
                cache: 'force-cache',
                credentials: 'same-origin'
            });

            if (!configResponse.ok) {
                throw new Error(`Config load failed: ${configResponse.statusText}`);
            }

            const configData = await configResponse.json();

            if (!this.validateConfig(configData)) {
                throw new Error('Invalid configuration format');
            }

            this.config = configData;
            console.log('Model configuration loaded successfully');
        } catch (error) {
            console.error('Config loading error:', error);
            throw new Error(`Failed to load model config: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async initializeSession(): Promise<void> {
        try {
            console.log('Loading ONNX model...');
            const modelResponse = await fetch('/models/rphys/SCAMPS_Multi_9x9.onnx', {
                cache: 'force-cache',
                credentials: 'same-origin'
            });

            if (!modelResponse.ok) {
                throw new Error(`Failed to load ONNX model: ${modelResponse.statusText}`);
            }

            const modelData = await modelResponse.arrayBuffer();

            // Create session with explicit error handling
            console.log('Creating ONNX session...');
            try {
                this.session = await ort.InferenceSession.create(
                    modelData,
                    this.modelOptions
                );
            } catch (sessionError) {
                console.error('Session creation error:', sessionError);
                throw new Error('Failed to create ONNX session');
            }

            if (!this.session) {
                throw new Error('Session creation failed');
            }

            this.inputName = this.session.inputNames[0];
            console.log('ONNX session created successfully');

            await this.warmupModel();
        } catch (error) {
            console.error('Session initialization error:', error);
            throw error;
        }
    }

    private checkWebAssemblySupport(): boolean {
        try {
            if (typeof WebAssembly === 'object' &&
                typeof WebAssembly.instantiate === 'function') {
                const module = new WebAssembly.Module(
                    new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
                );
                const instance = new WebAssembly.Instance(module, {});
                return instance instanceof WebAssembly.Instance;
            }
        } catch (error) {
            return false;
        }
        return false;
    }

    private async warmupModel(): Promise<void> {
        if (!this.session || !this.inputName) {
            throw new Error('Session not properly initialized');
        }

        const dummyInput = new Float32Array(1 * 90 * 3 * 9 * 9).fill(0);
        const tensorDims = [1, 90, 3, 9, 9];
        const input = new ort.Tensor('float32', dummyInput, tensorDims);
        const feeds: Record<string, ort.Tensor> = {};
        feeds[this.inputName] = input;

        await this.session.run(feeds);
    }

    preprocessFrames(frameBuffer: ImageData[]): Float32Array {
        if (!frameBuffer || frameBuffer.length < 90) {
            throw new Error('Insufficient frames for inference');
        }

        const batchSize = 1;
        const sequenceLength = frameBuffer.length;
        const height = 9;
        const width = 9;
        const channels = 3;

        const inputTensor = new Float32Array(
            batchSize * sequenceLength * channels * height * width
        );

        try {
            frameBuffer.forEach((frame, frameIdx) => {
                if (!frame || !frame.data) {
                    throw new Error(`Invalid frame at index ${frameIdx}`);
                }

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
        } catch (error) {
            throw new Error(`Frame preprocessing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async inference(frameBuffer: ImageData[]): Promise<InferenceResult> {
        if (!this.isInitialized || !this.session || !this.inputName) {
            throw new Error('Model not initialized');
        }

        try {
            const startTime = performance.now();
            const inputTensor = this.preprocessFrames(frameBuffer);

            const tensorDims = [1, frameBuffer.length, 3, 9, 9];
            const input = new ort.Tensor('float32', inputTensor, tensorDims);

            const feeds: Record<string, ort.Tensor> = {};
            feeds[this.inputName] = input;

            const results = await this.session.run(feeds);

            const bvpSignal = Array.from(results['rPPG'].data as Float32Array);
            const respSignal = Array.from(results['rRSP'].data as Float32Array);

            const heartRate = this.calculateRate(bvpSignal, 'heart');
            const respRate = this.calculateRate(respSignal, 'resp');

            const inferenceTime = performance.now() - startTime;

            return {
                bvp: bvpSignal,
                resp: respSignal,
                heartRate,
                respRate,
                inferenceTime
            };
        } catch (error) {
            console.error('Inference error:', error);
            throw new Error(`Inference failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private calculateRate(signal: number[], type: 'heart' | 'resp'): number {
        try {
            if (!this.config) {
                throw new Error('Model configuration not loaded');
            }

            const samplingRate = this.config.sampling_rate;
            const peaks = this.findPeaks(signal);

            if (peaks.length < 2) {
                throw new Error('Insufficient peaks detected');
            }

            const intervals = this.calculateIntervals(peaks);
            const avgInterval = this.getAverageInterval(intervals);
            const rate = 60 / (avgInterval / samplingRate);

            return this.validateRate(rate, type);
        } catch (error) {
            console.warn(`Rate calculation warning: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return type === 'heart' ? 75 : 15; // Return physiologically reasonable defaults
        }
    }

    private findPeaks(signal: number[]): number[] {
        const peaks: number[] = [];
        const minPeakDistance = Math.floor((this.config?.sampling_rate ?? 30) * 0.25);

        for (let i = 1; i < signal.length - 1; i++) {
            if (signal[i] > signal[i - 1] && signal[i] > signal[i + 1]) {
                if (peaks.length === 0 || (i - peaks[peaks.length - 1]) >= minPeakDistance) {
                    peaks.push(i);
                }
            }
        }
        return peaks;
    }

    private calculateIntervals(peaks: number[]): number[] {
        return peaks.slice(1).map((peak, i) => peak - peaks[i]);
    }

    private getAverageInterval(intervals: number[]): number {
        const median = this.calculateMedian(intervals);
        const mad = this.calculateMedian(intervals.map(x => Math.abs(x - median)));

        const validIntervals = intervals.filter(x => Math.abs(x - median) < mad * 2.5);

        if (validIntervals.length === 0) {
            throw new Error('No valid intervals found after outlier removal');
        }

        return validIntervals.reduce((a, b) => a + b, 0) / validIntervals.length;
    }

    private calculateMedian(values: number[]): number {
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
    }

    private validateRate(rate: number, type: 'heart' | 'resp'): number {
        const limits = {
            heart: { min: 40, max: 180 },
            resp: { min: 8, max: 30 }
        };

        const { min, max } = limits[type];
        return Math.min(Math.max(rate, min), max);
    }

    async dispose(): Promise<void> {
        if (this.session) {
            try {
                await this.session.release();
                this.session = null;
                this.isInitialized = false;
            } catch (error) {
                console.error('Error disposing model:', error);
            }
        }
    }
}