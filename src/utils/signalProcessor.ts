// src/utils/SignalProcessor.ts

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
    private readonly RESP_ANALYSIS_WINDOW = 30; // 10 seconds for analysis
    private readonly MAX_BUFFER = 300; // Maximum buffer size

    // Signal buffers
    private bvpBuffer: SignalBuffer;
    private respBuffer: SignalBuffer;
    private timestamps: string[] = [];

    // Butterworth filters
    private readonly bvpFilter: ButterworthFilter;
    private readonly respFilter: ButterworthFilter;

    // Add smoothing for rate values
    private bvpRateHistory: number[] = [];
    private respRateHistory: number[] = [];    

    constructor(fps: number = 30) {
        this.fps = fps;

        // Initialize buffers
        this.bvpBuffer = this.createBuffer();
        this.respBuffer = this.createBuffer();

        // Use Hz values directly related to heart rate and respiratory rate
        // For heart rate: 0.60-3.3 Hz corresponds to 35-200 BPM
        // For respiration: 0.1-0.54 Hz corresponds to 6-32 breaths/min
        const bvpLowCutoff = 0.60 / (fps / 2);  // Convert Hz to normalized frequency
        const bvpHighCutoff = 3.3 / (fps / 2);

        const respLowCutoff = 0.1 / (fps / 2);
        const respHighCutoff = 0.54 / (fps / 2);

        // Initialize filters with proper physiological ranges
        this.bvpFilter = new ButterworthFilter(
            ButterworthFilter.designBandpass(bvpLowCutoff, bvpHighCutoff, fps, 2) // 2nd order
        );
        this.respFilter = new ButterworthFilter(
            ButterworthFilter.designBandpass(respLowCutoff, respHighCutoff, fps, 2) // 2nd order
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
        // Preprocess signals to remove extreme artifacts
        const cleanedBvpSignal = this.preprocessSignal(bvpSignal);
        const cleanedRespSignal = this.preprocessSignal(respSignal);

        // Update buffers with cleaned signals
        this.updateBuffer(this.bvpBuffer, cleanedBvpSignal);
        this.updateBuffer(this.respBuffer, cleanedRespSignal);
        this.timestamps.push(timestamp);

        // Maintain buffer size
        this.maintainBufferSize();

        // Process signals
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

        // Prepare display data
        const displayData = this.prepareDisplayData();

        return {
            bvp: bvpMetrics,
            resp: respMetrics,
            displayData
        };
    }

    // New preprocessing method to remove extreme artifacts
    private preprocessSignal(signal: number[]): number[] {
        if (signal.length === 0) return signal;

        const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
        const stdDev = Math.sqrt(
            signal.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / signal.length
        );

        // Remove outliers beyond 3 standard deviations
        return signal.map(val =>
            Math.abs(val - mean) <= 3 * stdDev ? val : mean
        );
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

        // Only filter the new signal (incremental processing)
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

        // Physiological signal normalization for visualization
        buffer.normalized = this.normalizePhysiologicalSignal(buffer.filtered, buffer === this.bvpBuffer);
    }


    // Specialized normalization for physiological signals
    private normalizePhysiologicalSignal(signal: number[], isBVP: boolean): number[] {
        if (signal.length === 0) return [];

        const validSignal = signal.filter(val => isFinite(val) && !isNaN(val));
        if (validSignal.length === 0) return signal.map(() => 0);

        // Use a sliding window approach for more stable normalization
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

            // Find local min/max
            const min = Math.min(...validWindow);
            const max = Math.max(...validWindow);

            // Avoid division by zero
            if (max === min) {
                normalizedSignal.push(0);
                continue;
            }

            // Normalize current value within window context
            const normalizedValue = (signal[i] - min) / (max - min);

            // Scale to proper range (-1 to 1 for PPG, 0 to 1 for resp)
            normalizedSignal.push(isBVP ? (2 * normalizedValue - 1) : normalizedValue);
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
        // Get analysis window
        const windowLengthSec = type === 'bvp' ? this.ANALYSIS_WINDOW : this.RESP_ANALYSIS_WINDOW;
        const windowSize = Math.min(windowLengthSec * this.fps, buffer.filtered.length);
        const analysisWindow = buffer.filtered.slice(-windowSize);

        // Add debug logs
        console.log(`Processing ${type} signal. Window size: ${analysisWindow.length}, FPS: ${this.fps}`);

        // Check if we have enough data
        if (analysisWindow.length < this.fps * 3) { // Need at least 3 seconds
            console.log(`Insufficient data for ${type} analysis: ${analysisWindow.length} samples`);
            return {
                rate: type === 'bvp' ? 75 : 15, // Default values
                quality: { quality: 'poor', snr: 0, artifactRatio: 1.0, signalStrength: 0 } // Added signalStrength
            };
        }

        // Calculate metrics using FFT-based approach
        try {
            // Calculate spectrum using FFT
            const spectrum = this.calculateSpectrum(analysisWindow, this.fps);

            // Find dominant frequency in physiological range
            const freqRange = type === 'bvp'
                ? { min: 0.60, max: 3.3 }  // 35-198 BPM
                : { min: 0.1, max: 0.5 };  // 6-30 breaths/min

            const dominantFreq = this.findDominantFrequency(spectrum, freqRange);

            // Convert frequency to rate
            let rate = dominantFreq * 60; // Convert Hz to BPM or breaths/min

            console.log(`${type} analysis success: dominant freq ${dominantFreq.toFixed(2)} Hz = ${rate.toFixed(1)} BPM/resp rate`);

            // Apply temporal smoothing to rate values
            if (rate > 0) {
                const rateHistory = type === 'bvp' ? this.bvpRateHistory : this.respRateHistory;
                rateHistory.push(rate);

                // Keep last 3 valid measurements
                while (rateHistory.length > 3) {
                    rateHistory.shift();
                }

                // Calculate smoothed rate (weighted average favoring recent values)
                if (rateHistory.length > 1) {
                    const weights = rateHistory.map((_, i) => i + 1); // Higher weight for newer values
                    const weightSum = weights.reduce((a, b) => a + b, 0);

                    const smoothedRate = rateHistory.reduce((sum, r, i) => sum + r * weights[i], 0) / weightSum;

                    // Limit rate change to physiologically plausible values
                    const maxChange = type === 'bvp' ? 10 : 4; // BPM or breaths/min
                    const prevRate = rate;
                    rate = prevRate + Math.min(Math.max(smoothedRate - prevRate, -maxChange), maxChange);
                }
            }

            return {
                rate: rate,
                quality: this.calculateSignalQuality(spectrum, dominantFreq, freqRange, type)
            };
        } catch (error) {
            console.error(`Error calculating ${type} metrics:`, error);
            return {
                rate: type === 'bvp' ? 75 : 15, // Default values
                quality: { quality: 'poor', snr: 0, artifactRatio: 1.0, signalStrength: 0 }
            };
        }
    }

    private calculateSpectrum(signal: number[], fs: number): { frequencies: number[], magnitudes: number[] } {
        // Simple FFT implementation
        const N = signal.length;
        const frequencies: number[] = [];
        const magnitudes: number[] = [];

        // Calculate DFT manually for demonstration
        for (let k = 0; k < N / 2; k++) {
            let real = 0;
            let imag = 0;
            for (let n = 0; n < N; n++) {
                const angle = 2 * Math.PI * k * n / N;
                real += signal[n] * Math.cos(angle);
                imag -= signal[n] * Math.sin(angle);
            }

            const magnitude = Math.sqrt(real * real + imag * imag) / N;
            const frequency = k * fs / N;

            frequencies.push(frequency);
            magnitudes.push(magnitude);
        }

        return { frequencies, magnitudes };
    }

    private findDominantFrequency(spectrum: { frequencies: number[], magnitudes: number[] }, range: { min: number, max: number }): number {
        let maxMagnitude = 0;
        let dominantFreq = 0;

        for (let i = 0; i < spectrum.frequencies.length; i++) {
            const freq = spectrum.frequencies[i];
            if (freq >= range.min && freq <= range.max && spectrum.magnitudes[i] > maxMagnitude) {
                maxMagnitude = spectrum.magnitudes[i];
                dominantFreq = freq;
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
        const dominantIdx = spectrum.frequencies.findIndex(f => f === dominantFreq);
        if (dominantIdx === -1) {
            return { quality: 'poor', snr: 0, artifactRatio: 1.0, signalStrength: 0 };
        }

        // Calculate signal power in the physiological range
        let signalPower = 0;
        let totalPower = 0;
        let noiseAroundPeak = 0;
        let peakPower = spectrum.magnitudes[dominantIdx];

        // Consider frequencies in physiological range
        for (let i = 0; i < spectrum.frequencies.length; i++) {
            const freq = spectrum.frequencies[i];
            const power = spectrum.magnitudes[i] * spectrum.magnitudes[i];

            // Total power across all frequencies
            totalPower += power;

            // Power within physiological range
            if (freq >= range.min && freq <= range.max) {
                signalPower += power;

                // Calculate noise around peak (excluding the peak itself)
                if (Math.abs(freq - dominantFreq) < 0.1 && i !== dominantIdx) {
                    noiseAroundPeak += power;
                }
            }
        }

        // Calculate SNR: peak power to noise around peak
        const peakPowerSq = peakPower * peakPower;
        const snr = noiseAroundPeak > 0 ? 10 * Math.log10(peakPowerSq / noiseAroundPeak) : 0;

        // Calculate artifact ratio: power outside physiological range to total power
        const artifactPower = totalPower - signalPower;
        const artifactRatio = totalPower > 0 ? artifactPower / totalPower : 1.0;

        // Calculate signal strength (relative power of the dominant frequency)
        const signalStrength = totalPower > 0 ? peakPowerSq / totalPower : 0;

        // Determine quality based on SNR and artifact ratio
        let quality: 'excellent' | 'good' | 'moderate' | 'poor';

        if (snr > 10 && artifactRatio < 0.3) {
            quality = 'excellent';
        } else if (snr > 5 && artifactRatio < 0.5) {
            quality = 'good';
        } else if (snr > 3 && artifactRatio < 0.7) {
            quality = 'moderate';
        } else {
            quality = 'poor';
        }

        console.log(`${type} signal quality: ${quality}, SNR: ${snr.toFixed(2)}dB, artifact ratio: ${artifactRatio.toFixed(2)}, strength: ${signalStrength.toFixed(2)}`);

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
            // Raw signals should be normalized for display but preserve characteristics
            bvp: this.normalizeForDisplay(rawBvp),
            resp: this.normalizeForDisplay(rawResp),
            // Filtered signals should maintain physiological shape but be normalized
            filteredBvp: filteredBvp,
            filteredResp: filteredResp
        };
    }

    private normalizeForDisplay(signal: number[]): number[] {
        if (signal.length === 0) return [];

        const validValues = signal.filter(v => isFinite(v) && !isNaN(v));
        if (validValues.length === 0) return signal.map(() => 0);

        const min = Math.min(...validValues);
        const max = Math.max(...validValues);

        if (min === max) return signal.map(() => 0);

        // Center around zero for better visualization
        return signal.map(v => {
            if (!isFinite(v) || isNaN(v)) return 0;
            return 2 * ((v - min) / (max - min)) - 1;
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
    }
}