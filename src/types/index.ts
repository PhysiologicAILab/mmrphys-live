// src/types/index.ts

import { VideoProcessor } from '../utils/videoProcessor';

// Performance Metrics
export interface PerformanceMetrics {
    averageUpdateTime: number;
    updateCount: number;
    bufferUtilization: number;
}



export interface SignalData {
    raw: Float32Array;
    filtered: Float32Array;
    snr: number;
}

export interface RateData {
    timestamp: string;
    value: number;
    snr: number;
    quality: 'excellent' | 'good' | 'moderate' | 'poor';
}

export interface VideoDisplayProps {
    videoProcessor: VideoProcessor | null;
    faceDetected: boolean;
    bufferProgress: number;
    isCapturing: boolean;
}

export interface VitalSignsChartProps {
    title: string;
    data: number[];
    filteredData?: number[];
    type: 'bvp' | 'resp';
    isReady: boolean;
    rate: number;
    snr: number;
    quality?: 'excellent' | 'good' | 'moderate' | 'poor';
    signalStrength?: number;
    artifactRatio?: number;
}

export interface StatusMessageProps {
    message: string;
    type: 'info' | 'success' | 'error' | 'warning';
}

// Vital Signs Interface
export interface VitalSigns {
    heartRate: number;
    respRate: number;
    bvpSignal: number[];
    respSignal: number[];
    bvpSNR: number;
    respSNR: number;
    filteredBvpSignal: number[];
    filteredRespSignal: number[];
    bvpQuality: 'excellent' | 'good' | 'moderate' | 'poor';
    respQuality: 'excellent' | 'good' | 'moderate' | 'poor';
    bvpSignalStrength: number;
    respSignalStrength: number;
    bvpArtifactRatio: number;
    respArtifactRatio: number;
}

export interface ControlsProps {
    isCapturing: boolean;
    isInitialized: boolean;
    onStart: () => void;
    onStop: () => void;
    onExport: () => void;
}

export type StatusMessage = {
    message: string;
    type: 'error' | 'info' | 'success' | 'warning';
};

// Signal Metrics
export interface SignalMetrics {
    rate: number;
    quality: {
        snr: number;
        quality: 'excellent' | 'good' | 'moderate' | 'poor';
        signalStrength?: number;
        artifactRatio?: number;
    };
}

export interface SignalBuffers {
    bvp: {
        raw: number[];
        filtered: number[];
        metrics: SignalMetrics;
    };
    resp: {
        raw: number[];
        filtered: number[];
        metrics: SignalMetrics;
    };
    timestamp: string;
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

// Export Data Structure
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
        }
    };
    rates: {
        heart: RateData[];
        respiratory: RateData[];
    };
    timestamps: string[];
    performance?: PerformanceMetrics;
}

// Worker Message Type
export interface WorkerMessage {
    type: string;
    status: 'success' | 'error';
    results?: any;
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