// Enhanced signal processing logic for signalProcessor.ts

import { ExportData } from '../types';
import { ButterworthFilter } from './butterworthFilter';
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
    private readonly DISPLAY_WINDOW = 6; // 6 seconds for display
    private readonly ANALYSIS_WINDOW = 10; // 10 seconds for analysis
    private readonly RESP_ANALYSIS_WINDOW = 30; // 30 seconds for respiratory analysis
    private readonly MAX_BUFFER = 300; // Maximum buffer size

    // Signal buffers
    private bvpBuffer: SignalBuffer;
    private respBuffer: SignalBuffer;
    private timestamps: string[] = [];

    // Butterworth filters with improved parameters
    private readonly bvpFilter: ButterworthFilter;
    private readonly respFilter: ButterworthFilter;

    // Smoothing for rate values
    private bvpRateHistory: number[] = [];
    private respRateHistory: number[] = [];

    // Artifact detection
    private readonly MAX_DERIVATIVE = 0.3; // Maximum allowed signal derivative
    private readonly OUTLIER_THRESHOLD = 3.0; // Standard deviations for outlier detection

    constructor(fps: number = 30) {
        this.fps = fps;

        // Initialize buffers
        this.bvpBuffer = this.createBuffer();
        this.respBuffer = this.createBuffer();

        // Use more precise Hz values for physiological signals
        // For heart rate: 0.75-3.0 Hz corresponds to 45-180 BPM
        // For respiration: 0.1-0.5 Hz corresponds to 6-30 breaths/min
        const bvpLowCutoff = 0.75 / (fps / 2);  // Convert Hz to normalized frequency
        const bvpHighCutoff = 3.0 / (fps / 2);

        const respLowCutoff = 0.1 / (fps / 2);
        const respHighCutoff = 0.5 / (fps / 2);

        // Initialize filters with higher order for better response
        this.bvpFilter = new ButterworthFilter(
            ButterworthFilter.designBandpass(bvpLowCutoff, bvpHighCutoff, fps, 4) // 4th order
        );
        this.respFilter = new ButterworthFilter(
            ButterworthFilter.designBandpass(respLowCutoff, respHighCutoff, fps, 4) // 4th order
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
            resp: number[],
            filteredBvp: number[],
            filteredResp: number[]
        }
    } {
        // Enhanced preprocessing with artifact rejection
        const cleanedBvpSignal = this.preprocessSignal(bvpSignal, 'bvp');
        const cleanedRespSignal = this.preprocessSignal(respSignal, 'resp');

        // Update buffers with cleaned signals
        this.updateBuffer(this.bvpBuffer, cleanedBvpSignal);
        this.updateBuffer(this.respBuffer, cleanedRespSignal);
        this.timestamps.push(timestamp);

        // Maintain buffer size
        this.maintainBufferSize();

        // Process signals with enhanced metrics
        const bvpMetrics = this.processSignal(
            this.bvpBuffer,
            'bvp',
            timestamp
        );

        const respMetrics = this.processSignal(
            this.respBuffer,
            'resp',
            timestamp
        );

        // Prepare display data with improved visualization
        const displayData = this.prepareDisplayData();

        return {
            bvp: bvpMetrics,
            resp: respMetrics,
            displayData
        };
    }

    // Enhanced preprocessing with type-specific artifact rejection
    private preprocessSignal(signal: number[], type: 'bvp' | 'resp'): number[] {
        if (signal.length === 0) return signal;

        // Step 1: Calculate statistics for artifact detection
        const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
        const squaredDiffs = signal.map(val => (val - mean) ** 2);
        const variance = squaredDiffs.reduce((a, b) => a + b, 0) / signal.length;
        const stdDev = Math.sqrt(variance);

        // Step 2: Detect and replace outliers
        const threshold = this.OUTLIER_THRESHOLD * stdDev;
        let processedSignal = signal.map(val => {
            // Replace extreme outliers with the mean value
            return Math.abs(val - mean) > threshold ? mean : val;
        });

        // Step 3: Apply smoothing based on signal type
        if (type === 'bvp') {
            // For BVP, apply a 3-point moving average to reduce high-frequency noise
            processedSignal = this.smoothSignal(processedSignal, 3);
        } else {
            // For respiratory signal, use a wider 5-point moving average
            processedSignal = this.smoothSignal(processedSignal, 5);
        }

        // Step 4: Apply derivative limiting to prevent sudden changes
        processedSignal = this.limitDerivative(processedSignal, this.MAX_DERIVATIVE);

        return processedSignal;
    }

    // Apply a simple moving average filter
    private smoothSignal(signal: number[], windowSize: number): number[] {
        if (windowSize <= 1 || signal.length < windowSize) return signal;

        const result = new Array(signal.length).fill(0);

        // Handle edge cases for first windowSize/2 elements
        for (let i = 0; i < Math.floor(windowSize / 2); i++) {
            const validWindow = signal.slice(0, i * 2 + 1);
            result[i] = validWindow.reduce((a, b) => a + b, 0) / validWindow.length;
        }

        // Apply moving average for middle elements
        for (let i = Math.floor(windowSize / 2); i < signal.length - Math.floor(windowSize / 2); i++) {
            let sum = 0;
            for (let j = i - Math.floor(windowSize / 2); j <= i + Math.floor(windowSize / 2); j++) {
                sum += signal[j];
            }
            result[i] = sum / windowSize;
        }

        // Handle edge cases for last windowSize/2 elements
        for (let i = signal.length - Math.floor(windowSize / 2); i < signal.length; i++) {
            const validWindow = signal.slice(2 * i - signal.length + 1, signal.length);
            result[i] = validWindow.reduce((a, b) => a + b, 0) / validWindow.length;
        }

        return result;
    }

    // Limit the derivative (rate of change) in a signal
    private limitDerivative(signal: number[], maxDerivative: number): number[] {
        if (signal.length <= 1) return signal;

        const result = [signal[0]];

        for (let i = 1; i < signal.length; i++) {
            const derivative = signal[i] - result[i - 1];

            if (Math.abs(derivative) > maxDerivative) {
                // Limit the change
                result.push(result[i - 1] + Math.sign(derivative) * maxDerivative);
            } else {
                result.push(signal[i]);
            }
        }

        return result;
    }

    private removeDC(signal: number[]): number[] {
        if (signal.length === 0) return [];

        // Calculate the mean (DC component)
        const mean = signal.reduce((sum, value) => sum + value, 0) / signal.length;

        // Subtract the mean from each sample
        return signal.map(value => value - mean);
    }

    private updateBuffer(buffer: SignalBuffer, newSignal: number[]): void {
        // Add new signals to raw buffer
        buffer.raw.push(...newSignal);

        // Remove DC component before filtering
        const dcRemovedNew = this.removeDC(newSignal);

        // Get current filter state from previous samples
        const filter = buffer === this.bvpBuffer ? this.bvpFilter : this.respFilter;

        // Filter only the new chunk
        const filteredNew = filter.processSignal(dcRemovedNew);

        // Sanitize and add to filtered buffer
        const sanitizedNew = filteredNew.map(val => {
            if (isNaN(val) || !isFinite(val)) return 0;
            return val;
        });

        // Append new filtered data
        buffer.filtered.push(...sanitizedNew);

        // Ensure both buffers maintain same length
        while (buffer.filtered.length > buffer.raw.length) {
            buffer.filtered.shift();
        }

        // Improve physiological signal normalization for visualization
        buffer.normalized = this.normalizePhysiologicalSignal(buffer.filtered, buffer === this.bvpBuffer);
    }

    // Improved normalization specifically for physiological signals
    private normalizePhysiologicalSignal(signal: number[], isBVP: boolean): number[] {
        if (signal.length === 0) return [];

        const validSignal = signal.filter(val => isFinite(val) && !isNaN(val));
        if (validSignal.length === 0) return signal.map(() => 0);

        // Use a sliding window approach for stable normalization
        const windowSize = this.fps * 3; // 3-second window
        const normalizedSignal: number[] = [];

        for (let i = 0; i < signal.length; i++) {
            // Calculate window boundaries
            const windowStart = Math.max(0, i - windowSize / 2);
            const windowEnd = Math.min(signal.length, i + windowSize / 2);
            const window = signal.slice(windowStart, windowEnd);

            // Filter out invalid values
            const validWindow = window.filter(val => isFinite(val) && !isNaN(val));
            if (validWindow.length === 0) {
                normalizedSignal.push(0);
                continue;
            }

            // Find robust min/max using percentiles instead of absolute min/max
            const sortedValues = [...validWindow].sort((a, b) => a - b);
            const lowPercentile = sortedValues[Math.floor(sortedValues.length * 0.05)];
            const highPercentile = sortedValues[Math.floor(sortedValues.length * 0.95)];

            // Avoid division by zero
            if (highPercentile === lowPercentile) {
                normalizedSignal.push(0);
                continue;
            }

            // Normalize current value within window context with percentile bounds
            const normalizedValue = (signal[i] - lowPercentile) / (highPercentile - lowPercentile);

            // Scale to proper range with improved limits
            normalizedSignal.push(isBVP
                ? Math.max(-1.5, Math.min(1.5, 2 * normalizedValue - 1)) // BVP: -1.5 to 1.5 
                : Math.max(-0.8, Math.min(0.8, 2 * normalizedValue - 1))  // Resp: -0.8 to 0.8
            );
        }

        return normalizedSignal;
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
        // Get analysis window with appropriate length for signal type
        const windowLengthSec = type === 'bvp' ? this.ANALYSIS_WINDOW : this.RESP_ANALYSIS_WINDOW;
        const windowSize = Math.min(windowLengthSec * this.fps, buffer.filtered.length);
        const analysisWindow = buffer.filtered.slice(-windowSize);

        // Check if we have enough data
        if (analysisWindow.length < this.fps * 3) { // Need at least 3 seconds
            return {
                rate: type === 'bvp' ? 75 : 15, // Default values
                quality: { quality: 'poor', snr: 0, artifactRatio: 1.0, signalStrength: 0 }
            };
        }

        // Calculate metrics using improved spectral analysis
        try {
            // Calculate spectrum using windowed FFT for better frequency resolution
            const windowedSignal = this.applyHanningWindow(analysisWindow);
            const spectrum = this.calculateSpectrum(windowedSignal, this.fps);

            // Find dominant frequency with improved peak detection
            const freqRange = type === 'bvp'
                ? { min: 0.75, max: 3.0 }  // 45-180 BPM
                : { min: 0.1, max: 0.5 };  // 6-30 breaths/min

            const dominantFreq = this.findDominantFrequency(spectrum, freqRange);

            // Convert frequency to rate
            let rate = dominantFreq * 60; // Convert Hz to BPM or breaths/min

            // Apply temporal smoothing with improved logic
            if (rate > 0) {
                const rateHistory = type === 'bvp' ? this.bvpRateHistory : this.respRateHistory;
                rateHistory.push(rate);

                // Keep last 5 valid measurements for better smoothing
                while (rateHistory.length > 5) {
                    rateHistory.shift();
                }

                // Calculate smoothed rate using weighted median for robustness
                if (rateHistory.length > 1) {
                    // Sort rates for median calculation
                    const sortedRates = [...rateHistory].sort((a, b) => a - b);
                    const medianRate = sortedRates[Math.floor(sortedRates.length / 2)];

                    // Limit rate change to physiologically plausible values
                    const maxChange = type === 'bvp' ? 5 : 2; // Reduced max change for stability
                    const prevRate = rate;
                    rate = prevRate + Math.min(Math.max(medianRate - prevRate, -maxChange), maxChange);
                }
            }

            // Ensure rate is within physiological range
            if (type === 'bvp') {
                rate = Math.max(45, Math.min(180, rate));
            } else {
                rate = Math.max(6, Math.min(30, rate));
            }

            // Calculate enhanced signal quality metrics
            const quality = this.calculateSignalQuality(spectrum, dominantFreq, freqRange, type);

            return { rate, quality };
        } catch (error) {
            console.error(`Error calculating ${type} metrics:`, error);
            return {
                rate: type === 'bvp' ? 75 : 15, // Default values
                quality: { quality: 'poor', snr: 0, artifactRatio: 1.0, signalStrength: 0 }
            };
        }
    }

    // Apply Hanning window for better spectral estimation
    private applyHanningWindow(signal: number[]): number[] {
        return signal.map((value, index) => {
            const term = 2 * Math.PI * index / (signal.length - 1);
            const window = 0.5 * (1 - Math.cos(term)); // Hanning window
            return value * window;
        });
    }

    private calculateSpectrum(signal: number[], fs: number): { frequencies: number[], magnitudes: number[] } {
        const N = signal.length;
        const frequencies: number[] = [];
        const magnitudes: number[] = [];

        // Zero-padding for better frequency resolution
        const paddedLength = Math.pow(2, Math.ceil(Math.log2(N)));
        const paddedSignal = [...signal];
        paddedSignal.length = paddedLength;
        paddedSignal.fill(0, N);

        // Calculate DFT
        for (let k = 0; k < paddedLength / 2; k++) {
            let real = 0;
            let imag = 0;
            for (let n = 0; n < paddedLength; n++) {
                const angle = 2 * Math.PI * k * n / paddedLength;
                real += paddedSignal[n] * Math.cos(angle);
                imag -= paddedSignal[n] * Math.sin(angle);
            }

            const magnitude = Math.sqrt(real * real + imag * imag) / paddedLength;
            const frequency = k * fs / paddedLength;

            frequencies.push(frequency);
            magnitudes.push(magnitude);
        }

        return { frequencies, magnitudes };
    }

    private findDominantFrequency(spectrum: { frequencies: number[], magnitudes: number[] }, range: { min: number, max: number }): number {
        let maxMagnitude = 0;
        let dominantFreq = 0;
        let secondMaxMagnitude = 0;
        let secondDominantFreq = 0;

        // Find the two strongest peaks in the frequency range
        for (let i = 0; i < spectrum.frequencies.length; i++) {
            const freq = spectrum.frequencies[i];
            if (freq >= range.min && freq <= range.max) {
                // Check if it's a local peak
                if (i > 0 && i < spectrum.frequencies.length - 1 &&
                    spectrum.magnitudes[i] > spectrum.magnitudes[i - 1] &&
                    spectrum.magnitudes[i] > spectrum.magnitudes[i + 1]) {

                    if (spectrum.magnitudes[i] > maxMagnitude) {
                        // Move current max to second place
                        secondMaxMagnitude = maxMagnitude;
                        secondDominantFreq = dominantFreq;
                        // Set new max
                        maxMagnitude = spectrum.magnitudes[i];
                        dominantFreq = freq;
                    } else if (spectrum.magnitudes[i] > secondMaxMagnitude) {
                        secondMaxMagnitude = spectrum.magnitudes[i];
                        secondDominantFreq = freq;
                    }
                }
            }
        }

        // If second peak is harmonically related to first peak and significant,
        // it might be more accurate (e.g., respiratory sinus arrhythmia)
        if (secondMaxMagnitude > 0.7 * maxMagnitude) {
            const harmonicRatio = Math.max(dominantFreq, secondDominantFreq) /
                Math.min(dominantFreq, secondDominantFreq);

            // If close to harmonic ratio of 2, prefer the lower frequency
            if (harmonicRatio > 1.8 && harmonicRatio < 2.2) {
                return Math.min(dominantFreq, secondDominantFreq);
            }
        }

        return dominantFreq;
    }

    private calculateSignalQuality(
        spectrum: { frequencies: number[], magnitudes: number[] },
        dominantFreq: number,
        range: { min: number, max: number },
        type: 'bvp' | 'resp'
    ): { quality: 'excellent' | 'good' | 'moderate' | 'poor', snr: number, artifactRatio: number, signalStrength: number } {
        // Find index of dominant frequency
        const dominantIdx = spectrum.frequencies.findIndex(f => Math.abs(f - dominantFreq) < 0.01);
        if (dominantIdx === -1) {
            return { quality: 'poor', snr: 0, artifactRatio: 1.0, signalStrength: 0 };
        }

        // Calculate signal power in the physiological range
        let signalPower = 0;
        let totalPower = 0;
        let noiseAroundPeak = 0;
        let peakPower = spectrum.magnitudes[dominantIdx] ** 2;

        // Width of peak region (Hz)
        const peakWidth = type === 'bvp' ? 0.15 : 0.05;

        // Consider frequencies in all ranges
        for (let i = 0; i < spectrum.frequencies.length; i++) {
            const freq = spectrum.frequencies[i];
            const power = spectrum.magnitudes[i] ** 2;

            // Total power across all frequencies
            totalPower += power;

            // Power within physiological range
            if (freq >= range.min && freq <= range.max) {
                signalPower += power;

                // Calculate noise around peak (excluding the peak region)
                if (Math.abs(freq - dominantFreq) > peakWidth &&
                    Math.abs(freq - dominantFreq) < peakWidth * 3) {
                    noiseAroundPeak += power;
                }
            }
        }

        // Calculate improved SNR: peak power to noise around peak
        const snr = noiseAroundPeak > 0 ? 10 * Math.log10(peakPower / noiseAroundPeak) : 0;

        // Calculate artifact ratio: power outside physiological range to total power
        const artifactPower = totalPower - signalPower;
        const artifactRatio = totalPower > 0 ? artifactPower / totalPower : 1.0;

        // Calculate signal strength (relative power of the dominant frequency)
        const signalStrength = totalPower > 0 ? peakPower / totalPower : 0;

        // Calculate harmonic ratio for additional quality assessment
        let harmonicRatio = 0;
        const harmonicFreq = dominantFreq * 2;
        const harmonicIdx = spectrum.frequencies.findIndex(
            f => Math.abs(f - harmonicFreq) < 0.1
        );

        if (harmonicIdx !== -1) {
            const harmonicPower = spectrum.magnitudes[harmonicIdx] ** 2;
            harmonicRatio = harmonicPower > 0 ? peakPower / harmonicPower : 0;
        }

        // Improved quality determination based on multiple factors
        let quality: 'excellent' | 'good' | 'moderate' | 'poor';

        // For BVP, good harmonic content is important
        if (type === 'bvp') {
            if (snr > 12 && artifactRatio < 0.2 && harmonicRatio > 2) {
                quality = 'excellent';
            } else if (snr > 8 && artifactRatio < 0.3 && harmonicRatio > 1) {
                quality = 'good';
            } else if (snr > 5 && artifactRatio < 0.5) {
                quality = 'moderate';
            } else {
                quality = 'poor';
            }
        } else {
            // For respiratory signal, stability is more important than harmonics
            if (snr > 10 && artifactRatio < 0.3 && signalStrength > 0.4) {
                quality = 'excellent';
            } else if (snr > 6 && artifactRatio < 0.4 && signalStrength > 0.3) {
                quality = 'good';
            } else if (snr > 3 && artifactRatio < 0.6) {
                quality = 'moderate';
            } else {
                quality = 'poor';
            }
        }

        return { quality, snr, artifactRatio, signalStrength };
    }

    private prepareDisplayData(): { bvp: number[], resp: number[], filteredBvp: number[], filteredResp: number[] } {
        const displaySamples = this.DISPLAY_WINDOW * this.fps;

        // Get the most recent data
        const rawBvp = this.bvpBuffer.raw.slice(-displaySamples);
        const rawResp = this.respBuffer.raw.slice(-displaySamples);

        // Get the filtered data
        const filteredBvp = this.bvpBuffer.normalized.slice(-displaySamples);
        const filteredResp = this.respBuffer.normalized.slice(-displaySamples);

        // Enhance signal characteristics for visualization
        return {
            bvp: this.normalizeForDisplay(rawBvp),
            resp: this.normalizeForDisplay(rawResp),
            filteredBvp: filteredBvp,
            filteredResp: filteredResp
        };
    }

    private normalizeForDisplay(signal: number[]): number[] {
        if (signal.length === 0) return [];

        const validValues = signal.filter(v => isFinite(v) && !isNaN(v));
        if (validValues.length === 0) return signal.map(() => 0);

        // Use robust statistics instead of min/max
        const sorted = [...validValues].sort((a, b) => a - b);
        const lowerBound = sorted[Math.floor(sorted.length * 0.05)]; // 5th percentile
        const upperBound = sorted[Math.floor(sorted.length * 0.95)]; // 95th percentile

        const range = upperBound - lowerBound;

        if (range === 0) return signal.map(() => 0);

        // Center around zero with robust normalization
        return signal.map(v => {
            if (!isFinite(v) || isNaN(v)) return 0;
            const normalized = 2 * ((v - lowerBound) / range) - 1;
            // Clamp values to avoid extreme outliers
            return Math.max(-1.5, Math.min(1.5, normalized));
        });
    }

    getExportData(): ExportData {
        return {
            metadata: {
                samplingRate: this.fps,
                startTime: this.timestamps[0] || new Date().toISOString(),
                endTime: this.timestamps[this.timestamps.length - 1] || new Date().toISOString(),
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
                heart: this.bvpBuffer.rates.map(rate => ({
                    timestamp: rate.timestamp,
                    value: rate.value,
                    snr: rate.snr,
                    quality: rate.quality
                })),
                respiratory: this.respBuffer.rates.map(rate => ({
                    timestamp: rate.timestamp,
                    value: rate.value,
                    snr: rate.snr,
                    quality: rate.quality
                }))
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
        this.bvpRateHistory = [];
        this.respRateHistory = [];
    }
}