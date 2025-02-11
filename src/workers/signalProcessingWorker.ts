// src/workers/signalProcessingWorker.ts
import { SignalAnalyzer } from '../utils/signalAnalysis';

// Define union type for worker messages
type WorkerMessage =
    | { type: 'init' }
    | {
        type: 'process';
        bvpSignal: number[];
        respSignal: number[];
        samplingRate: number;
    };

// Define response type
type WorkerResponse =
    | { type: 'init'; status: 'success' }
    | {
        type: 'process';
        status: 'success';
        heartRate: number;
        respRate: number;
    }
    | {
        type: 'process' | 'init';
        status: 'error';
        error: string;
    };

// Track worker initialization
let isInitialized = false;

// Message handler with proper type checking
self.onmessage = (e: MessageEvent<WorkerMessage>) => {
    try {
        // Check message type using type narrowing
        if (e.data.type === 'init') {
            isInitialized = true;
            const response: WorkerResponse = {
                type: 'init',
                status: 'success'
            };
            self.postMessage(response);
            return;
        }

        // Handle process message
        if (e.data.type === 'process') {
            // Check initialization
            if (!isInitialized) {
                const errorResponse: WorkerResponse = {
                    type: 'process',
                    status: 'error',
                    error: 'Worker not initialized'
                };
                self.postMessage(errorResponse);
                return;
            }

            try {
                const { bvpSignal, respSignal, samplingRate } = e.data;

                // Validate input signals
                if (!bvpSignal?.length || !respSignal?.length) {
                    throw new Error('Invalid input signals');
                }

                // Calculate rates
                const heartRate = SignalAnalyzer.calculateRate(
                    bvpSignal,
                    samplingRate,
                    'heart'
                );

                const respRate = SignalAnalyzer.calculateRate(
                    respSignal,
                    samplingRate,
                    'resp'
                );

                // Send successful response
                const successResponse: WorkerResponse = {
                    type: 'process',
                    status: 'success',
                    heartRate,
                    respRate
                };
                self.postMessage(successResponse);
            } catch (error) {
                // Handle processing errors
                const errorResponse: WorkerResponse = {
                    type: 'process',
                    status: 'error',
                    error: error instanceof Error
                        ? error.message
                        : 'Unknown signal processing error'
                };
                self.postMessage(errorResponse);
            }
        } else {
            // Handle unexpected message types
            throw new Error(`Unexpected message type: ${(e.data as { type: string }).type}`);
        }
    } catch (globalError) {
        // Catch any unexpected global errors
        const globalErrorResponse: WorkerResponse = {
            type: 'process', // Default to 'process' for error handling
            status: 'error',
            error: globalError instanceof Error
                ? globalError.message
                : 'Unknown global error'
        };
        self.postMessage(globalErrorResponse);
    }
};