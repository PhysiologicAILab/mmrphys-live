// src/utils/signalProcessor.ts

import { ButterworthFilter } from './butterworthFilter';
import { SignalAnalyzer, SignalMetrics } from './signalAnalysis';
import { ModelConfig } from './modelInference';

export interface SignalState {
    raw: number[];
    filtered: number[];
    metrics: SignalMetrics;
}

export interface ProcessedSignals {
    bvp: SignalState;
    resp: SignalState;
    timestamp: string;
}

export interface SignalData {
    raw: Float32Array;
    filtered: Float32Array;
    snr: number;
}

export interface RateData {
    timestamp: string;
    value: number;
    snr: number;
    quality: 'excellent' | 'good' | 'moderate' | 'poor';
}

export interface SignalBuffers {
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
}

export interface PerformanceMetrics {
    averageUpdateTime: number;
    updateCount: number;
    bufferUtilization: number;
}

export interface ExportData {
    metadata: {
        samplingRate: number;
        startTime: string;
        endTime: string;
        totalSamples: number;
    };
    signals: {
        bvp: {
            raw: number[];
            filtered: number[];
        };
        resp: {
            raw: number[];
            filtered: number[];
        };
    };
    rates: {
        heart: RateData[];
        respiratory: RateData[];
    };
    timestamps: string[];
    performance: PerformanceMetrics;
}

export class SignalProcessor {
    private readonly fps: number;
    private readonly SIGNAL_LENGTH = 180; // rPhys model output length
    private readonly MAX_HISTORY_SECONDS = 30;
    private readonly DISPLAY_SECONDS = 6;
    private readonly maxSignalBufferSize: number;
    private readonly maxRateBufferSize: number;

    // Signal buffers
    private bvpBuffer: SignalData;
    private respBuffer: SignalData;
    private timestamps: string[] = [];

    // Filters
    private readonly bvpFilter: ButterworthFilter;
    private readonly respFilter: ButterworthFilter;

    // Rate history
    private heartRates: RateData[] = [];
    private respRates: RateData[] = [];

    // Performance metrics
    private lastUpdateTime: number;
    private updateCount: number;
    private averageUpdateTime: number;
    private config: ModelConfig | null;

    constructor(fps: number = 30) {
        this.fps = fps;
        this.maxSignalBufferSize = fps * this.MAX_HISTORY_SECONDS;
        this.maxRateBufferSize = 300; // Store up to 5 minutes of rate values

        // Initialize Butterworth filters
        this.bvpFilter = new ButterworthFilter(
            ButterworthFilter.designBandpass(0.8, 3.0, fps)
        );
        this.respFilter = new ButterworthFilter(
            ButterworthFilter.designBandpass(0.1, 0.5, fps)
        );

        // Initialize buffer with Float32Arrays
        this.bvpBuffer = {
            raw: new Float32Array(this.maxSignalBufferSize),
            filtered: new Float32Array(this.maxSignalBufferSize),
            snr: 0
        };

        this.respBuffer = {
            raw: new Float32Array(this.maxSignalBufferSize),
            filtered: new Float32Array(this.maxSignalBufferSize),
            snr: 0
        };

        // Initialize performance metrics
        this.lastUpdateTime = Date.now();
        this.updateCount = 0;
        this.averageUpdateTime = 0;
        this.config = null;
    }

    setConfig(config: ModelConfig): void {
        this.config = config;
    }

    /**
     * Process new signals from rPhys model
     */
    processNewSignals(bvpSignal: number[], respSignal: number[], timestamp: string): ProcessedSignals {
        if (bvpSignal.length !== this.SIGNAL_LENGTH || respSignal.length !== this.SIGNAL_LENGTH) {
            throw new Error('Invalid signal length');
        }

        const startTime = performance.now();

        try {
            // Update main buffers
            this.updateBuffers(bvpSignal, respSignal, timestamp);

            // Process signals for rate calculation
            const bvpMetrics = this.processSignalForRates(
                Array.from(this.bvpBuffer.raw.slice(-this.maxSignalBufferSize)),
                'heart'
            );
            const respMetrics = this.processSignalForRates(
                Array.from(this.respBuffer.raw.slice(-this.maxSignalBufferSize)),
                'resp'
            );

            // Update rate history with quality assessment
            this.updateRateHistory(bvpMetrics, respMetrics, timestamp);

            // Update performance metrics
            this.updatePerformanceMetrics(startTime);

            // Prepare and return display data
            return this.prepareDisplayData(timestamp);
        } catch (error) {
            console.error('Signal processing error:', error);
            throw new Error(`Signal processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private updateBuffers(bvpSignal: number[], respSignal: number[], timestamp: string): void {
        // Convert new signals to Float32Array
        const bvpNew = new Float32Array(bvpSignal);
        const respNew = new Float32Array(respSignal);

        // Shift existing data and add new data
        this.bvpBuffer.raw.set(
            new Float32Array([...Array.from(this.bvpBuffer.raw.slice(bvpNew.length)), ...bvpNew])
        );
        this.respBuffer.raw.set(
            new Float32Array([...Array.from(this.respBuffer.raw.slice(respNew.length)), ...respNew])
        );

        // Update filtered signals
        this.bvpBuffer.filtered = new Float32Array(
            this.bvpFilter.processSignal(Array.from(this.bvpBuffer.raw))
        );
        this.respBuffer.filtered = new Float32Array(
            this.respFilter.processSignal(Array.from(this.respBuffer.raw))
        );

        // Update timestamps
        this.timestamps.push(timestamp);
        if (this.timestamps.length > this.maxSignalBufferSize) {
            this.timestamps = this.timestamps.slice(-this.maxSignalBufferSize);
        }
    }

    private processSignalForRates(signal: number[], type: 'heart' | 'resp'): SignalMetrics {
        // Get analysis window (up to 30 seconds)
        const windowSize = Math.min(this.MAX_HISTORY_SECONDS * this.fps, signal.length);
        const analysisWindow = signal.slice(-windowSize);

        // Apply bandpass filter
        const filter = type === 'heart' ? this.bvpFilter : this.respFilter;
        const filteredSignal = filter.processSignal(analysisWindow);

        // Analyze signal
        return SignalAnalyzer.analyzeSignal(filteredSignal, this.fps, type);
    }

    private updateRateHistory(
        bvpMetrics: SignalMetrics,
        respMetrics: SignalMetrics,
        timestamp: string
    ): void {
        // Update heart rate history
        this.heartRates.push({
            timestamp,
            value: bvpMetrics.rate,
            snr: bvpMetrics.quality.snr,
            quality: bvpMetrics.quality.quality
        });

        // Update respiratory rate history
        this.respRates.push({
            timestamp,
            value: respMetrics.rate,
            snr: respMetrics.quality.snr,
            quality: respMetrics.quality.quality
        });

        // Maintain history length
        if (this.heartRates.length > this.maxRateBufferSize) {
            this.heartRates = this.heartRates.slice(-this.maxRateBufferSize);
            this.respRates = this.respRates.slice(-this.maxRateBufferSize);
        }
    }

    private prepareDisplayData(timestamp: string): ProcessedSignals {
        // Get display window samples
        const displaySamples = this.DISPLAY_SECONDS * this.fps;

        // Get recent data for display
        const recentBvp = Array.from(this.bvpBuffer.raw.slice(-displaySamples));
        const recentResp = Array.from(this.respBuffer.raw.slice(-displaySamples));

        // Get filtered signals
        const filteredBvp = Array.from(this.bvpBuffer.filtered.slice(-displaySamples));
        const filteredResp = Array.from(this.respBuffer.filtered.slice(-displaySamples));

        // Get latest metrics
        const latestBvp = this.heartRates[this.heartRates.length - 1];
        const latestResp = this.respRates[this.respRates.length - 1];

        return {
            bvp: {
                raw: recentBvp,
                filtered: filteredBvp,
                metrics: {
                    rate: latestBvp.value,
                    quality: {
                        snr: latestBvp.snr,
                        quality: latestBvp.quality,
                        signalStrength: Math.max(...recentBvp.map(Math.abs)),
                        artifactRatio: this.calculateArtifactRatio(recentBvp)
                    }
                }
            },
            resp: {
                raw: recentResp,
                filtered: filteredResp,
                metrics: {
                    rate: latestResp.value,
                    quality: {
                        snr: latestResp.snr,
                        quality: latestResp.quality,
                        signalStrength: Math.max(...recentResp.map(Math.abs)),
                        artifactRatio: this.calculateArtifactRatio(recentResp)
                    }
                }
            },
            timestamp
        };
    }

    private calculateArtifactRatio(signal: number[]): number {
        const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
        const variance = signal.reduce((a, b) => a + (b - mean) ** 2, 0) / signal.length;
        const threshold = 3 * Math.sqrt(variance);
        return signal.filter(x => Math.abs(x - mean) > threshold).length / signal.length;
    }

    private updatePerformanceMetrics(startTime: number): void {
        const processingTime = performance.now() - startTime;
        this.updateCount++;
        this.averageUpdateTime = (this.averageUpdateTime * (this.updateCount - 1) + processingTime) / this.updateCount;
    }

    getPerformanceMetrics(): {
        averageUpdateTime: number;
        updateCount: number;
        bufferUtilization: number;
    } {
        return {
            averageUpdateTime: this.averageUpdateTime,
            updateCount: this.updateCount,
            bufferUtilization: (this.timestamps.length / this.maxSignalBufferSize) * 100
        };
    }

    exportData(): string {
        return JSON.stringify({
            metadata: {
                samplingRate: this.fps,
                startTime: this.timestamps[0],
                endTime: this.timestamps[this.timestamps.length - 1],
                totalSamples: this.timestamps.length
            },
            signals: {
                bvp: {
                    raw: Array.from(this.bvpBuffer.raw),
                    filtered: Array.from(this.bvpBuffer.filtered)
                },
                resp: {
                    raw: Array.from(this.respBuffer.raw),
                    filtered: Array.from(this.respBuffer.filtered)
                }
            },
            rates: {
                heart: this.heartRates,
                respiratory: this.respRates
            },
            timestamps: this.timestamps,
            performance: this.getPerformanceMetrics()
        }, null, 2);
    }

    getConfig(): ModelConfig | null {
        return this.config;
    }

    reset(): void {
        // Reset buffers
        this.bvpBuffer.raw.fill(0);
        this.bvpBuffer.filtered.fill(0);
        this.bvpBuffer.snr = 0;
        this.respBuffer.raw.fill(0);
        this.respBuffer.filtered.fill(0);
        this.respBuffer.snr = 0;

        // Reset history
        this.heartRates = [];
        this.respRates = [];
        this.timestamps = [];

        // Reset metrics
        this.updateCount = 0;
        this.averageUpdateTime = 0;
        this.lastUpdateTime = Date.now();

        // Reset filters
        this.bvpFilter.reset();
        this.respFilter.reset();
    }
}