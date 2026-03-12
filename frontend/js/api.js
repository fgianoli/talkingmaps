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
    logout() { return this.post('/api/auth/logout', {}); },
    me() { return this.get('/api/auth/me'); },
    changePassword(current, newPw) { return this.put('/api/auth/change-password', { current_password: current, new_password: newPw }); },

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

    // ── Users ────────────────────────────
    listUsers() { return this.get('/api/users/'); },
    createUser(data) { return this.post('/api/users/', data); },
    toggleUser(id) { return this.put(`/api/users/${id}/toggle`, {}); },
    resetPassword(id, password) { return this.put(`/api/users/${id}/reset-password`, { password }); },
};
