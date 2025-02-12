// src/App.tsx
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { VideoDisplay, Controls, VitalSignsChart, StatusMessage } from '@/components';
import { useDeviceCapabilities } from '@/hooks/useDeviceCapabilities';
import { useVitalSigns } from '@/hooks/useVitalSigns';
import { VideoProcessor } from '@/utils/videoProcessor';
import {
    StatusMessage as StatusMessageType,
    VitalSigns as VitalSignsType
} from '@/types';

const App: React.FC = () => {
    // State for system initialization and capturing
    const [isInitialized, setIsInitialized] = useState(false);
    const [isCapturing, setIsCapturing] = useState(false);
    const [bufferProgress, setBufferProgress] = useState(0);
    const [statusMessage, setStatusMessage] = useState<StatusMessageType>({
        message: 'Initializing system...',
        type: 'info'
    });

    // Device capabilities hook
    const { capabilities, isChecking } = useDeviceCapabilities();

    // Vital signs management hook
    const {
        vitalSigns,
        performance,
        updateVitalSigns,
        updatePerformance,
        resetData
    } = useVitalSigns({
        isCapturing,
        onError: (error) => {
            setStatusMessage({
                message: `Vital signs error: ${error.message}`,
                type: 'error'
            });
        }
    });

    // Refs for managing processors and workers
    const videoProcessorRef = useRef<VideoProcessor | null>(null);
    const inferenceWorkerRef = useRef<Worker | null>(null);
    const progressIntervalRef = useRef<number | null>(null);

    // System initialization effect
    useEffect(() => {
        const initializeSystem = async () => {
            try {
                // Check device compatibility
                if (!capabilities?.isCompatible) {
                    throw new Error('Device not compatible');
                }

                // Initialize video processor
                videoProcessorRef.current = new VideoProcessor();

                // Create inference worker
                const worker = new Worker(
                    new URL('./workers/inferenceWorker.ts', import.meta.url),
                    { type: 'module' }
                );

                // Worker message handling
                worker.onmessage = (e) => {
                    switch (e.data.type) {
                        case 'init':
                            handleWorkerInitialization(e);
                            break;
                        case 'inference':
                            handleInferenceResults(e);
                            break;
                        case 'export':
                            handleExportResults(e);
                            break;
                        case 'error':
                            handleWorkerError(e);
                            break;
                    }
                };

                // Set worker reference
                inferenceWorkerRef.current = worker;

                // Initialize worker
                worker.postMessage({ type: 'init' });

            } catch (error) {
                handleInitializationError(error);
            }
        };

        // Trigger initialization when device check is complete
        if (!isChecking && capabilities) {
            initializeSystem();
        }

        // Cleanup function
        return () => {
            inferenceWorkerRef.current?.terminate();
            videoProcessorRef.current?.stopCapture();

            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
            }
        };
    }, [capabilities, isChecking]);

    // Handler for worker initialization
    const handleWorkerInitialization = (event: MessageEvent) => {
        if (event.data.status === 'success') {
            setIsInitialized(true);
            setStatusMessage({
                message: 'System ready',
                type: 'success'
            });
        } else {
            setStatusMessage({
                message: `Initialization failed: ${event.data.error}`,
                type: 'error'
            });
        }
    };

    // Handler for inference results
    const handleInferenceResults = (event: MessageEvent) => {
        if (event.data.status === 'success') {
            const results = event.data.results;
            updateVitalSigns({
                heartRate: results.bvp.metrics.rate,
                respRate: results.resp.metrics.rate,
                bvpSignal: results.bvp.raw,
                respSignal: results.resp.raw,
                bvpSNR: results.bvp.metrics.quality.snr,
                respSNR: results.resp.metrics.quality.snr,
                filteredBvpSignal: results.bvp.filtered,
                filteredRespSignal: results.resp.filtered,
                bvpQuality: results.bvp.metrics.quality.quality,
                respQuality: results.resp.metrics.quality.quality,
                bvpSignalStrength: results.bvp.metrics.quality.signalStrength || 0,
                respSignalStrength: results.resp.metrics.quality.signalStrength || 0,
                bvpArtifactRatio: results.bvp.metrics.quality.artifactRatio || 0,
                respArtifactRatio: results.resp.metrics.quality.artifactRatio || 0
            });

            // Update performance metrics
            updatePerformance(results.performanceMetrics);
        } else {
            setStatusMessage({
                message: `Inference error: ${event.data.error}`,
                type: 'error'
            });
        }
    };

    // Handler for export results
    const handleExportResults = (event: MessageEvent) => {
        if (event.data.status === 'success') {
            // Create blob and trigger download
            const blob = new Blob([event.data.data], { type: 'application/json' });
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
        } else {
            setStatusMessage({
                message: `Export failed: ${event.data.error}`,
                type: 'error'
            });
        }
    };

    // Handler for worker errors
    const handleWorkerError = (event: MessageEvent) => {
        setStatusMessage({
            message: `Worker error: ${event.data.error}`,
            type: 'error'
        });
    };

    // Handler for initialization errors
    const handleInitializationError = (error: unknown) => {
        setStatusMessage({
            message: `Initialization failed: ${error instanceof Error ? error.message : 'Unknown error'
                }`,
            type: 'error'
        });
    };

    // Start monitoring buffer progress
    const startMonitoring = useCallback(() => {
        if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
        }

        progressIntervalRef.current = window.setInterval(() => {
            if (!videoProcessorRef.current || !inferenceWorkerRef.current) return;

            const progress = videoProcessorRef.current.getBufferUsagePercentage();
            setBufferProgress(progress);

            // Trigger inference when minimum frames are available
            if (videoProcessorRef.current.hasMinimumFrames()) {
                const frameBuffer = videoProcessorRef.current.getFrameBuffer();
                inferenceWorkerRef.current.postMessage({
                    type: 'inference',
                    frameBuffer
                });
            }
        }, 100);
    }, []);

    // Start capture handler
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
                message: `Failed to start capture: ${error instanceof Error ? error.message : 'Unknown error'
                    }`,
                type: 'error'
            });
        }
    }, [startMonitoring]);

    // Stop capture handler
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

            // Reset data after stopping capture
            resetData();

            setStatusMessage({
                message: 'Capture stopped',
                type: 'info'
            });
        } catch (error) {
            setStatusMessage({
                message: `Failed to stop capture: ${error instanceof Error ? error.message : 'Unknown error'
                    }`,
                type: 'error'
            });
        }
    }, [resetData]);

    // Export data handler
    const handleExport = useCallback(() => {
        try {
            // Send export message to worker
            inferenceWorkerRef.current?.postMessage({ type: 'export' });

            setStatusMessage({
                message: 'Preparing export...',
                type: 'info'
            });
        } catch (error) {
            setStatusMessage({
                message: `Export failed: ${error instanceof Error ? error.message : 'Unknown error'
                    }`,
                type: 'error'
            });
        }
    }, []);

    // Render loading state
    if (isChecking) {
        return (
            <div className="flex h-screen items-center justify-center">
                <div className="text-center">
                    <h2 className="text-xl font-semibold mb-4">
                        Checking device compatibility...
                    </h2>
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
                    <h2 className="text-xl font-semibold text-error mb-4">
                        Device Not Compatible
                    </h2>
                    <p className="mb-4">
                        Your device doesn't meet the minimum requirements:
                    </p>
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
                    <p>
                        Please try using a modern browser on a desktop or mobile
                        device with a camera.
                    </p>
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
                        filteredData={vitalSigns.filteredBvpSignal}
                        rate={vitalSigns.heartRate}
                        snr={vitalSigns.bvpSNR}
                        quality={vitalSigns.bvpQuality}
                        type="bvp"
                        isReady={isCapturing && bufferProgress >= 100}
                        signalStrength={vitalSigns.bvpSignalStrength}
                        artifactRatio={vitalSigns.bvpArtifactRatio}
                    />
                    <VitalSignsChart
                        title="Respiratory Signal"
                        data={vitalSigns.respSignal}
                        filteredData={vitalSigns.filteredRespSignal}
                        rate={vitalSigns.respRate}
                        snr={vitalSigns.respSNR}
                        quality={vitalSigns.respQuality}
                        type="resp"
                        isReady={isCapturing && bufferProgress >= 100}
                        signalStrength={vitalSigns.respSignalStrength}
                        artifactRatio={vitalSigns.respArtifactRatio}
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