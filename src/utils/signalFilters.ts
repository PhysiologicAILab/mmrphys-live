// src/utils/signalFilters.ts

export interface FilteredSignal {
    filteredData: number[];
    snr: number;
}

export class SignalFilters {
    private static readonly BVP_FREQ_RANGE = {
        low: 0.8,  // 48 BPM
        high: 3.0  // 180 BPM
    };

    private static readonly RESP_FREQ_RANGE = {
        low: 0.1,  // 6 breaths/minute
        high: 0.5  // 30 breaths/minute
    };

    /**
     * Implements a forward-backward band-pass filter to avoid phase delay
     */
    private static butterworth(
        signal: number[],
        samplingRate: number,
        lowCutoff: number,
        highCutoff: number,
        order: number = 2
    ): number[] {
        // Normalize frequencies
        const nyquist = samplingRate / 2;
        const lowW = lowCutoff / nyquist;
        const highW = highCutoff / nyquist;

        // Create filter coefficients
        const { b, a } = this.butterworthCoefficients(order, lowW, highW);

        // Forward filter
        let forward = this.filter(b, a, signal);

        // Reverse the signal
        forward.reverse();

        // Backward filter
        let backward = this.filter(b, a, forward);

        // Reverse back and return
        backward.reverse();
        return backward;
    }

    private static butterworthCoefficients(
        order: number,
        lowW: number,
        highW: number
    ): { b: number[]; a: number[] } {
        // Prewarp frequencies
        const lowWarp = Math.tan(Math.PI * lowW / 2);
        const highWarp = Math.tan(Math.PI * highW / 2);

        // Calculate coefficients for lowpass prototype
        const { b: bLow, a: aLow } = this.lowpassPrototype(order);

        // Transform to bandpass
        const { b, a } = this.lowpassToBandpass(bLow, aLow, lowWarp, highWarp);

        return { b, a };
    }

    private static lowpassPrototype(order: number): { b: number[]; a: number[] } {
        // Simplified 2nd order Butterworth prototype
        const b = [1.0, 0.0, 0.0];
        const a = [1.0, 1.4142, 1.0];
        return { b, a };
    }

    private static lowpassToBandpass(
        bLow: number[],
        aLow: number[],
        lowWarp: number,
        highWarp: number
    ): { b: number[]; a: number[] } {
        const center = Math.sqrt(lowWarp * highWarp);
        const bw = highWarp - lowWarp;

        // Transform coefficients
        const b = new Array(5).fill(0);
        const a = new Array(5).fill(0);

        b[0] = bLow[0] * bw;
        b[1] = 0;
        b[2] = -2 * bLow[0] * center;
        b[3] = 0;
        b[4] = bLow[0] * bw;

        a[0] = aLow[0] * bw;
        a[1] = 2 * aLow[0] * (center * center - 1);
        a[2] = 2 * aLow[0] * center * (bw - 2);
        a[3] = 2 * aLow[0] * (center * center - 1);
        a[4] = aLow[0] * bw;

        return { b, a };
    }

    private static filter(b: number[], a: number[], x: number[]): number[] {
        const len = x.length;
        const y = new Array(len).fill(0);
        const order = Math.max(b.length, a.length);

        // Normalize coefficients
        const bNorm = b.map(val => val / a[0]);
        const aNorm = a.map(val => val / a[0]);

        for (let i = 0; i < len; i++) {
            y[i] = bNorm[0] * x[i];

            for (let j = 1; j < order; j++) {
                if (j < bNorm.length && i - j >= 0) {
                    y[i] += bNorm[j] * x[i - j];
                }
                if (j < aNorm.length && i - j >= 0) {
                    y[i] -= aNorm[j] * y[i - j];
                }
            }
        }

        return y;
    }

    /**
     * Calculate Signal-to-Noise Ratio in dB
     */
    private static calculateSNR(
        signal: number[],
        samplingRate: number,
        freqRange: { low: number; high: number }
    ): number {
        // Get signal power in the frequency band of interest
        const filteredSignal = this.butterworth(
            signal,
            samplingRate,
            freqRange.low,
            freqRange.high
        );

        const signalPower = this.calculatePower(filteredSignal);

        // Get noise power (everything outside the band)
        const noise = signal.map((val, i) => val - filteredSignal[i]);
        const noisePower = this.calculatePower(noise);

        // Calculate SNR in dB
        return 10 * Math.log10(signalPower / (noisePower + Number.EPSILON));
    }

    private static calculatePower(signal: number[]): number {
        return signal.reduce((sum, val) => sum + val * val, 0) / signal.length;
    }

    /**
     * Process BVP signal with appropriate filtering
     */
    static processBVPSignal(signal: number[], samplingRate: number): FilteredSignal {
        const filteredData = this.butterworth(
            signal,
            samplingRate,
            this.BVP_FREQ_RANGE.low,
            this.BVP_FREQ_RANGE.high
        );

        const snr = this.calculateSNR(signal, samplingRate, this.BVP_FREQ_RANGE);

        return { filteredData, snr };
    }

    /**
     * Process respiratory signal with appropriate filtering
     */
    static processRespSignal(signal: number[], samplingRate: number): FilteredSignal {
        const filteredData = this.butterworth(
            signal,
            samplingRate,
            this.RESP_FREQ_RANGE.low,
            this.RESP_FREQ_RANGE.high
        );

        const snr = this.calculateSNR(signal, samplingRate, this.RESP_FREQ_RANGE);

        return { filteredData, snr };
    }
}