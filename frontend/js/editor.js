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

    // Layouts that include a map
    _mapLayouts: ['cover', 'side-left', 'side-right', 'center', 'full-map'],
    // Layouts without a map
    _noMapLayouts: ['text-only', 'text-media', 'full-media', 'separator'],

    _currentSlideHasMap() {
        const slide = this._slides[this._currentSlideIdx];
        if (!slide) return true;
        return this._mapLayouts.includes(slide.layout || 'side-left');
    },

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
            <div class="editor-slides-panel" style="resize:horizontal;overflow:auto;min-width:180px;max-width:400px">
                <div class="editor-slides-header">
                    <h3><i class="bi bi-collection"></i> ${t('editor.slides')}</h3>
                    <div style="display:flex;align-items:center;gap:4px">
                        <span class="editor-autosave-indicator" id="editor-autosave-status">
                            <i class="bi bi-cloud-check"></i> <span>${t('editor.autosaved')}</span>
                        </span>
                        <button class="btn btn-sm btn-outline-light" id="editor-add-slide" title="${t('editor.add_slide')}">
                            <i class="bi bi-plus"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-light" id="editor-preview" title="${t('editor.preview')}">
                            <i class="bi bi-eye"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-light" id="editor-show-guide" title="${t('editor.show_guide')}">
                            <i class="bi bi-question-circle"></i>
                        </button>
                    </div>
                </div>
                <div class="editor-slides-list" id="editor-slides-list"></div>
                <div style="padding:8px;border-top:1px solid var(--tm-border)">
                    <small class="text-muted"><i class="bi bi-grip-vertical"></i> ${t('editor.drag_hint')}</small>
                </div>
            </div>

            <div class="editor-map-area" id="editor-map-area">
                <div class="editor-map" id="editor-map"></div>
                <div class="editor-map-tools" id="editor-map-tools">
                    <button class="btn" id="editor-capture-view" title="${t('editor.capture')}"><i class="bi bi-camera"></i></button>
                    <button class="btn" id="editor-add-marker" title="${t('editor.add_marker')}"><i class="bi bi-geo-alt"></i></button>
                    <div class="editor-map-tools-sep"></div>
                    <button class="btn" id="editor-draw-line" title="${t('editor.draw_line')}"><i class="bi bi-bezier2"></i></button>
                    <button class="btn" id="editor-draw-polygon" title="${t('editor.draw_polygon')}"><i class="bi bi-pentagon"></i></button>
                    <button class="btn" id="editor-draw-delete" title="${t('editor.draw_delete')}"><i class="bi bi-eraser"></i></button>
                    <div class="editor-map-tools-sep"></div>
                    <button class="btn" id="editor-manage-layers" title="${t('editor.manage_layers')}"><i class="bi bi-layers"></i></button>
                </div>
                <div class="editor-map-info" id="editor-map-info">zoom: - | center: -</div>
                <!-- No-map placeholder, shown for text-only/separator slides -->
                <div class="editor-no-map-placeholder d-none" id="editor-no-map-placeholder">
                    <i class="bi bi-file-text" style="font-size:48px;color:var(--tm-text-light);margin-bottom:12px"></i>
                    <p style="color:var(--tm-text-muted);font-size:14px;max-width:300px;text-align:center;line-height:1.6" id="editor-no-map-text"></p>
                    <button class="btn btn-sm btn-outline-primary mt-2" id="editor-switch-to-map-layout">
                        <i class="bi bi-map"></i> ${t('layout.side-left')}
                    </button>
                </div>
            </div>

            <div class="editor-props-panel" style="resize:horizontal;overflow:auto;min-width:260px;max-width:600px;direction:rtl">
                <div style="direction:ltr">
                    <div class="editor-props-header">
                        <h3><i class="bi bi-sliders"></i> ${t('editor.props')}</h3>
                    </div>
                    <div class="editor-props-body" id="editor-props-body"></div>
                </div>
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

        // Init drawing tools
        TmMap.initDraw(() => this._onDrawChange());
    },

    _onDrawChange() {
        // Save drawn features to current slide's style_overrides
        const slide = this._slides[this._currentSlideIdx];
        if (!slide) return;
        const features = TmMap.getDrawFeatures();
        slide.style_overrides = { ...(slide.style_overrides || {}), drawn_features: features };
    },

    async _setStoryTheme(themeId) {
        if (!this._story) return;
        this._story.settings = { ...(this._story.settings || {}), theme: themeId };
        try {
            await Api.updateStory(this._storyId, { settings: this._story.settings });
            document.querySelectorAll('.theme-option').forEach(o => o.classList.toggle('active', o.dataset.theme === themeId));
            App.toast(I18n.t('editor.theme_saved'), 'success');
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    // ── Map / No-map toggle ──────────────
    _updateMapVisibility() {
        const hasMap = this._currentSlideHasMap();
        const mapEl = document.getElementById('editor-map');
        const toolsEl = document.getElementById('editor-map-tools');
        const infoEl = document.getElementById('editor-map-info');
        const placeholder = document.getElementById('editor-no-map-placeholder');
        const textEl = document.getElementById('editor-no-map-text');

        if (hasMap) {
            mapEl?.classList.remove('d-none');
            toolsEl?.classList.remove('d-none');
            infoEl?.classList.remove('d-none');
            placeholder?.classList.add('d-none');
            if (this._map) this._map.resize();
        } else {
            mapEl?.classList.add('d-none');
            toolsEl?.classList.add('d-none');
            infoEl?.classList.add('d-none');
            placeholder?.classList.remove('d-none');
            if (textEl) textEl.textContent = I18n.t('editor.no_map_hint');
        }
    },

    // ── Slides List ──────────────────────
    _renderSlidesList() {
        const list = document.getElementById('editor-slides-list');
        if (!list) return;

        const layoutIcons = {
            'cover': 'bi-card-heading', 'side-left': 'bi-layout-sidebar',
            'side-right': 'bi-layout-sidebar-reverse', 'center': 'bi-layout-text-window',
            'full-map': 'bi-map', 'full-media': 'bi-image',
            'text-only': 'bi-file-text', 'text-media': 'bi-layout-text-sidebar',
            'separator': 'bi-hr',
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
                        ${this._slides.length > 1 ? `<button class="btn btn-sm btn-outline-danger" onclick="StoryEditor._deleteSlide(${idx})" title="${I18n.t('action.delete')}"><i class="bi bi-trash"></i></button>` : ''}
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

        // Update map visibility based on layout
        this._updateMapVisibility();

        if (this._currentSlideHasMap() && slide.map_center) {
            TmMap.flyTo({
                center: [slide.map_center.lng, slide.map_center.lat],
                zoom: slide.map_zoom || 10,
                bearing: slide.map_bearing || 0,
                pitch: slide.map_pitch || 0,
                duration: 1000,
            });
        }

        const markers = (this._data?.markers || []).filter(m => m.slide_id === slide.id);
        TmMap.addMarkers(markers, (m) => this._editMarker(m.id));

        // Load drawn features for this slide
        TmMap.setDrawFeatures(slide.style_overrides?.drawn_features || null);

        this._renderProps(slide);
    },

    // ── Properties Panel ─────────────────
    _renderProps(slide) {
        const body = document.getElementById('editor-props-body');
        if (!body) return;
        const t = I18n.t.bind(I18n);
        const hasMap = this._mapLayouts.includes(slide.layout || 'side-left');
        const isSeparator = slide.layout === 'separator';

        // All available layouts
        const allLayouts = ['cover', 'side-left', 'side-right', 'center', 'full-map', 'full-media', 'text-only', 'text-media', 'separator'];

        const currentTheme = this._story?.settings?.theme || 'light';
        body.innerHTML = `
            <!-- ═══ STORY THEME ═══ -->
            <div class="prop-section prop-section-compact">
                <div class="prop-section-title"><i class="bi bi-palette"></i> ${t('editor.story_theme')}</div>
                <div class="theme-selector">
                    ${[
                        { id: 'light', label: t('editor.theme_light'), icon: 'bi-sun', colors: '#f8fafc,#e2e8f0' },
                        { id: 'dark', label: t('editor.theme_dark'), icon: 'bi-moon-stars', colors: '#1e293b,#334155' },
                        { id: 'warm', label: t('editor.theme_warm'), icon: 'bi-brightness-high', colors: '#fef3c7,#fde68a' },
                        { id: 'cool', label: t('editor.theme_cool'), icon: 'bi-snow', colors: '#e0f2fe,#bae6fd' },
                    ].map(th => `
                        <div class="theme-option ${currentTheme === th.id ? 'active' : ''}" data-theme="${th.id}"
                             onclick="StoryEditor._setStoryTheme('${th.id}')">
                            <div class="theme-swatch" style="background:linear-gradient(135deg, ${th.colors.split(',')[0]}, ${th.colors.split(',')[1]})"></div>
                            <span>${th.label}</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- ═══ QUICK ACTIONS BAR ═══ -->
            <div class="editor-quick-actions">
                <div class="prop-section-title"><i class="bi bi-lightning"></i> ${t('editor.quick_actions')}</div>
                <div class="quick-actions-grid">
                    <button class="quick-action-btn" onclick="document.getElementById('prop-narrative')?.focus()" title="${t('editor.qa_text')}">
                        <i class="bi bi-type"></i>
                        <span>${t('editor.narrative')}</span>
                    </button>
                    <button class="quick-action-btn" onclick="StoryEditor._insertImage()">
                        <i class="bi bi-image"></i>
                        <span>${t('editor.qa_image')}</span>
                    </button>
                    <button class="quick-action-btn" onclick="StoryEditor._insertIframe()">
                        <i class="bi bi-play-btn"></i>
                        <span>${t('editor.qa_video')}</span>
                    </button>
                    <button class="quick-action-btn" onclick="StoryEditor._insertChart()">
                        <i class="bi bi-bar-chart-line"></i>
                        <span>${t('editor.qa_chart')}</span>
                    </button>
                    ${hasMap ? `
                        <button class="quick-action-btn" onclick="StoryEditor._openLayersModal()">
                            <i class="bi bi-layers"></i>
                            <span>${t('editor.qa_layer')}</span>
                        </button>
                        <button class="quick-action-btn" onclick="StoryEditor._toggleAddMarker()">
                            <i class="bi bi-geo-alt"></i>
                            <span>${t('editor.qa_marker')}</span>
                        </button>
                    ` : ''}
                </div>
            </div>

            <div class="prop-section">
                <div class="prop-section-title"><i class="bi bi-type-h1"></i> ${t('editor.content')}</div>
                <div class="prop-row">
                    <label>${t('editor.title')}</label>
                    <input type="text" class="form-control" id="prop-title" value="${App.escHtml(slide.title || '')}" placeholder="${t('editor.title_ph')}">
                </div>
                ${!isSeparator ? `
                <div class="prop-row">
                    <label>${t('editor.narrative')}</label>
                    <div class="narrative-toolbar">
                        <button class="btn" onclick="document.execCommand('bold')" title="Bold"><i class="bi bi-type-bold"></i></button>
                        <button class="btn" onclick="document.execCommand('italic')" title="Italic"><i class="bi bi-type-italic"></i></button>
                        <button class="btn" onclick="document.execCommand('insertUnorderedList')" title="List"><i class="bi bi-list-ul"></i></button>
                        <button class="btn" onclick="document.execCommand('insertOrderedList')" title="Numbered list"><i class="bi bi-list-ol"></i></button>
                        <button class="btn" onclick="document.execCommand('formatBlock', false, 'h2')" title="H2"><i class="bi bi-type-h2"></i></button>
                        <button class="btn" onclick="document.execCommand('formatBlock', false, 'h3')" title="H3"><i class="bi bi-type-h3"></i></button>
                        <button class="btn" onclick="document.execCommand('formatBlock', false, 'blockquote')" title="Quote"><i class="bi bi-quote"></i></button>
                        <span class="narrative-toolbar-sep"></span>
                        <select class="narrative-font-select" onchange="document.execCommand('fontName', false, this.value)" title="${t('editor.font')}">
                            <option value="Inter">Inter</option>
                            <option value="Playfair Display">Playfair</option>
                            <option value="Georgia">Georgia</option>
                            <option value="Arial">Arial</option>
                            <option value="Courier New">Courier</option>
                        </select>
                        <select class="narrative-size-select" onchange="document.execCommand('fontSize', false, this.value)" title="${t('editor.font_size')}">
                            <option value="2">S</option>
                            <option value="3" selected>M</option>
                            <option value="4">L</option>
                            <option value="5">XL</option>
                        </select>
                        <input type="color" class="narrative-color-pick" onchange="document.execCommand('foreColor', false, this.value)"
                               value="#1e293b" title="${t('editor.text_color')}">
                        <span class="narrative-toolbar-sep"></span>
                        <button class="btn" onclick="StoryEditor._insertLink()" title="${t('editor.insert_link')}"><i class="bi bi-link-45deg"></i></button>
                        <button class="btn" onclick="StoryEditor._insertImage()" title="${t('editor.insert_image')}"><i class="bi bi-image"></i></button>
                        <button class="btn" onclick="StoryEditor._insertIframe()" title="${t('editor.insert_iframe')}"><i class="bi bi-code-square"></i></button>
                    </div>
                    <div class="narrative-editor" id="prop-narrative" contenteditable="true">${slide.narrative || ''}</div>
                </div>
                ` : ''}
            </div>

            <div class="prop-section">
                <div class="prop-section-title"><i class="bi bi-grid-1x2"></i> ${t('editor.layout')}</div>
                <div class="layout-selector">
                    ${allLayouts.map(l => `
                        <div class="layout-option ${slide.layout === l ? 'active' : ''}" data-layout="${l}">
                            <i class="bi bi-${this._layoutIcon(l)}"></i>
                            ${t('layout.' + l)}
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- ═══ CARD STYLE (sidecar options) ═══ -->
            ${!isSeparator ? `
            <div class="prop-section">
                <div class="prop-section-title"><i class="bi bi-aspect-ratio"></i> ${t('editor.card_style')}</div>
                <div class="card-style-selector">
                    ${['card', 'full-width', 'transparent'].map(s => `
                        <div class="card-style-option ${(slide.style_overrides?.card_style || 'card') === s ? 'active' : ''}" data-style="${s}">
                            <i class="bi bi-${s === 'card' ? 'card-text' : s === 'full-width' ? 'distribute-vertical' : 'transparency'}"></i>
                            <span>${t('editor.card_' + s.replace('-', '_'))}</span>
                        </div>
                    `).join('')}
                </div>
                <div class="prop-row mt-2">
                    <label>${t('editor.text_align')}</label>
                    <div class="btn-group w-100" role="group">
                        ${['left', 'center', 'right'].map(a => `
                            <button class="btn btn-sm btn-outline-light text-align-btn ${(slide.style_overrides?.text_align || 'left') === a ? 'active' : ''}" data-align="${a}">
                                <i class="bi bi-text-${a}"></i>
                            </button>
                        `).join('')}
                    </div>
                </div>
            </div>
            ` : ''}

            ${hasMap ? `
            <!-- Map section (only for map layouts) -->
            <div class="prop-section">
                <div class="prop-section-title"><i class="bi bi-map"></i> ${t('editor.map_view')}</div>
                <div class="editor-map-hint">
                    <i class="bi bi-info-circle"></i> ${t('editor.has_map_hint')}
                </div>
                <div class="prop-row">
                    <label>${t('editor.animation')}</label>
                    <select class="form-select" id="prop-animation">
                        <option value="flyTo" ${slide.map_animation === 'flyTo' ? 'selected' : ''}>${t('editor.anim_fly')}</option>
                        <option value="easeTo" ${slide.map_animation === 'easeTo' ? 'selected' : ''}>${t('editor.anim_ease')}</option>
                        <option value="jumpTo" ${slide.map_animation === 'jumpTo' ? 'selected' : ''}>${t('editor.anim_jump')}</option>
                    </select>
                </div>
                <button class="btn btn-sm btn-outline-primary w-100 mt-2" id="btn-capture-map-state">
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
                <button class="btn btn-sm btn-outline-light w-100 mt-2" onclick="StoryEditor._openLayersModal()">
                    <i class="bi bi-plus"></i> ${t('editor.manage_layers')}
                </button>
            </div>
            ` : ''}

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

            ${!isSeparator ? `
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
            ` : ''}

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
                // Update slide layout and refresh map visibility
                const slide = this._slides[this._currentSlideIdx];
                if (slide) {
                    slide.layout = opt.dataset.layout;
                    this._updateMapVisibility();
                    // Re-render props to show/hide map sections
                    this._renderProps(slide);
                    this._renderSlidesList();
                }
            });
        });

        document.getElementById('btn-capture-map-state')?.addEventListener('click', () => this._captureMapState());
        document.getElementById('editor-capture-view')?.addEventListener('click', () => this._captureMapState());

        // Card style selector
        body.querySelectorAll('.card-style-option').forEach(opt => {
            opt.addEventListener('click', () => {
                body.querySelectorAll('.card-style-option').forEach(o => o.classList.remove('active'));
                opt.classList.add('active');
                const s = this._slides[this._currentSlideIdx];
                if (s) {
                    s.style_overrides = { ...(s.style_overrides || {}), card_style: opt.dataset.style };
                }
            });
        });

        // Text alignment
        body.querySelectorAll('.text-align-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                body.querySelectorAll('.text-align-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const s = this._slides[this._currentSlideIdx];
                if (s) {
                    s.style_overrides = { ...(s.style_overrides || {}), text_align: btn.dataset.align };
                }
            });
        });
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

        // Card style + text alignment + drawn features
        const cardStyleEl = document.querySelector('.card-style-option.active');
        const textAlignEl = document.querySelector('.text-align-btn.active');
        const drawnFeatures = TmMap.getDrawFeatures();
        updates.style_overrides = {
            ...(slide.style_overrides || {}),
            ...(updates.style_overrides || {}),
            ...(cardStyleEl ? { card_style: cardStyleEl.dataset.style } : {}),
            ...(textAlignEl ? { text_align: textAlignEl.dataset.align } : {}),
            ...(drawnFeatures?.features?.length ? { drawn_features: drawnFeatures } : {}),
        };

        if (Object.keys(updates).length > 0) {
            try {
                await Api.updateSlide(slide.id, updates);
                Object.assign(slide, updates);
            } catch (err) { console.error('Autosave failed:', err); }
        }
    },

    // ── Add Slide with type picker ───────
    async _addSlide(layout) {
        if (layout) {
            return this._createSlide(layout);
        }
        // Show slide type picker modal
        const t = I18n.t.bind(I18n);
        const types = [
            { layout: 'side-left', icon: 'bi-layout-sidebar', key: 'map', color: '#4f6df5' },
            { layout: 'text-only', icon: 'bi-file-text', key: 'text', color: '#10b981' },
            { layout: 'text-media', icon: 'bi-layout-text-sidebar', key: 'media', color: '#f59e0b' },
            { layout: 'full-media', icon: 'bi-image', key: 'fullmedia', color: '#ec4899' },
            { layout: 'separator', icon: 'bi-hr', key: 'separator', color: '#8b5cf6' },
        ];

        const html = `
            <div class="modal fade" id="slide-type-modal" tabindex="-1">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title"><i class="bi bi-plus-circle"></i> ${t('editor.add_slide_menu')}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="slide-type-grid">
                                ${types.map(tp => `
                                    <div class="slide-type-card" data-layout="${tp.layout}">
                                        <div class="slide-type-icon" style="color:${tp.color}">
                                            <i class="bi ${tp.icon}"></i>
                                        </div>
                                        <div class="slide-type-info">
                                            <h4>${t('editor.slide_type_' + tp.key)}</h4>
                                            <p>${t('editor.slide_type_' + tp.key + '_desc')}</p>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.getElementById('slide-type-modal')?.remove();
        document.body.insertAdjacentHTML('beforeend', html);
        const modal = new bootstrap.Modal(document.getElementById('slide-type-modal'));
        modal.show();

        document.querySelectorAll('.slide-type-card').forEach(card => {
            card.addEventListener('click', () => {
                modal.hide();
                this._createSlide(card.dataset.layout);
            });
        });
    },

    async _createSlide(layout) {
        try {
            const result = await Api.createSlide({ story_id: this._storyId, title: '', layout: layout || 'side-left' });
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

    async _insertChart() {
        const slide = this._slides[this._currentSlideIndex];
        const existing = slide?.style_overrides?.chart || null;
        const config = await ChartWizard.open(existing);
        if (!config) return;

        // Put result into the JSON textarea
        const chartEl = document.getElementById('prop-chart-config');
        if (chartEl) {
            chartEl.value = JSON.stringify(config, null, 2);
            chartEl.dispatchEvent(new Event('change'));
        }

        // Autosave immediately
        const updates = {
            style_overrides: { ...(slide.style_overrides || {}), chart: config }
        };
        try {
            await Api.updateSlide(slide.id, updates);
            Object.assign(slide, updates);
            App.toast(I18n.t('editor.chart_saved') || 'Chart saved', 'success');
        } catch (err) {
            console.error('Chart save failed:', err);
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
        if (!this._currentSlideHasMap()) {
            App.toast(I18n.t('editor.no_map_hint'), 'warning');
            return;
        }
        this._addMarkerMode = !this._addMarkerMode;
        const btn = document.getElementById('editor-add-marker');
        if (btn) btn.classList.toggle('active', this._addMarkerMode);

        if (this._addMarkerMode) {
            this._map.getCanvas().style.cursor = 'crosshair';
            this._map.once('click', async (e) => {
                this._addMarkerMode = false;
                if (btn) btn.classList.remove('active');
                this._map.getCanvas().style.cursor = '';

                const markerData = await this._showMarkerModal({
                    lng: e.lngLat.lng, lat: e.lngLat.lat,
                    title: '', popup_content: '', color: '#e74c3c', icon: 'marker',
                });
                if (!markerData) return;

                const slide = this._slides[this._currentSlideIdx];
                try {
                    await Api.addMarker(slide.id, markerData);
                    App.toast(I18n.t('editor.marker_added'), 'success');
                    await this._refreshMarkers();
                } catch (err) { App.toast(err.message, 'danger'); }
            });
        } else {
            this._map.getCanvas().style.cursor = '';
        }
    },

    async _showMarkerModal(marker) {
        const t = I18n.t.bind(I18n);
        const isEdit = !!marker.id;
        const result = await App.modal({
            title: isEdit ? t('editor.edit_marker') : t('editor.add_marker'),
            size: 'lg',
            body: `
                <div class="row g-3">
                    <div class="col-8">
                        <label class="form-label">${t('editor.marker_title')}</label>
                        <input type="text" class="form-control" id="modal-marker-title"
                               value="${App.escHtml(marker.title || '')}" placeholder="${t('editor.marker_title_ph')}">
                    </div>
                    <div class="col-4">
                        <label class="form-label">${t('editor.marker_color')}</label>
                        <input type="color" class="form-control form-control-color w-100" id="modal-marker-color"
                               value="${marker.color || '#e74c3c'}">
                    </div>
                </div>
                <div class="mb-3 mt-3">
                    <label class="form-label">${t('editor.marker_content')}</label>
                    <div class="narrative-toolbar" style="margin-bottom:4px">
                        <button class="btn" onclick="document.execCommand('bold')" title="Bold"><i class="bi bi-type-bold"></i></button>
                        <button class="btn" onclick="document.execCommand('italic')" title="Italic"><i class="bi bi-type-italic"></i></button>
                        <button class="btn" onclick="document.execCommand('createLink', false, prompt('URL:'))" title="Link"><i class="bi bi-link-45deg"></i></button>
                        <button class="btn" onclick="document.execCommand('insertImage', false, prompt('Image URL:'))" title="Image"><i class="bi bi-image"></i></button>
                    </div>
                    <div class="narrative-editor" id="modal-marker-content" contenteditable="true"
                         style="min-height:100px">${marker.popup_content || ''}</div>
                </div>
                <div class="row g-3">
                    <div class="col-4">
                        <label class="form-label">${t('editor.marker_icon')}</label>
                        <div class="marker-icon-grid" id="modal-marker-icon-grid">
                            ${[
                                { id: 'geo-alt-fill', label: 'Pin' },
                                { id: 'star-fill', label: 'Stella' },
                                { id: 'info-circle-fill', label: 'Info' },
                                { id: 'camera-fill', label: 'Foto' },
                                { id: 'building', label: 'Museo' },
                                { id: 'cup-hot-fill', label: 'Cibo' },
                                { id: 'tree-fill', label: 'Parco' },
                                { id: 'bank2', label: 'Monum.' },
                                { id: 'house-fill', label: 'Casa' },
                                { id: 'heart-fill', label: 'Cuore' },
                                { id: 'flag-fill', label: 'Band.' },
                                { id: 'exclamation-triangle-fill', label: 'Avviso' },
                                { id: 'music-note-beamed', label: 'Musica' },
                                { id: 'book-fill', label: 'Libro' },
                                { id: 'water', label: 'Acqua' },
                                { id: 'bicycle', label: 'Bici' },
                            ].map(ic => `
                                <div class="marker-icon-option ${marker.icon === ic.id ? 'active' : ''}" data-icon="${ic.id}" title="${ic.label}"
                                     onclick="document.querySelectorAll('.marker-icon-option').forEach(o=>o.classList.remove('active'));this.classList.add('active');document.getElementById('modal-marker-icon').value=this.dataset.icon">
                                    <i class="bi bi-${ic.id}"></i>
                                </div>
                            `).join('')}
                        </div>
                        <input type="hidden" id="modal-marker-icon" value="${marker.icon || 'geo-alt-fill'}">
                    </div>
                    <div class="col-4">
                        <label class="form-label">${t('editor.marker_size')}</label>
                        <select class="form-select form-select-sm" id="modal-marker-size">
                            ${['small', 'medium', 'large'].map(s =>
                                `<option value="${s}" ${(marker.size || 'medium') === s ? 'selected' : ''}>${t('editor.marker_size_' + s)}</option>`
                            ).join('')}
                        </select>
                        <label class="form-label mt-2">${t('editor.marker_shape')}</label>
                        <select class="form-select form-select-sm" id="modal-marker-shape">
                            ${['circle', 'square', 'diamond'].map(s =>
                                `<option value="${s}" ${(marker.shape || 'circle') === s ? 'selected' : ''}>${t('editor.marker_shape_' + s)}</option>`
                            ).join('')}
                        </select>
                    </div>
                    <div class="col-4">
                        <label class="form-label">${t('editor.marker_coords')}</label>
                        <small class="form-text d-block">${marker.lat?.toFixed(5)}, ${marker.lng?.toFixed(5)}</small>
                    </div>
                </div>
                ${isEdit ? `<div class="mt-3"><button class="btn btn-sm btn-outline-danger" id="modal-marker-delete"><i class="bi bi-trash"></i> ${t('action.delete')}</button></div>` : ''}
            `,
            confirmText: isEdit ? t('action.save') : t('action.confirm'),
            onConfirm: () => ({
                lng: marker.lng,
                lat: marker.lat,
                title: document.getElementById('modal-marker-title')?.value || '',
                popup_content: document.getElementById('modal-marker-content')?.innerHTML || '',
                color: document.getElementById('modal-marker-color')?.value || '#e74c3c',
                icon: document.getElementById('modal-marker-icon')?.value || 'geo-alt-fill',
                size: document.getElementById('modal-marker-size')?.value || 'medium',
                shape: document.getElementById('modal-marker-shape')?.value || 'circle',
            }),
        });

        // Hook delete button after modal opens
        setTimeout(() => {
            document.getElementById('modal-marker-delete')?.addEventListener('click', async () => {
                if (marker.id) {
                    const ok = await App.confirm(t('editor.marker_delete_confirm'), { danger: true });
                    if (ok) {
                        await Api.deleteMarker(marker.id);
                        bootstrap.Modal.getInstance(document.querySelector('.modal.show'))?.hide();
                        await this._refreshMarkers();
                        App.toast(t('editor.marker_deleted'), 'success');
                    }
                }
            });
        }, 200);

        return result;
    },

    async _editMarker(markerId) {
        const slide = this._slides[this._currentSlideIdx];
        const fullSlide = await Api.getSlide(slide.id);
        const marker = (fullSlide.markers || []).find(m => m.id === markerId);
        if (!marker) return;

        // Decode packed icon field
        if (marker.icon?.includes('|')) {
            const parts = marker.icon.split('|');
            marker.icon = parts[0];
            marker.size = parts[1] || 'medium';
            marker.shape = parts[2] || 'circle';
        }

        const updated = await this._showMarkerModal(marker);
        if (!updated) return;

        try {
            await Api.updateMarker(markerId, updated);
            App.toast(I18n.t('editor.marker_saved'), 'success');
            await this._refreshMarkers();
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    async _refreshMarkers() {
        const slide = this._slides[this._currentSlideIdx];
        if (!slide) return;
        const fullSlide = await Api.getSlide(slide.id);
        const markers = fullSlide.markers || [];
        TmMap.addMarkers(markers, (m) => this._editMarker(m.id));
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

        // Drawing tools
        document.getElementById('editor-draw-line')?.addEventListener('click', () => TmMap.startDrawLine());
        document.getElementById('editor-draw-polygon')?.addEventListener('click', () => TmMap.startDrawPolygon());
        document.getElementById('editor-draw-delete')?.addEventListener('click', () => TmMap.deleteDrawSelected());

        // Guide button
        document.getElementById('editor-show-guide')?.addEventListener('click', () => {
            if (typeof Guide !== 'undefined') {
                Guide.reset();
                Guide.start();
            }
        });

        // Switch to map layout button (in no-map placeholder)
        document.getElementById('editor-switch-to-map-layout')?.addEventListener('click', () => {
            const slide = this._slides[this._currentSlideIdx];
            if (slide) {
                slide.layout = 'side-left';
                this._updateMapVisibility();
                this._renderProps(slide);
                this._renderSlidesList();
            }
        });
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
        this._autosaveTimer = setInterval(() => this._doAutosave(), 15000);
    },

    async _doAutosave() {
        const indicator = document.getElementById('editor-autosave-status');
        if (indicator) {
            indicator.className = 'editor-autosave-indicator saving';
            indicator.innerHTML = `<i class="bi bi-cloud-arrow-up"></i> <span>${I18n.t('editor.saving')}</span>`;
        }
        await this._saveCurrentSlideProps();
        if (indicator) {
            indicator.className = 'editor-autosave-indicator saved';
            indicator.innerHTML = `<i class="bi bi-cloud-check"></i> <span>${I18n.t('editor.autosaved')}</span>`;
            setTimeout(() => {
                indicator.className = 'editor-autosave-indicator';
            }, 3000);
        }
    },

    _layoutIcon(layout) {
        return { 'cover': 'card-heading', 'side-left': 'layout-sidebar', 'side-right': 'layout-sidebar-reverse',
            'center': 'layout-text-window', 'full-map': 'map', 'full-media': 'image',
            'text-only': 'file-text', 'text-media': 'layout-text-sidebar',
            'separator': 'hr' }[layout] || 'square';
    },
};
