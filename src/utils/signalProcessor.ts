import { ExportData } from '../types';
import { SignalAnalyzer, SignalMetrics } from './signalAnalysis';

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

    // Constants for display and buffer management
    private readonly DISPLAY_WINDOW = 15; // Display window in seconds
    private readonly MAX_BUFFER = 54000; // Increased buffer size as requested (30fps * 1800s)

    // Tracking for frame buffering strategy
    private frameCount: number = 0;
    private lastProcessedFrameCount: number = 0;

    // Moving average window sizes for different signals
    private readonly BVP_MA_WINDOW: number;
    private readonly RESP_MA_WINDOW: number;

    // Signal buffers
    private bvpBuffer: SignalBuffer;
    private respBuffer: SignalBuffer;
    private timestamps: string[] = [];

    // Rolling buffers for rate history (for median calculation)
    private bvpRateHistory: number[] = [];
    private respRateHistory: number[] = [];
    private readonly RATE_HISTORY_MAX_SIZE = 20; // Store up to 20 rate values for median calculation

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
        this.BVP_MA_WINDOW = Math.round(0.25 * fps); // 250 ms for heart rate
        this.RESP_MA_WINDOW = Math.round(1.0 * fps);  // 1000 ms for respiration

        // Initialize buffers
        this.bvpBuffer = this.createBuffer();
        this.respBuffer = this.createBuffer();
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
        // Reset frame counts
        this.frameCount = 0;
        this.lastProcessedFrameCount = 0;
    }

    // Enhance the stopCapture method
    public stopCapture(): void {
        console.log('[SignalProcessor] EMERGENCY STOP - immediate halt of all processing');

        // Immediately set the flag to block any ongoing or new processing
        this.isCapturing = false;

        // Reset all processing state
        this.frameCount = 0;
        this.lastProcessedFrameCount = 0;
        this.isInitialProcessingDone = false;

        // Don't reset the data buffers - we need to preserve them for export
        console.log('[SignalProcessor] Processing halted, data preserved for export');
    }

    /**
     * Determines if we should process frames based on our strategy
     * - Initial: Process when we have INITIAL_FRAMES (181)
     * - Subsequent: Process when we have SUBSEQUENT_FRAMES (151) new frames since last processing
     */
    shouldProcessFrames(newFrames: number = 0): boolean {
        // First check if capture is active
        if (!this.isCapturing) {
            console.log(`[SignalProcessor] Not processing frames because capture is inactive`);
            return false;
        }

        // Add new frames to the count
        if (newFrames > 0) {
            this.frameCount += newFrames;
            console.log(`[SignalProcessor] Added ${newFrames} frames, total: ${this.frameCount}`);
        }

        if (!this.isInitialProcessingDone) {
            // Initial processing requires INITIAL_FRAMES
            if (this.frameCount >= this.INITIAL_FRAMES) {
                console.log(`[SignalProcessor] Initial frame threshold reached: ${this.frameCount} frames, processing...`);
                return true;
            }
            return false;
        } else {
            // Subsequent processing requires SUBSEQUENT_FRAMES new frames
            const framesCollectedSinceLastProcess = this.frameCount - this.lastProcessedFrameCount;
            console.log(`[SignalProcessor] Frames since last process: ${framesCollectedSinceLastProcess}/${this.SUBSEQUENT_FRAMES}`);

            if (framesCollectedSinceLastProcess >= this.SUBSEQUENT_FRAMES) {
                console.log(`[SignalProcessor] Subsequent frame threshold reached: ${framesCollectedSinceLastProcess} new frames, processing...`);
                return true;
            }
            return false;
        }
    }

    /**
     * Mark that frames have been processed, updating internal counters
     */
    // Ensure this gets called after processing
    markFramesProcessed(): void {
        const prevCount = this.lastProcessedFrameCount;
        this.lastProcessedFrameCount = this.frameCount;

        console.log(`[SignalProcessor] Marked frames processed: ${prevCount} → ${this.frameCount}`);

        if (!this.isInitialProcessingDone) {
            this.isInitialProcessingDone = true;
            console.log('[SignalProcessor] Initial processing complete, switching to subsequent processing mode');
        }
    }

    /**
     * Get the required frames for the current processing step
     * - Initial: Return last INITIAL_FRAMES
     * - Subsequent: Return last (OVERLAP_FRAMES + SUBSEQUENT_FRAMES) frames
     * 
     * Memory-optimized: Returns a view into the array rather than a copy when possible
     */
    getFramesForProcessing(frameBuffer: ImageData[]): ImageData[] {
        // First ensure we don't exceed memory limits
        if (frameBuffer.length > this.INITIAL_FRAMES * 2) {
            console.warn(`[SignalProcessor] Frame buffer size (${frameBuffer.length}) exceeds safe limits. This may cause memory issues.`);
        }

        if (!this.isInitialProcessingDone) {
            // Initial processing: take exactly INITIAL_FRAMES frames
            const startIdx = Math.max(0, frameBuffer.length - this.INITIAL_FRAMES);
            return frameBuffer.slice(startIdx);
        } else {
            // Subsequent processing: take OVERLAP_FRAMES + SUBSEQUENT_FRAMES frames
            const framesToTake = this.OVERLAP_FRAMES + this.SUBSEQUENT_FRAMES;
            const startIdx = Math.max(0, frameBuffer.length - framesToTake);
            return frameBuffer.slice(startIdx);
        }
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
     * 
     * - Initial 181 frames produce 180 samples
     * - Subsequent batches use 30 previous + 151 new frames
     * - 30 initial samples from each new batch are dropped (overlap)
     * - Metrics use most recent 30 seconds (or 10+ seconds if not enough)
     * - Buffers continue to grow for export
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

        // For subsequent processing, trim the overlapping samples
        if (this.isInitialProcessingDone && bvpSignal.length > this.OVERLAP_FRAMES) {
            // Only keep the new samples after overlap
            const newBvpSamples = bvpSignal.slice(this.OVERLAP_FRAMES);
            const newRespSamples = respSignal.slice(this.OVERLAP_FRAMES);

            // Add only new samples to buffers
            this.updateBuffer(this.bvpBuffer, newBvpSamples, this.BVP_MA_WINDOW);
            this.updateBuffer(this.respBuffer, newRespSamples, this.RESP_MA_WINDOW);

            console.log(`[SignalProcessor] Added ${newBvpSamples.length} new BVP samples after overlap`);
        } else {
            // Initial processing - add all samples
            this.updateBuffer(this.bvpBuffer, bvpSignal, this.BVP_MA_WINDOW);
            this.updateBuffer(this.respBuffer, respSignal, this.RESP_MA_WINDOW);
        }

        // Store timestamps for export
        const uniqueTimestamp = timestamp || new Date().toISOString();
        this.timestamps.push(uniqueTimestamp);

        // Log details about processed signals
        const segmentType = wasInitiallyProcessed ? "Subsequent" : "Initial";
        console.log(`${segmentType} BVP segment: length=${bvpSignal.length}, min=${Math.min(...bvpSignal)}, max=${Math.max(...bvpSignal)}`);
        console.log(`${segmentType} RESP segment: length=${respSignal.length}, min=${Math.min(...respSignal)}, max=${Math.max(...respSignal)}`);

        // Maintain buffer size with growth for export
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
            // Calculate window size based on available data (up to METRICS_WINDOW_SECONDS)
            const windowSizeSeconds = Math.min(this.METRICS_WINDOW_SECONDS, sessionDurationSeconds);
            const windowSamples = Math.min(
                windowSizeSeconds * this.fps,
                this.bvpBuffer.filtered.length
            );

            // Process signals for metrics using the configured window
            bvpMetrics = this.processSignal(this.bvpBuffer, 'bvp', timestamp, windowSamples);
            respMetrics = this.processSignal(this.respBuffer, 'resp', timestamp, windowSamples);

            // Update rate history for median calculation
            if (bvpMetrics.rate > 0) {
                this.bvpRateHistory.push(bvpMetrics.rate);
                // Maintain history size
                if (this.bvpRateHistory.length > this.RATE_HISTORY_MAX_SIZE) {
                    this.bvpRateHistory.shift();
                }
            }

            if (respMetrics.rate > 0) {
                this.respRateHistory.push(respMetrics.rate);
                // Maintain history size
                if (this.respRateHistory.length > this.RATE_HISTORY_MAX_SIZE) {
                    this.respRateHistory.shift();
                }
            }

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

    private updateBuffer(buffer: SignalBuffer, newSignal: number[], windowSize: number): void {
        if (!this.isCapturing || newSignal.length === 0) {
            return;
        }

        // Add new signals to raw buffer
        buffer.raw.push(...newSignal);

        // Process the most recent segment of data
        const startIdx = Math.max(0, buffer.raw.length - this.INITIAL_FRAMES);
        const segment = buffer.raw.slice(startIdx);

        // Remove DC component
        const dcRemoved = SignalAnalyzer.removeDC(segment);

        // Apply moving average filter
        const filtered = SignalAnalyzer.applyMovingAverage(dcRemoved, windowSize);

        // Add validation to prevent NaN values
        const validatedFiltered = filtered.map(val => isFinite(val) ? val : 0);

        // Calculate how many new samples we're adding
        const existingFiltered = buffer.filtered.length;
        const rawLength = buffer.raw.length;
        const newSamplesCount = Math.min(newSignal.length, validatedFiltered.length);

        // Add only new samples to filtered buffer
        if (existingFiltered > 0) {
            const newFiltered = validatedFiltered.slice(validatedFiltered.length - newSamplesCount);
            buffer.filtered.push(...newFiltered);
        } else {
            buffer.filtered.push(...validatedFiltered);
        }

        // Ensure filtered buffer doesn't grow larger than raw buffer
        if (buffer.filtered.length > rawLength) {
            buffer.filtered = buffer.filtered.slice(-rawLength);
        }

        // Normalize the filtered buffer
        buffer.normalized = this.normalizeSignal(buffer.filtered);
    }

    private normalizeSignal(signal: number[]): number[] {
        if (signal.length === 0) return [];

        const validSignal = signal.filter(val => isFinite(val) && !isNaN(val));
        if (validSignal.length === 0) return signal.map(() => 0);

        // Use median and IQR for robust normalization
        const sorted = [...validSignal].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];

        const q1Index = Math.floor(sorted.length * 0.25);
        const q3Index = Math.floor(sorted.length * 0.75);
        const iqr = sorted[q3Index] - sorted[q1Index] || 1; // Avoid division by zero

        // Z-score normalization with outlier clamping
        return signal.map(val => {
            if (!isFinite(val) || isNaN(val)) return 0;
            const normalized = (val - median) / iqr;
            return Math.max(-3, Math.min(3, normalized)); // Clamp extreme values
        });
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

            // FIX: Validate the analysis window before processing
            if (!analysisWindow.length || analysisWindow.every(val => val === 0)) {
                throw new Error('Invalid analysis window - all zeros or empty');
            }

            // Process with SignalAnalyzer
            const signalType = type === 'bvp' ? 'heart' : 'resp';
            const metrics = SignalAnalyzer.analyzeSignal(
                analysisWindow,
                this.fps,
                signalType
            );

            // FIX: Add validation for SNR values
            if (metrics.quality.snr <= 0) {
                console.warn(`[SignalProcessor] Warning: Invalid SNR value (${metrics.quality.snr}) for ${type} signal`);
                // Use a small positive value instead of zero
                metrics.quality.snr = 0.01;
                metrics.quality.quality = 'poor';
            }

            // Store rate in buffer for history calculation
            if (metrics.rate > 0) {
                if (type === 'bvp') {
                    this.bvpRateHistory.push(metrics.rate);
                    if (this.bvpRateHistory.length > this.RATE_HISTORY_MAX_SIZE) {
                        this.bvpRateHistory.shift();
                    }
                } else {
                    this.respRateHistory.push(metrics.rate);
                    if (this.respRateHistory.length > this.RATE_HISTORY_MAX_SIZE) {
                        this.respRateHistory.shift();
                    }
                }
            }

            // Use the raw metrics for quality data 
            const result: SignalMetrics = {
                rate: metrics.rate,
                quality: metrics.quality
            };

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

            return result;
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

        // Get number of samples to display (last N seconds)
        const displaySamples = Math.min(this.DISPLAY_WINDOW * this.fps, this.bvpBuffer.raw.length);

        // Debug logging
        if (displaySamples === 0) {
            console.warn('[SignalProcessor] No display samples available');
        }

        // Get the display window of data
        const bvpRawDisplay = this.bvpBuffer.raw.slice(-displaySamples);
        const respRawDisplay = this.respBuffer.raw.slice(-displaySamples);
        const bvpFilteredDisplay = this.bvpBuffer.filtered.slice(-displaySamples);
        const respFilteredDisplay = this.respBuffer.filtered.slice(-displaySamples);

        // Additional smoothing for display only
        const displayBvpWindow = Math.round(this.fps * 0.15); // 150ms for display smoothing (BVP)
        const displayRespWindow = Math.round(this.fps * 0.5); // 500ms for display smoothing (Resp)

        const smoothedBvp = this.applyDisplaySmoothing(bvpFilteredDisplay, displayBvpWindow);
        const smoothedResp = this.applyDisplaySmoothing(respFilteredDisplay, displayRespWindow);

        // Normalize to [0, 1] range for display
        const normalizedBVP = this.normalizeForDisplay(smoothedBvp);
        const normalizedResp = this.normalizeForDisplay(smoothedResp);

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

        const validSignal = signal.filter(val => isFinite(val) && !isNaN(val));
        if (validSignal.length === 0) return signal.map(() => 0);

        const min = Math.min(...validSignal);
        const max = Math.max(...validSignal);
        const range = max - min;

        if (range === 0) return signal.map(() => 0.5);

        // Normalize to [0, 1] range for display
        return signal.map(val => (val - min) / range);
    }

    private applyDisplaySmoothing(signal: number[], windowSize: number): number[] {
        return SignalAnalyzer.applyMovingAverage(signal, windowSize);
    }

    /**
     * Get data for export (keeping all collected data)
     */
    getExportData(): ExportData {
        // Create a lightweight copy of only the necessary data
        const exportData: ExportData = {
            metadata: {
                samplingRate: this.fps,
                startTime: this.timestamps[0] || new Date().toISOString(),
                endTime: this.timestamps[this.timestamps.length - 1] || new Date().toISOString(),
                totalSamples: this.timestamps.length
            },
            signals: {
                bvp: {
                    raw: [...this.bvpBuffer.raw],
                    filtered: [...this.bvpBuffer.filtered]
                },
                resp: {
                    raw: [...this.respBuffer.raw],
                    filtered: [...this.respBuffer.filtered]
                }
            },
            rates: {
                heart: this.bvpBuffer.rates.map(({ timestamp, value, snr, quality }) => ({
                    timestamp,
                    value,
                    snr,
                    quality
                })),
                respiratory: this.respBuffer.rates.map(({ timestamp, value, snr, quality }) => ({
                    timestamp,
                    value,
                    snr,
                    quality
                }))
            },
            timestamps: [...this.timestamps]
        };

        return exportData;
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
        this.frameCount = 0;
        this.lastProcessedFrameCount = 0;
        this.bvpRateHistory = [];
        this.respRateHistory = [];
        this.displayHeartRate = 0;
        this.displayRespRate = 0;
        console.log('[SignalProcessor] All buffers and state reset');
    }
}