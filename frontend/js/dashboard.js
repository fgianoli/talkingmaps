/**
 * TalkingMaps – Dashboard, Layers, Users, Basemaps Admin
 * All prompt/confirm replaced with App.modal/App.confirm
 */
const Dashboard = {
    async load() {
        const panel = document.getElementById('panel-dashboard');
        panel.innerHTML = `<div class="tm-empty-state"><i class="bi bi-arrow-repeat spin"></i><p>${I18n.t('loading')}</p></div>`;

        try {
            const stories = await Api.listStories();
            this._renderDashboard(panel, stories);
        } catch (err) {
            panel.innerHTML = `<div class="tm-empty-state"><i class="bi bi-exclamation-triangle"></i><p>${App.escHtml(err.message)}</p></div>`;
        }
    },

    async loadPublic() {
        const panel = document.getElementById('panel-dashboard');
        panel.innerHTML = `<div class="tm-empty-state"><i class="bi bi-arrow-repeat spin"></i><p>${I18n.t('loading')}</p></div>`;
        try {
            const stories = await Api.listPublicStories();
            this._renderPublicDashboard(panel, stories);
        } catch (err) {
            panel.innerHTML = `<div class="tm-empty-state"><i class="bi bi-exclamation-triangle"></i><p>${App.escHtml(err.message)}</p></div>`;
        }
    },

    _renderDashboard(panel, stories) {
        const published = stories.filter(s => s.status === 'published').length;
        const drafts = stories.filter(s => s.status === 'draft').length;
        const t = I18n.t.bind(I18n);

        panel.innerHTML = `
            <div class="dashboard-header">
                <h2><i class="bi bi-book"></i> ${t('dash.your_stories')}</h2>
                <div class="dashboard-filters">
                    <input type="text" class="form-control" id="story-search" placeholder="${t('dash.search')}">
                    <select class="form-select" id="story-filter">
                        <option value="">${t('dash.all')}</option>
                        <option value="draft">${t('dash.drafts')}</option>
                        <option value="published">${t('dash.published')}</option>
                        <option value="archived">${t('dash.archived')}</option>
                    </select>
                </div>
            </div>

            <div class="dashboard-stats">
                <div class="stat-card">
                    <div class="stat-value">${stories.length}</div>
                    <div class="stat-label">${t('dash.total')}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" style="color:var(--tm-secondary)">${published}</div>
                    <div class="stat-label">${t('dash.published')}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" style="color:var(--tm-accent)">${drafts}</div>
                    <div class="stat-label">${t('dash.drafts')}</div>
                </div>
            </div>

            <div class="stories-grid" id="stories-grid">
                ${this._renderStoryCards(stories)}
            </div>

            ${stories.length === 0 ? `
                <div class="tm-empty-state">
                    <img src="img/logo.png" style="width:80px;opacity:0.15;filter:invert(1);margin-bottom:16px">
                    <p>${t('dash.no_stories')}</p>
                    <button class="btn btn-primary" onclick="App.createNewStory()">
                        <i class="bi bi-plus-lg"></i> ${t('dash.create_first')}
                    </button>
                </div>
            ` : ''}
        `;

        document.getElementById('story-search')?.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            const status = document.getElementById('story-filter')?.value;
            const filtered = stories.filter(s =>
                (!q || s.title.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q)) &&
                (!status || s.status === status)
            );
            document.getElementById('stories-grid').innerHTML = this._renderStoryCards(filtered);
        });

        document.getElementById('story-filter')?.addEventListener('change', () => {
            document.getElementById('story-search')?.dispatchEvent(new Event('input'));
        });
    },

    _renderPublicDashboard(panel, stories) {
        const t = I18n.t.bind(I18n);
        panel.innerHTML = `
            <div class="dashboard-header">
                <div>
                    <h2><i class="bi bi-globe-americas"></i> ${t('dash.public_title')}</h2>
                    <p class="text-muted" style="margin:4px 0 0">${t('dash.public_explore')}</p>
                </div>
            </div>
            <div class="stories-grid">${this._renderStoryCards(stories, true)}</div>
            ${stories.length === 0 ? `<div class="tm-empty-state"><i class="bi bi-book"></i><p>${t('dash.no_public')}</p></div>` : ''}
        `;
    },

    _renderStoryCards(stories, publicMode = false) {
        const t = I18n.t.bind(I18n);
        const statusBadge = { draft: 'bg-warning text-dark', published: 'bg-success', archived: 'bg-secondary' };

        return stories.map(s => `
            <div class="tm-card" data-story-id="${s.id}">
                <div class="tm-card-cover" style="${s.cover_image ? `background-image:url('${s.cover_image}')` : ''}">
                    ${!publicMode ? `<span class="badge ${statusBadge[s.status] || 'bg-secondary'}">${t('status.' + s.status) || s.status}</span>` : ''}
                    ${!s.cover_image ? '<div style="display:flex;align-items:center;justify-content:center;height:100%;"><i class="bi bi-map" style="font-size:48px;opacity:0.15"></i></div>' : ''}
                </div>
                <div class="tm-card-body">
                    <h3>${App.escHtml(s.title)}</h3>
                    <p>${App.escHtml(s.description || t('story.no_desc'))}</p>
                </div>
                <div class="tm-card-footer">
                    <span>${s.author_name || ''} · ${App.formatDate(s.updated_at)}</span>
                    <div>
                        <button class="btn btn-sm btn-outline-light" onclick="Dashboard._viewStory(${s.id})" title="${t('action.view')}">
                            <i class="bi bi-eye"></i>
                        </button>
                        ${!publicMode ? `
                            <button class="btn btn-sm btn-outline-light" onclick="StoryEditor.load(${s.id})" title="${t('action.edit')}">
                                <i class="bi bi-pencil"></i>
                            </button>
                            <div class="dropdown d-inline-block">
                                <button class="btn btn-sm btn-outline-light dropdown-toggle" data-bs-toggle="dropdown">
                                    <i class="bi bi-three-dots"></i>
                                </button>
                                <ul class="dropdown-menu dropdown-menu-end">
                                    <li><a class="dropdown-item" href="#" onclick="Dashboard._duplicateStory(${s.id});return false"><i class="bi bi-copy me-2"></i>${t('action.duplicate')}</a></li>
                                    <li><a class="dropdown-item" href="#" onclick="Dashboard._shareStory('${s.share_token}');return false"><i class="bi bi-share me-2"></i>${t('action.share')}</a></li>
                                    <li><a class="dropdown-item" href="#" onclick="Dashboard._publishStory(${s.id}, '${s.status}');return false">
                                        <i class="bi bi-${s.status === 'published' ? 'archive' : 'send'} me-2"></i>
                                        ${s.status === 'published' ? t('action.archive') : t('action.publish')}
                                    </a></li>
                                    <li><hr class="dropdown-divider"></li>
                                    <li><a class="dropdown-item text-danger" href="#" onclick="Dashboard._deleteStory(${s.id});return false"><i class="bi bi-trash me-2"></i>${t('action.delete')}</a></li>
                                </ul>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `).join('');
    },

    async _viewStory(id) {
        try {
            const data = await Api.getStoryFull(id);
            StoryViewer.load(data);
        } catch (err) {
            App.toast(err.message, 'danger');
        }
    },

    async _deleteStory(id) {
        const ok = await App.confirm(I18n.t('story.delete_confirm'), { danger: true });
        if (!ok) return;
        try {
            await Api.deleteStory(id);
            App.toast(I18n.t('story.deleted'), 'success');
            this.load();
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    async _duplicateStory(id) {
        try {
            const result = await Api.duplicateStory(id);
            App.toast(I18n.t('story.duplicated'), 'success');
            StoryEditor.load(result.id);
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    async _publishStory(id, currentStatus) {
        const newStatus = currentStatus === 'published' ? 'archived' : 'published';
        const newVis = newStatus === 'published' ? 'public' : 'private';
        try {
            await Api.updateStory(id, { status: newStatus, visibility: newVis });
            App.toast(newStatus === 'published' ? I18n.t('story.published') : I18n.t('story.archived'), 'success');
            this.load();
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    _shareStory(token) {
        const url = `${window.location.origin}?share=${token}`;
        navigator.clipboard.writeText(url).then(() => {
            App.toast(I18n.t('story.share_copied'), 'success');
        }).catch(() => {
            App.prompt(I18n.t('copy_link'), url, { title: I18n.t('action.share') });
        });
    },

    // ══ Layers Catalog ═══════════════════
    async loadLayers() {
        const panel = document.getElementById('panel-layers');
        if (!panel) return;
        panel.innerHTML = `<div class="tm-empty-state"><i class="bi bi-arrow-repeat spin"></i><p>${I18n.t('loading')}</p></div>`;
        const t = I18n.t.bind(I18n);

        try {
            const layers = await Api.listLayers();
            panel.innerHTML = `
                <div class="dashboard-header">
                    <h2><i class="bi bi-layers"></i> ${t('layers.title')}</h2>
                    <div style="display:flex;gap:8px;flex-wrap:wrap">
                        <button class="btn btn-sm btn-outline-light" onclick="Dashboard._uploadNewLayer()">
                            <i class="bi bi-upload"></i> ${t('layers.upload_geojson')}
                        </button>
                        <button class="btn btn-sm btn-outline-light" onclick="Dashboard._addNewWmsLayer()">
                            <i class="bi bi-globe2"></i> ${t('layers.add_wms')}
                        </button>
                    </div>
                </div>
                <div class="layers-grid">
                    ${layers.map(l => `
                        <div class="layer-card">
                            <div class="d-flex justify-content-between align-items-start mb-2">
                                <h4>${App.escHtml(l.name)}</h4>
                                <span class="layer-type-badge">${l.layer_type}</span>
                            </div>
                            <p class="text-muted" style="font-size:13px;margin:0">${App.escHtml(l.description || t('story.no_desc'))}</p>
                            <div class="d-flex justify-content-between align-items-center mt-2">
                                <small class="text-muted">${l.public ? '<i class="bi bi-globe"></i> ' + t('story.visibility_public') : '<i class="bi bi-lock"></i> ' + t('story.visibility_private')}</small>
                                <button class="btn btn-sm btn-outline-danger" onclick="Dashboard._deleteLayer(${l.id})"><i class="bi bi-trash"></i></button>
                            </div>
                        </div>
                    `).join('')}
                    ${layers.length === 0 ? `<div class="tm-empty-state" style="grid-column:1/-1"><i class="bi bi-layers"></i><p>${t('layers.no_layers')}</p></div>` : ''}
                </div>
            `;
        } catch (err) {
            panel.innerHTML = `<div class="tm-empty-state"><i class="bi bi-exclamation-triangle"></i><p>${App.escHtml(err.message)}</p></div>`;
        }
    },

    async _uploadNewLayer() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.geojson,.json,.shp,.zip,.gpkg';
        input.onchange = async () => {
            if (!input.files[0]) return;
            try {
                await Api.uploadGeoJSON(input.files[0]);
                App.toast(I18n.t('layers.loaded'), 'success');
                this.loadLayers();
            } catch (err) { App.toast(err.message, 'danger'); }
        };
        input.click();
    },

    async _addNewWmsLayer() {
        const t = I18n.t.bind(I18n);
        const result = await App.modal({
            title: t('layers.add_wms_title'),
            body: `
                <div class="mb-3">
                    <label class="form-label">${t('layers.wms_url')}</label>
                    <input type="text" class="form-control" id="modal-wms-url" placeholder="https://...">
                </div>
                <div class="mb-3">
                    <label class="form-label">${t('layers.wms_name')}</label>
                    <input type="text" class="form-control" id="modal-wms-name" placeholder="WMS Layer">
                </div>
                <div class="mb-3">
                    <label class="form-label">${t('layers.wms_layer')}</label>
                    <input type="text" class="form-control" id="modal-wms-layers">
                </div>
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
            await Api.createLayer({
                name: result.name || 'WMS Layer',
                layer_type: 'wms',
                source_config: { url: result.url, layers: result.layers || '' },
            });
            App.toast(I18n.t('layers.added'), 'success');
            this.loadLayers();
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    async _deleteLayer(id) {
        const ok = await App.confirm(I18n.t('layers.delete_confirm'), { danger: true });
        if (!ok) return;
        try { await Api.deleteLayer(id); App.toast(I18n.t('layers.deleted'), 'success'); this.loadLayers(); }
        catch (err) { App.toast(err.message, 'danger'); }
    },

    // ══ Users Admin ═══════════════════════
    async loadUsers() {
        const panel = document.getElementById('panel-users');
        if (!panel) return;
        panel.innerHTML = `<div class="tm-empty-state"><i class="bi bi-arrow-repeat spin"></i><p>${I18n.t('loading')}</p></div>`;
        const t = I18n.t.bind(I18n);

        try {
            const users = await Api.listUsers();
            panel.innerHTML = `
                <div class="dashboard-header">
                    <h2><i class="bi bi-people"></i> ${t('users.title')}</h2>
                    <button class="btn btn-sm btn-outline-light" onclick="Dashboard._createUser()">
                        <i class="bi bi-person-plus"></i> ${t('users.new')}
                    </button>
                </div>
                <table class="users-table">
                    <thead><tr>
                        <th>${t('users.username')}</th><th>${t('users.display_name')}</th>
                        <th>${t('users.email')}</th><th>${t('users.role')}</th>
                        <th>${t('users.status')}</th><th>${t('users.actions')}</th>
                    </tr></thead>
                    <tbody>
                        ${users.map(u => `
                            <tr>
                                <td>${App.escHtml(u.username)}</td>
                                <td>${App.escHtml(u.display_name || '-')}</td>
                                <td>${App.escHtml(u.email || '-')}</td>
                                <td><span class="badge bg-${u.role === 'admin' ? 'danger' : u.role === 'editor' ? 'primary' : 'secondary'}">${u.role}</span></td>
                                <td><span class="badge bg-${u.active ? 'success' : 'secondary'}">${u.active ? t('users.active') : t('users.disabled')}</span></td>
                                <td>
                                    <button class="btn btn-sm btn-outline-light" onclick="Dashboard._toggleUserActive(${u.id})"><i class="bi bi-${u.active ? 'pause' : 'play'}"></i></button>
                                    <button class="btn btn-sm btn-outline-light" onclick="Dashboard._resetUserPw(${u.id})"><i class="bi bi-key"></i></button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        } catch (err) {
            panel.innerHTML = `<div class="tm-empty-state"><p>${App.escHtml(err.message)}</p></div>`;
        }
    },

    async _createUser() {
        const t = I18n.t.bind(I18n);
        const result = await App.modal({
            title: t('users.create_title'),
            body: `
                <div class="mb-3"><label class="form-label">${t('users.username')}</label>
                    <input type="text" class="form-control" id="modal-user-username" required></div>
                <div class="mb-3"><label class="form-label">${t('users.password')}</label>
                    <input type="password" class="form-control" id="modal-user-password" required></div>
                <div class="mb-3"><label class="form-label">${t('users.display_name')}</label>
                    <input type="text" class="form-control" id="modal-user-displayname"></div>
                <div class="mb-3"><label class="form-label">${t('users.role')}</label>
                    <select class="form-select" id="modal-user-role">
                        <option value="editor">editor</option>
                        <option value="viewer">viewer</option>
                        <option value="admin">admin</option>
                    </select></div>
            `,
            confirmText: t('action.confirm'),
            onConfirm: () => ({
                username: document.getElementById('modal-user-username')?.value,
                password: document.getElementById('modal-user-password')?.value,
                display_name: document.getElementById('modal-user-displayname')?.value,
                role: document.getElementById('modal-user-role')?.value || 'editor',
            }),
        });
        if (!result || !result.username || !result.password) return;
        try {
            await Api.createUser(result);
            App.toast(I18n.t('users.created'), 'success');
            this.loadUsers();
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    async _toggleUserActive(id) {
        try { await Api.toggleUser(id); this.loadUsers(); }
        catch (err) { App.toast(err.message, 'danger'); }
    },

    async _resetUserPw(id) {
        const pw = await App.prompt(I18n.t('users.new_password'), '', { title: I18n.t('users.reset_pw'), type: 'password' });
        if (!pw) return;
        try { await Api.resetPassword(id, pw); App.toast(I18n.t('users.pw_reset'), 'success'); }
        catch (err) { App.toast(err.message, 'danger'); }
    },

    // ══ Basemaps Admin ═══════════════════
    async loadBasemaps() {
        const panel = document.getElementById('panel-basemaps');
        if (!panel) return;
        panel.innerHTML = `<div class="tm-empty-state"><i class="bi bi-arrow-repeat spin"></i><p>${I18n.t('loading')}</p></div>`;
        const t = I18n.t.bind(I18n);

        try {
            const basemaps = await Api.listAllBasemaps();
            panel.innerHTML = `
                <div class="dashboard-header">
                    <h2><i class="bi bi-map"></i> ${t('basemaps.title')}</h2>
                    <button class="btn btn-sm btn-outline-light" onclick="Dashboard._addBasemap()">
                        <i class="bi bi-plus-lg"></i> ${t('basemaps.add')}
                    </button>
                </div>
                <div class="basemap-grid">
                    ${basemaps.map(b => `
                        <div class="basemap-card ${b.active ? '' : 'inactive'}">
                            <div class="d-flex justify-content-between align-items-start">
                                <h4>${App.escHtml(b.name)}</h4>
                                <span class="basemap-type">${b.type}</span>
                            </div>
                            <div class="basemap-url">${App.escHtml(b.url)}</div>
                            <div class="d-flex justify-content-between align-items-center mt-2">
                                <span class="badge ${b.active ? 'bg-success' : 'bg-secondary'}">${b.active ? t('users.active') : t('users.disabled')}</span>
                                <div style="display:flex;gap:4px">
                                    <button class="btn btn-sm btn-outline-light" onclick="Dashboard._toggleBasemap(${b.id})">
                                        <i class="bi bi-${b.active ? 'eye-slash' : 'eye'}"></i>
                                    </button>
                                    <button class="btn btn-sm btn-outline-danger" onclick="Dashboard._deleteBasemap(${b.id})">
                                        <i class="bi bi-trash"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                    ${basemaps.length === 0 ? `<div class="tm-empty-state" style="grid-column:1/-1"><i class="bi bi-map"></i><p>${t('basemaps.no_basemaps')}</p></div>` : ''}
                </div>
            `;
        } catch (err) {
            panel.innerHTML = `<div class="tm-empty-state"><i class="bi bi-exclamation-triangle"></i><p>${App.escHtml(err.message)}</p></div>`;
        }
    },

    async _addBasemap() {
        const t = I18n.t.bind(I18n);
        const result = await App.modal({
            title: t('basemaps.add_title'),
            body: `
                <div class="mb-3"><label class="form-label">${t('basemaps.name')}</label>
                    <input type="text" class="form-control" id="modal-bm-name" placeholder="OpenStreetMap"></div>
                <div class="mb-3"><label class="form-label">${t('basemaps.type')}</label>
                    <select class="form-select" id="modal-bm-type">
                        <option value="xyz">xyz</option><option value="wms">wms</option><option value="wmts">wmts</option>
                    </select></div>
                <div class="mb-3"><label class="form-label">${t('basemaps.url')}</label>
                    <input type="text" class="form-control" id="modal-bm-url" placeholder="https://tile.openstreetmap.org/{z}/{x}/{y}.png"></div>
            `,
            confirmText: t('action.confirm'),
            onConfirm: () => ({
                name: document.getElementById('modal-bm-name')?.value,
                type: document.getElementById('modal-bm-type')?.value,
                url: document.getElementById('modal-bm-url')?.value,
            }),
        });
        if (!result || !result.name || !result.url) return;
        try {
            await Api.createBasemap(result);
            App.toast(I18n.t('basemaps.created'), 'success');
            this.loadBasemaps();
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    async _toggleBasemap(id) {
        try { await Api.toggleBasemap(id); App.toast(I18n.t('basemaps.toggled'), 'success'); this.loadBasemaps(); }
        catch (err) { App.toast(err.message, 'danger'); }
    },

    async _deleteBasemap(id) {
        const ok = await App.confirm(I18n.t('layers.delete_confirm'), { danger: true });
        if (!ok) return;
        try { await Api.deleteBasemap(id); App.toast(I18n.t('basemaps.deleted'), 'success'); this.loadBasemaps(); }
        catch (err) { App.toast(err.message, 'danger'); }
    },
};
