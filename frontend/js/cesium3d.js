/**
 * TalkingMaps – Cesium 3D Viewer Module
 * Supports globe view, 3D terrain, point clouds (3D Tiles), mesh/BIM
 */
const Cesium3D = {
    _viewer: null,
    _tilesets: [],
    _entities: [],
    _active: false,

    /**
     * Initialize CesiumJS viewer
     * @param {string} containerId - DOM container ID
     * @param {object} opts - { ionToken, terrain, camera }
     */
    init(containerId, opts = {}) {
        // Configure ion token if provided (for Cesium ion assets)
        if (opts.ionToken) {
            Cesium.Ion.defaultAccessToken = opts.ionToken;
        }

        this._viewer = new Cesium.Viewer(containerId, {
            terrain: opts.terrain !== false ? Cesium.Terrain.fromWorldTerrain() : undefined,
            baseLayerPicker: false,
            geocoder: false,
            homeButton: false,
            sceneModePicker: false,
            selectionIndicator: true,
            timeline: false,
            animation: false,
            navigationHelpButton: false,
            fullscreenButton: false,
            infoBox: true,
            scene3DOnly: true,
            msaaSamples: 4,
        });

        // Remove Cesium credits overlay (use custom attribution)
        this._viewer.cesiumWidget.creditContainer.style.display = 'none';

        // Enable depth testing against terrain
        this._viewer.scene.globe.depthTestAgainstTerrain = true;

        // Camera initial position
        if (opts.camera) {
            this.flyTo(opts.camera);
        }

        this._active = true;
        return this._viewer;
    },

    getViewer() { return this._viewer; },
    isActive() { return this._active; },

    destroy() {
        if (this._viewer) {
            this._viewer.destroy();
            this._viewer = null;
        }
        this._tilesets = [];
        this._entities = [];
        this._active = false;
    },

    // ── Camera ───────────────────────────
    flyTo(opts) {
        if (!this._viewer) return;
        const destination = opts.position
            ? Cesium.Cartesian3.fromDegrees(opts.position[0], opts.position[1], opts.position[2] || 1000)
            : Cesium.Cartesian3.fromDegrees(11.88, 45.41, 50000);

        this._viewer.camera.flyTo({
            destination,
            orientation: {
                heading: Cesium.Math.toRadians(opts.heading || 0),
                pitch: Cesium.Math.toRadians(opts.pitch || -45),
                roll: 0,
            },
            duration: opts.duration || 2,
        });
    },

    // ── 3D Tiles (Point Clouds, Mesh, BIM) ──
    async addTileset(opts) {
        if (!this._viewer) return null;

        let tileset;
        if (opts.ionAssetId) {
            // Load from Cesium ion
            tileset = await Cesium.Cesium3DTileset.fromIonAssetId(opts.ionAssetId);
        } else if (opts.url) {
            // Load from URL (e.g., local 3D Tiles)
            tileset = await Cesium.Cesium3DTileset.fromUrl(opts.url, {
                maximumScreenSpaceError: opts.screenSpaceError || 16,
                maximumMemoryUsage: opts.maxMemory || 512,
            });
        }

        if (!tileset) return null;

        // Custom styling
        if (opts.style) {
            tileset.style = new Cesium.Cesium3DTileStyle(opts.style);
        }

        // Point size for point clouds
        if (opts.pointSize) {
            tileset.style = new Cesium.Cesium3DTileStyle({
                pointSize: opts.pointSize,
            });
        }

        // Color by classification/height
        if (opts.colorByHeight) {
            tileset.style = new Cesium.Cesium3DTileStyle({
                color: {
                    conditions: [
                        ['${Height} >= 100', 'color("red")'],
                        ['${Height} >= 50', 'color("orange")'],
                        ['${Height} >= 20', 'color("yellow")'],
                        ['${Height} >= 5', 'color("lime")'],
                        ['true', 'color("cyan")'],
                    ]
                },
                pointSize: opts.pointSize || 3,
            });
        }

        this._viewer.scene.primitives.add(tileset);
        this._tilesets.push({ id: opts.id || Date.now(), tileset, name: opts.name });

        // Zoom to tileset
        if (opts.zoomTo !== false) {
            this._viewer.zoomTo(tileset);
        }

        return tileset;
    },

    removeTileset(id) {
        const idx = this._tilesets.findIndex(t => t.id === id);
        if (idx === -1) return;
        this._viewer.scene.primitives.remove(this._tilesets[idx].tileset);
        this._tilesets.splice(idx, 1);
    },

    // ── GeoJSON entities ─────────────────
    async addGeoJSON(opts) {
        if (!this._viewer) return null;
        const dataSource = await Cesium.GeoJsonDataSource.load(opts.url || opts.data, {
            stroke: Cesium.Color.fromCssColorString(opts.strokeColor || '#3388ff'),
            fill: Cesium.Color.fromCssColorString(opts.fillColor || '#3388ff').withAlpha(opts.fillOpacity || 0.4),
            strokeWidth: opts.strokeWidth || 2,
            clampToGround: opts.clampToGround !== false,
        });

        this._viewer.dataSources.add(dataSource);

        // Extrude polygons if height field provided
        if (opts.extrudeField) {
            dataSource.entities.values.forEach(entity => {
                if (entity.polygon) {
                    const height = entity.properties?.[opts.extrudeField]?.getValue() || 10;
                    entity.polygon.extrudedHeight = height;
                }
            });
        }

        if (opts.zoomTo !== false) {
            this._viewer.zoomTo(dataSource);
        }

        return dataSource;
    },

    // ── Markers ──────────────────────────
    addMarker3D(opts) {
        if (!this._viewer) return null;
        const entity = this._viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(opts.lng, opts.lat, opts.height || 0),
            billboard: {
                image: opts.icon || this._createMarkerIcon(opts.color || '#e74c3c'),
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                scale: opts.scale || 1,
            },
            label: opts.title ? {
                text: opts.title,
                font: '13px Inter, sans-serif',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -36),
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            } : undefined,
            description: opts.popup_content || undefined,
        });
        this._entities.push(entity);
        return entity;
    },

    _createMarkerIcon(color) {
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        // Pin shape
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(12, 12, 10, Math.PI, 0);
        ctx.lineTo(12, 32);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();
        // Inner circle
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(12, 12, 4, 0, Math.PI * 2);
        ctx.fill();
        return canvas.toDataURL();
    },

    clearEntities() {
        this._entities.forEach(e => this._viewer.entities.remove(e));
        this._entities = [];
    },

    // ── Sync with 2D map ─────────────────
    syncFrom2D(mapState) {
        if (!this._viewer) return;
        this.flyTo({
            position: [mapState.center.lng, mapState.center.lat, this._zoomToHeight(mapState.zoom)],
            heading: mapState.bearing || 0,
            pitch: -(mapState.pitch || 45),
        });
    },

    _zoomToHeight(zoom) {
        // Approximate MapLibre zoom level to Cesium camera height
        return 40000000 / Math.pow(2, zoom);
    },
};
