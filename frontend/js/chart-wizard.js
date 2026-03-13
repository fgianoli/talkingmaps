/**
 * TalkingMaps – Chart Wizard
 * Visual chart builder: paste data, upload CSV, or manual JSON
 */
const ChartWizard = {
    _resolve: null,
    _data: null,
    _headers: [],
    _rows: [],

    /**
     * Open the wizard modal. Returns a promise that resolves with chart config or null.
     */
    open(existingConfig) {
        return new Promise((resolve) => {
            this._resolve = resolve;
            this._data = existingConfig || null;
            this._rows = [];
            this._headers = [];
            this._showModal();
        });
    },

    _showModal() {
        const t = I18n.t.bind(I18n);
        document.getElementById('chart-wizard-modal')?.remove();

        const html = `
            <div class="modal fade" id="chart-wizard-modal" tabindex="-1">
                <div class="modal-dialog modal-lg modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title"><i class="bi bi-bar-chart-line"></i> ${t('chartwiz.title')}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <!-- Tabs -->
                            <ul class="nav nav-tabs mb-3" role="tablist">
                                <li class="nav-item">
                                    <button class="nav-link active" data-bs-toggle="tab" data-bs-target="#cwiz-tab-paste">${t('chartwiz.tab_paste')}</button>
                                </li>
                                <li class="nav-item">
                                    <button class="nav-link" data-bs-toggle="tab" data-bs-target="#cwiz-tab-csv">${t('chartwiz.tab_csv')}</button>
                                </li>
                                <li class="nav-item">
                                    <button class="nav-link" data-bs-toggle="tab" data-bs-target="#cwiz-tab-url">${t('chartwiz.tab_url')}</button>
                                </li>
                                <li class="nav-item">
                                    <button class="nav-link" data-bs-toggle="tab" data-bs-target="#cwiz-tab-manual">${t('chartwiz.tab_manual')}</button>
                                </li>
                            </ul>

                            <div class="tab-content">
                                <!-- Paste tab -->
                                <div class="tab-pane fade show active" id="cwiz-tab-paste">
                                    <p class="text-muted" style="font-size:13px">${t('chartwiz.paste_hint')}</p>
                                    <textarea class="form-control" id="cwiz-paste-area" rows="5"
                                        placeholder="Label,Valore A,Valore B&#10;Roma,42,18&#10;Milano,38,25&#10;Napoli,29,12"
                                        style="font-family:monospace;font-size:12px"></textarea>
                                    <button class="btn btn-sm btn-primary mt-2" id="cwiz-parse-paste">
                                        <i class="bi bi-table"></i> ${t('chartwiz.parse')}
                                    </button>
                                </div>

                                <!-- CSV upload tab -->
                                <div class="tab-pane fade" id="cwiz-tab-csv">
                                    <div class="cwiz-upload-zone" id="cwiz-csv-zone">
                                        <i class="bi bi-file-earmark-spreadsheet" style="font-size:32px;color:var(--tm-primary)"></i>
                                        <p>${t('chartwiz.csv_hint')}</p>
                                        <input type="file" id="cwiz-csv-input" accept=".csv,.tsv,.txt" style="display:none">
                                        <button class="btn btn-sm btn-outline-primary" id="cwiz-csv-browse">${t('chartwiz.browse')}</button>
                                    </div>
                                </div>

                                <!-- URL tab -->
                                <div class="tab-pane fade" id="cwiz-tab-url">
                                    <p class="text-muted" style="font-size:13px">${t('chartwiz.url_hint')}</p>
                                    <div class="input-group">
                                        <input type="text" class="form-control" id="cwiz-url-input" placeholder="https://api.example.com/data.json">
                                        <button class="btn btn-primary" id="cwiz-url-fetch">
                                            <i class="bi bi-download"></i> ${t('chartwiz.fetch')}
                                        </button>
                                    </div>
                                </div>

                                <!-- Manual JSON tab -->
                                <div class="tab-pane fade" id="cwiz-tab-manual">
                                    <textarea class="form-control" id="cwiz-manual-json" rows="8"
                                        placeholder='{"type":"bar","labels":["A","B","C"],"data":[10,20,30]}'
                                        style="font-family:monospace;font-size:12px">${this._data ? JSON.stringify(this._data, null, 2) : ''}</textarea>
                                </div>
                            </div>

                            <!-- Data preview & chart config (shown after parsing) -->
                            <div id="cwiz-config-area" class="d-none mt-3">
                                <hr>
                                <div class="row g-3">
                                    <div class="col-md-6">
                                        <h6 style="font-size:13px;font-weight:600">${t('chartwiz.data_preview')}</h6>
                                        <div id="cwiz-table-preview" style="max-height:200px;overflow:auto;font-size:12px"></div>
                                    </div>
                                    <div class="col-md-6">
                                        <h6 style="font-size:13px;font-weight:600">${t('chartwiz.chart_config')}</h6>
                                        <div class="mb-2">
                                            <label class="form-label" style="font-size:12px">${t('chartwiz.chart_type')}</label>
                                            <div class="cwiz-type-grid" id="cwiz-type-grid"></div>
                                        </div>
                                        <div class="mb-2">
                                            <label class="form-label" style="font-size:12px">${t('chartwiz.label_col')}</label>
                                            <select class="form-select form-select-sm" id="cwiz-label-col"></select>
                                        </div>
                                        <div class="mb-2">
                                            <label class="form-label" style="font-size:12px">${t('chartwiz.data_cols')}</label>
                                            <div id="cwiz-data-cols"></div>
                                        </div>
                                    </div>
                                </div>
                                <div class="mt-3">
                                    <h6 style="font-size:13px;font-weight:600">${t('chartwiz.preview')}</h6>
                                    <div style="max-height:250px;position:relative">
                                        <canvas id="cwiz-preview-chart"></canvas>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button class="btn btn-outline-secondary" data-bs-dismiss="modal">${I18n.t('action.cancel')}</button>
                            <button class="btn btn-primary" id="cwiz-confirm" disabled>
                                <i class="bi bi-check-lg"></i> ${I18n.t('action.confirm')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);
        const modalEl = document.getElementById('chart-wizard-modal');
        const modal = new bootstrap.Modal(modalEl);
        modal.show();

        this._bindWizardEvents(modal);

        modalEl.addEventListener('hidden.bs.modal', () => {
            if (this._resolve) { this._resolve(null); this._resolve = null; }
            this._destroyPreviewChart();
            modalEl.remove();
        });
    },

    _bindWizardEvents(modal) {
        // Parse pasted data
        document.getElementById('cwiz-parse-paste')?.addEventListener('click', () => {
            const text = document.getElementById('cwiz-paste-area')?.value;
            if (text) this._parseCSV(text);
        });

        // CSV file upload
        document.getElementById('cwiz-csv-browse')?.addEventListener('click', () => {
            document.getElementById('cwiz-csv-input')?.click();
        });
        document.getElementById('cwiz-csv-input')?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => this._parseCSV(ev.target.result);
            reader.readAsText(file);
        });

        // URL fetch
        document.getElementById('cwiz-url-fetch')?.addEventListener('click', async () => {
            const url = document.getElementById('cwiz-url-input')?.value;
            if (!url) return;
            try {
                const resp = await fetch(url);
                const text = await resp.text();
                // Try JSON first
                try {
                    const json = JSON.parse(text);
                    if (Array.isArray(json)) {
                        // Array of objects -> convert to CSV-like
                        this._headers = Object.keys(json[0] || {});
                        this._rows = json.map(obj => this._headers.map(h => obj[h]));
                        this._showConfigArea();
                    } else {
                        document.getElementById('cwiz-manual-json').value = JSON.stringify(json, null, 2);
                        document.querySelector('[data-bs-target="#cwiz-tab-manual"]')?.click();
                    }
                } catch {
                    this._parseCSV(text);
                }
            } catch (err) {
                App.toast(err.message, 'danger');
            }
        });

        // Manual JSON confirm
        document.getElementById('cwiz-confirm')?.addEventListener('click', () => {
            const config = this._buildConfig();
            if (config) {
                this._resolve?.(config);
                this._resolve = null;
                modal.hide();
            }
        });

        // Also allow manual JSON to enable confirm
        document.getElementById('cwiz-manual-json')?.addEventListener('input', () => {
            const val = document.getElementById('cwiz-manual-json')?.value;
            try {
                JSON.parse(val);
                document.getElementById('cwiz-confirm').disabled = false;
            } catch {
                document.getElementById('cwiz-confirm').disabled = true;
            }
        });
        // If existing config, enable confirm
        if (this._data) {
            document.getElementById('cwiz-confirm').disabled = false;
        }
    },

    _parseCSV(text) {
        const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l);
        if (lines.length < 2) { App.toast('Not enough data', 'warning'); return; }

        // Detect separator
        const sep = lines[0].includes('\t') ? '\t' : (lines[0].split(';').length > lines[0].split(',').length ? ';' : ',');

        this._headers = lines[0].split(sep).map(h => h.trim().replace(/^["']|["']$/g, ''));
        this._rows = lines.slice(1).map(l =>
            l.split(sep).map(v => v.trim().replace(/^["']|["']$/g, ''))
        );

        this._showConfigArea();
    },

    _showConfigArea() {
        const area = document.getElementById('cwiz-config-area');
        area?.classList.remove('d-none');

        // Table preview
        const tableEl = document.getElementById('cwiz-table-preview');
        let tableHtml = '<table class="table table-sm table-bordered"><thead><tr>';
        this._headers.forEach(h => tableHtml += `<th>${h}</th>`);
        tableHtml += '</tr></thead><tbody>';
        this._rows.slice(0, 8).forEach(row => {
            tableHtml += '<tr>';
            row.forEach(v => tableHtml += `<td>${v}</td>`);
            tableHtml += '</tr>';
        });
        if (this._rows.length > 8) tableHtml += `<tr><td colspan="${this._headers.length}" class="text-muted text-center">... +${this._rows.length - 8} rows</td></tr>`;
        tableHtml += '</tbody></table>';
        tableEl.innerHTML = tableHtml;

        // Chart type selector
        const types = [
            { id: 'bar', icon: 'bi-bar-chart', label: 'Bar' },
            { id: 'line', icon: 'bi-graph-up', label: 'Line' },
            { id: 'pie', icon: 'bi-pie-chart', label: 'Pie' },
            { id: 'doughnut', icon: 'bi-circle', label: 'Donut' },
            { id: 'radar', icon: 'bi-hexagon', label: 'Radar' },
            { id: 'scatter', icon: 'bi-dots', label: 'Scatter' },
        ];
        const typeGrid = document.getElementById('cwiz-type-grid');
        typeGrid.innerHTML = types.map(t => `
            <button class="cwiz-type-btn ${t.id === 'bar' ? 'active' : ''}" data-type="${t.id}">
                <i class="bi ${t.icon}"></i> ${t.label}
            </button>
        `).join('');
        typeGrid.querySelectorAll('.cwiz-type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                typeGrid.querySelectorAll('.cwiz-type-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._updatePreview();
            });
        });

        // Label column selector
        const labelSel = document.getElementById('cwiz-label-col');
        labelSel.innerHTML = this._headers.map((h, i) => `<option value="${i}">${h}</option>`).join('');
        labelSel.addEventListener('change', () => this._updatePreview());

        // Data columns (checkboxes)
        const dataCols = document.getElementById('cwiz-data-cols');
        dataCols.innerHTML = this._headers.map((h, i) => {
            const isNumeric = this._rows.some(r => !isNaN(parseFloat(r[i])));
            return `
                <div class="form-check form-check-inline" style="font-size:12px">
                    <input class="form-check-input cwiz-data-check" type="checkbox" id="cwiz-dc-${i}" value="${i}"
                        ${i > 0 && isNumeric ? 'checked' : ''}>
                    <label class="form-check-label" for="cwiz-dc-${i}">${h}</label>
                </div>
            `;
        }).join('');
        dataCols.querySelectorAll('.cwiz-data-check').forEach(cb => {
            cb.addEventListener('change', () => this._updatePreview());
        });

        document.getElementById('cwiz-confirm').disabled = false;
        this._updatePreview();
    },

    _previewChart: null,

    _updatePreview() {
        const config = this._buildConfig();
        if (!config) return;

        this._destroyPreviewChart();

        const canvas = document.getElementById('cwiz-preview-chart');
        if (!canvas) return;

        const colors = ['#4f6df5', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#f97316', '#ef4444'];

        const datasets = (config.datasets || [{ data: config.data }]).map((ds, i) => ({
            label: ds.label || `Series ${i + 1}`,
            data: ds.data,
            backgroundColor: ['pie', 'doughnut'].includes(config.type)
                ? config.labels.map((_, j) => colors[j % colors.length])
                : colors[i % colors.length] + '80',
            borderColor: colors[i % colors.length],
            borderWidth: 2,
        }));

        this._previewChart = new Chart(canvas, {
            type: config.type || 'bar',
            data: { labels: config.labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: { legend: { display: datasets.length > 1 || ['pie', 'doughnut'].includes(config.type) } },
            },
        });
    },

    _destroyPreviewChart() {
        if (this._previewChart) {
            this._previewChart.destroy();
            this._previewChart = null;
        }
    },

    _buildConfig() {
        // Check if manual JSON tab is active
        const manualJson = document.getElementById('cwiz-manual-json')?.value;
        const manualTab = document.querySelector('#cwiz-tab-manual.active, #cwiz-tab-manual.show');
        if (manualTab && manualJson) {
            try { return JSON.parse(manualJson); } catch { return null; }
        }

        if (!this._headers.length || !this._rows.length) return null;

        const chartType = document.querySelector('.cwiz-type-btn.active')?.dataset.type || 'bar';
        const labelIdx = parseInt(document.getElementById('cwiz-label-col')?.value || '0');
        const dataIdxs = Array.from(document.querySelectorAll('.cwiz-data-check:checked')).map(cb => parseInt(cb.value));

        if (dataIdxs.length === 0) return null;

        const labels = this._rows.map(r => r[labelIdx] || '');

        if (dataIdxs.length === 1) {
            return {
                type: chartType,
                labels,
                data: this._rows.map(r => parseFloat(r[dataIdxs[0]]) || 0),
            };
        }

        return {
            type: chartType,
            labels,
            datasets: dataIdxs.map(idx => ({
                label: this._headers[idx],
                data: this._rows.map(r => parseFloat(r[idx]) || 0),
            })),
        };
    },
};
