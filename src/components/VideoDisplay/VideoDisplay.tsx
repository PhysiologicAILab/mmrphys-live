import React, { useEffect, useRef } from 'react';
import { VideoDisplayProps } from '@/types';

const VideoDisplay: React.FC<VideoDisplayProps> = ({
    videoProcessor,
    faceDetected,
    bufferProgress
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (canvasRef.current && videoProcessor) {
            videoProcessor.attachCanvas(canvasRef.current);
        }

        return () => {
            if (videoProcessor) {
                videoProcessor.detachCanvas();
            }
        };
    }, [videoProcessor]);

    return (
        <div className="video-section">
            <div className={`oval-frame ${faceDetected ? 'face-detected' : ''}`}>
                <canvas
                    ref={canvasRef}
                    id="croppedFace"
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