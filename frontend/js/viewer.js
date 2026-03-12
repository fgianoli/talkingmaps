/**
 * TalkingMaps – Story Viewer
 * Scroll-driven storytelling engine inspired by ESRI StoryMaps & Odyssey.js
 * Supports: 2D maps (MapLibre), 3D globe (Cesium), charts, dashboards,
 *           point clouds (Potree), iframes, media backgrounds
 */
const StoryViewer = {
    _data: null,
    _currentSlide: 0,
    _slides: [],
    _observer: null,
    _map: null,
    _is3D: false,
    _chartInstances: [],

    /**
     * Load and display a full story
     * @param {object} data - { story, slides, markers, layers, basemaps }
     */
    load(data) {
        this._data = data;
        this._slides = data.slides.filter(s => s.visible !== false);
        this._currentSlide = 0;

        const viewer = document.getElementById('story-viewer');
        viewer.classList.remove('d-none');

        // Title
        document.getElementById('viewer-title').textContent = data.story.title;
        document.getElementById('viewer-progress').textContent = `1 / ${this._slides.length}`;

        // Init 2D map
        this._initMap(data);

        // Build narrative
        this._buildNarrative();

        // Setup scroll observer
        this._setupScrollObserver();

        // Setup keyboard navigation
        this._setupKeyboard();

        // Navigation buttons
        document.getElementById('viewer-prev').onclick = () => this.goTo(this._currentSlide - 1);
        document.getElementById('viewer-next').onclick = () => this.goTo(this._currentSlide + 1);

        // 3D toggle
        document.getElementById('viewer-toggle-3d').onclick = () => this._toggle3D();

        // Basemap selector
        this._setupBasemapSelector(data.basemaps);

        // Load initial slide
        setTimeout(() => this._onSlideEnter(0), 500);
    },

    destroy() {
        TmMap.destroy();
        Cesium3D.destroy();
        TmCharts.destroyAll();
        if (this._observer) this._observer.disconnect();
        document.removeEventListener('keydown', this._keyHandler);
        this._data = null;
        this._slides = [];
        this._chartInstances = [];
    },

    goTo(index) {
        if (index < 0 || index >= this._slides.length) return;
        const slideEl = document.querySelector(`[data-slide-index="${index}"]`);
        if (slideEl) slideEl.scrollIntoView({ behavior: 'smooth' });
    },

    // ── Map Init ─────────────────────────
    _initMap(data) {
        const firstSlide = this._slides[0];
        const center = firstSlide?.map_center
            ? [firstSlide.map_center.lng, firstSlide.map_center.lat]
            : [12.49, 41.89]; // Rome default

        this._map = TmMap.init('viewer-map', {
            center,
            zoom: firstSlide?.map_zoom || 5,
            bearing: firstSlide?.map_bearing || 0,
            pitch: firstSlide?.map_pitch || 0,
            basemaps: data.basemaps,
        });

        // Add story layers
        if (data.layers) {
            data.layers.forEach(l => {
                TmMap.addLayer({
                    id: l.layer_id,
                    layer_type: l.layer_type,
                    source_config: l.source_config,
                    style_config: l.custom_style && Object.keys(l.custom_style).length ? l.custom_style : l.style_config,
                    opacity: l.opacity,
                });
                if (!l.visible) TmMap.setLayerVisibility(l.layer_id, false);
            });
        }
    },

    // ── Narrative Build ──────────────────
    _buildNarrative() {
        const container = document.getElementById('viewer-narrative');
        container.innerHTML = '';

        // Determine default layout from first slide
        const defaultLayout = this._slides[0]?.layout || 'side-left';
        container.className = `layout-${defaultLayout}`;

        this._slides.forEach((slide, idx) => {
            const slideEl = document.createElement('div');
            slideEl.className = `viewer-slide slide-${slide.layout || 'side-left'}`;
            slideEl.dataset.slideIndex = idx;

            // Content block
            const content = document.createElement('div');
            content.className = 'viewer-slide-content';

            // Title
            if (slide.title && slide.layout !== 'full-map') {
                content.innerHTML += `<h2>${slide.title}</h2>`;
            }

            // Narrative HTML
            if (slide.narrative) {
                content.innerHTML += slide.narrative;
            }

            // Process embedded elements in narrative
            this._processEmbeds(content, slide, idx);

            slideEl.appendChild(content);

            // Background media
            if (slide.background_media) {
                const bgStyle = `background-image:url('${slide.background_media}');background-size:cover;background-position:center;`;
                slideEl.style.cssText += bgStyle;
                if (slide.background_opacity !== null && slide.background_opacity !== undefined) {
                    const overlay = document.createElement('div');
                    overlay.style.cssText = `position:absolute;inset:0;background:rgba(0,0,0,${1 - slide.background_opacity});pointer-events:none;`;
                    slideEl.insertBefore(overlay, content);
                }
            }

            // Scroll hint on first slide
            if (idx === 0 && this._slides.length > 1) {
                slideEl.innerHTML += `<div class="scroll-hint"><i class="bi bi-chevron-double-down"></i></div>`;
            }

            container.appendChild(slideEl);
        });
    },

    /**
     * Process embedded content markers in narrative HTML
     * Supports: [chart:config], [dashboard:config], [iframe:url], [potree:url], [3d:config]
     */
    _processEmbeds(contentEl, slide, slideIdx) {
        // Charts from style_overrides
        const overrides = slide.style_overrides || {};
        if (overrides.chart) {
            const chartContainer = document.createElement('div');
            chartContainer.className = 'slide-chart-container';
            contentEl.appendChild(chartContainer);
            // Defer chart creation until slide is visible
            chartContainer.dataset.chartConfig = JSON.stringify(overrides.chart);
        }

        // Dashboard widgets
        if (overrides.dashboard) {
            const dashContainer = document.createElement('div');
            dashContainer.className = 'slide-dashboard';
            contentEl.appendChild(dashContainer);
            TmCharts.renderDashboardWidgets(dashContainer, overrides.dashboard);
        }

        // Iframe
        if (overrides.iframe) {
            const iframeContainer = document.createElement('div');
            iframeContainer.className = 'slide-iframe-container';
            iframeContainer.innerHTML = `<iframe src="${this._sanitizeUrl(overrides.iframe.url)}"
                allow="fullscreen" loading="lazy"
                style="height:${overrides.iframe.height || 400}px"></iframe>`;
            contentEl.appendChild(iframeContainer);
        }

        // Potree point cloud
        if (overrides.potree) {
            const potreeContainer = document.createElement('div');
            potreeContainer.className = 'slide-potree-container';
            potreeContainer.id = `potree-${slideIdx}`;
            potreeContainer.style.cssText = `width:100%;height:${overrides.potree.height || 400}px;border-radius:var(--tm-radius-sm);overflow:hidden;margin:16px 0;`;
            contentEl.appendChild(potreeContainer);
            potreeContainer.dataset.potreeConfig = JSON.stringify(overrides.potree);
        }

        // 3D Tileset (Cesium inline)
        if (overrides.tileset3d) {
            const badge = document.createElement('span');
            badge.className = 'badge-3d';
            badge.textContent = '3D';
            contentEl.querySelector('h2')?.appendChild(badge);
        }
    },

    _sanitizeUrl(url) {
        try {
            const u = new URL(url, window.location.origin);
            return u.toString();
        } catch {
            return '';
        }
    },

    // ── Scroll Observer ──────────────────
    _setupScrollObserver() {
        if (this._observer) this._observer.disconnect();

        this._observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && entry.intersectionRatio > 0.4) {
                    const idx = parseInt(entry.target.dataset.slideIndex);
                    if (idx !== this._currentSlide) {
                        this._currentSlide = idx;
                        this._onSlideEnter(idx);
                    }
                }
            });
        }, {
            root: document.getElementById('viewer-narrative'),
            threshold: [0.4, 0.6, 0.8],
        });

        document.querySelectorAll('.viewer-slide').forEach(el => {
            this._observer.observe(el);
        });
    },

    // ── Slide Transition ─────────────────
    _onSlideEnter(index) {
        const slide = this._slides[index];
        if (!slide) return;

        // Update progress
        document.getElementById('viewer-progress').textContent = `${index + 1} / ${this._slides.length}`;

        // Update layout class on narrative container
        const container = document.getElementById('viewer-narrative');
        container.className = container.className.replace(/layout-\S+/, '') + ` layout-${slide.layout || 'side-left'}`;

        // Camera animation
        if (slide.map_center) {
            if (this._is3D) {
                Cesium3D.flyTo({
                    position: [slide.map_center.lng, slide.map_center.lat, this._zoomToHeight(slide.map_zoom || 10)],
                    heading: slide.map_bearing || 0,
                    pitch: -(slide.map_pitch || 45),
                    duration: 2,
                });
            } else {
                TmMap.flyTo({
                    center: [slide.map_center.lng, slide.map_center.lat],
                    zoom: slide.map_zoom || 10,
                    bearing: slide.map_bearing || 0,
                    pitch: slide.map_pitch || 0,
                    animation: slide.map_animation || 'flyTo',
                    duration: 2000,
                });
            }
        } else if (slide.map_bounds) {
            TmMap.fitBounds(slide.map_bounds);
        }

        // Layer visibility for this slide
        if (slide.layer_visibility && this._data.layers) {
            this._data.layers.forEach(l => {
                const vis = slide.layer_visibility[l.layer_id];
                if (vis !== undefined) {
                    TmMap.setLayerVisibility(l.layer_id, vis);
                }
            });
        }

        // Markers
        const slideMarkers = (this._data.markers || []).filter(m => m.slide_id === slide.id);
        TmMap.addMarkers(slideMarkers);

        // Lazy render charts
        const chartEl = document.querySelector(`[data-slide-index="${index}"] .slide-chart-container`);
        if (chartEl && chartEl.dataset.chartConfig && !chartEl.dataset.rendered) {
            try {
                const config = JSON.parse(chartEl.dataset.chartConfig);
                TmCharts.renderSlideChart(chartEl, config);
                chartEl.dataset.rendered = 'true';
            } catch { /* ok */ }
        }

        // Lazy render Potree
        const potreeEl = document.querySelector(`[data-slide-index="${index}"] .slide-potree-container`);
        if (potreeEl && potreeEl.dataset.potreeConfig && !potreeEl.dataset.rendered) {
            try {
                const config = JSON.parse(potreeEl.dataset.potreeConfig);
                PotreeViewer.init(potreeEl.id, config);
                potreeEl.dataset.rendered = 'true';
            } catch { /* ok */ }
        }

        // Highlight active slide thumb (if visible in toolbar)
        document.querySelectorAll('.viewer-slide').forEach((el, i) => {
            el.classList.toggle('active', i === index);
        });

        // Auto-hide toolbar after a few seconds
        this._autoHideToolbar();
    },

    _autoHideToolbar() {
        const toolbar = document.getElementById('viewer-toolbar');
        toolbar.classList.remove('hidden');
        clearTimeout(this._toolbarTimer);
        this._toolbarTimer = setTimeout(() => {
            toolbar.classList.add('hidden');
        }, 4000);

        // Show on mouse move
        document.getElementById('story-viewer').onmousemove = () => {
            toolbar.classList.remove('hidden');
            clearTimeout(this._toolbarTimer);
            this._toolbarTimer = setTimeout(() => toolbar.classList.add('hidden'), 4000);
        };
    },

    // ── 3D Toggle ────────────────────────
    _toggle3D() {
        this._is3D = !this._is3D;
        const mapEl = document.getElementById('viewer-map');
        const cesiumEl = document.getElementById('viewer-cesium');
        const btn = document.getElementById('viewer-toggle-3d');

        if (this._is3D) {
            mapEl.style.display = 'none';
            cesiumEl.classList.remove('d-none');
            cesiumEl.style.display = 'block';
            btn.classList.add('active');

            // Init Cesium if not already
            if (!Cesium3D.isActive()) {
                const state = TmMap.getState();
                Cesium3D.init('viewer-cesium', {
                    camera: {
                        position: [state.center.lng, state.center.lat, this._zoomToHeight(state.zoom)],
                        heading: state.bearing || 0,
                        pitch: -45,
                    },
                });

                // Add 3D markers
                const slide = this._slides[this._currentSlide];
                const slideMarkers = (this._data.markers || []).filter(m => m.slide_id === slide?.id);
                slideMarkers.forEach(m => Cesium3D.addMarker3D(m));

                // Load 3D tilesets from story settings
                const settings = this._data.story.settings || {};
                if (settings.tilesets) {
                    settings.tilesets.forEach(t => Cesium3D.addTileset(t));
                }
            } else {
                Cesium3D.syncFrom2D(TmMap.getState());
            }
        } else {
            mapEl.style.display = 'block';
            cesiumEl.style.display = 'none';
            btn.classList.remove('active');
        }
    },

    _zoomToHeight(zoom) {
        return 40000000 / Math.pow(2, zoom || 10);
    },

    // ── Basemap Selector ─────────────────
    _setupBasemapSelector(basemaps) {
        const selector = document.getElementById('viewer-basemap-selector');
        const btn = document.getElementById('viewer-basemap-btn');

        if (!basemaps || basemaps.length === 0) {
            btn.style.display = 'none';
            return;
        }

        selector.innerHTML = basemaps.map((b, i) => `
            <div class="basemap-option ${i === 0 ? 'active' : ''}" data-index="${i}" title="${b.name}">
                <div style="width:80px;height:60px;background:var(--tm-surface-light);display:flex;align-items:center;justify-content:center;">
                    <i class="bi bi-map" style="font-size:20px;color:var(--tm-text-muted)"></i>
                </div>
                <span>${b.name}</span>
            </div>
        `).join('');

        btn.onclick = () => selector.classList.toggle('d-none');

        selector.addEventListener('click', (e) => {
            const opt = e.target.closest('.basemap-option');
            if (!opt) return;
            const idx = parseInt(opt.dataset.index);
            TmMap.setBasemap(basemaps[idx]);
            selector.querySelectorAll('.basemap-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            selector.classList.add('d-none');
        });
    },

    // ── Keyboard ─────────────────────────
    _setupKeyboard() {
        this._keyHandler = (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === ' ') {
                e.preventDefault();
                this.goTo(this._currentSlide + 1);
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                e.preventDefault();
                this.goTo(this._currentSlide - 1);
            } else if (e.key === 'Escape') {
                document.getElementById('viewer-close')?.click();
            } else if (e.key === 'f' || e.key === 'F') {
                document.getElementById('story-viewer')?.requestFullscreen?.();
            }
        };
        document.addEventListener('keydown', this._keyHandler);
    },
};
