// src/hooks/useVitalSigns.ts
import { useState, useEffect, useCallback } from 'react';
import { VitalSigns } from '@/types';

interface UseVitalSignsProps {
    isCapturing: boolean;
    onError: (error: Error) => void;
}

export const useVitalSigns = ({ isCapturing, onError }: UseVitalSignsProps) => {
    const [vitalSigns, setVitalSigns] = useState<VitalSigns>({
        heartRate: 0,
        respRate: 0,
        bvpSignal: [],
        respSignal: []
    });

    const [quality, setQuality] = useState({
        bvp: { snr: 0, quality: 'poor' as const, confidence: 0 },
        resp: { snr: 0, quality: 'poor' as const, confidence: 0 }
    });

    const [metrics, setMetrics] = useState({
        fps: 0,
        processingTime: 0,
        bufferSize: 0,
        dropRate: 0
    });

    // Update vital signs
    const updateVitalSigns = useCallback((data: Partial<VitalSigns>) => {
        setVitalSigns(prev => ({
            ...prev,
            ...data
        }));
    }, []);

    // Update signal quality
    const updateQuality = useCallback((type: 'bvp' | 'resp', qualityData: typeof quality.bvp) => {
        setQuality(prev => ({
            ...prev,
            [type]: qualityData
        }));
    }, []);

    // Update performance metrics
    const updateMetrics = useCallback((newMetrics: Partial<typeof metrics>) => {
        setMetrics(prev => ({
            ...prev,
            ...newMetrics
        }));
    }, []);

    // Reset all data
    const resetData = useCallback(() => {
        setVitalSigns({
            heartRate: 0,
            respRate: 0,
            bvpSignal: [],
            respSignal: []
        });
        setQuality({
            bvp: { snr: 0, quality: 'poor', confidence: 0 },
            resp: { snr: 0, quality: 'poor', confidence: 0 }
        });
        setMetrics({
            fps: 0,
            processingTime: 0,
            bufferSize: 0,
            dropRate: 0
        });
    }, []);

    // Handle state cleanup when capturing stops
    useEffect(() => {
        if (!isCapturing) {
            resetData();
        }
    }, [isCapturing, resetData]);

    return {
        vitalSigns,
        quality,
        metrics,
        updateVitalSigns,
        updateQuality,
        updateMetrics,
        resetData
    };
};
