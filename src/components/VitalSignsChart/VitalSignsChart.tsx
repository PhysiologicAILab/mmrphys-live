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
    signalStrength?: number;
    artifactRatio?: number;
}

const VitalSignsChart: React.FC<VitalSignsChartProps> = ({
    title = '',
    data = [],
    filteredData,
    rate = 0,
    snr = 0,
    quality = 'poor',
    type = 'bvp',
    isReady = false,
    signalStrength = 0,
    artifactRatio = 0
}) => {
    // Chart options with proper type safety
    const chartOptions = useMemo(() => ({
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
                max: 6,
                ticks: {
                    stepSize: 1
                }
            },
            y: {
                display: true,
                title: {
                    display: true,
                    text: type === 'bvp' ? 'Blood Volume Pulse' : 'Respiratory Signal'
                },
                min: type === 'bvp' ? -1.5 : -0.8,
                max: type === 'bvp' ? 1.5 : 0.8
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
                text: [
                    title,
                    `${Number(rate).toFixed(1)} ${type === 'bvp' ? 'BPM' : 'Breaths/min'}`,
                    `SNR: ${Number(snr).toFixed(1)} dB`
                ]
            }
        }
    }), [title, rate, snr, type]);

    // Chart data with safety checks - only show filtered data
    const chartData = useMemo(() => ({
        labels: Array.isArray(data) ? data.map((_, i) => (i / 30).toFixed(1)) : [],
        datasets: [
            // Only include the filtered dataset
            {
                label: type === 'bvp' ? 'Filtered Blood Volume Pulse' : 'Filtered Respiratory Signal',
                data: filteredData || data, // Use filteredData if available, otherwise fall back to data
                borderColor: type === 'bvp' ? 'rgb(0, 105, 105)' : 'rgb(220, 53, 69)',
                backgroundColor: type === 'bvp'
                    ? 'rgba(0, 105, 105, 0.2)'
                    : 'rgba(220, 53, 69, 0.2)',
                fill: true,
                tension: 0.4,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4
            }
        ]
    }), [data, filteredData, type]);

    // Loading/empty state
    if (!isReady || !Array.isArray(data) || data.length === 0) {
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
                        {quality.charAt(0).toUpperCase() + quality.slice(1)} Quality
                    </div>
                </div>
            </div>
            {/* Additional Metrics */}
            <div className="additional-metrics mt-2 grid grid-cols-2 gap-2 text-xs">
                <div className="metric">
                    <strong>Signal Strength:</strong> {signalStrength.toFixed(4)}
                </div>
                <div className="metric">
                    <strong>Artifact Ratio:</strong> {(artifactRatio * 100).toFixed(2)}%
                </div>
            </div>
        </div>
    );
};

export default VitalSignsChart;