// src/utils/butterworthFilter.ts

export interface FilterCoefficients {
    b: number[];  // feedforward coefficients
    a: number[];  // feedback coefficients
}

export class ButterworthFilter {
    private readonly b: number[];
    private readonly a: number[];
    private readonly order: number;
    private z: number[];  // delay line for filtering

    constructor(coefficients: FilterCoefficients) {
        this.b = coefficients.b;
        this.a = coefficients.a;
        this.order = this.b.length - 1;
        this.z = new Array(this.order).fill(0);
    }

    /**
     * Apply filter to a single sample
     */
    processSample(sample: number): number {
        let output = this.b[0] * sample;

        // Apply feedforward and feedback
        for (let i = 1; i <= this.order; i++) {
            output += this.b[i] * this.z[i - 1];
        }
        for (let i = 1; i <= this.order; i++) {
            output -= this.a[i] * this.z[i - 1];
        }

        // Update delay line
        for (let i = this.order - 1; i > 0; i--) {
            this.z[i] = this.z[i - 1];
        }
        this.z[0] = sample;

        return output;
    }

    /**
     * Process an entire signal
     */
    processSignal(signal: number[]): number[] {
        return signal.map(sample => this.processSample(sample));
    }

    /**
     * Reset filter state
     */
    reset(): void {
        this.z.fill(0);
    }

    /**
     * Design Butterworth bandpass filter
     */
    static designBandpass(lowFreq: number, highFreq: number, samplingRate: number, order: number = 2): FilterCoefficients {
        // Normalize frequencies
        const nyquist = samplingRate / 2;
        const wLow = Math.tan((Math.PI * lowFreq) / nyquist);
        const wHigh = Math.tan((Math.PI * highFreq) / nyquist);

        // Prewarp frequencies
        const w0 = Math.sqrt(wLow * wHigh);
        const bw = wHigh - wLow;

        // Compute analog prototype
        const { poles, zeros } = this.analogPrototype(order);

        // Transform to bandpass
        const { b, a } = this.analogToBandpass(poles, zeros, w0, bw);

        // Bilinear transform
        return this.bilinearTransform(b, a, samplingRate);
    }

    private static analogPrototype(order: number): { poles: number[], zeros: number[] } {
        const poles: number[] = [];
        const zeros: number[] = [];

        // Compute poles for Butterworth prototype
        for (let i = 0; i < order; i++) {
            const theta = (Math.PI * (2 * i + 1)) / (2 * order);
            const real = -Math.sin(theta);
            const imag = Math.cos(theta);
            poles.push(complex(real, imag));
        }

        return { poles, zeros };
    }

    private static analogToBandpass(
        poles: number[],
        zeros: number[],
        w0: number,
        bw: number
    ): { b: number[], a: number[] } {
        // Transform s -> (s² + w0²)/(s*bw)
        const transformedPoles: number[] = [];
        const transformedZeros: number[] = [];

        poles.forEach(p => {
            const factor = p * bw;
            const discriminant = factor * factor - 4 * w0 * w0;
            if (discriminant >= 0) {
                const sqrtDisc = Math.sqrt(discriminant);
                transformedPoles.push((-factor + sqrtDisc) / 2);
                transformedPoles.push((-factor - sqrtDisc) / 2);
            } else {
                const realPart = -factor / 2;
                const imagPart = Math.sqrt(-discriminant) / 2;
                transformedPoles.push(complex(realPart, imagPart));
                transformedPoles.push(complex(realPart, -imagPart));
            }
        });

        // Add zeros at s = 0 and s = ∞
        transformedZeros.push(0);
        transformedZeros.push(Infinity);

        // Convert to transfer function
        return this.polesToTransfer(transformedPoles, transformedZeros, w0);
    }

    private static bilinearTransform(b: number[], a: number[], fs: number): FilterCoefficients {
        const T = 1 / fs;
        const N = Math.max(b.length, a.length);
        const bNew = new Array(N).fill(0);
        const aNew = new Array(N).fill(0);

        // Apply bilinear transform
        for (let i = 0; i < N; i++) {
            let bSum = 0;
            let aSum = 0;
            for (let k = 0; k <= i; k++) {
                const coef = this.binomial(i, k) * Math.pow(2 / T, i - k);
                if (k < b.length) bSum += b[k] * coef;
                if (k < a.length) aSum += a[k] * coef;
            }
            bNew[i] = bSum;
            aNew[i] = aSum;
        }

        // Normalize by a[0]
        const a0 = aNew[0];
        return {
            b: bNew.map(v => v / a0),
            a: aNew.map(v => v / a0)
        };
    }

    private static binomial(n: number, k: number): number {
        if (k < 0 || k > n) return 0;
        if (k === 0 || k === n) return 1;
        return this.binomial(n - 1, k - 1) + this.binomial(n - 1, k);
    }

    private static polesToTransfer(
        poles: number[],
        zeros: number[],
        w0: number
    ): { b: number[], a: number[] } {
        // Convert poles and zeros to transfer function coefficients
        let b = [1];
        let a = [1];

        poles.forEach(p => {
            const newA = new Array(a.length + 1).fill(0);
            for (let i = 0; i < a.length; i++) {
                newA[i] += a[i];
                newA[i + 1] -= a[i] * p;
            }
            a = newA;
        });

        zeros.forEach(z => {
            if (z === Infinity) return;
            const newB = new Array(b.length + 1).fill(0);
            for (let i = 0; i < b.length; i++) {
                newB[i] += b[i];
                newB[i + 1] -= b[i] * z;
            }
            b = newB;
        });

        return { b, a };
    }
}

// Helper function for complex numbers
function complex(real: number, imag: number): number {
    // For simplicity, we're just returning the real part
    // In a full implementation, this would handle complex numbers
    return real;
}