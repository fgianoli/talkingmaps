/**
 * TalkingMaps – MapLibre GL JS Map Module
 * Inspired by sitvi webgis-map-init.js and anncsu map.js
 */
const TmMap = {
    _map: null,
    _markers: [],
    _layerIdMap: {},
    _timeFilterBase: {},
    _currentBasemap: 'osm',
    _basemaps: [],
    _onClickCallback: null,
    _cogProtocolRegistered: false,

    /**
     * Initialize a MapLibre GL map
     * @param {string} containerId - DOM container ID
     * @param {object} opts - { center, zoom, bearing, pitch, basemaps }
     * @returns {maplibregl.Map}
     */
    init(containerId, opts = {}) {
        const center = opts.center || [11.88, 45.41]; // Default: Vicenza area
        const zoom = opts.zoom || 6;

        this._basemaps = opts.basemaps || [];

        const style = this._buildStyle(this._basemaps[0]);

        this._map = new maplibregl.Map({
            container: containerId,
            style: style,
            center: center,
            zoom: zoom,
            bearing: opts.bearing || 0,
            pitch: opts.pitch || 0,
            maxPitch: 85,
            attributionControl: true,
            preserveDrawingBuffer: true,
        });

        this._map.addControl(new maplibregl.NavigationControl(), 'top-right');
        this._map.addControl(new maplibregl.ScaleControl(), 'bottom-left');

        return this._map;
    },

    getMap() { return this._map; },

    destroy() {
        this.stopAllAutoRefresh();
        this.disableCompare();
        if (this._map) {
            this._map.remove();
            this._map = null;
        }
        this._markers = [];
        this._layerIdMap = {};
        this._timeFilterBase = {};
    },

    // ── Basemap ──────────────────────────
    _buildStyle(basemap) {
        if (!basemap) {
            return {
                version: 8,
                sources: {
                    'osm': {
                        type: 'raster',
                        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                        tileSize: 256,
                        attribution: '&copy; OpenStreetMap contributors',
                    }
                },
                layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm' }],
            };
        }

        const config = basemap.config || {};

        // Image basemap: use MapLibre image source (for paintings, historical maps, floor plans)
        if (basemap.type === 'image') {
            // config.coordinates = [[topLeftLng, topLeftLat], [topRightLng, topRightLat],
            //                       [bottomRightLng, bottomRightLat], [bottomLeftLng, bottomLeftLat]]
            const coords = config.coordinates || [[-180, 85], [180, 85], [180, -85], [-180, -85]];
            return {
                version: 8,
                sources: {
                    'basemap': {
                        type: 'image',
                        url: basemap.url,
                        coordinates: coords,
                    }
                },
                layers: [{ id: 'basemap-tiles', type: 'raster', source: 'basemap' }],
            };
        }

        return {
            version: 8,
            sources: {
                'basemap': {
                    type: 'raster',
                    tiles: basemap.type === 'wms'
                        ? [this._buildWmsUrl(basemap.url, config)]
                        : [basemap.url],
                    tileSize: config.tileSize || 256,
                    maxzoom: config.maxzoom || 19,
                    attribution: config.attribution || '',
                }
            },
            layers: [{ id: 'basemap-tiles', type: 'raster', source: 'basemap' }],
        };
    },

    _buildWmsUrl(baseUrl, config) {
        const params = new URLSearchParams({
            SERVICE: 'WMS', REQUEST: 'GetMap',
            LAYERS: config.layers || '', STYLES: '',
            FORMAT: 'image/png', TRANSPARENT: 'true',
            VERSION: '1.1.1', WIDTH: '256', HEIGHT: '256',
            SRS: 'EPSG:3857', BBOX: '{bbox-epsg-3857}',
        });
        // Use proxy for CORS
        return `/api/wms-proxy/tile?url=${encodeURIComponent(baseUrl + '?' + params.toString())}`;
    },

    setBasemap(basemap, noBackground) {
        if (!this._map) return;
        const style = noBackground ? { version: 8, sources: {}, layers: [] } : this._buildStyle(basemap);
        // Preserve existing layers
        const currentLayers = this._map.getStyle().layers.filter(l => l.id !== 'basemap-tiles' && l.id !== 'osm-tiles');
        const currentSources = { ...this._map.getStyle().sources };
        delete currentSources['basemap'];
        delete currentSources['osm'];

        style.sources = { ...style.sources, ...currentSources };
        style.layers = [...style.layers, ...currentLayers];
        this._map.setStyle(style);
    },

    // ── Layers ───────────────────────────
    addLayer(layerConfig) {
        if (!this._map) return;
        const { id, layer_type, source_config, style_config } = layerConfig;
        const sourceId = `layer-${id}`;
        const layerId = `layer-${id}`;

        // Add source
        if (layer_type === 'geojson') {
            const sourceOpts = {
                type: 'geojson',
                data: source_config.url || source_config.data || { type: 'FeatureCollection', features: [] },
            };
            // Enable clustering if configured
            if (source_config.cluster) {
                sourceOpts.cluster = true;
                sourceOpts.clusterMaxZoom = source_config.clusterMaxZoom || 14;
                sourceOpts.clusterRadius = source_config.clusterRadius || 50;
            }
            this._map.addSource(sourceId, sourceOpts);
        } else if (layer_type === 'wms') {
            const wmsUrl = this._buildWmsUrl(source_config.url, source_config);
            this._map.addSource(sourceId, {
                type: 'raster',
                tiles: [wmsUrl],
                tileSize: 256,
            });
        } else if (layer_type === 'wmts' || layer_type === 'xyz') {
            this._map.addSource(sourceId, {
                type: 'raster',
                tiles: [source_config.url],
                tileSize: source_config.tileSize || 256,
            });
        } else if (layer_type === 'vector-tiles') {
            this._map.addSource(sourceId, {
                type: 'vector',
                tiles: [source_config.url],
                maxzoom: source_config.maxzoom || 14,
            });
        } else if (layer_type === 'wfs') {
            // WFS: fetch features via proxy, use as GeoJSON
            const proxyUrl = `/api/wfs-proxy/features?url=${encodeURIComponent(source_config.url)}&type_name=${encodeURIComponent(source_config.typeName || '')}&max_features=${source_config.maxFeatures || 1000}`;
            this._map.addSource(sourceId, {
                type: 'geojson',
                data: proxyUrl,
            });
        } else if (layer_type === 'cog') {
            this._registerCogProtocol();
            this._map.addSource(sourceId, {
                type: 'raster',
                tiles: [`cog://${source_config.url}`],
                tileSize: 256,
                minzoom: source_config.minzoom || 0,
                maxzoom: source_config.maxzoom || 22,
            });
        } else if (layer_type === 'hillshade') {
            this._map.addSource(sourceId, {
                type: 'raster-dem',
                tiles: [source_config.url],
                tileSize: source_config.tileSize || 256,
                maxzoom: source_config.maxzoom || 14,
                encoding: source_config.encoding || 'mapbox',
            });
        }

        // Add layer with style
        if (layer_type === 'wms' || layer_type === 'wmts' || layer_type === 'xyz' || layer_type === 'cog') {
            this._map.addLayer({
                id: layerId,
                type: 'raster',
                source: sourceId,
                paint: style_config?.paint || { 'raster-opacity': layerConfig.opacity || 1 },
            });
        } else if (layer_type === 'hillshade') {
            this._map.addLayer({
                id: layerId,
                type: 'hillshade',
                source: sourceId,
                paint: {
                    'hillshade-exaggeration': style_config?.paint?.['hillshade-exaggeration'] ?? 0.5,
                    'hillshade-shadow-color': style_config?.paint?.['hillshade-shadow-color'] || '#000000',
                    'hillshade-highlight-color': style_config?.paint?.['hillshade-highlight-color'] || '#ffffff',
                    'hillshade-illumination-direction': style_config?.paint?.['hillshade-illumination-direction'] ?? 335,
                },
            });
        } else if (layer_type === 'geojson' || layer_type === 'vector-tiles' || layer_type === 'wfs') {
            this._addVectorLayer(layerId, sourceId, style_config, layer_type, source_config);
        }

        this._layerIdMap[id] = layerId;
    },

    _addVectorLayer(layerId, sourceId, style_config, layer_type, source_config) {
        const paint = style_config?.paint || {};
        const layout = style_config?.layout || {};
        const layerType = style_config?.type || this._inferLayerType(paint);
        const sourceLayer = source_config?.sourceLayer;

        const layerDef = {
            id: layerId,
            type: layerType,
            source: sourceId,
            paint: paint,
            layout: { visibility: 'visible', ...layout },
        };

        if (layer_type === 'vector-tiles' && sourceLayer) {
            layerDef['source-layer'] = sourceLayer;
        }

        this._map.addLayer(layerDef);

        // Cluster layers
        try {
            const source = this._map.getSource(sourceId);
            if (source && source._options?.cluster) {
                // Cluster circles
                this._map.addLayer({
                    id: `${layerId}-clusters`,
                    type: 'circle',
                    source: sourceId,
                    filter: ['has', 'point_count'],
                    paint: {
                        'circle-color': ['step', ['get', 'point_count'], '#51bbd6', 10, '#f1f075', 50, '#f28cb1'],
                        'circle-radius': ['step', ['get', 'point_count'], 20, 10, 30, 50, 40],
                        'circle-stroke-width': 2,
                        'circle-stroke-color': '#ffffff',
                    },
                });
                // Cluster count labels
                this._map.addLayer({
                    id: `${layerId}-cluster-count`,
                    type: 'symbol',
                    source: sourceId,
                    filter: ['has', 'point_count'],
                    layout: {
                        'text-field': '{point_count_abbreviated}',
                        'text-font': ['Open Sans Bold'],
                        'text-size': 13,
                    },
                    paint: { 'text-color': '#333333' },
                });
                // Make the original layer only show unclustered points
                this._map.setFilter(layerId, ['!', ['has', 'point_count']]);
            }
        } catch {}

        // Add outline for polygons
        if (layerType === 'fill') {
            this._map.addLayer({
                id: `${layerId}-outline`,
                type: 'line',
                source: sourceId,
                paint: {
                    'line-color': paint['fill-outline-color'] || '#333',
                    'line-width': 1,
                },
                ...(layer_type === 'vector-tiles' && sourceLayer ? { 'source-layer': sourceLayer } : {}),
            });
        }
    },

    _inferLayerType(paint) {
        if (paint['circle-radius'] || paint['circle-color']) return 'circle';
        if (paint['line-color'] || paint['line-width']) return 'line';
        if (paint['fill-color'] || paint['fill-opacity']) return 'fill';
        if (paint['heatmap-color']) return 'heatmap';
        return 'circle';
    },

    removeLayer(id) {
        const layerId = this._layerIdMap[id];
        if (!layerId || !this._map) return;
        try {
            if (this._map.getLayer(`${layerId}-outline`)) this._map.removeLayer(`${layerId}-outline`);
            if (this._map.getLayer(`${layerId}-clusters`)) this._map.removeLayer(`${layerId}-clusters`);
            if (this._map.getLayer(`${layerId}-cluster-count`)) this._map.removeLayer(`${layerId}-cluster-count`);
            if (this._map.getLayer(layerId)) this._map.removeLayer(layerId);
            if (this._map.getSource(`layer-${id}`)) this._map.removeSource(`layer-${id}`);
        } catch { /* ok */ }
        delete this._timeFilterBase[layerId];
        delete this._timeFilterBase[`${layerId}-outline`];
        delete this._layerIdMap[id];
    },

    setLayerVisibility(id, visible) {
        const layerId = this._layerIdMap[id];
        if (!layerId || !this._map) return;
        const val = visible ? 'visible' : 'none';
        try {
            this._map.setLayoutProperty(layerId, 'visibility', val);
            if (this._map.getLayer(`${layerId}-outline`)) {
                this._map.setLayoutProperty(`${layerId}-outline`, 'visibility', val);
            }
        } catch { /* ok */ }
    },

    /**
     * Apply a temporal filter to a layer, preserving any filter it already carries
     * (clustered layers, for instance, are already filtered on point_count).
     * Cluster sub-layers are hidden while the filter is active: clusters are
     * aggregated by the source and cannot be filtered feature by feature.
     * @param {string} id - logical layer id
     * @param {Array} filter - MapLibre filter expression
     */
    setLayerTimeFilter(id, filter) {
        const layerId = this._layerIdMap[id];
        if (!layerId || !this._map) return;

        [layerId, `${layerId}-outline`].forEach(target => {
            if (!this._map.getLayer(target)) return;
            if (!(target in this._timeFilterBase)) {
                this._timeFilterBase[target] = this._map.getFilter(target) ?? null;
            }
            const base = this._timeFilterBase[target];
            try {
                this._map.setFilter(target, base ? ['all', base, filter] : filter);
            } catch (err) {
                console.warn(`Time filter could not be applied to ${target}:`, err.message);
            }
        });

        [`${layerId}-clusters`, `${layerId}-cluster-count`].forEach(target => {
            if (!this._map.getLayer(target)) return;
            try { this._map.setLayoutProperty(target, 'visibility', 'none'); } catch { /* ok */ }
        });
    },

    /** Restore the filters a layer had before setLayerTimeFilter() touched it. */
    clearLayerTimeFilter(id) {
        const layerId = this._layerIdMap[id];
        if (!layerId || !this._map) return;

        [layerId, `${layerId}-outline`].forEach(target => {
            if (!(target in this._timeFilterBase)) return;
            if (this._map.getLayer(target)) {
                try { this._map.setFilter(target, this._timeFilterBase[target]); } catch { /* ok */ }
            }
            delete this._timeFilterBase[target];
        });

        [`${layerId}-clusters`, `${layerId}-cluster-count`].forEach(target => {
            if (!this._map.getLayer(target)) return;
            try { this._map.setLayoutProperty(target, 'visibility', 'visible'); } catch { /* ok */ }
        });
    },

    setLayerOpacity(id, opacity) {
        const layerId = this._layerIdMap[id];
        if (!layerId || !this._map) return;
        const layer = this._map.getLayer(layerId);
        if (!layer) return;
        try {
            switch (layer.type) {
                case 'raster': this._map.setPaintProperty(layerId, 'raster-opacity', opacity); break;
                case 'fill': this._map.setPaintProperty(layerId, 'fill-opacity', opacity); break;
                case 'line': this._map.setPaintProperty(layerId, 'line-opacity', opacity); break;
                case 'circle': this._map.setPaintProperty(layerId, 'circle-opacity', opacity); break;
                case 'heatmap': this._map.setPaintProperty(layerId, 'heatmap-opacity', opacity); break;
                case 'hillshade': this._map.setPaintProperty(layerId, 'hillshade-exaggeration', opacity); break;
            }
        } catch { /* ok */ }
    },

    // ── Markers ──────────────────────────
    _markerSizes: { small: 20, medium: 28, large: 38 },

    // Decode packed icon field: "icon|size|shape"
    _parseIcon(iconStr) {
        if (!iconStr) return { icon: 'geo-alt-fill', size: 'medium', shape: 'circle' };
        const parts = iconStr.split('|');
        return {
            icon: parts[0] || 'geo-alt-fill',
            size: parts[1] || 'medium',
            shape: parts[2] || 'circle',
        };
    },

    addMarkers(markers, onClickCb) {
        this.clearMarkers();
        if (!this._map) return;
        markers.forEach(m => {
            const parsed = this._parseIcon(m.icon);
            const size = this._markerSizes[m.size || parsed.size] || this._markerSizes.medium;
            const color = m.color || '#e74c3c';
            const shape = m.shape || parsed.shape;
            const icon = (m.icon && !m.icon.includes('|')) ? m.icon : parsed.icon;

            const el = document.createElement('div');
            el.className = 'tm-marker';

            const borderRadius = shape === 'circle' ? '50%' : shape === 'diamond' ? '4px' : '4px';
            const rotation = shape === 'diamond' ? 'transform:rotate(45deg);' : '';
            const iconRotation = shape === 'diamond' ? 'transform:rotate(-45deg);' : '';

            el.style.cssText = `
                width:${size}px;height:${size}px;border-radius:${borderRadius};
                background:${color};border:3px solid white;
                box-shadow:0 2px 8px rgba(0,0,0,0.4);cursor:pointer;
                display:flex;align-items:center;justify-content:center;${rotation}
            `;
            el.innerHTML = `<i class="bi bi-${icon}" style="color:white;font-size:${Math.round(size * 0.45)}px;${iconRotation}"></i>`;

            // Click to edit in editor mode
            if (onClickCb) {
                el.addEventListener('click', (e) => { e.stopPropagation(); onClickCb(m); });
            }

            const marker = new maplibregl.Marker({ element: el })
                .setLngLat([m.lng, m.lat])
                .addTo(this._map);

            if (!onClickCb && (m.title || m.popup_content)) {
                const popup = new maplibregl.Popup({ offset: Math.round(size / 2), maxWidth: '340px' })
                    .setHTML(`
                        ${m.title ? `<strong style="font-size:15px">${m.title}</strong>` : ''}
                        ${m.popup_content ? `<div class="marker-popup-content">${m.popup_content}</div>` : ''}
                    `);
                marker.setPopup(popup);
            }

            this._markers.push(marker);
        });
    },

    clearMarkers() {
        this._markers.forEach(m => m.remove());
        this._markers = [];
    },

    // ── Camera ───────────────────────────
    flyTo(opts) {
        if (!this._map) return;
        const animation = opts.animation || 'flyTo';
        const camera = {
            center: opts.center || this._map.getCenter(),
            zoom: opts.zoom || this._map.getZoom(),
            bearing: opts.bearing || 0,
            pitch: opts.pitch || 0,
            duration: opts.duration || 2000,
        };
        if (animation === 'flyTo') this._map.flyTo(camera);
        else if (animation === 'easeTo') this._map.easeTo(camera);
        else this._map.jumpTo(camera);
    },

    cinematicFlyTo(opts) {
        if (!this._map) return;
        const from = this._map.getCenter();
        const to = opts.center || from;
        const fromZoom = this._map.getZoom();
        const toZoom = opts.zoom || fromZoom;

        // Calculate distance to determine intermediate zoom
        const dx = to[0] - from.lng;
        const dy = to[1] - from.lat;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // For nearby: small zoom-out; for far: bigger zoom-out
        const minZoom = Math.max(1, Math.min(fromZoom, toZoom) - Math.min(6, dist * 2));
        const stepDuration = (opts.duration || 3000) / 3;

        // Step 1: zoom out
        this._map.easeTo({
            center: from,
            zoom: minZoom,
            bearing: this._map.getBearing(),
            pitch: 0,
            duration: stepDuration,
            easing: t => t * (2 - t), // ease out
        });

        setTimeout(() => {
            // Step 2: pan to midpoint then destination
            const midLng = (from.lng + to[0]) / 2;
            const midLat = (from.lat + to[1]) / 2;
            this._map.easeTo({
                center: [midLng, midLat],
                zoom: minZoom,
                bearing: (opts.bearing || 0) / 2,
                pitch: 0,
                duration: stepDuration,
                easing: t => t,
            });

            setTimeout(() => {
                // Step 3: zoom in to destination
                this._map.easeTo({
                    center: to,
                    zoom: toZoom,
                    bearing: opts.bearing || 0,
                    pitch: opts.pitch || 0,
                    duration: stepDuration,
                    easing: t => t * t, // ease in
                });
            }, stepDuration);
        }, stepDuration);
    },

    fitBounds(bounds, padding = 50) {
        if (!this._map || !bounds) return;
        this._map.fitBounds(bounds, { padding, duration: 1500 });
    },

    getState() {
        if (!this._map) return {};
        const center = this._map.getCenter();
        return {
            center: { lng: center.lng, lat: center.lat },
            zoom: this._map.getZoom(),
            bearing: this._map.getBearing(),
            pitch: this._map.getPitch(),
        };
    },

    // ── Drawing Tools (MapboxDraw) ─────────
    _draw: null,

    initDraw(onChange, onSelect) {
        if (!this._map || this._draw) return this._draw;
        if (typeof MapboxDraw === 'undefined') {
            console.warn('MapboxDraw not loaded');
            return null;
        }
        this._draw = new MapboxDraw({
            displayControlsDefault: false,
            controls: {},
            styles: [
                // Line
                { id: 'gl-draw-line', type: 'line', filter: ['all', ['==', '$type', 'LineString'], ['!=', 'mode', 'static']],
                  paint: { 'line-color': ['coalesce', ['get', 'user_color'], '#4f6df5'], 'line-width': ['coalesce', ['get', 'user_stroke_width'], 3], 'line-dasharray': [2, 1] }},
                { id: 'gl-draw-line-static', type: 'line', filter: ['all', ['==', '$type', 'LineString'], ['==', 'mode', 'static']],
                  paint: { 'line-color': ['coalesce', ['get', 'user_color'], '#4f6df5'], 'line-width': ['coalesce', ['get', 'user_stroke_width'], 3] }},
                // Polygon
                { id: 'gl-draw-polygon-fill', type: 'fill', filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
                  paint: { 'fill-color': ['coalesce', ['get', 'user_color'], '#4f6df5'], 'fill-opacity': ['coalesce', ['get', 'user_fill_opacity'], 0.15] }},
                { id: 'gl-draw-polygon-stroke', type: 'line', filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
                  paint: { 'line-color': ['coalesce', ['get', 'user_color'], '#4f6df5'], 'line-width': ['coalesce', ['get', 'user_stroke_width'], 2], 'line-dasharray': [2, 1] }},
                { id: 'gl-draw-polygon-fill-static', type: 'fill', filter: ['all', ['==', '$type', 'Polygon'], ['==', 'mode', 'static']],
                  paint: { 'fill-color': ['coalesce', ['get', 'user_color'], '#4f6df5'], 'fill-opacity': ['coalesce', ['get', 'user_fill_opacity'], 0.2] }},
                { id: 'gl-draw-polygon-stroke-static', type: 'line', filter: ['all', ['==', '$type', 'Polygon'], ['==', 'mode', 'static']],
                  paint: { 'line-color': ['coalesce', ['get', 'user_color'], '#4f6df5'], 'line-width': ['coalesce', ['get', 'user_stroke_width'], 2] }},
                // Vertices
                { id: 'gl-draw-point', type: 'circle', filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'vertex']],
                  paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': '#4f6df5', 'circle-stroke-width': 2 }},
                { id: 'gl-draw-point-mid', type: 'circle', filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'midpoint']],
                  paint: { 'circle-radius': 3, 'circle-color': '#4f6df5' }},
            ],
        });
        this._map.addControl(this._draw);
        if (onChange) {
            this._map.on('draw.create', onChange);
            this._map.on('draw.update', onChange);
            this._map.on('draw.delete', onChange);
        }
        if (onSelect) {
            this._map.on('draw.selectionchange', onSelect);
        }
        return this._draw;
    },

    updateDrawFeature(featureId, properties) {
        if (!this._draw) return;
        const feat = this._draw.get(featureId);
        if (!feat) return;
        feat.properties = { ...feat.properties, ...properties };
        this._draw.add(feat);
    },

    getDraw() { return this._draw; },

    setDrawFeatures(geojson) {
        if (!this._draw) return;
        this._draw.deleteAll();
        if (geojson?.features) {
            geojson.features.forEach(f => this._draw.add(f));
        }
    },

    getDrawFeatures() {
        if (!this._draw) return null;
        return this._draw.getAll();
    },

    startDrawLine() {
        if (this._draw) this._draw.changeMode('draw_line_string');
    },

    startDrawPolygon() {
        if (this._draw) this._draw.changeMode('draw_polygon');
    },

    deleteDrawSelected() {
        if (this._draw) this._draw.trash();
    },

    destroyDraw() {
        if (this._draw && this._map) {
            this._map.removeControl(this._draw);
            this._draw = null;
        }
    },

    // ── Map Comparison (Swipe) ────────────
    _compareMap: null,
    _compareDivider: null,
    _compareContainer: null,
    _compareDragging: false,

    enableCompare(basemap) {
        if (!this._map) return;
        this.disableCompare();

        const mapContainer = this._map.getContainer().parentElement;

        // Create overlay container for the second map
        const overlay = document.createElement('div');
        overlay.id = 'map-compare-overlay';
        overlay.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;z-index:5;pointer-events:none;';
        mapContainer.appendChild(overlay);
        this._compareContainer = overlay;

        // Set initial clip to right half
        const midX = mapContainer.offsetWidth / 2;
        overlay.style.clipPath = `inset(0 0 0 ${midX}px)`;

        // Create second map
        const style = this._buildStyle(basemap);
        this._compareMap = new maplibregl.Map({
            container: overlay,
            style: style,
            center: this._map.getCenter(),
            zoom: this._map.getZoom(),
            bearing: this._map.getBearing(),
            pitch: this._map.getPitch(),
            maxPitch: 85,
            interactive: false,
            attributionControl: false,
        });

        // Sync maps
        this._syncCompareMap = () => {
            if (!this._compareMap) return;
            this._compareMap.jumpTo({
                center: this._map.getCenter(),
                zoom: this._map.getZoom(),
                bearing: this._map.getBearing(),
                pitch: this._map.getPitch(),
            });
        };
        this._map.on('move', this._syncCompareMap);

        // Create draggable divider with handle
        const divider = document.createElement('div');
        divider.className = 'map-compare-divider';
        divider.style.left = midX + 'px';
        divider.title = I18n?.t('viewer.compare_drag') || 'Drag to compare';

        // Add handle icon
        const handle = document.createElement('div');
        handle.className = 'map-compare-handle';
        handle.innerHTML = '<i class="bi bi-arrows-expand"></i>';
        divider.appendChild(handle);

        mapContainer.appendChild(divider);
        this._compareDivider = divider;

        // Add basemap labels
        const mainBasemapObj = (this._basemaps || []).find(b => b.id === this._currentBasemap || b.name === this._currentBasemap);
        const labelLeft = document.createElement('div');
        labelLeft.className = 'map-compare-label map-compare-label-left';
        labelLeft.textContent = mainBasemapObj?.name || this._currentBasemap || I18n?.t('viewer.compare_left') || 'Base';
        mapContainer.appendChild(labelLeft);

        const labelRight = document.createElement('div');
        labelRight.className = 'map-compare-label map-compare-label-right';
        labelRight.textContent = basemap.name || I18n?.t('viewer.compare_right') || 'Compare';
        mapContainer.appendChild(labelRight);

        this._compareLabels = [labelLeft, labelRight];

        // Drag logic
        const onMove = (clientX) => {
            const rect = mapContainer.getBoundingClientRect();
            let x = clientX - rect.left;
            x = Math.max(40, Math.min(x, rect.width - 40));
            divider.style.left = x + 'px';
            overlay.style.clipPath = `inset(0 0 0 ${x}px)`;
        };

        const onMouseMove = (e) => { if (this._compareDragging) { e.preventDefault(); onMove(e.clientX); } };
        const onTouchMove = (e) => { if (this._compareDragging && e.touches.length) onMove(e.touches[0].clientX); };
        const onEnd = () => { this._compareDragging = false; document.body.style.cursor = ''; divider.classList.remove('dragging'); };

        divider.addEventListener('mousedown', (e) => { e.preventDefault(); this._compareDragging = true; document.body.style.cursor = 'ew-resize'; divider.classList.add('dragging'); });
        divider.addEventListener('touchstart', (e) => { e.preventDefault(); this._compareDragging = true; divider.classList.add('dragging'); }, { passive: false });
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('touchmove', onTouchMove);
        document.addEventListener('mouseup', onEnd);
        document.addEventListener('touchend', onEnd);

        // Store listeners for cleanup
        this._compareListeners = { onMouseMove, onTouchMove, onEnd };
    },

    disableCompare() {
        if (this._compareMap) {
            if (this._syncCompareMap) {
                this._map?.off('move', this._syncCompareMap);
                this._syncCompareMap = null;
            }
            this._compareMap.remove();
            this._compareMap = null;
        }
        if (this._compareContainer) {
            this._compareContainer.remove();
            this._compareContainer = null;
        }
        if (this._compareDivider) {
            this._compareDivider.remove();
            this._compareDivider = null;
        }
        if (this._compareLabels) {
            this._compareLabels.forEach(l => l.remove());
            this._compareLabels = null;
        }
        if (this._compareListeners) {
            document.removeEventListener('mousemove', this._compareListeners.onMouseMove);
            document.removeEventListener('touchmove', this._compareListeners.onTouchMove);
            document.removeEventListener('mouseup', this._compareListeners.onEnd);
            document.removeEventListener('touchend', this._compareListeners.onEnd);
            this._compareListeners = null;
        }
        this._compareDragging = false;
    },

    // ── COG (Cloud Optimized GeoTIFF) Protocol ──
    _cogCache: {},

    _registerCogProtocol() {
        if (this._cogProtocolRegistered) return;
        if (!this._map || typeof GeoTIFF === 'undefined') return;

        maplibregl.addProtocol('cog', async (params, abortController) => {
            const url = params.url.replace('cog://', '');
            const [z, x, y] = params.url.match(/(\d+)\/(\d+)\/(\d+)/)?.slice(1).map(Number) || [];

            try {
                // Cache the GeoTIFF object per URL
                if (!this._cogCache[url]) {
                    this._cogCache[url] = await GeoTIFF.fromUrl(url, {
                        allowFullFile: false,
                    });
                }
                const tiff = this._cogCache[url];
                const image = await tiff.getImage();
                const bbox = image.getBoundingBox();
                const width = image.getWidth();
                const height = image.getHeight();

                // Calculate tile bounds
                const tileSize = 256;
                const totalTiles = Math.pow(2, z);
                const tileMinX = (x / totalTiles) * 360 - 180;
                const tileMaxX = ((x + 1) / totalTiles) * 360 - 180;
                const tileMaxY = (180 / Math.PI) * (2 * Math.atan(Math.exp(Math.PI * (1 - 2 * y / totalTiles))) - Math.PI / 2);
                const tileMinY = (180 / Math.PI) * (2 * Math.atan(Math.exp(Math.PI * (1 - 2 * (y + 1) / totalTiles))) - Math.PI / 2);

                // Check if tile intersects COG bounds
                if (tileMaxX < bbox[0] || tileMinX > bbox[2] || tileMaxY < bbox[1] || tileMinY > bbox[3]) {
                    // Return transparent tile
                    const canvas = new OffscreenCanvas(tileSize, tileSize);
                    const blob = await canvas.convertToBlob({ type: 'image/png' });
                    const buf = await blob.arrayBuffer();
                    return { data: new Uint8Array(buf) };
                }

                // Calculate pixel window in the COG
                const resX = (bbox[2] - bbox[0]) / width;
                const resY = (bbox[3] - bbox[1]) / height;
                const winLeft = Math.max(0, Math.floor((tileMinX - bbox[0]) / resX));
                const winTop = Math.max(0, Math.floor((bbox[3] - tileMaxY) / resY));
                const winRight = Math.min(width, Math.ceil((tileMaxX - bbox[0]) / resX));
                const winBottom = Math.min(height, Math.ceil((bbox[3] - tileMinY) / resY));
                const winWidth = winRight - winLeft;
                const winHeight = winBottom - winTop;

                if (winWidth <= 0 || winHeight <= 0) {
                    const canvas = new OffscreenCanvas(tileSize, tileSize);
                    const blob = await canvas.convertToBlob({ type: 'image/png' });
                    const buf = await blob.arrayBuffer();
                    return { data: new Uint8Array(buf) };
                }

                // Read raster data with overview selection
                const rasters = await image.readRasters({
                    window: [winLeft, winTop, winRight, winBottom],
                    width: tileSize,
                    height: tileSize,
                    interleave: false,
                });

                // Render to canvas
                const canvas = new OffscreenCanvas(tileSize, tileSize);
                const ctx = canvas.getContext('2d');
                const imgData = ctx.createImageData(tileSize, tileSize);

                const numBands = rasters.length;
                for (let i = 0; i < tileSize * tileSize; i++) {
                    if (numBands >= 3) {
                        // RGB
                        imgData.data[i * 4] = rasters[0][i];
                        imgData.data[i * 4 + 1] = rasters[1][i];
                        imgData.data[i * 4 + 2] = rasters[2][i];
                        imgData.data[i * 4 + 3] = numBands >= 4 ? rasters[3][i] : 255;
                    } else {
                        // Grayscale
                        const v = rasters[0][i];
                        imgData.data[i * 4] = v;
                        imgData.data[i * 4 + 1] = v;
                        imgData.data[i * 4 + 2] = v;
                        imgData.data[i * 4 + 3] = v === 0 ? 0 : 255;
                    }
                }
                ctx.putImageData(imgData, 0, 0);

                const blob = await canvas.convertToBlob({ type: 'image/png' });
                const buf = await blob.arrayBuffer();
                return { data: new Uint8Array(buf) };
            } catch (err) {
                console.error('COG tile error:', err);
                const canvas = new OffscreenCanvas(256, 256);
                const blob = await canvas.convertToBlob({ type: 'image/png' });
                const buf = await blob.arrayBuffer();
                return { data: new Uint8Array(buf) };
            }
        });
        this._cogProtocolRegistered = true;
    },

    // ── Measurement Tools ─────────────────
    _measureState: null, // { mode: 'distance'|'area', points: [[lng,lat],...], listeners: {} }

    _haversineDistance(coord1, coord2) {
        const R = 6371000;
        const toRad = d => d * Math.PI / 180;
        const dLat = toRad(coord2[1] - coord1[1]);
        const dLon = toRad(coord2[0] - coord1[0]);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(coord1[1])) * Math.cos(toRad(coord2[1])) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    },

    _polygonArea(coords) {
        let area = 0;
        const toRad = d => d * Math.PI / 180;
        const R = 6371000;
        for (let i = 0; i < coords.length; i++) {
            const j = (i + 1) % coords.length;
            area += toRad(coords[j][0] - coords[i][0]) * (2 + Math.sin(toRad(coords[i][1])) + Math.sin(toRad(coords[j][1])));
        }
        return Math.abs(area * R * R / 2);
    },

    _formatDistance(meters) {
        if (meters >= 1000) return (meters / 1000).toFixed(2) + ' km';
        return meters.toFixed(1) + ' m';
    },

    _formatArea(sqMeters) {
        if (sqMeters >= 1e6) return (sqMeters / 1e6).toFixed(3) + ' km\u00b2';
        if (sqMeters >= 1e4) return (sqMeters / 1e4).toFixed(2) + ' ha';
        return sqMeters.toFixed(1) + ' m\u00b2';
    },

    _cleanupMeasureListeners() {
        if (!this._measureState || !this._map) return;
        const ls = this._measureState.listeners;
        if (ls.onClick) this._map.off('click', ls.onClick);
        if (ls.onDblClick) this._map.off('dblclick', ls.onDblClick);
        if (ls.onMouseMove) this._map.off('mousemove', ls.onMouseMove);
        this._map.getCanvas().style.cursor = '';
        this._measureState = null;
    },

    _updateMeasureSources() {
        if (!this._map || !this._measureState) return;
        const pts = this._measureState.points;
        const mode = this._measureState.mode;

        if (mode === 'distance') {
            const lineData = { type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} };
            const pointData = { type: 'FeatureCollection', features: pts.map((p, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { idx: i } })) };
            if (this._map.getSource('measure-line')) this._map.getSource('measure-line').setData(lineData);
            if (this._map.getSource('measure-points')) this._map.getSource('measure-points').setData(pointData);

            // Compute total distance
            let total = 0;
            for (let i = 1; i < pts.length; i++) total += this._haversineDistance(pts[i - 1], pts[i]);
            // Update label at last point
            if (pts.length >= 2) {
                const labelData = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: pts[pts.length - 1] }, properties: { label: this._formatDistance(total) } }] };
                if (this._map.getSource('measure-labels')) this._map.getSource('measure-labels').setData(labelData);
            }
        } else if (mode === 'area') {
            const ring = pts.length >= 3 ? [...pts, pts[0]] : pts;
            const polyData = { type: 'Feature', geometry: { type: pts.length >= 3 ? 'Polygon' : 'LineString', coordinates: pts.length >= 3 ? [ring] : pts }, properties: {} };
            const outlineData = { type: 'Feature', geometry: { type: 'LineString', coordinates: ring }, properties: {} };
            if (this._map.getSource('measure-polygon')) this._map.getSource('measure-polygon').setData(polyData);
            if (this._map.getSource('measure-polygon-outline')) this._map.getSource('measure-polygon-outline').setData(outlineData);

            if (pts.length >= 3) {
                const area = this._polygonArea(pts);
                // Centroid for label
                let cx = 0, cy = 0;
                pts.forEach(p => { cx += p[0]; cy += p[1]; });
                cx /= pts.length; cy /= pts.length;
                const labelData = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [cx, cy] }, properties: { label: this._formatArea(area) } }] };
                if (this._map.getSource('measure-labels')) this._map.getSource('measure-labels').setData(labelData);
            }
        }
    },

    _ensureMeasureSources(mode) {
        if (!this._map) return;
        const empty = { type: 'FeatureCollection', features: [] };
        const emptyLine = { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} };

        if (mode === 'distance') {
            if (!this._map.getSource('measure-line')) {
                this._map.addSource('measure-line', { type: 'geojson', data: emptyLine });
                this._map.addLayer({ id: 'measure-line-layer', type: 'line', source: 'measure-line', paint: { 'line-color': '#ff4444', 'line-width': 3, 'line-dasharray': [2, 1] } });
            }
            if (!this._map.getSource('measure-points')) {
                this._map.addSource('measure-points', { type: 'geojson', data: empty });
                this._map.addLayer({ id: 'measure-points-layer', type: 'circle', source: 'measure-points', paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': '#ff4444', 'circle-stroke-width': 2 } });
            }
        } else if (mode === 'area') {
            if (!this._map.getSource('measure-polygon')) {
                this._map.addSource('measure-polygon', { type: 'geojson', data: empty });
                this._map.addLayer({ id: 'measure-polygon-layer', type: 'fill', source: 'measure-polygon', paint: { 'fill-color': '#ff4444', 'fill-opacity': 0.15 } });
            }
            if (!this._map.getSource('measure-polygon-outline')) {
                this._map.addSource('measure-polygon-outline', { type: 'geojson', data: emptyLine });
                this._map.addLayer({ id: 'measure-polygon-outline-layer', type: 'line', source: 'measure-polygon-outline', paint: { 'line-color': '#ff4444', 'line-width': 2, 'line-dasharray': [2, 1] } });
            }
        }

        // Shared label source
        if (!this._map.getSource('measure-labels')) {
            this._map.addSource('measure-labels', { type: 'geojson', data: empty });
            this._map.addLayer({ id: 'measure-labels-layer', type: 'symbol', source: 'measure-labels', layout: { 'text-field': ['get', 'label'], 'text-size': 14, 'text-offset': [0, -1.5], 'text-anchor': 'bottom', 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 2 } });
        }
    },

    startMeasureDistance() {
        if (!this._map) return;
        this._cleanupMeasureListeners();
        this._ensureMeasureSources('distance');
        this._measureState = { mode: 'distance', points: [], listeners: {} };
        this._map.getCanvas().style.cursor = 'crosshair';

        const onClick = (e) => {
            this._measureState.points.push([e.lngLat.lng, e.lngLat.lat]);
            this._updateMeasureSources();
        };
        const onDblClick = (e) => {
            e.preventDefault();
            this._cleanupMeasureListeners();
            // Show clear button
            if (typeof StoryEditor !== 'undefined' && StoryEditor._showMeasureClearBtn) StoryEditor._showMeasureClearBtn();
        };

        this._measureState.listeners.onClick = onClick;
        this._measureState.listeners.onDblClick = onDblClick;
        this._map.on('click', onClick);
        this._map.on('dblclick', onDblClick);
    },

    startMeasureArea() {
        if (!this._map) return;
        this._cleanupMeasureListeners();
        this._ensureMeasureSources('area');
        this._measureState = { mode: 'area', points: [], listeners: {} };
        this._map.getCanvas().style.cursor = 'crosshair';

        const onClick = (e) => {
            this._measureState.points.push([e.lngLat.lng, e.lngLat.lat]);
            this._updateMeasureSources();
        };
        const onDblClick = (e) => {
            e.preventDefault();
            this._cleanupMeasureListeners();
            if (typeof StoryEditor !== 'undefined' && StoryEditor._showMeasureClearBtn) StoryEditor._showMeasureClearBtn();
        };

        this._measureState.listeners.onClick = onClick;
        this._measureState.listeners.onDblClick = onDblClick;
        this._map.on('click', onClick);
        this._map.on('dblclick', onDblClick);
    },

    // ── Auto-Refresh (periodic layer data reload) ──
    _refreshTimers: {},

    refreshLayerData(id) {
        const layerId = this._layerIdMap[id];
        if (!layerId || !this._map) return;
        const source = this._map.getSource(`layer-${id}`);
        if (!source) return;
        // For GeoJSON sources, re-fetch the URL
        if (source.type === 'geojson' && source._options?.data && typeof source._options.data === 'string') {
            // Add cache-buster
            const url = source._options.data.split('?')[0] + '?_t=' + Date.now();
            source.setData(url);
        }
    },

    startAutoRefresh(id, intervalMinutes) {
        this.stopAutoRefresh(id);
        if (!intervalMinutes || intervalMinutes < 1) return;
        this._refreshTimers[id] = setInterval(() => {
            this.refreshLayerData(id);
        }, intervalMinutes * 60 * 1000);
    },

    stopAutoRefresh(id) {
        if (this._refreshTimers[id]) {
            clearInterval(this._refreshTimers[id]);
            delete this._refreshTimers[id];
        }
    },

    stopAllAutoRefresh() {
        Object.keys(this._refreshTimers).forEach(id => this.stopAutoRefresh(id));
    },

    clearMeasurements() {
        if (!this._map) return;
        this._cleanupMeasureListeners();
        const empty = { type: 'FeatureCollection', features: [] };
        const emptyLine = { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} };

        // Remove sources and layers
        ['measure-line-layer', 'measure-points-layer', 'measure-polygon-layer', 'measure-polygon-outline-layer', 'measure-labels-layer'].forEach(id => {
            try { if (this._map.getLayer(id)) this._map.removeLayer(id); } catch {}
        });
        ['measure-line', 'measure-points', 'measure-polygon', 'measure-polygon-outline', 'measure-labels'].forEach(id => {
            try { if (this._map.getSource(id)) this._map.removeSource(id); } catch {}
        });
    },
};
