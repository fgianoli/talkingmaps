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

    // Layouts that include a map (2D or 3D) — cover is fullscreen without map
    _mapLayouts: ['side-left', 'side-right', 'center', 'full-map', 'image-map', 'globe-3d', 'potree-3d'],
    // Layouts without a map
    _noMapLayouts: ['cover', 'text-only', 'text-media', 'full-media', 'separator'],
    // 3D-specific layouts
    _3dLayouts: ['globe-3d', 'potree-3d'],

    _currentSlideHasMap() {
        const slide = this._slides[this._currentSlideIdx];
        if (!slide) return true;
        return this._mapLayouts.includes(slide.layout || 'side-left');
    },

    destroy() {
        // Stop autosave timer
        clearInterval(this._autosaveTimer);
        this._autosaveTimer = null;

        // Remove global keydown listener
        if (this._undoKeyHandler) {
            document.removeEventListener('keydown', this._undoKeyHandler);
            this._undoKeyHandler = null;
        }

        // Destroy sortable
        if (this._sortable) {
            this._sortable.destroy();
            this._sortable = null;
        }

        // Destroy Cesium if active
        this._destroyEditorCesium();

        // Destroy map
        TmMap.destroyDraw();
        TmMap.destroy();
        this._map = null;

        // Reset state
        this._storyId = null;
        this._story = null;
        this._slides = [];
        this._layers = [];
        this._currentSlideIdx = 0;
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
                        <button class="btn btn-sm btn-outline-light" id="editor-export-image" title="${t('editor.export_image')}">
                            <i class="bi bi-camera"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-light" id="editor-share" title="${t('editor.share')}">
                            <i class="bi bi-share"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-light" id="editor-embed-config" title="${t('editor.embed_config')}">
                            <i class="bi bi-code-slash"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-light" id="editor-versions" title="${t('editor.versions')}">
                            <i class="bi bi-clock-history"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-light" id="editor-show-guide" title="${t('editor.show_guide')}">
                            <i class="bi bi-question-circle"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-light" id="editor-undo" title="${t('editor.undo')} (Ctrl+Z)" disabled>
                            <i class="bi bi-arrow-counterclockwise"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-light" id="editor-redo" title="${t('editor.redo')} (Ctrl+Shift+Z)" disabled>
                            <i class="bi bi-arrow-clockwise"></i>
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
                <div class="editor-cesium d-none" id="editor-cesium"></div>
                <div class="editor-map-tools" id="editor-map-tools">
                    <button class="btn" id="editor-capture-view" title="${t('editor.capture')}"><i class="bi bi-camera"></i></button>
                    <button class="btn" id="editor-add-marker" title="${t('editor.add_marker')}"><i class="bi bi-geo-alt"></i></button>
                    <div class="editor-map-tools-sep"></div>
                    <button class="btn" id="editor-draw-line" title="${t('editor.draw_line')}"><i class="bi bi-bezier2"></i></button>
                    <button class="btn" id="editor-draw-polygon" title="${t('editor.draw_polygon')}"><i class="bi bi-pentagon"></i></button>
                    <button class="btn" id="editor-draw-delete" title="${t('editor.draw_delete')}"><i class="bi bi-eraser"></i></button>
                    <div class="editor-map-tools-sep"></div>
                    <button class="btn" id="editor-measure-distance" title="${t('editor.measure_distance')}"><i class="bi bi-rulers"></i></button>
                    <button class="btn" id="editor-measure-area" title="${t('editor.measure_area')}"><i class="bi bi-bounding-box"></i></button>
                    <button class="btn d-none" id="editor-measure-clear" title="${t('editor.measure_clear')}"><i class="bi bi-x-circle"></i></button>
                    <div class="editor-map-tools-sep"></div>
                    <button class="btn" id="editor-manage-layers" title="${t('editor.manage_layers')}"><i class="bi bi-layers"></i></button>
                    <div class="editor-map-tools-sep"></div>
                    <div class="editor-geocode-wrapper" id="editor-geocode-wrapper">
                        <button class="btn" id="editor-geocode-toggle" title="${t('editor.geocode')}"><i class="bi bi-search"></i></button>
                        <div class="editor-geocode-input" id="editor-geocode-input" style="display:none">
                            <input type="text" class="form-control form-control-sm" id="editor-geocode-search"
                                   placeholder="${t('editor.geocode_ph')}" autocomplete="off">
                            <div class="editor-geocode-results" id="editor-geocode-results"></div>
                        </div>
                    </div>
                    <div class="editor-map-tools-sep"></div>
                    <button class="btn" id="editor-wiki-osm-btn" title="${t('editor.wiki_osm')}"><i class="bi bi-wikipedia"></i></button>
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

            <div class="editor-props-wrapper">
                <div class="editor-props-resize-handle" id="editor-props-resize"></div>
                <div class="editor-props-panel">
                    <div class="editor-props-header">
                        <h3><i class="bi bi-sliders"></i> ${t('editor.props')}</h3>
                    </div>
                    <div class="editor-props-tabs" id="editor-props-tabs">
                        <div class="editor-props-tab active" data-tab="slide"><i class="bi bi-card-text"></i> ${t('editor.tab_slide')}</div>
                        <div class="editor-props-tab" data-tab="map"><i class="bi bi-map"></i> ${t('editor.tab_map')}</div>
                        <div class="editor-props-tab" data-tab="media"><i class="bi bi-collection"></i> ${t('editor.tab_media')}</div>
                    </div>
                    <div class="editor-props-body" id="editor-props-body"></div>
                </div>
            </div>

            <div class="editor-mobile-tabs" id="editor-mobile-tabs">
                <button class="editor-mobile-tab active" data-mobile-tab="slides">
                    <i class="bi bi-collection"></i>
                    ${t('editor.slides')}
                </button>
                <button class="editor-mobile-tab" data-mobile-tab="map">
                    <i class="bi bi-map"></i>
                    ${t('editor.tab_map')}
                </button>
                <button class="editor-mobile-tab" data-mobile-tab="props">
                    <i class="bi bi-sliders"></i>
                    ${t('editor.props')}
                </button>
            </div>
        `;

        this._initEditorMap(data);
        this._initPropsResize();
        this._initMobileTabs();
        this._renderSlidesList();
        if (this._slides.length > 0) this._selectSlide(0);
        this._bindEvents();
        this._setupSortable();
        this._startAutosave();

        // Initialize undo/redo: reset history and push initial state
        UndoManager.reset();
        UndoManager.push(this._slides);
        this._updateUndoRedoButtons();
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
        TmMap.initDraw(
            (e) => this._onDrawChange(e),
            (e) => this._onDrawSelect(e),
        );
    },

    _onDrawChange(e) {
        // Save drawn features to current slide's style_overrides
        const slide = this._slides[this._currentSlideIdx];
        if (!slide) return;
        const features = TmMap.getDrawFeatures();
        slide.style_overrides = { ...(slide.style_overrides || {}), drawn_features: features };

        // If a new feature was just created, open its property editor
        if (e?.type === 'draw.create' && e.features?.length) {
            const feat = e.features[0];
            this._editDrawnFeature(feat.id);
        }

        // Refresh drawn features list in the panel
        this._renderDrawnFeaturesList();
    },

    _onDrawSelect(e) {
        // When a drawn feature is selected (double-click), open editor
        if (e.features?.length === 1) {
            // Double-click opens editor - use a flag to avoid triggering on simple select
            const featId = e.features[0].id;
            this._selectedDrawnFeatureId = featId;
        }
    },

    _showShareModal() {
        const t = I18n.t.bind(I18n);
        const base = window.location.origin + window.location.pathname;
        const viewUrl = `${base}#/view/${this._storyId}`;
        const embedUrl = `${base}?embed=${this._storyId}&theme=dark`;
        const embedCode = `<iframe src="${embedUrl}" width="100%" height="600" frameborder="0" allow="fullscreen" style="border:none;border-radius:8px"></iframe>`;

        App.modal({
            title: t('editor.share'),
            size: 'lg',
            body: `
                <ul class="nav nav-tabs mb-3" role="tablist">
                    <li class="nav-item"><a class="nav-link active" data-bs-toggle="tab" href="#share-tab-link"><i class="bi bi-link-45deg"></i> ${t('editor.share_link')}</a></li>
                    <li class="nav-item"><a class="nav-link" data-bs-toggle="tab" href="#share-tab-collab"><i class="bi bi-people"></i> ${t('editor.collaborators')}</a></li>
                </ul>
                <div class="tab-content">
                    <div class="tab-pane fade show active" id="share-tab-link">
                        <div class="mb-3">
                            <label class="form-label"><i class="bi bi-link-45deg"></i> ${t('editor.share_link')}</label>
                            <div class="input-group">
                                <input type="text" class="form-control" id="share-url" value="${viewUrl}" readonly>
                                <button class="btn btn-outline-primary" onclick="navigator.clipboard.writeText(document.getElementById('share-url').value);this.innerHTML='<i class=\\'bi bi-check\\'></i>'">
                                    <i class="bi bi-clipboard"></i>
                                </button>
                            </div>
                        </div>
                        <div class="mb-3">
                            <label class="form-label"><i class="bi bi-code-slash"></i> ${t('editor.embed_code')}</label>
                            <small class="text-muted d-block mb-2">${t('editor.embed_desc')}</small>
                            <div class="input-group">
                                <textarea class="form-control" id="share-embed" rows="3" readonly style="font-family:monospace;font-size:11px">${App.escHtml(embedCode)}</textarea>
                                <button class="btn btn-outline-primary" onclick="navigator.clipboard.writeText(document.getElementById('share-embed').value);this.innerHTML='<i class=\\'bi bi-check\\'></i>'" style="align-self:stretch">
                                    <i class="bi bi-clipboard"></i> ${t('editor.embed_copy')}
                                </button>
                            </div>
                        </div>
                        <small class="text-muted"><i class="bi bi-info-circle"></i> ${t('editor.share_note')}</small>
                    </div>
                    <div class="tab-pane fade" id="share-tab-collab">
                        <div class="mb-3">
                            <label class="form-label"><i class="bi bi-person-plus"></i> ${t('editor.collab_search')}</label>
                            <div class="input-group">
                                <input type="text" class="form-control" id="collab-search-input" placeholder="${t('editor.collab_search')}" autocomplete="off">
                                <select class="form-select" id="collab-role-select" style="max-width:130px">
                                    <option value="editor">${t('editor.collab_role_editor')}</option>
                                    <option value="viewer">${t('editor.collab_role_viewer')}</option>
                                </select>
                            </div>
                            <div id="collab-search-results" class="list-group mt-1" style="max-height:150px;overflow-y:auto"></div>
                        </div>
                        <hr>
                        <div id="collab-list" class="mb-2">
                            <div class="text-center text-muted py-3"><div class="spinner-border spinner-border-sm"></div></div>
                        </div>
                    </div>
                </div>
            `,
            confirmText: t('action.close') || 'OK',
            onConfirm: () => true,
        });

        // Initialize collaborators tab
        this._initCollabTab();
    },

    _collabSearchTimeout: null,

    async _initCollabTab() {
        // Load existing collaborators
        this._refreshCollabList();

        // Setup search with debounce
        const input = document.getElementById('collab-search-input');
        if (!input) return;
        input.addEventListener('input', () => {
            clearTimeout(this._collabSearchTimeout);
            const q = input.value.trim();
            if (q.length < 2) {
                document.getElementById('collab-search-results').innerHTML = '';
                return;
            }
            this._collabSearchTimeout = setTimeout(() => this._searchCollabUsers(q), 300);
        });
    },

    async _searchCollabUsers(query) {
        const resultsEl = document.getElementById('collab-search-results');
        if (!resultsEl) return;
        try {
            const users = await Api.searchUsers(query);
            if (!users.length) {
                resultsEl.innerHTML = '<div class="list-group-item text-muted small">Nessun utente trovato</div>';
                return;
            }
            // Values ride in data-* attributes and are read back via dataset, never
            // interpolated into an inline handler: HTML escaping cannot protect a JS
            // string context, because the browser decodes the attribute first.
            resultsEl.innerHTML = users.map(u => `
                <button class="list-group-item list-group-item-action d-flex align-items-center py-2"
                        data-collab-user-id="${App.escHtml(u.id)}" data-collab-username="${App.escHtml(u.username)}">
                    ${u.avatar ? `<img src="${App.escHtml(u.avatar)}" class="rounded-circle me-2" width="24" height="24">` : '<i class="bi bi-person-circle me-2"></i>'}
                    <div>
                        <strong>${App.escHtml(u.display_name || u.username)}</strong>
                        ${u.email ? `<small class="text-muted ms-2">${App.escHtml(u.email)}</small>` : ''}
                    </div>
                    <i class="bi bi-plus-circle ms-auto text-primary"></i>
                </button>
            `).join('');
            resultsEl.querySelectorAll('[data-collab-user-id]').forEach(btn => {
                btn.addEventListener('click', () => this._addCollab(
                    parseInt(btn.dataset.collabUserId, 10), btn.dataset.collabUsername));
            });
        } catch (err) {
            resultsEl.innerHTML = '';
        }
    },

    async _addCollab(userId, username) {
        const t = I18n.t.bind(I18n);
        const role = document.getElementById('collab-role-select')?.value || 'viewer';
        try {
            await Api.addCollaborator(this._storyId, userId, role);
            App.toast(t('editor.collab_added'), 'success');
            document.getElementById('collab-search-input').value = '';
            document.getElementById('collab-search-results').innerHTML = '';
            this._refreshCollabList();
        } catch (err) {
            App.toast(err.message, 'danger');
        }
    },

    async _refreshCollabList() {
        const t = I18n.t.bind(I18n);
        const listEl = document.getElementById('collab-list');
        if (!listEl) return;
        try {
            const collabs = await Api.listCollaborators(this._storyId);
            if (!collabs.length) {
                listEl.innerHTML = `<div class="text-center text-muted py-3"><i class="bi bi-people"></i> ${t('editor.collab_none')}</div>`;
                return;
            }
            listEl.innerHTML = collabs.map(c => `
                <div class="d-flex align-items-center py-2 px-2 border-bottom" data-collab-uid="${c.user_id}">
                    ${c.avatar ? `<img src="${App.escHtml(c.avatar)}" class="rounded-circle me-2" width="32" height="32">` : '<i class="bi bi-person-circle me-2 fs-5"></i>'}
                    <div class="flex-grow-1">
                        <div class="fw-semibold">${App.escHtml(c.display_name || c.username)}</div>
                        <small class="text-muted">${App.escHtml(c.email || c.username)}</small>
                    </div>
                    <select class="form-select form-select-sm me-2" style="width:auto" onchange="StoryEditor._updateCollabRole(${c.user_id}, this.value)">
                        <option value="editor" ${c.role === 'editor' ? 'selected' : ''}>${t('editor.collab_role_editor')}</option>
                        <option value="viewer" ${c.role === 'viewer' ? 'selected' : ''}>${t('editor.collab_role_viewer')}</option>
                    </select>
                    <button class="btn btn-sm btn-outline-danger" onclick="StoryEditor._removeCollab(${c.user_id})" title="Rimuovi">
                        <i class="bi bi-x-lg"></i>
                    </button>
                </div>
            `).join('');
        } catch (err) {
            listEl.innerHTML = `<div class="text-muted small">${err.message}</div>`;
        }
    },

    async _updateCollabRole(userId, newRole) {
        const t = I18n.t.bind(I18n);
        try {
            await Api.updateCollaborator(this._storyId, userId, newRole);
            App.toast(t('editor.collab_updated'), 'success');
        } catch (err) {
            App.toast(err.message, 'danger');
            this._refreshCollabList();
        }
    },

    async _removeCollab(userId) {
        const t = I18n.t.bind(I18n);
        try {
            await Api.removeCollaborator(this._storyId, userId);
            App.toast(t('editor.collab_removed'), 'success');
            this._refreshCollabList();
        } catch (err) {
            App.toast(err.message, 'danger');
        }
    },

    async _showVersionsModal() {
        const t = I18n.t.bind(I18n);
        let versions = [];
        try {
            versions = await Api.listVersions(this._storyId);
        } catch (e) {
            console.error('Error loading versions:', e);
        }

        let versionsList = '';
        if (versions.length === 0) {
            versionsList = `<p class="text-muted text-center mt-3"><i class="bi bi-clock"></i> ${t('editor.no_versions')}</p>`;
        } else {
            versionsList = '<div class="list-group mt-3" style="max-height:300px;overflow-y:auto">';
            for (const v of versions) {
                const date = new Date(v.created_at).toLocaleString();
                versionsList += `
                    <div class="list-group-item d-flex justify-content-between align-items-center">
                        <div>
                            <strong>v${v.version_number}</strong> — ${App.escHtml(v.message || '')}
                            <br><small class="text-muted">${date}</small>
                        </div>
                        <button class="btn btn-sm btn-outline-warning tm-restore-version" data-vid="${v.id}">
                            <i class="bi bi-arrow-counterclockwise"></i> ${t('editor.restore_version')}
                        </button>
                    </div>`;
            }
            versionsList += '</div>';
        }

        App.modal({
            title: `<i class="bi bi-clock-history"></i> ${t('editor.versions_title')}`,
            body: `
                <div class="mb-3">
                    <label class="form-label">${t('editor.version_message')}</label>
                    <div class="input-group">
                        <input type="text" class="form-control" id="version-message" placeholder="${t('editor.version_message')}">
                        <button class="btn btn-primary" id="version-save-btn">
                            <i class="bi bi-save"></i> ${t('editor.save_version')}
                        </button>
                    </div>
                </div>
                <hr>
                ${versionsList}
            `,
            confirmText: t('action.close') || 'OK',
            onConfirm: () => true,
        });

        // Bind save version button
        setTimeout(() => {
            document.getElementById('version-save-btn')?.addEventListener('click', async () => {
                const msg = document.getElementById('version-message')?.value || '';
                try {
                    await this._saveCurrentSlideProps();
                    await Api.createVersion(this._storyId, msg);
                    App.toast(t('editor.version_saved'), 'success');
                    // Refresh modal
                    document.querySelector('.modal .btn-close')?.click();
                    this._showVersionsModal();
                } catch (e) {
                    App.toast(e.message, 'danger');
                }
            });

            // Bind restore buttons
            document.querySelectorAll('.tm-restore-version').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (!confirm(t('editor.restore_confirm'))) return;
                    const vid = btn.dataset.vid;
                    try {
                        await Api.restoreVersion(this._storyId, parseInt(vid));
                        App.toast(t('editor.version_restored'), 'success');
                        document.querySelector('.modal .btn-close')?.click();
                        // Reload editor
                        this.load(this._storyId);
                    } catch (e) {
                        App.toast(e.message, 'danger');
                    }
                });
            });
        }, 100);
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
        const slide = this._slides[this._currentSlideIdx];
        const is3D = this._3dLayouts.includes(slide?.layout);
        const mapEl = document.getElementById('editor-map');
        const cesiumEl = document.getElementById('editor-cesium');
        const toolsEl = document.getElementById('editor-map-tools');
        const infoEl = document.getElementById('editor-map-info');
        const placeholder = document.getElementById('editor-no-map-placeholder');
        const textEl = document.getElementById('editor-no-map-text');

        if (hasMap) {
            placeholder?.classList.add('d-none');

            if (is3D) {
                // Show Cesium, hide MapLibre
                mapEl?.classList.add('d-none');
                cesiumEl?.classList.remove('d-none');
                toolsEl?.classList.add('d-none');
                infoEl?.classList.add('d-none');
                this._initEditorCesium(slide);
            } else {
                // Show MapLibre, hide Cesium
                mapEl?.classList.remove('d-none');
                cesiumEl?.classList.add('d-none');
                toolsEl?.classList.remove('d-none');
                infoEl?.classList.remove('d-none');
                this._destroyEditorCesium();
                if (this._map) this._map.resize();
            }
        } else {
            mapEl?.classList.add('d-none');
            cesiumEl?.classList.add('d-none');
            toolsEl?.classList.add('d-none');
            infoEl?.classList.add('d-none');
            placeholder?.classList.remove('d-none');
            if (textEl) textEl.textContent = I18n.t('editor.no_map_hint');
            this._destroyEditorCesium();
        }
    },

    _editorCesiumActive: false,

    _initEditorCesium(slide) {
        if (typeof Cesium === 'undefined') {
            App.toast('CesiumJS non caricato', 'warning');
            return;
        }
        const layout = slide?.layout;
        if (layout === 'potree-3d') {
            // Potree: show a placeholder message, can't fully preview in editor
            const el = document.getElementById('editor-cesium');
            if (el && !this._editorCesiumActive) {
                el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:12px;color:var(--tm-text-muted)">
                    <i class="bi bi-cloud-fill" style="font-size:48px"></i>
                    <p style="margin:0;text-align:center">${I18n.t('editor.potree_preview_hint') || 'Potree point cloud preview — configure URL in Media & 3D tab. Full preview available in story viewer.'}</p>
                </div>`;
                this._editorCesiumActive = true;
            }
            return;
        }
        // Globe 3D: init Cesium
        if (!this._editorCesiumActive) {
            try {
                const state = this._map ? TmMap.getState() : { center: { lng: 12.49, lat: 41.89 }, zoom: 5 };
                const settings = this._story?.settings || {};
                Cesium3D.init('editor-cesium', {
                    ionToken: settings.cesium_ion_token || '',
                    camera: {
                        position: [
                            slide?.map_center?.lng || state.center.lng,
                            slide?.map_center?.lat || state.center.lat,
                            this._zoomToHeight(slide?.map_zoom || state.zoom)
                        ],
                        heading: slide?.map_bearing || 0,
                        pitch: -(slide?.map_pitch || 45),
                    },
                });
                this._editorCesiumActive = true;

                // Load tileset if configured
                const ts = slide?.style_overrides?.tileset3d;
                if (ts?.ionAssetId) {
                    Cesium3D.addTileset({ ionAssetId: ts.ionAssetId, id: 'editor-tileset' });
                } else if (ts?.url) {
                    Cesium3D.addTileset({ url: ts.url, id: 'editor-tileset' });
                }
            } catch (err) {
                console.error('Editor Cesium init error:', err);
                App.toast('Errore inizializzazione vista 3D', 'danger');
            }
        }
    },

    _destroyEditorCesium() {
        if (this._editorCesiumActive) {
            try {
                if (Cesium3D.isActive && Cesium3D.isActive()) {
                    Cesium3D.destroy();
                }
            } catch { /* ok */ }
            const el = document.getElementById('editor-cesium');
            if (el) el.innerHTML = '';
            this._editorCesiumActive = false;
        }
    },

    _zoomToHeight(zoom) {
        // Convert MapLibre zoom level to approximate Cesium camera height
        return 40000000 / Math.pow(2, zoom || 5);
    },

    _applyImageMap(url) {
        if (!this._map) return;
        // Set MapLibre style to show the image as a pannable/zoomable layer
        // Same footprint the viewer uses, so the preview matches what a reader sees
        TmMap.setBasemap({ type: 'image', url: url, config: {} });
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

        const layoutColors = {
            'side-left': '#4f6df5', 'side-right': '#4f6df5', 'center': '#4f6df5',
            'cover': '#4f6df5', 'full-map': '#4f6df5',
            'text-only': '#6c757d', 'text-media': '#9b59b6',
            'full-media': '#9b59b6', 'separator': '#e67e22',
            'image-map': '#e67e22',
            'globe-3d': '#2ecc71', 'potree-3d': '#2ecc71',
        };

        let lastChapter = null;
        list.innerHTML = this._slides.map((slide, idx) => {
            const icon = layoutIcons[slide.layout] || 'bi-square';
            const markerCount = (slide.markers || []).length;
            const drawnCount = slide.style_overrides?.drawn_features?.features?.length || 0;
            const hasBg = !!slide.background_media;
            const hasChart = !!slide.style_overrides?.chart;
            const stripColor = layoutColors[slide.layout] || '#4f6df5';
            const chapterName = slide.style_overrides?.chapter || null;
            let chapterHeader = '';
            if (chapterName && chapterName !== lastChapter) {
                chapterHeader = `<div class="slide-chapter-header"><i class="bi bi-bookmark-fill"></i> ${App.escHtml(chapterName)}</div>`;
            }
            lastChapter = chapterName;
            return `${chapterHeader}
                <div class="editor-slide-thumb ${idx === this._currentSlideIdx ? 'active' : ''}"
                     data-slide-idx="${idx}" data-slide-id="${slide.id}"
                     style="border-left:3px solid ${stripColor}">
                    <div class="slide-number">${idx + 1}</div>
                    <div class="slide-info">
                        <h4>${slide.title || I18n.t('editor.untitled')}</h4>
                        <div class="slide-meta">
                            <small><i class="bi bi-${icon}"></i> ${I18n.t('layout.' + (slide.layout || 'side-left'))}</small>
                            ${markerCount ? `<small title="${markerCount} marker"><i class="bi bi-geo-alt"></i>${markerCount}</small>` : ''}
                            ${drawnCount ? `<small title="${drawnCount} ${I18n.t('editor.drawn_features')}"><i class="bi bi-pencil"></i>${drawnCount}</small>` : ''}
                            ${hasBg ? '<small><i class="bi bi-image" title="Background"></i></small>' : ''}
                            ${hasChart ? '<small><i class="bi bi-bar-chart" title="Chart"></i></small>' : ''}
                        </div>
                    </div>
                    <div class="slide-actions">
                        <button class="btn btn-sm btn-outline-light" onclick="event.stopPropagation();StoryEditor._duplicateSlide(${idx})" title="${I18n.t('editor.duplicate_slide')}"><i class="bi bi-copy"></i></button>
                        ${this._slides.length > 1 ? `<button class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation();StoryEditor._deleteSlide(${idx})" title="${I18n.t('action.delete')}"><i class="bi bi-trash"></i></button>` : ''}
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

        // Apply per-slide basemap or image map
        if (this._currentSlideHasMap()) {
            if (slide.layout === 'image-map' && slide.map_config?.image_url) {
                this._applyImageMap(slide.map_config.image_url);
            } else if (slide.basemap_id) {
                const basemap = (this._data?.basemaps || []).find(b => b.id == slide.basemap_id);
                if (basemap) TmMap.setBasemap(basemap);
            } else {
                TmMap.setBasemap((this._data?.basemaps || [])[0] || null);
            }
        }

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
        const allLayouts = ['cover', 'side-left', 'side-right', 'center', 'full-map', 'image-map', 'globe-3d', 'potree-3d', 'full-media', 'text-only', 'text-media', 'separator'];

        const currentTheme = this._story?.settings?.theme || 'light';

        // Remember active tab
        const activeTab = this._activePropsTab || 'slide';

        body.innerHTML = `
            <!-- ═══════════ TAB: SLIDE ═══════════ -->
            <div class="editor-tab-content ${activeTab === 'slide' ? 'active' : ''}" data-tab-content="slide">

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
                                <option value="Ubuntu">Ubuntu</option>
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
                            <button class="btn" onclick="StoryEditor._insertMapLink()" title="${t('editor.link_to_map')}"><i class="bi bi-geo-alt"></i></button>
                            <button class="btn" onclick="StoryEditor._insertImage()" title="${t('editor.insert_image')}"><i class="bi bi-image"></i></button>
                            <button class="btn" onclick="StoryEditor._insertIframe()" title="${t('editor.insert_iframe')}"><i class="bi bi-code-square"></i></button>
                            <button class="btn" onclick="StoryEditor._insertExpressMap()" title="${t('editor.express_map')}"><i class="bi bi-pin-map"></i></button>
                            <div class="editor-map-tools-sep" style="display:inline-block;width:1px;height:16px;background:rgba(255,255,255,0.2);margin:0 4px;vertical-align:middle"></div>
                            <button class="btn" onclick="StoryEditor._aiAssist()" title="${t('editor.ai_assist')}"><i class="bi bi-robot"></i></button>
                        </div>
                        <div class="narrative-editor" id="prop-narrative" contenteditable="true">${slide.narrative || ''}</div>
                    </div>
                    ` : ''}
                </div>

                <!-- Card style -->
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

                <!-- Theme -->
                <div class="prop-section">
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

                <!-- Custom CSS -->
                <div class="prop-section">
                    <div class="prop-section-title" style="cursor:pointer" onclick="document.getElementById('custom-css-collapse').classList.toggle('d-none')">
                        <i class="bi bi-braces"></i> ${t('editor.custom_css')}
                        <i class="bi bi-chevron-down" style="float:right;font-size:11px;opacity:0.5"></i>
                    </div>
                    <div id="custom-css-collapse" class="d-none">
                        <small class="text-muted d-block mb-2">${t('editor.custom_css_desc')}</small>
                        <div class="prop-row">
                            <textarea class="form-control" id="prop-custom-css" rows="6"
                                style="font-family:'Courier New',monospace;font-size:12px;tab-size:2;white-space:pre;resize:vertical"
                                placeholder="/* e.g. .viewer-slide-content { background: rgba(0,0,0,0.8); } */"
                            >${App.escHtml(this._story?.settings?.custom_css || '')}</textarea>
                        </div>
                        <button class="btn btn-sm btn-outline-primary w-100 mt-2" id="btn-save-custom-css">
                            <i class="bi bi-save"></i> ${t('action.save')}
                        </button>
                    </div>
                </div>

                <!-- Participatory Maps -->
                <div class="prop-section">
                    <div class="prop-section-title">
                        <i class="bi bi-people-fill"></i> ${t('contrib.editor_title')}
                    </div>
                    <div id="participatory-collapse">
                        <div class="form-check form-switch mb-2">
                            <input class="form-check-input" type="checkbox" id="participatory-enabled" ${this._story.settings?.participatory_enabled ? 'checked' : ''}>
                            <label class="form-check-label" for="participatory-enabled">${t('contrib.enable')}</label>
                        </div>
                        <div id="participatory-options" style="display:${this._story.settings?.participatory_enabled ? 'block' : 'none'}">
                            <div class="mb-2">
                                <label class="form-label small">${t('contrib.categories_label')}</label>
                                <input type="text" class="form-control form-control-sm" id="participatory-categories"
                                       value="${App.escHtml((this._story.settings?.participatory_categories || []).join(', '))}"
                                       placeholder="${t('contrib.categories_placeholder')}">
                            </div>
                            <div class="alert alert-info small py-1 px-2 mb-0">
                                <i class="bi bi-info-circle"></i> ${t('contrib.moderation_note')}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Navigation Mode -->
                <div class="prop-section">
                    <div class="prop-section-title"><i class="bi bi-signpost-split"></i> ${t('editor.nav_mode')}</div>
                    <div class="prop-row">
                        <select class="form-select" id="prop-nav-mode">
                            <option value="guided" ${this._story.settings?.navigation_mode !== 'unguided' ? 'selected' : ''}>${t('editor.nav_guided')}</option>
                            <option value="unguided" ${this._story.settings?.navigation_mode === 'unguided' ? 'selected' : ''}>${t('editor.nav_unguided')}</option>
                        </select>
                    </div>
                </div>

                <!-- Transition -->
                <div class="prop-section">
                    <div class="prop-section-title"><i class="bi bi-play-circle"></i> ${t('editor.transition') || 'Transition'}</div>
                    <div class="prop-row">
                        <select class="form-select" id="prop-transition">
                            <option value="fade" ${(slide.style_overrides?.transition || 'fade') === 'fade' ? 'selected' : ''}>Fade</option>
                            <option value="slide-up" ${slide.style_overrides?.transition === 'slide-up' ? 'selected' : ''}>Slide Up</option>
                            <option value="slide-left" ${slide.style_overrides?.transition === 'slide-left' ? 'selected' : ''}>Slide Left</option>
                            <option value="zoom" ${slide.style_overrides?.transition === 'zoom' ? 'selected' : ''}>Zoom</option>
                            <option value="reveal-words" ${slide.style_overrides?.transition === 'reveal-words' ? 'selected' : ''}>${t('editor.transition_reveal_words')}</option>
                            <option value="stagger" ${slide.style_overrides?.transition === 'stagger' ? 'selected' : ''}>${t('editor.transition_stagger')}</option>
                        </select>
                        <small class="text-muted">${t('editor.transition_hint')}</small>
                    </div>
                </div>

                <!-- Chapter -->
                <div class="prop-section">
                    <div class="prop-section-title"><i class="bi bi-bookmark"></i> ${t('editor.chapter')}</div>
                    <div class="prop-row">
                        <input type="text" class="form-control" id="prop-chapter" list="chapter-datalist"
                               value="${App.escHtml(slide.style_overrides?.chapter || '')}"
                               placeholder="${t('editor.chapter_ph')}">
                        <datalist id="chapter-datalist">
                            ${[...new Set(this._slides.map(s => s.style_overrides?.chapter).filter(Boolean))].map(ch =>
                                `<option value="${App.escHtml(ch)}">`
                            ).join('')}
                        </datalist>
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
                <div class="prop-section">
                    <div class="prop-section-title"><i class="bi bi-volume-up"></i> ${t('editor.audio')}</div>
                    <div class="prop-row">
                        <label>${t('editor.audio_upload')}</label>
                        <div class="input-group">
                            <input type="text" class="form-control" id="prop-audio-url" value="${slide.audio_url || ''}" placeholder="URL audio" readonly>
                            <button class="btn btn-outline-light" onclick="StoryEditor._uploadAudio()">
                                <i class="bi bi-upload"></i>
                            </button>
                        </div>
                    </div>
                    ${slide.audio_url ? `
                    <div class="prop-row">
                        <audio controls src="${slide.audio_url}" style="width:100%;height:32px;margin-top:4px"></audio>
                    </div>
                    <div class="prop-row">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="prop-audio-autoplay" ${slide.audio_autoplay ? 'checked' : ''}>
                            <label class="form-check-label" for="prop-audio-autoplay">${t('editor.audio_autoplay')}</label>
                        </div>
                    </div>
                    <div class="prop-row">
                        <button class="btn btn-sm btn-outline-danger w-100" onclick="StoryEditor._removeAudio()">
                            <i class="bi bi-trash"></i> ${t('editor.audio_remove')}
                        </button>
                    </div>
                    ` : ''}
                </div>

                <!-- Gallery -->
                <div class="prop-section">
                    <div class="prop-section-title"><i class="bi bi-images"></i> ${t('editor.gallery')}</div>
                    ${(slide.style_overrides?.gallery?.images?.length) ? `
                    <div class="prop-row">
                        <label>${t('editor.gallery_images')} (${slide.style_overrides.gallery.images.length})</label>
                    </div>
                    <div id="gallery-thumbs-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px">
                        ${slide.style_overrides.gallery.images.map((img, i) => `
                            <div class="gallery-editor-item" style="display:flex;align-items:center;gap:8px;padding:4px;border:1px solid var(--tm-border);border-radius:6px">
                                <div style="position:relative;width:56px;height:56px;flex-shrink:0;border-radius:4px;overflow:hidden">
                                    <img src="${App.escHtml(img.url)}" style="width:100%;height:100%;object-fit:cover">
                                </div>
                                <input type="text" class="form-control form-control-sm gallery-caption-inline" data-gallery-index="${i}"
                                       value="${App.escHtml(img.caption || '')}" placeholder="${t('editor.gallery_caption')}"
                                       style="flex:1;font-size:12px">
                                <button class="btn btn-sm btn-outline-danger" style="flex-shrink:0;padding:2px 6px" onclick="StoryEditor._removeGalleryImage(${i})" title="${t('delete')}">
                                    <i class="bi bi-trash"></i>
                                </button>
                            </div>
                        `).join('')}
                    </div>
                    <div class="prop-row" style="gap:4px">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="prop-gallery-autoplay" ${slide.style_overrides.gallery.autoplay ? 'checked' : ''}
                                   onchange="StoryEditor._updateGalleryOption('autoplay', this.checked)">
                            <label class="form-check-label" for="prop-gallery-autoplay">${t('editor.gallery_autoplay')}</label>
                        </div>
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="prop-gallery-thumbs" ${slide.style_overrides.gallery.showThumbs !== false ? 'checked' : ''}
                                   onchange="StoryEditor._updateGalleryOption('showThumbs', this.checked)">
                            <label class="form-check-label" for="prop-gallery-thumbs">${t('editor.gallery_thumbnails')}</label>
                        </div>
                    </div>
                    ` : `
                    <small class="text-muted"><i class="bi bi-info-circle"></i> ${t('editor.gallery_empty')}</small>
                    `}
                    <div class="prop-row" style="margin-top:6px">
                        <button class="btn btn-sm btn-outline-light w-100" onclick="StoryEditor._openGalleryPicker()">
                            <i class="bi bi-plus-lg"></i> ${t('editor.gallery_add')}
                        </button>
                    </div>
                </div>

            </div><!-- /tab:slide -->

            <!-- ═══════════ TAB: MAP ═══════════ -->
            <div class="editor-tab-content ${activeTab === 'map' ? 'active' : ''}" data-tab-content="map">
                ${hasMap && slide.layout === 'image-map' ? `
                <div class="prop-section">
                    <div class="prop-section-title"><i class="bi bi-image"></i> ${t('editor.image_map_title')}</div>
                    <div class="mb-2">
                        <label class="form-label small">${t('editor.image_map_url')}</label>
                        <input type="text" class="form-control form-control-sm" id="prop-image-map-url"
                               value="${App.escHtml(slide.map_config?.image_url || '')}"
                               placeholder="https://example.com/map.jpg">
                    </div>
                    <button class="btn btn-sm btn-outline-primary w-100 mb-2" id="btn-apply-image-map">
                        <i class="bi bi-check-lg"></i> ${t('editor.image_map_apply')}
                    </button>
                    <div class="alert alert-info small py-1 px-2 mb-0">
                        <i class="bi bi-info-circle"></i> ${t('editor.image_map_hint')}
                    </div>
                </div>
                ` : ''}
                ${hasMap ? `
                <div class="prop-section" ${slide.layout === 'image-map' ? 'style="display:none"' : ''}>
                    <div class="prop-section-title"><i class="bi bi-map"></i> ${t('editor.map_view')}</div>
                    <div class="prop-row">
                        <label>${t('editor.basemap')}</label>
                        <select class="form-select" id="prop-slide-basemap">
                            <option value="" ${!slide.basemap_id ? 'selected' : ''}>${t('editor.basemap_default')}</option>
                            <option value="none" ${slide.basemap_id === 'none' ? 'selected' : ''}>${t('editor.basemap_none')}</option>
                            ${(this._data?.basemaps || []).map(b => `
                                <option value="${b.id}" ${slide.basemap_id == b.id ? 'selected' : ''}>${b.name}</option>
                            `).join('')}
                        </select>
                    </div>
                    <div class="editor-map-hint">
                        <i class="bi bi-info-circle"></i> ${t('editor.has_map_hint')}
                    </div>
                    <div class="prop-row">
                        <label>${t('editor.animation')}</label>
                        <select class="form-select" id="prop-animation">
                            <option value="flyTo" ${slide.map_animation === 'flyTo' ? 'selected' : ''}>${t('editor.anim_fly')}</option>
                            <option value="easeTo" ${slide.map_animation === 'easeTo' ? 'selected' : ''}>${t('editor.anim_ease')}</option>
                            <option value="jumpTo" ${slide.map_animation === 'jumpTo' ? 'selected' : ''}>${t('editor.anim_jump')}</option>
                            <option value="cinematic" ${slide.map_animation === 'cinematic' ? 'selected' : ''}>${t('editor.anim_cinematic')}</option>
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
                            const override = slide.layer_visibility?.[l.layer_id];
                            const isVis = typeof override === 'object' ? override.visible !== false : (override !== undefined ? !!override : l.visible);
                            const layerOpacity = typeof override === 'object' && override.opacity !== undefined ? override.opacity : (l.opacity ?? 1);
                            return `
                                <div class="editor-layer-item" data-layer-id="${l.layer_id}">
                                    <i class="bi bi-eye${isVis ? '' : '-slash'} layer-visibility ${isVis ? 'visible' : ''}"
                                       onclick="StoryEditor._toggleLayerVis(${l.layer_id}, this)"></i>
                                    <span style="flex:1;font-size:13px">${App.escHtml(l.layer_name)}</span>
                                    <input type="range" min="0" max="1" step="0.05" value="${layerOpacity}"
                                           style="width:60px;margin:0 4px" title="${t('editor.layer_opacity')}"
                                           oninput="StoryEditor._setLayerSlideOpacity(${l.layer_id}, parseFloat(this.value))">
                                    <button class="btn btn-sm" onclick="StoryEditor._openLayerStyle(${l.layer_id})" title="${t('editor.layer_style')}">
                                        <i class="bi bi-palette" style="font-size:12px"></i>
                                    </button>
                                    ${l.layer_type === 'geojson' || l.layer_type === 'wfs' ? `<button class="btn btn-sm" onclick="StoryEditor._openAttributeTable(${l.layer_id})" title="${t('editor.attribute_table')}">
                                        <i class="bi bi-table" style="font-size:12px"></i>
                                    </button><button class="btn btn-sm" onclick="StoryEditor._openLayerFilter(${l.layer_id})" title="${t('editor.layer_filter')}">
                                        <i class="bi bi-funnel" style="font-size:12px"></i>
                                    </button>` : ''}
                                    ${(l.layer_type === 'geojson' || l.layer_type === 'wfs') && l.source_config?.url ? `<button class="btn btn-sm" onclick="StoryEditor._configAutoRefresh(${l.layer_id})" title="${t('editor.auto_refresh')}">
                                        <i class="bi bi-arrow-repeat" style="font-size:12px"></i>
                                    </button>` : ''}
                                    <small class="text-muted">${l.layer_type}</small>
                                </div>
                            `;
                        }).join('') || `<small class="text-muted">${t('editor.no_layers')}</small>`}
                    </div>
                    <button class="btn btn-sm btn-outline-light w-100 mt-2" onclick="StoryEditor._openLayersModal()">
                        <i class="bi bi-plus"></i> ${t('editor.manage_layers')}
                    </button>
                </div>

                <div class="prop-section">
                    <div class="prop-section-title"><i class="bi bi-geo-alt"></i> ${t('editor.markers')}</div>
                    <div class="editor-quick-actions" style="border-bottom:none;margin-bottom:0;padding-bottom:0">
                        <div class="quick-actions-grid" style="grid-template-columns:1fr 1fr">
                            <button class="quick-action-btn" onclick="StoryEditor._toggleAddMarker()">
                                <i class="bi bi-geo-alt-fill"></i>
                                <span>${t('editor.qa_marker')}</span>
                            </button>
                            <button class="quick-action-btn" onclick="StoryEditor._openLayersModal()">
                                <i class="bi bi-layers-fill"></i>
                                <span>${t('editor.qa_layer')}</span>
                            </button>
                        </div>
                    </div>
                </div>

                <div class="prop-section">
                    <div class="prop-section-title"><i class="bi bi-vr"></i> ${t('editor.compare_maps')}</div>
                    <div class="prop-row">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="prop-compare-enable"
                                ${slide.style_overrides?.compare?.enabled ? 'checked' : ''}>
                            <label class="form-check-label" for="prop-compare-enable">${t('editor.compare_enable')}</label>
                        </div>
                    </div>
                    <div id="compare-basemap-row" class="prop-row" style="${slide.style_overrides?.compare?.enabled ? '' : 'display:none'}">
                        <label>${t('editor.compare_basemap')}</label>
                        <select class="form-select" id="prop-compare-basemap">
                            ${(this._data?.basemaps || []).map((b, i) => `
                                <option value="${b.id}" ${(slide.style_overrides?.compare?.basemap_id == b.id) ? 'selected' : ''}>${b.name}</option>
                            `).join('')}
                        </select>
                    </div>
                </div>

                <div class="prop-section">
                    <div class="prop-section-title"><i class="bi bi-pencil-square"></i> ${t('editor.drawn_features')}</div>
                    <div class="editor-quick-actions" style="border-bottom:none;margin-bottom:0;padding-bottom:0">
                        <div class="quick-actions-grid" style="grid-template-columns:1fr 1fr 1fr">
                            <button class="quick-action-btn" onclick="TmMap.startDrawLine()">
                                <i class="bi bi-bezier2"></i>
                                <span>${t('editor.draw_line')}</span>
                            </button>
                            <button class="quick-action-btn" onclick="TmMap.startDrawPolygon()">
                                <i class="bi bi-pentagon"></i>
                                <span>${t('editor.draw_polygon')}</span>
                            </button>
                            <button class="quick-action-btn" onclick="TmMap.deleteDrawSelected()">
                                <i class="bi bi-eraser"></i>
                                <span>${t('editor.draw_delete')}</span>
                            </button>
                        </div>
                    </div>
                    <div id="drawn-features-list" style="margin-top:8px">
                        ${this._renderDrawnFeaturesHTML(slide)}
                    </div>
                </div>

                <div class="prop-section">
                    <div class="prop-section-title"><i class="bi bi-clock-history"></i> ${t('editor.timeline')}</div>
                    <div class="prop-row">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="prop-timeline-enabled" ${slide.map_config?.timeline?.enabled ? 'checked' : ''}>
                            <label class="form-check-label" for="prop-timeline-enabled">${t('editor.timeline_enable')}</label>
                        </div>
                    </div>
                    <div id="timeline-options" style="${slide.map_config?.timeline?.enabled ? '' : 'display:none'}">
                        <div class="prop-row">
                            <label>${t('editor.timeline_layer')}</label>
                            <select class="form-select" id="prop-timeline-layer">
                                <option value="">--</option>
                                ${(this._layers || []).map(l => `
                                    <option value="${l.layer_id}" ${slide.map_config?.timeline?.layer_id == l.layer_id ? 'selected' : ''}>${App.escHtml(l.layer_name)}</option>
                                `).join('')}
                            </select>
                        </div>
                        <div class="prop-row">
                            <label>${t('editor.timeline_field')}</label>
                            <input type="text" class="form-control" id="prop-timeline-field" value="${slide.map_config?.timeline?.date_field || ''}" placeholder="date, timestamp, year...">
                        </div>
                        <div class="prop-row" style="display:flex;gap:8px">
                            <div style="flex:1">
                                <label>${t('editor.timeline_start')}</label>
                                <input type="text" class="form-control" id="prop-timeline-start" value="${slide.map_config?.timeline?.start || ''}" placeholder="2000">
                            </div>
                            <div style="flex:1">
                                <label>${t('editor.timeline_end')}</label>
                                <input type="text" class="form-control" id="prop-timeline-end" value="${slide.map_config?.timeline?.end || ''}" placeholder="2023">
                            </div>
                        </div>
                        <div class="prop-row">
                            <label>${t('editor.timeline_speed')}</label>
                            <select class="form-select" id="prop-timeline-speed">
                                <option value="slow" ${slide.map_config?.timeline?.speed === 'slow' ? 'selected' : ''}>Slow</option>
                                <option value="medium" ${(slide.map_config?.timeline?.speed || 'medium') === 'medium' ? 'selected' : ''}>Medium</option>
                                <option value="fast" ${slide.map_config?.timeline?.speed === 'fast' ? 'selected' : ''}>Fast</option>
                            </select>
                        </div>
                    </div>
                </div>
                ` : `
                <div style="text-align:center;padding:40px 20px;color:var(--tm-text-muted)">
                    <i class="bi bi-map" style="font-size:36px;display:block;margin-bottom:12px;opacity:0.3"></i>
                    <p style="font-size:13px">${t('editor.map_tab_no_map')}</p>
                    <button class="btn btn-sm btn-outline-primary" onclick="StoryEditor._switchToMapLayout()">
                        <i class="bi bi-map"></i> ${t('editor.switch_to_map')}
                    </button>
                </div>
                `}
            </div><!-- /tab:map -->

            <!-- ═══════════ TAB: MEDIA ═══════════ -->
            <div class="editor-tab-content ${activeTab === 'media' ? 'active' : ''}" data-tab-content="media">
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

                <!-- Key figures (animated counters) -->
                <div class="prop-section">
                    <div class="prop-section-title"><i class="bi bi-123"></i> ${t('editor.stats')}</div>
                    <div id="stats-items-list">
                        ${(slide.style_overrides?.stats?.items || []).map((it, si) => `
                            <div class="stat-item" data-stat-index="${si}" style="border:1px solid var(--tm-border);border-radius:8px;padding:8px;margin-bottom:8px;font-size:12px">
                                <div class="d-flex gap-1 mb-1">
                                    <input type="text" class="form-control form-control-sm stat-prefix" value="${App.escHtml(it.prefix || '')}" placeholder="$" title="${t('editor.stats_prefix')}" style="font-size:11px;max-width:52px">
                                    <input type="text" inputmode="decimal" class="form-control form-control-sm stat-value" value="${App.escHtml(it.value ?? '')}" placeholder="${t('editor.stats_value')}" style="font-size:11px">
                                    <input type="text" class="form-control form-control-sm stat-suffix" value="${App.escHtml(it.suffix || '')}" placeholder="km²" title="${t('editor.stats_suffix')}" style="font-size:11px;max-width:62px">
                                    <input type="number" class="form-control form-control-sm stat-decimals" value="${App.escHtml(it.decimals || 0)}" min="0" max="6" title="${t('editor.stats_decimals')}" style="font-size:11px;max-width:48px">
                                    <button class="btn btn-sm btn-outline-danger" onclick="StoryEditor._removeStat(${si})" title="${t('editor.stats_remove')}" style="padding:0 6px"><i class="bi bi-trash"></i></button>
                                </div>
                                <input type="text" class="form-control form-control-sm stat-label mb-1" value="${App.escHtml(it.label || '')}" placeholder="${t('editor.stats_label')}" style="font-size:11px">
                                <input type="text" class="form-control form-control-sm stat-desc" value="${App.escHtml(it.desc || '')}" placeholder="${t('editor.stats_desc')}" style="font-size:11px">
                            </div>
                        `).join('')}
                    </div>
                    ${(slide.style_overrides?.stats?.items?.length) ? `
                    <div class="d-flex gap-2 mb-1">
                        <div style="flex:1">
                            <label class="form-label" style="font-size:11px">${t('editor.stats_columns')}</label>
                            <select class="form-select form-select-sm" id="prop-stats-columns" style="font-size:11px">
                                ${[1, 2, 3, 4].map(c => `<option value="${c}" ${(slide.style_overrides.stats.columns || 4) == c ? 'selected' : ''}>${c}</option>`).join('')}
                            </select>
                        </div>
                        <div style="flex:1">
                            <label class="form-label" style="font-size:11px">${t('editor.stats_duration')}</label>
                            <input type="number" class="form-control form-control-sm" id="prop-stats-duration" min="0" max="10000" step="100"
                                   value="${App.escHtml(slide.style_overrides.stats.duration ?? 1800)}" style="font-size:11px">
                        </div>
                    </div>
                    ` : `<small class="text-muted">${t('editor.stats_empty')}</small>`}
                    <button class="btn btn-sm btn-outline-light w-100 mt-1" onclick="StoryEditor._addStat()">
                        <i class="bi bi-plus-lg"></i> ${t('editor.stats_add')}
                    </button>
                </div>

                <!-- Before/after image comparison -->
                <div class="prop-section">
                    <div class="prop-section-title"><i class="bi bi-layout-split"></i> ${t('editor.imgcmp')}</div>
                    <div class="prop-row">
                        <label>${t('editor.imgcmp_before')}</label>
                        <div class="input-group">
                            <input type="text" class="form-control" id="prop-imgcmp-before" value="${App.escHtml(slide.style_overrides?.image_compare?.before_url || '')}" placeholder="URL">
                            <button class="btn btn-outline-light" onclick="StoryEditor._pickMedia('prop-imgcmp-before')"><i class="bi bi-folder2-open"></i></button>
                        </div>
                        <input type="text" class="form-control mt-1" id="prop-imgcmp-before-label" value="${App.escHtml(slide.style_overrides?.image_compare?.before_label || '')}" placeholder="${t('editor.imgcmp_before_label')}">
                    </div>
                    <div class="prop-row">
                        <label>${t('editor.imgcmp_after')}</label>
                        <div class="input-group">
                            <input type="text" class="form-control" id="prop-imgcmp-after" value="${App.escHtml(slide.style_overrides?.image_compare?.after_url || '')}" placeholder="URL">
                            <button class="btn btn-outline-light" onclick="StoryEditor._pickMedia('prop-imgcmp-after')"><i class="bi bi-folder2-open"></i></button>
                        </div>
                        <input type="text" class="form-control mt-1" id="prop-imgcmp-after-label" value="${App.escHtml(slide.style_overrides?.image_compare?.after_label || '')}" placeholder="${t('editor.imgcmp_after_label')}">
                    </div>
                    <div class="prop-row">
                        <label>${t('editor.imgcmp_aspect')}</label>
                        <select class="form-select" id="prop-imgcmp-aspect">
                            ${['16/9', '4/3', '3/2', '1/1', '21/9'].map(a =>
                                `<option value="${a}" ${(slide.style_overrides?.image_compare?.aspect || '16/9') === a ? 'selected' : ''}>${a}</option>`
                            ).join('')}
                        </select>
                    </div>
                    <div class="prop-row">
                        <label>${t('editor.imgcmp_start')}</label>
                        <input type="range" class="form-range" id="prop-imgcmp-start" min="0" max="100" step="1"
                               value="${App.escHtml(slide.style_overrides?.image_compare?.start ?? 50)}">
                    </div>
                    <small class="text-muted"><i class="bi bi-info-circle"></i> ${t('editor.imgcmp_hint')}</small>
                </div>

                <!-- TimelineJS -->
                <div class="prop-section">
                    <div class="prop-section-title"><i class="bi bi-clock-history"></i> ${t('editor.timelinejs')}</div>
                    <div id="timelinejs-events-list">
                        ${(slide.style_overrides?.timelinejs?.events || []).map((evt, ei) => `
                            <div class="timelinejs-event-item" data-event-index="${ei}" style="border:1px solid var(--tm-border);border-radius:8px;padding:8px;margin-bottom:8px;font-size:12px">
                                <div class="d-flex gap-2 mb-1">
                                    <input type="date" class="form-control form-control-sm tljs-date" value="${evt.date || ''}" placeholder="${t('editor.timelinejs_date')}" style="font-size:11px">
                                    <button class="btn btn-sm btn-outline-danger" onclick="StoryEditor._removeTimelineJSEvent(${ei})" title="${t('editor.timelinejs_remove_event')}" style="padding:0 6px"><i class="bi bi-trash"></i></button>
                                </div>
                                <input type="text" class="form-control form-control-sm tljs-title mb-1" value="${App.escHtml(evt.title || '')}" placeholder="${t('editor.timelinejs_title')}" style="font-size:11px">
                                <textarea class="form-control form-control-sm tljs-text mb-1" rows="2" placeholder="${t('editor.timelinejs_text')}" style="font-size:11px">${App.escHtml(evt.text || '')}</textarea>
                                <input type="text" class="form-control form-control-sm tljs-media mb-1" value="${App.escHtml(evt.media_url || '')}" placeholder="${t('editor.timelinejs_media')}" style="font-size:11px">
                                <div class="d-flex gap-2">
                                    <input type="number" class="form-control form-control-sm tljs-lat" value="${evt.location?.lat || ''}" placeholder="${t('editor.timelinejs_lat')}" step="any" style="font-size:11px">
                                    <input type="number" class="form-control form-control-sm tljs-lng" value="${evt.location?.lng || ''}" placeholder="${t('editor.timelinejs_lng')}" step="any" style="font-size:11px">
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    ${!(slide.style_overrides?.timelinejs?.events?.length) ? `<small class="text-muted">${t('editor.timelinejs_empty')}</small>` : ''}
                    <button class="btn btn-sm btn-outline-light w-100 mt-1" onclick="StoryEditor._addTimelineJSEvent()">
                        <i class="bi bi-plus-lg"></i> ${t('editor.timelinejs_add_event')}
                    </button>
                </div>

                <!-- Point Cloud (Potree) -->
                <div class="prop-section">
                    <div class="prop-section-title"><i class="bi bi-cloud-fill"></i> ${t('editor.potree_title')}</div>
                    <div class="prop-row">
                        <label>${t('editor.potree_url')}</label>
                        <input type="text" class="form-control" id="prop-potree-url"
                               value="${slide.style_overrides?.potree?.url || ''}"
                               placeholder="https://example.com/pointcloud/metadata.json">
                    </div>
                    ${slide.style_overrides?.potree?.url ? `
                    <div class="prop-row">
                        <label>${t('editor.potree_color_mode')}</label>
                        <select class="form-select" id="prop-potree-color">
                            ${['rgb', 'height', 'intensity', 'classification'].map(m => `
                                <option value="${m}" ${(slide.style_overrides?.potree?.colorMode || 'rgb') === m ? 'selected' : ''}>${t('editor.potree_color_' + m)}</option>
                            `).join('')}
                        </select>
                    </div>
                    <div class="prop-row">
                        <label>${t('editor.potree_point_size')} (${slide.style_overrides?.potree?.pointSize || 1})</label>
                        <input type="range" class="form-range" id="prop-potree-size" min="0.5" max="5" step="0.5"
                               value="${slide.style_overrides?.potree?.pointSize || 1}">
                    </div>
                    <div class="prop-row">
                        <label>${t('editor.potree_height')}</label>
                        <input type="number" class="form-control" id="prop-potree-height" min="200" max="800" step="50"
                               value="${slide.style_overrides?.potree?.height || 400}" style="width:100px">
                    </div>
                    ` : `
                    <small class="text-muted"><i class="bi bi-info-circle"></i> ${t('editor.potree_hint')}</small>
                    `}
                </div>

                <!-- 3D Model (Cesium 3D Tiles) -->
                <div class="prop-section">
                    <div class="prop-section-title"><i class="bi bi-badge-3d"></i> ${t('editor.tileset_title')}</div>
                    <small class="text-muted d-block mb-2"><i class="bi bi-info-circle"></i> ${t('editor.tileset_desc')}</small>
                    <div class="prop-row">
                        <label>${t('editor.tileset_url')}</label>
                        <input type="text" class="form-control" id="prop-tileset-url"
                               value="${slide.style_overrides?.tileset3d?.url || ''}"
                               placeholder="https://example.com/tileset.json">
                    </div>
                    <div class="prop-row">
                        <label>${t('editor.tileset_ion')}</label>
                        <input type="text" class="form-control" id="prop-tileset-ion"
                               value="${slide.style_overrides?.tileset3d?.ionAssetId || ''}"
                               placeholder="Asset ID (es. 96188)">
                    </div>
                    <small class="text-muted"><i class="bi bi-info-circle"></i> ${t('editor.tileset_hint')}</small>
                </div>

                <!-- 3D Upload -->
                <div class="prop-section">
                    <div class="prop-section-title"><i class="bi bi-cloud-upload"></i> ${t('editor.upload3d_title')}</div>
                    <small class="text-muted d-block mb-2">${t('editor.upload3d_desc')}</small>
                    <div class="upload3d-dropzone" id="upload3d-dropzone" style="border:2px dashed var(--tm-border);border-radius:8px;padding:20px;text-align:center;cursor:pointer;transition:border-color 0.2s">
                        <i class="bi bi-cloud-arrow-up" style="font-size:28px;color:var(--tm-text-muted);display:block;margin-bottom:8px"></i>
                        <div style="font-size:13px;color:var(--tm-text-muted)">${t('editor.upload3d_btn')}</div>
                        <div style="font-size:11px;color:var(--tm-text-muted);margin-top:4px">${t('editor.upload3d_max')}</div>
                        <input type="file" id="upload3d-input" style="display:none"
                            accept=".las,.laz,.ply,.xyz,.pts,.glb,.gltf,.obj,.fbx,.ifc,.3ds,.dae,.zip,.tif,.tiff,.kml,.kmz">
                    </div>
                    <div id="upload3d-progress" style="display:none;margin-top:8px">
                        <div class="progress" style="height:6px">
                            <div class="progress-bar progress-bar-striped progress-bar-animated" id="upload3d-bar" style="width:0%"></div>
                        </div>
                        <small class="text-muted" id="upload3d-status">${t('editor.upload3d_uploading')}</small>
                    </div>
                    <small class="text-muted d-block mt-2"><i class="bi bi-info-circle"></i> ${t('editor.upload3d_formats')}</small>
                </div>

                <!-- My 3D Assets -->
                <div class="prop-section">
                    <div class="prop-section-title"><i class="bi bi-box"></i> ${t('editor.my3d_title')}</div>
                    <div id="my3d-assets-list" style="max-height:250px;overflow-y:auto">
                        <div style="text-align:center;padding:10px;color:var(--tm-text-muted)">
                            <i class="bi bi-hourglass-split"></i> ${t('loading')}
                        </div>
                    </div>
                    <div id="my3d-quota" style="margin-top:8px"></div>
                </div>

                <!-- Cesium Ion -->
                <div class="prop-section">
                    <div class="prop-section-title"><i class="bi bi-globe2"></i> ${t('editor.cesium_ion_title')}</div>
                    <small class="text-muted d-block mb-2">${t('editor.cesium_ion_desc')}</small>
                    <a href="https://cesium.com/learn/ion/" target="_blank" rel="noopener" class="btn btn-sm btn-outline-info">
                        <i class="bi bi-box-arrow-up-right"></i> ${t('editor.cesium_ion_link')}
                    </a>
                </div>
                ` : ''}
            </div><!-- /tab:media -->
        `;

        // ── Tab switching ──
        this._initPropsTabs();

        body.querySelectorAll('.layout-option').forEach(opt => {
            opt.addEventListener('click', () => {
                this._undoPush();
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

        // Undo snapshot on title/narrative blur (not on every keystroke)
        document.getElementById('prop-title')?.addEventListener('focus', () => this._undoPush());
        document.getElementById('prop-narrative')?.addEventListener('focus', () => this._undoPush());

        // Image Map apply
        document.getElementById('btn-apply-image-map')?.addEventListener('click', () => {
            const slide = this._slides[this._currentSlideIdx];
            if (!slide) return;
            const url = document.getElementById('prop-image-map-url')?.value?.trim();
            if (!url) { App.toast(I18n.t('editor.image_map_url_required') || 'URL required', 'warning'); return; }
            slide.map_config = { ...(slide.map_config || {}), image_url: url };
            // Set the image as basemap using MapLibre image source
            this._applyImageMap(url);
            App.toast(I18n.t('editor.autosaved'), 'success');
        });

        // Custom CSS save
        document.getElementById('btn-save-custom-css')?.addEventListener('click', async () => {
            const css = document.getElementById('prop-custom-css')?.value || '';
            this._story.settings = { ...(this._story.settings || {}), custom_css: css };
            try {
                await Api.updateStory(this._storyId, { settings: this._story.settings });
                App.toast(I18n.t('editor.autosaved'), 'success');
            } catch (err) { App.toast(err.message, 'danger'); }
        });

        // Participatory Maps toggle
        document.getElementById('participatory-enabled')?.addEventListener('change', async (e) => {
            const enabled = e.target.checked;
            this._story.settings = { ...(this._story.settings || {}), participatory_enabled: enabled };
            const optDiv = document.getElementById('participatory-options');
            if (optDiv) optDiv.style.display = enabled ? 'block' : 'none';
            try {
                await Api.updateStory(this._storyId, { settings: this._story.settings });
                App.toast(I18n.t('editor.autosaved'), 'success');
            } catch (err) { App.toast(err.message, 'danger'); }
        });

        // Participatory Maps categories
        document.getElementById('participatory-categories')?.addEventListener('blur', async (e) => {
            const raw = e.target.value || '';
            const categories = raw.split(',').map(s => s.trim()).filter(Boolean);
            this._story.settings = { ...(this._story.settings || {}), participatory_categories: categories };
            try {
                await Api.updateStory(this._storyId, { settings: this._story.settings });
                App.toast(I18n.t('editor.autosaved'), 'success');
            } catch (err) { App.toast(err.message, 'danger'); }
        });

        // Navigation Mode
        document.getElementById('prop-nav-mode')?.addEventListener('change', async (e) => {
            const mode = e.target.value;
            this._story.settings = { ...(this._story.settings || {}), navigation_mode: mode };
            try {
                await Api.updateStory(this._storyId, { settings: this._story.settings });
                App.toast(I18n.t('editor.autosaved'), 'success');
            } catch (err) { App.toast(err.message, 'danger'); }
        });

        // Per-slide basemap selector
        const slideBasemapEl = document.getElementById('prop-slide-basemap');
        if (slideBasemapEl) {
            slideBasemapEl.addEventListener('change', () => {
                const s = this._slides[this._currentSlideIdx];
                if (!s) return;
                const val = slideBasemapEl.value;
                s.basemap_id = val === 'none' ? 'none' : (val ? parseInt(val) : null);
                // Apply basemap change in editor preview
                if (val === 'none') {
                    TmMap.setBasemap(null, true); // no background
                } else if (val) {
                    const basemap = (this._data?.basemaps || []).find(b => b.id == val);
                    if (basemap) TmMap.setBasemap(basemap);
                } else {
                    // Reset to default (first basemap)
                    const defaultBm = (this._data?.basemaps || [])[0] || null;
                    TmMap.setBasemap(defaultBm);
                }
            });
        }

        // Compare maps toggle
        const compareEnableEl = document.getElementById('prop-compare-enable');
        if (compareEnableEl) {
            compareEnableEl.addEventListener('change', () => {
                const s = this._slides[this._currentSlideIdx];
                if (!s) return;
                const enabled = compareEnableEl.checked;
                const compareRow = document.getElementById('compare-basemap-row');
                if (compareRow) compareRow.style.display = enabled ? '' : 'none';
                const basemapSelect = document.getElementById('prop-compare-basemap');
                const basemap_id = basemapSelect ? parseInt(basemapSelect.value) : null;
                s.style_overrides = {
                    ...(s.style_overrides || {}),
                    compare: enabled ? { enabled: true, basemap_id, mode: 'swipe' } : { enabled: false },
                };
            });
        }
        const compareBasemapEl = document.getElementById('prop-compare-basemap');
        if (compareBasemapEl) {
            compareBasemapEl.addEventListener('change', () => {
                const s = this._slides[this._currentSlideIdx];
                if (!s) return;
                s.style_overrides = {
                    ...(s.style_overrides || {}),
                    compare: { ...(s.style_overrides?.compare || {}), basemap_id: parseInt(compareBasemapEl.value) },
                };
            });
        }

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

        // Potree URL change -> re-render to show config options
        const potreeUrlInput = document.getElementById('prop-potree-url');
        if (potreeUrlInput) {
            potreeUrlInput.addEventListener('change', () => {
                const s = this._slides[this._currentSlideIdx];
                if (s) {
                    s.style_overrides = {
                        ...(s.style_overrides || {}),
                        potree: potreeUrlInput.value ? { url: potreeUrlInput.value, colorMode: 'rgb', pointSize: 1, height: 400 } : null,
                    };
                    this._renderProps(s);
                }
            });
        }

        // Timeline toggle
        const timelineToggle = document.getElementById('prop-timeline-enabled');
        if (timelineToggle) {
            timelineToggle.addEventListener('change', () => {
                const opts = document.getElementById('timeline-options');
                if (opts) opts.style.display = timelineToggle.checked ? '' : 'none';
            });
        }

        // 3D Upload dropzone
        this._init3DUpload();
        // Load 3D assets list
        this._load3DAssets();

        // ── Gallery inline caption editing ──
        document.querySelectorAll('.gallery-caption-inline').forEach(input => {
            input.addEventListener('change', () => {
                const idx = parseInt(input.dataset.galleryIndex);
                const s = this._slides[this._currentSlideIdx];
                if (!s || !s.style_overrides?.gallery?.images?.[idx]) return;
                this._undoPush();
                s.style_overrides.gallery.images[idx].caption = input.value;
                Api.updateSlide(s.id, { style_overrides: s.style_overrides }).catch(err => App.toast(err.message, 'danger'));
            });
        });

        // ── Drag & Drop + Paste embed on narrative ──
        this._setupNarrativeDragDrop();
    },

    /**
     * Set up drag-and-drop media upload and paste-embed detection on #prop-narrative.
     * Called from _renderProps() after binding other events.
     */
    _setupNarrativeDragDrop() {
        const narrativeDnd = document.getElementById('prop-narrative');
        if (!narrativeDnd) return;

        // ── Drag & Drop media into narrative ──
        narrativeDnd.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            narrativeDnd.classList.add('drag-over');
        });
        narrativeDnd.addEventListener('dragenter', (e) => {
            e.preventDefault();
            narrativeDnd.classList.add('drag-over');
        });
        narrativeDnd.addEventListener('dragleave', (e) => {
            if (!narrativeDnd.contains(e.relatedTarget)) {
                narrativeDnd.classList.remove('drag-over');
            }
        });
        narrativeDnd.addEventListener('drop', async (e) => {
            e.preventDefault();
            narrativeDnd.classList.remove('drag-over');
            const files = Array.from(e.dataTransfer.files);
            if (!files.length) return;

            this._undoPush();

            let range;
            if (document.caretRangeFromPoint) {
                range = document.caretRangeFromPoint(e.clientX, e.clientY);
            } else if (document.caretPositionFromPoint) {
                const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
                range = document.createRange();
                range.setStart(pos.offsetNode, pos.offset);
                range.collapse(true);
            }

            for (const file of files) {
                const isImage = file.type.startsWith('image/');
                const isVideo = file.type.startsWith('video/');
                if (!isImage && !isVideo) continue;

                try {
                    App.toast(I18n.t('editor.narrative_drop_uploading'), 'info');
                    const result = await Api.uploadMedia(file, this._storyId);
                    let html;
                    if (isImage) {
                        html = `<img src="${result.url}" alt="${App.escHtml(file.name)}" style="max-width:100%;border-radius:8px;margin:12px 0">`;
                    } else {
                        html = `<video src="${result.url}" controls style="max-width:100%;border-radius:8px;margin:12px 0"></video>`;
                    }
                    if (range) {
                        const sel = window.getSelection();
                        sel.removeAllRanges();
                        sel.addRange(range);
                        document.execCommand('insertHTML', false, html);
                        range = sel.getRangeAt(0);
                    } else {
                        narrativeDnd.insertAdjacentHTML('beforeend', html);
                    }
                    App.toast(I18n.t('media.uploaded'), 'success');
                } catch (err) {
                    App.toast(err.message, 'danger');
                }
            }
        });

        // ── Paste embed detection (YouTube/Vimeo/SoundCloud) ──
        narrativeDnd.addEventListener('paste', (e) => {
            const text = (e.clipboardData || window.clipboardData).getData('text/plain').trim();
            if (!text) return;

            let embedHtml = null;

            // YouTube: youtube.com/watch?v=ID or youtu.be/ID
            const ytMatch = text.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w\-]+)/);
            if (ytMatch) {
                embedHtml = `<div class="slide-iframe-container"><iframe src="https://www.youtube.com/embed/${ytMatch[1]}" width="100%" height="315" frameborder="0" allowfullscreen style="border-radius:8px;margin:12px 0"></iframe></div>`;
            }

            // Vimeo: vimeo.com/ID
            if (!embedHtml) {
                const vimeoMatch = text.match(/vimeo\.com\/(\d+)/);
                if (vimeoMatch) {
                    embedHtml = `<div class="slide-iframe-container"><iframe src="https://player.vimeo.com/video/${vimeoMatch[1]}" width="100%" height="315" frameborder="0" allowfullscreen style="border-radius:8px;margin:12px 0"></iframe></div>`;
                }
            }

            // SoundCloud: soundcloud.com/artist/track
            if (!embedHtml) {
                const scMatch = text.match(/soundcloud\.com\/[\w\-]+\/[\w\-]+/);
                if (scMatch) {
                    const encodedUrl = encodeURIComponent(text);
                    embedHtml = `<div class="slide-iframe-container"><iframe width="100%" height="166" scrolling="no" frameborder="no" src="https://w.soundcloud.com/player/?url=${encodedUrl}&color=%23ff5500&auto_play=false&hide_related=false&show_comments=true&show_user=true&show_reposts=false" style="border-radius:8px;margin:12px 0"></iframe></div>`;
                }
            }

            if (embedHtml) {
                e.preventDefault();
                document.execCommand('insertHTML', false, embedHtml);
                App.toast(I18n.t('editor.embed_detected'), 'success');
            }
        });
    },

    // ── Audio Upload/Remove ─────────────
    _uploadAudio() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'audio/mp3,audio/wav,audio/ogg,audio/mpeg,.mp3,.wav,.ogg';
        input.onchange = async () => {
            const file = input.files[0];
            if (!file) return;
            try {
                App.toast(I18n.t('loading'), 'info');
                const result = await Api.uploadMedia(file, this._storyId);
                const slide = this._slides[this._currentSlideIdx];
                if (slide) {
                    slide.audio_url = result.url;
                    slide.audio_autoplay = true;
                    await Api.updateSlide(slide.id, { audio_url: result.url, audio_autoplay: true });
                    this._renderProps(slide);
                    App.toast(I18n.t('media.uploaded'), 'success');
                }
            } catch (err) { App.toast(err.message, 'danger'); }
        };
        input.click();
    },

    async _removeAudio() {
        const slide = this._slides[this._currentSlideIdx];
        if (!slide) return;
        slide.audio_url = null;
        slide.audio_autoplay = false;
        try {
            await Api.updateSlide(slide.id, { audio_url: null, audio_autoplay: false });
            this._renderProps(slide);
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    // ── Gallery ──────────────────────────
    _openGalleryPicker() {
        const slide = this._slides[this._currentSlideIdx];
        if (!slide) return;
        const t = I18n.t.bind(I18n);

        const gallery = slide.style_overrides?.gallery || { images: [], autoplay: false, showThumbs: true };
        const existingImages = gallery.images || [];

        // Build modal
        const modalHtml = `
            <div class="modal fade" id="gallery-picker-modal" tabindex="-1">
                <div class="modal-dialog modal-lg modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">${t('editor.gallery')}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="mb-3">
                                <label class="form-label">${t('editor.gallery_images')}</label>
                                <div id="gallery-picker-list" style="display:flex;flex-wrap:wrap;gap:8px;min-height:80px;padding:12px;border:1px dashed var(--tm-border);border-radius:8px">
                                    ${existingImages.map((img, i) => `
                                        <div class="gallery-picker-item" data-index="${i}" style="position:relative;width:80px;height:80px;border-radius:6px;overflow:hidden;border:2px solid var(--tm-border)">
                                            <img src="${App.escHtml(img.url)}" style="width:100%;height:100%;object-fit:cover">
                                            <button class="btn btn-sm" style="position:absolute;top:0;right:0;background:rgba(220,38,38,0.8);color:white;border:none;padding:0 4px;font-size:11px;line-height:1.6"
                                                    onclick="this.closest('.gallery-picker-item').remove()">
                                                <i class="bi bi-x"></i>
                                            </button>
                                            <input type="hidden" class="gallery-img-url" value="${App.escHtml(img.url)}">
                                            <input type="hidden" class="gallery-img-caption" value="${App.escHtml(img.caption || '')}">
                                        </div>
                                    `).join('')}
                                    ${existingImages.length === 0 ? `<span class="text-muted" style="font-size:13px" id="gallery-empty-hint">${t('editor.gallery_empty')}</span>` : ''}
                                </div>
                            </div>
                            <div class="mb-3">
                                <button class="btn btn-sm btn-outline-primary me-2" id="gallery-upload-btn">
                                    <i class="bi bi-upload"></i> Upload
                                </button>
                                <button class="btn btn-sm btn-outline-secondary" id="gallery-media-btn">
                                    <i class="bi bi-folder2-open"></i> Media Library
                                </button>
                            </div>
                            <div id="gallery-caption-editor" class="mb-3" style="display:none">
                                <label class="form-label">${t('editor.gallery_caption')}</label>
                                <input type="text" class="form-control" id="gallery-caption-input" placeholder="${t('editor.gallery_caption')}">
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">${t('cancel')}</button>
                            <button type="button" class="btn btn-primary" id="gallery-save-btn">${t('save')}</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Remove any existing modal
        document.getElementById('gallery-picker-modal')?.remove();
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modalEl = document.getElementById('gallery-picker-modal');
        const modal = new bootstrap.Modal(modalEl);

        // Upload button
        document.getElementById('gallery-upload-btn').addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.multiple = true;
            input.onchange = async () => {
                const files = Array.from(input.files);
                for (const file of files) {
                    try {
                        const result = await Api.uploadMedia(file, this._storyId);
                        this._addGalleryItemToList(result.url, '');
                    } catch (err) { App.toast(err.message, 'danger'); }
                }
            };
            input.click();
        });

        // Media library button
        document.getElementById('gallery-media-btn').addEventListener('click', async () => {
            try {
                const media = await Api.getMedia(this._storyId);
                const images = media.filter(m => m.content_type?.startsWith('image/'));
                if (images.length === 0) {
                    App.toast(t('editor.gallery_empty'), 'warning');
                    return;
                }
                // Show simple media picker within modal body
                let pickerHtml = '<div style="display:flex;flex-wrap:wrap;gap:6px;max-height:250px;overflow-y:auto;padding:8px;border:1px solid var(--tm-border);border-radius:6px;margin-top:8px" id="gallery-media-grid">';
                images.forEach(m => {
                    pickerHtml += `<div class="gallery-media-option" data-url="${App.escHtml(m.url)}" style="width:72px;height:72px;border-radius:6px;overflow:hidden;cursor:pointer;border:2px solid transparent;transition:border-color 0.2s">
                        <img src="${App.escHtml(m.url)}" style="width:100%;height:100%;object-fit:cover">
                    </div>`;
                });
                pickerHtml += '</div>';
                pickerHtml += '<button class="btn btn-sm btn-primary mt-2" id="gallery-media-confirm">OK</button>';

                const captionEditor = document.getElementById('gallery-caption-editor');
                // Remove any existing media grid
                document.getElementById('gallery-media-grid')?.parentElement?.querySelectorAll('#gallery-media-grid, #gallery-media-confirm').forEach(el => el.remove());
                captionEditor.insertAdjacentHTML('beforebegin', pickerHtml);

                // Selection logic
                document.querySelectorAll('.gallery-media-option').forEach(opt => {
                    opt.addEventListener('click', () => {
                        opt.style.borderColor = opt.style.borderColor === 'rgb(79, 109, 245)' ? 'transparent' : '#4f6df5';
                        opt.classList.toggle('selected');
                    });
                });

                document.getElementById('gallery-media-confirm').addEventListener('click', () => {
                    document.querySelectorAll('.gallery-media-option.selected').forEach(opt => {
                        this._addGalleryItemToList(opt.dataset.url, '');
                    });
                    document.getElementById('gallery-media-grid')?.remove();
                    document.getElementById('gallery-media-confirm')?.remove();
                });
            } catch (err) { App.toast(err.message, 'danger'); }
        });

        // Save button
        document.getElementById('gallery-save-btn').addEventListener('click', async () => {
            const items = document.querySelectorAll('#gallery-picker-list .gallery-picker-item');
            const images = Array.from(items).map(item => ({
                url: item.querySelector('.gallery-img-url').value,
                caption: item.querySelector('.gallery-img-caption').value || '',
            }));

            slide.style_overrides = {
                ...(slide.style_overrides || {}),
                gallery: {
                    images,
                    autoplay: slide.style_overrides?.gallery?.autoplay || false,
                    showThumbs: slide.style_overrides?.gallery?.showThumbs !== false,
                },
            };

            try {
                await Api.updateSlide(slide.id, { style_overrides: slide.style_overrides });
                this._renderProps(slide);
                App.toast(I18n.t('saved'), 'success');
            } catch (err) { App.toast(err.message, 'danger'); }

            modal.hide();
        });

        modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove());
        modal.show();

        // Make the list sortable
        if (typeof Sortable !== 'undefined') {
            new Sortable(document.getElementById('gallery-picker-list'), {
                animation: 150,
                ghostClass: 'sortable-ghost',
            });
        }
    },

    _addGalleryItemToList(url, caption) {
        const list = document.getElementById('gallery-picker-list');
        if (!list) return;
        // Remove empty hint
        document.getElementById('gallery-empty-hint')?.remove();
        const idx = list.querySelectorAll('.gallery-picker-item').length;
        const html = `
            <div class="gallery-picker-item" data-index="${idx}" style="position:relative;width:80px;height:80px;border-radius:6px;overflow:hidden;border:2px solid var(--tm-border)">
                <img src="${App.escHtml(url)}" style="width:100%;height:100%;object-fit:cover">
                <button class="btn btn-sm" style="position:absolute;top:0;right:0;background:rgba(220,38,38,0.8);color:white;border:none;padding:0 4px;font-size:11px;line-height:1.6"
                        onclick="this.closest('.gallery-picker-item').remove()">
                    <i class="bi bi-x"></i>
                </button>
                <input type="hidden" class="gallery-img-url" value="${App.escHtml(url)}">
                <input type="hidden" class="gallery-img-caption" value="${App.escHtml(caption || '')}">
            </div>
        `;
        list.insertAdjacentHTML('beforeend', html);
    },

    async _removeGalleryImage(index) {
        const slide = this._slides[this._currentSlideIdx];
        if (!slide || !slide.style_overrides?.gallery?.images) return;
        slide.style_overrides.gallery.images.splice(index, 1);
        if (slide.style_overrides.gallery.images.length === 0) {
            delete slide.style_overrides.gallery;
        }
        try {
            await Api.updateSlide(slide.id, { style_overrides: slide.style_overrides });
            this._renderProps(slide);
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    async _updateGalleryOption(key, value) {
        const slide = this._slides[this._currentSlideIdx];
        if (!slide || !slide.style_overrides?.gallery) return;
        slide.style_overrides.gallery[key] = value;
        try {
            await Api.updateSlide(slide.id, { style_overrides: slide.style_overrides });
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    // ── Actions ──────────────────────────
    _captureMapState() {
        const state = TmMap.getState();
        const slide = this._slides[this._currentSlideIdx];
        if (!slide) return;
        this._undoPush();
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

        // Potree config
        const potreeUrlEl = document.getElementById('prop-potree-url');
        let potreeConfig = slide.style_overrides?.potree || null;
        if (potreeUrlEl?.value) {
            potreeConfig = {
                url: potreeUrlEl.value,
                colorMode: document.getElementById('prop-potree-color')?.value || 'rgb',
                pointSize: parseFloat(document.getElementById('prop-potree-size')?.value || 1),
                height: parseInt(document.getElementById('prop-potree-height')?.value || 400),
            };
        } else {
            potreeConfig = null;
        }

        // Tileset 3D config
        const tilesetUrlEl = document.getElementById('prop-tileset-url');
        const tilesetIonEl = document.getElementById('prop-tileset-ion');
        let tilesetConfig = slide.style_overrides?.tileset3d || null;
        if (tilesetUrlEl?.value || tilesetIonEl?.value) {
            tilesetConfig = {
                ...(tilesetUrlEl?.value ? { url: tilesetUrlEl.value } : {}),
                ...(tilesetIonEl?.value ? { ionAssetId: parseInt(tilesetIonEl.value) } : {}),
            };
        } else {
            tilesetConfig = null;
        }

        // Transition
        const transitionEl = document.getElementById('prop-transition');
        const transitionVal = transitionEl?.value || 'fade';

        // Chapter
        const chapterEl = document.getElementById('prop-chapter');
        const chapterVal = chapterEl?.value?.trim() || null;

        // TimelineJS events collection
        const tljsItems = document.querySelectorAll('.timelinejs-event-item');
        let tljsConfig = slide.style_overrides?.timelinejs || null;
        if (tljsItems.length > 0) {
            const tljsEvents = [];
            tljsItems.forEach(item => {
                const date = item.querySelector('.tljs-date')?.value || '';
                const title = item.querySelector('.tljs-title')?.value || '';
                const text = item.querySelector('.tljs-text')?.value || '';
                const media_url = item.querySelector('.tljs-media')?.value || '';
                const lat = parseFloat(item.querySelector('.tljs-lat')?.value);
                const lng = parseFloat(item.querySelector('.tljs-lng')?.value);
                const evt = { date, title, text, media_url };
                if (!isNaN(lat) && !isNaN(lng)) evt.location = { lat, lng };
                tljsEvents.push(evt);
            });
            tljsConfig = { events: tljsEvents, options: tljsConfig?.options || {} };
        }

        // Key figures collection
        const statItems = document.querySelectorAll('.stat-item');
        let statsConfig = slide.style_overrides?.stats || null;
        if (statItems.length > 0) {
            const items = [];
            statItems.forEach(item => {
                // Keep the text when it is not entirely a number: the viewer shows such a
                // value verbatim (a pre-formatted "1.2M"), and coercing it here to 0 would
                // silently destroy the author's figure on the next save.
                const rawValue = (item.querySelector('.stat-value')?.value ?? '').trim();
                const parsed = rawValue === '' ? NaN : Number(rawValue);
                items.push({
                    value: isFinite(parsed) ? parsed : rawValue,
                    prefix: item.querySelector('.stat-prefix')?.value || '',
                    suffix: item.querySelector('.stat-suffix')?.value || '',
                    decimals: parseInt(item.querySelector('.stat-decimals')?.value) || 0,
                    label: item.querySelector('.stat-label')?.value || '',
                    desc: item.querySelector('.stat-desc')?.value || '',
                });
            });
            const rawDur = parseInt(document.getElementById('prop-stats-duration')?.value);
            statsConfig = {
                items,
                columns: parseInt(document.getElementById('prop-stats-columns')?.value) || 4,
                duration: isFinite(rawDur) ? Math.max(0, rawDur) : 1800,
            };
        }

        // Before/after image comparison
        const imgcmpBeforeEl = document.getElementById('prop-imgcmp-before');
        let imgCompareConfig = slide.style_overrides?.image_compare || null;
        if (imgcmpBeforeEl) {
            const beforeUrl = imgcmpBeforeEl.value.trim();
            const afterUrl = document.getElementById('prop-imgcmp-after')?.value.trim() || '';
            if (beforeUrl && afterUrl) {
                const rawStart = parseInt(document.getElementById('prop-imgcmp-start')?.value);
                imgCompareConfig = {
                    before_url: beforeUrl,
                    after_url: afterUrl,
                    before_label: document.getElementById('prop-imgcmp-before-label')?.value || '',
                    after_label: document.getElementById('prop-imgcmp-after-label')?.value || '',
                    aspect: document.getElementById('prop-imgcmp-aspect')?.value || '16/9',
                    start: isFinite(rawStart) ? Math.max(0, Math.min(100, rawStart)) : 50,
                };
            } else {
                imgCompareConfig = null;
            }
        }

        updates.style_overrides = {
            ...(slide.style_overrides || {}),
            ...(updates.style_overrides || {}),
            ...(cardStyleEl ? { card_style: cardStyleEl.dataset.style } : {}),
            ...(textAlignEl ? { text_align: textAlignEl.dataset.align } : {}),
            ...(drawnFeatures?.features?.length ? { drawn_features: drawnFeatures } : {}),
            potree: potreeConfig,
            tileset3d: tilesetConfig,
            transition: transitionVal,
            chapter: chapterVal,
            timelinejs: tljsConfig,
            stats: statsConfig,
            image_compare: imgCompareConfig,
        };

        // Timeline config
        const timelineEnabled = document.getElementById('prop-timeline-enabled');
        if (timelineEnabled) {
            const timeline = {
                enabled: timelineEnabled.checked,
                layer_id: document.getElementById('prop-timeline-layer')?.value || '',
                date_field: document.getElementById('prop-timeline-field')?.value || '',
                start: document.getElementById('prop-timeline-start')?.value || '',
                end: document.getElementById('prop-timeline-end')?.value || '',
                speed: document.getElementById('prop-timeline-speed')?.value || 'medium',
            };
            updates.map_config = { ...(slide.map_config || {}), timeline };
        }

        // Per-slide basemap
        const basemapEl = document.getElementById('prop-slide-basemap');
        if (basemapEl) {
            const bmVal = basemapEl.value ? parseInt(basemapEl.value) : null;
            if (bmVal !== slide.basemap_id) {
                updates.basemap_id = bmVal;
                slide.basemap_id = bmVal;
            }
        }

        // Audio config
        const audioUrlEl = document.getElementById('prop-audio-url');
        if (audioUrlEl) {
            updates.audio_url = audioUrlEl.value || null;
            const autoplayEl = document.getElementById('prop-audio-autoplay');
            updates.audio_autoplay = autoplayEl ? autoplayEl.checked : false;
        }

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
            { layout: 'globe-3d', icon: 'bi-globe-americas', key: 'globe3d', color: '#0ea5e9' },
            { layout: 'potree-3d', icon: 'bi-cloud-fill', key: 'potree3d', color: '#6366f1' },
            { layout: 'image-map', icon: 'bi-image', key: 'imagemap', color: '#14b8a6' },
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
            this._undoPush();
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
        this._undoPush();
        const slide = this._slides[idx];
        try {
            await Api.deleteSlide(slide.id);
            this._slides.splice(idx, 1);
            this._renderSlidesList();
            this._selectSlide(Math.min(idx, this._slides.length - 1));
            App.toast(I18n.t('editor.slide_deleted'), 'success');
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    async _duplicateSlide(idx) {
        const source = this._slides[idx];
        if (!source) return;
        this._undoPush();
        try {
            const result = await Api.createSlide({
                story_id: this._storyId,
                title: (source.title || '') + ' (copia)',
                layout: source.layout,
            });
            const newSlide = await Api.getSlide(result.id);
            // Copy all properties from the source slide
            const copyFields = {
                narrative: source.narrative,
                map_center: source.map_center,
                map_zoom: source.map_zoom,
                map_bearing: source.map_bearing,
                map_pitch: source.map_pitch,
                map_animation: source.map_animation,
                background_media: source.background_media,
                background_opacity: source.background_opacity,
                style_overrides: source.style_overrides ? JSON.parse(JSON.stringify(source.style_overrides)) : {},
                layer_visibility: source.layer_visibility ? JSON.parse(JSON.stringify(source.layer_visibility)) : {},
            };
            await Api.updateSlide(newSlide.id, copyFields);
            Object.assign(newSlide, copyFields);
            this._slides.splice(idx + 1, 0, newSlide);
            this._renderSlidesList();
            this._selectSlide(idx + 1);
            App.toast(I18n.t('editor.slide_duplicated'), 'success');
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
        const existing = slide.layer_visibility[layerId];
        const currentOpacity = typeof existing === 'object' ? (existing.opacity ?? 1) : 1;
        slide.layer_visibility[layerId] = { visible: !isVis, opacity: currentOpacity };
    },

    _setLayerSlideOpacity(layerId, opacity) {
        TmMap.setLayerOpacity(layerId, opacity);
        const slide = this._slides[this._currentSlideIdx];
        if (!slide.layer_visibility) slide.layer_visibility = {};
        const existing = slide.layer_visibility[layerId];
        const currentVis = typeof existing === 'object' ? existing.visible !== false : (existing !== undefined ? !!existing : true);
        slide.layer_visibility[layerId] = { visible: currentVis, opacity };
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

    // ── TimelineJS Event Management ─────
    async _addTimelineJSEvent() {
        const slide = this._slides[this._currentSlideIdx];
        if (!slide) return;
        this._undoPush();
        if (!slide.style_overrides) slide.style_overrides = {};
        if (!slide.style_overrides.timelinejs) slide.style_overrides.timelinejs = { events: [], options: {} };
        slide.style_overrides.timelinejs.events.push({
            date: '', title: '', text: '', media_url: '', location: null
        });
        try {
            await Api.updateSlide(slide.id, { style_overrides: slide.style_overrides });
        } catch (err) { console.error('TimelineJS save failed:', err); }
        this._renderProps(slide);
    },

    async _removeTimelineJSEvent(index) {
        const slide = this._slides[this._currentSlideIdx];
        if (!slide?.style_overrides?.timelinejs?.events) return;
        this._undoPush();
        slide.style_overrides.timelinejs.events.splice(index, 1);
        try {
            await Api.updateSlide(slide.id, { style_overrides: slide.style_overrides });
        } catch (err) { console.error('TimelineJS save failed:', err); }
        this._renderProps(slide);
    },

    // ── Key figures (animated counters) ──
    async _addStat() {
        const slide = this._slides[this._currentSlideIdx];
        if (!slide) return;
        // Persist whatever is currently typed before the panel is re-rendered
        await this._saveCurrentSlideProps();
        this._undoPush();
        if (!slide.style_overrides) slide.style_overrides = {};
        if (!slide.style_overrides.stats) slide.style_overrides.stats = { items: [], columns: 4, duration: 1800 };
        slide.style_overrides.stats.items.push({ value: 0, label: '', desc: '', prefix: '', suffix: '', decimals: 0 });
        try {
            await Api.updateSlide(slide.id, { style_overrides: slide.style_overrides });
        } catch (err) { console.error('Stats save failed:', err); }
        this._renderProps(slide);
    },

    async _removeStat(index) {
        const slide = this._slides[this._currentSlideIdx];
        if (!slide?.style_overrides?.stats?.items) return;
        await this._saveCurrentSlideProps();
        this._undoPush();
        slide.style_overrides.stats.items.splice(index, 1);
        if (!slide.style_overrides.stats.items.length) slide.style_overrides.stats = null;
        try {
            await Api.updateSlide(slide.id, { style_overrides: slide.style_overrides });
        } catch (err) { console.error('Stats save failed:', err); }
        this._renderProps(slide);
    },

    // ── Express Map Inline ──────────────
    async _insertExpressMap() {
        const t = I18n.t.bind(I18n);
        // Get current map center as defaults
        let defLat = 45.464, defLng = 9.19, defZoom = 12;
        try {
            const state = TmMap.getState();
            if (state?.center) { defLng = state.center[0].toFixed(5); defLat = state.center[1].toFixed(5); defZoom = Math.round(state.zoom); }
        } catch {}

        const html = `
            <div class="modal fade" id="express-map-modal" tabindex="-1">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title"><i class="bi bi-pin-map"></i> ${t('editor.express_map_title')}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="row g-2 mb-2">
                                <div class="col-6">
                                    <label class="form-label" style="font-size:12px">${t('editor.express_map_lat')}</label>
                                    <input type="number" class="form-control form-control-sm" id="exmap-lat" value="${defLat}" step="any">
                                </div>
                                <div class="col-6">
                                    <label class="form-label" style="font-size:12px">${t('editor.express_map_lng')}</label>
                                    <input type="number" class="form-control form-control-sm" id="exmap-lng" value="${defLng}" step="any">
                                </div>
                            </div>
                            <div class="row g-2 mb-2">
                                <div class="col-6">
                                    <label class="form-label" style="font-size:12px">${t('editor.express_map_zoom')}</label>
                                    <input type="number" class="form-control form-control-sm" id="exmap-zoom" value="${defZoom}" min="1" max="22">
                                </div>
                                <div class="col-6">
                                    <label class="form-label" style="font-size:12px">${t('editor.express_map_size')}</label>
                                    <select class="form-select form-select-sm" id="exmap-size">
                                        <option value="small">${t('editor.express_map_size_small')}</option>
                                        <option value="medium" selected>${t('editor.express_map_size_medium')}</option>
                                        <option value="large">${t('editor.express_map_size_large')}</option>
                                    </select>
                                </div>
                            </div>
                            <div class="form-check mb-2">
                                <input class="form-check-input" type="checkbox" id="exmap-marker" checked>
                                <label class="form-check-label" for="exmap-marker" style="font-size:12px">${t('editor.express_map_marker')}</label>
                            </div>
                            <div id="exmap-preview" style="width:100%;height:200px;border-radius:8px;border:1px solid var(--tm-border);background:#1e293b;position:relative;overflow:hidden"></div>
                            <small class="text-muted" style="font-size:11px">Click the preview to update coordinates</small>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">${t('action.cancel')}</button>
                            <button type="button" class="btn btn-sm btn-primary" id="exmap-insert-btn">${t('editor.express_map_insert')}</button>
                        </div>
                    </div>
                </div>
            </div>`;

        document.getElementById('express-map-modal')?.remove();
        document.body.insertAdjacentHTML('beforeend', html);

        const modalEl = document.getElementById('express-map-modal');
        const modal = new bootstrap.Modal(modalEl);

        // Init preview map
        let previewMap = null;
        let previewMarker = null;
        modalEl.addEventListener('shown.bs.modal', () => {
            const lat = parseFloat(document.getElementById('exmap-lat').value) || defLat;
            const lng = parseFloat(document.getElementById('exmap-lng').value) || defLng;
            const zoom = parseInt(document.getElementById('exmap-zoom').value) || defZoom;
            previewMap = new maplibregl.Map({
                container: 'exmap-preview',
                style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
                center: [lng, lat],
                zoom: zoom,
            });
            previewMarker = new maplibregl.Marker().setLngLat([lng, lat]).addTo(previewMap);
            previewMap.on('click', (e) => {
                document.getElementById('exmap-lat').value = e.lngLat.lat.toFixed(5);
                document.getElementById('exmap-lng').value = e.lngLat.lng.toFixed(5);
                previewMarker.setLngLat(e.lngLat);
            });
            previewMap.on('zoomend', () => {
                document.getElementById('exmap-zoom').value = Math.round(previewMap.getZoom());
            });
        });

        modalEl.addEventListener('hidden.bs.modal', () => {
            if (previewMap) { previewMap.remove(); previewMap = null; }
            modalEl.remove();
        });

        document.getElementById('exmap-insert-btn').onclick = () => {
            const lat = document.getElementById('exmap-lat').value;
            const lng = document.getElementById('exmap-lng').value;
            const zoom = document.getElementById('exmap-zoom').value;
            const marker = document.getElementById('exmap-marker').checked;
            const size = document.getElementById('exmap-size').value;

            const placeholder = `<div class="express-map" data-lat="${App.escHtml(lat)}" data-lng="${App.escHtml(lng)}" data-zoom="${App.escHtml(zoom)}" data-marker="${marker}" data-size="${App.escHtml(size)}" contenteditable="false" style="background:#e2e8f0;border:2px dashed #94a3b8;border-radius:8px;padding:16px;text-align:center;margin:8px 0;color:#475569;font-size:12px"><i class="bi bi-pin-map" style="font-size:20px;display:block;margin-bottom:4px"></i>Mini-map: ${lat}, ${lng} (zoom ${zoom})</div>`;

            const editor = document.getElementById('prop-narrative');
            if (editor) {
                editor.focus();
                document.execCommand('insertHTML', false, placeholder);
            }
            modal.hide();
        };

        modal.show();
    },

    // ── Link to map element ──────────────
    async _insertMapLink() {
        const t = I18n.t.bind(I18n);
        const slide = this._slides[this._currentSlideIdx];
        if (!slide) return;

        // Gather available targets: markers + layers
        const fullSlide = await Api.getSlide(slide.id);
        const markers = fullSlide.markers || [];

        let itemsHtml = '<div class="map-link-list">';
        itemsHtml += `<h6><i class="bi bi-geo-alt"></i> ${t('editor.markers')}</h6>`;
        if (markers.length) {
            markers.forEach(m => {
                const parsed = TmMap._parseIcon ? TmMap._parseIcon(m.icon) : { icon: 'geo-alt-fill' };
                itemsHtml += `<div class="map-link-item" data-type="marker" data-id="${m.id}" data-lng="${m.lng}" data-lat="${m.lat}">
                    <i class="bi bi-${parsed.icon}" style="color:${m.color || '#e74c3c'}"></i>
                    <span>${App.escHtml(m.title || 'Marker #' + m.id)}</span>
                </div>`;
            });
        } else {
            itemsHtml += `<small class="text-muted">${t('editor.no_markers')}</small>`;
        }

        itemsHtml += `<h6 class="mt-3"><i class="bi bi-layers"></i> ${t('editor.layers_header')}</h6>`;
        if (this._layers?.length) {
            this._layers.forEach(l => {
                itemsHtml += `<div class="map-link-item" data-type="layer" data-id="${l.layer_id}">
                    <i class="bi bi-stack" style="color:var(--tm-primary)"></i>
                    <span>${App.escHtml(l.layer_name)}</span>
                </div>`;
            });
        } else {
            itemsHtml += `<small class="text-muted">${t('editor.no_layers')}</small>`;
        }
        itemsHtml += '</div>';

        const result = await App.modal({
            title: t('editor.link_to_map'),
            body: `
                <p style="font-size:13px;color:var(--tm-text-muted)">${t('editor.link_to_map_hint')}</p>
                ${itemsHtml}
            `,
            confirmText: t('action.confirm'),
            onConfirm: () => {
                const active = document.querySelector('.map-link-item.active');
                if (!active) return null;
                return { type: active.dataset.type, id: active.dataset.id, lng: active.dataset.lng, lat: active.dataset.lat };
            },
        });

        // Setup click handlers on items after modal opens
        setTimeout(() => {
            document.querySelectorAll('.map-link-item').forEach(item => {
                item.addEventListener('click', () => {
                    document.querySelectorAll('.map-link-item').forEach(i => i.classList.remove('active'));
                    item.classList.add('active');
                });
            });
        }, 150);

        if (!result) return;

        // Insert the link at cursor in narrative editor
        const sel = window.getSelection();
        const selectedText = sel?.toString() || result.type + ':' + result.id;
        const link = `<a href="#" class="tm-map-link" data-tm-link="${result.type}:${result.id}" data-lng="${result.lng || ''}" data-lat="${result.lat || ''}" style="color:#4f6df5;text-decoration:underline;cursor:pointer">${App.escHtml(selectedText)}</a>`;

        const editor = document.getElementById('prop-narrative');
        if (editor) {
            document.execCommand('insertHTML', false, link);
        }
    },

    // ── Layer Symbology Editor ───────────
    async _openLayerStyle(layerId) {
        const t = I18n.t.bind(I18n);
        const layer = this._layers.find(l => l.layer_id === layerId);
        if (!layer) return;

        const currentStyle = layer.custom_style && Object.keys(layer.custom_style).length
            ? layer.custom_style
            : (layer.style_config || {});
        const paint = currentStyle.paint || {};
        const layerType = currentStyle.type || 'fill';

        // Detect geometry type from current style
        const isFill = layerType === 'fill' || paint['fill-color'];
        const isLine = layerType === 'line' || paint['line-color'];
        const isCircle = layerType === 'circle' || paint['circle-color'];

        const fillColor = paint['fill-color'] || '#4f6df5';
        const fillOpacity = paint['fill-opacity'] ?? 0.4;
        const lineColor = paint['line-color'] || '#333333';
        const lineWidth = paint['line-width'] ?? 2;
        const circleColor = paint['circle-color'] || '#e74c3c';
        const circleRadius = paint['circle-radius'] ?? 6;
        const circleStrokeColor = paint['circle-stroke-color'] || '#ffffff';
        const circleStrokeWidth = paint['circle-stroke-width'] ?? 2;

        const result = await App.modal({
            title: `${t('editor.layer_style')}: ${layer.layer_name}`,
            size: 'lg',
            body: `
                <div class="row g-3">
                    <div class="col-12">
                        <label class="form-label">${t('editor.geom_type')}</label>
                        <select class="form-select" id="sym-geom-type">
                            <option value="fill" ${isFill ? 'selected' : ''}>${t('editor.sym_polygon')}</option>
                            <option value="line" ${isLine && !isFill ? 'selected' : ''}>${t('editor.sym_line')}</option>
                            <option value="circle" ${isCircle ? 'selected' : ''}>${t('editor.sym_point')}</option>
                            <option value="heatmap" ${layerType === 'heatmap' ? 'selected' : ''}>${t('editor.sym_heatmap')}</option>
                        </select>
                    </div>

                    <div class="col-12" id="sym-cluster-section">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="sym-cluster-enable" ${layer.source_config?.cluster ? 'checked' : ''}>
                            <label class="form-check-label">${t('editor.cluster_enable')}</label>
                        </div>
                    </div>

                    <!-- Polygon -->
                    <div class="col-6" id="sym-fill-section">
                        <label class="form-label">${t('editor.sym_fill_color')}</label>
                        <input type="color" class="form-control form-control-color w-100" id="sym-fill-color" value="${fillColor}">
                    </div>
                    <div class="col-6" id="sym-fill-opacity-section">
                        <label class="form-label">${t('editor.sym_fill_opacity')}</label>
                        <input type="range" class="form-range" id="sym-fill-opacity" min="0" max="1" step="0.05" value="${fillOpacity}">
                    </div>

                    <!-- Line -->
                    <div class="col-6">
                        <label class="form-label">${t('editor.sym_stroke_color')}</label>
                        <input type="color" class="form-control form-control-color w-100" id="sym-line-color" value="${lineColor}">
                    </div>
                    <div class="col-6">
                        <label class="form-label">${t('editor.sym_stroke_width')}</label>
                        <input type="number" class="form-control" id="sym-line-width" min="0.5" max="20" step="0.5" value="${lineWidth}">
                    </div>

                    <!-- Circle (points) -->
                    <div class="col-4" id="sym-circle-section">
                        <label class="form-label">${t('editor.sym_point_color')}</label>
                        <input type="color" class="form-control form-control-color w-100" id="sym-circle-color" value="${circleColor}">
                    </div>
                    <div class="col-4">
                        <label class="form-label">${t('editor.sym_point_radius')}</label>
                        <input type="number" class="form-control" id="sym-circle-radius" min="2" max="30" value="${circleRadius}">
                    </div>
                    <div class="col-4">
                        <label class="form-label">${t('editor.sym_point_stroke')}</label>
                        <input type="color" class="form-control form-control-color w-100" id="sym-circle-stroke" value="${circleStrokeColor}">
                    </div>

                    <!-- Heatmap -->
                    <div class="col-4" id="sym-heatmap-section">
                        <label class="form-label">${t('editor.heatmap_radius')}</label>
                        <input type="number" class="form-control" id="sym-heatmap-radius" min="1" max="100" value="${paint['heatmap-radius'] || 20}">
                    </div>
                    <div class="col-4">
                        <label class="form-label">${t('editor.heatmap_intensity')}</label>
                        <input type="number" class="form-control" id="sym-heatmap-intensity" min="0.1" max="10" step="0.1" value="${paint['heatmap-intensity'] || 1}">
                    </div>
                    <div class="col-4">
                        <label class="form-label">${t('editor.heatmap_weight')}</label>
                        <input type="text" class="form-control" id="sym-heatmap-weight" placeholder="${t('editor.heatmap_weight_hint')}" value="">
                    </div>
                </div>
            `,
            confirmText: t('action.save'),
            onConfirm: () => {
                const geomType = document.getElementById('sym-geom-type')?.value || 'fill';
                const clusterEnabled = document.getElementById('sym-cluster-enable')?.checked;
                const style = { type: geomType, paint: {}, _clusterEnabled: clusterEnabled };

                if (geomType === 'fill') {
                    style.paint['fill-color'] = document.getElementById('sym-fill-color')?.value;
                    style.paint['fill-opacity'] = parseFloat(document.getElementById('sym-fill-opacity')?.value);
                    style.paint['fill-outline-color'] = document.getElementById('sym-line-color')?.value;
                }
                if (geomType === 'line' || geomType === 'fill') {
                    style.paint['line-color'] = document.getElementById('sym-line-color')?.value;
                    style.paint['line-width'] = parseFloat(document.getElementById('sym-line-width')?.value);
                }
                if (geomType === 'circle') {
                    style.paint['circle-color'] = document.getElementById('sym-circle-color')?.value;
                    style.paint['circle-radius'] = parseFloat(document.getElementById('sym-circle-radius')?.value);
                    style.paint['circle-stroke-color'] = document.getElementById('sym-circle-stroke')?.value;
                    style.paint['circle-stroke-width'] = parseFloat(document.getElementById('sym-line-width')?.value) || 2;
                }
                if (geomType === 'heatmap') {
                    style.paint['heatmap-radius'] = parseFloat(document.getElementById('sym-heatmap-radius')?.value) || 20;
                    style.paint['heatmap-intensity'] = parseFloat(document.getElementById('sym-heatmap-intensity')?.value) || 1;
                    style.paint['heatmap-opacity'] = parseFloat(document.getElementById('sym-fill-opacity')?.value) || 0.8;
                    style.paint['heatmap-color'] = [
                        'interpolate', ['linear'], ['heatmap-density'],
                        0, 'rgba(0,0,255,0)', 0.2, 'royalblue', 0.4, 'cyan',
                        0.6, 'lime', 0.8, 'yellow', 1, 'red'
                    ];
                    const weightField = document.getElementById('sym-heatmap-weight')?.value;
                    if (weightField) style.paint['heatmap-weight'] = ['get', weightField];
                }
                return style;
            },
        });

        if (!result) return;

        // Extract and remove cluster flag from style result
        const clusterEnabled = result._clusterEnabled;
        delete result._clusterEnabled;

        // Update cluster config on source if changed
        if (clusterEnabled !== undefined) {
            const srcConfig = { ...layer.source_config, cluster: clusterEnabled };
            try {
                await Api.updateLayer(layerId, { source_config: srcConfig });
                layer.source_config = srcConfig;
            } catch {}
        }

        // Apply style to map immediately
        try {
            const map = TmMap.getMap();
            const mlLayerId = `layer-${layerId}`;
            if (map?.getLayer(mlLayerId)) {
                // Remove old layer and re-add with new style
                TmMap.removeLayer(layerId);
                TmMap.addLayer({
                    id: layerId,
                    layer_type: layer.layer_type,
                    source_config: layer.source_config,
                    style_config: result,
                    opacity: layer.opacity,
                });
            }

            // Save to API
            await Api.updateLayer(layerId, { style_config: result });
            layer.custom_style = result;
            layer.style_config = result;
            App.toast(t('editor.style_saved'), 'success');
        } catch (err) {
            App.toast(err.message, 'danger');
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

                // Auto-fill title with reverse geocode
                let suggestedTitle = '';
                try {
                    const geo = await Api.reverseGeocode(e.lngLat.lat, e.lngLat.lng);
                    if (geo?.display_name) suggestedTitle = geo.display_name.split(',').slice(0, 2).join(',').trim();
                } catch {}

                const markerData = await this._showMarkerModal({
                    lng: e.lngLat.lng, lat: e.lngLat.lat,
                    title: suggestedTitle, popup_content: '', color: '#e74c3c', icon: 'marker',
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

    // ── Undo / Redo ─────────────────────
    /**
     * Snapshot slides state before a significant change.
     * Call this BEFORE mutating this._slides.
     */
    _undoPush() {
        UndoManager.push(this._slides);
        this._updateUndoRedoButtons();
    },

    _updateUndoRedoButtons() {
        const undoBtn = document.getElementById('editor-undo');
        const redoBtn = document.getElementById('editor-redo');
        if (undoBtn) undoBtn.disabled = !UndoManager.canUndo();
        if (redoBtn) redoBtn.disabled = !UndoManager.canRedo();
    },

    _applyUndoRedo(restoredSlides) {
        if (!restoredSlides) return;
        this._slides = restoredSlides;
        // Clamp current slide index
        if (this._currentSlideIdx >= this._slides.length) {
            this._currentSlideIdx = Math.max(0, this._slides.length - 1);
        }
        this._renderSlidesList();
        const slide = this._slides[this._currentSlideIdx];
        if (slide) this._renderProps(slide);
        this._updateUndoRedoButtons();
    },

    _performUndo() {
        const state = UndoManager.undo();
        this._applyUndoRedo(state);
    },

    _performRedo() {
        const state = UndoManager.redo();
        this._applyUndoRedo(state);
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

        document.getElementById('editor-export-image')?.addEventListener('click', () => this._exportImage());
        document.getElementById('editor-manage-layers')?.addEventListener('click', () => this._openLayersModal());
        document.getElementById('editor-wiki-osm-btn')?.addEventListener('click', () => this._showWikiOsmModal());
        document.getElementById('editor-share')?.addEventListener('click', () => this._showShareModal());
        document.getElementById('editor-embed-config')?.addEventListener('click', () => this._openEmbedConfigurator());
        document.getElementById('editor-versions')?.addEventListener('click', () => this._showVersionsModal());

        // Undo / Redo buttons
        document.getElementById('editor-undo')?.addEventListener('click', () => this._performUndo());
        document.getElementById('editor-redo')?.addEventListener('click', () => this._performRedo());

        // Undo / Redo keyboard shortcuts
        this._undoKeyHandler = (e) => {
            // Only act when editor panel is visible
            if (document.getElementById('panel-editor')?.classList.contains('d-none')) return;
            if ((e.ctrlKey || e.metaKey) && !e.altKey) {
                if (e.key === 'z' && !e.shiftKey) {
                    e.preventDefault();
                    this._performUndo();
                } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
                    e.preventDefault();
                    this._performRedo();
                }
            }
        };
        document.addEventListener('keydown', this._undoKeyHandler);

        // Drawing tools
        document.getElementById('editor-draw-line')?.addEventListener('click', () => TmMap.startDrawLine());
        document.getElementById('editor-draw-polygon')?.addEventListener('click', () => TmMap.startDrawPolygon());
        document.getElementById('editor-draw-delete')?.addEventListener('click', () => TmMap.deleteDrawSelected());

        // Measurement tools
        document.getElementById('editor-measure-distance')?.addEventListener('click', () => TmMap.startMeasureDistance());
        document.getElementById('editor-measure-area')?.addEventListener('click', () => TmMap.startMeasureArea());
        document.getElementById('editor-measure-clear')?.addEventListener('click', () => {
            TmMap.clearMeasurements();
            document.getElementById('editor-measure-clear')?.classList.add('d-none');
        });

        // Guide button
        document.getElementById('editor-show-guide')?.addEventListener('click', () => {
            if (typeof Guide !== 'undefined') {
                Guide.reset();
                Guide.start();
            }
        });

        // Geocode search bar
        this._geocodeDebounce = null;
        document.getElementById('editor-geocode-toggle')?.addEventListener('click', () => {
            const inputWrap = document.getElementById('editor-geocode-input');
            const searchInput = document.getElementById('editor-geocode-search');
            if (inputWrap.style.display === 'none') {
                inputWrap.style.display = 'block';
                searchInput.focus();
            } else {
                inputWrap.style.display = 'none';
                searchInput.value = '';
                document.getElementById('editor-geocode-results').innerHTML = '';
            }
        });

        document.getElementById('editor-geocode-search')?.addEventListener('input', (e) => {
            clearTimeout(this._geocodeDebounce);
            const query = e.target.value.trim();
            if (query.length < 2) {
                document.getElementById('editor-geocode-results').innerHTML = '';
                return;
            }
            this._geocodeDebounce = setTimeout(() => this._geocodeSearch(query), 300);
        });

        document.getElementById('editor-geocode-search')?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.getElementById('editor-geocode-input').style.display = 'none';
                e.target.value = '';
                document.getElementById('editor-geocode-results').innerHTML = '';
            }
        });

        // Close geocode dropdown on outside click
        document.addEventListener('click', (e) => {
            const wrapper = document.getElementById('editor-geocode-wrapper');
            if (wrapper && !wrapper.contains(e.target)) {
                const inputWrap = document.getElementById('editor-geocode-input');
                if (inputWrap) {
                    inputWrap.style.display = 'none';
                    const searchInput = document.getElementById('editor-geocode-search');
                    if (searchInput) searchInput.value = '';
                    document.getElementById('editor-geocode-results').innerHTML = '';
                }
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

    async _geocodeSearch(query) {
        const resultsEl = document.getElementById('editor-geocode-results');
        const lang = I18n.getLang();
        try {
            const res = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`,
                {
                    headers: {
                        'Accept-Language': lang,
                        'User-Agent': 'TalkingMaps/2.0 (storymap editor)',
                    },
                }
            );
            const data = await res.json();
            if (!data.length) {
                resultsEl.innerHTML = `<div class="editor-geocode-result"><small>${I18n.t('editor.geocode_no_results')}</small></div>`;
                return;
            }
            resultsEl.innerHTML = data.map(item => {
                const name = item.display_name.split(',')[0];
                const detail = item.display_name.split(',').slice(1, 3).join(',');
                return `<div class="editor-geocode-result" data-lat="${item.lat}" data-lon="${item.lon}" data-bbox="${item.boundingbox?.join(',')}">
                    <span>${App.escHtml(name)}</span>
                    <small>${App.escHtml(detail)}</small>
                </div>`;
            }).join('');

            resultsEl.querySelectorAll('.editor-geocode-result').forEach(el => {
                el.addEventListener('click', () => {
                    const lat = parseFloat(el.dataset.lat);
                    const lon = parseFloat(el.dataset.lon);
                    TmMap.flyTo({ center: [lon, lat], zoom: 14, duration: 1500 });
                    document.getElementById('editor-geocode-input').style.display = 'none';
                    document.getElementById('editor-geocode-search').value = '';
                    resultsEl.innerHTML = '';
                });
            });
        } catch (err) {
            resultsEl.innerHTML = `<div class="editor-geocode-result"><small>Error: ${err.message}</small></div>`;
        }
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
                                <button class="btn btn-sm btn-outline-light" onclick="StoryEditor._addWfsLayer()">
                                    <i class="bi bi-database"></i> ${t('layers.add_wfs')}
                                </button>
                                <button class="btn btn-sm btn-outline-light" onclick="StoryEditor._addVectorTileLayer()">
                                    <i class="bi bi-grid-3x3"></i> ${t('layers.add_vector_tiles')}
                                </button>
                                <button class="btn btn-sm btn-outline-light" onclick="StoryEditor._openCkanBrowser()">
                                    <i class="bi bi-database-down"></i> ${t('ckan.button')}
                                </button>
                                <button class="btn btn-sm btn-outline-light" onclick="StoryEditor._addCogLayer()">
                                    <i class="bi bi-file-earmark-image"></i> ${t('editor.add_cog')}
                                </button>
                                <button class="btn btn-sm btn-outline-light" onclick="StoryEditor._addHillshadeLayer()">
                                    <i class="bi bi-mountains"></i> ${t('layers.add_hillshade')}
                                </button>
                                <button class="btn btn-sm btn-outline-info" onclick="StoryEditor._openServiceCatalog()">
                                    <i class="bi bi-server"></i> ${t('services.my_services')}
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


    // ══════════════════════════════════════════════════
    //  CKAN open data browser
    //  Search a portal's catalogue and import a resource as a layer. The backend
    //  does the fetching and the SSRF checks; this is the interface that was
    //  missing, which left four working endpoints unreachable.
    // ══════════════════════════════════════════════════

    async _openCkanBrowser() {
        const t = I18n.t.bind(I18n);
        let portals = [];
        try {
            portals = await Api.ckanPortals();
        } catch (err) {
            App.toast(err.message, 'danger');
            return;
        }

        const html = `
            <div class="modal fade" id="ckan-modal" tabindex="-1">
                <div class="modal-dialog modal-lg modal-dialog-scrollable">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title"><i class="bi bi-database-down"></i> ${t('ckan.title')}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <p class="text-muted" style="font-size:13px">${t('ckan.intro')}</p>
                            <div class="d-flex gap-2 mb-2 flex-wrap">
                                <select class="form-select form-select-sm" id="ckan-portal" style="flex:1;min-width:180px">
                                    ${portals.map(p => `<option value="${App.escHtml(p.url)}">${App.escHtml(p.id)}</option>`).join('')}
                                    <option value="__custom__">${t('ckan.other_portal')}</option>
                                </select>
                                <select class="form-select form-select-sm" id="ckan-format" style="max-width:150px">
                                    <option value="">${t('ckan.any_format')}</option>
                                    <option value="GEOJSON">GeoJSON</option>
                                    <option value="CSV">CSV</option>
                                    <option value="WMS">WMS</option>
                                    <option value="SHP">Shapefile</option>
                                </select>
                            </div>
                            <input type="url" class="form-control form-control-sm mb-2 d-none" id="ckan-custom-url"
                                   placeholder="https://portale-ckan.example.org">
                            <div class="input-group input-group-sm mb-3">
                                <input type="text" class="form-control" id="ckan-query" placeholder="${t('ckan.search_placeholder')}">
                                <button class="btn btn-primary" id="ckan-search-btn"><i class="bi bi-search"></i> ${t('ckan.search')}</button>
                            </div>
                            <div id="ckan-results"></div>
                        </div>
                    </div>
                </div>
            </div>`;

        document.getElementById('ckan-modal')?.remove();
        document.body.insertAdjacentHTML('beforeend', html);
        const modalEl = document.getElementById('ckan-modal');

        const portalSel = document.getElementById('ckan-portal');
        const customUrl = document.getElementById('ckan-custom-url');
        portalSel.addEventListener('change', () => {
            customUrl.classList.toggle('d-none', portalSel.value !== '__custom__');
            if (portalSel.value === '__custom__') customUrl.focus();
        });

        const run = () => this._ckanSearch();
        document.getElementById('ckan-search-btn').addEventListener('click', run);
        document.getElementById('ckan-query').addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); run(); }
        });

        new bootstrap.Modal(modalEl).show();
    },

    /** The portal to query: a known one, or whatever was typed. */
    _ckanPortalUrl() {
        const sel = document.getElementById('ckan-portal');
        if (!sel) return '';
        if (sel.value !== '__custom__') return sel.value;
        return (document.getElementById('ckan-custom-url')?.value || '').trim();
    },

    async _ckanSearch() {
        const t = I18n.t.bind(I18n);
        const results = document.getElementById('ckan-results');
        const portalUrl = this._ckanPortalUrl();
        if (!portalUrl) { App.toast(t('ckan.no_portal'), 'warning'); return; }

        results.innerHTML = `<div class="text-muted"><i class="bi bi-hourglass-split"></i> ${t('loading')}</div>`;
        try {
            const data = await Api.ckanSearch(
                portalUrl,
                document.getElementById('ckan-query').value,
                document.getElementById('ckan-format').value,
            );
            this._ckanRenderResults(data, portalUrl);
        } catch (err) {
            results.innerHTML = `<div class="alert alert-danger py-2 px-3 mb-0" style="font-size:13px">${App.escHtml(err.message)}</div>`;
        }
    },

    _ckanRenderResults(data, portalUrl) {
        const t = I18n.t.bind(I18n);
        const results = document.getElementById('ckan-results');
        const datasets = (data?.datasets || []).filter(d => d.resources?.length);

        if (!datasets.length) {
            results.innerHTML = `<div class="text-muted" style="font-size:13px">${t('ckan.no_results')}</div>`;
            return;
        }

        // Only these can become a layer; the rest are listed but not offered
        const IMPORTABLE = ['GEOJSON', 'CSV', 'WMS', 'WFS'];

        results.innerHTML = `
            <div class="text-muted mb-2" style="font-size:12px">${t('ckan.found', { n: data.count })}</div>
            ${datasets.map(ds => `
                <div class="layer-card mb-2">
                    <h4 style="margin-bottom:2px">${App.escHtml(ds.title || '')}</h4>
                    ${ds.organization ? `<small class="text-muted d-block">${App.escHtml(ds.organization)}</small>` : ''}
                    ${ds.notes ? `<small class="text-muted d-block mt-1">${App.escHtml(ds.notes)}</small>` : ''}
                    <div class="mt-2" style="display:flex;flex-direction:column;gap:4px">
                        ${ds.resources.map(r => `
                            <div class="d-flex align-items-center gap-2" style="font-size:12px">
                                <span class="layer-type-badge">${App.escHtml(r.format || '?')}</span>
                                <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${App.escHtml(r.name || r.url || '')}</span>
                                ${IMPORTABLE.includes((r.format || '').toUpperCase())
                                    ? `<button class="btn btn-sm btn-outline-success ckan-import"
                                            data-url="${App.escHtml(r.url || '')}"
                                            data-format="${App.escHtml((r.format || '').toUpperCase())}"
                                            data-name="${App.escHtml(r.name || ds.title || 'CKAN')}">
                                            <i class="bi bi-plus"></i> ${t('ckan.import')}
                                       </button>`
                                    : `<span class="text-muted" style="font-size:11px">${t('ckan.not_importable')}</span>`}
                            </div>`).join('')}
                    </div>
                </div>`).join('')}`;

        results.querySelectorAll('.ckan-import').forEach(btn => {
            btn.addEventListener('click', () => this._ckanImport(btn));
        });
    },

    async _ckanImport(btn) {
        const t = I18n.t.bind(I18n);
        const { url, format, name } = btn.dataset;

        // A CSV only becomes a map once we know which columns hold the coordinates,
        // so read its header first and let the author pick.
        if (format === 'CSV') {
            const picked = await this._ckanAskCoordinateColumns(url);
            if (!picked) return;
            return this._ckanDoImport(btn, { url, name, format, lat_field: picked.lat, lon_field: picked.lon });
        }
        return this._ckanDoImport(btn, { url, name, format });
    },

    async _ckanDoImport(btn, body) {
        const t = I18n.t.bind(I18n);
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="bi bi-hourglass-split"></i>';
        try {
            const res = await Api.ckanImportAsLayer(body);
            await this._addLayerToStory(res.id);
            App.toast(t('ckan.imported', { n: res.features ?? '' }), 'success');
            btn.innerHTML = '<i class="bi bi-check-lg"></i>';
        } catch (err) {
            App.toast(err.message, 'danger');
            btn.disabled = false;
            btn.innerHTML = original;
        }
    },

    /** Read a CSV's columns and ask which two carry latitude and longitude. */
    async _ckanAskCoordinateColumns(url) {
        const t = I18n.t.bind(I18n);
        let columns = [];
        try {
            App.toast(t('ckan.reading_csv'), 'info');
            const data = await Api.ckanResource(url);
            columns = data?.columns || [];
        } catch (err) {
            App.toast(err.message, 'danger');
            return null;
        }
        if (!columns.length) {
            App.toast(t('ckan.no_columns'), 'warning');
            return null;
        }

        // Pre-select the usual suspects so most files need no thought
        const guess = (candidates) => columns.find(c => candidates.includes(c.trim().toLowerCase())) || '';
        const latGuess = guess(['lat', 'latitude', 'latitudine', 'y', 'coord_y']);
        const lonGuess = guess(['lon', 'lng', 'long', 'longitude', 'longitudine', 'x', 'coord_x']);

        const options = (selected) => columns
            .map(c => `<option value="${App.escHtml(c)}" ${c === selected ? 'selected' : ''}>${App.escHtml(c)}</option>`)
            .join('');

        const result = await App.modal({
            title: t('ckan.csv_title'),
            body: `
                <p style="font-size:13px" class="text-muted">${t('ckan.csv_hint')}</p>
                <div class="mb-2">
                    <label class="form-label small">${t('ckan.lat_field')}</label>
                    <select class="form-select form-select-sm" id="ckan-lat">${options(latGuess)}</select>
                </div>
                <div>
                    <label class="form-label small">${t('ckan.lon_field')}</label>
                    <select class="form-select form-select-sm" id="ckan-lon">${options(lonGuess)}</select>
                </div>`,
            confirmText: t('ckan.import'),
            onConfirm: () => ({
                lat: document.getElementById('ckan-lat')?.value,
                lon: document.getElementById('ckan-lon')?.value,
            }),
        });

        if (!result || !result.lat || !result.lon) return null;
        if (result.lat === result.lon) { App.toast(t('ckan.same_field'), 'warning'); return null; }
        return result;
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
                    <div class="input-group">
                        <input type="text" class="form-control" id="modal-wms-url" placeholder="https://...">
                        <button class="btn btn-outline-info" type="button" id="btn-discover-wms">${t('layers.discover')}</button>
                    </div>
                </div>
                <div class="mb-3" id="wms-discover-results" style="display:none;max-height:200px;overflow-y:auto"></div>
                <div class="mb-3"><label class="form-label">${t('layers.wms_name')}</label>
                    <input type="text" class="form-control" id="modal-wms-name"></div>
                <div class="mb-3"><label class="form-label">${t('layers.wms_layer')}</label>
                    <input type="text" class="form-control" id="modal-wms-layers"></div>
                <div class="form-check mb-2">
                    <input class="form-check-input" type="checkbox" id="modal-wms-save-service">
                    <label class="form-check-label" for="modal-wms-save-service">${t('services.save_to_catalog')}</label>
                </div>
            `,
            confirmText: t('action.confirm'),
            onConfirm: () => ({
                url: document.getElementById('modal-wms-url')?.value,
                name: document.getElementById('modal-wms-name')?.value,
                layers: document.getElementById('modal-wms-layers')?.value,
                saveService: document.getElementById('modal-wms-save-service')?.checked,
            }),
            onReady: () => {
                document.getElementById('btn-discover-wms')?.addEventListener('click', async () => {
                    const url = document.getElementById('modal-wms-url')?.value;
                    if (!url) return;
                    const resultsDiv = document.getElementById('wms-discover-results');
                    resultsDiv.style.display = 'block';
                    resultsDiv.innerHTML = '<small class="text-muted">Loading...</small>';
                    try {
                        const data = await Api.getCapabilities(url, 'WMS');
                        if (!data.layers?.length) {
                            resultsDiv.innerHTML = '<small class="text-muted">No layers found</small>';
                            return;
                        }
                        resultsDiv.innerHTML = data.layers.map(l => `
                            <div class="p-1 border-bottom" style="cursor:pointer;font-size:13px" data-name="${App.escHtml(l.name)}" data-title="${App.escHtml(l.title)}">
                                <strong>${App.escHtml(l.title)}</strong> <small class="text-muted">${App.escHtml(l.name)}</small>
                            </div>
                        `).join('');
                        resultsDiv.querySelectorAll('[data-name]').forEach(el => {
                            el.addEventListener('click', () => {
                                document.getElementById('modal-wms-layers').value = el.dataset.name;
                                document.getElementById('modal-wms-name').value = el.dataset.title || el.dataset.name;
                                resultsDiv.style.display = 'none';
                            });
                        });
                    } catch (err) { resultsDiv.innerHTML = `<small class="text-danger">${err.message}</small>`; }
                });
            },
        });
        if (!result || !result.url) return;
        try {
            if (result.saveService) {
                await Api.createService({ name: result.name || 'WMS', service_type: 'wms', url: result.url });
            }
            const layer = await Api.createLayer({
                name: result.name || 'WMS Layer', layer_type: 'wms',
                source_config: { url: result.url, layers: result.layers || '' },
            });
            await this._addLayerToStory(layer.id);
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    async _addCogLayer() {
        const t = I18n.t.bind(I18n);
        const result = await App.modal({
            title: t('editor.add_cog'),
            body: `
                <div class="mb-3"><label class="form-label">${t('editor.cog_url')}</label>
                    <input type="text" class="form-control" id="modal-cog-url" placeholder="https://example.com/raster.tif"></div>
                <div class="mb-3"><label class="form-label">${t('layers.wms_name')}</label>
                    <input type="text" class="form-control" id="modal-cog-name" placeholder="Ortofoto COG"></div>
                <small class="text-muted"><i class="bi bi-info-circle"></i> ${t('editor.cog_hint')}</small>
            `,
            confirmText: t('action.confirm'),
            onConfirm: () => ({
                url: document.getElementById('modal-cog-url')?.value,
                name: document.getElementById('modal-cog-name')?.value,
            }),
        });
        if (!result || !result.url) return;
        try {
            const layer = await Api.createLayer({
                name: result.name || 'COG Raster', layer_type: 'cog',
                source_config: { url: result.url },
            });
            await this._addLayerToStory(layer.id);
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    async _addHillshadeLayer() {
        const t = I18n.t.bind(I18n);
        const result = await App.modal({
            title: t('layers.add_hillshade_title'),
            body: `
                <div class="mb-3"><label class="form-label">${t('layers.hillshade_url')}</label>
                    <input type="text" class="form-control" id="modal-hillshade-url" placeholder="https://demotiles.maplibre.org/terrain-tiles/{z}/{x}/{y}.png"></div>
                <div class="mb-3"><label class="form-label">${t('layers.wms_name')}</label>
                    <input type="text" class="form-control" id="modal-hillshade-name" placeholder="Terrain"></div>
                <div class="mb-3"><label class="form-label">${t('layers.hillshade_encoding')}</label>
                    <select class="form-select" id="modal-hillshade-encoding">
                        <option value="mapbox">Mapbox Terrain RGB</option>
                        <option value="terrarium">Terrarium</option>
                    </select></div>
                <small class="text-muted"><i class="bi bi-info-circle"></i> ${t('layers.hillshade_hint')}</small>
            `,
            confirmText: t('action.confirm'),
            onConfirm: () => ({
                url: document.getElementById('modal-hillshade-url')?.value,
                name: document.getElementById('modal-hillshade-name')?.value,
                encoding: document.getElementById('modal-hillshade-encoding')?.value,
            }),
        });
        if (!result || !result.url) return;
        try {
            const layer = await Api.createLayer({
                name: result.name || 'Hillshade', layer_type: 'hillshade',
                source_config: { url: result.url, encoding: result.encoding || 'mapbox' },
            });
            await this._addLayerToStory(layer.id);
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    async _openLayerFilter(layerId) {
        const t = I18n.t.bind(I18n);
        const layer = this._layers.find(l => l.layer_id === layerId);
        if (!layer) return;

        // Get properties from first feature to show available fields
        const map = TmMap.getMap();
        const mlLayerId = `layer-${layerId}`;
        let fields = [];
        try {
            const source = map.getSource(mlLayerId);
            if (source && source._data?.features?.length) {
                fields = Object.keys(source._data.features[0].properties || {});
            } else {
                // Try querying rendered features
                const features = map.querySourceFeatures(mlLayerId);
                if (features.length) fields = Object.keys(features[0].properties || {});
            }
        } catch {}

        const currentFilter = layer.custom_style?.filter || null;
        const currentField = currentFilter?.[1]?.[1] || '';
        const currentOp = currentFilter ? currentFilter[0] : '==';
        const currentVal = currentFilter?.[2] || '';

        const result = await App.modal({
            title: `${t('editor.layer_filter')}: ${layer.layer_name}`,
            body: `
                <div class="mb-3"><label class="form-label">${t('editor.filter_field')}</label>
                    <select class="form-select" id="modal-filter-field">
                        <option value="">${t('editor.filter_none')}</option>
                        ${fields.map(f => `<option value="${f}" ${f === currentField ? 'selected' : ''}>${f}</option>`).join('')}
                    </select>
                </div>
                <div class="mb-3"><label class="form-label">${t('editor.filter_operator')}</label>
                    <select class="form-select" id="modal-filter-op">
                        <option value="==" ${currentOp === '==' ? 'selected' : ''}>=  (equals)</option>
                        <option value="!=" ${currentOp === '!=' ? 'selected' : ''}>!=  (not equals)</option>
                        <option value=">" ${currentOp === '>' ? 'selected' : ''}>>  (greater than)</option>
                        <option value=">=" ${currentOp === '>=' ? 'selected' : ''}>>=  (greater or equal)</option>
                        <option value="<" ${currentOp === '<' ? 'selected' : ''}><  (less than)</option>
                        <option value="<=" ${currentOp === '<=' ? 'selected' : ''}><=  (less or equal)</option>
                        <option value="has" ${currentOp === 'has' ? 'selected' : ''}>has (field exists)</option>
                    </select>
                </div>
                <div class="mb-3"><label class="form-label">${t('editor.filter_value')}</label>
                    <input type="text" class="form-control" id="modal-filter-value" value="${currentVal}" placeholder="${t('editor.filter_value_hint')}"></div>
                <small class="text-muted"><i class="bi bi-info-circle"></i> ${t('editor.filter_hint')}</small>
            `,
            confirmText: t('action.apply'),
        });
        if (result === undefined) return; // cancelled

        const field = document.getElementById('modal-filter-field')?.value;
        const op = document.getElementById('modal-filter-op')?.value;
        let val = document.getElementById('modal-filter-value')?.value;

        try {
            if (!field) {
                // Remove filter
                map.setFilter(mlLayerId, null);
                if (map.getLayer(`${mlLayerId}-outline`)) map.setFilter(`${mlLayerId}-outline`, null);
                delete layer.custom_style?.filter;
            } else {
                // Try numeric conversion
                const numVal = parseFloat(val);
                if (!isNaN(numVal) && String(numVal) === val) val = numVal;

                let filter;
                if (op === 'has') {
                    filter = ['has', field];
                } else {
                    filter = [op, ['get', field], val];
                }
                map.setFilter(mlLayerId, filter);
                if (map.getLayer(`${mlLayerId}-outline`)) map.setFilter(`${mlLayerId}-outline`, filter);
                if (!layer.custom_style) layer.custom_style = {};
                layer.custom_style.filter = filter;
            }
            App.toast(t('editor.filter_applied'), 'success');
        } catch (err) {
            App.toast(err.message, 'danger');
        }
    },

    async _exportImage() {
        const t = I18n.t.bind(I18n);
        const map = TmMap.getMap();
        if (!map) { App.toast('No map to export', 'warning'); return; }

        try {
            // Ensure map is rendered with preserveDrawingBuffer
            const canvas = map.getCanvas();
            const mapImage = canvas.toDataURL('image/png');

            // Create export canvas with slide info
            const exportCanvas = document.createElement('canvas');
            const ctx = exportCanvas.getContext('2d');
            const slide = this._slides[this._currentSlideIdx];

            exportCanvas.width = canvas.width;
            exportCanvas.height = canvas.height + 80;

            // Draw map
            const img = new Image();
            img.onload = () => {
                ctx.drawImage(img, 0, 0);

                // Add title bar at bottom
                ctx.fillStyle = 'rgba(0,0,0,0.7)';
                ctx.fillRect(0, canvas.height, exportCanvas.width, 80);
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 20px Ubuntu, sans-serif';
                ctx.fillText(slide?.title || this._story?.title || 'TalkingMaps', 20, canvas.height + 35);
                ctx.font = '14px Ubuntu, sans-serif';
                ctx.fillStyle = '#aaaaaa';
                ctx.fillText(`TalkingMaps — ${new Date().toLocaleDateString()}`, 20, canvas.height + 60);

                // Download
                const link = document.createElement('a');
                link.download = `talkingmaps-${this._storyId}-slide${this._currentSlideIdx + 1}.png`;
                link.href = exportCanvas.toDataURL('image/png');
                link.click();
                App.toast(t('editor.export_success'), 'success');
            };
            img.src = mapImage;
        } catch (err) {
            App.toast(err.message, 'danger');
        }
    },

    async _addWfsLayer() {
        const t = I18n.t.bind(I18n);
        const result = await App.modal({
            title: t('layers.add_wfs_title'),
            body: `
                <div class="mb-3"><label class="form-label">${t('layers.wfs_url')}</label>
                    <div class="input-group">
                        <input type="text" class="form-control" id="modal-wfs-url" placeholder="https://myserver.com/wfs">
                        <button class="btn btn-outline-info" type="button" id="btn-discover-wfs">${t('layers.discover')}</button>
                    </div>
                </div>
                <div class="mb-3" id="wfs-discover-results" style="display:none;max-height:200px;overflow-y:auto"></div>
                <div class="mb-3"><label class="form-label">${t('layers.wfs_typename')}</label>
                    <input type="text" class="form-control" id="modal-wfs-typename" placeholder="namespace:layername"></div>
                <div class="mb-3"><label class="form-label">${t('layers.wms_name')}</label>
                    <input type="text" class="form-control" id="modal-wfs-name"></div>
                <div class="mb-3"><label class="form-label">${t('layers.wfs_max_features')}</label>
                    <input type="number" class="form-control" id="modal-wfs-max" value="1000" min="1" max="50000"></div>
                <div class="form-check mb-2">
                    <input class="form-check-input" type="checkbox" id="modal-wfs-save-service">
                    <label class="form-check-label" for="modal-wfs-save-service">${t('services.save_to_catalog')}</label>
                </div>
            `,
            confirmText: t('action.confirm'),
            onConfirm: () => ({
                url: document.getElementById('modal-wfs-url')?.value,
                name: document.getElementById('modal-wfs-name')?.value,
                typeName: document.getElementById('modal-wfs-typename')?.value,
                maxFeatures: parseInt(document.getElementById('modal-wfs-max')?.value) || 1000,
                saveService: document.getElementById('modal-wfs-save-service')?.checked,
            }),
            onReady: () => {
                document.getElementById('btn-discover-wfs')?.addEventListener('click', async () => {
                    const url = document.getElementById('modal-wfs-url')?.value;
                    if (!url) return;
                    const resultsDiv = document.getElementById('wfs-discover-results');
                    resultsDiv.style.display = 'block';
                    resultsDiv.innerHTML = '<small class="text-muted">Loading...</small>';
                    try {
                        const data = await Api.getCapabilities(url, 'WFS');
                        if (!data.layers?.length) {
                            resultsDiv.innerHTML = '<small class="text-muted">No feature types found</small>';
                            return;
                        }
                        resultsDiv.innerHTML = data.layers.map(l => `
                            <div class="p-1 border-bottom" style="cursor:pointer;font-size:13px" data-name="${App.escHtml(l.name)}" data-title="${App.escHtml(l.title)}">
                                <strong>${App.escHtml(l.title)}</strong> <small class="text-muted">${App.escHtml(l.name)}</small>
                            </div>
                        `).join('');
                        resultsDiv.querySelectorAll('[data-name]').forEach(el => {
                            el.addEventListener('click', () => {
                                document.getElementById('modal-wfs-typename').value = el.dataset.name;
                                document.getElementById('modal-wfs-name').value = el.dataset.title || el.dataset.name;
                                resultsDiv.style.display = 'none';
                            });
                        });
                    } catch (err) { resultsDiv.innerHTML = `<small class="text-danger">${err.message}</small>`; }
                });
            },
        });
        if (!result || !result.url || !result.typeName) return;
        try {
            if (result.saveService) {
                await Api.createService({ name: result.name || 'WFS', service_type: 'wfs', url: result.url });
            }
            const layer = await Api.createLayer({
                name: result.name || 'WFS Layer', layer_type: 'wfs',
                source_config: { url: result.url, typeName: result.typeName, maxFeatures: result.maxFeatures },
            });
            await this._addLayerToStory(layer.id);
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    async _addVectorTileLayer() {
        const t = I18n.t.bind(I18n);
        const result = await App.modal({
            title: t('layers.add_vt_title'),
            body: `
                <div class="mb-3"><label class="form-label">${t('layers.vt_url')}</label>
                    <input type="text" class="form-control" id="modal-vt-url" placeholder="https://server/{z}/{x}/{y}.pbf">
                    <small class="text-muted">${t('layers.vt_url_hint')}</small>
                </div>
                <div class="mb-3"><label class="form-label">${t('layers.wms_name')}</label>
                    <input type="text" class="form-control" id="modal-vt-name"></div>
                <div class="mb-3"><label class="form-label">${t('layers.vt_source_layer')}</label>
                    <input type="text" class="form-control" id="modal-vt-source-layer" placeholder="default"></div>
                <div class="form-check mb-2">
                    <input class="form-check-input" type="checkbox" id="modal-vt-save-service">
                    <label class="form-check-label" for="modal-vt-save-service">${t('services.save_to_catalog')}</label>
                </div>
            `,
            confirmText: t('action.confirm'),
            onConfirm: () => ({
                url: document.getElementById('modal-vt-url')?.value,
                name: document.getElementById('modal-vt-name')?.value,
                sourceLayer: document.getElementById('modal-vt-source-layer')?.value,
                saveService: document.getElementById('modal-vt-save-service')?.checked,
            }),
        });
        if (!result || !result.url) return;
        try {
            if (result.saveService) {
                await Api.createService({ name: result.name || 'Vector Tiles', service_type: 'vector-tiles', url: result.url });
            }
            const layer = await Api.createLayer({
                name: result.name || 'Vector Tile Layer', layer_type: 'vector-tiles',
                source_config: { url: result.url, sourceLayer: result.sourceLayer || 'default' },
            });
            await this._addLayerToStory(layer.id);
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    async _openServiceCatalog() {
        const t = I18n.t.bind(I18n);
        let services = [];
        try { services = await Api.listServices(); } catch { /* ok */ }

        const html = `
            <div class="modal fade" id="service-catalog-modal" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title"><i class="bi bi-server"></i> ${t('services.title')}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="mb-3" style="display:flex;gap:8px">
                                <button class="btn btn-sm btn-outline-success" onclick="StoryEditor._addServiceToList()">
                                    <i class="bi bi-plus"></i> ${t('services.add')}
                                </button>
                            </div>
                            <div id="service-catalog-list">
                                ${services.length === 0 ? `<p class="text-muted">${t('services.empty')}</p>` : ''}
                                ${services.map(s => `
                                    <div class="layer-card mb-2" data-service-id="${s.id}">
                                        <div class="d-flex justify-content-between align-items-start">
                                            <div>
                                                <h4>${App.escHtml(s.name)}</h4>
                                                <span class="layer-type-badge">${s.service_type}</span>
                                                <small class="text-muted d-block mt-1" style="word-break:break-all">${App.escHtml(s.url)}</small>
                                                ${s.description ? `<small class="text-muted">${App.escHtml(s.description)}</small>` : ''}
                                            </div>
                                            <div style="display:flex;gap:4px">
                                                <button class="btn btn-sm btn-outline-info" data-explore-service="${App.escHtml(s.id)}"
                                                        data-service-type="${App.escHtml(s.service_type)}" data-service-url="${App.escHtml(s.url)}"
                                                        title="${t('services.explore')}">
                                                    <i class="bi bi-search"></i>
                                                </button>
                                                <button class="btn btn-sm btn-outline-danger" data-delete-service="${App.escHtml(s.id)}" title="${t('action.delete')}">
                                                    <i class="bi bi-trash"></i>
                                                </button>
                                            </div>
                                        </div>
                                        <div id="service-layers-${s.id}" class="mt-2" style="display:none"></div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.getElementById('service-catalog-modal')?.remove();
        document.body.insertAdjacentHTML('beforeend', html);

        const catalogModal = document.getElementById('service-catalog-modal');
        catalogModal.querySelectorAll('[data-explore-service]').forEach(btn => {
            btn.addEventListener('click', () => this._exploreService(
                parseInt(btn.dataset.exploreService, 10), btn.dataset.serviceType, btn.dataset.serviceUrl));
        });
        catalogModal.querySelectorAll('[data-delete-service]').forEach(btn => {
            btn.addEventListener('click', () => this._deleteService(parseInt(btn.dataset.deleteService, 10)));
        });

        new bootstrap.Modal(catalogModal).show();
    },

    async _addServiceToList() {
        const t = I18n.t.bind(I18n);
        const result = await App.modal({
            title: t('services.add'),
            body: `
                <div class="mb-3"><label class="form-label">${t('services.name')}</label>
                    <input type="text" class="form-control" id="modal-svc-name" placeholder="My GeoServer"></div>
                <div class="mb-3"><label class="form-label">${t('services.type')}</label>
                    <select class="form-select" id="modal-svc-type">
                        <option value="wms">WMS</option><option value="wfs">WFS</option>
                        <option value="wmts">WMTS</option><option value="xyz">XYZ Tiles</option>
                        <option value="vector-tiles">Vector Tiles</option>
                    </select>
                </div>
                <div class="mb-3"><label class="form-label">${t('services.url')}</label>
                    <input type="text" class="form-control" id="modal-svc-url" placeholder="https://..."></div>
                <div class="mb-3"><label class="form-label">${t('services.description')}</label>
                    <input type="text" class="form-control" id="modal-svc-desc"></div>
            `,
            confirmText: t('action.save'),
            onConfirm: () => ({
                name: document.getElementById('modal-svc-name')?.value,
                service_type: document.getElementById('modal-svc-type')?.value,
                url: document.getElementById('modal-svc-url')?.value,
                description: document.getElementById('modal-svc-desc')?.value,
            }),
        });
        if (!result || !result.url || !result.name) return;
        try {
            await Api.createService(result);
            App.toast(t('services.saved'), 'success');
            bootstrap.Modal.getInstance(document.getElementById('service-catalog-modal'))?.hide();
            this._openServiceCatalog(); // refresh
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    async _exploreService(serviceId, serviceType, url) {
        const t = I18n.t.bind(I18n);
        const resultsDiv = document.getElementById(`service-layers-${serviceId}`);
        if (!resultsDiv) return;
        resultsDiv.style.display = 'block';
        resultsDiv.innerHTML = '<small class="text-muted">Loading capabilities...</small>';
        try {
            const capType = (serviceType === 'wfs') ? 'WFS' : 'WMS';
            const data = await Api.getCapabilities(url, capType);
            if (!data.layers?.length) {
                resultsDiv.innerHTML = '<small class="text-muted">No layers found</small>';
                return;
            }
            // Layer names come straight from a third-party GetCapabilities document,
            // so they go in data-* attributes and are read via dataset — never spliced
            // into an inline handler's JS string.
            resultsDiv.innerHTML = `<div style="max-height:200px;overflow-y:auto">` +
                data.layers.map(l => `
                    <div class="d-flex justify-content-between align-items-center p-1 border-bottom" style="font-size:13px">
                        <div><strong>${App.escHtml(l.title)}</strong> <small class="text-muted">${App.escHtml(l.name)}</small></div>
                        <button class="btn btn-sm btn-outline-success" data-add-layer
                                data-layer-name="${App.escHtml(l.name)}" data-layer-title="${App.escHtml(l.title)}">
                            <i class="bi bi-plus"></i>
                        </button>
                    </div>
                `).join('') + `</div>`;
            resultsDiv.querySelectorAll('[data-add-layer]').forEach(btn => {
                btn.addEventListener('click', () => this._addLayerFromService(
                    serviceType, url, btn.dataset.layerName, btn.dataset.layerTitle));
            });
        } catch (err) {
            resultsDiv.innerHTML = `<small class="text-danger">${err.message}</small>`;
        }
    },

    async _addLayerFromService(serviceType, url, layerName, layerTitle) {
        try {
            const layerType = serviceType === 'wfs' ? 'wfs' : 'wms';
            const sourceConfig = layerType === 'wfs'
                ? { url, typeName: layerName, maxFeatures: 1000 }
                : { url, layers: layerName };
            const layer = await Api.createLayer({
                name: layerTitle || layerName,
                layer_type: layerType,
                source_config: sourceConfig,
            });
            await this._addLayerToStory(layer.id);
            App.toast(`Layer "${layerTitle}" added`, 'success');
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    async _deleteService(serviceId) {
        if (!await App.confirm(I18n.t('services.confirm_delete'))) return;
        try {
            await Api.deleteService(serviceId);
            App.toast(I18n.t('services.deleted'), 'success');
            bootstrap.Modal.getInstance(document.getElementById('service-catalog-modal'))?.hide();
            this._openServiceCatalog();
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
                this._undoPush();
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

    // ── Props Tab Switching ─────────────
    _activePropsTab: 'slide',

    _initPropsTabs() {
        const tabs = document.getElementById('editor-props-tabs');
        if (!tabs) return;
        // Update active state from stored tab
        tabs.querySelectorAll('.editor-props-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === this._activePropsTab);
        });
        // Only bind once
        if (!tabs.dataset.bound) {
            tabs.dataset.bound = '1';
            tabs.addEventListener('click', (e) => {
                const tab = e.target.closest('.editor-props-tab');
                if (!tab) return;
                this._activePropsTab = tab.dataset.tab;
                tabs.querySelectorAll('.editor-props-tab').forEach(t => t.classList.toggle('active', t === tab));
                document.querySelectorAll('.editor-tab-content').forEach(c => {
                    c.classList.toggle('active', c.dataset.tabContent === tab.dataset.tab);
                });
            });
        }
    },

    // ── Props Panel Resize (drag from left edge) ──
    _initPropsResize() {
        const handle = document.getElementById('editor-props-resize');
        if (!handle) return;
        let startX, startWidth;
        const panelEditor = document.getElementById('panel-editor');

        const onMouseMove = (e) => {
            const delta = startX - e.clientX;
            const newWidth = Math.min(Math.max(startWidth + delta, 300), 700);
            panelEditor.style.setProperty('--editor-props-width', newWidth + 'px');
        };
        const onMouseUp = () => {
            handle.classList.remove('dragging');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            if (this._map) this._map.resize();
        };
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            startX = e.clientX;
            startWidth = handle.parentElement.getBoundingClientRect().width;
            handle.classList.add('dragging');
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    },

    // ── Mobile Tab Switching ──
    _initMobileTabs() {
        const tabs = document.getElementById('editor-mobile-tabs');
        if (!tabs) return;

        const slidesPanel = document.querySelector('#panel-editor .editor-slides-panel');
        const mapArea = document.getElementById('editor-map-area');
        const propsWrapper = document.querySelector('#panel-editor .editor-props-wrapper');

        // Set initial state: show map by default on mobile
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        if (isMobile && slidesPanel) {
            slidesPanel.classList.add('mobile-active');
            mapArea?.classList.remove('mobile-active');
            propsWrapper?.classList.remove('mobile-active');
        }

        tabs.addEventListener('click', (e) => {
            const btn = e.target.closest('.editor-mobile-tab');
            if (!btn) return;

            const tab = btn.dataset.mobileTab;
            tabs.querySelectorAll('.editor-mobile-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            slidesPanel?.classList.remove('mobile-active');
            mapArea?.classList.remove('mobile-active');
            propsWrapper?.classList.remove('mobile-active');

            if (tab === 'slides') slidesPanel?.classList.add('mobile-active');
            else if (tab === 'map') { mapArea?.classList.add('mobile-active'); if (this._map) setTimeout(() => this._map.resize(), 50); }
            else if (tab === 'props') propsWrapper?.classList.add('mobile-active');
        });
    },

    _switchToMapLayout() {
        const slide = this._slides[this._currentSlideIdx];
        if (slide) {
            slide.layout = 'side-left';
            this._updateMapVisibility();
            this._renderProps(slide);
            this._renderSlidesList();
        }
    },

    async _aiAssist() {
        const t = I18n.t.bind(I18n);
        const slide = this._slides[this._currentSlideIdx];
        if (!slide) return;

        const result = await App.modal({
            title: t('editor.ai_title'),
            size: 'lg',
            body: `
                <div class="mb-3">
                    <label class="form-label">${t('editor.ai_task')}</label>
                    <select class="form-select" id="ai-task">
                        <option value="narrative">${t('editor.ai_task_narrative')}</option>
                        <option value="title">${t('editor.ai_task_title')}</option>
                        <option value="description">${t('editor.ai_task_description')}</option>
                        <option value="improve">${t('editor.ai_task_improve')}</option>
                        <option value="translate">${t('editor.ai_task_translate')}</option>
                        <option value="summarize">${t('editor.ai_task_summarize')}</option>
                        <option value="chart">${t('editor.ai_task_chart')}</option>
                    </select>
                </div>
                <div class="mb-3" id="ai-lang-row" style="display:none">
                    <label class="form-label">${t('editor.ai_target_lang')}</label>
                    <select class="form-select" id="ai-target-lang">
                        <option value="inglese">English</option>
                        <option value="italiano">Italiano</option>
                        <option value="spagnolo">Espa\u00f1ol</option>
                        <option value="francese">Fran\u00e7ais</option>
                        <option value="tedesco">Deutsch</option>
                        <option value="portoghese">Portugu\u00eas</option>
                    </select>
                </div>
                <div class="mb-3">
                    <label class="form-label">${t('editor.ai_prompt')}</label>
                    <textarea class="form-control" id="ai-prompt" rows="3" placeholder="${t('editor.ai_prompt_ph')}"></textarea>
                </div>
                <div id="ai-result" style="display:none">
                    <label class="form-label">${t('editor.ai_result')}</label>
                    <div class="form-control" id="ai-result-text" style="min-height:100px;max-height:300px;overflow-y:auto;white-space:pre-wrap;font-size:13px"></div>
                </div>
                <div id="ai-loading" style="display:none;text-align:center;padding:20px">
                    <div class="spinner-border spinner-border-sm text-primary"></div> ${t('editor.ai_generating')}
                </div>
                <p class="text-muted mt-2" style="font-size:11px"><i class="bi bi-info-circle"></i> ${t('editor.ai_no_key_hint')}</p>
            `,
            confirmText: t('editor.ai_insert'),
            cancelText: t('action.cancel'),
            onConfirm: () => {
                return document.getElementById('ai-result-text')?.textContent || null;
            },
        });

        // Hook task change to show/hide language selector
        setTimeout(() => {
            const taskSelect = document.getElementById('ai-task');
            const langRow = document.getElementById('ai-lang-row');
            if (taskSelect && langRow) {
                taskSelect.addEventListener('change', () => {
                    langRow.style.display = taskSelect.value === 'translate' ? 'block' : 'none';
                });
            }

            // Hook a "Generate" button - add it dynamically
            const promptArea = document.getElementById('ai-prompt');
            if (promptArea) {
                const genBtn = document.createElement('button');
                genBtn.className = 'btn btn-primary mt-2';
                genBtn.innerHTML = '<i class="bi bi-robot"></i> ' + t('editor.ai_generate');
                genBtn.onclick = async () => {
                    const loading = document.getElementById('ai-loading');
                    const resultDiv = document.getElementById('ai-result');
                    const resultText = document.getElementById('ai-result-text');
                    if (loading) loading.style.display = 'block';
                    if (resultDiv) resultDiv.style.display = 'none';

                    try {
                        const resp = await Api.generateText({
                            prompt: promptArea.value,
                            context: slide.title ? 'Slide: ' + slide.title + '. ' + (slide.narrative || '').substring(0, 500) : '',
                            task: document.getElementById('ai-task')?.value || 'narrative',
                            target_language: document.getElementById('ai-target-lang')?.value || '',
                        });
                        if (resultText) resultText.textContent = resp.text;
                        if (resultDiv) resultDiv.style.display = 'block';
                    } catch (err) {
                        if (resultText) resultText.textContent = '\u274c ' + err.message;
                        if (resultDiv) resultDiv.style.display = 'block';
                    }
                    if (loading) loading.style.display = 'none';
                };
                promptArea.parentNode.appendChild(genBtn);
            }
        }, 200);

        if (result) {
            // Insert generated text into the narrative
            const narrativeEl = document.getElementById('prop-narrative');
            if (narrativeEl) {
                narrativeEl.innerHTML += (narrativeEl.innerHTML ? '<br>' : '') + result;
            }
        }
    },

    async _aiGenerateImage() {
        const t = I18n.t.bind(I18n);
        const result = await App.modal({
            title: t('editor.ai_image_title'),
            body: `
                <div class="mb-3">
                    <label class="form-label">${t('editor.ai_image_prompt')}</label>
                    <textarea class="form-control" id="ai-img-prompt" rows="3" placeholder="${t('editor.ai_image_prompt_ph')}"></textarea>
                </div>
                <div class="mb-3">
                    <label class="form-label">Provider</label>
                    <select class="form-select" id="ai-img-provider">
                        <option value="openai">OpenAI (DALL-E 3)</option>
                        <option value="google">Google (Gemini/Imagen)</option>
                    </select>
                </div>
                <div class="mb-3">
                    <label class="form-label">${t('editor.ai_image_size')}</label>
                    <select class="form-select" id="ai-img-size">
                        <option value="1024x1024">1024\u00d71024</option>
                        <option value="1792x1024">1792\u00d71024 (landscape)</option>
                        <option value="1024x1792">1024\u00d71792 (portrait)</option>
                    </select>
                </div>
                <div id="ai-img-loading" style="display:none;text-align:center;padding:20px">
                    <div class="spinner-border spinner-border-sm text-primary"></div> ${t('editor.ai_generating')}
                </div>
                <div id="ai-img-result" style="display:none;text-align:center">
                    <img id="ai-img-preview" style="max-width:100%;border-radius:8px;margin-top:10px" />
                </div>
            `,
            confirmText: t('editor.ai_use_image'),
            onConfirm: () => document.getElementById('ai-img-preview')?.src || null,
        });

        // Hook generate button
        setTimeout(() => {
            const promptArea = document.getElementById('ai-img-prompt');
            if (promptArea) {
                const genBtn = document.createElement('button');
                genBtn.className = 'btn btn-primary mt-2';
                genBtn.innerHTML = '<i class="bi bi-image"></i> ' + t('editor.ai_generate');
                genBtn.onclick = async () => {
                    const loading = document.getElementById('ai-img-loading');
                    const resultDiv = document.getElementById('ai-img-result');
                    const preview = document.getElementById('ai-img-preview');
                    if (loading) loading.style.display = 'block';
                    if (resultDiv) resultDiv.style.display = 'none';
                    try {
                        const resp = await Api.generateImage({
                            prompt: promptArea.value,
                            size: document.getElementById('ai-img-size')?.value || '1024x1024',
                            provider: document.getElementById('ai-img-provider')?.value || '',
                        });
                        if (preview) preview.src = resp.url || resp.base64;
                        if (resultDiv) resultDiv.style.display = 'block';
                    } catch (err) {
                        App.toast('\u274c ' + err.message, 'danger');
                    }
                    if (loading) loading.style.display = 'none';
                };
                promptArea.parentNode.appendChild(genBtn);
            }
        }, 200);

        if (result) {
            // Use generated image as background
            const bgInput = document.getElementById('prop-bg-media');
            if (bgInput) bgInput.value = result;
        }
    },

    async _showWikiOsmModal() {
        const t = I18n.t.bind(I18n);
        const center = TMap.getCenter();
        const categories = [
            { value: 'all', label: t('editor.osm_cat_all') },
            { value: 'tourism', label: t('editor.osm_cat_tourism') },
            { value: 'culture', label: t('editor.osm_cat_culture') },
            { value: 'food', label: t('editor.osm_cat_food') },
            { value: 'historic', label: t('editor.osm_cat_historic') },
            { value: 'nature', label: t('editor.osm_cat_nature') },
            { value: 'transport', label: t('editor.osm_cat_transport') },
            { value: 'shop', label: t('editor.osm_cat_shop') },
            { value: 'health', label: t('editor.osm_cat_health') },
        ];
        const catOpts = categories.map(c => `<option value="${c.value}">${c.label}</option>`).join('');

        await App.modal({
            title: t('editor.wiki_osm'),
            size: 'lg',
            body: `
                <ul class="nav nav-tabs mb-3" role="tablist">
                    <li class="nav-item"><a class="nav-link active" data-bs-toggle="tab" href="#wiki-tab">Wikipedia</a></li>
                    <li class="nav-item"><a class="nav-link" data-bs-toggle="tab" href="#osm-tab">OpenStreetMap</a></li>
                </ul>
                <div class="tab-content">
                    <div class="tab-pane fade show active" id="wiki-tab">
                        <div class="input-group mb-3">
                            <input type="text" class="form-control" id="wiki-search-input" placeholder="${t('editor.wiki_search_ph')}">
                            <button class="btn btn-outline-primary" id="wiki-search-btn"><i class="bi bi-search"></i></button>
                            <button class="btn btn-outline-secondary" id="wiki-nearby-btn" title="${t('editor.wiki_nearby')}"><i class="bi bi-geo-alt"></i> ${t('editor.wiki_nearby')}</button>
                        </div>
                        <div id="wiki-results" style="max-height:400px;overflow-y:auto"></div>
                    </div>
                    <div class="tab-pane fade" id="osm-tab">
                        <div class="row g-2 mb-3">
                            <div class="col-auto">
                                <select class="form-select" id="osm-category">${catOpts}</select>
                            </div>
                            <div class="col-auto">
                                <select class="form-select" id="osm-radius">
                                    <option value="500">500m</option>
                                    <option value="1000" selected>1 km</option>
                                    <option value="3000">3 km</option>
                                    <option value="5000">5 km</option>
                                </select>
                            </div>
                            <div class="col-auto">
                                <button class="btn btn-primary" id="osm-search-btn"><i class="bi bi-search"></i> ${t('editor.osm_search')}</button>
                            </div>
                        </div>
                        <div id="osm-results" style="max-height:400px;overflow-y:auto"></div>
                    </div>
                </div>
            `,
            confirmText: t('action.close'),
        });

        // Bind events after modal renders
        setTimeout(() => {
            document.getElementById('wiki-search-btn')?.addEventListener('click', async () => {
                const q = document.getElementById('wiki-search-input')?.value;
                if (!q) return;
                const container = document.getElementById('wiki-results');
                container.innerHTML = '<div class="text-center p-3"><div class="spinner-border spinner-border-sm"></div></div>';
                try {
                    const data = await Api.wikiSearch(q);
                    this._renderWikiResults(container, data.articles);
                } catch (e) { container.innerHTML = `<div class="text-danger">${e.message}</div>`; }
            });

            document.getElementById('wiki-search-input')?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') document.getElementById('wiki-search-btn')?.click();
            });

            document.getElementById('wiki-nearby-btn')?.addEventListener('click', async () => {
                const container = document.getElementById('wiki-results');
                container.innerHTML = '<div class="text-center p-3"><div class="spinner-border spinner-border-sm"></div></div>';
                try {
                    const c = TMap.getCenter();
                    const data = await Api.wikiNearby(c.lat, c.lng);
                    this._renderWikiResults(container, data.articles);
                } catch (e) { container.innerHTML = `<div class="text-danger">${e.message}</div>`; }
            });

            document.getElementById('osm-search-btn')?.addEventListener('click', async () => {
                const container = document.getElementById('osm-results');
                container.innerHTML = '<div class="text-center p-3"><div class="spinner-border spinner-border-sm"></div></div>';
                try {
                    const c = TMap.getCenter();
                    const cat = document.getElementById('osm-category')?.value || 'all';
                    const rad = document.getElementById('osm-radius')?.value || '1000';
                    const data = await Api.osmNearby(c.lat, c.lng, parseInt(rad), cat);
                    this._renderOsmResults(container, data.features);
                } catch (e) { container.innerHTML = `<div class="text-danger">${e.message}</div>`; }
            });
        }, 300);
    },

    _renderWikiResults(container, articles) {
        if (!articles || !articles.length) {
            container.innerHTML = '<div class="text-muted p-2">Nessun risultato</div>';
            return;
        }
        container.innerHTML = articles.map(a => `
            <div class="wiki-result-item d-flex gap-3 p-2 border-bottom" style="cursor:pointer">
                ${a.thumbnail ? `<img src="${a.thumbnail}" style="width:60px;height:60px;object-fit:cover;border-radius:6px;flex-shrink:0">` : '<div style="width:60px;height:60px;background:var(--tm-surface);border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center"><i class="bi bi-wikipedia" style="font-size:20px;opacity:.4"></i></div>'}
                <div class="flex-grow-1">
                    <div class="d-flex justify-content-between align-items-start">
                        <strong style="font-size:14px">${a.title}</strong>
                        <div class="btn-group btn-group-sm">
                            ${a.lat ? `<button class="btn btn-outline-primary btn-sm wiki-add-marker" data-lat="${a.lat}" data-lng="${a.lng}" data-title="${a.title.replace(/"/g, '&quot;')}" data-extract="${(a.extract || '').substring(0, 200).replace(/"/g, '&quot;')}" title="Aggiungi come marker"><i class="bi bi-geo-alt-fill"></i></button>` : ''}
                            <button class="btn btn-outline-secondary btn-sm wiki-insert-text" data-title="${a.title.replace(/"/g, '&quot;')}" data-extract="${(a.extract || '').replace(/"/g, '&quot;')}" data-url="${a.url}" title="Inserisci nella narrativa"><i class="bi bi-file-text"></i></button>
                            <a href="${a.url}" target="_blank" class="btn btn-outline-info btn-sm" title="Apri su Wikipedia"><i class="bi bi-box-arrow-up-right"></i></a>
                        </div>
                    </div>
                    <small class="text-muted" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${a.extract || ''}</small>
                    ${a.dist ? `<small class="text-info">${Math.round(a.dist)}m</small>` : ''}
                </div>
            </div>
        `).join('');

        // Bind marker buttons
        container.querySelectorAll('.wiki-add-marker').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const { lat, lng, title, extract } = btn.dataset;
                this._addMarkerFromExternal(parseFloat(lat), parseFloat(lng), title, extract);
            });
        });
        container.querySelectorAll('.wiki-insert-text').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const { title, extract, url } = btn.dataset;
                this._insertWikiTextInNarrative(title, extract, url);
            });
        });
    },

    _renderOsmResults(container, features) {
        if (!features || !features.length) {
            container.innerHTML = '<div class="text-muted p-2">Nessun risultato</div>';
            return;
        }
        container.innerHTML = features.map(f => {
            const p = f.properties;
            return `
                <div class="osm-result-item d-flex gap-3 p-2 border-bottom align-items-center">
                    <div class="flex-grow-1">
                        <strong style="font-size:14px">${p.name}</strong>
                        <small class="text-muted ms-2">${p.category}</small>
                        ${p.address ? `<br><small class="text-muted">${p.address} ${p.housenumber}</small>` : ''}
                    </div>
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-primary btn-sm osm-add-marker" data-lat="${f.geometry.coordinates[1]}" data-lng="${f.geometry.coordinates[0]}" data-title="${p.name.replace(/"/g, '&quot;')}" data-category="${p.category}" title="Aggiungi come marker"><i class="bi bi-geo-alt-fill"></i></button>
                        ${p.wikipedia ? `<a href="https://wikipedia.org/wiki/${p.wikipedia}" target="_blank" class="btn btn-outline-info btn-sm"><i class="bi bi-wikipedia"></i></a>` : ''}
                        ${p.website ? `<a href="${p.website}" target="_blank" class="btn btn-outline-secondary btn-sm"><i class="bi bi-globe2"></i></a>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.osm-add-marker').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const { lat, lng, title, category } = btn.dataset;
                this._addMarkerFromExternal(parseFloat(lat), parseFloat(lng), title, category);
            });
        });
    },

    _addMarkerFromExternal(lat, lng, title, description) {
        if (!this.story || !this.currentSlide) return;
        const slide = this.story.slides.find(s => s.id === this.currentSlide);
        if (!slide) return;
        if (!slide.markers) slide.markers = [];
        slide.markers.push({
            id: Date.now(),
            lat, lng,
            title: title,
            popup_content: description || '',
            color: '#e74c3c',
        });
        this._saveSlide(slide);
        this._renderMarkers(slide);
        TMap.flyTo(lng, lat, 14);
        App.toast(`Marker "${title}" aggiunto`, 'success');
    },

    _insertWikiTextInNarrative(title, extract, url) {
        const html = `<h3>${title}</h3><p>${extract}</p><p><a href="${url}" target="_blank">Leggi su Wikipedia</a></p>`;
        const editor = document.getElementById('prop-narrative');
        if (editor) {
            editor.innerHTML += html;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
        App.toast(`Testo da "${title}" inserito`, 'success');
    },

    _layoutIcon(layout) {
        return { 'cover': 'card-heading', 'side-left': 'layout-sidebar', 'side-right': 'layout-sidebar-reverse',
            'center': 'layout-text-window', 'full-map': 'map', 'full-media': 'image',
            'text-only': 'file-text', 'text-media': 'layout-text-sidebar',
            'separator': 'hr', 'globe-3d': 'globe-americas', 'potree-3d': 'cloud-fill',
            'image-map': 'image' }[layout] || 'square';
    },

    // ── Drawn Features Management ──────────
    _renderDrawnFeaturesHTML(slide) {
        const t = I18n.t.bind(I18n);
        const features = slide?.style_overrides?.drawn_features?.features || [];
        if (!features.length) {
            return `<small class="text-muted"><i class="bi bi-info-circle"></i> ${t('editor.no_drawn')}</small>`;
        }
        return features.map((f, i) => {
            const geomType = f.geometry?.type || '?';
            const icon = geomType === 'Polygon' ? 'pentagon' : 'bezier2';
            const label = geomType === 'Polygon' ? t('editor.draw_polygon') : t('editor.draw_line');
            const name = f.properties?.title || `${label} ${i + 1}`;
            const color = f.properties?.color || '#4f6df5';
            return `
                <div class="drawn-feature-item" style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid var(--tm-border);font-size:12px;cursor:pointer"
                     onclick="StoryEditor._editDrawnFeature('${f.id}')">
                    <i class="bi bi-${icon}" style="color:${color};font-size:16px;flex-shrink:0"></i>
                    <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${App.escHtml(name)}</span>
                    <span style="color:var(--tm-text-muted);font-size:11px">${label}</span>
                    <button class="btn btn-sm p-0" onclick="event.stopPropagation();StoryEditor._deleteDrawnFeature('${f.id}')" title="${t('action.delete')}" style="color:var(--tm-text-muted)">
                        <i class="bi bi-trash" style="font-size:12px"></i>
                    </button>
                </div>
            `;
        }).join('');
    },

    _renderDrawnFeaturesList() {
        const container = document.getElementById('drawn-features-list');
        if (!container) return;
        const slide = this._slides[this._currentSlideIdx];
        container.innerHTML = this._renderDrawnFeaturesHTML(slide);
    },

    async _editDrawnFeature(featureId) {
        const t = I18n.t.bind(I18n);
        const draw = TmMap.getDraw();
        if (!draw) return;
        const feat = draw.get(featureId);
        if (!feat) return;

        const geomType = feat.geometry?.type || 'LineString';
        const isPolygon = geomType === 'Polygon';
        const props = feat.properties || {};

        const result = await App.modal({
            title: t('editor.edit_drawn_feature'),
            size: 'lg',
            body: `
                <div class="row g-3">
                    <div class="col-8">
                        <label class="form-label">${t('editor.drawn_title')}</label>
                        <input type="text" class="form-control" id="modal-drawn-title"
                               value="${App.escHtml(props.title || '')}" placeholder="${t('editor.drawn_title_ph')}">
                    </div>
                    <div class="col-4">
                        <label class="form-label">${t('editor.drawn_color')}</label>
                        <input type="color" class="form-control form-control-color w-100" id="modal-drawn-color"
                               value="${props.color || '#4f6df5'}">
                    </div>
                </div>
                <div class="mb-3 mt-3">
                    <label class="form-label">${t('editor.drawn_description')}</label>
                    <div class="narrative-toolbar" style="margin-bottom:4px">
                        <button class="btn" onclick="document.execCommand('bold')" title="Bold"><i class="bi bi-type-bold"></i></button>
                        <button class="btn" onclick="document.execCommand('italic')" title="Italic"><i class="bi bi-type-italic"></i></button>
                        <button class="btn" onclick="document.execCommand('createLink', false, prompt('URL:'))" title="Link"><i class="bi bi-link-45deg"></i></button>
                        <button class="btn" onclick="document.execCommand('insertImage', false, prompt('Image URL:'))" title="Image"><i class="bi bi-image"></i></button>
                    </div>
                    <div class="narrative-editor" id="modal-drawn-content" contenteditable="true"
                         style="min-height:80px">${props.popup_content || ''}</div>
                </div>
                <div class="row g-3">
                    <div class="col-4">
                        <label class="form-label">${t('editor.drawn_stroke_width')}</label>
                        <input type="range" class="form-range" id="modal-drawn-stroke" min="1" max="10" step="1"
                               value="${props.stroke_width || 3}">
                        <small class="text-muted" id="modal-drawn-stroke-val">${props.stroke_width || 3}px</small>
                    </div>
                    ${isPolygon ? `
                    <div class="col-4">
                        <label class="form-label">${t('editor.drawn_fill_opacity')}</label>
                        <input type="range" class="form-range" id="modal-drawn-fill-opacity" min="0" max="1" step="0.05"
                               value="${props.fill_opacity ?? 0.2}">
                        <small class="text-muted" id="modal-drawn-fill-val">${((props.fill_opacity ?? 0.2) * 100).toFixed(0)}%</small>
                    </div>
                    ` : '<div class="col-4"></div>'}
                    <div class="col-4">
                        <label class="form-label">${t('editor.drawn_type')}</label>
                        <small class="form-text d-block"><i class="bi bi-${isPolygon ? 'pentagon' : 'bezier2'}"></i> ${isPolygon ? t('editor.draw_polygon') : t('editor.draw_line')}</small>
                    </div>
                </div>
            `,
            confirmText: t('action.save'),
            onConfirm: () => ({
                title: document.getElementById('modal-drawn-title')?.value || '',
                popup_content: document.getElementById('modal-drawn-content')?.innerHTML || '',
                color: document.getElementById('modal-drawn-color')?.value || '#4f6df5',
                stroke_width: parseInt(document.getElementById('modal-drawn-stroke')?.value || '3'),
                fill_opacity: isPolygon ? parseFloat(document.getElementById('modal-drawn-fill-opacity')?.value || '0.2') : undefined,
            }),
        });

        // Hook range input display
        setTimeout(() => {
            const strokeInput = document.getElementById('modal-drawn-stroke');
            const strokeVal = document.getElementById('modal-drawn-stroke-val');
            if (strokeInput && strokeVal) {
                strokeInput.addEventListener('input', () => { strokeVal.textContent = strokeInput.value + 'px'; });
            }
            const fillInput = document.getElementById('modal-drawn-fill-opacity');
            const fillVal = document.getElementById('modal-drawn-fill-val');
            if (fillInput && fillVal) {
                fillInput.addEventListener('input', () => { fillVal.textContent = (fillInput.value * 100).toFixed(0) + '%'; });
            }
        }, 100);

        if (!result) return;

        // Update feature properties in MapboxDraw
        TmMap.updateDrawFeature(featureId, result);

        // Save to slide
        this._onDrawChange({ type: 'draw.update' });
        this._renderDrawnFeaturesList();
    },

    _deleteDrawnFeature(featureId) {
        const t = I18n.t.bind(I18n);
        if (!confirm(t('editor.drawn_delete_confirm'))) return;
        const draw = TmMap.getDraw();
        if (draw) {
            draw.delete(featureId);
            this._onDrawChange({ type: 'draw.delete' });
        }
    },

    // ── 3D Upload ─────────────────────────
    _init3DUpload() {
        const dropzone = document.getElementById('upload3d-dropzone');
        const input = document.getElementById('upload3d-input');
        if (!dropzone || !input) return;

        dropzone.addEventListener('click', () => input.click());
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = 'var(--tm-primary)';
        });
        dropzone.addEventListener('dragleave', () => {
            dropzone.style.borderColor = 'var(--tm-border)';
        });
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = 'var(--tm-border)';
            if (e.dataTransfer.files.length) this._do3DUpload(e.dataTransfer.files[0]);
        });
        input.addEventListener('change', () => {
            if (input.files.length) this._do3DUpload(input.files[0]);
        });
    },

    async _do3DUpload(file) {
        const t = (k) => I18n.t(k);
        const progress = document.getElementById('upload3d-progress');
        const bar = document.getElementById('upload3d-bar');
        const status = document.getElementById('upload3d-status');
        if (progress) progress.style.display = 'block';
        if (bar) bar.style.width = '30%';
        if (status) status.textContent = t('editor.upload3d_uploading');

        try {
            const result = await Api.upload3D(file, file.name);
            if (bar) bar.style.width = '100%';
            if (status) status.textContent = t('editor.upload3d_success');
            App.toast(t('editor.upload3d_success'), 'success');

            // Auto-fill the appropriate field based on asset type
            const slide = this._slides[this._currentSlideIdx];
            if (slide && result.serve_url) {
                if (result.viewer_type === 'potree') {
                    const potreeInput = document.getElementById('prop-potree-url');
                    if (potreeInput) {
                        potreeInput.value = result.serve_url;
                        potreeInput.dispatchEvent(new Event('change'));
                    }
                } else if (result.viewer_type === 'cesium') {
                    const tilesetInput = document.getElementById('prop-tileset-url');
                    if (tilesetInput) {
                        tilesetInput.value = result.serve_url;
                        tilesetInput.dispatchEvent(new Event('change'));
                    }
                }
            }

            // Reload assets list
            this._load3DAssets();
            setTimeout(() => { if (progress) progress.style.display = 'none'; }, 2000);
        } catch (err) {
            if (bar) { bar.style.width = '100%'; bar.classList.add('bg-danger'); }
            if (status) status.textContent = `${t('editor.upload3d_error')}: ${err.message}`;
            App.toast(`${t('editor.upload3d_error')}: ${err.message}`, 'danger');
            setTimeout(() => {
                if (progress) progress.style.display = 'none';
                if (bar) bar.classList.remove('bg-danger');
            }, 4000);
        }
    },

    async _load3DAssets() {
        const container = document.getElementById('my3d-assets-list');
        const quotaEl = document.getElementById('my3d-quota');
        if (!container) return;

        try {
            const [assets, quota] = await Promise.all([
                Api.list3DAssets().catch(() => []),
                Api.getStorageQuota().catch(() => null),
            ]);

            const t = (k) => I18n.t(k);
            const categoryIcons = {
                pointcloud: 'cloud-fill',
                mesh: 'box',
                tileset: 'bricks',
                terrain: 'triangle-half',
                kml: 'geo-alt',
            };

            if (!assets || assets.length === 0) {
                container.innerHTML = `<div style="text-align:center;padding:15px;color:var(--tm-text-muted);font-size:12px">
                    <i class="bi bi-box" style="font-size:24px;display:block;margin-bottom:6px;opacity:0.3"></i>
                    ${t('editor.my3d_empty')}
                </div>`;
            } else {
                container.innerHTML = assets.map(a => `
                    <div class="asset3d-item" style="display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid var(--tm-border);font-size:12px">
                        <i class="bi bi-${categoryIcons[a.category] || 'file-earmark'}" style="font-size:18px;color:var(--tm-primary);flex-shrink:0"></i>
                        <div style="flex:1;min-width:0">
                            <div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${a.original_filename || a.name}">${a.name}</div>
                            <div style="color:var(--tm-text-muted);font-size:11px">${a.category} · ${a.format} · ${a.file_size ? (a.file_size / 1024 / 1024).toFixed(1) + ' MB' : '—'}</div>
                        </div>
                        <div style="display:flex;gap:4px;flex-shrink:0">
                            ${a.serve_url ? `
                                <button class="btn btn-sm btn-outline-primary" onclick="StoryEditor._use3DAsset('${a.viewer_type === 'potree' ? 'potree' : 'cesium'}','${a.serve_url}')" title="${a.viewer_type === 'potree' ? t('editor.my3d_use_potree') : t('editor.my3d_use_tileset')}">
                                    <i class="bi bi-${a.viewer_type === 'potree' ? 'cloud-fill' : 'badge-3d'}"></i> ${a.viewer_type === 'potree' ? t('editor.my3d_use_potree') : t('editor.my3d_use_tileset')}
                                </button>` : ''}
                            <button class="btn btn-sm btn-outline-danger" onclick="StoryEditor._delete3DAsset('${a.asset_id}')" title="${t('editor.my3d_delete')}">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                    </div>
                `).join('');
            }

            // Quota display
            if (quotaEl && quota) {
                const usedMB = (quota.storage_used_bytes || 0) / 1024 / 1024;
                const limitMB = quota.storage_limit_mb || 500;
                const pct = Math.min((usedMB / limitMB) * 100, 100);
                const barColor = pct > 90 ? 'bg-danger' : pct > 70 ? 'bg-warning' : 'bg-success';
                quotaEl.innerHTML = `
                    <small class="text-muted">${t('editor.quota_title')}: ${usedMB.toFixed(1)} MB ${t('editor.quota_of')} ${limitMB} MB</small>
                    <div class="progress mt-1" style="height:4px">
                        <div class="progress-bar ${barColor}" style="width:${pct}%"></div>
                    </div>
                `;
            }
        } catch (err) {
            container.innerHTML = `<div style="text-align:center;padding:10px;color:var(--tm-text-muted);font-size:12px">
                <i class="bi bi-exclamation-triangle"></i> ${err.message}
            </div>`;
        }
    },

    _use3DAsset(type, url) {
        const slide = this._slides[this._currentSlideIdx];
        if (!slide) return;
        if (type === 'potree') {
            slide.style_overrides = {
                ...(slide.style_overrides || {}),
                potree: { url, colorMode: 'rgb', pointSize: 1, height: 400 },
            };
            const potreeInput = document.getElementById('prop-potree-url');
            if (potreeInput) potreeInput.value = url;
        } else {
            slide.style_overrides = {
                ...(slide.style_overrides || {}),
                tileset3d: { ...(slide.style_overrides?.tileset3d || {}), url },
            };
            const tilesetInput = document.getElementById('prop-tileset-url');
            if (tilesetInput) tilesetInput.value = url;
        }
        this._renderProps(slide);
    },

    async _delete3DAsset(assetId) {
        const t = (k) => I18n.t(k);
        if (!confirm(t('editor.my3d_delete_confirm'))) return;
        try {
            await Api.delete3DAsset(assetId);
            App.toast(t('editor.my3d_deleted'), 'success');
            this._load3DAssets();
        } catch (err) {
            App.toast(err.message, 'danger');
        }
    },

    // ── Measurement Tools ─────────────────
    _showMeasureClearBtn() {
        const btn = document.getElementById('editor-measure-clear');
        if (btn) btn.classList.remove('d-none');
    },

    // ── Attribute Table ───────────────────
    async _openAttributeTable(layerId) {
        const t = I18n.t.bind(I18n);
        let layerData;
        try {
            const res = await fetch(`/api/layers/${layerId}`, {
                headers: { 'Authorization': 'Bearer ' + (Api._token || localStorage.getItem('tm_token')) },
            });
            if (!res.ok) throw new Error('Failed to load layer');
            layerData = await res.json();
        } catch (err) {
            App.toast(err.message, 'danger');
            return;
        }

        const geojson = layerData.geojson || layerData.source_config?.data;
        if (!geojson || !geojson.features || geojson.features.length === 0) {
            App.toast('No features found', 'warning');
            return;
        }

        // Extract property keys from all features
        const propKeys = new Set();
        geojson.features.forEach(f => {
            if (f.properties) Object.keys(f.properties).forEach(k => propKeys.add(k));
        });
        const columns = [...propKeys];

        // Build table HTML
        let tableHtml = `
            <div class="attr-table-wrapper">
                <table class="table table-sm table-bordered table-hover" id="attr-table">
                    <thead><tr>
                        <th>#</th>
                        <th>${t('editor.drawn_type')}</th>
                        ${columns.map(c => `<th>${App.escHtml(c)}</th>`).join('')}
                        <th></th>
                    </tr></thead>
                    <tbody>
        `;
        geojson.features.forEach((f, idx) => {
            const geomType = f.geometry?.type || '?';
            tableHtml += `<tr data-feature-idx="${idx}">
                <td>${idx + 1}</td>
                <td><small class="text-muted">${geomType}</small></td>
                ${columns.map(c => `<td contenteditable="true" data-prop="${App.escHtml(c)}">${App.escHtml(String(f.properties?.[c] ?? ''))}</td>`).join('')}
                <td><button class="btn btn-sm btn-outline-danger attr-delete-row" data-idx="${idx}" title="${t('editor.delete_row')}"><i class="bi bi-trash"></i></button></td>
            </tr>`;
        });
        tableHtml += `</tbody></table></div>
            <div class="d-flex gap-2 mt-2">
                <button class="btn btn-sm btn-outline-secondary" id="attr-add-column"><i class="bi bi-plus-circle"></i> ${t('editor.add_column')}</button>
            </div>
        `;

        App.modal({
            title: `<i class="bi bi-table"></i> ${t('editor.attribute_table')}`,
            body: tableHtml,
            confirmText: `<i class="bi bi-save"></i> ${t('editor.save_attributes')}`,
            size: 'xl',
            onConfirm: async () => {
                const table = document.getElementById('attr-table');
                if (!table) return true;

                const rows = table.querySelectorAll('tbody tr');
                const deletedIdxs = new Set();
                rows.forEach(row => {
                    if (row.classList.contains('attr-row-deleted')) {
                        deletedIdxs.add(parseInt(row.dataset.featureIdx));
                    }
                });

                const updatedFeatures = [];
                rows.forEach(row => {
                    const fidx = parseInt(row.dataset.featureIdx);
                    if (deletedIdxs.has(fidx)) return;
                    const feature = JSON.parse(JSON.stringify(geojson.features[fidx]));
                    const cells = row.querySelectorAll('td[contenteditable="true"]');
                    cells.forEach(cell => {
                        const propName = cell.dataset.prop;
                        if (propName) {
                            feature.properties[propName] = cell.textContent.trim();
                        }
                    });
                    updatedFeatures.push(feature);
                });

                const updatedGeojson = { ...geojson, features: updatedFeatures };

                try {
                    await fetch(`/api/layers/${layerId}`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + (Api._token || localStorage.getItem('tm_token')),
                        },
                        body: JSON.stringify({ geojson: updatedGeojson }),
                    });
                    App.toast(t('editor.save_attributes') + ' OK', 'success');
                } catch (err) {
                    App.toast(err.message, 'danger');
                }
                return true;
            },
        });

        // Bind delete row buttons and add column after modal renders
        setTimeout(() => {
            document.querySelectorAll('.attr-delete-row').forEach(btn => {
                btn.addEventListener('click', () => {
                    const row = btn.closest('tr');
                    if (row) {
                        row.classList.add('attr-row-deleted');
                        row.style.opacity = '0.3';
                        row.style.textDecoration = 'line-through';
                    }
                });
            });

            document.getElementById('attr-add-column')?.addEventListener('click', () => {
                const colName = prompt(t('editor.add_column'));
                if (!colName) return;
                const table = document.getElementById('attr-table');
                if (!table) return;
                const headerRow = table.querySelector('thead tr');
                const lastTh = headerRow.querySelector('th:last-child');
                const newTh = document.createElement('th');
                newTh.textContent = colName;
                headerRow.insertBefore(newTh, lastTh);
                table.querySelectorAll('tbody tr').forEach(row => {
                    const lastTd = row.querySelector('td:last-child');
                    const newTd = document.createElement('td');
                    newTd.contentEditable = 'true';
                    newTd.dataset.prop = colName;
                    newTd.textContent = '';
                    row.insertBefore(newTd, lastTd);
                });
            });
        }, 150);
    },

    // ── Auto-Refresh Configuration ──────────
    async _configAutoRefresh(layerId) {
        const t = I18n.t.bind(I18n);
        const layer = this._layers.find(l => l.layer_id === layerId);
        if (!layer) return;

        const currentInterval = layer.source_config?.autoRefreshMinutes || 0;

        const result = await App.modal({
            title: t('editor.auto_refresh_title'),
            body: `
                <div class="mb-3">
                    <label class="form-label">${t('editor.auto_refresh_interval')}</label>
                    <select class="form-select" id="modal-refresh-interval">
                        <option value="0" ${currentInterval === 0 ? 'selected' : ''}>${t('editor.auto_refresh_off')}</option>
                        <option value="1" ${currentInterval === 1 ? 'selected' : ''}>1 min</option>
                        <option value="5" ${currentInterval === 5 ? 'selected' : ''}>5 min</option>
                        <option value="15" ${currentInterval === 15 ? 'selected' : ''}>15 min</option>
                        <option value="30" ${currentInterval === 30 ? 'selected' : ''}>30 min</option>
                        <option value="60" ${currentInterval === 60 ? 'selected' : ''}>1 hour</option>
                    </select>
                </div>
                <small class="text-muted"><i class="bi bi-info-circle"></i> ${t('editor.auto_refresh_hint')}</small>
            `,
            confirmText: t('action.save'),
            onConfirm: () => parseInt(document.getElementById('modal-refresh-interval')?.value) || 0,
        });

        if (result === undefined) return;

        try {
            const srcConfig = { ...layer.source_config, autoRefreshMinutes: result };
            await Api.updateLayer(layerId, { source_config: srcConfig });
            layer.source_config = srcConfig;

            // Apply immediately
            if (result > 0) {
                TmMap.startAutoRefresh(layerId, result);
                App.toast(t('editor.auto_refresh_set'), 'success');
            } else {
                TmMap.stopAutoRefresh(layerId);
                App.toast(t('editor.auto_refresh_off'), 'info');
            }
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    // ── Embed Configurator ──────────────────
    async _openEmbedConfigurator() {
        const t = I18n.t.bind(I18n);
        const storyId = this._storyId;
        const baseUrl = window.location.origin + window.location.pathname;

        const result = await App.modal({
            title: t('editor.embed_config'),
            size: 'lg',
            body: `
                <div class="row g-3">
                    <div class="col-md-6">
                        <div class="mb-3">
                            <label class="form-label">${t('editor.embed_width')}</label>
                            <input type="text" class="form-control" id="embed-width" value="100%">
                        </div>
                        <div class="mb-3">
                            <label class="form-label">${t('editor.embed_height')}</label>
                            <input type="text" class="form-control" id="embed-height" value="600px">
                        </div>
                        <div class="mb-3">
                            <label class="form-label">${t('editor.embed_start_slide')}</label>
                            <select class="form-select" id="embed-start-slide">
                                <option value="">— ${t('editor.embed_from_beginning')} —</option>
                                ${this._slides.map((s, i) => `<option value="${i}">${i + 1}. ${App.escHtml(s.title || 'Slide ' + (i + 1))}</option>`).join('')}
                            </select>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">${t('editor.embed_theme')}</label>
                            <select class="form-select" id="embed-theme">
                                <option value="">Default</option>
                                <option value="light">Light</option>
                                <option value="dark">Dark</option>
                            </select>
                        </div>
                        <div class="form-check mb-2">
                            <input class="form-check-input" type="checkbox" id="embed-autoplay">
                            <label class="form-check-label">${t('editor.embed_autoplay')}</label>
                        </div>
                        <div class="form-check mb-2">
                            <input class="form-check-input" type="checkbox" id="embed-hide-toolbar">
                            <label class="form-check-label">${t('editor.embed_hide_toolbar')}</label>
                        </div>
                        <div class="form-check mb-2">
                            <input class="form-check-input" type="checkbox" id="embed-hide-nav">
                            <label class="form-check-label">${t('editor.embed_hide_nav')}</label>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label">${t('editor.embed_preview')}</label>
                        <div id="embed-preview-frame" style="background:var(--tm-bg-muted,#1e1e2e);border:1px solid var(--tm-border,#333);border-radius:8px;padding:16px;min-height:200px;display:flex;align-items:center;justify-content:center;">
                            <small class="text-muted">${t('editor.embed_preview_text')}</small>
                        </div>
                        <label class="form-label mt-3">${t('editor.embed_code')}</label>
                        <textarea class="form-control" id="embed-code-output" rows="4" readonly style="font-family:monospace;font-size:12px"></textarea>
                        <button class="btn btn-sm btn-outline-primary mt-2 w-100" onclick="navigator.clipboard?.writeText(document.getElementById('embed-code-output')?.value);App.toast('Copied!','success')">
                            <i class="bi bi-clipboard"></i> ${t('editor.embed_copy')}
                        </button>
                    </div>
                </div>
            `,
            confirmText: t('action.close'),
            onConfirm: () => true,
            onReady: () => {
                const updateEmbed = () => {
                    const width = document.getElementById('embed-width')?.value || '100%';
                    const height = document.getElementById('embed-height')?.value || '600px';
                    const startSlide = document.getElementById('embed-start-slide')?.value;
                    const theme = document.getElementById('embed-theme')?.value;
                    const autoplay = document.getElementById('embed-autoplay')?.checked;
                    const hideToolbar = document.getElementById('embed-hide-toolbar')?.checked;
                    const hideNav = document.getElementById('embed-hide-nav')?.checked;

                    let embedUrl = baseUrl + '?story=' + storyId + '&embed=true';
                    if (startSlide) embedUrl += '&slide=' + startSlide;
                    if (theme) embedUrl += '&theme=' + theme;
                    if (autoplay) embedUrl += '&autoplay=true';
                    if (hideToolbar) embedUrl += '&toolbar=false';
                    if (hideNav) embedUrl += '&nav=false';

                    const code = `<iframe src="${embedUrl}" width="${width}" height="${height}" frameborder="0" allow="fullscreen" style="border:none;border-radius:8px"></iframe>`;

                    document.getElementById('embed-code-output').value = code;

                    // Mini preview
                    const preview = document.getElementById('embed-preview-frame');
                    preview.innerHTML = `<div style="width:100%;height:120px;background:#0d1117;border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:11px;color:#8b949e;">
                        <i class="bi bi-play-circle" style="font-size:24px;margin-bottom:4px"></i>
                        <span>${width} x ${height}</span>
                        <span>${autoplay ? 'Autoplay' : ''} ${theme ? theme : ''} ${startSlide ? 'Slide ' + (parseInt(startSlide) + 1) : ''}</span>
                    </div>`;
                };

                ['embed-width', 'embed-height', 'embed-start-slide', 'embed-theme'].forEach(id => {
                    document.getElementById(id)?.addEventListener('input', updateEmbed);
                    document.getElementById(id)?.addEventListener('change', updateEmbed);
                });
                ['embed-autoplay', 'embed-hide-toolbar', 'embed-hide-nav'].forEach(id => {
                    document.getElementById(id)?.addEventListener('change', updateEmbed);
                });

                updateEmbed(); // Initial render
            },
        });
    },
};
