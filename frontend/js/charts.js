/**
 * TalkingMaps – Charts Module (Chart.js wrapper)
 * Creates interactive charts for storytelling and dashboards
 */
const TmCharts = {
    _instances: {},

    /**
     * Create a chart in a canvas element
     * @param {string} canvasId
     * @param {object} config - Chart.js configuration with TM defaults
     * @returns {Chart}
     */
    create(canvasId, config) {
        // Destroy existing instance
        if (this._instances[canvasId]) {
            this._instances[canvasId].destroy();
        }

        const canvas = document.getElementById(canvasId);
        if (!canvas) return null;

        // Apply dark theme defaults
        const defaults = this._darkThemeDefaults();
        const mergedConfig = this._mergeConfig(defaults, config);

        const chart = new Chart(canvas, mergedConfig);
        this._instances[canvasId] = chart;
        return chart;
    },

    destroy(canvasId) {
        if (this._instances[canvasId]) {
            this._instances[canvasId].destroy();
            delete this._instances[canvasId];
        }
    },

    destroyAll() {
        Object.keys(this._instances).forEach(id => this.destroy(id));
    },

    // ── Quick creators ───────────────────

    bar(canvasId, labels, data, opts = {}) {
        return this.create(canvasId, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: opts.label || '',
                    data,
                    backgroundColor: opts.colors || this._palette(data.length),
                    borderRadius: 6,
                    borderSkipped: false,
                }],
            },
            options: {
                indexAxis: opts.horizontal ? 'y' : 'x',
                plugins: { legend: { display: !!opts.label } },
            },
        });
    },

    line(canvasId, labels, datasets, opts = {}) {
        const ds = Array.isArray(datasets[0]) ? datasets : [datasets];
        return this.create(canvasId, {
            type: 'line',
            data: {
                labels,
                datasets: ds.map((data, i) => ({
                    label: opts.labels?.[i] || `Serie ${i + 1}`,
                    data,
                    borderColor: (opts.colors || this._paletteFlat())[i],
                    backgroundColor: (opts.colors || this._paletteFlat())[i] + '33',
                    fill: opts.fill !== false,
                    tension: opts.tension || 0.4,
                    pointRadius: opts.pointRadius ?? 3,
                })),
            },
        });
    },

    pie(canvasId, labels, data, opts = {}) {
        return this.create(canvasId, {
            type: opts.doughnut ? 'doughnut' : 'pie',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: opts.colors || this._palette(data.length),
                    borderColor: 'rgba(0,0,0,0.3)',
                    borderWidth: 1,
                }],
            },
            options: {
                plugins: {
                    legend: { position: 'bottom', labels: { padding: 16 } },
                },
                cutout: opts.doughnut ? '60%' : 0,
            },
        });
    },

    scatter(canvasId, datasets, opts = {}) {
        const ds = Array.isArray(datasets[0]?.x !== undefined ? [datasets] : datasets);
        return this.create(canvasId, {
            type: 'scatter',
            data: {
                datasets: ds.map((data, i) => ({
                    label: opts.labels?.[i] || `Dataset ${i + 1}`,
                    data,
                    backgroundColor: (opts.colors || this._paletteFlat())[i],
                    pointRadius: opts.pointRadius || 5,
                })),
            },
            options: {
                scales: {
                    x: { title: { display: !!opts.xLabel, text: opts.xLabel } },
                    y: { title: { display: !!opts.yLabel, text: opts.yLabel } },
                },
            },
        });
    },

    radar(canvasId, labels, datasets, opts = {}) {
        const ds = Array.isArray(datasets[0]) ? datasets : [datasets];
        return this.create(canvasId, {
            type: 'radar',
            data: {
                labels,
                datasets: ds.map((data, i) => ({
                    label: opts.labels?.[i] || '',
                    data,
                    borderColor: (opts.colors || this._paletteFlat())[i],
                    backgroundColor: (opts.colors || this._paletteFlat())[i] + '33',
                    pointRadius: 3,
                })),
            },
        });
    },

    /**
     * Render a chart from a slide's chart configuration
     * @param {HTMLElement} container
     * @param {object} chartConfig - { type, labels, data, options }
     */
    renderSlideChart(container, chartConfig) {
        if (!chartConfig || !chartConfig.type) return;
        const canvasId = 'chart-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        container.innerHTML = `<canvas id="${canvasId}"></canvas>`;

        const type = chartConfig.type;
        switch (type) {
            case 'bar':
                this.bar(canvasId, chartConfig.labels, chartConfig.data, chartConfig.options);
                break;
            case 'line':
                this.line(canvasId, chartConfig.labels, chartConfig.data, chartConfig.options);
                break;
            case 'pie':
            case 'doughnut':
                this.pie(canvasId, chartConfig.labels, chartConfig.data, { ...chartConfig.options, doughnut: type === 'doughnut' });
                break;
            case 'scatter':
                this.scatter(canvasId, chartConfig.data, chartConfig.options);
                break;
            case 'radar':
                this.radar(canvasId, chartConfig.labels, chartConfig.data, chartConfig.options);
                break;
            default:
                this.create(canvasId, chartConfig);
        }
    },

    /**
     * Render dashboard KPI widgets
     * @param {HTMLElement} container
     * @param {Array} widgets - [{ label, value, icon, color, change }]
     */
    renderDashboardWidgets(container, widgets) {
        container.innerHTML = widgets.map(w => `
            <div class="dashboard-widget">
                ${w.icon ? `<div style="font-size:24px;color:${w.color || 'var(--tm-primary)'};margin-bottom:4px"><i class="bi bi-${w.icon}"></i></div>` : ''}
                <div class="widget-value" style="color:${w.color || 'var(--tm-primary)'}">${w.value}</div>
                <div class="widget-label">${w.label}</div>
                ${w.change !== undefined ? `<div style="font-size:11px;color:${w.change >= 0 ? 'var(--tm-secondary)' : 'var(--tm-danger)'}">
                    <i class="bi bi-${w.change >= 0 ? 'arrow-up' : 'arrow-down'}"></i> ${Math.abs(w.change)}%
                </div>` : ''}
            </div>
        `).join('');
    },

    // ── Theme ────────────────────────────
    _darkThemeDefaults() {
        return {
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 800 },
                plugins: {
                    legend: {
                        labels: { color: '#e8eaed', font: { family: 'Inter, sans-serif', size: 12 } },
                    },
                    tooltip: {
                        backgroundColor: 'rgba(23,24,26,0.95)',
                        titleColor: '#e8eaed',
                        bodyColor: '#9aa0a6',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        cornerRadius: 8,
                        padding: 12,
                    },
                },
                scales: {
                    x: {
                        ticks: { color: '#9aa0a6', font: { size: 11 } },
                        grid: { color: 'rgba(255,255,255,0.06)' },
                    },
                    y: {
                        ticks: { color: '#9aa0a6', font: { size: 11 } },
                        grid: { color: 'rgba(255,255,255,0.06)' },
                    },
                },
            },
        };
    },

    _mergeConfig(defaults, config) {
        const merged = { ...config };
        merged.options = this._deepMerge(defaults.options || {}, config.options || {});
        return merged;
    },

    _deepMerge(target, source) {
        const result = { ...target };
        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && target[key]) {
                result[key] = this._deepMerge(target[key], source[key]);
            } else {
                result[key] = source[key];
            }
        }
        return result;
    },

    _palette(n) {
        const colors = ['#1a73e8', '#34a853', '#fbbc04', '#ea4335', '#8e24aa', '#00acc1', '#ff7043', '#5c6bc0', '#26a69a', '#ec407a'];
        return Array.from({ length: n }, (_, i) => colors[i % colors.length]);
    },

    _paletteFlat() {
        return ['#1a73e8', '#34a853', '#fbbc04', '#ea4335', '#8e24aa', '#00acc1', '#ff7043', '#5c6bc0', '#26a69a', '#ec407a'];
    },
};
