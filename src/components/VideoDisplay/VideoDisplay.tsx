// VideoDisplay.tsx
import React, { useEffect, useRef } from 'react';
import { VideoDisplayProps } from '@/types';

const VideoDisplay: React.FC<VideoDisplayProps> = ({
    videoProcessor,
    faceDetected,
    bufferProgress
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (!canvasRef.current || !videoProcessor) return;

        try {
            // Clear any existing display
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                ctx.fillStyle = 'black';
                ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            }

            // Attach new canvas
            videoProcessor.attachCanvas(canvasRef.current);
            console.log('Canvas attached successfully');

            return () => {
                videoProcessor.detachCanvas();
            };
        } catch (error) {
            console.error('Error in VideoDisplay:', error);
        }
    }, [videoProcessor, canvasRef]);

    return (
        <div className="video-section">
            <div className={`oval-frame ${faceDetected ? 'face-detected' : ''}`}>
                <canvas
                    ref={canvasRef}
                    width={256}
                    height={256}
                    style={{ width: '100%', height: '100%' }}
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
                    Please position your face in the frame
                </div>
            )}
        </div>
    );
};

export default VideoDisplay;