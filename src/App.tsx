import React, { useState, useEffect, useRef, useCallback } from 'react';
import { VideoProcessor } from './utils/videoProcessor';
import { FaceDetector } from './utils/faceDetector';
import { SignalProcessor } from './utils/signalProcessor';
import VideoDisplay from './components/VideoDisplay';
import Controls from './components/Controls';
import VitalSignsChart from './components/VitalSignsChart';
import VitalSignsChartWrapper from './components/VitalSignsChartWrapper';
import StatusMessage from './components/StatusMessage';
import type { InferenceResult } from './utils/modelInference';

// Define types for component state and refs
interface VitalSigns {
    heartRate: number;
    respRate: number;
    bvpSignal: number[];
    respSignal: number[];
    lastUpdateTime?: number;
}

interface Status {
    message: string;
    type: 'info' | 'success' | 'error';
    timestamp?: number;
}

interface ComponentRefs {
    videoProcessor: VideoProcessor | null;
    faceDetector: FaceDetector | null;
    signalProcessor: SignalProcessor | null;
    inferenceWorker: Worker | null;
    animationFrameId: number | null;
    lastInferenceTime: number;
}

interface WorkerMessage {
    type: string;
    status: 'success' | 'error';
    results?: InferenceResult;
    error?: string;
    performanceStats?: {
        totalInferences: number;
        averageProcessingTime: number;
        lastProcessingTime: number;
        errorCount: number;
        timestamp: number;
    };
}

const INFERENCE_INTERVAL = 2000; // 2 seconds
const REQUIRED_FRAMES = 150; // 5 seconds at 30fps
const WORKER_TIMEOUT = 15000; // 15 seconds for worker initialization
const MAX_FACE_MISSING_TIME = 3000; // 3 seconds before showing face detection warning


const App: React.FC = () => {
    // State management
    const [isCapturing, setIsCapturing] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [hasMinimumFrames, setHasMinimumFrames] = useState(false);
    const [faceDetected, setFaceDetected] = useState(false);
    const [bufferProgress, setBufferProgress] = useState(0);
    const [status, setStatus] = useState<Status>({
        message: 'Initializing...',
        type: 'info',
        timestamp: Date.now()
    });
    const [vitalSigns, setVitalSigns] = useState<VitalSigns>({
        heartRate: 0,
        respRate: 0,
        bvpSignal: [],
        respSignal: [],
        lastUpdateTime: Date.now()
    });

    // Last face detection time tracking
    const lastFaceDetectionTime = useRef(0);

    // Refs for components that need to persist between renders
    const componentsRef = useRef<ComponentRefs>({
        videoProcessor: null,
        faceDetector: null,
        signalProcessor: null,
        inferenceWorker: null,
        animationFrameId: null,
        lastInferenceTime: 0
    });

    const logComponentState = useCallback(() => {
        const { videoProcessor, faceDetector, inferenceWorker } = componentsRef.current;
        console.log('Component State:', {
            isCapturing,
            hasMinimumFrames,
            faceDetected,
            bufferProgress,
            videoProcessorActive: videoProcessor?.isCapturing(),
            faceDetectorActive: faceDetector?.isDetecting(),
            hasWorker: !!inferenceWorker,
            signalLengths: {
                bvp: vitalSigns.bvpSignal.length,
                resp: vitalSigns.respSignal.length
            }
        });
    }, [isCapturing, hasMinimumFrames, faceDetected, bufferProgress, vitalSigns]);

    // Add this effect to monitor state changes
    useEffect(() => {
        logComponentState();
    }, [isCapturing, hasMinimumFrames, faceDetected, bufferProgress, logComponentState]);


    // Update status with timestamp
    const updateStatus = useCallback((message: string, type: Status['type']) => {
        setStatus({
            message,
            type,
            timestamp: Date.now()
        });
    }, []);

    // Update face detection status
    const updateFaceDetectionStatus = useCallback((detected: boolean) => {
        const currentTime = Date.now();

        if (detected) {
            lastFaceDetectionTime.current = currentTime;
            if (!faceDetected) {
                setFaceDetected(true);
                updateStatus('Face detected', 'success');
            }
        } else if (currentTime - lastFaceDetectionTime.current > MAX_FACE_MISSING_TIME) {
            setFaceDetected(false);
            updateStatus('Please position your face in the frame', 'error');
        }
    }, [faceDetected, updateStatus]);

    // Device compatibility check
    const checkDeviceSupport = useCallback(async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('Camera access not supported in this browser');
        }

        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasCamera = devices.some(device => device.kind === 'videoinput');
        const videoinput = devices.filter(device => device.kind === 'videoinput');

        console.log('Available video input devices:', videoinput);

        if (!hasCamera) {
            throw new Error('No camera detected');
        }

        // Check for required WebAssembly features
        if (typeof WebAssembly !== 'object') {
            throw new Error('WebAssembly not supported in this browser');
        }

        // Check for SharedArrayBuffer support (needed for ONNX Runtime)
        if (typeof SharedArrayBuffer !== 'function') {
            throw new Error('SharedArrayBuffer not supported in this browser');
        }
    }, []);

    // Handle inference results with smooth updates
    const handleInferenceResults = useCallback((results: InferenceResult | undefined) => {
        if (!results || !isCapturing) return;

        console.log('Processing inference results:', {
            heartRate: results.heartRate,
            respRate: results.respRate,
            bvpLength: results.bvp.length,
            respLength: results.resp.length
        });

        // Validate results before updating
        if (!results.bvp?.length || !results.resp?.length) {
            console.warn('Invalid inference results received');
            return;
        }

        setVitalSigns(prev => {
            return {
                heartRate: results.heartRate || prev.heartRate,
                respRate: results.respRate || prev.respRate,
                bvpSignal: [...results.bvp], // Create new array to ensure re-render
                respSignal: [...results.resp],
                lastUpdateTime: Date.now()
            };
        });

        if (componentsRef.current.signalProcessor) {
            try {
                componentsRef.current.signalProcessor.updateBuffers(results);
            } catch (error) {
                console.error('Error updating signal buffers:', error);
            }
        }
    }, [isCapturing]);


    const initializeWorker = useCallback(async () => {
        return new Promise<void>((resolve, reject) => {
            let initTimeoutId: NodeJS.Timeout;
            let worker: Worker | null = null;

            const cleanup = () => {
                if (initTimeoutId) clearTimeout(initTimeoutId);
                if (worker) {
                    worker.removeEventListener('message', handleMessage);
                    worker.removeEventListener('error', handleError);
                }
            };

            const handleError = (event: ErrorEvent) => {
                cleanup();
                const errorMessage = event.message || 'Unknown worker error';
                console.error('Worker initialization error:', errorMessage);
                worker?.terminate();
                reject(new Error(errorMessage));
            };

            const handleMessage = (e: MessageEvent<WorkerMessage>) => {
                console.log('Worker message received:', e.data); // Log all worker messages
                if (e.data.type === 'init') {
                    cleanup();

                    if (e.data.status === 'success') {
                        componentsRef.current.inferenceWorker = worker;

                        // Set up normal operation message handler
                        worker!.onmessage = (e: MessageEvent<WorkerMessage>) => {
                            if (e.data.type === 'inference' && e.data.status === 'success') {
                                handleInferenceResults(e.data.results);
                            } else if (e.data.status === 'error') {
                                console.error('Worker inference error:', e.data.error);
                                updateStatus(`Inference error: ${e.data.error}`, 'error');
                            }
                        };

                        resolve();
                    } else {
                        const error = new Error(e.data.error || 'Worker initialization failed');
                        worker?.terminate();
                        reject(error);
                    }
                }
            };

            try {
                // Create worker
                worker = new Worker(
                    new URL('./workers/inferenceWorker.ts', import.meta.url),
                    { type: 'module' }
                );

                // Add event listeners
                worker.addEventListener('message', handleMessage);
                worker.addEventListener('error', handleError);

                // Set initialization timeout
                initTimeoutId = setTimeout(() => {
                    cleanup();
                    worker?.terminate();
                    reject(new Error('Worker initialization timed out'));
                }, WORKER_TIMEOUT);

                // Start initialization
                worker.postMessage({ type: 'init' });

            } catch (error) {
                cleanup();
                reject(error instanceof Error ? error : new Error('Failed to create worker'));
            }
        });
    }, [handleInferenceResults, updateStatus]);

    // Initialization of all components
    const initializeComponents = useCallback(async () => {
        try {
            updateStatus('Checking device compatibility...', 'info');
            await checkDeviceSupport();

            updateStatus('Loading required resources...', 'info');
            const [config] = await Promise.all([
                fetch('/models/rphys/config.json', {
                    cache: 'force-cache',
                    credentials: 'same-origin'
                }).then(res => res.json()),
                fetch('/models/rphys/SCAMPS_Multi_9x9.onnx', {
                    cache: 'force-cache',
                    credentials: 'same-origin'
                }),
                fetch('/models/face-api/tiny_face_detector_model-weights_manifest.json', {
                    cache: 'force-cache',
                    credentials: 'same-origin'
                })
            ]);

            // Initialize components
            componentsRef.current.videoProcessor = new VideoProcessor();

            updateStatus('Initializing face detection...', 'info');
            const faceDetector = new FaceDetector();
            await faceDetector.initialize();
            componentsRef.current.faceDetector = faceDetector;

            componentsRef.current.signalProcessor = new SignalProcessor();

            // Configure components
            if (componentsRef.current.signalProcessor) {
                componentsRef.current.signalProcessor.setConfig(config);
            }

            updateStatus('Initializing face detection...', 'info');
            await componentsRef.current.faceDetector.initialize();

            updateStatus('Initializing inference worker...', 'info');
            await initializeWorker();

            setIsInitialized(true);
            updateStatus('System ready', 'success');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown initialization error';
            updateStatus(`Initialization failed: ${errorMessage}`, 'error');
            console.error('Initialization error:', error);
        }
    }, [checkDeviceSupport, initializeWorker, updateStatus]);

    // Process video frames with buffer tracking
    const processFrames = useCallback(() => {
        if (!isCapturing) {
            console.log('Frame processing stopped');
            return;
        }

        const { videoProcessor, faceDetector, inferenceWorker, lastInferenceTime } = componentsRef.current;

        if (!videoProcessor || !faceDetector || !inferenceWorker) {
            console.warn('Missing required components for frame processing');
            return;
        }

        const currentTime = Date.now();
        const faceBox = faceDetector.getCurrentFaceBox();

        updateFaceDetectionStatus(!!faceBox);

        if (faceBox && videoProcessor.isCapturing()) {
            try {
                const processedFrame = videoProcessor.processFrame(faceBox);

                if (processedFrame) {
                    videoProcessor.updateFrameBuffer(processedFrame);

                    const progress = videoProcessor.getBufferUsagePercentage();
                    setBufferProgress(progress);

                    const hasMinFrames = videoProcessor.hasMinimumFrames();
                    if (hasMinFrames !== hasMinimumFrames) {
                        setHasMinimumFrames(hasMinFrames);
                    }

                    // Run inference when we have enough frames
                    if (hasMinFrames && currentTime - lastInferenceTime >= INFERENCE_INTERVAL) {
                        const frameBuffer = videoProcessor.getFrameBuffer();
                        inferenceWorker.postMessage({
                            type: 'inference',
                            data: { frameBuffer }
                        });
                        componentsRef.current.lastInferenceTime = currentTime;
                    }
                }
            } catch (error) {
                console.error('Error processing frame:', error);
            }
        }

        // Continue frame processing only if still capturing
        if (isCapturing) {
            componentsRef.current.animationFrameId = requestAnimationFrame(processFrames);
        }
    }, [isCapturing, updateFaceDetectionStatus, hasMinimumFrames]);

    // Start video capture
    const startCapture = useCallback(async () => {
        try {
            const { videoProcessor, faceDetector } = componentsRef.current;

            if (!videoProcessor || !faceDetector) {
                throw new Error('Components not initialized');
            }

            updateStatus('Starting capture...', 'info');

            // First start video capture
            await videoProcessor.startCapture();
            console.log('Video capture started');

            // Ensure video is playing before starting face detection
            await new Promise<void>((resolve) => {
                const checkVideo = () => {
                    if (videoProcessor.videoElement.readyState >= 2 &&
                        videoProcessor.videoElement.videoWidth > 0) {
                        resolve();
                    } else {
                        requestAnimationFrame(checkVideo);
                    }
                };
                checkVideo();
            });

            // Clear frame buffer before starting
            videoProcessor.clearFrameBuffer();
            setBufferProgress(0);
            setHasMinimumFrames(false);

            // Then start face detection
            faceDetector.startDetection(videoProcessor.videoElement);
            console.log('Face detection started');

            // Start frame processing
            setIsCapturing(true);
            processFrames();

            updateStatus('Capture started', 'success');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown capture error';
            updateStatus(`Failed to start capture: ${errorMessage}`, 'error');
            console.error('Capture start error:', error);
            await stopCapture();
        }
    }, [updateStatus, processFrames]);

    const stopCapture = useCallback(async () => {
        try {
            // First set capturing to false to stop frame processing
            setIsCapturing(false);

            const { animationFrameId, videoProcessor, faceDetector, inferenceWorker } = componentsRef.current;

            // Cancel any pending animation frame
            if (animationFrameId !== null) {
                cancelAnimationFrame(animationFrameId);
                componentsRef.current.animationFrameId = null;
            }

            // Stop face detection immediately
            if (faceDetector) {
                console.log('Stopping face detection');
                faceDetector.stopDetection();
                await faceDetector.dispose();
                componentsRef.current.faceDetector = null;
            }

            // Stop video capture
            if (videoProcessor) {
                console.log('Stopping video capture');
                await videoProcessor.stopCapture();
            }

            // Terminate worker
            if (inferenceWorker) {
                console.log('Terminating inference worker');
                inferenceWorker.terminate();
                componentsRef.current.inferenceWorker = null;
            }

            // Reset all states
            setFaceDetected(false);
            setHasMinimumFrames(false);
            setBufferProgress(0);
            setVitalSigns({
                heartRate: 0,
                respRate: 0,
                bvpSignal: [],
                respSignal: [],
                lastUpdateTime: Date.now()
            });

            // Reinitialize components for next capture
            try {
                console.log('Reinitializing components');
                // Create and initialize new face detector
                const newFaceDetector = new FaceDetector();
                await newFaceDetector.initialize();
                componentsRef.current.faceDetector = newFaceDetector;

                // Initialize new worker
                await initializeWorker();
            } catch (error) {
                console.error('Error reinitializing components:', error);
                updateStatus('Error reinitializing components', 'error');
            }

            updateStatus('Capture stopped', 'success');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown stop capture error';
            updateStatus(`Error stopping capture: ${errorMessage}`, 'error');
            console.error('Capture stop error:', error);
        }
    }, [updateStatus, initializeWorker]);

    // Export collected data
    const exportData = useCallback(() => {
        try {
            const { signalProcessor } = componentsRef.current;

            if (!signalProcessor) {
                throw new Error('Signal processor not initialized');
            }

            const data = signalProcessor.getExportData();
            const blob = new Blob([data], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const filename = `vital_signs_${new Date().toISOString()}.csv`;

            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            updateStatus('Data exported successfully', 'success');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown export error';
            updateStatus(`Export failed: ${errorMessage}`, 'error');
            console.error('Data export error:', error);
        }
    }, [updateStatus]);

    // Initialize components on mount and cleanup on unmount
    useEffect(() => {
        let isMounted = true;

        const init = async () => {
            try {
                if (isMounted) {
                    await initializeComponents();
                }
            } catch (error) {
                console.error('Initialization error:', error);
            }
        };

        init();

        return () => {
            isMounted = false;
            const { animationFrameId, inferenceWorker } = componentsRef.current;

            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }

            if (inferenceWorker) {
                inferenceWorker.terminate();
            }

            if (isCapturing) {
                stopCapture();
            }
        };
    }, [initializeComponents, stopCapture, isCapturing]);

    return (
        <div className="app-container">
            <header className="app-header">
                <h1>Camera-based Remote Physiological Sensing</h1>
                <Controls
                    isCapturing={isCapturing}
                    isInitialized={isInitialized}
                    onStart={startCapture}
                    onStop={stopCapture}
                    onExport={exportData}
                />
            </header>

            <main className="app-main">
                <VideoDisplay
                    videoProcessor={componentsRef.current.videoProcessor}
                    faceDetected={faceDetected}
                    bufferProgress={bufferProgress}
                />

                <div className="charts-section">
                    <VitalSignsChartWrapper
                        title="Blood Volume Pulse"
                        data={vitalSigns.bvpSignal}
                        rate={vitalSigns.heartRate}
                        type="bvp"
                        isReady={hasMinimumFrames}
                    />
                    <VitalSignsChartWrapper
                        title="Respiratory Signal"
                        data={vitalSigns.respSignal}
                        rate={vitalSigns.respRate}
                        type="resp"
                        isReady={hasMinimumFrames}
                    />
                </div>
            </main>

            <StatusMessage
                message={status.message}
                type={status.type}
            />
        </div>
    );
};

export default App;