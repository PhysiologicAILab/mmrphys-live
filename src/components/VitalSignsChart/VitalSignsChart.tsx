import React, { useMemo } from 'react';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';

// Register ChartJS components
ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

interface VitalSignsChartProps {
    title: string;
    data: number[];
    filteredData?: number[];
    rate: number;
    snr: number;
    quality?: 'excellent' | 'good' | 'moderate' | 'poor';
    type: 'bvp' | 'resp';
    isReady: boolean;
}

const VitalSignsChart: React.FC<VitalSignsChartProps> = ({
    title = '',
    data = [],
    filteredData,
    rate = 0,
    snr = 0,
    quality = 'poor',
    type = 'bvp',
    isReady = false
}) => {
    // Chart options with proper type safety
    const chartOptions = useMemo(() => {
        // Different display settings for BVP and Resp
        const displaySamples = type === 'bvp' ? 300 : 450; // 300 for BVP, 450 for Resp
        const fps = 30; // Assuming 30 fps
        const timeWindow = displaySamples / fps; // Time window in seconds

        return {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 0
            },
            scales: {
                x: {
                    type: 'linear' as const,
                    display: true,
                    title: {
                        display: true,
                        text: 'Time (seconds)'
                    },
                    min: 0,
                    max: timeWindow,
                    ticks: {
                        stepSize: Math.ceil(timeWindow / 5) // 5 ticks on the x-axis
                    }
                },
                y: {
                    display: true,
                    title: {
                        display: true,
                        text: type === 'bvp' ? 'Blood Volume Pulse Signal' : 'Respiratory Signal'
                    },
                    min: -1.05,
                    max: 1.05
                }
            },
            plugins: {
                legend: {
                    display: false // Hide legend since we're only showing one dataset
                },
                tooltip: {
                    enabled: true,
                    mode: 'index' as const,
                    intersect: false,
                    callbacks: {
                        label: (context: { parsed: { y: number }, datasetIndex: number }) => {
                            const value = context.parsed.y;
                            const label = type === 'bvp' ? 'Filtered BVP' : 'Filtered Resp';
                            return `${label}: ${value.toFixed(3)}`;
                        }
                    }
                },
                title: {
                    display: true,
                    text: title,
                }
            }
        };
    }, [title, rate, snr, type]);

    // Chart data with x-axis adjusted for display samples
    const chartData = useMemo(() => {
        if (!Array.isArray(filteredData || data) || (filteredData || data).length === 0) {
            return { labels: [], datasets: [] };
        }

        const displayData = filteredData || data;
        const fps = 30; // Assuming 30 fps

        return {
            labels: displayData.map((_, i) => (i / fps).toFixed(1)),
            datasets: [
                {
                    label: type === 'bvp' ? 'Blood Volume Pulse Signal' : 'Respiratory Signal',
                    data: displayData.map((value, index) => ({
                        x: index / fps, // Use exact time values rather than rounded strings
                        y: value
                    })),
                    borderColor: type === 'bvp' ? 'rgb(0, 105, 105)' : 'rgb(220, 53, 69)',
                    borderWidth: 1.5,
                    tension: 0.4, // Increase tension for smoother curves
                    cubicInterpolationMode: 'monotone', // Add this for better interpolation
                    fill: false,
                    pointRadius: 0,
                    spanGaps: true // Add this to handle any gaps in data
                }
            ]
        };
    }, [data, filteredData, type]);

    // Loading/empty state
    if (!isReady || !Array.isArray(data) || data.length === 0) {
        console.debug(`Chart not ready: isReady=${isReady}, isArray=${Array.isArray(data)}, length=${data?.length || 0}`);
        return (
            <div className="vital-signs-chart not-ready">
                <div className="chart-placeholder">
                    <p>Initializing...</p>
                    <p>Collecting data</p>
                </div>
            </div>
        );
    }

    const getSignalQualityClass = (signalQuality: string): string => {
        switch (signalQuality) {
            case 'excellent': return 'excellent';
            case 'good': return 'good';
            case 'moderate': return 'moderate';
            default: return 'poor';
        }
    };

    const getRateClass = (currentRate: number): string => {
        if (!isFinite(currentRate)) return 'normal';
        if (type === 'bvp') {
            if (currentRate < 60) return 'low';
            if (currentRate > 100) return 'high';
            return 'normal';
        } else {
            if (currentRate < 12) return 'low';
            if (currentRate > 20) return 'high';
            return 'normal';
        }
    };

    return (
        <div className="vital-signs-chart">
            <div className="chart-container h-64">
                <Line
                    options={chartOptions}
                    data={chartData}
                    fallbackContent={<div>Unable to render chart</div>}
                />
            </div>
            <div className="metrics-container mt-4 grid grid-cols-2 gap-4">
                <div className={`rate-metric p-2 rounded ${getRateClass(rate)}`}>
                    <div className="text-lg font-bold">
                        {Number(rate).toFixed(1)} {type === 'bvp' ? 'BPM' : 'Breaths/min'}
                    </div>
                    <div className="text-sm opacity-75">
                        {type === 'bvp' ? 'Heart Rate' : 'Respiratory Rate'}
                    </div>
                </div>
                <div className={`snr-metric p-2 rounded ${getSignalQualityClass(quality)}`}>
                    <div className="text-lg font-bold">
                        {Number(snr).toFixed(1)} dB
                    </div>
                    <div className="text-sm opacity-75">
                        Signal Quality
                    </div>
                </div>
            </div>
        </div>
    );
};

export default VitalSignsChart;