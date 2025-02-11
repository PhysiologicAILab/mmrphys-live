import React, { useEffect, useRef, useState } from 'react';
import { VideoDisplayProps } from '@/types';

const VideoDisplay: React.FC<VideoDisplayProps> = ({
    videoProcessor,
    faceDetected,
    bufferProgress,
    isCapturing
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [error, setError] = useState<string | null>(null);

    // Combined effect for canvas setup and frame processing
    useEffect(() => {
        if (!canvasRef.current || !videoProcessor) return;

        let animationFrameId: number;

        const initializeCanvas = async () => {
            try {
                console.log('Initializing canvas and video display');
                await videoProcessor.attachCanvas(canvasRef.current!);

                if (isCapturing) {
                    const processFrame = () => {
                        if (videoProcessor && isCapturing) {
                            try {
                                videoProcessor.processFrame(null);
                                animationFrameId = requestAnimationFrame(processFrame);
                            } catch (err) {
                                console.error('Frame processing error:', err);
                                setError('Frame processing failed');
                            }
                        }
                    };
                    animationFrameId = requestAnimationFrame(processFrame);
                }
            } catch (err) {
                console.error('Canvas initialization error:', err);
                setError('Failed to initialize video display');
            }
        };

        initializeCanvas();

        return () => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
            if (videoProcessor) {
                videoProcessor.detachCanvas();
            }
        };
    }, [videoProcessor, isCapturing]);

    return (
        <div className="video-section">
            <div className={`oval-frame ${faceDetected ? 'face-detected' : ''}`}>
                <canvas
                    ref={canvasRef}
                    width={256}
                    height={256}
                    className="w-full h-full object-cover"
                />
                {bufferProgress > 0 && bufferProgress < 100 && (
                    <div className="buffer-progress">
                        <div
                            className="progress-bar"
                            style={{ width: `${bufferProgress}%` }}
                        />
                        <span className="progress-text">
                            {Math.round(bufferProgress)}% Ready
                        </span>
                    </div>
                )}
                <div className="face-guide" />
            </div>

            {error && (
                <div className="error-message mt-2 text-error text-center">
                    {error}
                </div>
            )}

            {!faceDetected && !error && (
                <div className="no-face-warning">
                    <p>Position your face in the oval</p>
                    <p className="text-sm opacity-75">
                        Using center region for processing
                    </p>
                </div>
            )}
        </div>
    );
};

export default VideoDisplay;