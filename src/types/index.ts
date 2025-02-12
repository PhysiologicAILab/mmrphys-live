// src/types/index.ts

import { VideoProcessor } from '../utils/videoProcessor';

export interface SignalData {
    raw: Float32Array;
    filtered: Float32Array;
    snr: number;
}

export interface RateData {
    timestamp: string;
    value: number;
    snr: number;
}

export interface VideoDisplayProps {
    videoProcessor: VideoProcessor | null;
    faceDetected: boolean;
    bufferProgress: number;
    isCapturing: boolean;
}

// Component Props Types
export interface VitalSignsChartProps {
    title: string;
    data: SignalState;
    type: 'bvp' | 'resp';
    isReady: boolean;
    rate: number;
    snr: number;
}

export interface StatusMessageProps {
    message: string;
    type: 'info' | 'success' | 'error' | 'warning';
}

export interface VitalSigns {
    heartRate: number;
    respRate: number;
    bvpSignal: number[];
    respSignal: number[];
    bvpSNR: number;
    respSNR: number;
}

export interface ControlsProps {
    isCapturing: boolean;
    isInitialized: boolean;
    onStart: () => void;
    onStop: () => void;
    onExport: () => void;
}

export interface StatusMessage {
    message: string;
    type: 'info' | 'success' | 'error';
}

export interface SignalBuffers {
    bvp: SignalData;
    resp: SignalData;
    heartRates: RateData[];
    respRates: RateData[];
}

export interface SignalMetrics {
    rate: number;
    snr: number;
    quality: 'excellent' | 'good' | 'moderate' | 'poor';
}

export interface SignalState {
    raw: number[];
    filtered: number[];
    metrics: SignalMetrics;
}

export interface ProcessedSignals {
    bvp: SignalState;
    resp: SignalState;
    timestamp: string;
    inferenceTime?: number;
}

export interface ExportData {
    metadata: {
        samplingRate: number;
        startTime: string;
        endTime: string;
        totalSamples: number;
    };
    signals: {
        bvp: {
            raw: number[];
            filtered: number[];
        };
        resp: {
            raw: number[];
            filtered: number[];
        };
    };
    rates: {
        heart: RateData[];
        respiratory: RateData[];
    };
    timestamps: string[];
}

export interface WorkerMessage {
    type: string;
    status: 'success' | 'error';
    results?: ProcessedSignals;
    error?: string;
    data?: string;
}

export interface FilterCoefficients {
    b: number[];  // feedforward coefficients
    a: number[];  // feedback coefficients
}

export interface ModelConfig {
    sampling_rate: number;
    input_size: number[];
    output_names: string[];
}