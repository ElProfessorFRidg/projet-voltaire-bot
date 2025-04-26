/**
 * Module Charts : Encapsulation de Chart.js pour la création et la mise à jour de graphiques.
 * Utilisation :
 *   Charts.init(config)
 *   Charts.updateData(newData)
 */

const Charts = (function () {
    let chartInstances = [];
    let chartConfigs = [];

    function clearCharts() {
        chartInstances.forEach(chart => chart.destroy());
        chartInstances = [];
        const container = document.getElementById('charts-container');
        container.innerHTML = '';
    }

    function createChart(chartConfig) {
        const canvas = document.createElement('canvas');
        canvas.id = chartConfig.id || `chart-${Math.random().toString(36).substr(2, 9)}`;
        document.getElementById('charts-container').appendChild(canvas);

        const ctx = canvas.getContext('2d');
        const chart = new Chart(ctx, {
            type: chartConfig.type,
            data: chartConfig.data,
            options: chartConfig.options || {}
        });
        return chart;
    }

    function init(configs) {
        chartConfigs = configs;
        clearCharts();
        chartConfigs.forEach(cfg => {
            const chart = createChart(cfg);
            chartInstances.push(chart);
        });
    }

    function updateData(newDataArr) {
        // newDataArr : tableau d'objets { labels, datasets } pour chaque graphique
        chartInstances.forEach((chart, idx) => {
            const newData = newDataArr[idx];
            if (newData) {
                chart.data.labels = newData.labels;
                chart.data.datasets = newData.datasets;
                chart.update();
            }
        });
    }

    return {
        init,
        updateData
    };
})();

window.Charts = Charts;