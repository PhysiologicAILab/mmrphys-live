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
            // Remove DC component and normalize
            const meanNormalized = this.removeDC(signal);
            const windowed = this.applyWindow(meanNormalized);

            // Compute FFT
            const fftResult = this.computeFFT(windowed);
            const { minFreq, maxFreq } = this.FREQ_RANGES[type];

            // Find dominant frequency
            const peakFreq = this.findDominantFrequency(fftResult, samplingRate, minFreq, maxFreq);

            // Convert to rate
            const rate = peakFreq * 60;

            // Assess signal quality
            const quality = this.assessSignalQuality(signal);

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

        // If signal quality is poor, return default
        if (quality.quality === 'poor' || quality.artifactRatio > 0.2) {
            return range.default;
        }

        // Constrain rate within physiological range
        return Math.min(Math.max(rate, range.min), range.max);
    }

    private static assessSignalQuality(signal: number[]): SignalMetrics['quality'] {
        const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
        const variance = signal.reduce((a, b) => a + (b - mean) ** 2, 0) / signal.length;
        const maxAmp = Math.max(...signal.map(Math.abs));

        const snr = variance > 0
            ? 10 * Math.log10(variance / (maxAmp * 0.1))
            : 0;

        const signalStrength = maxAmp;
        const artifactRatio = signal.filter(x => Math.abs(x) > 3 * Math.sqrt(variance)).length / signal.length;

        let quality: SignalMetrics['quality']['quality'] = 'poor';
        if (snr >= 10 && artifactRatio < 0.05) {
            quality = 'excellent';
        } else if (snr >= 5 && artifactRatio < 0.1) {
            quality = 'good';
        } else if (snr >= 0 && artifactRatio < 0.2) {
            quality = 'moderate';
        }

        return {
            snr: Math.max(0, snr),
            quality,
            signalStrength,
            artifactRatio
        };
    }

    private static removeDC(signal: number[]): number[] {
        const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
        return signal.map(x => x - mean);
    }

    private static applyWindow(signal: number[]): number[] {
        return signal.map((x, i) => {
            const term = 2 * Math.PI * i / (signal.length - 1);
            const window = 0.54 - 0.46 * Math.cos(term); // Hamming window
            return x * window;
        });
    }

    private static computeFFT(signal: number[]): { real: number[]; imag: number[] } {
        const n = signal.length;
        const result = {
            real: new Array(n).fill(0),
            imag: new Array(n).fill(0)
        };

        // Initialize with input signal
        for (let i = 0; i < n; i++) {
            result.real[i] = signal[i];
        }

        // Cooley-Tukey FFT implementation
        const bits = Math.log2(n);

        // Bit reversal
        for (let i = 0; i < n; i++) {
            let rev = 0;
            for (let j = 0; j < bits; j++) {
                rev = (rev << 1) | ((i >> j) & 1);
            }
            if (rev > i) {
                [result.real[i], result.real[rev]] = [result.real[rev], result.real[i]];
                [result.imag[i], result.imag[rev]] = [result.imag[rev], result.imag[i]];
            }
        }

        // FFT computation
        for (let step = 2; step <= n; step *= 2) {
            const halfStep = step / 2;
            const angle = -2 * Math.PI / step;

            for (let group = 0; group < n; group += step) {
                for (let pair = 0; pair < halfStep; pair++) {
                    const twiddle = {
                        real: Math.cos(angle * pair),
                        imag: Math.sin(angle * pair)
                    };

                    const pos = group + pair;
                    const match = group + pair + halfStep;

                    const product = {
                        real: twiddle.real * result.real[match] - twiddle.imag * result.imag[match],
                        imag: twiddle.real * result.imag[match] + twiddle.imag * result.real[match]
                    };

                    [result.real[match], result.imag[match]] = [
                        result.real[pos] - product.real,
                        result.imag[pos] - product.imag
                    ];

                    result.real[pos] += product.real;
                    result.imag[pos] += product.imag;
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

        // Calculate power spectrum
        const powerSpectrum = new Array(Math.floor(n / 2)).fill(0);
        for (let i = 0; i < n / 2; i++) {
            powerSpectrum[i] = Math.sqrt(
                fft.real[i] * fft.real[i] + fft.imag[i] * fft.imag[i]
            );
        }

        // Find peak in the physiological range
        let maxPower = 0;
        let peakIdx = 0;

        const minIdx = Math.floor(minFreq / freqResolution);
        const maxIdx = Math.min(Math.ceil(maxFreq / freqResolution), Math.floor(n / 2));

        for (let i = minIdx; i <= maxIdx; i++) {
            if (powerSpectrum[i] > maxPower) {
                maxPower = powerSpectrum[i];
                peakIdx = i;
            }
        }

        // Interpolate peak for better frequency resolution
        const interpolatedFreq = this.interpolatePeak(powerSpectrum, peakIdx, samplingRate);

        // Convert to BPM/breaths per minute
        return interpolatedFreq * 60;
    }

    private static interpolatePeak(
        spectrum: number[],
        peakIdx: number,
        samplingRate: number
    ): number {
        if (peakIdx <= 0 || peakIdx >= spectrum.length - 1) {
            return (peakIdx * samplingRate) / spectrum.length;
        }

        const alpha = spectrum[peakIdx - 1];
        const beta = spectrum[peakIdx];
        const gamma = spectrum[peakIdx + 1];

        const p = 0.5 * (alpha - gamma) / (alpha - 2 * beta + gamma);
        const interpolatedIdx = peakIdx + p;

        return (interpolatedIdx * samplingRate) / spectrum.length;
    }

    // Public bandpass filter method for preprocessing
    public static bandpassFilter(
        signal: number[],
        samplingRate: number,
        lowCutoff: number,
        highCutoff: number
    ): number[] {
        const fft = this.computeFFT(signal);
        const n = signal.length;

        // Apply frequency domain filter
        for (let i = 0; i < n; i++) {
            const freq = (i * samplingRate) / n;
            if (freq < lowCutoff || freq > highCutoff) {
                fft.real[i] = 0;
                fft.imag[i] = 0;
            }
        }

        // Inverse FFT
        for (let i = 0; i < n; i++) {
            fft.imag[i] = -fft.imag[i];
        }

        const ifft = this.computeFFT(fft.real);
        return ifft.real.map(x => x / n);
    }
}