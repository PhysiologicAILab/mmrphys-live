import React from 'react';
import { ControlsProps } from '@/types';

const Controls: React.FC<ControlsProps> = ({
    isCapturing,
    isInitialized,
    onStart,
    onStop,
    onExport
}) => {
    return (
        <div className="controls">
            <button
                className="btn primary"
                onClick={onStart}
                disabled={!isInitialized || isCapturing}
            >
                <span className="btn-icon">▶</span>
                Start Capture
            </button>

            <button
                className="btn secondary"
                onClick={onStop}
                disabled={!isCapturing}
            >
                <span className="btn-icon">⏹</span>
                Stop Capture
            </button>

            <button
                className="btn secondary"
                onClick={onExport}
                disabled={isCapturing}
            >
                <span className="btn-icon">⬇</span>
                Export Data
            </button>
        </div>
    );
};

export default Controls;