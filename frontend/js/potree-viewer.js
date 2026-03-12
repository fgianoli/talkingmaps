/**
 * TalkingMaps – Potree Point Cloud Viewer
 * Lightweight wrapper for Potree 2.x embedded point cloud visualization
 * Supports: LAS/LAZ, PLY, Potree octree format, Entwine/EPT
 */
const PotreeViewer = {
    _instances: {},
    _loaded: false,

    /**
     * Lazy-load Potree libraries
     */
    async _ensureLoaded() {
        if (this._loaded) return;

        // Load Potree from CDN
        await this._loadScript('https://cdn.jsdelivr.net/npm/potree-core@1.1.3/dist/potree.min.js');
        this._loaded = true;
    },

    _loadScript(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
            const s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        });
    },

    /**
     * Initialize a point cloud viewer
     * @param {string} containerId - DOM container ID
     * @param {object} config - { url, pointSize, pointBudget, colorMode, height }
     */
    async init(containerId, config) {
        const container = document.getElementById(containerId);
        if (!container) return;

        // If Potree not available, use Three.js fallback with simple point rendering
        if (typeof Potree === 'undefined') {
            await this._ensureLoaded();
        }

        // If still not available, show placeholder with info
        if (typeof Potree === 'undefined') {
            container.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;
                            background:var(--tm-surface);border-radius:var(--tm-radius-sm);color:var(--tm-text-muted)">
                    <i class="bi bi-cloud-fill" style="font-size:48px;margin-bottom:12px"></i>
                    <p style="margin:0;font-size:14px">Nuvola di punti 3D</p>
                    <small>${config.url || 'Point cloud'}</small>
                    <a href="${config.url || '#'}" target="_blank" class="btn btn-sm btn-outline-light mt-3">
                        <i class="bi bi-box-arrow-up-right"></i> Apri in viewer esterno
                    </a>
                </div>
            `;
            return;
        }

        // Initialize Potree viewer
        try {
            const viewer = new Potree.Viewer(container);
            viewer.setEDLEnabled(true);
            viewer.setPointBudget(config.pointBudget || 1_000_000);
            viewer.setBackground('gradient');

            // Load point cloud
            const pointcloud = await Potree.loadPointCloud(config.url);
            viewer.scene.addPointCloud(pointcloud);

            // Configure appearance
            const material = pointcloud.material;
            material.size = config.pointSize || 1;
            material.pointSizeType = Potree.PointSizeType.ADAPTIVE;

            // Color mode
            switch (config.colorMode) {
                case 'rgb':
                    material.pointColorType = Potree.PointColorType.RGB;
                    break;
                case 'height':
                    material.pointColorType = Potree.PointColorType.HEIGHT;
                    break;
                case 'intensity':
                    material.pointColorType = Potree.PointColorType.INTENSITY;
                    break;
                case 'classification':
                    material.pointColorType = Potree.PointColorType.CLASSIFICATION;
                    break;
                default:
                    material.pointColorType = Potree.PointColorType.RGB;
            }

            // Fit view
            viewer.fitToScreen();

            this._instances[containerId] = viewer;
        } catch (err) {
            console.error('Potree init error:', err);
            container.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:center;height:100%;
                            background:var(--tm-surface);color:var(--tm-danger)">
                    <p><i class="bi bi-exclamation-triangle"></i> Errore caricamento nuvola di punti</p>
                </div>
            `;
        }
    },

    destroy(containerId) {
        if (this._instances[containerId]) {
            // Potree cleanup
            try { this._instances[containerId].destroy(); } catch { /* ok */ }
            delete this._instances[containerId];
        }
    },

    destroyAll() {
        Object.keys(this._instances).forEach(id => this.destroy(id));
    },
};
