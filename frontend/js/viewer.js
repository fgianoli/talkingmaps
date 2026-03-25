/**
 * TalkingMaps – Story Viewer
 * Scroll-driven storytelling engine inspired by ESRI StoryMaps & Odyssey.js
 * Supports: 2D maps (MapLibre), 3D globe (Cesium), charts, dashboards,
 *           point clouds (Potree), iframes, media backgrounds
 *
 * Per-slide layout: each slide independently positions its content
 * (side-left, side-right, center, cover, full-map, full-media,
 *  text-only, text-media, separator)
 */
const StoryViewer = {
    _data: null,
    _currentSlide: 0,
    _slides: [],
    _observer: null,
    _map: null,
    _is3D: false,
    _chartInstances: [],

    // Timeline state
    _timelineInterval: null,
    _timelinePlaying: false,

    // Audio state
    _currentAudio: null,

    // Contributions (participatory maps)
    _contributions: [],
    _contributionMarkers: [],
    _contributionMode: false,  // true when user is placing a point

    // Layouts that show the map (2D or 3D) — cover hides the map (fullscreen copertina)
    // image-map: navigable image (painting, floor plan) via MapLibre image source
    _mapLayouts: ['side-left', 'side-right', 'center', 'full-map', 'image-map', 'globe-3d', 'potree-3d'],
    _3dLayouts: ['globe-3d', 'potree-3d'],

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

        // Apply story theme
        const theme = data.story.settings?.theme || 'light';
        viewer.setAttribute('data-theme', theme);

        // Embed mode: hide toolbar/close button
        if (App.embedMode) {
            const toolbar = document.getElementById('viewer-toolbar');
            if (toolbar) toolbar.classList.add('d-none');
            const closeBtn = document.getElementById('viewer-close');
            if (closeBtn) closeBtn.classList.add('d-none');
        }

        // Inject custom CSS if present
        this._injectCustomCSS(data.story.settings?.custom_css);

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

        // Setup touch swipe for mobile
        this._setupTouchSwipe();

        // Mobile swipe hint
        if ('ontouchstart' in window && !sessionStorage.getItem('tm_swipe_hint')) {
            const hint = document.createElement('div');
            hint.className = 'mobile-swipe-hint';
            hint.innerHTML = '<i class="bi bi-hand-index"></i> Swipe to navigate';
            document.getElementById('story-viewer')?.appendChild(hint);
            sessionStorage.setItem('tm_swipe_hint', '1');
            setTimeout(() => hint.remove(), 3500);
        }

        // Navigation buttons
        document.getElementById('viewer-prev').onclick = () => this.goTo(this._currentSlide - 1);
        document.getElementById('viewer-next').onclick = () => this.goTo(this._currentSlide + 1);

        // 3D toggle
        document.getElementById('viewer-toggle-3d').onclick = () => this._toggle3D();

        // Basemap selector
        this._setupBasemapSelector(data.basemaps);

        // Share button
        document.getElementById('viewer-share-btn').onclick = () => {
            const url = window.location.origin + window.location.pathname + '#/view/' + data.story.id;
            const embed = `<iframe src="${url}" width="100%" height="600" frameborder="0" allow="fullscreen" style="border:none"></iframe>`;
            navigator.clipboard?.writeText(url);
            App.toast(I18n.t('editor.share_copied') || 'Link copied!', 'success');
        };

        // Print button
        document.getElementById('viewer-print-btn').onclick = () => this._printSlide();

        // Geocode search in viewer
        this._setupViewerGeocode();

        // Build Table of Contents (chapters)
        this._buildTOC();

        // Load contributions if participatory mode is enabled
        if (data.story.settings?.participatory_enabled) {
            this._initParticipatory(data.story);
        }

        // Build unguided navigation if enabled
        if (data.story.settings?.navigation_mode === 'unguided') {
            this._buildUnguidedNav();
        }

        // Handle hotspot links (data-tm-link clicks)
        document.getElementById('viewer-narrative').addEventListener('click', (e) => {
            const link = e.target.closest('[data-tm-link]');
            if (!link) return;
            e.preventDefault();
            const val = link.getAttribute('data-tm-link');
            if (!val) return;
            const [type, id] = val.split(':');
            if (type === 'marker') {
                const marker = (this._data.markers || []).find(m => String(m.id) === id);
                if (marker) {
                    TmMap.flyTo({
                        center: [marker.lng, marker.lat],
                        zoom: Math.max(this._map ? TmMap.getState().zoom : 14, 14),
                        duration: 1500,
                    });
                }
            } else if (type === 'layer') {
                const layer = (this._data.layers || []).find(l => l.layer_id === id);
                if (layer) {
                    TmMap.setLayerVisibility(id, true);
                    // Brief highlight pulse
                    const map = TmMap.getMap();
                    if (map && map.getLayer(id)) {
                        const origOpacity = map.getPaintProperty(id, 'fill-opacity') || map.getPaintProperty(id, 'line-opacity') || 1;
                        map.setPaintProperty(id, map.getLayer(id).type === 'line' ? 'line-opacity' : 'fill-opacity', 0.2);
                        setTimeout(() => {
                            try { map.setPaintProperty(id, map.getLayer(id).type === 'line' ? 'line-opacity' : 'fill-opacity', origOpacity); } catch {}
                        }, 800);
                    }
                }
            }
        });

        // Make map interactive: pointer events pass through empty slide areas
        this._setupMapInteractivity();

        // Load initial slide
        setTimeout(() => this._onSlideEnter(0), 500);

        // Autoplay: auto-scroll slides every 8 seconds
        if (App.embedMode && App.embedOptions.autoplay) {
            this._startAutoplay();
        }
    },

    _injectCustomCSS(css) {
        this._removeCustomCSS();
        if (!css || !css.trim()) return;
        const style = document.createElement('style');
        style.id = 'tm-custom-story-css';
        style.textContent = css;
        document.head.appendChild(style);
    },

    _removeCustomCSS() {
        const existing = document.getElementById('tm-custom-story-css');
        if (existing) existing.remove();
    },

    _autoplayTimer: null,

    _startAutoplay() {
        this._stopAutoplay();
        this._autoplayTimer = setInterval(() => {
            const next = this._currentSlide + 1;
            if (next < this._slides.length) {
                this.goTo(next);
            } else {
                this.goTo(0); // loop back to start
            }
        }, 8000);
    },

    _stopAutoplay() {
        if (this._autoplayTimer) {
            clearInterval(this._autoplayTimer);
            this._autoplayTimer = null;
        }
    },

    destroy() {
        TmMap.stopAllAutoRefresh();
        TmMap.disableCompare();
        TmMap.destroy();
        Cesium3D.destroy();
        TmCharts.destroyAll();
        this._removeCustomCSS();
        this._stopAutoplay();
        if (this._observer) this._observer.disconnect();
        document.removeEventListener('keydown', this._keyHandler);
        // Remove TOC elements
        document.getElementById('viewer-toc-toggle')?.remove();
        document.getElementById('viewer-toc-panel')?.remove();
        // Cleanup timeline
        this._stopTimeline();
        document.getElementById('viewer-timeline-control')?.remove();
        // Cleanup audio
        if (this._currentAudio) {
            this._currentAudio.pause();
            this._currentAudio = null;
        }
        // Cleanup contributions
        this._contributionMarkers.forEach(m => m.remove());
        this._contributionMarkers = [];
        this._contributions = [];
        document.getElementById('tm-contribute-btn')?.remove();
        document.getElementById('tm-contribution-panel')?.remove();
        this._data = null;
        this._slides = [];
        this._chartInstances = [];
        this._chapters = [];
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
                // Start auto-refresh if configured
                if (l.source_config?.autoRefreshMinutes > 0) {
                    TmMap.startAutoRefresh(l.layer_id, l.source_config.autoRefreshMinutes);
                }
            });
        }
    },

    // ── Narrative Build (per-slide layout) ──
    _buildNarrative() {
        const container = document.getElementById('viewer-narrative');
        container.innerHTML = '';
        // Remove fixed positioning classes — we use per-slide layout now
        container.className = 'viewer-narrative-scroll';

        this._slides.forEach((slide, idx) => {
            const layout = slide.layout || 'side-left';
            const hasMap = this._mapLayouts.includes(layout);

            const slideEl = document.createElement('div');
            slideEl.className = `viewer-slide slide-layout-${layout}`;
            slideEl.dataset.slideIndex = idx;
            slideEl.dataset.layout = layout;
            slideEl.dataset.transition = slide.style_overrides?.transition || 'fade';

            // Content block with card style and text alignment
            const content = document.createElement('div');
            const cardStyle = slide.style_overrides?.card_style || 'card';
            const textAlign = slide.style_overrides?.text_align || 'left';
            content.className = `viewer-slide-content viewer-card-${cardStyle}`;
            if (textAlign !== 'left') content.style.textAlign = textAlign;

            // Title (sanitized)
            if (slide.title && layout !== 'full-map') {
                const titleTag = layout === 'separator' ? 'h1' : 'h2';
                content.innerHTML += `<${titleTag}>${App.escHtml(slide.title)}</${titleTag}>`;
            }

            // Narrative HTML (sanitized via DOMPurify)
            if (slide.narrative && layout !== 'separator') {
                content.innerHTML += App.sanitize(slide.narrative);
            }

            // Process embedded elements in narrative
            this._processEmbeds(content, slide, idx);

            // For text-media: wrap content + background media side by side
            if (layout === 'text-media' && slide.background_media) {
                const wrapper = document.createElement('div');
                wrapper.className = 'viewer-text-media-wrapper';

                const textSide = document.createElement('div');
                textSide.className = 'viewer-text-media-text';
                textSide.appendChild(content);

                const mediaSide = document.createElement('div');
                mediaSide.className = 'viewer-text-media-media';
                const bgMedia = this._sanitizeUrl(slide.background_media);
                const isVideo = /\.(mp4|webm|ogg)/i.test(bgMedia);
                if (isVideo) {
                    const vid = document.createElement('video');
                    vid.src = bgMedia; vid.autoplay = true; vid.muted = true; vid.loop = true; vid.playsInline = true;
                    vid.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:12px';
                    mediaSide.appendChild(vid);
                } else {
                    const img = document.createElement('img');
                    img.src = bgMedia; img.alt = '';
                    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:12px';
                    mediaSide.appendChild(img);
                }

                wrapper.appendChild(textSide);
                wrapper.appendChild(mediaSide);
                slideEl.appendChild(wrapper);
            } else {
                slideEl.appendChild(content);

                // Background media (for non text-media layouts)
                if (slide.background_media && layout !== 'text-media') {
                    const safeUrl = this._sanitizeUrl(slide.background_media);
                    slideEl.style.backgroundImage = `url('${safeUrl}')`;
                    slideEl.style.backgroundSize = 'cover';
                    slideEl.style.backgroundPosition = 'center';
                    if (slide.background_opacity !== null && slide.background_opacity !== undefined) {
                        const opacity = Math.max(0, Math.min(1, parseFloat(slide.background_opacity) || 1));
                        const overlay = document.createElement('div');
                        overlay.style.cssText = `position:absolute;inset:0;background:rgba(0,0,0,${1 - opacity});pointer-events:none;`;
                        slideEl.insertBefore(overlay, slideEl.firstChild);
                    }
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
     */
    _processEmbeds(contentEl, slide, slideIdx) {
        const overrides = slide.style_overrides || {};
        if (overrides.chart) {
            const chartContainer = document.createElement('div');
            chartContainer.className = 'slide-chart-container';
            contentEl.appendChild(chartContainer);
            chartContainer.dataset.chartConfig = JSON.stringify(overrides.chart);
        }

        if (overrides.dashboard) {
            const dashContainer = document.createElement('div');
            dashContainer.className = 'slide-dashboard';
            contentEl.appendChild(dashContainer);
            TmCharts.renderDashboardWidgets(dashContainer, overrides.dashboard);
        }

        if (overrides.iframe) {
            const iframeContainer = document.createElement('div');
            iframeContainer.className = 'slide-iframe-container';
            iframeContainer.innerHTML = `<iframe src="${this._sanitizeUrl(overrides.iframe.url)}"
                allow="fullscreen" loading="lazy"
                style="height:${overrides.iframe.height || 400}px"></iframe>`;
            contentEl.appendChild(iframeContainer);
        }

        if (overrides.potree) {
            const potreeContainer = document.createElement('div');
            potreeContainer.className = 'slide-potree-container';
            potreeContainer.id = `potree-${slideIdx}`;
            potreeContainer.style.cssText = `width:100%;height:${overrides.potree.height || 400}px;border-radius:var(--tm-radius-sm);overflow:hidden;margin:16px 0;`;
            contentEl.appendChild(potreeContainer);
            potreeContainer.dataset.potreeConfig = JSON.stringify(overrides.potree);
        }

        if (overrides.tileset3d) {
            const badge = document.createElement('span');
            badge.className = 'badge-3d';
            badge.textContent = '3D';
            contentEl.querySelector('h2')?.appendChild(badge);
        }

        // Gallery / Slideshow
        if (overrides.gallery && overrides.gallery.images?.length) {
            const galleryContainer = document.createElement('div');
            galleryContainer.className = 'slide-gallery-container';
            contentEl.appendChild(galleryContainer);
            TmGallery.render(galleryContainer, overrides.gallery.images, overrides.gallery);
        }

        // TimelineJS
        if (overrides.timelinejs && overrides.timelinejs.events?.length) {
            const tljsContainer = document.createElement('div');
            tljsContainer.className = 'slide-timelinejs-container';
            tljsContainer.id = `timelinejs-${slideIdx}`;
            tljsContainer.style.cssText = 'width:100%;height:400px;margin:16px 0;border-radius:var(--tm-radius-sm);overflow:hidden;';
            contentEl.appendChild(tljsContainer);
            // Defer initialization to allow DOM to settle
            setTimeout(() => this._initTimelineJS(tljsContainer, overrides.timelinejs), 200);
        }

        // Express Map inline (scan for .express-map divs in narrative)
        setTimeout(() => {
            const expressMaps = contentEl.querySelectorAll('.express-map');
            expressMaps.forEach((el, i) => {
                this._initExpressMap(el, slideIdx, i);
            });
        }, 100);
    },

    /**
     * Initialize a TimelineJS instance
     */
    _initTimelineJS(container, config) {
        if (typeof TL === 'undefined') {
            console.warn('TimelineJS (TL) not loaded');
            return;
        }
        // Convert our simple format to TimelineJS format
        const tljsData = {
            events: config.events.map(evt => {
                const tljsEvt = {};
                // Parse date
                if (evt.date) {
                    const parts = evt.date.split('-');
                    tljsEvt.start_date = { year: parts[0] || '', month: parts[1] || '', day: parts[2] || '' };
                }
                tljsEvt.text = { headline: evt.title || '', text: evt.text || '' };
                if (evt.media_url) {
                    tljsEvt.media = { url: evt.media_url };
                }
                // Store location as custom property for map interaction
                if (evt.location && evt.location.lat && evt.location.lng) {
                    tljsEvt._tm_location = evt.location;
                }
                return tljsEvt;
            })
        };

        try {
            const timeline = new TL.Timeline(container.id, tljsData, config.options || {});
            // Listen for slide changes — fly to location if available
            timeline.on('change', (data) => {
                const evtIndex = data?.unique_id ? tljsData.events.findIndex(e => e.unique_id === data.unique_id) : -1;
                // Also try by index from the current_slide
                const idx = timeline.current_id ? tljsData.events.findIndex(e => e.unique_id === timeline.current_id) : -1;
                const finalIdx = evtIndex >= 0 ? evtIndex : idx;
                if (finalIdx >= 0 && tljsData.events[finalIdx]?._tm_location) {
                    const loc = tljsData.events[finalIdx]._tm_location;
                    if (this._map) {
                        this._map.flyTo({ center: [loc.lng, loc.lat], zoom: 14, duration: 1500 });
                    }
                }
            });
        } catch (err) {
            console.error('TimelineJS init failed:', err);
        }
    },

    /**
     * Initialize an inline Express Map (mini-map)
     */
    _initExpressMap(el, slideIdx, mapIdx) {
        if (el.dataset.initialized) return;
        el.dataset.initialized = 'true';
        const lat = parseFloat(el.dataset.lat) || 0;
        const lng = parseFloat(el.dataset.lng) || 0;
        const zoom = parseFloat(el.dataset.zoom) || 10;
        const showMarker = el.dataset.marker === 'true';
        const size = el.dataset.size || 'medium';

        // Clear placeholder content
        el.innerHTML = '';
        el.classList.add(`express-map-${size}`);
        el.id = `express-map-${slideIdx}-${mapIdx}`;

        try {
            const miniMap = new maplibregl.Map({
                container: el.id,
                style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
                center: [lng, lat],
                zoom: zoom,
                interactive: true,
                attributionControl: false,
            });
            if (showMarker) {
                new maplibregl.Marker().setLngLat([lng, lat]).addTo(miniMap);
            }
        } catch (err) {
            console.error('Express map init failed:', err);
            el.innerHTML = `<div style="padding:16px;text-align:center;color:#94a3b8"><i class="bi bi-exclamation-triangle"></i> Map failed to load</div>`;
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

        const layout = slide.layout || 'side-left';
        const hasMap = this._mapLayouts.includes(layout);
        const is3DLayout = this._3dLayouts.includes(layout);

        // Update progress
        document.getElementById('viewer-progress').textContent = `${index + 1} / ${this._slides.length}`;

        // Show/hide map based on layout
        const mapContainer = document.getElementById('viewer-map-container');
        if (hasMap) {
            mapContainer.classList.remove('viewer-map-hidden');
            if (this._map) setTimeout(() => this._map.resize(), 100);
        } else {
            mapContainer.classList.add('viewer-map-hidden');
        }

        // Auto-switch to 3D for globe-3d/potree-3d layouts, back to 2D for others
        if (is3DLayout && !this._is3D) {
            this._toggle3D();
        } else if (!is3DLayout && this._is3D) {
            this._toggle3D();
        }

        // Per-slide basemap
        if (hasMap && !is3DLayout) {
            if (layout === 'image-map' && slide.map_config?.image_url) {
                // Navigable image: use MapLibre image source as basemap
                TmMap.setBasemap({
                    type: 'image',
                    url: slide.map_config.image_url,
                    name: 'Navigable Image',
                });
            } else if (slide.basemap_id === 'none') {
                TmMap.setBasemap(null, true); // no background
            } else if (slide.basemap_id) {
                const basemap = (this._data.basemaps || []).find(b => b.id == slide.basemap_id);
                if (basemap) TmMap.setBasemap(basemap);
            } else {
                TmMap.setBasemap((this._data.basemaps || [])[0] || null);
            }
        }

        // Camera animation (only for map layouts)
        if (hasMap && slide.map_center) {
            if (this._is3D || is3DLayout) {
                Cesium3D.flyTo({
                    position: [slide.map_center.lng, slide.map_center.lat, this._zoomToHeight(slide.map_zoom || 10)],
                    heading: slide.map_bearing || 0,
                    pitch: -(slide.map_pitch || 45),
                    duration: 2,
                });
            } else {
                const anim = slide.map_animation || 'flyTo';
                if (anim === 'cinematic') {
                    TmMap.cinematicFlyTo({
                        center: [slide.map_center.lng, slide.map_center.lat],
                        zoom: slide.map_zoom || 10,
                        bearing: slide.map_bearing || 0,
                        pitch: slide.map_pitch || 0,
                        duration: 3000,
                    });
                } else {
                    TmMap.flyTo({
                        center: [slide.map_center.lng, slide.map_center.lat],
                        zoom: slide.map_zoom || 10,
                        bearing: slide.map_bearing || 0,
                        pitch: slide.map_pitch || 0,
                        animation: anim,
                        duration: 2000,
                    });
                }
            }
        } else if (hasMap && slide.map_bounds) {
            TmMap.fitBounds(slide.map_bounds);
        }

        // Load 3D tilesets for this slide if globe-3d layout
        if (layout === 'globe-3d' && slide.style_overrides?.tileset3d) {
            const ts = slide.style_overrides.tileset3d;
            if (ts.ionAssetId) {
                Cesium3D.addTileset({ ionAssetId: ts.ionAssetId, id: `slide-${index}-tileset` });
            } else if (ts.url) {
                Cesium3D.addTileset({ url: ts.url, id: `slide-${index}-tileset` });
            }
        }

        // Map comparison (swipe)
        const compare = slide.style_overrides?.compare;
        if (compare?.enabled && compare.basemap_id && hasMap && !is3DLayout) {
            const basemap = (this._data.basemaps || []).find(b => b.id == compare.basemap_id);
            if (basemap) {
                TmMap.enableCompare(basemap);
            }
        } else {
            TmMap.disableCompare();
        }

        // Layer visibility + opacity for this slide
        if (this._data.layers) {
            this._data.layers.forEach(l => {
                const override = slide.layer_visibility?.[l.layer_id];
                if (override !== undefined) {
                    // Support both old boolean format and new {visible, opacity} format
                    if (typeof override === 'object') {
                        TmMap.setLayerVisibility(l.layer_id, override.visible !== false);
                        if (override.opacity !== undefined) TmMap.setLayerOpacity(l.layer_id, override.opacity);
                    } else {
                        TmMap.setLayerVisibility(l.layer_id, !!override);
                    }
                } else {
                    // Reset to default
                    TmMap.setLayerVisibility(l.layer_id, l.visible !== false);
                    TmMap.setLayerOpacity(l.layer_id, l.opacity ?? 1);
                }
            });
        }

        // Markers
        const slideMarkers = (this._data.markers || []).filter(m => m.slide_id === slide.id);
        TmMap.addMarkers(slideMarkers);

        // Re-render contribution markers (participatory)
        if (this._data.story.settings?.participatory_enabled) {
            this._renderContributionMarkers();
        }

        // Drawn features (lines/polygons)
        this._renderDrawnFeatures(slide);

        // Legend
        this._renderLegend(slide);

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

        // Animate slide content entrance
        const slideEl = document.querySelector(`[data-slide-index="${index}"]`);
        if (slideEl) {
            const content = slideEl.querySelector('.viewer-slide-content');
            if (content) {
                content.classList.remove('slide-animate-in');
                void content.offsetWidth; // force reflow
                content.classList.add('slide-animate-in');
            }
        }

        // Highlight active slide
        document.querySelectorAll('.viewer-slide').forEach((el, i) => {
            el.classList.toggle('active', i === index);
        });

        // Update TOC highlight
        this._updateTOCHighlight(index);

        // Update unguided nav
        this._updateUnguidedNav(index);

        // ── Timeline ──
        this._stopTimeline();
        document.getElementById('viewer-timeline-control')?.remove();
        const timeline = slide.map_config?.timeline;
        if (timeline?.enabled && timeline.layer_id && timeline.date_field && hasMap) {
            this._initTimeline(slide, timeline);
        }

        // ── Audio ──
        if (this._currentAudio) {
            this._currentAudio.pause();
            this._currentAudio = null;
        }
        if (slide.audio_url) {
            this._initSlideAudio(slide, index);
        }

        // Auto-hide toolbar after a few seconds
        this._autoHideToolbar();
    },

    _initParticipatory(story) {
        // Add "Contribute" floating button to viewer
        const viewer = document.getElementById('story-viewer');

        // Remove old elements
        document.getElementById('tm-contribute-btn')?.remove();
        document.getElementById('tm-contribution-panel')?.remove();

        const btn = document.createElement('button');
        btn.id = 'tm-contribute-btn';
        btn.className = 'tm-contribute-btn';
        btn.innerHTML = '<i class="bi bi-plus-circle"></i> ' + I18n.t('contrib.add');
        btn.title = I18n.t('contrib.add_tooltip');

        // Only show if user is logged in
        if (!Api.isLoggedIn()) {
            btn.innerHTML = '<i class="bi bi-lock"></i> ' + I18n.t('contrib.login_required');
            btn.classList.add('disabled');
            btn.onclick = () => App.toast(I18n.t('contrib.login_required'), 'warning');
        } else {
            btn.onclick = () => this._startContributionMode();
        }

        viewer.appendChild(btn);

        // Load and display existing approved contributions
        this._loadContributions(story.id);
    },

    async _loadContributions(storyId) {
        try {
            this._contributions = await Api.listContributions(storyId);
            this._renderContributionMarkers();
        } catch (e) {
            console.warn('Failed to load contributions:', e);
        }
    },

    _renderContributionMarkers() {
        // Remove old contribution markers
        this._contributionMarkers.forEach(m => m.remove());
        this._contributionMarkers = [];

        if (!this._map || !this._contributions.length) return;

        this._contributions.forEach(c => {
            if (!c.lng || !c.lat) return;

            const el = document.createElement('div');
            el.className = 'tm-contribution-marker';
            el.innerHTML = '<i class="bi bi-geo-alt-fill"></i>';
            if (c.category) el.dataset.category = c.category;

            const marker = new maplibregl.Marker({ element: el })
                .setLngLat([c.lng, c.lat])
                .setPopup(new maplibregl.Popup({ maxWidth: '320px', offset: 20 })
                    .setHTML(this._buildContributionPopup(c)))
                .addTo(this._map);

            this._contributionMarkers.push(marker);
        });
    },

    _buildContributionPopup(c) {
        let html = '<div class="tm-contribution-popup">';
        html += `<h4>${DOMPurify.sanitize(c.title)}</h4>`;
        if (c.author_display_name || c.author_name) {
            html += `<div class="contrib-author"><i class="bi bi-person"></i> ${DOMPurify.sanitize(c.author_display_name || c.author_name)}</div>`;
        }
        if (c.description) {
            html += `<p>${DOMPurify.sanitize(c.description)}</p>`;
        }
        if (c.media_url) {
            if (c.media_type === 'image') {
                html += `<img src="${c.thumbnail_url || c.media_url}" alt="" class="contrib-media-img" onclick="window.open('${c.media_url}','_blank')">`;
            } else if (c.media_type === 'video') {
                html += `<video src="${c.media_url}" controls class="contrib-media-video"></video>`;
            } else if (c.media_type === 'audio') {
                html += `<audio src="${c.media_url}" controls class="contrib-media-audio"></audio>`;
            }
        }
        if (c.category) {
            html += `<span class="contrib-category"><i class="bi bi-tag"></i> ${DOMPurify.sanitize(c.category)}</span>`;
        }
        html += `<div class="contrib-date"><i class="bi bi-clock"></i> ${new Date(c.created_at).toLocaleDateString()}</div>`;
        html += '</div>';
        return html;
    },

    _startContributionMode() {
        if (this._contributionMode) return;
        this._contributionMode = true;

        const mapContainer = document.getElementById('viewer-map-container');
        mapContainer.classList.add('contribution-placing');

        App.toast(I18n.t('contrib.click_map'), 'info');

        // Listen for click on map
        const clickHandler = (e) => {
            this._contributionMode = false;
            mapContainer.classList.remove('contribution-placing');
            this._map.off('click', clickHandler);

            this._showContributionForm(e.lngLat.lng, e.lngLat.lat);
        };

        this._map.on('click', clickHandler);

        // Cancel on Escape
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                this._contributionMode = false;
                mapContainer.classList.remove('contribution-placing');
                this._map.off('click', clickHandler);
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    },

    _showContributionForm(lng, lat) {
        const storyId = this._data.story.id;
        const categories = this._data.story.settings?.participatory_categories || [];

        let categoryOptions = '';
        if (categories.length > 0) {
            categoryOptions = `
                <div class="mb-3">
                    <label class="form-label">${I18n.t('contrib.category')}</label>
                    <select id="contrib-category" class="form-select form-select-sm">
                        <option value="">—</option>
                        ${categories.map(c => `<option value="${c}">${c}</option>`).join('')}
                    </select>
                </div>`;
        }

        const formHtml = `
            <div class="tm-contribution-form">
                <h5><i class="bi bi-plus-circle"></i> ${I18n.t('contrib.new')}</h5>
                <div class="mb-3">
                    <label class="form-label">${I18n.t('contrib.title')} *</label>
                    <input type="text" id="contrib-title" class="form-control form-control-sm" required>
                </div>
                <div class="mb-3">
                    <label class="form-label">${I18n.t('contrib.description')}</label>
                    <textarea id="contrib-description" class="form-control form-control-sm" rows="3"></textarea>
                </div>
                ${categoryOptions}
                <div class="mb-3">
                    <label class="form-label">${I18n.t('contrib.media')}</label>
                    <input type="file" id="contrib-file" class="form-control form-control-sm" accept="image/*,video/*,audio/*">
                    <small class="text-muted">${I18n.t('contrib.media_hint')}</small>
                </div>
                <div class="mb-2 text-muted small">
                    <i class="bi bi-geo-alt"></i> ${lat.toFixed(5)}, ${lng.toFixed(5)}
                </div>
                <div class="d-flex gap-2">
                    <button id="contrib-submit" class="btn btn-sm btn-primary flex-grow-1">
                        <i class="bi bi-send"></i> ${I18n.t('contrib.submit')}
                    </button>
                    <button id="contrib-cancel" class="btn btn-sm btn-outline-secondary">
                        ${I18n.t('contrib.cancel')}
                    </button>
                </div>
            </div>
        `;

        // Show as popup on map at the clicked location
        const popup = new maplibregl.Popup({ maxWidth: '360px', closeOnClick: false })
            .setLngLat([lng, lat])
            .setHTML(formHtml)
            .addTo(this._map);

        // Wire up buttons after DOM insertion
        setTimeout(() => {
            document.getElementById('contrib-cancel')?.addEventListener('click', () => popup.remove());
            document.getElementById('contrib-submit')?.addEventListener('click', async () => {
                const title = document.getElementById('contrib-title')?.value?.trim();
                if (!title) {
                    App.toast(I18n.t('contrib.title_required'), 'warning');
                    return;
                }

                const data = {
                    title,
                    description: document.getElementById('contrib-description')?.value?.trim() || null,
                    category: document.getElementById('contrib-category')?.value || null,
                    lng,
                    lat,
                };
                const fileInput = document.getElementById('contrib-file');
                const file = fileInput?.files?.[0] || null;

                const submitBtn = document.getElementById('contrib-submit');
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

                try {
                    await Api.createContribution(storyId, data, file);
                    popup.remove();
                    App.toast(I18n.t('contrib.success'), 'success');
                    // Reload contributions
                    this._loadContributions(storyId);
                } catch (err) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<i class="bi bi-send"></i> ' + I18n.t('contrib.submit');
                    App.toast(err.message || I18n.t('contrib.error'), 'danger');
                }
            });
        }, 100);
    },

    _autoHideToolbar() {
        const toolbar = document.getElementById('viewer-toolbar');
        toolbar.classList.remove('hidden');
        clearTimeout(this._toolbarTimer);
        this._toolbarTimer = setTimeout(() => {
            toolbar.classList.add('hidden');
        }, 4000);

        document.getElementById('story-viewer').onmousemove = () => {
            toolbar.classList.remove('hidden');
            clearTimeout(this._toolbarTimer);
            this._toolbarTimer = setTimeout(() => toolbar.classList.add('hidden'), 4000);
        };
    },

    // ── Legend ─────────────────────────────
    _renderLegend(slide) {
        document.getElementById('viewer-legend')?.remove();
        const layout = slide.layout || 'side-left';
        const hasMap = this._mapLayouts.includes(layout);
        if (!hasMap) return;

        const items = [];

        // Visible layers
        if (this._data.layers) {
            this._data.layers.forEach(l => {
                const vis = slide.layer_visibility?.[l.layer_id];
                const isVis = vis !== undefined ? vis : l.visible;
                if (!isVis) return;
                const style = l.custom_style && Object.keys(l.custom_style).length ? l.custom_style : l.style_config;
                const color = style?.paint?.['fill-color'] || style?.paint?.['line-color'] || style?.paint?.['circle-color'] || '#4f6df5';
                const type = style?.type || l.layer_type || 'fill';
                items.push({ label: l.layer_name, color, type });
            });
        }

        // Drawn features
        const drawn = slide.style_overrides?.drawn_features;
        if (drawn?.features?.length) {
            const hasLines = drawn.features.some(f => f.geometry?.type === 'LineString');
            const hasPolys = drawn.features.some(f => f.geometry?.type === 'Polygon');
            if (hasLines) items.push({ label: 'Linee', color: '#4f6df5', type: 'line' });
            if (hasPolys) items.push({ label: 'Aree', color: '#4f6df5', type: 'fill' });
        }

        // Markers
        const slideMarkers = (this._data.markers || []).filter(m => m.slide_id === slide.id);
        if (slideMarkers.length > 0) {
            const colors = [...new Set(slideMarkers.map(m => m.color || '#e74c3c'))];
            colors.forEach(c => {
                const markersOfColor = slideMarkers.filter(m => (m.color || '#e74c3c') === c);
                const label = markersOfColor.length === 1 ? markersOfColor[0].title : `Marker (${markersOfColor.length})`;
                items.push({ label, color: c, type: 'circle' });
            });
        }

        if (items.length === 0) return;

        const legend = document.createElement('div');
        legend.id = 'viewer-legend';
        legend.className = 'viewer-legend';
        legend.innerHTML = `<h4><i class="bi bi-list-ul"></i> Legenda</h4>` +
            items.map(it => {
                const swatchClass = it.type === 'line' ? 'legend-swatch line' : 'legend-swatch';
                return `<div class="legend-item">
                    <div class="${swatchClass}" style="background:${it.color}${it.type === 'circle' ? ';border-radius:50%' : ''}"></div>
                    <span class="legend-label">${it.label}</span>
                </div>`;
            }).join('');

        document.getElementById('story-viewer').appendChild(legend);
    },

    // ── Drawn Features ────────────────────
    _drawnSourceAdded: false,

    _renderDrawnFeatures(slide) {
        const map = TmMap.getMap();
        if (!map) return;
        const geojson = slide.style_overrides?.drawn_features;

        if (this._drawnSourceAdded) {
            const src = map.getSource('viewer-drawn');
            if (src) {
                src.setData(geojson || { type: 'FeatureCollection', features: [] });
                return;
            }
        }

        if (!geojson?.features?.length) return;

        map.addSource('viewer-drawn', { type: 'geojson', data: geojson });
        map.addLayer({ id: 'viewer-drawn-fill', type: 'fill', source: 'viewer-drawn',
            filter: ['==', '$type', 'Polygon'],
            paint: {
                'fill-color': ['coalesce', ['get', 'color'], '#4f6df5'],
                'fill-opacity': ['coalesce', ['get', 'fill_opacity'], 0.2],
            } });
        map.addLayer({ id: 'viewer-drawn-line', type: 'line', source: 'viewer-drawn',
            filter: ['any', ['==', '$type', 'LineString'], ['==', '$type', 'Polygon']],
            paint: {
                'line-color': ['coalesce', ['get', 'color'], '#4f6df5'],
                'line-width': ['coalesce', ['get', 'stroke_width'], 3],
            } });
        this._drawnSourceAdded = true;

        // Click popup for drawn features
        map.on('click', 'viewer-drawn-fill', (e) => this._showDrawnPopup(e));
        map.on('click', 'viewer-drawn-line', (e) => this._showDrawnPopup(e));
        map.on('mouseenter', 'viewer-drawn-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'viewer-drawn-fill', () => { map.getCanvas().style.cursor = ''; });
        map.on('mouseenter', 'viewer-drawn-line', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'viewer-drawn-line', () => { map.getCanvas().style.cursor = ''; });
    },

    _showDrawnPopup(e) {
        const map = TmMap.getMap();
        if (!map || !e.features?.length) return;
        const props = e.features[0].properties || {};
        if (!props.title && !props.popup_content) return;

        const html = `
            ${props.title ? `<strong style="font-size:15px">${App.escHtml(props.title)}</strong>` : ''}
            ${props.popup_content ? `<div class="marker-popup-content">${App.sanitize(props.popup_content)}</div>` : ''}
        `;
        new maplibregl.Popup({ maxWidth: '340px' })
            .setLngLat(e.lngLat)
            .setHTML(html)
            .addTo(map);
    },

    /** Validate URL: only allow relative paths or https: URLs */
    _sanitizeUrl(url) {
        if (!url) return '';
        const s = String(url).trim();
        if (s.startsWith('/')) return s;  // relative path OK
        try {
            const u = new URL(s);
            if (u.protocol === 'https:' || u.protocol === 'http:') return s;
        } catch { /* invalid URL */ }
        return '';
    },

    // ── 3D Toggle ────────────────────────
    _toggle3D() {
        if (typeof Cesium === 'undefined') {
            App.toast('CesiumJS non caricato. Controlla la connessione.', 'warning');
            return;
        }

        this._is3D = !this._is3D;
        const mapEl = document.getElementById('viewer-map');
        const cesiumEl = document.getElementById('viewer-cesium');
        const btn = document.getElementById('viewer-toggle-3d');

        if (this._is3D) {
            mapEl.style.display = 'none';
            cesiumEl.classList.remove('d-none');
            cesiumEl.style.display = 'block';
            btn.classList.add('active');

            if (!Cesium3D.isActive()) {
                try {
                    const state = TmMap.getState();
                    const settings = this._data.story.settings || {};
                    Cesium3D.init('viewer-cesium', {
                        ionToken: settings.cesium_ion_token || '',
                        camera: {
                            position: [state.center.lng, state.center.lat, this._zoomToHeight(state.zoom)],
                            heading: state.bearing || 0,
                            pitch: -45,
                        },
                    });

                    const slide = this._slides[this._currentSlide];
                    const slideMarkers = (this._data.markers || []).filter(m => m.slide_id === slide?.id);
                    slideMarkers.forEach(m => Cesium3D.addMarker3D(m));

                    if (settings.tilesets) {
                        settings.tilesets.forEach(t => Cesium3D.addTileset(t));
                    }
                } catch (err) {
                    console.error('Cesium 3D init error:', err);
                    App.toast('Errore inizializzazione vista 3D', 'danger');
                    // Revert to 2D
                    this._is3D = false;
                    mapEl.style.display = 'block';
                    cesiumEl.style.display = 'none';
                    btn.classList.remove('active');
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

    // ── Touch Swipe ─────────────────────
    _setupTouchSwipe() {
        const viewer = document.getElementById('story-viewer');
        if (!viewer) return;

        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartTime = 0;

        viewer.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchStartTime = Date.now();
        }, { passive: true });

        viewer.addEventListener('touchend', (e) => {
            const dx = e.changedTouches[0].clientX - touchStartX;
            const dy = e.changedTouches[0].clientY - touchStartY;
            const dt = Date.now() - touchStartTime;

            // Only trigger on horizontal swipes that are fast enough and long enough
            // Ignore if vertical movement is greater (user is scrolling map)
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 500) {
                if (dx < 0) {
                    // Swipe left = next slide
                    this.goTo(this._currentSlide + 1);
                } else {
                    // Swipe right = previous slide
                    this.goTo(this._currentSlide - 1);
                }
            }
        }, { passive: true });
    },

    // ── Map Interactivity ────────────────
    _setupMapInteractivity() {
        const narrative = document.getElementById('viewer-narrative');
        const mapContainer = document.getElementById('viewer-map-container');
        if (!narrative || !mapContainer) return;

        // When pointer is over empty slide area (not content), let map handle it
        narrative.addEventListener('pointerdown', (e) => {
            // If target is the slide itself (not content card or interactive element), forward to map
            if (e.target.closest('.viewer-slide-content, .scroll-hint, .viewer-text-media-wrapper, .viewer-legend, button, a, input, select, textarea')) return;
            // Temporarily disable pointer events on narrative so map gets the event
            narrative.style.pointerEvents = 'none';
            // Re-enable on pointer up or after a short delay
            const restore = () => {
                narrative.style.pointerEvents = '';
                document.removeEventListener('pointerup', restore);
                document.removeEventListener('pointercancel', restore);
            };
            document.addEventListener('pointerup', restore);
            document.addEventListener('pointercancel', restore);
            // Also restore after drag/pan ends (safety net)
            setTimeout(restore, 5000);
        });

        // Forward wheel events on empty areas to the map for zoom
        narrative.addEventListener('wheel', (e) => {
            if (e.target.closest('.viewer-slide-content, .viewer-text-media-wrapper')) return;
            // Check if the current slide has a map
            const slide = this._slides[this._currentSlide];
            if (!slide || !this._mapLayouts.includes(slide.layout || 'side-left')) return;
            // Forward wheel to map by temporarily hiding narrative from events
            narrative.style.pointerEvents = 'none';
            requestAnimationFrame(() => { narrative.style.pointerEvents = ''; });
        }, { passive: true });
    },

    // ── Geocode Search ──────────────────
    _viewerGeocodeDebounce: null,

    _setupViewerGeocode() {
        const toggle = document.getElementById('viewer-geocode-toggle');
        const inputWrap = document.getElementById('viewer-geocode-input');
        const searchInput = document.getElementById('viewer-geocode-search');
        const resultsEl = document.getElementById('viewer-geocode-results');
        if (!toggle || !inputWrap || !searchInput) return;

        // Update placeholder and title from i18n
        toggle.title = I18n.t('editor.geocode');
        searchInput.placeholder = I18n.t('editor.geocode_ph');

        toggle.onclick = () => {
            if (inputWrap.style.display === 'none') {
                inputWrap.style.display = 'block';
                searchInput.focus();
            } else {
                inputWrap.style.display = 'none';
                searchInput.value = '';
                resultsEl.innerHTML = '';
            }
        };

        searchInput.addEventListener('input', (e) => {
            clearTimeout(this._viewerGeocodeDebounce);
            const query = e.target.value.trim();
            if (query.length < 2) { resultsEl.innerHTML = ''; return; }
            this._viewerGeocodeDebounce = setTimeout(() => this._viewerGeocodeSearch(query), 300);
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                inputWrap.style.display = 'none';
                searchInput.value = '';
                resultsEl.innerHTML = '';
                e.stopPropagation(); // prevent viewer close
            }
        });

        document.addEventListener('click', (e) => {
            const wrapper = document.getElementById('viewer-geocode-wrapper');
            if (wrapper && !wrapper.contains(e.target)) {
                inputWrap.style.display = 'none';
                searchInput.value = '';
                resultsEl.innerHTML = '';
            }
        });
    },

    async _viewerGeocodeSearch(query) {
        const resultsEl = document.getElementById('viewer-geocode-results');
        const lang = I18n.getLang();
        try {
            const res = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`,
                {
                    headers: {
                        'Accept-Language': lang,
                        'User-Agent': 'TalkingMaps/2.0 (storymap viewer)',
                    },
                }
            );
            const data = await res.json();
            if (!data.length) {
                resultsEl.innerHTML = `<div class="viewer-geocode-result"><small>${I18n.t('editor.geocode_no_results')}</small></div>`;
                return;
            }
            resultsEl.innerHTML = '';
            data.forEach(item => {
                const el = document.createElement('div');
                el.className = 'viewer-geocode-result';
                el.dataset.lat = parseFloat(item.lat) || 0;
                el.dataset.lon = parseFloat(item.lon) || 0;
                const span = document.createElement('span');
                span.textContent = (item.display_name || '').split(',').slice(0, 2).join(',');
                const small = document.createElement('small');
                small.textContent = (item.display_name || '').split(',').slice(1, 3).join(',');
                el.appendChild(span);
                el.appendChild(small);
                resultsEl.appendChild(el);
            });

            resultsEl.querySelectorAll('.viewer-geocode-result').forEach(el => {
                el.addEventListener('click', () => {
                    const lat = parseFloat(el.dataset.lat);
                    const lon = parseFloat(el.dataset.lon);
                    TmMap.flyTo({ center: [lon, lat], zoom: 14, duration: 1500 });
                    document.getElementById('viewer-geocode-input').style.display = 'none';
                    document.getElementById('viewer-geocode-search').value = '';
                    resultsEl.innerHTML = '';
                });
            });
        } catch { /* silently fail */ }
    },

    // ── Table of Contents (Chapters) ────
    _chapters: [],

    _buildTOC() {
        // Build chapters array from slides
        const chapters = [];
        const ungrouped = [];
        let currentChapter = null;

        this._slides.forEach((slide, idx) => {
            const chapterName = slide.style_overrides?.chapter;
            if (chapterName) {
                if (chapterName !== currentChapter) {
                    chapters.push({ name: chapterName, slides: [] });
                    currentChapter = chapterName;
                }
                chapters[chapters.length - 1].slides.push({ index: idx, title: slide.title || I18n.t('editor.untitled') });
            } else {
                ungrouped.push({ index: idx, title: slide.title || I18n.t('editor.untitled') });
                currentChapter = null;
            }
        });

        this._chapters = chapters;

        // Only show TOC if there are chapters
        if (chapters.length === 0) return;

        const viewer = document.getElementById('story-viewer');

        // Create TOC toggle button
        const tocBtn = document.createElement('button');
        tocBtn.className = 'viewer-toc-btn';
        tocBtn.id = 'viewer-toc-toggle';
        tocBtn.title = I18n.t('viewer.toc');
        tocBtn.innerHTML = '<i class="bi bi-list-ul"></i>';
        viewer.appendChild(tocBtn);

        // Create TOC panel
        const tocPanel = document.createElement('div');
        tocPanel.className = 'viewer-toc-panel';
        tocPanel.id = 'viewer-toc-panel';

        let panelHTML = `<button class="viewer-toc-close" id="viewer-toc-close"><i class="bi bi-x-lg"></i></button>`;
        panelHTML += `<div class="viewer-toc-title">${I18n.t('viewer.toc_title')}</div>`;

        chapters.forEach((ch) => {
            panelHTML += `<div class="toc-chapter-title">${ch.name}</div>`;
            ch.slides.forEach(s => {
                panelHTML += `<div class="toc-slide-item" data-toc-slide="${s.index}">${s.title}</div>`;
            });
        });

        if (ungrouped.length > 0) {
            panelHTML += `<div class="toc-ungrouped-title">${I18n.t('editor.no_chapter')}</div>`;
            ungrouped.forEach(s => {
                panelHTML += `<div class="toc-slide-item" data-toc-slide="${s.index}">${s.title}</div>`;
            });
        }

        tocPanel.innerHTML = panelHTML;
        viewer.appendChild(tocPanel);

        // Toggle panel
        tocBtn.addEventListener('click', () => {
            tocPanel.classList.toggle('open');
        });

        // Close button
        document.getElementById('viewer-toc-close').addEventListener('click', () => {
            tocPanel.classList.remove('open');
        });

        // Click slide items to navigate
        tocPanel.querySelectorAll('.toc-slide-item').forEach(item => {
            item.addEventListener('click', () => {
                const idx = parseInt(item.dataset.tocSlide);
                this.goTo(idx);
                tocPanel.classList.remove('open');
            });
        });
    },

    _updateTOCHighlight(index) {
        const panel = document.getElementById('viewer-toc-panel');
        if (!panel) return;
        panel.querySelectorAll('.toc-slide-item').forEach(item => {
            item.classList.toggle('active', parseInt(item.dataset.tocSlide) === index);
        });
    },

    _buildUnguidedNav() {
        const existing = document.getElementById('viewer-unguided-nav');
        if (existing) existing.remove();

        const nav = document.createElement('div');
        nav.id = 'viewer-unguided-nav';
        nav.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:50;background:rgba(0,0,0,0.85);padding:8px 16px;display:flex;gap:8px;overflow-x:auto;backdrop-filter:blur(8px);';

        this._slides.forEach((slide, i) => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-sm ' + (i === this._currentSlide ? 'btn-primary' : 'btn-outline-light');
            btn.style.cssText = 'white-space:nowrap;min-width:fit-content;font-size:12px;';
            btn.textContent = slide.title || `Slide ${i + 1}`;
            btn.addEventListener('click', () => this.goTo(i));
            nav.appendChild(btn);
        });

        document.getElementById('story-viewer').appendChild(nav);
    },

    _updateUnguidedNav(index) {
        const unguidedNav = document.getElementById('viewer-unguided-nav');
        if (unguidedNav) {
            unguidedNav.querySelectorAll('button').forEach((btn, i) => {
                btn.className = 'btn btn-sm ' + (i === index ? 'btn-primary' : 'btn-outline-light');
                btn.style.cssText = 'white-space:nowrap;min-width:fit-content;font-size:12px;';
            });
        }
    },

    _printSlide() {
        const slide = this._slides[this._currentSlide];
        if (!slide) return;

        const map = TmMap.getMap();
        let mapImage = '';
        try {
            mapImage = map?.getCanvas()?.toDataURL('image/png') || '';
        } catch {}

        const printWin = window.open('', '_blank');
        printWin.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>${this._data.story.title} - ${slide.title || 'Slide'}</title>
                <style>
                    @page { size: A4 landscape; margin: 15mm; }
                    body { font-family: 'Ubuntu', Arial, sans-serif; margin: 0; padding: 20px; color: #333; }
                    .print-header { border-bottom: 2px solid #4f6df5; padding-bottom: 12px; margin-bottom: 20px; }
                    .print-header h1 { margin: 0; font-size: 24px; color: #1a1a2e; }
                    .print-header h2 { margin: 4px 0 0; font-size: 16px; color: #666; font-weight: normal; }
                    .print-content { display: flex; gap: 24px; }
                    .print-map { flex: 1; }
                    .print-map img { width: 100%; border: 1px solid #ddd; border-radius: 4px; }
                    .print-narrative { flex: 1; font-size: 14px; line-height: 1.6; }
                    .print-narrative h1, .print-narrative h2, .print-narrative h3 { color: #1a1a2e; }
                    .print-footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 11px; color: #999; text-align: center; }
                    @media print { body { padding: 0; } }
                </style>
            </head>
            <body>
                <div class="print-header">
                    <h1>${this._data.story.title || 'TalkingMaps'}</h1>
                    <h2>${slide.title || ''}</h2>
                </div>
                <div class="print-content">
                    ${mapImage ? `<div class="print-map"><img src="${mapImage}"></div>` : ''}
                    <div class="print-narrative">${slide.narrative || ''}</div>
                </div>
                <div class="print-footer">
                    Generated with TalkingMaps &mdash; ${new Date().toLocaleDateString()}
                </div>
            </body>
            </html>
        `);
        printWin.document.close();
        setTimeout(() => printWin.print(), 500);
    },
};
