export class SignalProcessor {
    constructor() {
        this.bvpBuffer = [];
        this.respBuffer = [];
        this.rateBuffer = {
            heartRate: [],
            respRate: []
        };
        this.timestamps = [];
    }

    updateBuffers(results) {
        const timestamp = new Date().toISOString();

        // Update signal buffers
        this.bvpBuffer.push(...results.bvp);
        this.respBuffer.push(...results.resp);

        // Keep only last 30 seconds of data
        const maxBufferSize = 30 * 30; // 30 seconds at 30 fps
        if (this.bvpBuffer.length > maxBufferSize) {
            this.bvpBuffer = this.bvpBuffer.slice(-maxBufferSize);
            this.respBuffer = this.respBuffer.slice(-maxBufferSize);
        }

        // Update rate buffers
        this.rateBuffer.heartRate.push({
            timestamp,
            value: results.heartRate
        });
        this.rateBuffer.respRate.push({
            timestamp,
            value: results.respRate
        });

        // Keep only last 5 minutes of rate data
        const maxRateBufferSize = 300; // 5 minutes at 1 sample per second
        if (this.rateBuffer.heartRate.length > maxRateBufferSize) {
            this.rateBuffer.heartRate.shift();
            this.rateBuffer.respRate.shift();
        }

        this.timestamps.push(timestamp);
        if (this.timestamps.length > maxBufferSize) {
            this.timestamps = this.timestamps.slice(-maxBufferSize);
        }
    }

    getExportData() {
        return {
            bvp: this.bvpBuffer,
            resp: this.respBuffer,
            heartRate: this.rateBuffer.heartRate,
            respRate: this.rateBuffer.respRate,
            timestamps: this.timestamps
        };
    }

    getLatestRates() {
        const latestHR = this.rateBuffer.heartRate[this.rateBuffer.heartRate.length - 1];
        const latestRR = this.rateBuffer.respRate[this.rateBuffer.respRate.length - 1];

        return {
            heartRate: latestHR?.value || 0,
            respRate: latestRR?.value || 0
        };
    }
}