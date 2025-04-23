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
        respSignal: [],
        bvpSNR: 0,
        respSNR: 0,
        filteredBvpSignal: [],
        filteredRespSignal: [],
        bvpQuality: 'poor',
        respQuality: 'poor'
    });

    const [performance, setPerformance] = useState({
        averageUpdateTime: 0,
        updateCount: 0,
        bufferUtilization: 0
    });

    // Update vital signs
    const updateVitalSigns = useCallback((data: Partial<VitalSigns>) => {
        setVitalSigns(prev => ({
            ...prev,
            ...data
        }));
    }, []);

    // Update performance metrics
    const updatePerformance = useCallback((metrics: Partial<typeof performance>) => {
        setPerformance(prev => ({
            ...prev,
            ...metrics
        }));
    }, []);

    // Reset all data
    const resetData = useCallback(() => {
        setVitalSigns({
            heartRate: 0,
            respRate: 0,
            bvpSignal: [],
            respSignal: [],
            bvpSNR: 0,
            respSNR: 0,
            filteredBvpSignal: [],
            filteredRespSignal: [],
            bvpQuality: 'poor',
            respQuality: 'poor'
        });
        setPerformance({
            averageUpdateTime: 0,
            updateCount: 0,
            bufferUtilization: 0
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
        performance,
        updateVitalSigns,
        updatePerformance,
        resetData
    };
};