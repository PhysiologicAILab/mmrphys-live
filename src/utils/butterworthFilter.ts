// src/utils/butterworthFilter.ts

export class ButterworthFilter {
    private a: number[]; // Denominator coefficients
    private b: number[]; // Numerator coefficients
    private z: number[]; // Filter state

    constructor(filterCoefficients: { a: number[]; b: number[] }) {
        this.a = [...filterCoefficients.a];
        this.b = [...filterCoefficients.b];

        // Initialize state with zeros (length of max(a,b) - 1)
        const stateLength = Math.max(this.a.length, this.b.length) - 1;
        this.z = new Array(stateLength).fill(0);
    }

    // Static method to design bandpass filter coefficients
    public static designBandpass(type: string, fs: number): { a: number[]; b: number[] } {
        // For 30 Hz sampling rate
        if (Math.abs(fs - 30) < 2) {
            if (type == 'heart' || type === 'bvp') {
                // Heart rate filter (BVP)
                return {
                    b: [0.0020455680125194987, 0.0, -0.008182272050077995, 0.0, 0.012273408075116992, 0.0, -0.008182272050077995, 0.0, 0.0020455680125194987],
                    a: [1.0, -6.429153244554594, 18.35573690336414, -30.426989128868996, 32.048928610075976, -21.97239787228436, 9.576380298220101, -2.4260933166805474, 0.27361910759140307]                };
            } else if (type === 'resp') {
                // Respiratory rate filter
                return {
                    b: [3.0449114368910954e-06, 0.0, -1.2179645747564382e-05, 0.0, 1.8269468621346573e-05, 0.0, -1.2179645747564382e-05, 0.0, 3.0449114368910954e-06],
                    a: [1.0, -7.763667588569699, 26.384525726395264, -51.2662997663994, 62.29224366537488, -48.468114666714555, 23.58301347523423, -6.560640012022943, 0.7989391667826891]                };
            }
        }
        // For 25 Hz sampling rate
        else if (Math.abs(fs - 25) < 2) {
            if (type == 'heart' || type === 'bvp') {
                // Heart rate filter (BVP)
                return {
                    b: [0.003848321185088832, 0.0, -0.015393284740355328, 0.0, 0.023089927110532992, 0.0, -0.015393284740355328, 0.0, 0.003848321185088832],
                    a: [1.0, -6.060197542467618, 16.410773558824282, -25.98812656980202, 26.356585400768815, -17.537949241956113, 7.477218523672586, -1.86757409602836, 0.20939072558394267]                };
            } else if (type === 'resp') {
                // Respiratory rate filter
                return {
                    b: [6.180333567405893e-06, 0.0, -2.4721334269623573e-05, 0.0, 3.708200140443536e-05, 0.0, -2.4721334269623573e-05, 0.0, 6.180333567405893e-06],
                    a: [1.0, -7.713641149176652, 26.05181854215646, -50.31778520591906, 60.78963740174801, -47.03960026228499, 22.76801543993095, -6.302276857183642, 0.7638320910675092]
                };
            }
        }

        // Default - return empty coefficients
        console.error(`Unsupported filter parameters: fs=${fs}, type=${type}`);
        return { a: [1], b: [1] }; // Identity filter (passthrough)
    }

    // Simple 1D filter (lfilter equivalent)
    private lfilter(signal: number[]): number[] {
        const result = new Array(signal.length).fill(0);
        const x = [...signal];
        const y = [...result];


        // If a[0] is not 1, normalize both a and b coefficients
        if (this.a[0] !== 1) {
            const a0 = this.a[0];
            for (let i = 0; i < this.b.length; i++) this.b[i] /= a0;
            for (let i = 0; i < this.a.length; i++) this.a[i] /= a0;
        }

        for (let i = 0; i < x.length; i++) {
            // Apply the numerator coefficients (b terms)
            for (let j = 0; j < this.b.length; j++) {
                if (i - j >= 0) {
                    y[i] += this.b[j] * x[i - j];
                }
            }

            // Apply the denominator coefficients (a terms)
            for (let j = 1; j < this.a.length; j++) {
                if (i - j >= 0) {
                    y[i] -= this.a[j] * y[i - j];
                }
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

    public applyMovingAverage(signal: number[], windowSize: number): number[] {
        if (windowSize <= 0 || signal.length === 0) return [];

        const result = new Array(signal.length).fill(0);
        const halfWindow = Math.floor(windowSize / 2);

        for (let i = 0; i < signal.length; i++) {
            let sum = 0;
            let count = 0;

            for (let j = -halfWindow; j <= halfWindow; j++) {
                const index = i + j;
                if (index >= 0 && index < signal.length) {
                    sum += signal[index];
                    count++;
                }
            }

            result[i] = sum / count;
        }

        return result;
    }
}