import React, { useState, useEffect, useRef, useCallback } from 'react';
import { VideoProcessor } from './utils/videoProcessor';
import { FaceDetector } from './utils/faceDetector';
import { SignalProcessor } from './utils/signalProcessor';
import VideoDisplay from './components/VideoDisplay';
import Controls from './components/Controls';
import VitalSignsChart from './components/VitalSignsChart';
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
const REQUIRED_FRAMES = 90; // Number of frames needed for inference

const App: React.FC = () => {
    // State management
    const [isCapturing, setIsCapturing] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
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

    // Refs for components that need to persist between renders
    const componentsRef = useRef<ComponentRefs>({
        videoProcessor: null,
        faceDetector: null,
        signalProcessor: null,
        inferenceWorker: null,
        animationFrameId: null,
        lastInferenceTime: 0
    });

    // Update status with timestamp
    const updateStatus = useCallback((message: string, type: Status['type']) => {
        setStatus({
            message,
            type,
            timestamp: Date.now()
        });
    }, []);

    // Device compatibility check
    const checkDeviceSupport = useCallback(async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('Camera access not supported in this browser');
        }

        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasCamera = devices.some(device => device.kind === 'videoinput');

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

    // Initialize worker with error handling
    const initializeWorker = useCallback(async () => {
        return new Promise<void>((resolve, reject) => {
            try {
                const worker = new Worker(
                    new URL('./workers/inferenceWorker.ts', import.meta.url),
                    { type: 'module' }
                );

                const timeout = setTimeout(() => {
                    worker.terminate();
                    reject(new Error('Worker initialization timeout'));
                }, 10000);

                worker.onerror = (error) => {
                    clearTimeout(timeout);
                    reject(new Error(`Worker error: ${error.message}`));
                };

                worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
                    if (e.data.type === 'init') {
                        clearTimeout(timeout);
                        if (e.data.status === 'success') {
                            componentsRef.current.inferenceWorker = worker;
                            resolve();
                        } else {
                            reject(new Error(e.data.error || 'Worker initialization failed'));
                        }
                    } else if (e.data.type === 'inference' && e.data.status === 'success') {
                        handleInferenceResults(e.data.results);
                    }
                };

                worker.postMessage({ type: 'init' });
            } catch (error) {
                reject(error);
            }
        });
    }, []);

    // Handle inference results
    const handleInferenceResults = useCallback((results: InferenceResult | undefined) => {
        if (!results) return;

        setVitalSigns(prev => ({
            ...prev,
            heartRate: results.heartRate || prev.heartRate,
            respRate: results.respRate || prev.respRate,
            bvpSignal: results.bvp || prev.bvpSignal,
            respSignal: results.resp || prev.respSignal,
            lastUpdateTime: Date.now()
        }));

        if (componentsRef.current.signalProcessor) {
            componentsRef.current.signalProcessor.updateBuffers(results);
        }
    }, []);

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
            componentsRef.current.faceDetector = new FaceDetector();
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

    // Start video capture
    const startCapture = useCallback(async () => {
        try {
            const { videoProcessor, faceDetector } = componentsRef.current;

            if (!videoProcessor || !faceDetector) {
                throw new Error('Components not initialized');
            }

            updateStatus('Starting capture...', 'info');

            await videoProcessor.startCapture();
            await faceDetector.startDetection(videoProcessor.videoElement);

            setIsCapturing(true);
            processFrames();
            updateStatus('Capturing started', 'success');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown capture error';
            updateStatus(`Failed to start capture: ${errorMessage}`, 'error');
            console.error('Capture start error:', error);
        }
    }, [updateStatus]);

    // Stop video capture
    const stopCapture = useCallback(async () => {
        try {
            const { animationFrameId, videoProcessor, faceDetector } = componentsRef.current;

            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                componentsRef.current.animationFrameId = null;
            }

            if (videoProcessor) {
                await videoProcessor.stopCapture();
            }

            if (faceDetector) {
                faceDetector.stopDetection();
            }

            setIsCapturing(false);
            updateStatus('Capture stopped', 'success');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown stop capture error';
            updateStatus(`Error stopping capture: ${errorMessage}`, 'error');
            console.error('Capture stop error:', error);
        }
    }, [updateStatus]);

    // Process video frames
    const processFrames = useCallback(() => {
        if (!isCapturing) return;

        const { videoProcessor, faceDetector, inferenceWorker, lastInferenceTime } = componentsRef.current;

        if (!videoProcessor || !faceDetector || !inferenceWorker) return;

        const currentTime = Date.now();
        const faceBox = faceDetector.getCurrentFaceBox();

        if (faceBox) {
            const processedFrame = videoProcessor.processFrame(faceBox);

            if (processedFrame) {
                videoProcessor.updateFrameBuffer(processedFrame);
            }

            // Run inference if enough time has passed and we have enough frames
            const frameBuffer = videoProcessor.getFrameBuffer();
            if (frameBuffer.length >= REQUIRED_FRAMES &&
                currentTime - lastInferenceTime >= INFERENCE_INTERVAL) {

                inferenceWorker.postMessage({
                    type: 'inference',
                    data: { frameBuffer }
                });

                componentsRef.current.lastInferenceTime = currentTime;
            }
        }

        componentsRef.current.animationFrameId = requestAnimationFrame(processFrames);
    }, [isCapturing]);

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
        initializeComponents();

        return () => {
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
                <h1>Vital Signs Monitor</h1>
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
                />

                <div className="charts-section">
                    <VitalSignsChart
                        title="Blood Volume Pulse"
                        data={vitalSigns.bvpSignal}
                        rate={vitalSigns.heartRate}
                        type="bvp"
                    />
                    <VitalSignsChart
                        title="Respiratory Signal"
                        data={vitalSigns.respSignal}
                        rate={vitalSigns.respRate}
                        type="resp"
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