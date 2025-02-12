// src/utils/SignalProcessor.ts

import { ButterworthFilter } from './butterworthFilter';
import { SignalAnalyzer, SignalMetrics } from './signalAnalysis';
import { ModelConfig } from './modelInference';

export interface SignalBuffer {
    raw: number[];
    filtered: number[];
    normalized: number[];
    rates: RatePoint[];
}

interface RatePoint {
    timestamp: string;
    value: number;
    snr: number;
    quality: 'excellent' | 'good' | 'moderate' | 'poor';
}

export class SignalProcessor {
    private readonly fps: number;
    private readonly DISPLAY_WINDOW = 6; // 6 seconds for display
    private readonly ANALYSIS_WINDOW = 10; // 10 seconds for analysis
    private readonly MAX_BUFFER = 300; // Maximum buffer size

    // Signal buffers
    private bvpBuffer: SignalBuffer;
    private respBuffer: SignalBuffer;
    private timestamps: string[] = [];

    // Butterworth filters
    private readonly bvpFilter: ButterworthFilter;
    private readonly respFilter: ButterworthFilter;

    constructor(fps: number = 30) {
        this.fps = fps;

        // Initialize buffers
        this.bvpBuffer = this.createBuffer();
        this.respBuffer = this.createBuffer();

        // Initialize filters with proper physiological ranges
        this.bvpFilter = new ButterworthFilter(
            ButterworthFilter.designBandpass(0.75, 2.5, fps) // 45-150 BPM
        );
        this.respFilter = new ButterworthFilter(
            ButterworthFilter.designBandpass(0.1, 0.5, fps) // 6-30 breaths/min
        );
    }

    private createBuffer(): SignalBuffer {
        return {
            raw: [],
            filtered: [],
            normalized: [],
            rates: []
        };
    }

    processNewSignals(bvpSignal: number[], respSignal: number[], timestamp: string): {
        bvp: SignalMetrics,
        resp: SignalMetrics,
        displayData: {
            bvp: number[],
            resp: number[]
        }
    } {
        // Update buffers with new signals
        this.updateBuffer(this.bvpBuffer, bvpSignal);
        this.updateBuffer(this.respBuffer, respSignal);
        this.timestamps.push(timestamp);

        // Maintain buffer size
        this.maintainBufferSize();

        // Process BVP signal
        const bvpMetrics = this.processSignal(
            this.bvpBuffer,
            'bvp',
            timestamp
        );

        // Process RESP signal
        const respMetrics = this.processSignal(
            this.respBuffer,
            'resp',
            timestamp
        );

        // Prepare display data
        const displayData = this.prepareDisplayData();

        return {
            bvp: bvpMetrics,
            resp: respMetrics,
            displayData
        };
    }

    private updateBuffer(buffer: SignalBuffer, newSignal: number[]): void {
        // Add new signals to raw buffer
        buffer.raw.push(...newSignal);

        // Apply filtering
        const filtered = this.applyFiltering(buffer.raw, buffer === this.bvpBuffer);
        buffer.filtered = filtered;

        // Normalize for display
        buffer.normalized = this.normalizeSignal(filtered);
    }

    private applyFiltering(signal: number[], isBVP: boolean): number[] {
        // Remove DC component
        const meanRemoved = this.removeDC(signal);

        // Apply appropriate filter
        const filtered = isBVP ?
            this.bvpFilter.processSignal(meanRemoved) :
            this.respFilter.processSignal(meanRemoved);

        return filtered;
    }

    private removeDC(signal: number[]): number[] {
        const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
        return signal.map(x => x - mean);
    }

    private normalizeSignal(signal: number[]): number[] {
        const max = Math.max(...signal.map(Math.abs));
        return signal.map(x => x / (max || 1));
    }

    private maintainBufferSize(): void {
        const maxSize = this.MAX_BUFFER;

        if (this.bvpBuffer.raw.length > maxSize) {
            this.bvpBuffer.raw = this.bvpBuffer.raw.slice(-maxSize);
            this.bvpBuffer.filtered = this.bvpBuffer.filtered.slice(-maxSize);
            this.bvpBuffer.normalized = this.bvpBuffer.normalized.slice(-maxSize);
        }

        if (this.respBuffer.raw.length > maxSize) {
            this.respBuffer.raw = this.respBuffer.raw.slice(-maxSize);
            this.respBuffer.filtered = this.respBuffer.filtered.slice(-maxSize);
            this.respBuffer.normalized = this.respBuffer.normalized.slice(-maxSize);
        }

        if (this.timestamps.length > maxSize) {
            this.timestamps = this.timestamps.slice(-maxSize);
        }
    }

    private processSignal(
        buffer: SignalBuffer,
        type: 'bvp' | 'resp',
        timestamp: string
    ): SignalMetrics {
        // Get analysis window
        const windowSize = Math.min(this.ANALYSIS_WINDOW * this.fps, buffer.filtered.length);
        const analysisWindow = buffer.filtered.slice(-windowSize);

        // Calculate rate and quality metrics
        const rateMetrics = this.calculateRate(analysisWindow, type);

        // Store rate point
        buffer.rates.push({
            timestamp,
            value: rateMetrics.rate,
            snr: rateMetrics.quality.snr,
            quality: rateMetrics.quality.quality
        });

        // Maintain rates buffer size
        if (buffer.rates.length > this.MAX_BUFFER) {
            buffer.rates = buffer.rates.slice(-this.MAX_BUFFER);
        }

        return rateMetrics;
    }

    private calculateRate(signal: number[], type: 'bvp' | 'resp'): SignalMetrics {
        const validRanges = {
            bvp: { min: 40, max: 180 },  // BPM
            resp: { min: 6, max: 30 }    // Breaths/min
        };

        const sigtype = type === 'bvp' ? 'heart' : 'resp';

        // Use SignalAnalyzer to get initial metrics
        const metrics = SignalAnalyzer.analyzeSignal(signal, this.fps, sigtype);

        // Validate rate is within physiological range
        const range = validRanges[type];
        if (metrics.rate < range.min || metrics.rate > range.max) {
            metrics.rate = type === 'bvp' ? 75 : 15; // Default to typical values
            metrics.quality.quality = 'poor';
        }

        return metrics;
    }

    private prepareDisplayData(): { bvp: number[], resp: number[] } {
        const displaySamples = this.DISPLAY_WINDOW * this.fps;

        return {
            bvp: this.bvpBuffer.normalized.slice(-displaySamples),
            resp: this.respBuffer.normalized.slice(-displaySamples)
        };
    }

    getExportData(): any {
        return {
            metadata: {
                samplingRate: this.fps,
                startTime: this.timestamps[0],
                endTime: this.timestamps[this.timestamps.length - 1],
                totalSamples: this.timestamps.length
            },
            signals: {
                bvp: {
                    raw: this.bvpBuffer.raw,
                    filtered: this.bvpBuffer.filtered
                },
                resp: {
                    raw: this.respBuffer.raw,
                    filtered: this.respBuffer.filtered
                }
            },
            rates: {
                heart: this.bvpBuffer.rates,
                respiratory: this.respBuffer.rates
            },
            timestamps: this.timestamps
        };
    }

    reset(): void {
        this.bvpBuffer = this.createBuffer();
        this.respBuffer = this.createBuffer();
        this.timestamps = [];
        this.bvpFilter.reset();
        this.respFilter.reset();
    }
}