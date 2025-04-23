import { ExportData } from '../types';
import { SignalAnalyzer, SignalMetrics } from './signalAnalysis';
import { ButterworthFilter } from './butterworthFilter';

export interface SignalBuffer {
    raw: number[];
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

    // Constants for frame and signal management strategy
    public readonly INITIAL_FRAMES = 181;
    public readonly SUBSEQUENT_FRAMES = 121;
    public readonly OVERLAP_FRAMES = this.INITIAL_FRAMES - this.SUBSEQUENT_FRAMES;
    private readonly MIN_SECONDS_FOR_METRICS = 10; // Start computing metrics when we have at least this much data
    private readonly METRICS_WINDOW_SECONDS = 30;  // Use 30 seconds for metrics when available

    // Constants for display and buffer management
    private readonly DISPLAY_SAMPLES_BVP = 300;  // 300 samples for BVP
    private readonly DISPLAY_SAMPLES_RESP = 450; // 450 samples for Resp
    private readonly MAX_BUFFER = 18000;          // 18000 samples maximum buffer size

    // ButterworthFilter Vandpass Filters
    private bvpFilter: ButterworthFilter;
    private respFilter: ButterworthFilter;

    // Moving average window sizes for different signals
    private BVP_Mean: number = 0;
    private RESP_Mean: number = 0;
    private readonly BVP_MA_WINDOW: number;
    private readonly RESP_MA_WINDOW: number;

    // Signal buffers - only raw signals are stored
    private bvpBuffer: SignalBuffer;
    private respBuffer: SignalBuffer;
    private timestamps: string[] = [];

    // Rolling buffers for rate history (for median calculation)
    private bvpRateHistory: number[] = [];
    private respRateHistory: number[] = [];
    private readonly RATE_HISTORY_MAX_SIZE = 6; // Store 6 rate values for median calculation

    // Tracking for buffer management strategy
    private isInitialProcessingDone: boolean = false;
    private sessionStartTime: number = 0;

    // Flag to track if capture is active
    public isCapturing: boolean = false;

    // Displays metrics (median of rate history)
    private displayHeartRate: number = 0;
    private displayRespRate: number = 0;

    private _lastInferenceTime: number = 0;


    constructor(fps: number = 30) {
        this.fps = fps;

        // Set appropriate moving average window sizes based on sampling rate
        this.BVP_MA_WINDOW = Math.round(0.35 * fps); // 350 ms for heart rate
        this.RESP_MA_WINDOW = Math.round(1.5 * fps);  // 1500 ms for respiration

        // Initialize buffers
        this.bvpBuffer = this.createBuffer();
        this.respBuffer = this.createBuffer();

        // Initialize stateful Butterworth filters
        this.bvpFilter = new ButterworthFilter(ButterworthFilter.designBandpass("bvp", this.fps));
        this.respFilter = new ButterworthFilter(ButterworthFilter.designBandpass("resp", this.fps));
    }

    private createBuffer(): SignalBuffer {
        return {
            raw: [],
            normalized: [],
            rates: []
        };
    }

    /**
     * Get the last inference execution time in milliseconds
     */
    public getLastInferenceTime(): number {
        return this._lastInferenceTime;
    }

    /**
     * Set the most recent inference execution time
     */
    public setInferenceTime(timeMs: number): void {
        this._lastInferenceTime = timeMs;
        console.log(`[SignalProcessor] Inference time: ${timeMs.toFixed(2)} ms`);
    }

    public startCapture(): void {
        console.log('[SignalProcessor] Starting capture with clean state');
        // Reset all state for a new capture
        this.reset();
        // Start capturing signals
        this.isCapturing = true;
        // Initialize session timestamp
        this.sessionStartTime = Date.now();
        this.isInitialProcessingDone = false;
    }

    // Ensure stopping capture preserves data for export
    public stopCapture(): void {
        console.log('[SignalProcessor] EMERGENCY STOP - immediate halt of all processing');

        // Immediately set the flag to block any ongoing or new processing
        this.isCapturing = false;

        // Reset all processing state but keep the buffers intact for export
        this.isInitialProcessingDone = false;

        // Don't reset the data buffers - we need to preserve them for export
        console.log('[SignalProcessor] Processing halted, data preserved for export');
    }
    
    // Method to return empty results when not capturing
    private getEmptyResults(): {
        bvp: SignalMetrics,
        resp: SignalMetrics,
        displayData: {
            bvp: number[],
            resp: number[],
            filteredBvp: number[],
            filteredResp: number[]
        }
    } {
        const emptyMetrics = {
            rate: 0,
            quality: {
                snr: 0,
                signalStrength: 0,
                artifactRatio: 1,
                quality: 'poor' as const
            }
        };

        return {
            bvp: emptyMetrics,
            resp: emptyMetrics,
            displayData: {
                bvp: [],
                resp: [],
                filteredBvp: [],
                filteredResp: []
            }
        };
    }

    /**
     * Process new BVP and respiratory signals according to the buffer management strategy
     * Optimized to work without stored filtered signal buffers
     */
    processNewSignals(bvpSignal: number[], respSignal: number[], timestamp: string): {
        bvp: SignalMetrics,
        resp: SignalMetrics,
        displayData: {
            bvp: number[],
            resp: number[],
            filteredBvp: number[],
            filteredResp: number[]
        }
    } {
        // Exit early if not capturing
        if (!this.isCapturing) {
            console.log('[SignalProcessor] Skipping signal processing because capture is inactive');
            return this.getEmptyResults();
        }

        // Process signals differently based on whether it's the first processing or a subsequent one
        if (!this.isInitialProcessingDone) {
            // Initial processing - add all samples
            this.updateBuffer(this.bvpBuffer, bvpSignal, 'heart');
            this.updateBuffer(this.respBuffer, respSignal, 'resp');

            // Mark that initial processing is done
            this.isInitialProcessingDone = true;

            console.log(`Initial BVP segment: length=${bvpSignal.length}, min=${Math.min(...bvpSignal)}, max=${Math.max(...bvpSignal)}`);
            console.log(`Initial RESP segment: length=${respSignal.length}, min=${Math.min(...respSignal)}, max=${Math.max(...respSignal)}`);
        } else {
            // Subsequent processing - handle overlap
            const overlapBvpSamples = bvpSignal.slice(0, this.OVERLAP_FRAMES);
            const overlapRespSamples = respSignal.slice(0, this.OVERLAP_FRAMES);

            // Add new samples after overlap
            const newBvpSamples = bvpSignal.slice(this.OVERLAP_FRAMES);
            const newRespSamples = respSignal.slice(this.OVERLAP_FRAMES);

            // Update buffers with both overlapping and new samples
            this.updateBuffer(this.bvpBuffer, [...overlapBvpSamples, ...newBvpSamples], 'heart');
            this.updateBuffer(this.respBuffer, [...overlapRespSamples, ...newRespSamples], 'resp');

            console.log(`Subsequent segment sizes - BVP: ${bvpSignal.length}, RESP: ${respSignal.length}`);
        }

        // Store timestamps for export
        const uniqueTimestamp = timestamp || new Date().toISOString();
        this.timestamps.push(uniqueTimestamp);

        // Maintain buffer size with growth for export (max MAX_BUFFER samples as per requirements)
        this.maintainBufferSize();

        // Default metrics (used if we don't have enough data)
        let bvpMetrics: SignalMetrics = {
            rate: 0,
            quality: { quality: 'poor', snr: 0}
        };

        let respMetrics: SignalMetrics = {
            rate: 0,
            quality: { quality: 'poor', snr: 0}
        };

        // Check if we have minimum data for metrics computation
        const hasMinimumData =
            this.bvpBuffer.raw.length >= this.fps * this.MIN_SECONDS_FOR_METRICS &&
            this.respBuffer.raw.length >= this.fps * this.MIN_SECONDS_FOR_METRICS;

        if (hasMinimumData) {
            // For BVP metrics, use maximum of METRICS_WINDOW_SECONDS samples
            const bvpWindowSamples = Math.min(
                this.fps * this.METRICS_WINDOW_SECONDS,
                this.bvpBuffer.raw.length
            );

            // For Resp metrics, use maximum of METRICS_WINDOW_SECONDS samples
            const respWindowSamples = Math.min(
                this.fps * this.METRICS_WINDOW_SECONDS,
                this.respBuffer.raw.length
            );

            // Process signals for metrics using the appropriate window sizes
            bvpMetrics = this.processSignal(this.bvpBuffer, 'bvp', timestamp, bvpWindowSamples);
            respMetrics = this.processSignal(this.respBuffer, 'resp', timestamp, respWindowSamples);

            // Calculate median rates for display
            this.updateDisplayRates();
        }

        // Prepare display data (for plots) - all filtering happens on-demand now
        const displayData = this.prepareDisplayData();

        return {
            bvp: {
                ...bvpMetrics,
                rate: this.displayHeartRate > 0 ? this.displayHeartRate : bvpMetrics.rate
            },
            resp: {
                ...respMetrics,
                rate: this.displayRespRate > 0 ? this.displayRespRate : respMetrics.rate
            },
            displayData
        };
    }

    /**
     * Calculate median of rates for more stable display values
     * Uses the most recent 5 values as per requirements
     */
    private updateDisplayRates(): void {
        // For heart rate, handle physiological constraints
        if (this.bvpRateHistory.length > 0) {
            // Filter out physiologically impossible values
            const validRates = this.bvpRateHistory.filter(rate =>
                rate >= 40 && rate <= 180 && !isNaN(rate) && isFinite(rate)
            );

            if (validRates.length > 0) {
                const sorted = [...validRates].sort((a, b) => a - b);
                // Use median for stable rate reporting
                this.displayHeartRate = sorted[Math.floor(sorted.length / 2)];
                console.log(`[SignalProcessor] Updated heart rate to ${this.displayHeartRate} (median of ${validRates.length} values)`);
            } else {
                this.displayHeartRate = 0;
            }
        }

        // For respiratory rate, apply similar constraints
        if (this.respRateHistory.length > 0) {
            const validRates = this.respRateHistory.filter(rate =>
                rate >= 5 && rate <= 40 && !isNaN(rate) && isFinite(rate)
            );

            if (validRates.length > 0) {
                const sorted = [...validRates].sort((a, b) => a - b);
                this.displayRespRate = sorted[Math.floor(sorted.length / 2)];
                console.log(`[SignalProcessor] Updated respiratory rate to ${this.displayRespRate} (median of ${validRates.length} values)`);
            } else {
                this.displayRespRate = 0;
            }
        }
    }

    /**
     * Get the current display heart rate (median of history)
     */
    public getDisplayHeartRate(): number {
        return this.displayHeartRate;
    }

    /**
     * Get the current display respiratory rate (median of history)
     */
    public getDisplayRespRate(): number {
        return this.displayRespRate;
    }

    // Simple concatenation
    private updateBuffer(buffer: SignalBuffer, newSignal: number[], type: 'heart' | 'resp'): void {
        // Add new signals to raw buffer
        buffer.raw.push(...newSignal);

        // Calculate rolling mean for DC removal using the most recent data
        // This approach puts more emphasis on recent values
        const windowSize = type === 'heart' ? this.DISPLAY_SAMPLES_BVP : this.DISPLAY_SAMPLES_RESP;
        const MEAN_WINDOW = Math.min(windowSize, buffer.raw.length); // Use at most 300 samples for mean calculation
        const recentValues = buffer.raw.slice(-MEAN_WINDOW);

        if (type === 'heart') {
            this.BVP_Mean = recentValues.reduce((sum, val) => sum + val, 0) / recentValues.length;
        } else {
            this.RESP_Mean = recentValues.reduce((sum, val) => sum + val, 0) / recentValues.length;
        }
    }

    // Process signal segment through filter
    private processSegment(signal: number[], type: 'heart' | 'resp'): number[] {
        if (signal.length === 0) return [];

        try {
            // Apply DC removal first (pre-processing)
            const dcRemoved = signal.map(val => {
                const meanVal = type === 'heart' ? this.BVP_Mean : this.RESP_Mean;
                return val - meanVal;
            });

            // First apply moving average filtering to smooth the signal
            let smoothed;
            if (type === 'heart') {
                smoothed = this.bvpFilter.applyMovingAverage(dcRemoved, this.BVP_MA_WINDOW);
            } else {
                smoothed = this.respFilter.applyMovingAverage(dcRemoved, this.RESP_MA_WINDOW);
            }

            // Then apply Butterworth filter
            let filtered: number[];
            try {
                if (type === 'heart') {
                    filtered = this.bvpFilter.applyButterworthBandpass(smoothed);
                } else {
                    filtered = this.respFilter.applyButterworthBandpass(smoothed);
                }

                // Validate filtered signal
                if (filtered.every(val => Math.abs(val) < 1e-10) || filtered.every(val => val === filtered[0])) {
                    console.warn(`Butterworth filter returned flat signal for ${type}, using smoothed signal instead`);
                    return smoothed; // Fall back to smoothed signal if filter fails
                }

                return filtered;
            } catch (err) {
                console.error(`Error in Butterworth filter for ${type}:`, err);
                // Return the smoothed signal if bandpass fails
                return smoothed;
            }
        } catch (err) {
            console.error(`Error processing ${type} segment:`, err);
            // Return the original signal as a last resort
            return signal;
        }
    }

    // Maintain buffer size for raw signals and timestamps
    private maintainBufferSize(): void {
        const maxSize = this.MAX_BUFFER;

        if (this.bvpBuffer.raw.length > maxSize) {
            this.bvpBuffer.raw = this.bvpBuffer.raw.slice(-maxSize);
            this.bvpBuffer.normalized = this.bvpBuffer.normalized.slice(-maxSize);
            if (this.bvpBuffer.rates.length > maxSize) {
                this.bvpBuffer.rates = this.bvpBuffer.rates.slice(-maxSize);
            }
        }

        if (this.respBuffer.raw.length > maxSize) {
            this.respBuffer.raw = this.respBuffer.raw.slice(-maxSize);
            this.respBuffer.normalized = this.respBuffer.normalized.slice(-maxSize);
            if (this.respBuffer.rates.length > maxSize) {
                this.respBuffer.rates = this.respBuffer.rates.slice(-maxSize);
            }
        }

        if (this.timestamps.length > maxSize) {
            this.timestamps = this.timestamps.slice(-maxSize);
        }
    }

    /**
     * Process signal for metrics with on-demand filtering
     */
    private processSignal(buffer: SignalBuffer, type: 'bvp' | 'resp', timestamp: string, windowSamples: number): SignalMetrics {
        // Exit early if not capturing
        if (!this.isCapturing) {
            return {
                rate: 0,
                quality: { quality: 'poor', snr: 0}
            };
        }

        try {
            // Get the analysis window with specified number of samples from raw data
            const rawWindow = buffer.raw.slice(-windowSamples);

            // Generate filtered data on-demand instead of accessing stored filtered data
            const signalType = type === 'bvp' ? 'heart' : 'resp';
            const analysisWindow = this.processSegment(rawWindow, signalType);

            // Validate the analysis window before processing
            if (!analysisWindow.length || analysisWindow.every(val => val === 0)) {
                throw new Error('Invalid analysis window - all zeros or empty');
            }

            // Process with SignalAnalyzer
            const metrics = SignalAnalyzer.analyzeSignal(
                analysisWindow,
                rawWindow,
                this.fps,
                signalType
            );

            // Add physiological constraints based on signal type
            const isPhysiologicallyValid = type === 'bvp' ?
                (metrics.rate >= 40 && metrics.rate <= 180) :
                (metrics.rate >= 6 && metrics.rate <= 32);

            // Only add to history if rate is valid
            if (metrics.rate > 0 && isFinite(metrics.rate) && isPhysiologicallyValid) {
                if (type === 'bvp') {
                    console.log(`[SignalProcessor] Adding heart rate to history: ${metrics.rate.toFixed(1)} bpm`);
                    this.bvpRateHistory.push(metrics.rate);
                    if (this.bvpRateHistory.length > this.RATE_HISTORY_MAX_SIZE) {
                        this.bvpRateHistory.shift();
                    }
                } else {
                    console.log(`[SignalProcessor] Adding respiratory rate to history: ${metrics.rate.toFixed(1)} brpm`);
                    this.respRateHistory.push(metrics.rate);
                    if (this.respRateHistory.length > this.RATE_HISTORY_MAX_SIZE) {
                        this.respRateHistory.shift();
                    }
                }
            } else {
                console.warn(`[SignalProcessor] Rejecting ${type} rate ${metrics.rate.toFixed(1)} - outside physiological range`);
            }

            // Validate SNR values
            if (metrics.quality.snr <= 0) {
                console.warn(`[SignalProcessor] Warning: Invalid SNR value (${metrics.quality.snr}) for ${type} signal`);
                metrics.quality.snr = 0.01;
                metrics.quality.quality = 'poor';
            }

            // Store rate in buffer for export with the current quality metrics
            buffer.rates.push({
                timestamp,
                value: metrics.rate,
                snr: metrics.quality.snr,
                quality: metrics.quality.quality
            });

            // Limit rates buffer size
            if (buffer.rates.length > this.MAX_BUFFER) {
                buffer.rates = buffer.rates.slice(-this.MAX_BUFFER);
            }

            return metrics;
        } catch (error) {
            console.error(`Error calculating ${type} metrics:`, error);
            return {
                rate: 0,
                quality: { quality: 'poor', snr: 0.01}
            };
        }
    }

    // Prepare data for display (charts) - process raw signals on demand
    private prepareDisplayData(): { bvp: number[], resp: number[], filteredBvp: number[], filteredResp: number[] } {
        if (!this.isCapturing || this.bvpBuffer.raw.length === 0) {
            return { bvp: [], resp: [], filteredBvp: [], filteredResp: [] };
        }

        // Get raw signals for display
        const bvpDisplaySamples = Math.min(this.DISPLAY_SAMPLES_BVP, this.bvpBuffer.raw.length);
        const respDisplaySamples = Math.min(this.DISPLAY_SAMPLES_RESP, this.respBuffer.raw.length);

        const bvpRawDisplay = this.bvpBuffer.raw.slice(-bvpDisplaySamples);
        const respRawDisplay = this.respBuffer.raw.slice(-respDisplaySamples);

        // Process BVP signal on demand
        const bvpFiltered = this.processSegment(bvpRawDisplay, 'heart');
        // Process RESP signal on demand
        const respFiltered = this.processSegment(respRawDisplay, 'resp');

        // Normalize filtered data for display
        const normalizedBVP = this.normalizeForDisplay(bvpFiltered);
        const normalizedResp = this.normalizeForDisplay(respFiltered);

        return {
            bvp: bvpRawDisplay,
            resp: respRawDisplay,
            filteredBvp: normalizedBVP,
            filteredResp: normalizedResp
        };
    }

    // Normalize data for display
    private normalizeForDisplay(data: number[]): number[] {
        if (!data.length) return [];

        // Find min and max
        let min = Number.MAX_VALUE;
        let max = Number.MIN_VALUE;

        for (let i = 0; i < data.length; i++) {
            if (data[i] < min) min = data[i];
            if (data[i] > max) max = data[i];
        }

        // Avoid division by zero
        if (min === max) return data.map(() => 0);

        // Normalize to [-1, 1] range
        return data.map(val => 2 * ((val - min) / (max - min)) - 1);
    }


    /**
     * Get data for export according to the specified format in pipeline description
     */
    getExportData(): ExportData {
        // Create metadata
        const metadata = {
            samplingRate: this.fps,
            startTime: new Date(this.sessionStartTime).toISOString(),
            endTime: new Date().toISOString(),
            totalSamples: Math.max(this.bvpBuffer.raw.length, this.respBuffer.raw.length)
        };

        // Format signals - ONLY include raw signals as requested
        const signals = {
            bvp: {
                raw: Array.from(this.bvpBuffer.raw)
            },
            resp: {
                raw: Array.from(this.respBuffer.raw)
            }
        };

        // Format rates history with quality info
        const rates = {
            heart: this.bvpBuffer.rates,
            respiratory: this.respBuffer.rates
        };

        return {
            metadata,
            signals,
            rates,
            timestamps: [...this.timestamps]
        };
    }

    /**
     * Reset all buffers and state when starting a new capture session
     */
    // Modified reset method to also reset filter states
    reset(): void {
        // Reset all buffers and state variables
        this.bvpBuffer = this.createBuffer();
        this.respBuffer = this.createBuffer();
        this.timestamps = [];
        this.isCapturing = false;
        this.isInitialProcessingDone = false;
        this.sessionStartTime = 0;
        this.bvpRateHistory = [];
        this.respRateHistory = [];
        this.displayHeartRate = 0;
        this.displayRespRate = 0;

        // Reinitialize filters with fresh states
        this.bvpFilter = new ButterworthFilter(
            ButterworthFilter.designBandpass("bvp", this.fps)
        );
        this.respFilter = new ButterworthFilter(
            ButterworthFilter.designBandpass("resp", this.fps)
        );

        console.log('[SignalProcessor] All buffers and state reset');
    }
}