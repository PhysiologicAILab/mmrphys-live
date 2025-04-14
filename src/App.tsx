// src/App.tsx
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { VideoDisplay, Controls, VitalSignsChart, StatusMessage } from '@/components';
import { useDeviceCapabilities } from '@/hooks/useDeviceCapabilities';
import { useVitalSigns } from '@/hooks/useVitalSigns';
import { VideoProcessor } from '@/utils/videoProcessor';
import {
    StatusMessage as StatusMessageType,
    VitalSigns as VitalSignsType,
    InferenceResult as InferenceResultType,
} from '@/types';

const App: React.FC = () => {
    // State for system initialization and capturing
    const [isInitialized, setIsInitialized] = useState(false);
    const [isCapturing, setIsCapturing] = useState(false);
    const [bufferProgress, setBufferProgress] = useState(0);
    const [exporting, setExporting] = useState(false);
    const [statusMessage, setStatusMessage] = useState<StatusMessageType>({
        message: 'Initializing system...',
        type: 'info'
    });

    // Device capabilities hook
    const { capabilities, isChecking } = useDeviceCapabilities();

    // Add frame collection state
    const frameCollectionRef = useRef<{
        frames: ImageData[];
        initialCollectionComplete: boolean;
        framesSinceLastInference: number;
    }>({
        frames: [],
        initialCollectionComplete: false,
        framesSinceLastInference: 0
    });

    // Constants for frame collection strategy
    const INITIAL_FRAMES = 181;
    const SUBSEQUENT_FRAMES = 121;
    const OVERLAP_FRAMES = INITIAL_FRAMES - SUBSEQUENT_FRAMES; // 60 
   
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

                // Set up face detection stop callback
                videoProcessorRef.current.faceDetector.setOnDetectionStoppedCallback(async () => {
                    console.warn('Face detection stopped due to consecutive missed detections.');

                    // Stop the entire capture pipeline
                    if (videoProcessorRef.current) {
                        await videoProcessorRef.current.stopCapture();
                    }

                    // Stop monitoring interval
                    if (progressIntervalRef.current) {
                        clearInterval(progressIntervalRef.current);
                        progressIntervalRef.current = null;
                    }

                    // Reset UI state completely
                    setIsCapturing(false);
                    setBufferProgress(0);

                    // Reset vital signs data
                    resetData();

                    setStatusMessage({
                        message: 'Face detection stopped. Please restart capture.',
                        type: 'warning'
                    });
                });

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
                        case 'inferenceResult':
                            handleInferenceResults(e);
                            break;
                        case 'exportData':
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
            console.log('[App] Worker successfully initialized');
            setIsInitialized(true);
            setStatusMessage({
                message: 'System ready',
                type: 'success'
            });
        } else {
            console.error('[App] Worker initialization failed:', event.data.error);
            setIsInitialized(false);
            setStatusMessage({
                message: `Worker initialization failed: ${event.data.error}`,
                type: 'error'
            });

            // Retry initialization after a delay
            setTimeout(() => {
                console.log('[App] Retrying worker initialization...');
                inferenceWorkerRef.current?.postMessage({ type: 'init' });
            }, 3000);
        }
    };

    // Handler for inference results
    const handleInferenceResults = (event: MessageEvent) => {
        if (event.data.status === 'success') {
            const inferenceResult: InferenceResultType = event.data;

            console.log('[App] Received data from worker:', {
                bvpLength: inferenceResult.bvp?.filtered?.length || 0,
                respLength: inferenceResult.resp?.filtered?.length || 0,
                isCapturing: isCapturing,
                bufferProgress: bufferProgress,
            });

            // Update vital signs with the received data
            updateVitalSigns({
                heartRate: inferenceResult.bvp.metrics.rate,
                respRate: inferenceResult.resp.metrics.rate,
                bvpSignal: inferenceResult.bvp.raw,
                respSignal: inferenceResult.resp.raw,
                filteredBvpSignal: inferenceResult.bvp.filtered,
                filteredRespSignal: inferenceResult.resp.filtered,
                bvpSNR: inferenceResult.bvp.metrics.quality.snr,
                respSNR: inferenceResult.resp.metrics.quality.snr,
                bvpQuality: inferenceResult.bvp.metrics.quality.quality,
                respQuality: inferenceResult.resp.metrics.quality.quality,
                bvpSignalStrength: inferenceResult.bvp.metrics.quality.signalStrength || 0,
                respSignalStrength: inferenceResult.resp.metrics.quality.signalStrength || 0,
                bvpArtifactRatio: inferenceResult.bvp.metrics.quality.artifactRatio || 0,
                respArtifactRatio: inferenceResult.resp.metrics.quality.artifactRatio || 0,
            });

            // Update performance metrics - still track inference time internally
            if (event.data.performanceMetrics) {
                updatePerformance(event.data.performanceMetrics);
            }
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
            console.log('[App] Export data received from worker, triggering download');

            // Create a download link
            const blob = new Blob([event.data.data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            // Create link element to trigger download
            const link = document.createElement('a');
            link.href = url;

            // Generate filename with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            link.download = `vital-signs-${timestamp}.json`;

            // Trigger download
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // Clean up
            URL.revokeObjectURL(url);

            setExporting(false);
            setStatusMessage({
                message: 'Data exported successfully!',
                type: 'success'
            });
        } else {
            // Handle error
            console.error('[App] Export error:', event.data.error);
            setExporting(false);
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
            progressIntervalRef.current = null;
        }

        // First verify that all required components are initialized
        if (!inferenceWorkerRef.current || !videoProcessorRef.current) {
            console.error('[App] Cannot start monitoring - worker or video processor not found');
            setStatusMessage({
                message: 'System initialization incomplete. Please refresh the page.',
                type: 'error'
            });
            return;
        }

        // Double-check worker initialization
        if (!isInitialized) {
            console.error('[App] Cannot start monitoring - worker not initialized');
            setStatusMessage({
                message: 'Inference system not ready. Please wait or refresh the page.',
                type: 'warning'
            });

            // Attempt to recover by reinitializing
            inferenceWorkerRef.current.postMessage({ type: 'init' });
            return;
        }

        // Reset frame collection state
        frameCollectionRef.current = {
            frames: [],
            initialCollectionComplete: false,
            framesSinceLastInference: 0
        };

        // Force local monitoring state regardless of React state
        let isMonitoringActive = true;

        // Implement capture state check directly through videoProcessor instead of React state
        const isCurrentlyCapturing = () => {
            return videoProcessorRef.current?.isCapturing() || false;
        };

        console.log('[App] Starting monitoring interval - system ready');

        progressIntervalRef.current = window.setInterval(() => {
            // Immediately check if we should continue
            if (!isCurrentlyCapturing() || !isMonitoringActive || !isInitialized) {
                if (isMonitoringActive) {
                    console.log('[App] Stopping monitoring - capture inactive');
                    isMonitoringActive = false;
                    if (progressIntervalRef.current) {
                        clearInterval(progressIntervalRef.current);
                        progressIntervalRef.current = null;
                    }
                }
                return;
            }

            // Update buffer progress UI
            if (videoProcessorRef.current) {
                // Get new frames since last check
                const newFrames = videoProcessorRef.current.getNewFrames();

                if (newFrames && newFrames.length > 0) {
                    const { frames, initialCollectionComplete, framesSinceLastInference } = frameCollectionRef.current;

                    // Add new frames to collection
                    frames.push(...newFrames);
                    frameCollectionRef.current.framesSinceLastInference += newFrames.length;

                    // Calculate and update progress
                    const targetFrames = initialCollectionComplete ? SUBSEQUENT_FRAMES : INITIAL_FRAMES;
                    const progress = Math.min(100, (framesSinceLastInference / targetFrames) * 100);
                    
                    if (!initialCollectionComplete) {
                        setBufferProgress(progress);
                    }
                    else {
                        setBufferProgress(100);
                    }

                    // console.log(`[App] Collected ${framesSinceLastInference}/${targetFrames} frames (${progress.toFixed(1)}%)`);
                
                    // Check if we have enough frames for inference
                    if (!initialCollectionComplete && frames.length >= INITIAL_FRAMES) {
                        // Initial collection complete - send all frames
                        // console.log(`[App] Initial collection complete: ${frames.length} frames`);
                        
                        if (inferenceWorkerRef.current) {
                            inferenceWorkerRef.current.postMessage({
                                type: 'inferenceResult',
                                frameBuffer: frames.slice(-INITIAL_FRAMES), // Send last 181 frames
                                timestamp: window.performance.now(),
                                isInitialBatch: true
                            });
                        }

                        // Update collection state
                        frameCollectionRef.current.initialCollectionComplete = true;
                        frameCollectionRef.current.framesSinceLastInference = 0;

                        // Keep only the overlap frames for next batch
                        frameCollectionRef.current.frames = frames.slice(-OVERLAP_FRAMES);

                    } else if (initialCollectionComplete && framesSinceLastInference >= SUBSEQUENT_FRAMES) {
                        // Subsequent collection complete - we need to send overlapping frames plus new frames
                        // console.log(`[App] Subsequent collection complete: ${frames.length} frames total, ${framesSinceLastInference} new`);
                        
                        if (inferenceWorkerRef.current) {
                            // Send overlap frames + new frames (total should be INITIAL_FRAMES)
                            inferenceWorkerRef.current.postMessage({
                                type: 'inferenceResult',
                                frameBuffer: frames.slice(-INITIAL_FRAMES),
                                timestamp: window.performance.now(),
                                isInitialBatch: false
                            });
                        }

                        // Reset counter and keep overlap
                        frameCollectionRef.current.framesSinceLastInference = 0;

                        // Keep only the overlap frames for next batch
                        frameCollectionRef.current.frames = frames.slice(-OVERLAP_FRAMES);
                    }
                }
            }
        }, 100);
    }, [isInitialized]); // Add isInitialized to dependency array


    // Start capture handler
    const handleStartCapture = useCallback(async () => {
        if (!videoProcessorRef.current || !inferenceWorkerRef.current) {
            setStatusMessage({
                message: 'System components not ready. Please refresh the page.',
                type: 'error'
            });
            return;
        }

        // Verify worker initialization before starting capture
        if (!isInitialized) {
            setStatusMessage({
                message: 'Inference system not ready. Please wait a moment.',
                type: 'warning'
            });
            return;
        }

        try {
            setStatusMessage({
                message: 'Starting capture...',
                type: 'info'
            });

            // Reset data and worker state before starting
            inferenceWorkerRef.current.postMessage({
                type: 'reset'
            });
            resetData();

            // Start worker capture first
            inferenceWorkerRef.current.postMessage({
                type: 'startCapture'
            });

            // Then start video capture
            await videoProcessorRef.current.startCapture();

            // Set capturing state only after successful starts
            setIsCapturing(true);

            // Start monitoring after everything is ready
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
    }, [startMonitoring, resetData, isInitialized]); // Add isInitialized to dependency array

    const handleStopCapture = useCallback(async () => {
        if (!videoProcessorRef.current) return;

        console.log('[App] STOP CAPTURE requested');

        // Set state immediately to block UI interactions
        setIsCapturing(false);

        try {
            // IMPORTANT: First stop any monitoring that could send more work to the worker
            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
                progressIntervalRef.current = null;
                console.log('[App] Monitoring interval stopped');
            }

            // Create a Promise for stopping the worker with improved messaging
            const stopWorkerPromise = new Promise<void>((resolve) => {
                // Setup listener before sending message to ensure we catch the response
                const messageHandler = (e: MessageEvent) => {
                    if (e.data.type === 'stopCapture' && e.data.status === 'success') {
                        console.log('[App] Worker confirmed stop capture');
                        inferenceWorkerRef.current?.removeEventListener('message', messageHandler);
                        resolve();
                    }
                };

                // Attach listener directly to the worker
                if (inferenceWorkerRef.current) {
                    inferenceWorkerRef.current.addEventListener('message', messageHandler);

                    console.log('[App] Sending emergency stop command to inference worker');
                    inferenceWorkerRef.current.postMessage({
                        type: 'stopCapture',
                        priority: 'emergency'
                    });

                    // Set a generous timeout
                    setTimeout(() => {
                        console.warn('[App] Worker stop timeout - continuing anyway');
                        inferenceWorkerRef.current?.removeEventListener('message', messageHandler);
                        resolve();
                    }, 2000);
                } else {
                    resolve(); // No worker to stop
                }
            });

            // Stop video capture in parallel with worker stop
            if (videoProcessorRef.current) {
                console.log('[App] Stopping video capture immediately');
                await videoProcessorRef.current.stopCapture();
            }

            // Wait for worker to respond
            await stopWorkerPromise;

            // Reset data and update UI
            resetData();
            setBufferProgress(0);
            setStatusMessage({
                message: 'Capture stopped. Data preserved for export.',
                type: 'info'
            });
        } catch (error) {
            console.error('[App] Error during stop capture:', error);
            // Make absolutely sure we're in stopped state
            setIsCapturing(false);
            setStatusMessage({
                message: `Failed to stop capture properly: ${error instanceof Error ? error.message : 'Unknown error'}`,
                type: 'error'
            });
        }
    }, [resetData]);

    // Export data handler
    const handleExport = useCallback(async () => {
        if (!inferenceWorkerRef.current) return;

        try {
            setExporting(true);
            setStatusMessage({
                message: 'Preparing data export...',
                type: 'info'
            });

            // Request the data from the worker
            inferenceWorkerRef.current.postMessage({
                type: 'exportData'
            });
            console.log('[App] Export data request sent to worker');
        } catch (error) {
            console.error('Export error:', error);
            setStatusMessage({
                message: `Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                type: 'error'
            });
        } finally {
            setExporting(false);
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