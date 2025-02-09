import React, { useState, useEffect, useRef, useCallback } from 'react';
import { VideoProcessor } from './utils/videoProcessor';
import { FaceDetector } from './utils/faceDetector';
import { SignalProcessor } from './utils/signalProcessor';
import VideoDisplay from './components/VideoDisplay';
import Controls from './components/Controls';
import VitalSignsChart from './components/VitalSignsChart';
import StatusMessage from './components/StatusMessage';

// Define types for component state and refs
interface VitalSigns {
    heartRate: number;
    respRate: number;
    bvpSignal: number[];
    respSignal: number[];
}

interface Status {
    message: string;
    type: 'info' | 'success' | 'error';
}

interface ComponentRefs {
    videoProcessor: VideoProcessor | null;
    faceDetector: FaceDetector | null;
    signalProcessor: SignalProcessor | null;
    inferenceWorker: Worker | null;
    animationFrameId: number | null;
}

const App: React.FC = () => {
    // State management
    const [isCapturing, setIsCapturing] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [status, setStatus] = useState<Status>({
        message: 'Initializing...',
        type: 'info'
    });
    const [vitalSigns, setVitalSigns] = useState<VitalSigns>({
        heartRate: 0,
        respRate: 0,
        bvpSignal: [],
        respSignal: []
    });

    // Refs for components that need to persist between renders
    const componentsRef = useRef<ComponentRefs>({
        videoProcessor: null,
        faceDetector: null,
        signalProcessor: null,
        inferenceWorker: null,
        animationFrameId: null
    });

    // Device compatibility check
    const checkDeviceSupport = useCallback(async () => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Camera access not supported in this browser');
        }

        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!devices.some(device => device.kind === 'videoinput')) {
            throw new Error('No camera detected');
        }
    }, []);

    // Initialize worker with error handling
    const initializeWorker = useCallback(async () => {
        return new Promise<void>((resolve, reject) => {
            componentsRef.current.inferenceWorker = new Worker(
                new URL('./workers/inferenceWorker.ts', import.meta.url),
                { type: 'module' }
            );

            const timeout = setTimeout(() => {
                reject(new Error('Worker initialization timeout'));
            }, 10000);

            const worker = componentsRef.current.inferenceWorker;

            if (!worker) {
                reject(new Error('Failed to create inference worker'));
                return;
            }

            worker.onmessage = (e) => {
                if (e.data.type === 'init') {
                    clearTimeout(timeout);
                    if (e.data.status === 'success') {
                        resolve();
                    } else {
                        reject(new Error(e.data.error));
                    }
                } else if (e.data.type === 'inference' && e.data.status === 'success') {
                    handleInferenceResults(e.data.results);
                }
            };

            worker.postMessage({ type: 'init' });
        });
    }, []);

    // Handle inference results
    const handleInferenceResults = useCallback((results: any) => {
        if (!results) return;

        setVitalSigns(prev => ({
            ...prev,
            heartRate: results.heartRate || prev.heartRate,
            respRate: results.respRate || prev.respRate,
            bvpSignal: results.bvp || prev.bvpSignal,
            respSignal: results.resp || prev.respSignal
        }));

        if (componentsRef.current.signalProcessor) {
            componentsRef.current.signalProcessor.updateBuffers(results);
        }
    }, []);

    // Initialization of all components
    const initializeComponents = useCallback(async () => {
        try {
            // Check device support
            setStatus({ message: 'Checking device compatibility...', type: 'info' });
            await checkDeviceSupport();

            // Pre-fetch required resources
            setStatus({ message: 'Loading required resources...', type: 'info' });
            const configPromise = fetch('/models/rphys/config.json', {
                cache: 'force-cache',
                credentials: 'same-origin'
            }).then(res => res.json());

            const modelPromise = fetch('/models/rphys/SCAMPS_Multi_9x9.onnx', {
                cache: 'force-cache',
                credentials: 'same-origin'
            });

            const manifestPromise = fetch('/models/face-api/tiny_face_detector_model-weights_manifest.json', {
                cache: 'force-cache',
                credentials: 'same-origin'
            });

            // Initialize components while resources are being fetched
            componentsRef.current.videoProcessor = new VideoProcessor();
            componentsRef.current.faceDetector = new FaceDetector();
            componentsRef.current.signalProcessor = new SignalProcessor();

            // Wait for all resources to be fetched
            const [config] = await Promise.all([
                configPromise,
                modelPromise,
                manifestPromise
            ]);

            // Store config for later use
            if (componentsRef.current.signalProcessor) {
                componentsRef.current.signalProcessor.setConfig(config);
            }

            // Initialize face detector
            await componentsRef.current.faceDetector.initialize();

            // Initialize worker
            await initializeWorker();

            // Mark as initialized
            setIsInitialized(true);
            setStatus({ message: 'System ready', type: 'success' });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown initialization error';
            setStatus({
                message: `Initialization failed: ${errorMessage}`,
                type: 'error'
            });
            console.error('Initialization error:', error);
        }
    }, [checkDeviceSupport, initializeWorker]);

    // Start video capture
    const startCapture = useCallback(async () => {
        try {
            if (!componentsRef.current.videoProcessor ||
                !componentsRef.current.faceDetector) {
                throw new Error('Components not initialized');
            }

            setStatus({ message: 'Starting capture...', type: 'info' });

            // Start video capture
            await componentsRef.current.videoProcessor.startCapture();

            // Start face detection
            await componentsRef.current.faceDetector.startDetection(
                componentsRef.current.videoProcessor.videoElement
            );

            // Set capturing state and start processing
            setIsCapturing(true);
            processFrames();

            setStatus({ message: 'Capturing started', type: 'success' });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown capture error';
            setStatus({
                message: `Failed to start capture: ${errorMessage}`,
                type: 'error'
            });
            console.error('Capture start error:', error);
        }
    }, []);

    // Stop video capture
    const stopCapture = useCallback(async () => {
        try {
            // Stop animation frame
            if (componentsRef.current.animationFrameId) {
                cancelAnimationFrame(componentsRef.current.animationFrameId);
                componentsRef.current.animationFrameId = null;
            }

            // Stop video processor
            if (componentsRef.current.videoProcessor) {
                await componentsRef.current.videoProcessor.stopCapture();
            }

            // Stop face detection
            if (componentsRef.current.faceDetector) {
                componentsRef.current.faceDetector.stopDetection();
            }

            // Update states
            setIsCapturing(false);
            setStatus({ message: 'Capture stopped', type: 'success' });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown stop capture error';
            setStatus({
                message: `Error stopping capture: ${errorMessage}`,
                type: 'error'
            });
            console.error('Capture stop error:', error);
        }
    }, []);

    // Process video frames
    const processFrames = useCallback(() => {
        if (!isCapturing) return;

        const videoProcessor = componentsRef.current.videoProcessor;
        const faceDetector = componentsRef.current.faceDetector;
        const inferenceWorker = componentsRef.current.inferenceWorker;

        if (!videoProcessor || !faceDetector || !inferenceWorker) return;

        // Get current face box
        const faceBox = faceDetector.getCurrentFaceBox();

        if (faceBox) {
            // Process frame
            const processedFrame = videoProcessor.processFrame(faceBox);

            if (processedFrame) {
                videoProcessor.updateFrameBuffer(processedFrame);
            }

            // Run inference every 2 seconds if we have enough frames
            const frameBuffer = videoProcessor.getFrameBuffer();
            if (frameBuffer.length >= 90) {
                inferenceWorker.postMessage({
                    type: 'inference',
                    data: { frameBuffer }
                });
            }
        }

        // Schedule next frame processing
        componentsRef.current.animationFrameId = requestAnimationFrame(processFrames);
    }, [isCapturing]);

    // Export collected data
    const exportData = useCallback(() => {
        try {
            if (!componentsRef.current.signalProcessor) {
                throw new Error('Signal processor not initialized');
            }

            // Get export data
            const data = componentsRef.current.signalProcessor.getExportData();

            // Create and trigger download
            const blob = new Blob([data], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `vital_signs_${new Date().toISOString()}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            setStatus({ message: 'Data exported successfully', type: 'success' });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown export error';
            setStatus({
                message: `Export failed: ${errorMessage}`,
                type: 'error'
            });
            console.error('Data export error:', error);
        }
    }, []);

    // Initialize components on mount and cleanup on unmount
    useEffect(() => {
        initializeComponents();

        return () => {
            if (componentsRef.current.animationFrameId) {
                cancelAnimationFrame(componentsRef.current.animationFrameId);
            }

            if (componentsRef.current.inferenceWorker) {
                componentsRef.current.inferenceWorker.terminate();
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