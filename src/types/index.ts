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

export interface VitalSignsChartProps {
    title: string;
    data: number[];
    rate: number;
    snr: number;
    type: 'bvp' | 'resp';
    isReady: boolean;
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

export interface StatusMessageProps {
    message: string;
    type: 'info' | 'success' | 'error';
}

export interface SignalBuffers {
    bvp: SignalData;
    resp: SignalData;
    heartRates: RateData[];
    respRates: RateData[];
}