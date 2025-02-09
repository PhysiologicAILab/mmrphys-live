import React from 'react';
import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend
} from 'chart.js';
import { VitalSignsChartProps } from '@/types';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend
);

const VitalSignsChart: React.FC<VitalSignsChartProps> = ({
    title,
    data,
    rate,
    type
}) => {
    const chartColors = {
        bvp: 'rgb(75, 192, 192)',
        resp: 'rgb(255, 99, 132)'
    };

    const options = {
        responsive: true,
        animation: false as const,
        plugins: {
            legend: {
                display: false
            },
            title: {
                display: true,
                text: `${title}: ${rate.toFixed(1)} BPM`
            }
        },
        scales: {
            x: {
                type: 'linear' as const,
                display: true,
                title: {
                    display: true,
                    text: 'Time (s)'
                }
            },
            y: {
                display: true,
                title: {
                    display: true,
                    text: 'Amplitude'
                }
            }
        }
    };

    const chartData = {
        labels: data.map((_, index) => index / 30), // Assuming 30 fps
        datasets: [
            {
                data: data,
                borderColor: chartColors[type],
                backgroundColor: `${chartColors[type]}33`,
                fill: true,
                tension: 0.4,
                borderWidth: 2,
                pointRadius: 0
            }
        ]
    };

    return (
        <div className="chart-container">
            <Line options={options} data={chartData} />
            <div className={`metric ${getRateClass(rate, type)}`}>
                {rate.toFixed(1)} BPM
            </div>
        </div>
    );
};

const getRateClass = (rate: number, type: 'bvp' | 'resp'): string => {
    const ranges = {
        bvp: { min: 35, max: 180 },
        resp: { min: 6, max: 30 }
    };

    const { min, max } = ranges[type];
    if (rate < min) return 'low';
    if (rate > max) return 'high';
    return 'normal';
};

export default VitalSignsChart;