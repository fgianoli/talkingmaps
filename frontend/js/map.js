/**
 * TalkingMaps – MapLibre GL JS Map Module
 * Inspired by sitvi webgis-map-init.js and anncsu map.js
 */
const TmMap = {
    _map: null,
    _markers: [],
    _layerIdMap: {},
    _currentBasemap: 'osm',
    _basemaps: [],
    _onClickCallback: null,

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
        });

        this._map.addControl(new maplibregl.NavigationControl(), 'top-right');
        this._map.addControl(new maplibregl.ScaleControl(), 'bottom-left');

        return this._map;
    },

    getMap() { return this._map; },

    destroy() {
        if (this._map) {
            this._map.remove();
            this._map = null;
        }
        this._markers = [];
        this._layerIdMap = {};
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
        return {
            version: 8,
            sources: {
                'basemap': {
                    type: basemap.type === 'wms' ? 'raster' : 'raster',
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

    setBasemap(basemap) {
        if (!this._map) return;
        const style = this._buildStyle(basemap);
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
            this._map.addSource(sourceId, {
                type: 'geojson',
                data: source_config.url || source_config.data || { type: 'FeatureCollection', features: [] },
            });
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
        }

        // Add layer with style
        if (layer_type === 'wms' || layer_type === 'wmts' || layer_type === 'xyz') {
            this._map.addLayer({
                id: layerId,
                type: 'raster',
                source: sourceId,
                paint: style_config?.paint || { 'raster-opacity': layerConfig.opacity || 1 },
            });
        } else if (layer_type === 'geojson' || layer_type === 'vector-tiles') {
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
            if (this._map.getLayer(layerId)) this._map.removeLayer(layerId);
            if (this._map.getSource(`layer-${id}`)) this._map.removeSource(`layer-${id}`);
        } catch { /* ok */ }
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

    initDraw(onChange) {
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
                  paint: { 'line-color': '#4f6df5', 'line-width': 3, 'line-dasharray': [2, 1] }},
                { id: 'gl-draw-line-static', type: 'line', filter: ['all', ['==', '$type', 'LineString'], ['==', 'mode', 'static']],
                  paint: { 'line-color': '#4f6df5', 'line-width': 3 }},
                // Polygon
                { id: 'gl-draw-polygon-fill', type: 'fill', filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
                  paint: { 'fill-color': '#4f6df5', 'fill-opacity': 0.15 }},
                { id: 'gl-draw-polygon-stroke', type: 'line', filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
                  paint: { 'line-color': '#4f6df5', 'line-width': 2, 'line-dasharray': [2, 1] }},
                { id: 'gl-draw-polygon-fill-static', type: 'fill', filter: ['all', ['==', '$type', 'Polygon'], ['==', 'mode', 'static']],
                  paint: { 'fill-color': '#4f6df5', 'fill-opacity': 0.2 }},
                { id: 'gl-draw-polygon-stroke-static', type: 'line', filter: ['all', ['==', '$type', 'Polygon'], ['==', 'mode', 'static']],
                  paint: { 'line-color': '#4f6df5', 'line-width': 2 }},
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
        return this._draw;
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
};
