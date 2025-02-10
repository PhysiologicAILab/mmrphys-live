// src/utils/signalAnalysis.ts

export interface SignalQuality {
    snr: number;           // Signal-to-noise ratio
    signalStrength: number;// Overall signal strength
    artifactRatio: number; // Ratio of artifacts detected
}

export interface FrequencyRange {
    minFreq: number;
    maxFreq: number;
}

export class SignalAnalyzer {
    private static readonly FREQ_RANGES = {
        heart: {
            minFreq: 0.8,  // 48 BPM
            maxFreq: 3.0   // 180 BPM
        },
        resp: {
            minFreq: 0.1,  // 6 breaths/minute
            maxFreq: 0.5   // 30 breaths/minute
        }
    };

    /**
     * Calculate vital signs using FFT analysis
     * @param signal Input signal array
     * @param samplingRate Sampling rate in Hz
     * @param type Type of vital sign ('heart' or 'resp')
     * @returns Calculated rate in BPM or breaths per minute
     */
    public static calculateRate(signal: number[], samplingRate: number, type: 'heart' | 'resp'): number {
        // Validate input
        if (!signal?.length || signal.length < samplingRate) {
            throw new Error('Invalid signal input');
        }

        // Check signal quality
        const quality = this.assessSignalQuality(signal);
        if (quality.signalStrength < 0.01 || quality.artifactRatio > 0.1) {
            console.warn(`Poor ${type} signal quality detected`);
            return type === 'heart' ? 75 : 15; // Return physiological defaults
        }

        // Process signal
        const meanNormalized = this.removeDC(signal);
        const windowed = this.applyWindow(meanNormalized);
        const fftResult = this.computeFFT(windowed);
        const { minFreq, maxFreq } = this.FREQ_RANGES[type];

        // Find dominant frequency
        const rate = this.findDominantFrequency(fftResult, samplingRate, minFreq, maxFreq);

        // Validate result
        const validRange = type === 'heart'
            ? { min: 40, max: 180 }   // Heart rate range
            : { min: 6, max: 30 };    // Respiratory rate range

        if (rate < validRange.min || rate > validRange.max) {
            console.warn(`${type} rate outside physiological range:`, rate);
            return type === 'heart' ? 75 : 15;
        }

        return rate;
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

        // Convert to BPM
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

    private static assessSignalQuality(signal: number[]): SignalQuality {
        const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
        const variance = signal.reduce((a, b) => a + (b - mean) ** 2, 0) / signal.length;
        const maxAmp = Math.max(...signal.map(Math.abs));

        return {
            snr: 10 * Math.log10(variance / (maxAmp * 0.1)),
            signalStrength: maxAmp,
            artifactRatio: signal.filter(x => Math.abs(x) > 3 * variance).length / signal.length
        };
    }

    // Optional: Bandpass filter implementation
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