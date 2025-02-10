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
import type {
    ChartOptions as _ChartOptions,
    ChartData as _ChartData,
    ChartDataset as _ChartDataset,
    TooltipItem as _TooltipItem
} from 'chart.js/auto';

// Register Chart.js components
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

// Explicitly define types
type ChartOptions = _ChartOptions<'line'>;
type ChartData = _ChartData<'line'>;
type ChartDataset = _ChartDataset<'line', number[]>;
type TooltipItem = _TooltipItem<'line'>;

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
    if (!isReady) {
        return (
            <div className="vital-signs-chart not-ready">
                <div className="chart-placeholder">
                    <p>Collecting data...</p>
                </div>
            </div>
        );
    }

    // Chart options using CSS variables
    const options = useMemo<ChartOptions>(() => ({
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: {
            intersect: false,
            mode: 'index'
        },
        plugins: {
            legend: {
                display: false
            },
            title: {
                display: true,
                text: `${title}: ${rate.toFixed(1)} BPM`,
                color: 'var(--text-color)',
                font: {
                    size: 16,
                    weight: 'bold'
                },
                padding: {
                    top: 10,
                    bottom: 10
                }
            },
            tooltip: {
                enabled: true,
                mode: 'index',
                intersect: false,
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                titleColor: 'white',
                bodyColor: 'white',
                borderColor: 'white',
                borderWidth: 1,
                padding: 10,
                displayColors: false,
                callbacks: {
                    label: (context: TooltipItem) => {
                        return `Value: ${(context.parsed.y as number).toFixed(3)}`;
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
                    text: 'Time (s)',
                    color: 'var(--text-color)'
                },
                grid: {
                    display: true,
                    color: 'rgba(0, 0, 0, 0.1)'
                },
                ticks: {
                    color: 'var(--text-color)',
                    maxRotation: 0
                }
            },
            y: {
                display: true,
                title: {
                    display: true,
                    text: 'Amplitude',
                    color: 'var(--text-color)'
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
    }), [title, rate]);

    // Chart data using CSS variables
    const chartData = useMemo<ChartData>(() => ({
        labels: data.map((_, index) => (index / 30).toFixed(1)),
        datasets: [
            {
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
            } as ChartDataset
        ]
    }), [data, type]);

    return (
        <div className={`vital-signs-chart ${!isReady ? 'not-ready' : ''}`}>
            <div className="chart-container">
                <Line
                    options={options}
                    data={chartData}
                />
            </div>
            <div className={`metric ${getRateClass(rate, type)}`}>
                {rate.toFixed(1)} BPM
            </div>
        </div>
    );
};

// Helper function to determine rate classification
const getRateClass = (rate: number, type: 'bvp' | 'resp'): string => {
    const ranges = {
        bvp: { min: 35, max: 180 },  // Heart rate ranges
        resp: { min: 6, max: 30 }    // Respiratory rate ranges
    };

    const { min, max } = ranges[type];
    if (rate < min) return 'low';
    if (rate > max) return 'high';
    return 'normal';
};

export default VitalSignsChart;