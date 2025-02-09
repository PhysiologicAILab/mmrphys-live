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

export interface VideoDisplayProps {
    videoProcessor: any; // Replace with specific type when converting videoProcessor
}

export interface VitalSignsChartProps {
    title: string;
    data: number[];
    rate: number;
    type: 'bvp' | 'resp';
}

export interface StatusMessageProps {
    message: string;
    type: 'info' | 'success' | 'error';
}