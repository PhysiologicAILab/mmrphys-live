// src/utils/signalAnalysis.ts

export interface SignalQuality {
    snr: number;           // Signal-to-noise ratio
    signalStrength: number;// Overall signal strength
    artifactRatio: number; // Ratio of artifacts detected
    quality: 'excellent' | 'good' | 'moderate' | 'poor';
}

export interface SignalMetrics {
    rate: number;
    quality: SignalQuality;
}

export class SignalAnalyzer {
    private static readonly FREQ_RANGES = {
        heart: {
            minFreq: 0.6,   // 36 BPM
            maxFreq: 3.3    // 198 BPM
        },
        resp: {
            minFreq: 0.1,   // 6 breaths/minute
            maxFreq: 0.5    // 30 breaths/minute
        }
    };

    private static readonly RATE_RANGES = {
        heart: {
            min: 36,
            max: 198,
            default: 75
        },
        resp: {
            min: 6,
            max: 30,
            default: 15
        }
    };

    /**
     * Analyze physiological signal and return comprehensive metrics
     */
    public static analyzeSignal(
        signal: number[],
        samplingRate: number,
        type: 'heart' | 'resp'
    ): SignalMetrics {
        // Validate input
        if (!signal?.length || signal.length < samplingRate) {
            return this.getDefaultMetrics(type);
        }

        try {
            // Apply specific preprocessing for heart rate vs respiratory signals
            let processedSignal = [...signal];

            // Check signal variance - flat signals will cause problems
            const variance = this.calculateVariance(processedSignal);
            if (variance < 1e-6) {
                console.log(`${type}: Signal variance too low (${variance.toFixed(8)}), using default metrics`);
                return this.getDefaultMetrics(type);
            }

            // Step 1: Remove DC component
            processedSignal = this.removeDC(processedSignal);

            // Step 2: Apply moving average filter
            // Different window sizes for heart rate and respiratory signals
            const windowSize = type === 'heart' ? Math.ceil(samplingRate * 0.15) : Math.ceil(samplingRate * 0.4);
            processedSignal = this.applyMovingAverage(processedSignal, windowSize);

            // Step 3: Apply windowing function to reduce spectral leakage
            const windowed = this.applyWindow(processedSignal);

            // Step 4: Compute FFT
            const fftResult = this.computeFFT(windowed);

            // Step 5: Find dominant frequency
            const { minFreq, maxFreq } = this.FREQ_RANGES[type];
            const peakFreq = this.findDominantFrequency(fftResult, samplingRate, minFreq, maxFreq);

            // Convert to rate
            const rate = peakFreq * 60;
            console.log(`${type}: Calculated rate before validation: ${rate.toFixed(1)}`);

            // Assess signal quality
            const quality = this.assessSignalQuality(processedSignal);

            // Validate rate
            const validatedRate = this.validateRate(rate, type, quality);

            return {
                rate: validatedRate,
                quality
            };
        } catch (error) {
            console.warn(`Signal analysis error for ${type}:`, error);
            return this.getDefaultMetrics(type);
        }
    }

    /**
     * Apply simple moving average filter
     */
    public static applyMovingAverage(signal: number[], windowSize: number): number[] {
        if (signal.length < windowSize || windowSize < 2) return [...signal];

        const halfWindow = Math.floor(windowSize / 2);
        const result = new Array(signal.length);

        for (let i = 0; i < signal.length; i++) {
            let sum = 0;
            let count = 0;

            for (let j = Math.max(0, i - halfWindow); j <= Math.min(signal.length - 1, i + halfWindow); j++) {
                if (isFinite(signal[j])) {
                    sum += signal[j];
                    count++;
                }
            }

            result[i] = count > 0 ? sum / count : signal[i];
        }

        return result;
    }

    // Helper method to calculate signal variance
    private static calculateVariance(signal: number[]): number {
        if (!signal.length) return 0;
        const mean = signal.reduce((sum, val) => sum + val, 0) / signal.length;
        return signal.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / signal.length;
    }

    // Zero-padding for better FFT frequency resolution
    private static zeroPad(signal: number[], targetLength: number): number[] {
        if (signal.length >= targetLength) return signal;
        const padded = new Array(targetLength).fill(0);
        for (let i = 0; i < signal.length; i++) {
            padded[i] = signal[i];
        }
        return padded;
    }

    private static getDefaultMetrics(type: 'heart' | 'resp'): SignalMetrics {
        const defaultRates = this.RATE_RANGES[type];
        return {
            rate: defaultRates.default,
            quality: {
                snr: 0,
                quality: 'poor',
                signalStrength: 0,
                artifactRatio: 1
            }
        };
    }

    private static validateRate(
        rate: number,
        type: 'heart' | 'resp',
        quality: SignalMetrics['quality']
    ): number {
        const range = this.RATE_RANGES[type];

        // Less strict quality check - only use default for very poor signals
        if (quality.quality === 'poor' && quality.artifactRatio > 0.4) {
            console.log(`${type} rate rejected due to poor quality: artifactRatio=${quality.artifactRatio.toFixed(2)}`);
            return range.default;
        }

        // Constrain rate within physiological range
        const constrainedRate = Math.min(Math.max(rate, range.min), range.max);

        // Log if rate was constrained
        if (constrainedRate !== rate) {
            console.log(`${type} rate constrained from ${rate.toFixed(1)} to ${constrainedRate.toFixed(1)}`);
        }

        return constrainedRate;
    }

    private static assessSignalQuality(signal: number[]): SignalMetrics['quality'] {
        // Calculate basic statistics
        const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
        const variance = signal.reduce((a, b) => a + (b - mean) ** 2, 0) / signal.length;
        const stdDev = Math.sqrt(variance);

        // Apply a simple window for spectral analysis
        const windowedSignal = this.applyWindow(signal);
        const fft = this.computeFFT(windowedSignal);

        // Simple SNR calculation - ratio between signal and noise bands
        const signalPower = this.calculateInBandPower(fft, 0.5, 3.0); // Physiological band
        const totalPower = this.calculateTotalPower(fft);
        const outOfBandPower = totalPower - signalPower;

        const snr = signalPower > 0 && outOfBandPower > 0
            ? 10 * Math.log10(signalPower / outOfBandPower)
            : 0;

        // Calculate artifact ratio - proportion of samples outside 3 std devs
        const artifactRatio = signal.filter(x => Math.abs(x - mean) > 3 * stdDev).length / signal.length;

        // Simple signal strength measure
        const rms = Math.sqrt(signal.reduce((sum, val) => sum + val * val, 0) / signal.length);
        const maxAmp = Math.max(...signal.map(Math.abs));
        const signalStrength = rms > 0 ? maxAmp / rms : 0;

        // Simplified quality determination
        let quality: SignalMetrics['quality']['quality'] = 'poor';
        if (snr >= 8 && artifactRatio < 0.05 && signalStrength > 1.5) {
            quality = 'excellent';
        } else if (snr >= 4 && artifactRatio < 0.1 && signalStrength > 1.2) {
            quality = 'good';
        } else if (snr >= 2 && artifactRatio < 0.15) {
            quality = 'moderate';
        }

        return {
            snr: Math.max(0, snr),
            quality,
            signalStrength,
            artifactRatio
        };
    }

    private static calculateInBandPower(fft: { real: number[], imag: number[] }, minFreq: number, maxFreq: number): number {
        const n = fft.real.length;
        let power = 0;

        for (let i = 0; i < n / 2; i++) {
            const freq = i / n;
            if (freq >= minFreq && freq <= maxFreq) {
                power += fft.real[i] * fft.real[i] + fft.imag[i] * fft.imag[i];
            }
        }

        return power;
    }

    private static calculateTotalPower(fft: { real: number[], imag: number[] }): number {
        const n = fft.real.length;
        let power = 0;

        for (let i = 0; i < n / 2; i++) {
            power += fft.real[i] * fft.real[i] + fft.imag[i] * fft.imag[i];
        }

        return power;
    }

    // Simple DC removal
    public static removeDC(signal: number[]): number[] {
        if (signal.length === 0) return [];

        // Calculate simple mean
        const mean = signal.reduce((sum, val) => sum + val, 0) / signal.length;

        // Subtract mean from each sample
        return signal.map(val => val - mean);
    }

    private static applyWindow(signal: number[]): number[] {
        return signal.map((x, i) => {
            const term = 2 * Math.PI * i / (signal.length - 1);
            const window = 0.54 - 0.46 * Math.cos(term); // Hamming window
            return x * window;
        });
    }

    private static computeFFT(signal: number[]): { real: number[]; imag: number[] } {
        // Validate input signal first
        const validatedSignal = signal.map(val => isFinite(val) ? val : 0);

        const n = validatedSignal.length;
        const result = {
            real: new Array(n).fill(0),
            imag: new Array(n).fill(0)
        };

        // Initialize with validated input signal
        for (let i = 0; i < n; i++) {
            result.real[i] = validatedSignal[i];
        }

        // Check if we have a power of 2
        const nextPowerOf2 = Math.pow(2, Math.ceil(Math.log2(n)));
        if (n !== nextPowerOf2) {
            // If not a power of 2, pad with zeros
            result.real = this.zeroPad(result.real, nextPowerOf2);
            result.imag = this.zeroPad(result.imag, nextPowerOf2);
        }

        // Updated n after potential padding
        const adjustedN = result.real.length;
        const bits = Math.log2(adjustedN);

        // Bit reversal
        for (let i = 0; i < adjustedN; i++) {
            let rev = 0;
            for (let j = 0; j < bits; j++) {
                rev = (rev << 1) | ((i >> j) & 1);
            }
            if (rev > i) {
                [result.real[i], result.real[rev]] = [result.real[rev], result.real[i]];
                [result.imag[i], result.imag[rev]] = [result.imag[rev], result.imag[i]];
            }
        }

        // FFT computation with stability checks
        for (let step = 2; step <= adjustedN; step *= 2) {
            const halfStep = step / 2;
            const angle = -2 * Math.PI / step;

            for (let group = 0; group < adjustedN; group += step) {
                for (let pair = 0; pair < halfStep; pair++) {
                    const twiddle = {
                        real: Math.cos(angle * pair),
                        imag: Math.sin(angle * pair)
                    };

                    const pos = group + pair;
                    const match = group + pair + halfStep;

                    // Safe computation with checks for numerical stability
                    const product = {
                        real: twiddle.real * result.real[match] - twiddle.imag * result.imag[match],
                        imag: twiddle.real * result.imag[match] + twiddle.imag * result.real[match]
                    };

                    // Check for non-finite values
                    if (!isFinite(product.real)) product.real = 0;
                    if (!isFinite(product.imag)) product.imag = 0;

                    const newMatchReal = result.real[pos] - product.real;
                    const newMatchImag = result.imag[pos] - product.imag;

                    // Ensure result values are finite
                    result.real[match] = isFinite(newMatchReal) ? newMatchReal : 0;
                    result.imag[match] = isFinite(newMatchImag) ? newMatchImag : 0;

                    const newPosReal = result.real[pos] + product.real;
                    const newPosImag = result.imag[pos] + product.imag;

                    result.real[pos] = isFinite(newPosReal) ? newPosReal : 0;
                    result.imag[pos] = isFinite(newPosImag) ? newPosImag : 0;
                }
            }
        }

        return result;
    }

    private static findDominantFrequency(
        fft: { real: number[]; imag: number[] },
        samplingRate: number,
        minFreq: number,
        maxFreq: number
    ): number {
        const n = fft.real.length;
        const freqResolution = samplingRate / n;

        // Validate FFT input
        if (fft.real.some(val => !isFinite(val)) || fft.imag.some(val => !isFinite(val))) {
            console.error("FFT contains non-finite values, returning center frequency");
            return (minFreq + maxFreq) / 2;
        }

        // Calculate power spectrum
        const powerSpectrum = new Array(Math.floor(n / 2)).fill(0);
        for (let i = 0; i < n / 2; i++) {
            const realVal = isFinite(fft.real[i]) ? fft.real[i] : 0;
            const imagVal = isFinite(fft.imag[i]) ? fft.imag[i] : 0;
            powerSpectrum[i] = realVal * realVal + imagVal * imagVal;
        }

        // Find peak in the physiological frequency range
        const minIdx = Math.max(1, Math.floor(minFreq / freqResolution));
        const maxIdx = Math.min(Math.ceil(maxFreq / freqResolution), Math.floor(n / 2) - 1);

        // Find the peak
        let maxPower = 0;
        let peakIdx = minIdx;

        for (let i = minIdx; i <= maxIdx; i++) {
            if (powerSpectrum[i] > maxPower) {
                maxPower = powerSpectrum[i];
                peakIdx = i;
            }
        }

        // If no significant peak found, return the center frequency
        if (maxPower < 1e-6) {
            return (minFreq + maxFreq) / 2;
        }

        // Simple peak frequency calculation
        return peakIdx * freqResolution;
    }
}