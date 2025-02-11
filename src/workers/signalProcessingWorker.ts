// src/workers/signalProcessingWorker.ts
import { SignalAnalyzer } from '../utils/signalAnalysis';

interface SignalProcessMessage {
    type: 'process';
    bvpSignal: number[];
    respSignal: number[];
    samplingRate: number;
}

let isInitialized = false;

self.onmessage = (e: MessageEvent<SignalProcessMessage>) => {
    if (e.data.type === 'init') {
        isInitialized = true;
        self.postMessage({ type: 'init', status: 'success' });
        return;
    }

    if (e.data.type === 'process') {
        if (!isInitialized) {
            self.postMessage({
                type: 'process',
                status: 'error',
                error: 'Worker not initialized'
            });
            return;
        }

        try {
            const { bvpSignal, respSignal, samplingRate } = e.data;

            const heartRate = SignalAnalyzer.calculateRate(bvpSignal, samplingRate, 'heart');
            const respRate = SignalAnalyzer.calculateRate(respSignal, samplingRate, 'resp');

            self.postMessage({
                type: 'process',
                status: 'success',
                heartRate,
                respRate
            });
        } catch (error) {
            self.postMessage({
                type: 'process',
                status: 'error',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
};