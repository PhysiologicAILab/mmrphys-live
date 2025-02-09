import { ModelConfig } from './modelInference';

export interface SignalBuffers {
    bvp: Float32Array;
    resp: Float32Array;
    heartRate: RateData[];
    respRate: RateData[];
}

interface RateData {
    timestamp: string;
    value: number;
}

export class SignalProcessor {
    private readonly maxSignalBufferSize: number;
    private readonly maxRateBufferSize: number;
    private readonly bvpBuffer: Float32Array;
    private readonly respBuffer: Float32Array;
    private bvpBufferIndex: number;
    private respBufferIndex: number;
    private rateBuffer: {
        heartRate: RateData[];
        respRate: RateData[];
    };
    private timestamps: string[];
    private lastUpdateTime: number;
    private updateCount: number;
    private averageUpdateTime: number;
    private config: ModelConfig | null;

    constructor() {
        this.maxSignalBufferSize = 900; // 30 seconds at 30fps
        this.maxRateBufferSize = 300;   // 5 minutes at 1 sample per second

        this.bvpBuffer = new Float32Array(this.maxSignalBufferSize);
        this.respBuffer = new Float32Array(this.maxSignalBufferSize);
        this.bvpBufferIndex = 0;
        this.respBufferIndex = 0;

        this.rateBuffer = {
            heartRate: [],
            respRate: []
        };

        this.timestamps = [];
        this.lastUpdateTime = Date.now();
        this.updateCount = 0;
        this.averageUpdateTime = 0;
        this.config = null;
    }

    setConfig(config: ModelConfig): void {
        this.config = config;
    }

    updateBuffers(results: {
        bvp: number[];
        resp: number[];
        heartRate: number;
        respRate: number;
    }): void {
        const startTime = performance.now();
        const timestamp = new Date().toISOString();

        try {
            if (results.bvp?.length > 0) {
                this.updateSignalBuffer(results.bvp, this.bvpBuffer, 'bvpBufferIndex');
            }

            if (results.resp?.length > 0) {
                this.updateSignalBuffer(results.resp, this.respBuffer, 'respBufferIndex');
            }

            if (this.isValidRate(results.heartRate)) {
                this.updateRateBuffer('heartRate', timestamp, results.heartRate);
            }

            if (this.isValidRate(results.respRate)) {
                this.updateRateBuffer('respRate', timestamp, results.respRate);
            }

            this.updateTimestamps(timestamp);
            this.updatePerformanceMetrics(startTime);

        } catch (error) {
            console.error('Error updating buffers:', error);
            throw new Error(`Buffer update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private updateSignalBuffer(
        newData: number[],
        buffer: Float32Array,
        indexKey: 'bvpBufferIndex' | 'respBufferIndex'
    ): void {
        const length = Math.min(newData.length, this.maxSignalBufferSize);

        for (let i = 0; i < length; i++) {
            buffer[this[indexKey]] = newData[i];
            this[indexKey] = (this[indexKey] + 1) % this.maxSignalBufferSize;
        }
    }

    private isValidRate(rate: number): boolean {
        return typeof rate === 'number' &&
            !isNaN(rate) &&
            isFinite(rate) &&
            rate > 0 &&
            rate < 200;
    }

    private updateRateBuffer(
        type: 'heartRate' | 'respRate',
        timestamp: string,
        value: number
    ): void {
        this.rateBuffer[type].push({ timestamp, value });

        if (this.rateBuffer[type].length > this.maxRateBufferSize) {
            this.rateBuffer[type].shift();
        }
    }

    private updateTimestamps(timestamp: string): void {
        this.timestamps.push(timestamp);
        if (this.timestamps.length > this.maxSignalBufferSize) {
            this.timestamps.shift();
        }
    }

    private updatePerformanceMetrics(startTime: number): void {
        const processingTime = performance.now() - startTime;
        this.updateCount++;
        this.averageUpdateTime = (this.averageUpdateTime * (this.updateCount - 1) + processingTime) / this.updateCount;
    }

    getExportData(): string {
        try {
            const { bvpData, respData } = this.getAlignedSignalData();
            const rates = this.getAlignedRateData();
            const samplingRate = this.config?.sampling_rate ?? 30;

            const headers = ['Timestamp', 'BVP', 'Respiratory', 'Heart Rate', 'Respiratory Rate', 'Sampling Rate'];
            const rows = [headers.join(',')];

            for (let i = 0; i < this.timestamps.length; i++) {
                const row = [
                    this.timestamps[i],
                    this.formatValue(bvpData[i], 6),
                    this.formatValue(respData[i], 6),
                    this.formatValue(rates.heartRate[i], 2),
                    this.formatValue(rates.respRate[i], 2),
                    samplingRate
                ];
                rows.push(row.join(','));
            }

            return rows.join('\n');
        } catch (error) {
            console.error('Error generating export data:', error);
            throw new Error('Failed to generate export data');
        }
    }

    private getAlignedSignalData(): { bvpData: Float32Array; respData: Float32Array } {
        const bvpData = new Float32Array(this.maxSignalBufferSize);
        const respData = new Float32Array(this.maxSignalBufferSize);

        for (let i = 0; i < this.maxSignalBufferSize; i++) {
            const bufferIndex = (this.bvpBufferIndex - this.maxSignalBufferSize + i + this.maxSignalBufferSize) % this.maxSignalBufferSize;
            bvpData[i] = this.bvpBuffer[bufferIndex];
            respData[i] = this.respBuffer[bufferIndex];
        }

        return { bvpData, respData };
    }

    private getAlignedRateData(): { heartRate: number[]; respRate: number[] } {
        return {
            heartRate: this.rateBuffer.heartRate.map(rate => rate.value),
            respRate: this.rateBuffer.respRate.map(rate => rate.value)
        };
    }

    private formatValue(value: number | undefined, decimals: number): string {
        return value != null ? value.toFixed(decimals) : '';
    }

    getLatestRates(): { heartRate: number; respRate: number; timestamp: string } {
        const heartRates = this.rateBuffer.heartRate;
        const respRates = this.rateBuffer.respRate;

        return {
            heartRate: heartRates.length > 0 ? heartRates[heartRates.length - 1].value : 0,
            respRate: respRates.length > 0 ? respRates[respRates.length - 1].value : 0,
            timestamp: new Date().toISOString()
        };
    }

    getPerformanceMetrics(): {
        averageUpdateTime: number;
        updateCount: number;
        bufferUtilization: number;
    } {
        return {
            averageUpdateTime: this.averageUpdateTime,
            updateCount: this.updateCount,
            bufferUtilization: (this.bvpBufferIndex / this.maxSignalBufferSize) * 100
        };
    }

    getConfig(): ModelConfig | null {
        return this.config;
    }

    reset(): void {
        this.bvpBuffer.fill(0);
        this.respBuffer.fill(0);
        this.bvpBufferIndex = 0;
        this.respBufferIndex = 0;
        this.rateBuffer.heartRate = [];
        this.rateBuffer.respRate = [];
        this.timestamps = [];
        this.updateCount = 0;
        this.averageUpdateTime = 0;
        this.lastUpdateTime = Date.now();
    }
}