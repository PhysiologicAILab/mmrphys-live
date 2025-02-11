// src/workers/signalProcessingWorker.ts
/// <reference lib="webworker" />

interface ProcessMessage {
    type: 'process';
    bvpSignal: number[];
    respSignal: number[];
    samplingRate: number;
}

interface SignalQuality {
    snr: number;
    quality: 'good' | 'moderate' | 'poor';
    confidence: number;
}

interface ProcessResponse {
    type: 'process';
    status: 'success' | 'error';
    results?: {
        bvp: {
            rate: number;
            quality: SignalQuality;
        };
        resp: {
            rate: number;
            quality: SignalQuality;
        };
    };
    error?: string;
}

class SignalProcessor {
    private readonly BVP_FREQ_RANGE = { min: 0.8, max: 3.0 }; // 48-180 BPM
    private readonly RESP_FREQ_RANGE = { min: 0.1, max: 0.5 }; // 6-30 breaths/min
    private readonly BVP_VALID_RANGE = { min: 40, max: 180 };
    private readonly RESP_VALID_RANGE = { min: 6, max: 30 };

    private removeDC(signal: number[]): number[] {
        const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
        return signal.map(x => x - mean);
    }

    private applyHamming(signal: number[]): number[] {
        return signal.map((x, i) => {
            const term = 2 * Math.PI * i / (signal.length - 1);
            const window = 0.54 - 0.46 * Math.cos(term);
            return x * window;
        });
    }

    private fft(signal: number[]): { real: number[], imag: number[] } {
        const n = signal.length;
        const result = {
            real: new Array(n).fill(0),
            imag: new Array(n).fill(0)
        };

        // Copy input to real part
        for (let i = 0; i < n; i++) {
            result.real[i] = signal[i];
        }

        // Bit reversal
        let j = 0;
        for (let i = 0; i < n - 1; i++) {
            if (i < j) {
                [result.real[i], result.real[j]] = [result.real[j], result.real[i]];
                [result.imag[i], result.imag[j]] = [result.imag[j], result.imag[i]];
            }
            let k = n >> 1;
            while (k <= j) {
                j -= k;
                k >>= 1;
            }
            j += k;
        }

        // FFT computation
        for (let size = 2; size <= n; size *= 2) {
            const halfsize = size / 2;
            const tablestep = n / size;
            for (let i = 0; i < n; i += size) {
                for (let j = i, k = 0; j < i + halfsize; j++, k += tablestep) {
                    const tr = result.real[j + halfsize] * Math.cos(2 * Math.PI * k / n) +
                        result.imag[j + halfsize] * Math.sin(2 * Math.PI * k / n);
                    const ti = -result.real[j + halfsize] * Math.sin(2 * Math.PI * k / n) +
                        result.imag[j + halfsize] * Math.cos(2 * Math.PI * k / n);
                    result.real[j + halfsize] = result.real[j] - tr;
                    result.imag[j + halfsize] = result.imag[j] - ti;
                    result.real[j] += tr;
                    result.imag[j] += ti;
                }
            }
        }

        return result;
    }

    private findPeakFrequency(
        fftResult: { real: number[], imag: number[] },
        samplingRate: number,
        freqRange: { min: number, max: number }
    ): number {
        const n = fftResult.real.length;
        const freqStep = samplingRate / n;

        // Calculate power spectrum
        const powerSpectrum = new Array(Math.floor(n / 2));
        for (let i = 0; i < n / 2; i++) {
            powerSpectrum[i] = Math.sqrt(
                fftResult.real[i] ** 2 + fftResult.imag[i] ** 2
            );
        }

        // Find peaks in the frequency range
        let maxPower = 0;
        let peakFreq = 0;
        const minBin = Math.floor(freqRange.min / freqStep);
        const maxBin = Math.ceil(freqRange.max / freqStep);

        for (let i = minBin; i <= maxBin && i < n / 2; i++) {
            if (powerSpectrum[i] > maxPower) {
                // Check if it's a local maximum
                if (i > 0 && i < n / 2 - 1 &&
                    powerSpectrum[i] > powerSpectrum[i - 1] &&
                    powerSpectrum[i] > powerSpectrum[i + 1]) {
                    maxPower = powerSpectrum[i];
                    peakFreq = i * freqStep;
                }
            }
        }

        // Interpolate peak for better accuracy
        if (peakFreq > 0) {
            const bin = Math.floor(peakFreq / freqStep);
            const alpha = powerSpectrum[bin - 1];
            const beta = powerSpectrum[bin];
            const gamma = powerSpectrum[bin + 1];
            const p = 0.5 * (alpha - gamma) / (alpha - 2 * beta + gamma);
            peakFreq = (bin + p) * freqStep;
        }

        return peakFreq;
    }

    private assessSignalQuality(signal: number[]): SignalQuality {
        const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
        const variance = signal.reduce((a, b) => a + (b - mean) ** 2, 0) / signal.length;
        const maxAmp = Math.max(...signal.map(Math.abs));

        // Calculate SNR
        const snr = 10 * Math.log10(variance / (maxAmp * 0.1));

        // Calculate artifact ratio
        const threshold = 3 * Math.sqrt(variance);
        const artifactCount = signal.filter(x => Math.abs(x - mean) > threshold).length;
        const artifactRatio = artifactCount / signal.length;

        // Determine quality and confidence
        let quality: 'good' | 'moderate' | 'poor';
        let confidence: number;

        if (snr > 10 && artifactRatio < 0.1) {
            quality = 'good';
            confidence = 0.9;
        } else if (snr > 5 && artifactRatio < 0.2) {
            quality = 'moderate';
            confidence = 0.7;
        } else {
            quality = 'poor';
            confidence = 0.5;
        }

        return { snr, quality, confidence };
    }

    private validateRate(rate: number, type: 'bvp' | 'resp'): number {
        const range = type === 'bvp' ? this.BVP_VALID_RANGE : this.RESP_VALID_RANGE;
        return Math.min(Math.max(rate, range.min), range.max);
    }

    processSignal(
        signal: number[],
        samplingRate: number,
        type: 'bvp' | 'resp'
    ): { rate: number; quality: SignalQuality } {
        // Remove DC component and apply window
        const normalizedSignal = this.removeDC(signal);
        const windowedSignal = this.applyHamming(normalizedSignal);

        // Compute FFT
        const fftResult = this.fft(windowedSignal);

        // Find peak frequency
        const freqRange = type === 'bvp' ? this.BVP_FREQ_RANGE : this.RESP_FREQ_RANGE;
        const peakFreq = this.findPeakFrequency(fftResult, samplingRate, freqRange);

        // Convert to rate and validate
        const rawRate = peakFreq * 60;
        const rate = this.validateRate(rawRate, type);

        // Assess signal quality
        const quality = this.assessSignalQuality(signal);

        return { rate, quality };
    }
}

// Initialize processor
const processor = new SignalProcessor();

// Handle messages
self.onmessage = (e: MessageEvent<ProcessMessage>) => {
    try {
        if (e.data.type !== 'process') {
            throw new Error('Invalid message type');
        }

        const { bvpSignal, respSignal, samplingRate } = e.data;

        // Validate inputs
        if (!bvpSignal?.length || !respSignal?.length || !samplingRate) {
            throw new Error('Invalid input data');
        }

        // Process both signals
        const bvpResult = processor.processSignal(bvpSignal, samplingRate, 'bvp');
        const respResult = processor.processSignal(respSignal, samplingRate, 'resp');

        // Send results
        const response: ProcessResponse = {
            type: 'process',
            status: 'success',
            results: {
                bvp: bvpResult,
                resp: respResult
            }
        };

        self.postMessage(response);
    } catch (error) {
        const errorResponse: ProcessResponse = {
            type: 'process',
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
        };
        self.postMessage(errorResponse);
    }
};