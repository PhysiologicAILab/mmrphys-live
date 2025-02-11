// src/utils/signalProcessor.ts

import { ModelConfig } from './modelInference';

interface SignalData {
    raw: Float32Array;
    filtered: Float32Array;
    snr: number;
}

interface RateData {
    timestamp: string;
    value: number;
    snr: number;
}

export interface SignalBuffers {
    bvp: SignalData;
    resp: SignalData;
    heartRates: RateData[];
    respRates: RateData[];
}


export class SignalProcessor {
    private readonly maxSignalBufferSize: number;
    private readonly maxRateBufferSize: number;
    private readonly samplingRate: number;

    private bvpBuffer: SignalData;
    private respBuffer: SignalData;
    private rateBuffer: {
        heartRates: RateData[];
        respRates: RateData[];
    };
    private timestamps: string[];
    private lastUpdateTime: number;
    private updateCount: number;
    private averageUpdateTime: number;
    private config: ModelConfig | null;

    constructor(samplingRate: number = 30) {
        this.samplingRate = samplingRate;
        this.maxSignalBufferSize = samplingRate * 10; // 10 seconds buffer
        this.maxRateBufferSize = 300; // Store up to 5 minutes of rate values

        // Initialize buffers with Float32Arrays
        this.bvpBuffer = {
            raw: new Float32Array(this.maxSignalBufferSize),
            filtered: new Float32Array(this.maxSignalBufferSize),
            snr: 0
        };

        this.respBuffer = {
            raw: new Float32Array(this.maxSignalBufferSize),
            filtered: new Float32Array(this.maxSignalBufferSize),
            snr: 0
        };

        this.rateBuffer = {
            heartRates: [],
            respRates: []
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
        bvp: { raw: number[]; filtered: number[]; snr: number; rate: number; };
        resp: { raw: number[]; filtered: number[]; snr: number; rate: number; };
        timestamp: string;
    }): void {
        const startTime = performance.now();
        const timestamp = results.timestamp;

        try {
            // Update BVP signals and rate
            if (results.bvp.raw.length > 0) {
                this.updateSignalBuffer(this.bvpBuffer, {
                    raw: results.bvp.raw,
                    filtered: results.bvp.filtered,
                    snr: results.bvp.snr
                });

                this.updateRateBuffer('heartRates', {
                    timestamp,
                    value: results.bvp.rate,
                    snr: results.bvp.snr
                });
            }

            // Update respiratory signals and rate
            if (results.resp.raw.length > 0) {
                this.updateSignalBuffer(this.respBuffer, {
                    raw: results.resp.raw,
                    filtered: results.resp.filtered,
                    snr: results.resp.snr
                });

                this.updateRateBuffer('respRates', {
                    timestamp,
                    value: results.resp.rate,
                    snr: results.resp.snr
                });
            }

            this.updateTimestamps(timestamp);
            this.updatePerformanceMetrics(startTime);

        } catch (error) {
            console.error('Error updating buffers:', error);
            throw new Error(`Buffer update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private updateSignalBuffer(buffer: SignalData, newData: { raw: number[]; filtered: number[]; snr: number }): void {
        // Shift existing data left
        buffer.raw.copyWithin(0, newData.raw.length);
        buffer.filtered.copyWithin(0, newData.filtered.length);

        // Add new data
        buffer.raw.set(newData.raw, buffer.raw.length - newData.raw.length);
        buffer.filtered.set(newData.filtered, buffer.filtered.length - newData.filtered.length);
        buffer.snr = newData.snr;
    }

    private updateRateBuffer(
        type: 'heartRates' | 'respRates',
        data: RateData
    ): void {
        this.rateBuffer[type].push(data);
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
            const headers = [
                'Timestamp',
                'BVP_Raw',
                'BVP_Filtered',
                'BVP_SNR',
                'Heart_Rate',
                'Resp_Raw',
                'Resp_Filtered',
                'Resp_SNR',
                'Resp_Rate'
            ];
            const rows = [headers.join(',')];

            for (let i = 0; i < this.timestamps.length; i++) {
                const heartRate = this.rateBuffer.heartRates[i];
                const respRate = this.rateBuffer.respRates[i];

                if (heartRate || respRate) {
                    const row = [
                        this.timestamps[i],
                        this.formatValue(this.bvpBuffer.raw[i], 6),
                        this.formatValue(this.bvpBuffer.filtered[i], 6),
                        heartRate ? this.formatValue(heartRate.snr, 2) : '',
                        heartRate ? this.formatValue(heartRate.value, 1) : '',
                        this.formatValue(this.respBuffer.raw[i], 6),
                        this.formatValue(this.respBuffer.filtered[i], 6),
                        respRate ? this.formatValue(respRate.snr, 2) : '',
                        respRate ? this.formatValue(respRate.value, 1) : ''
                    ];
                    rows.push(row.join(','));
                }
            }

            return rows.join('\n');
        } catch (error) {
            console.error('Error generating export data:', error);
            throw new Error('Failed to generate export data');
        }
    }

    getLatestData(): {
        bvp: { signal: Float32Array; rate: number; snr: number; };
        resp: { signal: Float32Array; rate: number; snr: number; };
    } {
        const latestHeartRate = this.rateBuffer.heartRates[this.rateBuffer.heartRates.length - 1];
        const latestRespRate = this.rateBuffer.respRates[this.rateBuffer.respRates.length - 1];

        return {
            bvp: {
                signal: this.bvpBuffer.filtered,
                rate: latestHeartRate?.value || 0,
                snr: this.bvpBuffer.snr
            },
            resp: {
                signal: this.respBuffer.filtered,
                rate: latestRespRate?.value || 0,
                snr: this.respBuffer.snr
            }
        };
    }

    private formatValue(value: number | undefined, decimals: number): string {
        return value != null ? value.toFixed(decimals) : '';
    }

    getPerformanceMetrics(): {
        averageUpdateTime: number;
        updateCount: number;
        bufferUtilization: number;
    } {
        return {
            averageUpdateTime: this.averageUpdateTime,
            updateCount: this.updateCount,
            bufferUtilization: (this.timestamps.length / this.maxSignalBufferSize) * 100
        };
    }

    getConfig(): ModelConfig | null {
        return this.config;
    }

    reset(): void {
        this.bvpBuffer.raw.fill(0);
        this.bvpBuffer.filtered.fill(0);
        this.bvpBuffer.snr = 0;
        this.respBuffer.raw.fill(0);
        this.respBuffer.filtered.fill(0);
        this.respBuffer.snr = 0;
        this.rateBuffer.heartRates = [];
        this.rateBuffer.respRates = [];
        this.timestamps = [];
        this.updateCount = 0;
        this.averageUpdateTime = 0;
        this.lastUpdateTime = Date.now();
    }
}