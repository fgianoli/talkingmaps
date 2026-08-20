/**
 * TalkingMaps API Client
 * Pattern from anncsu-tool api.js – Bearer token, session management
 */
const Api = {
    _token: null,
    _user: null,
    _inactivityTimer: null,
    _inactivityTimeout: 30 * 60 * 1000, // 30 min

    // ── Session ──────────────────────────
    init() {
        const saved = localStorage.getItem('tm_session');
        if (saved) {
            try {
                const session = JSON.parse(saved);
                this._token = session.token;
                this._user = session.user;
            } catch { /* ignore */ }
        }
        this._resetInactivityTimer();
    },

    isLoggedIn() { return !!this._token; },
    getUser() { return this._user; },
    getToken() { return this._token; },

    setSession(token, user) {
        this._token = token;
        this._user = user;
        localStorage.setItem('tm_session', JSON.stringify({ token, user }));
        this._resetInactivityTimer();
    },

    clearSession() {
        this._token = null;
        this._user = null;
        localStorage.removeItem('tm_session');
        clearTimeout(this._inactivityTimer);
    },

    _resetInactivityTimer() {
        clearTimeout(this._inactivityTimer);
        if (this._token) {
            this._inactivityTimer = setTimeout(() => {
                this.clearSession();
                window.dispatchEvent(new Event('session-expired'));
            }, this._inactivityTimeout);
        }
    },

    // ── HTTP ─────────────────────────────
    async _fetch(url, opts = {}) {
        this._resetInactivityTimer();
        const headers = { ...opts.headers };
        if (this._token) headers['Authorization'] = `Bearer ${this._token}`;
        if (opts.body && !(opts.body instanceof FormData)) {
            headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(opts.body);
        }
        const resp = await fetch(url, { ...opts, headers });
        if (resp.status === 401) {
            this.clearSession();
            window.dispatchEvent(new Event('session-expired'));
            throw new Error('Sessione scaduta');
        }
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ detail: resp.statusText }));
            throw new Error(err.detail || 'Errore API');
        }
        return resp.json();
    },

    get(url) { return this._fetch(url); },
    post(url, body) { return this._fetch(url, { method: 'POST', body }); },
    put(url, body) { return this._fetch(url, { method: 'PUT', body }); },
    del(url) { return this._fetch(url, { method: 'DELETE' }); },

    // ── Auth ─────────────────────────────
    login(username, password) { return this.post('/api/auth/login', { username, password }); },
    register(username, email, password, display_name) { return this.post('/api/auth/register', { username, email, password, display_name }); },
    logout() { return this.post('/api/auth/logout', {}); },
    me() { return this.get('/api/auth/me'); },
    changePassword(current, newPw) { return this.put('/api/auth/change-password', { current_password: current, new_password: newPw }); },
    updateProfile(data) { return this.put('/api/auth/profile', data); },
    uploadAvatar(file) {
        const form = new FormData();
        form.append('file', file);
        return this._fetch('/api/auth/avatar', { method: 'POST', body: form });
    },

    // ── Stories ──────────────────────────
    listStories(status) { return this.get('/api/stories/' + (status ? `?status=${status}` : '')); },
    listPublicStories() { return this.get('/api/stories/public'); },
    getStory(id) { return this.get(`/api/stories/${id}`); },
    getStoryFull(id) { return this.get(`/api/stories/${id}/full`); },
    getSharedStory(token) { return this.get(`/api/stories/shared/${token}`); },
    createStory(data) { return this.post('/api/stories/', data); },
    updateStory(id, data) { return this.put(`/api/stories/${id}`, data); },
    deleteStory(id) { return this.del(`/api/stories/${id}`); },
    duplicateStory(id) { return this.post(`/api/stories/${id}/duplicate`, {}); },
    getStoryAnalytics(id) { return this.get(`/api/stories/${id}/analytics`); },

    // Versions
    createVersion(storyId, message) { return this.post(`/api/stories/${storyId}/versions`, { message }); },
    listVersions(storyId) { return this.get(`/api/stories/${storyId}/versions`); },
    restoreVersion(storyId, versionId) { return this.post(`/api/stories/${storyId}/versions/${versionId}/restore`, {}); },

    // Templates
    saveAsTemplate(storyId) { return this.post(`/api/stories/${storyId}/save-as-template`, {}); },
    listTemplates() { return this.get('/api/stories/templates/list'); },
    listStoryTemplates() { return this.get('/api/stories/templates/system'); },

    async exportStoryJSON(id) {
        const resp = await fetch(`/api/stories/${id}/export`, {
            headers: { 'Authorization': `Bearer ${this._token}` }
        });
        if (!resp.ok) throw new Error('Export failed');
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `talkingmaps-story-${id}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },
    importStory(file) {
        const form = new FormData();
        form.append('file', file);
        return this._fetch('/api/stories/import', { method: 'POST', body: form });
    },

    // ── Slides ───────────────────────────
    listSlides(storyId) { return this.get(`/api/slides/story/${storyId}`); },
    getSlide(id) { return this.get(`/api/slides/${id}`); },
    createSlide(data) { return this.post('/api/slides/', data); },
    updateSlide(id, data) { return this.put(`/api/slides/${id}`, data); },
    deleteSlide(id) { return this.del(`/api/slides/${id}`); },
    reorderSlides(slideIds) { return this.put('/api/slides/reorder', { slide_ids: slideIds }); },

    // ── Markers ──────────────────────────
    addMarker(slideId, data) { return this.post(`/api/slides/${slideId}/markers`, data); },
    updateMarker(id, data) { return this.put(`/api/slides/markers/${id}`, data); },
    deleteMarker(id) { return this.del(`/api/slides/markers/${id}`); },

    // ── Layers ───────────────────────────
    listLayers() { return this.get('/api/layers/'); },
    getLayer(id) { return this.get(`/api/layers/${id}`); },
    createLayer(data) { return this.post('/api/layers/', data); },
    updateLayer(id, data) { return this.put(`/api/layers/${id}`, data); },
    deleteLayer(id) { return this.del(`/api/layers/${id}`); },
    addLayerToStory(storyId, data) { return this.post(`/api/layers/story/${storyId}`, data); },
    removeLayerFromStory(storyId, layerId) { return this.del(`/api/layers/story/${storyId}/${layerId}`); },

    uploadGeoJSON(file) {
        const form = new FormData();
        form.append('file', file);
        return this._fetch('/api/layers/upload-geojson', { method: 'POST', body: form });
    },

    // ── 3D Assets ──────────────────────────
    list3DAssets() { return this.get('/api/3d/'); },
    upload3D(file, name) {
        const form = new FormData();
        form.append('file', file);
        if (name) form.append('name', name);
        return this._fetch('/api/3d/upload', { method: 'POST', body: form });
    },
    delete3DAsset(assetId) { return this.del(`/api/3d/${assetId}`); },
    getStorageQuota() { return this.get('/api/3d/quota'); },

    // ── Symbology ────────────────────────
    listSymbologies(layerId) { return this.get('/api/symbology/' + (layerId ? `?layer_id=${layerId}` : '')); },
    getSymbology(id) { return this.get(`/api/symbology/${id}`); },
    createSymbology(data) { return this.post('/api/symbology/', data); },
    updateSymbology(id, data) { return this.put(`/api/symbology/${id}`, data); },
    deleteSymbology(id) { return this.del(`/api/symbology/${id}`); },
    getSymbologyPresets(category, geomType) {
        let q = '/api/symbology/presets?';
        if (category) q += `category=${category}&`;
        if (geomType) q += `geometry_type=${geomType}`;
        return this.get(q);
    },

    // ── Media ────────────────────────────
    listMedia(storyId) { return this.get('/api/media/' + (storyId ? `?story_id=${storyId}` : '')); },
    uploadMedia(file, storyId) {
        const form = new FormData();
        form.append('file', file);
        if (storyId) form.append('story_id', storyId);
        return this._fetch('/api/media/upload', { method: 'POST', body: form });
    },
    deleteMedia(id) { return this.del(`/api/media/${id}`); },

    // ── Basemaps ─────────────────────────
    listBasemaps() { return this.get('/api/basemaps/'); },
    listAllBasemaps() { return this.get('/api/basemaps/all'); },
    createBasemap(data) { return this.post('/api/basemaps/', data); },
    toggleBasemap(id) { return this.put(`/api/basemaps/${id}/toggle`, {}); },
    deleteBasemap(id) { return this.del(`/api/basemaps/${id}`); },

    // ── Collaborators ───────────────────
    listCollaborators(storyId) { return this.get(`/api/stories/${storyId}/collaborators`); },
    addCollaborator(storyId, userId, role) { return this.post(`/api/stories/${storyId}/collaborators`, { user_id: userId, role }); },
    updateCollaborator(storyId, userId, role) { return this.put(`/api/stories/${storyId}/collaborators/${userId}`, { role }); },
    removeCollaborator(storyId, userId) { return this.del(`/api/stories/${storyId}/collaborators/${userId}`); },

    // ── Users ────────────────────────────
    searchUsers(q) { return this.get(`/api/users/search?q=${encodeURIComponent(q)}`); },
    listUsers() { return this.get('/api/users/'); },
    createUser(data) { return this.post('/api/users/', data); },
    toggleUser(id) { return this.put(`/api/users/${id}/toggle`, {}); },
    resetPassword(id, password) { return this.put(`/api/users/${id}/reset-password`, { password }); },

    // Settings
    listSettings() { return this.get('/api/settings/'); },
    updateSetting(key, value) { return this.put(`/api/settings/${key}`, { value }); },

    // ── AI ────────────────────────────
    getAISettings() { return this.get('/api/ai/settings'); },
    updateAISettings(data) { return this.put('/api/ai/settings', data); },
    getAIProviders() { return this.get('/api/ai/providers'); },
    generateText(data) { return this.post('/api/ai/generate', data); },
    generateImage(data) { return this.post('/api/ai/generate-image', data); },

    // Geodata (Wikipedia, OSM)
    // ── CKAN open data ──
    ckanPortals() { return this.get('/api/ckan/portals'); },
    ckanSearch(portalUrl, q, formatFilter, rows = 20) {
        let url = `/api/ckan/search?portal_url=${encodeURIComponent(portalUrl)}&q=${encodeURIComponent(q || '')}&rows=${rows}`;
        if (formatFilter) url += `&format_filter=${encodeURIComponent(formatFilter)}`;
        return this.get(url);
    },
    ckanResource(url) { return this.get(`/api/ckan/resource?url=${encodeURIComponent(url)}`); },
    ckanImportAsLayer(body) { return this.post('/api/ckan/import-as-layer', body); },

    wikiNearby(lat, lng, radius = 5000, lang = 'it') { return this.get(`/api/geodata/wikipedia/nearby?lat=${lat}&lng=${lng}&radius=${radius}&lang=${lang}`); },
    wikiSearch(q, lang = 'it') { return this.get(`/api/geodata/wikipedia/search?q=${encodeURIComponent(q)}&lang=${lang}`); },
    osmNearby(lat, lng, radius = 1000, category = 'all') { return this.get(`/api/geodata/osm/nearby?lat=${lat}&lng=${lng}&radius=${radius}&category=${category}`); },
    osmCustomQuery(query) { return this.post('/api/geodata/osm/custom-query', { query }); },
    geocode(q, lang = 'it') { return this.get(`/api/geodata/geocode?q=${encodeURIComponent(q)}&lang=${lang}`); },
    reverseGeocode(lat, lng, lang = 'it') { return this.get(`/api/geodata/reverse-geocode?lat=${lat}&lng=${lng}&lang=${lang}`); },

    // Profile
    updateProfile(data) { return this.put('/api/auth/profile', data); },
    uploadAvatar(file) { const fd = new FormData(); fd.append('file', file); return this._fetch('/api/auth/avatar', { method: 'POST', body: fd }); },

    // ── Services (Personal GIS catalog) ──
    listServices() { return this.get('/api/services/'); },
    createService(data) { return this.post('/api/services/', data); },
    updateService(id, data) { return this.put(`/api/services/${id}`, data); },
    deleteService(id) { return this.del(`/api/services/${id}`); },
    getCapabilities(url, service) { return this.get(`/api/wfs-proxy/capabilities?url=${encodeURIComponent(url)}&service=${service}`); },

    // ── Contributions (Participatory Maps) ──
    listContributions(storyId) { return this.get(`/api/contributions/story/${storyId}`); },
    listAllContributions(storyId, status) {
        let url = `/api/contributions/story/${storyId}/all`;
        if (status) url += `?status=${status}`;
        return this.get(url);
    },
    createContribution(storyId, data, file) {
        const fd = new FormData();
        fd.append('title', data.title);
        fd.append('lng', data.lng);
        fd.append('lat', data.lat);
        if (data.description) fd.append('description', data.description);
        if (data.category) fd.append('category', data.category);
        if (file) fd.append('file', file);
        return this._fetch(`/api/contributions/story/${storyId}`, { method: 'POST', body: fd });
    },
    moderateContribution(id, status, adminNote) {
        return this.put(`/api/contributions/${id}/status`, { status, admin_note: adminNote });
    },
    deleteContribution(id) { return this.del(`/api/contributions/${id}`); },
};
