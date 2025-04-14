import { ExportData } from '../types';
import { SignalFilters, SignalAnalyzer, SignalMetrics } from './signalAnalysis';

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

    // Constants for frame and signal management strategy
    public readonly INITIAL_FRAMES = 181;
    public readonly SUBSEQUENT_FRAMES = 121;
    public readonly OVERLAP_FRAMES = this.INITIAL_FRAMES - this.SUBSEQUENT_FRAMES;
    private readonly MIN_SECONDS_FOR_METRICS = 10; // Start computing metrics when we have at least this much data
    private readonly METRICS_WINDOW_SECONDS = 30;  // Use 30 seconds for metrics when available

    // Constants for display and buffer management (updated per requirements)
    private readonly DISPLAY_SAMPLES_BVP = 300;  // 300 samples for BVP
    private readonly DISPLAY_SAMPLES_RESP = 450; // 450 samples for Resp
    private readonly MAX_BUFFER = 1800;          // 1800 samples maximum buffer size

    private bvpBandpassFilter: SignalFilters;
    private respBandpassFilter: SignalFilters;

    // Moving average window sizes for different signals
    private BVP_Mean: number = 0;
    private RESP_Mean: number = 0;
    private readonly BVP_MA_WINDOW: number;
    private readonly RESP_MA_WINDOW: number;

    // Signal buffers
    private bvpBuffer: SignalBuffer;
    private respBuffer: SignalBuffer;
    private timestamps: string[] = [];

    // Rolling buffers for rate history (for median calculation)
    private bvpRateHistory: number[] = [];
    private respRateHistory: number[] = [];
    private readonly RATE_HISTORY_MAX_SIZE = 5; // Store 5 rate values for median calculation as per requirements

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
        this.BVP_MA_WINDOW = Math.round(0.4 * fps); // 400 ms for heart rate
        this.RESP_MA_WINDOW = Math.round(1.0 * fps);  // 1000 ms for respiration

        // Initialize buffers
        this.bvpBuffer = this.createBuffer();
        this.respBuffer = this.createBuffer();

        // Bandpass filters for BVP and Resp signals
        this.bvpBandpassFilter = new SignalFilters("bvp", this.fps);    //supports only 30 and 25 fps
        this.respBandpassFilter = new SignalFilters("resp", this.fps);  //supports only 30 and 25 fps
    }

    private createBuffer(): SignalBuffer {
        return {
            raw: [],
            filtered: [],
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

        // Track the initial processing state
        const wasInitiallyProcessed = this.isInitialProcessingDone;

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
            // BVP and Resp signals will be INITIAL_FRAMES - 1 samples long (180)
            // We need to handle the overlap of OVERLAP_FRAMES (60) samples

            // Retain overlapping samples for continuity
            const overlapBvpSamples = bvpSignal.slice(0, this.OVERLAP_FRAMES);
            const overlapRespSamples = respSignal.slice(0, this.OVERLAP_FRAMES);

            // Add new samples after overlap
            const newBvpSamples = bvpSignal.slice(this.OVERLAP_FRAMES);
            const newRespSamples = respSignal.slice(this.OVERLAP_FRAMES);

            // Update buffers with both overlapping and new samples
            this.updateBuffer(this.bvpBuffer, [...overlapBvpSamples, ...newBvpSamples], 'heart');
            this.updateBuffer(this.respBuffer, [...overlapRespSamples, ...newRespSamples], 'resp');

            console.log(`Subsequent BVP segment: length=${bvpSignal.length}, min=${Math.min(...bvpSignal)}, max=${Math.max(...bvpSignal)}`);
            console.log(`Subsequent RESP segment: length=${respSignal.length}, min=${Math.min(...respSignal)}, max=${Math.max(...respSignal)}`);
        }

        // Store timestamps for export
        const uniqueTimestamp = timestamp || new Date().toISOString();
        this.timestamps.push(uniqueTimestamp);

        // Log details about processed signals
        const segmentType = wasInitiallyProcessed ? "Subsequent" : "Initial";
        console.log(`${segmentType} BVP segment: length=${bvpSignal.length}, min=${Math.min(...bvpSignal)}, max=${Math.max(...bvpSignal)}`);
        console.log(`${segmentType} RESP segment: length=${respSignal.length}, min=${Math.min(...respSignal)}, max=${Math.max(...respSignal)}`);

        // Maintain buffer size with growth for export (max 1800 samples as per requirements)
        this.maintainBufferSize();

        // Get session duration to determine if we have enough data for metrics
        const sessionDurationSeconds = (Date.now() - this.sessionStartTime) / 1000;

        // Default metrics (used if we don't have enough data)
        let bvpMetrics: SignalMetrics = {
            rate: 0,
            quality: { quality: 'poor', snr: 0, artifactRatio: 1.0, signalStrength: 0 }
        };

        let respMetrics: SignalMetrics = {
            rate: 0,
            quality: { quality: 'poor', snr: 0, artifactRatio: 1.0, signalStrength: 0 }
        };

        // Check if we have minimum data for metrics computation
        const hasMinimumData = sessionDurationSeconds >= this.MIN_SECONDS_FOR_METRICS &&
            this.bvpBuffer.filtered.length >= this.fps * this.MIN_SECONDS_FOR_METRICS &&
            this.respBuffer.filtered.length >= this.fps * this.MIN_SECONDS_FOR_METRICS;

        if (hasMinimumData) {
            // For BVP metrics, use most recent DISPLAY_SAMPLES_BVP samples
            const bvpWindowSamples = Math.min(
                this.DISPLAY_SAMPLES_BVP,
                this.bvpBuffer.filtered.length
            );

            // For Resp metrics, use most recent DISPLAY_SAMPLES_RESP samples
            const respWindowSamples = Math.min(
                this.DISPLAY_SAMPLES_RESP,
                this.respBuffer.filtered.length
            );

            // Process signals for metrics using the appropriate window sizes
            bvpMetrics = this.processSignal(this.bvpBuffer, 'bvp', timestamp, bvpWindowSamples);
            respMetrics = this.processSignal(this.respBuffer, 'resp', timestamp, respWindowSamples);

            // Calculate median rates for display
            this.updateDisplayRates();
        }

        // Prepare display data (for plots)
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

    private updateBuffer(buffer: SignalBuffer, newSignal: number[], type: 'heart' | 'resp'): void {
        // Add new signals to raw buffer
        buffer.raw.push(...newSignal);

        // Process only the new samples with explicitly provided type
        const processedSignal = this.processSegment(newSignal, type);

        // Add to filtered buffer
        buffer.filtered.push(...processedSignal);

        // Maintain maximum buffer size for both buffers together
        this.enforceBufferSize(buffer);
    }

    private processSegment(signal: number[], type: 'heart' | 'resp'): number[] {
        // // Step 1: Remove DC component
        // const dcRemoved = SignalAnalyzer.removeDC(signal);

        // // Step 2: Apply additional smoothing for respiratory signal
        // const smoothed = type === 'resp' ?
        //     this.applySmoothingFilter(dcRemoved, this.RESP_MA_WINDOW) :
        //     this.applySmoothingFilter(dcRemoved, this.BVP_MA_WINDOW);

        let smoothed: number[] = [];
        // Step 2: Apply bandpass filter
        if (type === 'heart') {
            const dcRemoved = signal.map(val => val - this.BVP_Mean);
            smoothed = this.bvpBandpassFilter.applyButterworthBandpass(dcRemoved)
        } else {
            const dcRemoved = signal.map(val => val - this.RESP_Mean);
            smoothed = this.respBandpassFilter.applyButterworthBandpass(dcRemoved);
        }

        // // Handle NaN or Infinity values
        // return smoothed.map(val => isFinite(val) ? val : 0);
        return smoothed;
    }

    private applySmoothingFilter(signal: number[], windowSize: number): number[] {
        if (signal.length < windowSize) return signal;

        const result = new Array(signal.length);

        // Use moving average for smoothing
        for (let i = 0; i < signal.length; i++) {
            const halfWindow = Math.floor(windowSize / 2);
            const start = Math.max(0, i - halfWindow);
            const end = Math.min(signal.length - 1, i + halfWindow);

            let sum = 0;
            for (let j = start; j <= end; j++) {
                sum += signal[j];
            }
            result[i] = sum / (end - start + 1);
        }

        return result;
    }

    private enforceBufferSize(buffer: SignalBuffer): void {
        if (buffer.raw.length > this.MAX_BUFFER) {
            const excess = buffer.raw.length - this.MAX_BUFFER;
            buffer.raw = buffer.raw.slice(excess);
            buffer.filtered = buffer.filtered.slice(excess);
        }
    }

    private maintainBufferSize(): void {
        const maxSize = this.MAX_BUFFER;

        if (this.bvpBuffer.raw.length > maxSize) {
            this.bvpBuffer.raw = this.bvpBuffer.raw.slice(-maxSize);
            this.bvpBuffer.filtered = this.bvpBuffer.filtered.slice(-maxSize);
        }

        if (this.respBuffer.raw.length > maxSize) {
            this.respBuffer.raw = this.respBuffer.raw.slice(-maxSize);
            this.respBuffer.filtered = this.respBuffer.filtered.slice(-maxSize);
        }

        if (this.timestamps.length > maxSize) {
            this.timestamps = this.timestamps.slice(-maxSize);
        }
    }

    private processSignal(buffer: SignalBuffer, type: 'bvp' | 'resp', timestamp: string, windowSamples: number): SignalMetrics {
        // Exit early if not capturing
        if (!this.isCapturing) {
            return {
                rate: 0,
                quality: { quality: 'poor', snr: 0, artifactRatio: 1.0, signalStrength: 0 }
            };
        }

        try {
            // Get the analysis window with specified number of samples
            const analysisWindow = buffer.filtered.slice(-windowSamples);
            const rawWindow = buffer.raw.slice(-windowSamples);

            // Validate the analysis window before processing
            if (!analysisWindow.length || analysisWindow.every(val => val === 0)) {
                throw new Error('Invalid analysis window - all zeros or empty');
            }

            // Process with SignalAnalyzer
            const signalType = type === 'bvp' ? 'heart' : 'resp';
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
                quality: { quality: 'poor', snr: 0.01, artifactRatio: 1.0, signalStrength: 0 }
            };
        }
    }

    private prepareDisplayData(): { bvp: number[], resp: number[], filteredBvp: number[], filteredResp: number[] } {
        if (!this.isCapturing || this.bvpBuffer.raw.length === 0) {
            console.log('[SignalProcessor] No display data available');
            return {
                bvp: [],
                resp: [],
                filteredBvp: [],
                filteredResp: []
            };
        }

        console.log(`[SignalProcessor] Preparing display data, buffer sizes: BVP=${this.bvpBuffer.filtered.length}, RESP=${this.respBuffer.filtered.length}`);

        // Use specified sample counts for display (DISPLAY_SAMPLES_BVP and DISPLAY_SAMPLES_RESP)
        const bvpDisplaySamples = Math.min(this.DISPLAY_SAMPLES_BVP, this.bvpBuffer.raw.length);
        const respDisplaySamples = Math.min(this.DISPLAY_SAMPLES_RESP, this.respBuffer.raw.length);

        // Get the display window of data with appropriate sizes for each signal
        const bvpRawDisplay = this.bvpBuffer.raw.slice(-bvpDisplaySamples);
        const respRawDisplay = this.respBuffer.raw.slice(-respDisplaySamples);
        const bvpFilteredDisplay = this.bvpBuffer.filtered.slice(-bvpDisplaySamples);
        const respFilteredDisplay = this.respBuffer.filtered.slice(-respDisplaySamples);

        this.BVP_Mean = bvpRawDisplay.reduce((sum, val) => sum + val, 0) / bvpRawDisplay.length;
        this.RESP_Mean = respRawDisplay.reduce((sum, val) => sum + val, 0) / respRawDisplay.length;

        // Min-max normalization for display as specified in requirements
        const normalizedBVP = this.normalizeForDisplay(bvpFilteredDisplay);
        const normalizedResp = this.normalizeForDisplay(respFilteredDisplay);

        console.log(`[SignalProcessor] Display data ready: BVP=${normalizedBVP.length}, RESP=${normalizedResp.length}`);

        return {
            bvp: bvpRawDisplay,
            resp: respRawDisplay,
            filteredBvp: normalizedBVP,
            filteredResp: normalizedResp
        };
    }

    private normalizeForDisplay(signal: number[]): number[] {
        if (signal.length === 0) return [];

        // Filter out extreme outliers before normalization
        const q25 = this.calculatePercentile(signal, 0.25);
        const q75 = this.calculatePercentile(signal, 0.75);
        const iqr = q75 - q25;
        const lowerBound = q25 - 1.5 * iqr;
        const upperBound = q75 + 1.5 * iqr;

        // Only use values within acceptable range for scaling
        const filteredSignal = signal.filter(val =>
            isFinite(val) && !isNaN(val) && val >= lowerBound && val <= upperBound);

        if (filteredSignal.length === 0) return signal.map(() => 0.5);

        const min = Math.min(...filteredSignal);
        const max = Math.max(...filteredSignal);
        const range = max - min;

        if (range === 0) return signal.map(() => 0.5);

        // Apply robust normalization
        return signal.map(val => {
            return (val - min) / range;
        });
    }

    private calculatePercentile(arr: number[], percentile: number): number {
        const sorted = [...arr].sort((a, b) => a - b);
        const pos = percentile * (sorted.length - 1);
        const base = Math.floor(pos);
        const rest = pos - base;

        if (sorted[base + 1] !== undefined) {
            return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
        } else {
            return sorted[base];
        }
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

        // Format signals
        const signals = {
            bvp: {
                raw: Array.from(this.bvpBuffer.raw),
                filtered: Array.from(this.bvpBuffer.filtered)
            },
            resp: {
                raw: Array.from(this.respBuffer.raw),
                filtered: Array.from(this.respBuffer.filtered)
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
    reset(): void {
        // Reset all buffers and state variables
        this.bvpBuffer = this.createBuffer();
        this.respBuffer = this.createBuffer();
        this.timestamps = [];
        this.isInitialProcessingDone = false;
        this.sessionStartTime = 0;
        this.bvpRateHistory = [];
        this.respRateHistory = [];
        this.displayHeartRate = 0;
        this.displayRespRate = 0;
        console.log('[SignalProcessor] All buffers and state reset');
    }
}