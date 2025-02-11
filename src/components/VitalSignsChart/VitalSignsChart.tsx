import React, { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
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
    isReady?: boolean;
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
            duration: 0 // Disable animations for better performance
        },
        interaction: {
            intersect: false,
            mode: 'index'
        },
        plugins: {
            legend: {
                display: true,
                position: 'top' as const,
                labels: {
                    color: 'var(--text-color)',
                    boxWidth: 20,
                    padding: 20
                }
            },
            title: {
                display: true,
                text: `${title} - ${rate.toFixed(1)} ${type === 'bvp' ? 'BPM' : 'Breaths/min'}`,
                color: 'var(--text-color)',
                font: {
                    size: 16,
                    weight: 'bold'
                },
                padding: {
                    top: 10,
                    bottom: 30
                }
            },
            tooltip: {
                enabled: true,
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                titleColor: 'white',
                bodyColor: 'white',
                borderColor: 'white',
                borderWidth: 1,
                padding: 10,
                displayColors: true,
                callbacks: {
                    label: (context: any) => {
                        const value = context.parsed.y;
                        return `${type === 'bvp' ? 'BVP' : 'Resp'}: ${value.toFixed(3)}`;
                    }
                }
            }
        },
        scales: {
            x: {
                type: 'linear',
                display: true,
                title: {
                    display: true,
                    text: 'Time (seconds)',
                    color: 'var(--text-color)',
                    font: {
                        weight: 'bold'
                    }
                },
                grid: {
                    display: true,
                    color: 'rgba(0, 0, 0, 0.1)'
                },
                ticks: {
                    color: 'var(--text-color)',
                    maxRotation: 0,
                    callback: (value: number) => value.toFixed(1)
                }
            },
            y: {
                display: true,
                title: {
                    display: true,
                    text: type === 'bvp' ? 'Blood Volume Pulse (a.u.)' : 'Respiratory Signal (a.u.)',
                    color: 'var(--text-color)',
                    font: {
                        weight: 'bold'
                    }
                },
                grid: {
                    display: true,
                    color: 'rgba(0, 0, 0, 0.1)'
                },
                ticks: {
                    color: 'var(--text-color)'
                }
            }
        }
    }), [title, rate, type]);

    const chartData = useMemo(() => ({
        labels: data.map((_, index) => (index / 30).toFixed(1)),
        datasets: [
            {
                label: type === 'bvp' ? 'Blood Volume Pulse' : 'Respiratory Signal',
                data: data,
                borderColor: `var(--${type}-color)`,
                backgroundColor: `var(--${type}-color-light)`,
                fill: true,
                tension: 0.4,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4,
                pointHoverBackgroundColor: `var(--${type}-color)`,
                pointHoverBorderColor: 'white',
                pointHoverBorderWidth: 2
            }
        ]
    }), [data, type]);

    if (!isReady || data.length === 0) {
        return (
            <div className="vital-signs-chart not-ready">
                <div className="chart-placeholder">
                    <p>Initializing signal processing...</p>
                    <p>Please wait while we collect enough data</p>
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
    const ranges = {
        bvp: { min: 40, max: 180 },
        resp: { min: 8, max: 30 }
    };

    const { min, max } = ranges[type];
    if (rate < min) return 'low';
    if (rate > max) return 'high';
    return 'normal';
};

export default VitalSignsChart;