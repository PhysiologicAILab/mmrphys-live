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

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', {
            alpha: false,
            desynchronized: true
        });

        if (!ctx) {
            console.error('Failed to get canvas context');
            return;
        }

        // Clear canvas
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        try {
            videoProcessor.attachCanvas(canvas);
            console.log('Canvas attached successfully');
        } catch (error) {
            console.error('Error attaching canvas:', error);
        }

        return () => {
            try {
                videoProcessor.detachCanvas();
            } catch (error) {
                console.error('Error detaching canvas:', error);
            }
        };
    }, [videoProcessor]);

    return (
        <div className="video-section">
            <div className={`oval-frame ${faceDetected ? 'face-detected' : ''}`}>
                <canvas
                    ref={canvasRef}
                    width={256}
                    height={256}
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