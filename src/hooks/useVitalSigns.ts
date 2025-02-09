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

    const [performance, setPerformance] = useState({
        fps: 0,
        processingTime: 0,
        bufferSize: 0
    });

    const updateVitalSigns = useCallback((data: VitalSigns) => {
        setVitalSigns(prev => ({
            ...prev,
            ...data
        }));
    }, []);

    const updatePerformance = useCallback((metrics: any) => {
        setPerformance(prev => ({
            ...prev,
            ...metrics
        }));
    }, []);

    return {
        vitalSigns,
        performance,
        updateVitalSigns,
        updatePerformance
    };
};