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
    private readonly SEGMENT_SIZE: number = 6; // Segment size in seconds
    private readonly DISPLAY_WINDOW = 15; // Display window in seconds
    private readonly ANALYSIS_WINDOW = 10; // Analysis window for heart rate
    private readonly RESP_ANALYSIS_WINDOW = 30; // Respiratory analysis window
    private readonly MAX_BUFFER = 900; // Buffer size (15 seconds * 30 fps)
    private readonly RATE_SMOOTHING_WINDOW = 20; // Rate smoothing window

    // Moving average window sizes for different signals (in seconds, converted to samples)
    private readonly BVP_MA_WINDOW: number;
    private readonly RESP_MA_WINDOW: number;

    // Signal buffers
    private bvpBuffer: SignalBuffer;
    private respBuffer: SignalBuffer;
    private timestamps: string[] = [];

    // Smoothing for rate values
    private bvpRateHistory: { rate: number, weight: number }[] = [];
    private respRateHistory: { rate: number, weight: number }[] = [];

    // Flag to track if capture is active
    private isCapturing: boolean = false;

    constructor(fps: number = 30) {
        this.fps = fps;

        // Set appropriate moving average window sizes based on sampling rate
        this.BVP_MA_WINDOW = Math.round(0.15 * fps); // 150ms for heart rate
        this.RESP_MA_WINDOW = Math.round(0.5 * fps);  // 500ms for respiration

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

    public startCapture(): void {
        console.log('[SignalProcessor] Starting capture with clean state');
        // For safety, call the regular reset method too
        this.reset();
        // Start capturing signals
        this.isCapturing = true;
    }

    public stopCapture(): void {
        console.log('[SignalProcessor] Stopping capture');

        // Set capturing flag to false first
        this.isCapturing = false;

        // Don't reset buffers - this keeps data available for export
        console.log('[SignalProcessor] Capture stopped, data preserved for export');
    }


    // Check capture state
    isActive(): boolean {
        return this.isCapturing;
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
        if (!this.isCapturing) {
            console.log('[SignalProcessor] Skipping signal processing because capture is inactive');
            return this.getEmptyResults();
        }

        // Update buffers with new signals
        this.updateBuffer(this.bvpBuffer, bvpSignal, this.BVP_MA_WINDOW);
        this.updateBuffer(this.respBuffer, respSignal, this.RESP_MA_WINDOW);
        this.timestamps.push(timestamp);

        // Maintain buffer size
        this.maintainBufferSize();

        // Process signals to get metrics
        const bvpMetrics = this.processSignal(this.bvpBuffer, 'bvp', timestamp);
        const respMetrics = this.processSignal(this.respBuffer, 'resp', timestamp);

        // Prepare display data
        const displayData = this.prepareDisplayData();

        return {
            bvp: bvpMetrics,
            resp: respMetrics,
            displayData
        };
    }

    private updateBuffer(buffer: SignalBuffer, newSignal: number[], windowSize: number): void {
        if (!this.isCapturing) {
            return;
        }
        if (newSignal.length === 0) return;

        // Add new signals to raw buffer
        buffer.raw.push(...newSignal);

        // Process the most recent segment of data
        const segmentSize = this.SEGMENT_SIZE * this.fps; // seconds
        const startIdx = Math.max(0, buffer.raw.length - segmentSize);
        const segment = buffer.raw.slice(startIdx);

        // Debug segment statistics
        const segmentType = buffer === this.bvpBuffer ? "BVP" : "RESP";
        console.log(`${segmentType} segment stats: length=${segment.length}, min=${Math.min(...segment)}, max=${Math.max(...segment)}`);

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

    private processSignal(buffer: SignalBuffer, type: 'bvp' | 'resp', timestamp: string): SignalMetrics {
        // First check - exit with default values if capture is inactive
        if (!this.isCapturing) {
            return {
                rate: type === 'bvp' ? 75 : 15, // Default values
                quality: { quality: 'poor', snr: 0, artifactRatio: 1.0, signalStrength: 0 }
            };
        }
        // Get analysis window with appropriate length
        const windowLengthSec = type === 'bvp' ? this.ANALYSIS_WINDOW : this.RESP_ANALYSIS_WINDOW;
        const windowSize = Math.min(windowLengthSec * this.fps, buffer.filtered.length);
        const analysisWindow = buffer.filtered.slice(-windowSize);

        // Check if we have enough data
        const minRequired = this.fps * this.ANALYSIS_WINDOW; // Need at least this.ANALYSIS_WINDOW seconds
        if (analysisWindow.length < minRequired) {
            console.log(`${type}: Insufficient data for analysis (${analysisWindow.length}/${minRequired} samples)`);
            return {
                rate: type === 'bvp' ? 75 : 15, // Default values
                quality: { quality: 'poor', snr: 0, artifactRatio: 1.0, signalStrength: 0 }
            };
        }

        try {
            // Use SignalAnalyzer to process the signal
            const signalType = type === 'bvp' ? 'heart' : 'resp';

            const metrics = SignalAnalyzer.analyzeSignal(
                analysisWindow,
                this.fps,
                signalType
            );

            // Apply rate smoothing
            let rateHistory = type === 'bvp' ? this.bvpRateHistory : this.respRateHistory;

            // Only use non-default rates for smoothing
            const isDefaultRate = (type === 'bvp' && metrics.rate === 75) ||
                (type === 'resp' && metrics.rate === 15);

            if (!isDefaultRate) {
                // Apply quality weighting
                const qualityWeight = this.getQualityWeight(metrics.quality.quality);

                // Add the new rate with its quality weight
                rateHistory.push({
                    rate: metrics.rate,
                    weight: qualityWeight
                });

                // Keep history limited
                if (rateHistory.length > this.RATE_SMOOTHING_WINDOW) {
                    rateHistory = rateHistory.slice(-this.RATE_SMOOTHING_WINDOW);
                }

                // Update the history array reference
                if (type === 'bvp') {
                    this.bvpRateHistory = rateHistory;
                } else {
                    this.respRateHistory = rateHistory;
                }

                // Apply weighted average smoothing
                const totalWeight = rateHistory.reduce((sum, item) => sum + item.weight, 0);
                let smoothedRate = metrics.rate; // Default to current rate

                if (totalWeight > 0 && rateHistory.length > 0) {
                    smoothedRate = rateHistory.reduce((sum, item) => sum + item.rate * item.weight, 0) / totalWeight;
                }

                // Create smoothed metrics
                const smoothedMetrics: SignalMetrics = {
                    rate: smoothedRate,
                    quality: metrics.quality
                };

                // Store rate in buffer
                buffer.rates.push({
                    timestamp,
                    value: smoothedMetrics.rate,
                    snr: metrics.quality.snr,
                    quality: metrics.quality.quality
                });

                // Trim buffer if needed
                if (buffer.rates.length > this.MAX_BUFFER) {
                    buffer.rates = buffer.rates.slice(-this.MAX_BUFFER);
                }

                return smoothedMetrics;
            } else {
                return metrics; // Return the default metrics
            }
        } catch (error) {
            console.error(`Error calculating ${type} metrics:`, error);
            return {
                rate: type === 'bvp' ? 75 : 15, // Default values
                quality: { quality: 'poor', snr: 0, artifactRatio: 1.0, signalStrength: 0 }
            };
        }
    }

    private getQualityWeight(quality: 'excellent' | 'good' | 'moderate' | 'poor'): number {
        switch (quality) {
            case 'excellent': return 1.0;
            case 'good': return 0.8;
            case 'moderate': return 0.5;
            case 'poor': return 0.2;
            default: return 0.5;
        }
    }

    private prepareDisplayData(): { bvp: number[], resp: number[], filteredBvp: number[], filteredResp: number[] } {
        // Return empty arrays if not capturing
        if (!this.isCapturing) {
            return {
                bvp: [],
                resp: [],
                filteredBvp: [],
                filteredResp: []
            };
        }
        const displaySamples = this.DISPLAY_WINDOW * this.fps;

        // Get the display window of data
        const bvpRawDisplay = this.bvpBuffer.raw.slice(-displaySamples);
        const respRawDisplay = this.respBuffer.raw.slice(-displaySamples);
        const bvpFilteredDisplay = this.bvpBuffer.normalized.slice(-displaySamples);
        const respFilteredDisplay = this.respBuffer.normalized.slice(-displaySamples);

        // Additional smoothing for display only
        const displayBvpWindow = Math.round(this.fps * 0.15); // 150ms for display smoothing (BVP)
        const displayRespWindow = Math.round(this.fps * 0.5); // 500ms for display smoothing (Resp)

        const smoothedBvp = this.applyDisplaySmoothing(bvpFilteredDisplay, displayBvpWindow);
        const smoothedResp = this.applyDisplaySmoothing(respFilteredDisplay, displayRespWindow);

        // Normalize to [0, 1] range for display
        const normalizedBVP = this.normalizeForDisplay(smoothedBvp);
        const normalizedResp = this.normalizeForDisplay(smoothedResp);

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
    
    reset(): void {
        // Reset all buffers and state regardless of capture status
        this.bvpBuffer = this.createBuffer();
        this.respBuffer = this.createBuffer();
        this.timestamps = [];
        this.bvpRateHistory = [];
        this.respRateHistory = [];
    }
}