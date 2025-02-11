// src/hooks/useMediaStream.ts
import { useState, useEffect, useCallback } from 'react';

interface UseMediaStreamProps {
    onError: (error: Error) => void;
}

export const useMediaStream = ({ onError }: UseMediaStreamProps) => {
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const startStream = useCallback(async () => {
        if (stream) return stream;

        setIsLoading(true);
        try {
            const newStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'user',
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: 30 }
                }
            });
            setStream(newStream);
            return newStream;
        } catch (error) {
            onError(error instanceof Error ? error : new Error('Failed to access camera'));
            return null;
        } finally {
            setIsLoading(false);
        }
    }, [stream, onError]);

    const stopStream = useCallback(() => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            setStream(null);
        }
    }, [stream]);

    useEffect(() => {
        return () => {
            stopStream();
        };
    }, [stopStream]);

    return {
        stream,
        isLoading,
        startStream,
        stopStream
    };
};