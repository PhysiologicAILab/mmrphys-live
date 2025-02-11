// src/components/VitalSignsChart/VitalSignsChart.tsx

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
    rate: number;
    snr: number;
    type: 'bvp' | 'resp';
    isReady: boolean;
}

const VitalSignsChart: React.FC<VitalSignsChartProps> = ({
    title,
    data,
    rate,
    snr,
    type,
    isReady = false
}) => {
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
                max: 6, // 6 seconds window
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
                min: type === 'bvp' ? -2 : -1,
                max: type === 'bvp' ? 2 : 1
            }
        },
        plugins: {
            legend: {
                display: false
            },
            tooltip: {
                enabled: true,
                mode: 'index' as const,
                intersect: false,
                callbacks: {
                    label: (context: any) => {
                        const value = context.parsed.y;
                        return `${type === 'bvp' ? 'BVP' : 'Resp'}: ${value.toFixed(3)}`;
                    }
                }
            },
            title: {
                display: true,
                text: [
                    `${title}`,
                    `${rate.toFixed(1)} ${type === 'bvp' ? 'BPM' : 'Breaths/min'}`,
                    `SNR: ${snr.toFixed(1)} dB`
                ]
            }
        }
    }), [title, rate, snr, type]);

    const chartData = useMemo(() => ({
        labels: data.map((_, i) => (i / 30).toFixed(1)),
        datasets: [
            {
                label: type === 'bvp' ? 'Blood Volume Pulse' : 'Respiratory Signal',
                data: data,
                borderColor: type === 'bvp' ? 'rgb(75, 192, 192)' : 'rgb(255, 99, 132)',
                backgroundColor: type === 'bvp'
                    ? 'rgba(75, 192, 192, 0.2)'
                    : 'rgba(255, 99, 132, 0.2)',
                fill: true,
                tension: 0.4,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4
            }
        ]
    }), [data, type]);

    if (!isReady || data.length === 0) {
        return (
            <div className="vital-signs-chart not-ready">
                <div className="chart-placeholder">
                    <p>Initializing...</p>
                    <p>Collecting data</p>
                </div>
            </div>
        );
    }

    const getSignalQualityClass = (snrValue: number): string => {
        if (snrValue >= 10) return 'excellent';
        if (snrValue >= 5) return 'good';
        if (snrValue >= 0) return 'moderate';
        return 'poor';
    };

    const getRateClass = (currentRate: number): string => {
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
                        {rate.toFixed(1)} {type === 'bvp' ? 'BPM' : 'Breaths/min'}
                    </div>
                    <div className="text-sm opacity-75">
                        {type === 'bvp' ? 'Heart Rate' : 'Respiratory Rate'}
                    </div>
                </div>
                <div className={`snr-metric p-2 rounded ${getSignalQualityClass(snr)}`}>
                    <div className="text-lg font-bold">
                        {snr.toFixed(1)} dB
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