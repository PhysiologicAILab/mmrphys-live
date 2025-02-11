import React, { useEffect, useRef } from 'react';
import { VideoDisplayProps } from '@/types';

const VideoDisplay: React.FC<VideoDisplayProps> = ({
    videoProcessor,
    faceDetected,
    bufferProgress,
    isCapturing
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameRef = useRef<number>();

    // Single combined effect for canvas setup and frame processing
    useEffect(() => {
        if (!canvasRef.current || !videoProcessor) return;

        // Attach canvas
        try {
            console.log('Attaching canvas');
            videoProcessor.attachCanvas(canvasRef.current);
        } catch (error) {
            console.error('Error attaching canvas:', error);
            return;
        }

        // Start frame processing if capturing
        if (isCapturing) {
            console.log('Starting frame processing');
            let animationFrame: number;

            const processFrame = () => {
                if (videoProcessor && isCapturing) {
                    videoProcessor.processFrame(null);
                    animationFrame = requestAnimationFrame(processFrame);
                }
            };

            // Start the frame processing loop
            animationFrame = requestAnimationFrame(processFrame);
            animationFrameRef.current = animationFrame;
        }

        // Cleanup function
        return () => {
            console.log('Cleaning up - isCapturing:', isCapturing);
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = undefined;
            }
            if (videoProcessor) {
                console.log('Detaching canvas');
                videoProcessor.detachCanvas();
            }
        };
    }, [videoProcessor, isCapturing]); // Depend on both videoProcessor and isCapturing

    return (
        <div className="video-section">
            <div className={`oval-frame ${faceDetected ? 'face-detected' : ''}`}>
                <canvas
                    ref={canvasRef}
                    width={256}
                    height={256}
                    style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover'
                    }}
                />
                {bufferProgress > 0 && bufferProgress < 100 && (
                    <div className="buffer-progress">
                        <div
                            className="progress-bar"
                            style={{ width: `${bufferProgress}%` }}
                        />
                        <span className="progress-text">
                            Collecting frames: {Math.round(bufferProgress)}%
                        </span>
                    </div>
                )}
                <div className="face-guide" />
            </div>
            {!faceDetected && (
                <div className="no-face-warning">
                    <p>Face detection unavailable</p>
                    <p className="text-sm opacity-75">Using center region for processing</p>
                </div>
            )}
        </div>
    );
};

export default VideoDisplay;