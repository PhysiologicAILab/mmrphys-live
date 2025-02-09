import React, { useEffect, useRef } from 'react';
import { VideoDisplayProps } from '@/types';

const VideoDisplay: React.FC<VideoDisplayProps> = ({ videoProcessor }) => {
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
            <div className="oval-frame">
                <canvas
                    ref={canvasRef}
                    id="croppedFace"
                    width={256}
                    height={256}
                />
            </div>
        </div>
    );
};

export default VideoDisplay;