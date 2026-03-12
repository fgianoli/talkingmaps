/**
 * TalkingMaps – Story Editor
 * All prompt/confirm replaced with App.modal/App.confirm
 */
const StoryEditor = {
    _storyId: null,
    _story: null,
    _slides: [],
    _layers: [],
    _currentSlideIdx: 0,
    _map: null,
    _data: null,
    _autosaveTimer: null,
    _sortable: null,

    async load(storyId) {
        this._storyId = storyId;
        App.showPanel('editor');
        window.location.hash = `#/edit/${storyId}`;

        try {
            const data = await Api.getStoryFull(storyId);
            this._story = data.story;
            this._slides = data.slides;
            this._layers = data.layers;
            this._data = data;
            this._render(data);

            // Show guide for first-time users
            setTimeout(() => {
                if (typeof Guide !== 'undefined' && Guide.shouldShow()) Guide.start();
            }, 600);
        } catch (err) {
            App.toast(I18n.t('error') + ': ' + err.message, 'danger');
        }
    },

    _render(data) {
        const t = I18n.t.bind(I18n);
        const panel = document.getElementById('panel-editor');
        panel.innerHTML = `
            <div class="editor-slides-panel">
                <div class="editor-slides-header">
                    <h3><i class="bi bi-collection"></i> ${t('editor.slides')}</h3>
                    <div>
                        <button class="btn btn-sm btn-outline-light" id="editor-add-slide" title="${t('editor.add_slide')}">
                            <i class="bi bi-plus"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-light" id="editor-preview" title="${t('editor.preview')}">
                            <i class="bi bi-eye"></i>
                        </button>
                    </div>
                </div>
                <div class="editor-slides-list" id="editor-slides-list"></div>
                <div style="padding:8px;border-top:1px solid var(--tm-border)">
                    <small class="text-muted"><i class="bi bi-grip-vertical"></i> ${t('editor.drag_hint')}</small>
                </div>
            </div>

            <div class="editor-map-area">
                <div class="editor-map" id="editor-map"></div>
                <div class="editor-map-tools">
                    <button class="btn" id="editor-capture-view" title="${t('editor.capture')}"><i class="bi bi-camera"></i></button>
                    <button class="btn" id="editor-add-marker" title="${t('editor.add_marker')}"><i class="bi bi-geo-alt"></i></button>
                    <button class="btn" id="editor-manage-layers" title="${t('editor.manage_layers')}"><i class="bi bi-layers"></i></button>
                </div>
                <div class="editor-map-info" id="editor-map-info">zoom: - | center: -</div>
            </div>

            <div class="editor-props-panel">
                <div class="editor-props-header">
                    <h3><i class="bi bi-sliders"></i> ${t('editor.props')}</h3>
                </div>
                <div class="editor-props-body" id="editor-props-body"></div>
            </div>
        `;

        this._initEditorMap(data);
        this._renderSlidesList();
        if (this._slides.length > 0) this._selectSlide(0);
        this._bindEvents();
        this._setupSortable();
        this._startAutosave();
    },

    _initEditorMap(data) {
        const firstSlide = this._slides[0];
        this._map = TmMap.init('editor-map', {
            center: firstSlide?.map_center ? [firstSlide.map_center.lng, firstSlide.map_center.lat] : [12.49, 41.89],
            zoom: firstSlide?.map_zoom || 5,
            basemaps: data.basemaps,
        });

        if (data.layers) {
            data.layers.forEach(l => TmMap.addLayer({
                id: l.layer_id, layer_type: l.layer_type,
                source_config: l.source_config,
                style_config: l.custom_style && Object.keys(l.custom_style).length ? l.custom_style : l.style_config,
                opacity: l.opacity,
            }));
        }

        this._map.on('moveend', () => {
            const c = this._map.getCenter();
            const z = this._map.getZoom().toFixed(1);
            document.getElementById('editor-map-info').textContent =
                `zoom: ${z} | center: ${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`;
        });
    },

    // ── Slides List ──────────────────────
    _renderSlidesList() {
        const list = document.getElementById('editor-slides-list');
        if (!list) return;

        const layoutIcons = {
            'cover': 'bi-card-heading', 'side-left': 'bi-layout-sidebar',
            'side-right': 'bi-layout-sidebar-reverse', 'center': 'bi-layout-text-window',
            'full-map': 'bi-map', 'full-media': 'bi-image',
        };

        list.innerHTML = this._slides.map((slide, idx) => {
            const icon = layoutIcons[slide.layout] || 'bi-square';
            return `
                <div class="editor-slide-thumb ${idx === this._currentSlideIdx ? 'active' : ''}"
                     data-slide-idx="${idx}" data-slide-id="${slide.id}">
                    <div class="slide-number">${idx + 1}</div>
                    <div class="slide-info">
                        <h4>${slide.title || I18n.t('editor.untitled')}</h4>
                        <small><i class="bi ${icon}"></i> ${I18n.t('layout.' + (slide.layout || 'side-left'))}</small>
                    </div>
                    <div class="slide-actions">
                        ${idx > 0 ? `<button class="btn btn-sm btn-outline-danger" onclick="StoryEditor._deleteSlide(${idx})" title="${I18n.t('action.delete')}"><i class="bi bi-trash"></i></button>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        list.querySelectorAll('.editor-slide-thumb').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.closest('.slide-actions')) return;
                this._selectSlide(parseInt(el.dataset.slideIdx));
            });
        });
    },

    _selectSlide(idx) {
        this._saveCurrentSlideProps();
        this._currentSlideIdx = idx;
        const slide = this._slides[idx];
        if (!slide) return;

        document.querySelectorAll('.editor-slide-thumb').forEach((el, i) => {
            el.classList.toggle('active', i === idx);
        });

        if (slide.map_center) {
            TmMap.flyTo({
                center: [slide.map_center.lng, slide.map_center.lat],
                zoom: slide.map_zoom || 10,
                bearing: slide.map_bearing || 0,
                pitch: slide.map_pitch || 0,
                duration: 1000,
            });
        }

        const markers = (this._data?.markers || []).filter(m => m.slide_id === slide.id);
        TmMap.addMarkers(markers);
        this._renderProps(slide);
    },

    // ── Properties Panel ─────────────────
    _renderProps(slide) {
        const body = document.getElementById('editor-props-body');
        if (!body) return;
        const t = I18n.t.bind(I18n);

        body.innerHTML = `
            <div class="prop-section">
                <div class="prop-section-title"><i class="bi bi-type-h1"></i> ${t('editor.content')}</div>
                <div class="prop-row">
                    <label>${t('editor.title')}</label>
                    <input type="text" class="form-control" id="prop-title" value="${App.escHtml(slide.title || '')}" placeholder="${t('editor.title_ph')}">
                </div>
                <div class="prop-row">
                    <label>${t('editor.narrative')}</label>
                    <div class="narrative-toolbar">
                        <button class="btn" onclick="document.execCommand('bold')"><i class="bi bi-type-bold"></i></button>
                        <button class="btn" onclick="document.execCommand('italic')"><i class="bi bi-type-italic"></i></button>
                        <button class="btn" onclick="document.execCommand('insertUnorderedList')"><i class="bi bi-list-ul"></i></button>
                        <button class="btn" onclick="document.execCommand('insertOrderedList')"><i class="bi bi-list-ol"></i></button>
                        <button class="btn" onclick="StoryEditor._insertLink()"><i class="bi bi-link-45deg"></i></button>
                        <button class="btn" onclick="StoryEditor._insertImage()"><i class="bi bi-image"></i></button>
                        <button class="btn" onclick="StoryEditor._insertChart()"><i class="bi bi-bar-chart-line"></i></button>
                        <button class="btn" onclick="StoryEditor._insertIframe()"><i class="bi bi-code-square"></i></button>
                    </div>
                    <div class="narrative-editor" id="prop-narrative" contenteditable="true">${slide.narrative || ''}</div>
                </div>
            </div>

            <div class="prop-section">
                <div class="prop-section-title"><i class="bi bi-grid-1x2"></i> ${t('editor.layout')}</div>
                <div class="layout-selector">
                    ${['cover', 'side-left', 'side-right', 'center', 'full-map', 'full-media'].map(l => `
                        <div class="layout-option ${slide.layout === l ? 'active' : ''}" data-layout="${l}">
                            <i class="bi bi-${this._layoutIcon(l)}"></i>
                            ${t('layout.' + l)}
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="prop-section">
                <div class="prop-section-title"><i class="bi bi-map"></i> ${t('editor.map_view')}</div>
                <div class="prop-row">
                    <label>${t('editor.animation')}</label>
                    <select class="form-select" id="prop-animation">
                        <option value="flyTo" ${slide.map_animation === 'flyTo' ? 'selected' : ''}>${t('editor.anim_fly')}</option>
                        <option value="easeTo" ${slide.map_animation === 'easeTo' ? 'selected' : ''}>${t('editor.anim_ease')}</option>
                        <option value="jumpTo" ${slide.map_animation === 'jumpTo' ? 'selected' : ''}>${t('editor.anim_jump')}</option>
                    </select>
                </div>
                <button class="btn btn-sm btn-outline-light w-100 mt-2" id="btn-capture-map-state">
                    <i class="bi bi-camera"></i> ${t('editor.capture_view')}
                </button>
                ${slide.map_center ? `
                    <small class="text-muted d-block mt-1">
                        ${t('editor.view_set')} ${slide.map_center.lat?.toFixed(3)}, ${slide.map_center.lng?.toFixed(3)} z${slide.map_zoom?.toFixed(1)}
                    </small>
                ` : `<small class="text-muted d-block mt-1">${t('editor.no_view')}</small>`}
            </div>

            <div class="prop-section">
                <div class="prop-section-title"><i class="bi bi-layers"></i> ${t('editor.layer_vis')}</div>
                <div class="editor-layers-list" id="prop-layers-list">
                    ${(this._layers || []).map(l => {
                        const vis = slide.layer_visibility?.[l.layer_id];
                        const isVis = vis !== undefined ? vis : l.visible;
                        return `
                            <div class="editor-layer-item" data-layer-id="${l.layer_id}">
                                <i class="bi bi-eye${isVis ? '' : '-slash'} layer-visibility ${isVis ? 'visible' : ''}"
                                   onclick="StoryEditor._toggleLayerVis(${l.layer_id}, this)"></i>
                                <span style="flex:1;font-size:13px">${App.escHtml(l.layer_name)}</span>
                                <small class="text-muted">${l.layer_type}</small>
                            </div>
                        `;
                    }).join('') || `<small class="text-muted">${t('editor.no_layers')}</small>`}
                </div>
            </div>

            <div class="prop-section">
                <div class="prop-section-title"><i class="bi bi-image"></i> ${t('editor.bg')}</div>
                <div class="prop-row">
                    <label>${t('editor.bg_media')}</label>
                    <div class="input-group">
                        <input type="text" class="form-control" id="prop-bg-media" value="${slide.background_media || ''}" placeholder="URL media">
                        <button class="btn btn-outline-light" onclick="StoryEditor._pickMedia('prop-bg-media')">
                            <i class="bi bi-folder2-open"></i>
                        </button>
                    </div>
                </div>
                <div class="prop-row">
                    <label>${t('editor.bg_opacity')}</label>
                    <input type="range" class="form-range" id="prop-bg-opacity" min="0" max="1" step="0.05"
                           value="${slide.background_opacity ?? 1}">
                </div>
            </div>

            <div class="prop-section">
                <div class="prop-section-title"><i class="bi bi-bar-chart-line"></i> ${t('editor.charts')}</div>
                <div class="chart-editor">
                    <label class="form-label" style="font-size:12px">${t('editor.chart_config')}</label>
                    <textarea class="form-control" id="prop-chart-config" rows="4"
                        placeholder='{"type":"bar","labels":["A","B","C"],"data":[10,20,30]}'
                        style="font-family:monospace;font-size:11px">${JSON.stringify(slide.style_overrides?.chart || '', null, 2) === '""' ? '' : JSON.stringify(slide.style_overrides?.chart || '', null, 2)}</textarea>
                    <small class="text-muted">${t('editor.chart_types')}</small>
                </div>
            </div>

            <div class="prop-section">
                <div class="prop-row">
                    <div class="form-check form-switch">
                        <input class="form-check-input" type="checkbox" id="prop-visible" ${slide.visible !== false ? 'checked' : ''}>
                        <label class="form-check-label" for="prop-visible">${t('editor.slide_visible')}</label>
                    </div>
                </div>
            </div>
        `;

        body.querySelectorAll('.layout-option').forEach(opt => {
            opt.addEventListener('click', () => {
                body.querySelectorAll('.layout-option').forEach(o => o.classList.remove('active'));
                opt.classList.add('active');
            });
        });

        document.getElementById('btn-capture-map-state')?.addEventListener('click', () => this._captureMapState());
        document.getElementById('editor-capture-view')?.addEventListener('click', () => this._captureMapState());
    },

    // ── Actions ──────────────────────────
    _captureMapState() {
        const state = TmMap.getState();
        const slide = this._slides[this._currentSlideIdx];
        if (!slide) return;
        slide.map_center = state.center;
        slide.map_zoom = state.zoom;
        slide.map_bearing = state.bearing;
        slide.map_pitch = state.pitch;
        this._renderProps(slide);
        App.toast(I18n.t('editor.view_captured'), 'success');
    },

    async _saveCurrentSlideProps() {
        const slide = this._slides[this._currentSlideIdx];
        if (!slide) return;
        const titleEl = document.getElementById('prop-title');
        if (!titleEl) return;

        const updates = {};
        if (titleEl.value !== slide.title) updates.title = titleEl.value;
        const narrativeEl = document.getElementById('prop-narrative');
        if (narrativeEl?.innerHTML !== slide.narrative) updates.narrative = narrativeEl?.innerHTML;
        const animEl = document.getElementById('prop-animation');
        if (animEl?.value !== slide.map_animation) updates.map_animation = animEl?.value;
        const bgMediaEl = document.getElementById('prop-bg-media');
        if (bgMediaEl?.value !== (slide.background_media || '')) updates.background_media = bgMediaEl?.value || null;
        const bgOpacityEl = document.getElementById('prop-bg-opacity');
        if (bgOpacityEl) updates.background_opacity = parseFloat(bgOpacityEl.value);
        const visibleEl = document.getElementById('prop-visible');
        if (visibleEl) updates.visible = visibleEl.checked;
        const layoutEl = document.querySelector('.layout-option.active');
        if (layoutEl) updates.layout = layoutEl.dataset.layout;
        if (slide.map_center) {
            updates.map_center = slide.map_center;
            updates.map_zoom = slide.map_zoom;
            updates.map_bearing = slide.map_bearing;
            updates.map_pitch = slide.map_pitch;
        }
        const chartEl = document.getElementById('prop-chart-config');
        if (chartEl?.value) {
            try {
                const chart = JSON.parse(chartEl.value);
                updates.style_overrides = { ...(slide.style_overrides || {}), chart };
            } catch { /* invalid json */ }
        }

        if (Object.keys(updates).length > 0) {
            try {
                await Api.updateSlide(slide.id, updates);
                Object.assign(slide, updates);
            } catch (err) { console.error('Autosave failed:', err); }
        }
    },

    async _addSlide() {
        try {
            const result = await Api.createSlide({ story_id: this._storyId, title: '' });
            const fullSlide = await Api.getSlide(result.id);
            this._slides.push(fullSlide);
            this._renderSlidesList();
            this._selectSlide(this._slides.length - 1);
            App.toast(I18n.t('editor.slide_added'), 'success');
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    async _deleteSlide(idx) {
        const ok = await App.confirm(I18n.t('editor.slide_delete_confirm'), { danger: true });
        if (!ok) return;
        const slide = this._slides[idx];
        try {
            await Api.deleteSlide(slide.id);
            this._slides.splice(idx, 1);
            this._renderSlidesList();
            this._selectSlide(Math.min(idx, this._slides.length - 1));
            App.toast(I18n.t('editor.slide_deleted'), 'success');
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    _toggleLayerVis(layerId, iconEl) {
        const isVis = iconEl.classList.contains('visible');
        iconEl.classList.toggle('visible');
        iconEl.classList.toggle('bi-eye', !isVis);
        iconEl.classList.toggle('bi-eye-slash', isVis);
        TmMap.setLayerVisibility(layerId, !isVis);
        const slide = this._slides[this._currentSlideIdx];
        if (!slide.layer_visibility) slide.layer_visibility = {};
        slide.layer_visibility[layerId] = !isVis;
    },

    async _insertLink() {
        const url = await App.prompt(I18n.t('editor.insert_link_url'), '', { title: I18n.t('editor.insert_link') });
        if (url) document.execCommand('createLink', false, url);
    },

    async _insertImage() {
        const url = await App.prompt(I18n.t('editor.insert_image_url'), '', { title: I18n.t('editor.insert_image') });
        if (url) document.execCommand('insertImage', false, url);
    },

    _insertChart() {
        const chartEl = document.getElementById('prop-chart-config');
        if (chartEl) {
            chartEl.focus();
            App.toast(I18n.t('editor.charts'), 'info');
        }
    },

    async _insertIframe() {
        const url = await App.prompt(I18n.t('editor.insert_iframe_url'), '', { title: I18n.t('editor.insert_iframe') });
        if (!url) return;
        const editor = document.getElementById('prop-narrative');
        if (editor) {
            editor.innerHTML += `<div class="slide-iframe-container"><iframe src="${App.escHtml(url)}" style="width:100%;height:400px;border:none;" allow="fullscreen" loading="lazy"></iframe></div>`;
        }
    },

    async _pickMedia(targetInputId) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*,video/*';
        input.onchange = async () => {
            const file = input.files[0];
            if (!file) return;
            try {
                App.toast(I18n.t('loading'), 'info');
                const result = await Api.uploadMedia(file, this._storyId);
                document.getElementById(targetInputId).value = result.url;
                App.toast(I18n.t('media.uploaded'), 'success');
            } catch (err) { App.toast(err.message, 'danger'); }
        };
        input.click();
    },

    // ── Marker add mode ──────────────────
    _addMarkerMode: false,

    _toggleAddMarker() {
        this._addMarkerMode = !this._addMarkerMode;
        const btn = document.getElementById('editor-add-marker');
        btn.classList.toggle('active', this._addMarkerMode);

        if (this._addMarkerMode) {
            this._map.getCanvas().style.cursor = 'crosshair';
            this._map.once('click', async (e) => {
                this._addMarkerMode = false;
                btn.classList.remove('active');
                this._map.getCanvas().style.cursor = '';

                const title = await App.prompt(I18n.t('editor.marker_title'), '', { title: I18n.t('editor.add_marker') });
                const slide = this._slides[this._currentSlideIdx];
                try {
                    await Api.addMarker(slide.id, {
                        lng: e.lngLat.lng, lat: e.lngLat.lat,
                        title: title || '', popup_content: '', color: '#e74c3c',
                    });
                    App.toast(I18n.t('editor.marker_added'), 'success');
                    const fullSlide = await Api.getSlide(slide.id);
                    TmMap.addMarkers(fullSlide.markers || []);
                } catch (err) { App.toast(err.message, 'danger'); }
            });
        } else {
            this._map.getCanvas().style.cursor = '';
        }
    },

    // ── Events ───────────────────────────
    _bindEvents() {
        document.getElementById('editor-add-slide')?.addEventListener('click', () => this._addSlide());
        document.getElementById('editor-add-marker')?.addEventListener('click', () => this._toggleAddMarker());

        document.getElementById('editor-preview')?.addEventListener('click', async () => {
            await this._saveCurrentSlideProps();
            const data = await Api.getStoryFull(this._storyId);
            StoryViewer.load(data);
        });

        document.getElementById('editor-manage-layers')?.addEventListener('click', () => this._openLayersModal());
    },

    async _openLayersModal() {
        const allLayers = await Api.listLayers();
        const storyLayerIds = this._layers.map(l => l.layer_id);
        const t = I18n.t.bind(I18n);

        const html = `
            <div class="modal fade" id="layers-modal" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title"><i class="bi bi-layers"></i> ${t('editor.manage_layers')}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="mb-3" style="display:flex;gap:8px;flex-wrap:wrap">
                                <button class="btn btn-sm btn-outline-light" onclick="StoryEditor._uploadGeoJSON()">
                                    <i class="bi bi-upload"></i> ${t('layers.upload_geojson')}
                                </button>
                                <button class="btn btn-sm btn-outline-light" onclick="StoryEditor._addWmsLayer()">
                                    <i class="bi bi-globe2"></i> ${t('layers.add_wms')}
                                </button>
                            </div>
                            <div class="layers-grid">
                                ${allLayers.map(l => `
                                    <div class="layer-card">
                                        <div class="d-flex justify-content-between align-items-start">
                                            <div><h4>${App.escHtml(l.name)}</h4><span class="layer-type-badge">${l.layer_type}</span></div>
                                            <div>
                                                ${storyLayerIds.includes(l.id)
                                                    ? `<button class="btn btn-sm btn-outline-danger" onclick="StoryEditor._removeLayer(${l.id})"><i class="bi bi-dash"></i></button>`
                                                    : `<button class="btn btn-sm btn-outline-success" onclick="StoryEditor._addLayerToStory(${l.id})"><i class="bi bi-plus"></i></button>`
                                                }
                                            </div>
                                        </div>
                                        ${l.description ? `<p class="text-muted mt-1" style="font-size:12px">${App.escHtml(l.description)}</p>` : ''}
                                    </div>
                                `).join('')}
                                ${allLayers.length === 0 ? `<p class="text-muted">${t('layers.no_layers')}</p>` : ''}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.getElementById('layers-modal')?.remove();
        document.body.insertAdjacentHTML('beforeend', html);
        new bootstrap.Modal(document.getElementById('layers-modal')).show();
    },

    async _addLayerToStory(layerId) {
        try {
            await Api.addLayerToStory(this._storyId, { layer_id: layerId });
            App.toast(I18n.t('layers.added'), 'success');
            const data = await Api.getStoryFull(this._storyId);
            this._layers = data.layers;
            const layer = data.layers.find(l => l.layer_id === layerId);
            if (layer) TmMap.addLayer({
                id: layer.layer_id, layer_type: layer.layer_type,
                source_config: layer.source_config, style_config: layer.style_config, opacity: layer.opacity,
            });
            bootstrap.Modal.getInstance(document.getElementById('layers-modal'))?.hide();
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    async _removeLayer(layerId) {
        try {
            await Api.removeLayerFromStory(this._storyId, layerId);
            TmMap.removeLayer(layerId);
            this._layers = this._layers.filter(l => l.layer_id !== layerId);
            App.toast(I18n.t('layers.removed'), 'success');
            bootstrap.Modal.getInstance(document.getElementById('layers-modal'))?.hide();
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    async _uploadGeoJSON() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.geojson,.json,.shp,.zip,.gpkg';
        input.onchange = async () => {
            const file = input.files[0];
            if (!file) return;
            try {
                const result = await Api.uploadGeoJSON(file);
                await this._addLayerToStory(result.id);
                App.toast(`Layer "${result.name}" OK`, 'success');
            } catch (err) { App.toast(err.message, 'danger'); }
        };
        input.click();
    },

    async _addWmsLayer() {
        const t = I18n.t.bind(I18n);
        const result = await App.modal({
            title: t('layers.add_wms_title'),
            body: `
                <div class="mb-3"><label class="form-label">${t('layers.wms_url')}</label>
                    <input type="text" class="form-control" id="modal-wms-url" placeholder="https://..."></div>
                <div class="mb-3"><label class="form-label">${t('layers.wms_name')}</label>
                    <input type="text" class="form-control" id="modal-wms-name"></div>
                <div class="mb-3"><label class="form-label">${t('layers.wms_layer')}</label>
                    <input type="text" class="form-control" id="modal-wms-layers"></div>
            `,
            confirmText: t('action.confirm'),
            onConfirm: () => ({
                url: document.getElementById('modal-wms-url')?.value,
                name: document.getElementById('modal-wms-name')?.value,
                layers: document.getElementById('modal-wms-layers')?.value,
            }),
        });
        if (!result || !result.url) return;
        try {
            const layer = await Api.createLayer({
                name: result.name || 'WMS Layer', layer_type: 'wms',
                source_config: { url: result.url, layers: result.layers || '' },
            });
            await this._addLayerToStory(layer.id);
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    // ── Sortable ─────────────────────────
    _setupSortable() {
        const list = document.getElementById('editor-slides-list');
        if (!list || !window.Sortable) return;
        this._sortable = Sortable.create(list, {
            animation: 200, ghostClass: 'dragging', handle: '.editor-slide-thumb',
            onEnd: async (evt) => {
                if (evt.oldIndex === evt.newIndex) return;
                const [moved] = this._slides.splice(evt.oldIndex, 1);
                this._slides.splice(evt.newIndex, 0, moved);
                try {
                    await Api.reorderSlides(this._slides.map(s => s.id));
                    this._renderSlidesList();
                    this._selectSlide(evt.newIndex);
                } catch (err) { App.toast(err.message, 'danger'); }
            },
        });
    },

    _startAutosave() {
        clearInterval(this._autosaveTimer);
        this._autosaveTimer = setInterval(() => this._saveCurrentSlideProps(), 15000);
    },

    _layoutIcon(layout) {
        return { 'cover': 'card-heading', 'side-left': 'layout-sidebar', 'side-right': 'layout-sidebar-reverse',
            'center': 'layout-text-window', 'full-map': 'map', 'full-media': 'image' }[layout] || 'square';
    },
};
