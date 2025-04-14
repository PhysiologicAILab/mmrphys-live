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
                    b: [0.05644846226073645, 0.0, -0.1128969245214729, 0.0, 0.05644846226073645],
                    a: [1.0, -3.081806064993257, 3.6679952325214913, -2.031385227796349, 0.4504454300560409]
                };
            } else if (type === 'resp') {
                // Respiratory rate filter
                return {
                    b: [0.001991943576502138, 0.0, -0.003983887153004276, 0.0, 0.001991943576502138],
                    a: [1.0, -3.8652573103442673, 5.608620144892655, -3.6211682561347818, 0.8778106837571596]
                };
            }
        }
        // For 25 Hz sampling rate
        else if (Math.abs(fs - 25) < 2) {
            if (type == 'heart' || type === 'bvp') {
                // Heart rate filter (BVP)
                return {
                    b: [0.07671797400308883, 0.0, -0.15343594800617766, 0.0, 0.07671797400308883],
                    a: [1.0, -2.8801703902977813, 3.234887695468058, -1.7297005100770213, 0.3851904131124458]
                };
            } else if (type === 'resp') {
                // Respiratory rate filter
                return {
                    b: [0.0028330185033880657, 0.0, -0.005666037006776131, 0.0, 0.0028330185033880657],
                    a: [1.0, -3.8373339990587354, 5.530399483585574, -3.5482812433954805, 0.8552265340438167]
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

}