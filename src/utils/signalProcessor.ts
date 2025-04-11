// Enhanced signal processing logic for signalProcessor.ts

import { ExportData } from '../types';
import { ButterworthFilter } from './butterworthFilter';
import { SignalMetrics } from './signalAnalysis';

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
    private readonly DISPLAY_WINDOW = 15; // Increased to 15 seconds
    private readonly ANALYSIS_WINDOW = 10; // Analysis window for rate calculation
    private readonly RESP_ANALYSIS_WINDOW = 30; // Respiratory analysis window
    private readonly MAX_BUFFER = 450; // Increased buffer size (15 seconds * 30 fps)
    private readonly RATE_SMOOTHING_WINDOW = 7; // Increased rate smoothing window

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


    constructor(fps: number = 30) {
        this.fps = fps;

        // Initialize buffers
        this.bvpBuffer = this.createBuffer();
        this.respBuffer = this.createBuffer();

        // Use more precise Hz values for physiological signals
        // For heart rate: 0.60-3.3 Hz corresponds to 36-198 BPM
        // For respiration: 0.1-0.5 Hz corresponds to 6-30 breaths/min
        const bvpLowCutoff = 0.60; // (fps / 2);  // Convert Hz to normalized frequency
        const bvpHighCutoff = 3.3; // (fps / 2);

        const respLowCutoff = 0.1; // (fps / 2);
        const respHighCutoff = 0.5; // (fps / 2);

        // Initialize filters with higher order for better response
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
        // Update buffers with cleaned signals
        this.updateBuffer(this.bvpBuffer, bvpSignal);
        this.updateBuffer(this.respBuffer, respSignal);
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

        // Filter only the new chunk
        const filteredNew = buffer === this.bvpBuffer
            ? this.bvpFilter.processSignal(dcRemovedNew)
            : this.respFilter.processSignal(dcRemovedNew);

        // Append new filtered data
        buffer.filtered.push(...filteredNew);

        // Normalize filtered signal
        buffer.normalized = this.normalizePhysiologicalSignal(buffer.filtered, buffer === this.bvpBuffer);
    }

    // Improved normalization specifically for physiological signals
    private normalizePhysiologicalSignal(signal: number[], isBVP: boolean): number[] {
        if (signal.length === 0) return [];

        const validSignal = signal.filter(val => isFinite(val) && !isNaN(val));
        if (validSignal.length === 0) return signal.map(() => 0);

        const min = Math.min(...validSignal);
        const max = Math.max(...validSignal);
        const range = max - min;

        if (range === 0) return signal.map(() => 0);

        // Normalize to [-1, 1] range
        return signal.map(val => (2 * ((val - min) / range) - 1));
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

        try {
            // Apply Hanning window for better spectral estimation
            const windowedSignal = this.applyHanningWindow(analysisWindow);
            
            // Calculate spectrum using windowed FFT
            const spectrum = this.calculateSpectrum(windowedSignal, this.fps);
            
            // Find dominant frequency in physiological range
            const freqRange = type === 'bvp' 
                ? { min: 0.60, max: 3.3 }  // 45-180 BPM
                : { min: 0.1, max: 0.5 };  // 6-30 breaths/min
            
            const dominantFreq = this.findDominantFrequency(spectrum, freqRange);
            
            // Convert frequency to rate (BPM or breaths/min)
            let rate = dominantFreq * 60;
            
            // Apply temporal smoothing with rate history
            const rateHistory = type === 'bvp' ? this.bvpRateHistory : this.respRateHistory;
            
            if (isFinite(rate) && rate > 0) {
                // Add to history if it's a valid rate
                rateHistory.push(rate);
                
                // Keep reasonable history size
                if (rateHistory.length > this.RATE_SMOOTHING_WINDOW) {
                    rateHistory.shift();
                }
                
                // Use median filtering for stability if we have enough history
                if (rateHistory.length >= 3) {
                    const sortedRates = [...rateHistory].sort((a, b) => a - b);
                    rate = sortedRates[Math.floor(sortedRates.length / 2)];
                }
            } else if (rateHistory.length > 0) {
                // Use previous rate if current calculation is invalid
                rate = rateHistory[rateHistory.length - 1];
            }
            
            // Ensure rate is within physiological range
            if (type === 'bvp') {
                rate = Math.max(36, Math.min(198, rate));
            } else {
                rate = Math.max(6, Math.min(30, rate));
            }
            
            // Store rate in buffer
            buffer.rates.push({
                timestamp,
                value: rate,
                snr: 0, // Will be updated below
                quality: 'poor' // Will be updated below
            });
            
            // Trim buffer if needed
            if (buffer.rates.length > this.MAX_BUFFER) {
                buffer.rates = buffer.rates.slice(-this.MAX_BUFFER);
            }
            
            // Calculate signal quality
            const quality = this.calculateSignalQuality(spectrum, dominantFreq, freqRange, type);
            
            // Update the last rate entry with quality metrics
            if (buffer.rates.length > 0) {
                const lastIdx = buffer.rates.length - 1;
                buffer.rates[lastIdx].snr = quality.snr;
                buffer.rates[lastIdx].quality = quality.quality;
            }
            
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

        const normBVP = this.bvpBuffer.filtered.slice(-displaySamples);
        const normResp = this.respBuffer.filtered.slice(-displaySamples);

        // apply min-max normalization for BVP and Resp
        const minBVP = Math.min(...normBVP);
        const maxBVP = Math.max(...normBVP);
        const minResp = Math.min(...normResp);
        const maxResp = Math.max(...normResp);
        const rangeBVP = maxBVP - minBVP;
        const rangeResp = maxResp - minResp;
        const normalizedBVP = normBVP.map(val => (val - minBVP) / rangeBVP);
        const normalizedResp = normResp.map(val => (val - minResp) / rangeResp);

        return {
            bvp: this.bvpBuffer.raw.slice(-displaySamples),
            resp: this.respBuffer.raw.slice(-displaySamples),
            filteredBvp: normalizedBVP,
            filteredResp: normalizedResp
        };
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