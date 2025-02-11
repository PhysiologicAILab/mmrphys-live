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
    rate: number;
    type: 'bvp' | 'resp';
    isReady: boolean;
}

const VitalSignsChart: React.FC<VitalSignsChartProps> = ({
    title,
    data,
    rate,
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
                intersect: false
            },
            title: {
                display: true,
                text: `${title} - ${rate.toFixed(1)} ${type === 'bvp' ? 'BPM' : 'Breaths/min'}`
            }
        }
    }), [title, rate, type]);

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

    return (
        <div className="vital-signs-chart">
            <div className="chart-container">
                <Line
                    options={chartOptions}
                    data={chartData}
                    fallbackContent={<div>Unable to render chart</div>}
                />
            </div>
            <div className={`metric ${getRateClass(rate, type)}`}>
                {rate.toFixed(1)} {type === 'bvp' ? 'BPM' : 'Breaths/min'}
                <small className="rate-type">
                    {type === 'bvp' ? 'Heart Rate' : 'Respiratory Rate'}
                </small>
            </div>
        </div>
    );
};

const getRateClass = (rate: number, type: 'bvp' | 'resp'): string => {
    if (type === 'bvp') {
        if (rate < 60) return 'low';
        if (rate > 100) return 'high';
        return 'normal';
    } else {
        if (rate < 12) return 'low';
        if (rate > 20) return 'high';
        return 'normal';
    }
};

export default VitalSignsChart;