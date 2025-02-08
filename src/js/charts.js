import Chart from 'chart.js/auto';

export class ChartManager {
    constructor() {
        this.bvpChart = null;
        this.respChart = null;
        this.maxDataPoints = 300; // 10 seconds at 30 fps
    }

    initialize() {
        // Initialize BVP chart
        this.bvpChart = new Chart(
            document.getElementById('bvpChart').getContext('2d'),
            {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'Blood Volume Pulse',
                        data: [],
                        borderColor: 'rgb(75, 192, 192)',
                        tension: 0.4,
                        borderWidth: 2,
                        pointRadius: 0
                    }]
                },
                options: this.getChartOptions('Heart Rate: -- BPM')
            }
        );

        // Initialize Respiratory chart
        this.respChart = new Chart(
            document.getElementById('respChart').getContext('2d'),
            {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'Respiratory Signal',
                        data: [],
                        borderColor: 'rgb(255, 99, 132)',
                        tension: 0.4,
                        borderWidth: 2,
                        pointRadius: 0
                    }]
                },
                options: this.getChartOptions('Respiratory Rate: -- BPM')
            }
        );
    }

    getChartOptions(titleText) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: titleText
                },
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
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
            },
            animation: {
                duration: 0
            }
        };
    }

    updateCharts(results) {
        // Update BVP chart
        this.updateChart(
            this.bvpChart,
            results.bvp,
            `Heart Rate: ${results.heartRate.toFixed(1)} BPM`
        );

        // Update Respiratory chart
        this.updateChart(
            this.respChart,
            results.resp,
            `Respiratory Rate: ${results.respRate.toFixed(1)} BPM`
        );
    }

    updateChart(chart, newData, titleText) {
        const labels = Array.from(
            { length: newData.length },
            (_, i) => (i / 30).toFixed(1)
        );

        chart.data.labels = labels;
        chart.data.datasets[0].data = newData;
        chart.options.plugins.title.text = titleText;

        // Remove old data if exceeding maxDataPoints
        if (chart.data.labels.length > this.maxDataPoints) {
            chart.data.labels = chart.data.labels.slice(-this.maxDataPoints);
            chart.data.datasets[0].data = chart.data.datasets[0].data.slice(-this.maxDataPoints);
        }

        chart.update('none'); // Update without animation
    }
}