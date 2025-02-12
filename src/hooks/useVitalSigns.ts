// src/hooks/useVitalSigns.ts
import { useState, useEffect, useCallback } from 'react';
import { SignalMetrics } from '@/utils/signalAnalysis';
import { SignalBuffers, PerformanceMetrics } from '@/utils/signalProcessor';

interface UseVitalSignsProps {
    isCapturing: boolean;
    onError: (error: Error) => void;
}

interface VitalSignsState {
    bvp: {
        signal: number[];
        filtered: number[];
        rate: number;
        metrics: SignalMetrics;
    };
    resp: {
        signal: number[];
        filtered: number[];
        rate: number;
        metrics: SignalMetrics;
    };
}

export const useVitalSigns = ({ isCapturing, onError }: UseVitalSignsProps) => {
    // Vital signs state with full signal data and metrics
    const [vitalSigns, setVitalSigns] = useState<VitalSignsState>({
        bvp: {
            signal: [],
            filtered: [],
            rate: 0,
            metrics: {
                rate: 0,
                quality: {
                    snr: 0,
                    signalStrength: 0,
                    artifactRatio: 0,
                    quality: 'poor'
                }
            }
        },
        resp: {
            signal: [],
            filtered: [],
            rate: 0,
            metrics: {
                rate: 0,
                quality: {
                    snr: 0,
                    signalStrength: 0,
                    artifactRatio: 0,
                    quality: 'poor'
                }
            }
        }
    });

    // Performance metrics state
    const [performance, setPerformance] = useState<PerformanceMetrics>({
        averageUpdateTime: 0,
        updateCount: 0,
        bufferUtilization: 0
    });

    // Update vital signs from signal processor output
    const updateSignals = useCallback((data: SignalBuffers) => {
        setVitalSigns({
            bvp: {
                signal: data.bvp.raw,
                filtered: data.bvp.filtered,
                rate: data.bvp.metrics.rate,
                metrics: data.bvp.metrics
            },
            resp: {
                signal: data.resp.raw,
                filtered: data.resp.filtered,
                rate: data.resp.metrics.rate,
                metrics: data.resp.metrics
            }
        });
    }, []);

    // Update performance metrics
    const updatePerformance = useCallback((metrics: PerformanceMetrics) => {
        setPerformance(metrics);
    }, []);

    // Reset all data
    const resetData = useCallback(() => {
        setVitalSigns({
            bvp: {
                signal: [],
                filtered: [],
                rate: 0,
                metrics: {
                    rate: 0,
                    quality: {
                        snr: 0,
                        signalStrength: 0,
                        artifactRatio: 0,
                        quality: 'poor'
                    }
                }
            },
            resp: {
                signal: [],
                filtered: [],
                rate: 0,
                metrics: {
                    rate: 0,
                    quality: {
                        snr: 0,
                        signalStrength: 0,
                        artifactRatio: 0,
                        quality: 'poor'
                    }
                }
            }
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

    // Helper functions for UI components
    const getDisplaySignals = useCallback(() => ({
        bvp: vitalSigns.bvp.filtered,
        resp: vitalSigns.resp.filtered
    }), [vitalSigns]);

    const getRates = useCallback(() => ({
        heart: {
            value: vitalSigns.bvp.rate,
            quality: vitalSigns.bvp.metrics.quality.quality
        },
        resp: {
            value: vitalSigns.resp.rate,
            quality: vitalSigns.resp.metrics.quality.quality
        }
    }), [vitalSigns]);

    const getSignalQuality = useCallback(() => ({
        bvp: vitalSigns.bvp.metrics.quality,
        resp: vitalSigns.resp.metrics.quality
    }), [vitalSigns]);

    return {
        // Raw data
        vitalSigns,
        performance,

        // Update functions
        updateSignals,
        updatePerformance,
        resetData,

        // Helper functions for UI
        getDisplaySignals,
        getRates,
        getSignalQuality
    };
};

// Type exports for consumers
export type { VitalSignsState };