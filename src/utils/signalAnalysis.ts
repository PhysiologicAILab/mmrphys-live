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

//     // Apply appropriate bandpass filter based on signal type
//     public applySignalFilter(signal: number[], fs: number, type: 'heart' | 'resp'): number[] {
//     if (signal.length === 0) return [];

//     // Select filter parameters based on signal type
//     if (type === 'heart') {
//         // BVP: 0.6 Hz to 3.3 Hz
//         return this.applyButterworthBandpass(signal, 0.6, 3.3, fs);
//     } else {
//         // Respiratory: 0.1 Hz to 0.54 Hz
//         return this.applyButterworthBandpass(signal, 0.1, 0.54, fs);
//     }
// }


export class SignalFilters {

    private a: number[] = [];
    private b: number[] = [];

    constructor(lowCutoff: number, highCutoff: number, fs: number) {
        this.designButterworth(lowCutoff, highCutoff, fs);
    }


    // Design a 2nd order Butterworth bandpass filter
    private designButterworth(lowCutoff: number, highCutoff: number, fs: number): void {
        // Normalize frequencies to Nyquist frequency
        const nyquist = fs / 2;
        const wLow = Math.tan((Math.PI * lowCutoff) / nyquist);
        const wHigh = Math.tan((Math.PI * highCutoff) / nyquist);

        // Calculate filter coefficients
        const K = 1 / (wHigh - wLow);

        // Second-order section coefficients
        const b0 = K * (wHigh - wLow);
        const b1 = 0;
        const b2 = -b0;

        const a0 = 1 + K * (wHigh - wLow) + (wHigh * wLow * K * K);
        const a1 = 2 * (wHigh * wLow * K * K - 1);
        const a2 = 1 - K * (wHigh - wLow) + (wHigh * wLow * K * K);

        // Normalize coefficients
        this.b = [b0 / a0, b1 / a0, b2 / a0];
        this.a = [1, a1 / a0, a2 / a0]; 
    }    

    // Simple 1D filter (lfilter equivalent)
    private lfilter(signal: number[]): number[] {
        const result = new Array(signal.length).fill(0);
        const x = [...signal];
        const y = [...result];

        for (let i = 0; i < signal.length; i++) {
            y[i] = this.b[0] * x[i];

            // Add input history
            for (let j = 1; j < this.b.length && i - j >= 0; j++) {
                y[i] += this.b[j] * x[i - j];
            }

            // Subtract output history
            for (let j = 1; j < this.a.length && i - j >= 0; j++) {
                y[i] -= this.a[j] * y[i - j];
            }
        }

        return y;
    }

    // Apply forward-backward zero-phase filter (filtfilt equivalent)
    public applyButterworthBandpass(signal: number[]): number[] {
        if (signal.length === 0) return [];

        // Forward filter
        const forwardFiltered = this.lfilter(signal);

        // Reverse and filter again
        const reversed = [...forwardFiltered].reverse();
        const backwardFiltered = this.lfilter(reversed);

        // Reverse again to get zero-phase result
        return backwardFiltered.reverse();
    }
}

export class SignalAnalyzer {
    private static readonly FREQ_RANGES = {
        heart: {
            minFreq: 0.6,   // 36 BPM
            maxFreq: 3.3    // 198 BPM
        },
        resp: {
            minFreq: 0.1,   // 6 breaths/minute
            maxFreq: 0.54    // 32 breaths/minute
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
            max: 32,
            default: 15
        }
    };

    /**
     * Analyze physiological signal and return comprehensive metrics
     */
    public static analyzeSignal(
        signal: number[],
        raw: number[],
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

            // Step 1: Remove DC component
            processedSignal = this.removeDC(processedSignal);

            // Step 2: Apply windowing function to reduce spectral leakage
            const windowed = this.applyWindow(processedSignal);

            // Step 3: Compute FFT
            const fftResult = this.computeFFT(windowed);

            // Step 4: Find dominant frequency
            const { minFreq, maxFreq } = this.FREQ_RANGES[type];
            const peakFreq = this.findDominantFrequency(fftResult, samplingRate, minFreq, maxFreq);

            // Convert to rate
            const rate = peakFreq * 60;
            console.log(`${type}: Calculated rate before validation: ${rate.toFixed(1)}`);

            // Assess signal quality
            const quality = this.assessSignalQuality(processedSignal, raw);

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
    
    /**
     * Calculate Signal-to-Noise Ratio in dB
     */
    private static calculateSNR(signal: number[], raw: number[]): number {
        const signalPower = this.calculatePower(signal);

        // Calculate noise as the difference between raw and filtered signals
        const noise = raw.map((val, i) => val - signal[i]);
        const noisePower = this.calculatePower(noise);

        // Handle zero noise power
        if (noisePower === 0) {
            console.warn('Noise power is zero, setting SNR to a minimum threshold');
            return 0.01; // Minimum SNR threshold
        }

        return 10 * Math.log10(signalPower / noisePower);
    }

    private static calculatePower(signal: number[]): number {
        return signal.reduce((sum, val) => sum + val * val, 0) / signal.length;
    }

    // Update the assessSignalQuality method to properly calculate SNR
    private static assessSignalQuality(signal: number[], raw: number[]): SignalMetrics['quality'] {
        if (signal.length < 30) {
            return {
                snr: 0,
                quality: 'poor',
                signalStrength: 0,
                artifactRatio: 1
            };
        }

        try {

            // Calculate SNR using the improved method
            const snr = this.calculateSNR(signal, raw);

            // Calculate signal strength using RMS
            const rms = Math.sqrt(signal.reduce((sum, val) => sum + val * val, 0) / signal.length);
            const signalStrength = Math.min(Math.max(rms * 10, 0), 1);

            // Calculate artifact ratio
            const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
            const std = Math.sqrt(signal.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / signal.length);
            const artifactRatio = signal.filter(x => Math.abs(x - mean) > 2 * std).length / signal.length;

            // Determine quality level based on metrics
            let quality: SignalMetrics['quality']['quality'] = 'poor';
            if (snr >= 10 && artifactRatio < 0.1 && signalStrength > 0.3) {
                quality = 'excellent';
            } else if (snr >= 5 && artifactRatio < 0.2 && signalStrength > 0.2) {
                quality = 'good';
            } else if (snr >= 3 && artifactRatio < 0.3) {
                quality = 'moderate';
            }

            return {
                snr,
                quality,
                signalStrength,
                artifactRatio
            };
        } catch (error) {
            console.error('Error in signal quality assessment:', error);
            return {
                snr: 0,
                quality: 'poor',
                signalStrength: 0,
                artifactRatio: 1
            };
        }
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