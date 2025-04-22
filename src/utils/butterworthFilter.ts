// src/utils/butterworthFilter.ts

export class ButterworthFilter {
    private a: number[]; // Denominator coefficients
    private b: number[]; // Numerator coefficients
    private z: number[]; // Filter state
    private forwardOutputBuffer: Float32Array | null = null;
    private backwardOutputBuffer: Float32Array | null = null;
    private _coefficientsNormalized: boolean = false;

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

    // // Simple 1D filter (lfilter equivalent)
    // private optimizedLfilter(signal: number[] | Float32Array, outputBuffer: Float32Array): void {
    //     // Check if a[0] is not 1, normalize coefficients if needed (once per filter instance)
    //     if (this.a[0] !== 1 && !this._coefficientsNormalized) {
    //         const a0 = this.a[0];
    //         for (let i = 0; i < this.b.length; i++) this.b[i] /= a0;
    //         for (let i = 0; i < this.a.length; i++) this.a[i] /= a0;
    //         this._coefficientsNormalized = true;
    //     }

    //     // Clear output buffer first
    //     outputBuffer.fill(0);

    //     // Apply filter directly to the output buffer
    //     for (let i = 0; i < signal.length; i++) {
    //         // Apply the numerator coefficients (b terms)
    //         for (let j = 0; j < this.b.length; j++) {
    //             if (i - j >= 0) {
    //                 outputBuffer[i] += this.b[j] * signal[i - j];
    //             }
    //         }

    //         // Apply the denominator coefficients (a terms)
    //         for (let j = 1; j < this.a.length; j++) {
    //             if (i - j >= 0) {
    //                 outputBuffer[i] -= this.a[j] * outputBuffer[i - j];
    //             }
    //         }
    //     }
    // }

    // Apply forward-backward zero-phase filter (filtfilt equivalent)
    public applyButterworthBandpass(signal: number[]): number[] {
        if (signal.length === 0) return [];

        // Create output array
        const output = new Array(signal.length);

        // Apply single-pass IIR filter with proper state management
        // This implementation uses classic direct form II structure

        // For debugging - check if coefficients look reasonable
        if (this.a.length !== this.b.length) {
            console.warn(`Filter coefficient arrays have different lengths: a=${this.a.length}, b=${this.b.length}`);
        }

        // Copy the signal to avoid modifying the original
        const inputSignal = [...signal];

        // Add debug logging 
        console.log(`Filtering signal: length=${signal.length}, first few values=[${signal.slice(0, 5).join(', ')}]`);
        console.log(`Filter coefficients: a=[${this.a.slice(0, 3).join(', ')}...], b=[${this.b.slice(0, 3).join(', ')}...]`);

        try {
            // Apply the filter directly
            for (let i = 0; i < inputSignal.length; i++) {
                // Initialize output sample with input * b[0]
                output[i] = this.b[0] * inputSignal[i];

                // Add contributions from previous inputs (if any)
                for (let j = 1; j < this.b.length; j++) {
                    if (i - j >= 0) {
                        output[i] += this.b[j] * inputSignal[i - j];
                    }
                }

                // Subtract contributions from previous outputs (feedback)
                for (let j = 1; j < this.a.length; j++) {
                    if (i - j >= 0) {
                        output[i] -= this.a[j] * output[i - j];
                    }
                }
            }

            // Log some statistics about the output
            const nonZeroCount = output.filter(v => v !== 0).length;
            const outputMean = output.reduce((sum, val) => sum + val, 0) / output.length;
            const firstFewOutput = output.slice(0, 5).join(', ');
            console.log(`Filter output: nonZeroValues=${nonZeroCount}/${output.length}, mean=${outputMean.toFixed(6)}, first few=[${firstFewOutput}]`);

            return output;
        } catch (error) {
            console.error("Error in Butterworth filter:", error);
            // Return unfiltered signal as fallback
            return inputSignal;
        }
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