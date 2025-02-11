// src/App.tsx
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { VideoDisplay, Controls, VitalSignsChart, StatusMessage } from '@/components';
import { useDeviceCapabilities } from '@/hooks/useDeviceCapabilities';
import { VideoProcessor } from '@/utils/videoProcessor';
import { VitalSigns, StatusMessage as StatusMessageType } from '@/types';

const App: React.FC = () => {
    // State management
    const [isInitialized, setIsInitialized] = useState(false);
    const [isCapturing, setIsCapturing] = useState(false);
    const [bufferProgress, setBufferProgress] = useState(0);
    const [statusMessage, setStatusMessage] = useState<StatusMessageType>({
        message: 'Initializing system...',
        type: 'info'
    });

    // Vital signs state
    const [vitalSigns, setVitalSigns] = useState<VitalSigns>({
        heartRate: 0,
        respRate: 0,
        bvpSignal: [],
        respSignal: [],
        bvpSNR: 0,
        respSNR: 0
    });

    // Refs for processors and workers
    const videoProcessorRef = useRef<VideoProcessor | null>(null);
    const inferenceWorkerRef = useRef<Worker | null>(null);
    const progressIntervalRef = useRef<number | null>(null);

    // Device capabilities check
    const { capabilities, isChecking } = useDeviceCapabilities();

    // Initialize system
    useEffect(() => {
        const initializeSystem = async () => {
            try {
                if (!capabilities?.isCompatible) {
                    throw new Error('Device not compatible');
                }

                // Initialize video processor
                videoProcessorRef.current = new VideoProcessor();

                // Initialize inference worker
                const worker = new Worker(
                    new URL('./workers/inferenceWorker.ts', import.meta.url),
                    { type: 'module' }
                );

                // Set up worker message handler
                worker.onmessage = (e) => {
                    if (e.data.type === 'init') {
                        if (e.data.status === 'success') {
                            setIsInitialized(true);
                            setStatusMessage({
                                message: 'System ready',
                                type: 'success'
                            });
                        } else {
                            console.error('Initialization failed:', e.data.error);
                            throw new Error(`Initialization failed: ${e.data.error}`);
                        }
                    } else if (e.data.type === 'inference' && e.data.status === 'success') {
                        handleInferenceResults(e.data.results);
                    }
                };

                inferenceWorkerRef.current = worker;

                // Initialize worker
                worker.postMessage({ type: 'init' });

            } catch (error) {
                setStatusMessage({
                    message: `Initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    type: 'error'
                });
            }
        };

        if (!isChecking && capabilities) {
            initializeSystem();
        }

        return () => {
            // Cleanup
            inferenceWorkerRef.current?.terminate();
            videoProcessorRef.current?.stopCapture();
            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
            }
        };
    }, [capabilities, isChecking]);

    // Handle inference results
    const handleInferenceResults = useCallback((results: any) => {
        setVitalSigns({
            heartRate: results.bvp.rate,
            respRate: results.resp.rate,
            bvpSignal: results.bvp.filtered,
            respSignal: results.resp.filtered,
            bvpSNR: results.bvp.snr,
            respSNR: results.resp.snr
        });
    }, []);

    // Start monitoring buffer progress and trigger inference
    const startMonitoring = useCallback(() => {
        if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
        }

        progressIntervalRef.current = window.setInterval(() => {
            if (!videoProcessorRef.current || !inferenceWorkerRef.current) return;

            const progress = videoProcessorRef.current.getBufferUsagePercentage();
            setBufferProgress(progress);

            // If we have enough frames, run inference
            if (videoProcessorRef.current.hasMinimumFrames()) {
                const frameBuffer = videoProcessorRef.current.getFrameBuffer();
                inferenceWorkerRef.current.postMessage({
                    type: 'inference',
                    frameBuffer
                });
            }
        }, 100); // Check every 100ms
    }, []);

    // Start capture
    const handleStartCapture = useCallback(async () => {
        if (!videoProcessorRef.current) return;

        try {
            setStatusMessage({
                message: 'Starting capture...',
                type: 'info'
            });

            await videoProcessorRef.current.startCapture();
            setIsCapturing(true);
            startMonitoring();

            setStatusMessage({
                message: 'Capturing vital signs...',
                type: 'success'
            });
        } catch (error) {
            setIsCapturing(false);
            setStatusMessage({
                message: `Failed to start capture: ${error instanceof Error ? error.message : 'Unknown error'}`,
                type: 'error'
            });
        }
    }, [startMonitoring]);

    // Stop capture
    const handleStopCapture = useCallback(async () => {
        if (!videoProcessorRef.current) return;

        try {
            await videoProcessorRef.current.stopCapture();
            setIsCapturing(false);
            setBufferProgress(0);

            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
                progressIntervalRef.current = null;
            }

            setStatusMessage({
                message: 'Capture stopped',
                type: 'info'
            });
        } catch (error) {
            setStatusMessage({
                message: `Failed to stop capture: ${error instanceof Error ? error.message : 'Unknown error'}`,
                type: 'error'
            });
        }
    }, []);

    // Export data
    const handleExport = useCallback(() => {
        try {
            const data = {
                timestamp: new Date().toISOString(),
                vitalSigns
            };

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `vital-signs-${new Date().toISOString()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            setStatusMessage({
                message: 'Data exported successfully',
                type: 'success'
            });
        } catch (error) {
            setStatusMessage({
                message: `Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                type: 'error'
            });
        }
    }, [vitalSigns]);

    // Render loading state
    if (isChecking) {
        return (
            <div className="flex h-screen items-center justify-center">
                <div className="text-center">
                    <h2 className="text-xl font-semibold mb-4">Checking device compatibility...</h2>
                    <div className="animate-pulse-slow">Please wait...</div>
                </div>
            </div>
        );
    }

    // Render incompatible device message
    if (!capabilities?.isCompatible) {
        return (
            <div className="flex h-screen items-center justify-center">
                <div className="text-center max-w-md p-6 bg-white rounded-lg shadow-lg">
                    <h2 className="text-xl font-semibold text-error mb-4">Device Not Compatible</h2>
                    <p className="mb-4">Your device doesn't meet the minimum requirements:</p>
                    <ul className="text-left list-disc pl-6 mb-4">
                        {!capabilities?.hasCamera && (
                            <li>No camera detected</li>
                        )}
                        {!capabilities?.hasWebGL && (
                            <li>WebGL not supported</li>
                        )}
                        {!capabilities?.hasWebAssembly && (
                            <li>WebAssembly not supported</li>
                        )}
                    </ul>
                    <p>Please try using a modern browser on a desktop or mobile device with a camera.</p>
                </div>
            </div>
        );
    }

    // Main application render
    return (
        <div className="app-container">
            <header className="app-header">
                <h1 className="text-2xl font-bold text-primary mb-4">
                    Remote Physiological Sensing
                </h1>
            </header>

            <main className="app-main">
                <Controls
                    isCapturing={isCapturing}
                    isInitialized={isInitialized}
                    onStart={handleStartCapture}
                    onStop={handleStopCapture}
                    onExport={handleExport}
                />

                <VideoDisplay
                    videoProcessor={videoProcessorRef.current}
                    faceDetected={true}
                    bufferProgress={bufferProgress}
                    isCapturing={isCapturing}
                />

                <div className="charts-section">
                    <VitalSignsChart
                        title="Blood Volume Pulse"
                        data={vitalSigns.bvpSignal}
                        rate={vitalSigns.heartRate}
                        snr={vitalSigns.bvpSNR}
                        type="bvp"
                        isReady={isCapturing && bufferProgress >= 100}
                    />
                    <VitalSignsChart
                        title="Respiratory Signal"
                        data={vitalSigns.respSignal}
                        rate={vitalSigns.respRate}
                        snr={vitalSigns.respSNR}
                        type="resp"
                        isReady={isCapturing && bufferProgress >= 100}
                    />
                </div>
            </main>

            <StatusMessage
                message={statusMessage.message}
                type={statusMessage.type}
            />
        </div>
    );
};

export default App;            