import { VideoProcessor } from '../utils/videoProcessor';

export interface VideoDisplayProps {
    videoProcessor: VideoProcessor | null;
    faceDetected: boolean;
    bufferProgress: number;
}

export interface VitalSignsChartProps {
    title: string;
    data: number[];
    rate: number;
    type: 'bvp' | 'resp';
    isReady: boolean;
}

export interface VitalSigns {
    heartRate: number;
    respRate: number;
    bvpSignal: number[];
    respSignal: number[];
}

export interface StatusMessage {
    message: string;
    type: 'info' | 'success' | 'error';
}

export interface ControlsProps {
    isCapturing: boolean;
    isInitialized: boolean;
    onStart: () => void;
    onStop: () => void;
    onExport: () => void;
}

export interface StatusMessageProps {
    message: string;
    type: 'info' | 'success' | 'error';
}