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
                    <button class="btn btn-sm btn-outline-light" onclick="Dashboard._importStory()" title="${t('story.import_title')}">
                        <i class="bi bi-upload"></i> ${t('action.import')}
                    </button>
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

        const currentUserId = Api.getUser()?.id;
        return stories.map(s => {
            const isCollab = s.collab_role && s.author_id !== currentUserId;
            const isCollabEditor = isCollab && s.collab_role === 'editor';
            const isCollabViewer = isCollab && s.collab_role === 'viewer';
            const canEdit = !isCollab || isCollabEditor;
            const isOwner = !isCollab;
            return `
            <div class="tm-card" data-story-id="${s.id}">
                <div class="tm-card-cover" style="${s.cover_image ? `background-image:url('${s.cover_image}')` : ''}">
                    ${!publicMode ? `<span class="badge ${statusBadge[s.status] || 'bg-secondary'}">${t('status.' + s.status) || s.status}</span>` : ''}
                    ${isCollab ? `<span class="badge bg-info" style="position:absolute;top:8px;right:8px"><i class="bi bi-people-fill me-1"></i>${t('editor.collab_shared_with_you')}</span>` : ''}
                    ${!s.cover_image ? '<div style="display:flex;align-items:center;justify-content:center;height:100%;"><i class="bi bi-map" style="font-size:48px;opacity:0.15"></i></div>' : ''}
                </div>
                <div class="tm-card-body">
                    <h3>${App.escHtml(s.title)}</h3>
                    <p>${App.escHtml(s.description || t('story.no_desc'))}</p>
                </div>
                <div class="tm-card-footer">
                    <span>${s.author_name || ''} · ${App.formatDate(s.updated_at)}${s.view_count !== undefined ? ` · <i class="bi bi-eye"></i> ${s.view_count}` : ''}</span>
                    <div>
                        <button class="btn btn-sm btn-outline-light" onclick="Dashboard._viewStory(${s.id})" title="${t('action.view')}">
                            <i class="bi bi-eye"></i>
                        </button>
                        ${!publicMode ? `
                            ${canEdit ? `<button class="btn btn-sm btn-outline-light" onclick="StoryEditor.load(${s.id})" title="${t('action.edit')}">
                                <i class="bi bi-pencil"></i>
                            </button>` : ''}
                            <div class="dropdown d-inline-block">
                                <button class="btn btn-sm btn-outline-light dropdown-toggle" data-bs-toggle="dropdown">
                                    <i class="bi bi-three-dots"></i>
                                </button>
                                <ul class="dropdown-menu dropdown-menu-end">
                                    ${isOwner ? `<li><a class="dropdown-item" href="#" onclick="Dashboard._duplicateStory(${s.id});return false"><i class="bi bi-copy me-2"></i>${t('action.duplicate')}</a></li>` : ''}
                                    ${isOwner ? `<li><a class="dropdown-item" href="#" onclick="Dashboard._shareStory('${s.share_token}');return false"><i class="bi bi-share me-2"></i>${t('action.share')}</a></li>` : ''}
                                    ${isOwner ? `<li><a class="dropdown-item" href="#" onclick="Dashboard._publishStory(${s.id}, '${s.status}');return false">
                                        <i class="bi bi-${s.status === 'published' ? 'archive' : 'send'} me-2"></i>
                                        ${s.status === 'published' ? t('action.archive') : t('action.publish')}
                                    </a></li>` : ''}
                                    <li><a class="dropdown-item" href="#" onclick="Dashboard._exportStory(${s.id});return false"><i class="bi bi-download me-2"></i>${t('action.export')}</a></li>
                                    ${isOwner ? `<li><hr class="dropdown-divider"></li>
                                    <li><a class="dropdown-item text-danger" href="#" onclick="Dashboard._deleteStory(${s.id});return false"><i class="bi bi-trash me-2"></i>${t('action.delete')}</a></li>` : ''}
                                </ul>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>`;
        }).join('');
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

    async _exportStory(id) {
        try {
            await Api.exportStoryJSON(id);
            App.toast(I18n.t('story.exported'), 'success');
        } catch (err) { App.toast(err.message, 'danger'); }
    },

    _importStory() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async () => {
            if (!input.files[0]) return;
            try {
                const result = await Api.importStory(input.files[0]);
                App.toast(I18n.t('story.imported'), 'success');
                this.load();
            } catch (err) { App.toast(err.message, 'danger'); }
        };
        input.click();
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
                    <select class="form-select" id="modal-bm-type" onchange="document.getElementById('modal-bm-image-hint').classList.toggle('d-none', this.value !== 'image')">
                        <option value="xyz">xyz</option><option value="wms">wms</option><option value="wmts">wmts</option>
                        <option value="image">${t('basemaps.type_image')}</option>
                    </select></div>
                <div class="mb-3"><label class="form-label">${t('basemaps.url')}</label>
                    <input type="text" class="form-control" id="modal-bm-url" placeholder="https://tile.openstreetmap.org/{z}/{x}/{y}.png"></div>
                <div class="mb-3 d-none" id="modal-bm-image-hint">
                    <small class="text-muted">${t('basemaps.image_hint')}</small>
                </div>
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

    // ══ Account & AI Settings ═══════════
    async loadAccount() {
        const t = I18n.t.bind(I18n);
        const container = document.getElementById('panel-account');
        if (!container) return;

        let aiSettings = {};
        let providers = {};
        try {
            [aiSettings, providers] = await Promise.all([
                Api.getAISettings().catch(() => ({})),
                Api.getAIProviders().catch(() => ({})),
            ]);
        } catch {}

        const u = App.user || {};
        const memberDate = u.created_at ? new Date(u.created_at).toLocaleDateString(I18n.getLang(), { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
        const roleBadgeColor = u.role === 'admin' ? 'danger' : u.role === 'editor' ? 'primary' : 'secondary';
        const storagePct = u.storage_limit_mb ? Math.min(100, Math.round((u.storage_used_mb || 0) / u.storage_limit_mb * 100)) : 0;
        const storageBarColor = storagePct > 90 ? 'bg-danger' : storagePct > 70 ? 'bg-warning' : 'bg-primary';
        const avatarUrl = u.avatar || '';

        container.innerHTML = `
            <div class="content-container" style="max-width:720px;margin:0 auto;padding:30px">

                <!-- Profile Card -->
                <div class="card" style="background:var(--tm-surface);border:1px solid var(--tm-border);border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.15)">
                    <div class="card-body" style="padding:32px">
                        <div class="d-flex align-items-start gap-4 flex-wrap">
                            <!-- Avatar -->
                            <div style="position:relative;flex-shrink:0">
                                <div id="account-avatar" style="width:120px;height:120px;border-radius:50%;overflow:hidden;border:3px solid var(--tm-border);background:var(--tm-bg);display:flex;align-items:center;justify-content:center;cursor:pointer" onclick="Dashboard._changeAvatar()" title="${t('account.change_avatar')}">
                                    ${avatarUrl
                                        ? `<img src="${avatarUrl}" style="width:100%;height:100%;object-fit:cover" alt="avatar">`
                                        : `<i class="bi bi-person-fill" style="font-size:48px;opacity:0.3"></i>`
                                    }
                                </div>
                                <div onclick="Dashboard._changeAvatar()" style="position:absolute;bottom:4px;right:4px;width:32px;height:32px;border-radius:50%;background:var(--tm-primary, #4f6df5);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.3)" title="${t('account.change_avatar')}">
                                    <i class="bi bi-camera-fill" style="font-size:14px;color:#fff"></i>
                                </div>
                            </div>
                            <!-- Profile fields -->
                            <div style="flex:1;min-width:200px">
                                <div class="mb-3">
                                    <label class="form-label text-muted" style="font-size:12px;margin-bottom:4px">${t('account.display_name')}</label>
                                    <input type="text" class="form-control" id="profile-display-name" value="${App.escHtml(u.display_name || '')}" style="border-radius:10px">
                                </div>
                                <div class="mb-3">
                                    <label class="form-label text-muted" style="font-size:12px;margin-bottom:4px">${t('account.email')}</label>
                                    <input type="email" class="form-control" id="profile-email" value="${App.escHtml(u.email || '')}" style="border-radius:10px">
                                </div>
                                <div class="d-flex align-items-center gap-3 flex-wrap mb-3" style="font-size:13px">
                                    <span class="text-muted"><i class="bi bi-at"></i> ${t('account.username')}: <strong style="color:var(--tm-text);opacity:0.6">${App.escHtml(u.username || '')}</strong></span>
                                    <span class="badge bg-${roleBadgeColor}" style="font-size:11px">${t('account.role')}: ${u.role || ''}</span>
                                </div>
                                <div class="text-muted" style="font-size:12px">
                                    <i class="bi bi-calendar3"></i> ${t('account.member_since')} ${memberDate}
                                </div>
                                <button class="btn btn-primary mt-3" onclick="Dashboard._saveProfile()" style="border-radius:10px">
                                    <i class="bi bi-check-lg"></i> ${t('account.save_profile')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Change Password (collapsible) -->
                <div class="card mt-3" style="background:var(--tm-surface);border:1px solid var(--tm-border);border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.15)">
                    <div class="card-header d-flex align-items-center justify-content-between" style="background:var(--tm-bg);border-bottom:1px solid var(--tm-border);cursor:pointer;padding:14px 20px" data-bs-toggle="collapse" data-bs-target="#collapse-password">
                        <h6 class="mb-0"><i class="bi bi-key me-2"></i>${t('account.change_password')}</h6>
                        <i class="bi bi-chevron-down"></i>
                    </div>
                    <div class="collapse" id="collapse-password">
                        <div class="card-body" style="padding:24px">
                            <div class="mb-3">
                                <label class="form-label text-muted" style="font-size:12px">${t('account.current_password')}</label>
                                <input type="password" class="form-control" id="pw-current" style="border-radius:10px">
                            </div>
                            <div class="mb-3">
                                <label class="form-label text-muted" style="font-size:12px">${t('account.new_password')}</label>
                                <input type="password" class="form-control" id="pw-new" style="border-radius:10px">
                            </div>
                            <div class="mb-3">
                                <label class="form-label text-muted" style="font-size:12px">${t('account.confirm_password')}</label>
                                <input type="password" class="form-control" id="pw-confirm" style="border-radius:10px">
                            </div>
                            <button class="btn btn-primary" onclick="Dashboard._savePassword()" style="border-radius:10px">
                                <i class="bi bi-check-lg"></i> ${t('action.save')}
                            </button>
                        </div>
                    </div>
                </div>

                <!-- AI Settings (collapsible) -->
                <div class="card mt-3" style="background:var(--tm-surface);border:1px solid var(--tm-border);border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.15)">
                    <div class="card-header d-flex align-items-center justify-content-between" style="background:var(--tm-bg);border-bottom:1px solid var(--tm-border);cursor:pointer;padding:14px 20px" data-bs-toggle="collapse" data-bs-target="#collapse-ai">
                        <h6 class="mb-0"><i class="bi bi-robot me-2"></i>${t('account.ai_title')}</h6>
                        <i class="bi bi-chevron-down"></i>
                    </div>
                    <div class="collapse" id="collapse-ai">
                        <div class="card-body" style="padding:24px">
                            <p class="text-muted" style="font-size:13px">${t('account.ai_desc')}</p>

                            <div class="row g-3">
                                <div class="col-md-6">
                                    <label class="form-label">${t('account.ai_provider')}</label>
                                    <select class="form-select" id="ai-provider" style="border-radius:10px">
                                        ${Object.entries(providers).map(([k, v]) =>
                                            `<option value="${k}" ${aiSettings.preferred_provider === k ? 'selected' : ''}>${v.name}</option>`
                                        ).join('')}
                                    </select>
                                </div>
                                <div class="col-md-6">
                                    <label class="form-label">${t('account.ai_model')}</label>
                                    <select class="form-select" id="ai-model" style="border-radius:10px">
                                    </select>
                                </div>
                            </div>

                            <hr style="border-color:var(--tm-border)">
                            <h6>${t('account.api_keys')}</h6>

                            <!-- OpenAI -->
                            <div class="mb-3">
                                <label class="form-label d-flex align-items-center gap-2">
                                    OpenAI
                                    ${aiSettings.openai_key_set ? '<span class="badge bg-success">\u2713</span>' : '<span class="badge bg-secondary">\u2014</span>'}
                                </label>
                                <div class="input-group">
                                    <input type="password" class="form-control" id="ai-key-openai"
                                           placeholder="${aiSettings.openai_key_set ? aiSettings.openai_key : t('account.key_placeholder')}"
                                           value="" style="border-radius:10px 0 0 10px">
                                    <button class="btn btn-outline-secondary" type="button" onclick="this.previousElementSibling.type = this.previousElementSibling.type === 'password' ? 'text' : 'password'" style="border-radius:0 10px 10px 0">
                                        <i class="bi bi-eye"></i>
                                    </button>
                                </div>
                                <small class="text-muted">${t('account.openai_hint')}</small>
                            </div>

                            <!-- Anthropic -->
                            <div class="mb-3">
                                <label class="form-label d-flex align-items-center gap-2">
                                    Anthropic (Claude)
                                    ${aiSettings.anthropic_key_set ? '<span class="badge bg-success">\u2713</span>' : '<span class="badge bg-secondary">\u2014</span>'}
                                </label>
                                <div class="input-group">
                                    <input type="password" class="form-control" id="ai-key-anthropic"
                                           placeholder="${aiSettings.anthropic_key_set ? aiSettings.anthropic_key : t('account.key_placeholder')}"
                                           value="" style="border-radius:10px 0 0 10px">
                                    <button class="btn btn-outline-secondary" type="button" onclick="this.previousElementSibling.type = this.previousElementSibling.type === 'password' ? 'text' : 'password'" style="border-radius:0 10px 10px 0">
                                        <i class="bi bi-eye"></i>
                                    </button>
                                </div>
                                <small class="text-muted">${t('account.anthropic_hint')}</small>
                            </div>

                            <!-- Google -->
                            <div class="mb-3">
                                <label class="form-label d-flex align-items-center gap-2">
                                    Google (Gemini)
                                    ${aiSettings.google_key_set ? '<span class="badge bg-success">\u2713</span>' : '<span class="badge bg-secondary">\u2014</span>'}
                                </label>
                                <div class="input-group">
                                    <input type="password" class="form-control" id="ai-key-google"
                                           placeholder="${aiSettings.google_key_set ? aiSettings.google_key : t('account.key_placeholder')}"
                                           value="" style="border-radius:10px 0 0 10px">
                                    <button class="btn btn-outline-secondary" type="button" onclick="this.previousElementSibling.type = this.previousElementSibling.type === 'password' ? 'text' : 'password'" style="border-radius:0 10px 10px 0">
                                        <i class="bi bi-eye"></i>
                                    </button>
                                </div>
                                <small class="text-muted">${t('account.google_hint')}</small>
                            </div>

                            <button class="btn btn-primary" onclick="Dashboard._saveAISettings()" style="border-radius:10px">
                                <i class="bi bi-check-lg"></i> ${t('action.save')}
                            </button>

                            <!-- Security notice -->
                            <div class="alert mt-3" style="background:rgba(79,109,245,0.1);border:1px solid rgba(79,109,245,0.3);color:var(--tm-text);font-size:12px;border-radius:12px">
                                <i class="bi bi-shield-lock"></i> <strong>${t('account.security_title')}</strong><br>
                                ${t('account.security_desc')}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Storage -->
                <div class="card mt-3" style="background:var(--tm-surface);border:1px solid var(--tm-border);border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.15)">
                    <div class="card-body" style="padding:20px 24px">
                        <h6 class="mb-3"><i class="bi bi-hdd me-2"></i>${t('account.storage')}</h6>
                        <div class="progress" style="height:10px;border-radius:6px;background:var(--tm-bg)">
                            <div class="progress-bar ${storageBarColor}" role="progressbar" style="width:${storagePct}%;border-radius:6px"></div>
                        </div>
                        <div class="d-flex justify-content-between mt-2" style="font-size:12px">
                            <span class="text-muted">${parseFloat(u.storage_used_mb || 0).toFixed(1)} MB</span>
                            <span class="text-muted">${parseFloat(u.storage_limit_mb || 0).toFixed(0)} MB</span>
                        </div>
                    </div>
                </div>

            </div>
        `;

        // Update model selector based on provider
        const providerSelect = document.getElementById('ai-provider');
        const modelSelect = document.getElementById('ai-model');
        const updateModels = () => {
            const p = providers[providerSelect.value] || {};
            modelSelect.innerHTML = (p.models || []).map(m =>
                `<option value="${m}" ${aiSettings.preferred_model === m ? 'selected' : ''}>${m}</option>`
            ).join('');
        };
        if (providerSelect) {
            providerSelect.addEventListener('change', updateModels);
            updateModels();
        }
    },

    async _saveProfile() {
        const displayName = document.getElementById('profile-display-name')?.value || '';
        const email = document.getElementById('profile-email')?.value || '';
        try {
            await Api.updateProfile({ display_name: displayName, email });
            if (App.user) {
                App.user.display_name = displayName;
                App.user.email = email;
            }
            App.toast(I18n.t('account.profile_saved'), 'success');
        } catch (err) {
            App.toast(err.message, 'danger');
        }
    },

    async _changeAvatar() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async () => {
            if (!input.files[0]) return;
            try {
                const result = await Api.uploadAvatar(input.files[0]);
                if (App.user) App.user.avatar = result.avatar;
                const avatarDiv = document.getElementById('account-avatar');
                if (avatarDiv) {
                    avatarDiv.innerHTML = `<img src="${result.avatar}" style="width:100%;height:100%;object-fit:cover" alt="avatar">`;
                }
                App.toast(I18n.t('account.profile_saved'), 'success');
            } catch (err) {
                App.toast(err.message, 'danger');
            }
        };
        input.click();
    },

    async _savePassword() {
        const current = document.getElementById('pw-current')?.value || '';
        const newPw = document.getElementById('pw-new')?.value || '';
        const confirm = document.getElementById('pw-confirm')?.value || '';
        if (!current || !newPw) return App.toast('Fill in all fields', 'warning');
        if (newPw !== confirm) return App.toast('Passwords do not match', 'warning');
        try {
            await Api.changePassword(current, newPw);
            App.toast(I18n.t('account.ai_saved'), 'success');
            document.getElementById('pw-current').value = '';
            document.getElementById('pw-new').value = '';
            document.getElementById('pw-confirm').value = '';
        } catch (err) {
            App.toast(err.message, 'danger');
        }
    },

    async _saveAISettings() {
        const data = {
            preferred_provider: document.getElementById('ai-provider')?.value || 'openai',
            preferred_model: document.getElementById('ai-model')?.value || 'gpt-4o',
            openai_key: document.getElementById('ai-key-openai')?.value || '',
            anthropic_key: document.getElementById('ai-key-anthropic')?.value || '',
            google_key: document.getElementById('ai-key-google')?.value || '',
        };
        try {
            await Api.updateAISettings(data);
            App.toast(I18n.t('account.ai_saved'), 'success');
            this.loadAccount(); // Refresh to show updated status
        } catch (err) {
            App.toast(err.message, 'danger');
        }
    },

    // ══ Settings Admin ═══════════════════
    async loadSettings() {
        const panel = document.getElementById('panel-settings');
        if (!panel) return;
        panel.innerHTML = `<div class="tm-empty-state"><i class="bi bi-arrow-repeat spin"></i><p>${I18n.t('loading')}</p></div>`;
        const t = I18n.t.bind(I18n);

        try {
            const settings = await Api.listSettings();
            const descMap = {
                cesium_ion_token: t('settings.cesium_token_desc'),
                default_storage_limit_mb: t('settings.storage_limit_desc'),
                max_upload_size_mb: t('settings.max_upload_desc'),
            };

            panel.innerHTML = `
                <div class="dashboard-header">
                    <h2><i class="bi bi-gear"></i> ${t('settings.title')}</h2>
                </div>
                <div class="settings-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:16px;padding:0 0 24px">
                    ${settings.map(s => {
                        const desc = descMap[s.key] || s.description || '';
                        const isToken = s.key === 'cesium_ion_token';
                        const isNumeric = s.key.endsWith('_mb') || s.key.endsWith('_enabled');
                        const inputType = isToken ? 'password' : (isNumeric && !s.key.endsWith('_enabled') ? 'number' : 'text');
                        return `
                            <div class="layer-card" style="padding:20px">
                                <div class="d-flex justify-content-between align-items-start mb-2">
                                    <h4 style="font-size:14px;font-weight:600;margin:0"><code>${App.escHtml(s.key)}</code></h4>
                                </div>
                                <p class="text-muted" style="font-size:13px;margin:0 0 12px">${App.escHtml(desc)}</p>
                                <div class="d-flex gap-2 align-items-center">
                                    <div class="input-group input-group-sm" style="flex:1">
                                        <input type="${inputType}" class="form-control" id="setting-val-${s.key}" value="${App.escHtml(s.value)}"
                                            ${isNumeric && !s.key.endsWith('_enabled') ? 'min="0"' : ''}>
                                        ${isToken ? `<button class="btn btn-outline-secondary" type="button" onclick="Dashboard._toggleSettingVisibility('${s.key}')"><i class="bi bi-eye" id="setting-eye-${s.key}"></i></button>` : ''}
                                    </div>
                                    <button class="btn btn-sm btn-primary" onclick="Dashboard._saveSetting('${s.key}')">
                                        <i class="bi bi-check-lg"></i>
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        } catch (err) {
            panel.innerHTML = `<div class="tm-empty-state"><i class="bi bi-exclamation-triangle"></i><p>${App.escHtml(err.message)}</p></div>`;
        }
    },

    _toggleSettingVisibility(key) {
        const input = document.getElementById(`setting-val-${key}`);
        const icon = document.getElementById(`setting-eye-${key}`);
        if (!input) return;
        if (input.type === 'password') {
            input.type = 'text';
            if (icon) { icon.classList.remove('bi-eye'); icon.classList.add('bi-eye-slash'); }
        } else {
            input.type = 'password';
            if (icon) { icon.classList.remove('bi-eye-slash'); icon.classList.add('bi-eye'); }
        }
    },

    async _saveSetting(key) {
        const input = document.getElementById(`setting-val-${key}`);
        if (!input) return;
        try {
            await Api.updateSetting(key, input.value);
            App.toast(I18n.t('settings.saved'), 'success');
        } catch (err) { App.toast(err.message, 'danger'); }
    },
};
