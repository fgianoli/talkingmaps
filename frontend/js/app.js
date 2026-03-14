/**
 * TalkingMaps – Main Application Controller
 * Modal system, i18n, navigation, toast, landing page
 */
const App = {
    currentPanel: null,
    embedMode: false,
    embedOptions: {},

    async init() {
        I18n.init();
        Api.init();

        window.addEventListener('session-expired', () => {
            this.showLogin();
            this.toast(I18n.t('app.session_expired'), 'warning');
        });

        this._setupRouting();
        this._updateI18nTexts();

        const params = new URLSearchParams(window.location.search);

        // Embed mode: load story without UI chrome
        if (params.has('embed')) {
            this.embedMode = true;
            this.embedOptions = {
                theme: params.get('theme') || null,
                autoplay: params.get('autoplay') === 'true',
                controls: params.get('controls') || 'full',
            };
            this._loadEmbed(params.get('embed'));
            return;
        }

        if (params.has('story')) { this._viewPublicStory(params.get('story')); return; }
        if (params.has('share')) { this._viewSharedStory(params.get('share')); return; }

        if (Api.isLoggedIn()) {
            this.showApp();
        } else {
            this.showLanding();
        }

        this._bindEvents();
        this._loadOAuthProviders();

        // Cookie consent
        if (typeof CookieConsent !== 'undefined') CookieConsent.init();
    },

    // ── i18n text bindings ────────────────
    _updateI18nTexts() {
        const t = I18n.t.bind(I18n);

        // Login screen
        const tagline = document.getElementById('login-tagline');
        if (tagline) tagline.textContent = t('app.tagline');

        const loginBtn = document.getElementById('login-submit-btn');
        if (loginBtn) loginBtn.textContent = t('app.login');

        const oauthDivText = document.getElementById('oauth-divider-text');
        if (oauthDivText) oauthDivText.textContent = t('app.or');

        const exploreText = document.getElementById('explore-public-text');
        if (exploreText) exploreText.textContent = t('app.explore_public');

        // Login/Register toggle
        const noAccount = document.getElementById('login-no-account-text');
        if (noAccount) noAccount.textContent = t('app.no_account');
        const showRegBtn = document.getElementById('btn-show-register');
        if (showRegBtn) showRegBtn.textContent = t('app.register');
        const haveAccount = document.getElementById('reg-have-account-text');
        if (haveAccount) haveAccount.textContent = t('app.have_account');
        const showLoginBtn = document.getElementById('btn-show-login');
        if (showLoginBtn) showLoginBtn.textContent = t('app.login');
        const regSubmitBtn = document.getElementById('register-submit-btn');
        if (regSubmitBtn) regSubmitBtn.textContent = t('app.register');

        // Navbar
        const navNew = document.getElementById('nav-new-story-text');
        if (navNew) navNew.textContent = t('nav.new_story');

        document.querySelectorAll('.nav-text-dashboard').forEach(el => el.textContent = t('nav.dashboard'));
        document.querySelectorAll('.nav-text-layers').forEach(el => el.textContent = t('nav.layers'));
        document.querySelectorAll('.nav-text-media').forEach(el => el.textContent = t('nav.media'));
        document.querySelectorAll('.nav-text-users').forEach(el => el.textContent = t('nav.users'));
        document.querySelectorAll('.nav-text-basemaps').forEach(el => el.textContent = t('nav.basemaps'));
        document.querySelectorAll('.nav-text-settings').forEach(el => el.textContent = t('nav.settings'));
        document.querySelectorAll('.nav-text-account').forEach(el => el.textContent = t('nav.account'));
        document.querySelectorAll('.nav-text-logout').forEach(el => el.textContent = t('app.logout'));

        // Landing page
        this._updateLandingTexts();
    },

    _updateLandingTexts() {
        const t = I18n.t.bind(I18n);

        const heroTitle = document.getElementById('landing-hero-title');
        if (heroTitle) heroTitle.innerHTML = `${t('landing.hero_title_1')} <span class="gradient-text">${t('landing.hero_title_2')}</span>`;

        const heroSub = document.getElementById('landing-hero-subtitle');
        if (heroSub) heroSub.textContent = t('landing.hero_subtitle');

        const ctaStart = document.getElementById('landing-cta-start');
        if (ctaStart) ctaStart.textContent = t('landing.cta_start');

        const ctaDocs = document.getElementById('landing-cta-docs');
        if (ctaDocs) ctaDocs.textContent = t('landing.cta_docs');

        const linkFeatures = document.getElementById('landing-link-features');
        if (linkFeatures) linkFeatures.textContent = t('landing.feat_title');

        const linkInstall = document.getElementById('landing-link-install');
        if (linkInstall) linkInstall.textContent = t('landing.install_title');

        const btnLogin = document.getElementById('landing-btn-login');
        if (btnLogin) btnLogin.textContent = t('landing.cta_login');

        const featTitle = document.getElementById('landing-feat-title');
        if (featTitle) featTitle.textContent = t('landing.feat_title');

        const featSub = document.getElementById('landing-feat-subtitle');
        if (featSub) featSub.textContent = t('landing.feat_subtitle');

        const installTitle = document.getElementById('landing-install-title');
        if (installTitle) installTitle.textContent = t('landing.install_title');

        const installSub = document.getElementById('landing-install-subtitle');
        if (installSub) installSub.textContent = t('landing.install_subtitle');

        const authors = document.getElementById('landing-authors');
        if (authors) authors.textContent = t('landing.authors');

        const sponsor = document.getElementById('landing-sponsor');
        if (sponsor) sponsor.innerHTML = `${t('landing.sponsor')} <a href="https://studiogis.eu" target="_blank" style="color:#60a5fa;text-decoration:none;font-weight:600">StudioGIS.eu</a>`;

        // Features grid
        const grid = document.getElementById('landing-features-grid');
        if (grid) {
            const features = [
                { icon: 'bi-map', color: 'blue', key: 'maps' },
                { icon: 'bi-book', color: 'purple', key: 'stories' },
                { icon: 'bi-bar-chart', color: 'orange', key: 'data' },
                { icon: 'bi-people', color: 'green', key: 'collab' },
                { icon: 'bi-github', color: 'pink', key: 'open' },
                { icon: 'bi-cloud-arrow-up', color: 'teal', key: 'lidar' },
                { icon: 'bi-robot', color: 'yellow', key: 'ai' },
                { icon: 'bi-people-fill', color: 'cyan', key: 'participatory' },
            ];
            grid.innerHTML = features.map(f => `
                <div class="feature-card">
                    <div class="feature-icon ${f.color}"><i class="bi ${f.icon}"></i></div>
                    <h3>${t('landing.feat_' + f.key)}</h3>
                    <p>${t('landing.feat_' + f.key + '_desc')}</p>
                </div>
            `).join('');
        }
    },

    // ── Navigation ───────────────────────
    showLanding() {
        document.getElementById('landing-page').classList.remove('d-none');
        document.getElementById('login-screen').classList.add('d-none');
        document.getElementById('app').classList.add('d-none');
        document.getElementById('story-viewer').classList.add('d-none');
        document.body.classList.remove('is-admin');
    },

    showLogin() {
        document.getElementById('landing-page').classList.add('d-none');
        document.getElementById('login-screen').classList.remove('d-none');
        document.getElementById('app').classList.add('d-none');
        document.getElementById('story-viewer').classList.add('d-none');
        document.body.classList.remove('is-admin');
    },

    showApp() {
        document.getElementById('landing-page').classList.add('d-none');
        document.getElementById('login-screen').classList.add('d-none');
        document.getElementById('app').classList.remove('d-none');
        document.getElementById('story-viewer').classList.add('d-none');
        document.getElementById('main-navbar').classList.remove('d-none');

        const user = Api.getUser();
        document.getElementById('current-user-name').textContent = user?.display_name || user?.username || '';
        if (user?.role === 'admin') document.body.classList.add('is-admin');

        document.querySelectorAll('.admin-only').forEach(el => {
            el.style.display = user?.role === 'admin' ? '' : 'none';
        });

        this.showPanel('dashboard');
    },

    showPanel(name) {
        document.querySelectorAll('.app-panel').forEach(p => p.classList.add('d-none'));
        const panel = document.getElementById(`panel-${name}`);
        if (panel) {
            panel.classList.remove('d-none');
            this.currentPanel = name;
        }

        switch (name) {
            case 'dashboard': Dashboard.load(); break;
            case 'layers': Dashboard.loadLayers(); break;
            case 'media': MediaLibrary.load(); break;
            case 'users': Dashboard.loadUsers(); break;
            case 'basemaps': Dashboard.loadBasemaps(); break;
            case 'settings': Dashboard.loadSettings(); break;
            case 'account': Dashboard.loadAccount(); break;
        }
    },

    // ── Events ───────────────────────────
    _bindEvents() {
        // Login form
        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('login-username').value;
            const password = document.getElementById('login-password').value;
            const errorEl = document.getElementById('login-error');
            try {
                errorEl.classList.add('d-none');
                const result = await Api.login(username, password);
                Api.setSession(result.access_token, result.user);
                this.showApp();
            } catch (err) {
                errorEl.textContent = err.message;
                errorEl.classList.remove('d-none');
            }
        });

        // Toggle login/register
        document.getElementById('btn-show-register')?.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('login-form').classList.add('d-none');
            document.getElementById('register-form').classList.remove('d-none');
        });
        document.getElementById('btn-show-login')?.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('register-form').classList.add('d-none');
            document.getElementById('login-form').classList.remove('d-none');
        });

        // Register form
        document.getElementById('register-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('reg-username').value.trim();
            const email = document.getElementById('reg-email').value.trim();
            const displayName = document.getElementById('reg-displayname').value.trim();
            const password = document.getElementById('reg-password').value;
            const confirm = document.getElementById('reg-password-confirm').value;
            const errorEl = document.getElementById('register-error');
            errorEl.classList.add('d-none');

            if (password !== confirm) {
                errorEl.textContent = I18n.t('app.passwords_mismatch');
                errorEl.classList.remove('d-none');
                return;
            }
            try {
                const result = await Api.register(username, email, password, displayName || undefined);
                Api.setSession(result.access_token, result.user);
                this.toast(I18n.t('app.register_success'), 'success');
                this.showApp();
            } catch (err) {
                errorEl.textContent = err.message;
                errorEl.classList.remove('d-none');
            }
        });

        // OAuth Sign-In
        document.getElementById('btn-google-login')?.addEventListener('click', () => this._googleLogin());
        document.getElementById('btn-microsoft-login')?.addEventListener('click', () => this._oauthLogin('microsoft'));
        document.getElementById('btn-github-login')?.addEventListener('click', () => this._oauthLogin('github'));

        // Check for OAuth callback
        this._handleOAuthCallback();

        // Landing page buttons
        document.getElementById('landing-cta-start')?.addEventListener('click', () => this.showLogin());
        document.getElementById('landing-btn-login')?.addEventListener('click', (e) => { e.preventDefault(); this.showLogin(); });

        // Navbar
        document.getElementById('btn-home')?.addEventListener('click', (e) => { e.preventDefault(); this.showPanel('dashboard'); });
        document.getElementById('btn-dashboard')?.addEventListener('click', (e) => { e.preventDefault(); this.showPanel('dashboard'); });
        document.getElementById('btn-layers-catalog')?.addEventListener('click', (e) => { e.preventDefault(); this.showPanel('layers'); });
        document.getElementById('btn-media-library')?.addEventListener('click', (e) => { e.preventDefault(); this.showPanel('media'); });
        document.getElementById('btn-users-admin')?.addEventListener('click', (e) => { e.preventDefault(); this.showPanel('users'); });
        document.getElementById('btn-basemaps-admin')?.addEventListener('click', (e) => { e.preventDefault(); this.showPanel('basemaps'); });
        document.getElementById('btn-settings-admin')?.addEventListener('click', (e) => { e.preventDefault(); this.showPanel('settings'); });
        document.getElementById('btn-account')?.addEventListener('click', (e) => { e.preventDefault(); this.showPanel('account'); });

        document.getElementById('btn-logout')?.addEventListener('click', async (e) => {
            e.preventDefault();
            try { await Api.logout(); } catch { /* ok */ }
            Api.clearSession();
            this.showLanding();
        });

        document.getElementById('btn-new-story')?.addEventListener('click', () => this.createNewStory());

        // Language selector
        document.getElementById('btn-lang')?.addEventListener('change', (e) => {
            I18n.setLang(e.target.value);
            this._updateI18nTexts();
            if (this.currentPanel) this.showPanel(this.currentPanel);
        });

        // Public stories
        document.getElementById('btn-explore-public')?.addEventListener('click', (e) => {
            e.preventDefault();
            this._viewPublicList();
        });

        // Viewer close
        document.getElementById('viewer-close')?.addEventListener('click', () => {
            document.getElementById('story-viewer').classList.add('d-none');
            if (Api.isLoggedIn()) {
                document.getElementById('app').classList.remove('d-none');
            } else {
                this.showLanding();
            }
            StoryViewer.destroy();
        });
    },

    _setupRouting() {
        window.addEventListener('hashchange', () => this._handleHash());
        this._handleHash();
    },

    _handleHash() {
        const hash = window.location.hash;
        if (hash.startsWith('#/edit/')) {
            const id = parseInt(hash.replace('#/edit/', ''));
            if (id) StoryEditor.load(id);
        } else if (hash.startsWith('#/view/')) {
            const id = parseInt(hash.replace('#/view/', ''));
            if (id) this._viewPublicStory(id);
        }
    },

    // ── Google OAuth ─────────────────────
    async _googleLogin() {
        try {
            // Get client_id from backend
            const config = await Api.get('/api/auth/google/url');
            const clientId = config.client_id;
            if (!clientId) {
                this.toast('Google Sign-In non configurato', 'warning');
                return;
            }

            // Use Google Identity Services popup
            if (typeof google !== 'undefined' && google.accounts) {
                google.accounts.id.initialize({
                    client_id: clientId,
                    callback: async (response) => {
                        try {
                            const result = await Api.post('/api/auth/google', { credential: response.credential });
                            Api.setSession(result.access_token, result.user);
                            this.showApp();
                        } catch (err) {
                            this.toast(err.message, 'danger');
                        }
                    },
                });
                google.accounts.id.prompt((notification) => {
                    // If popup is suppressed (e.g. user dismissed), fall back to button
                    if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
                        this._googleLoginRedirect(clientId);
                    }
                });
            } else {
                // GIS library not loaded — use redirect flow
                this._googleLoginRedirect(clientId);
            }
        } catch (err) {
            this.toast('Google Sign-In non disponibile', 'warning');
        }
    },

    _googleLoginRedirect(clientId) {
        const redirectUri = window.location.origin + window.location.pathname;
        const state = 'google:' + crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
        sessionStorage.setItem('oauth_state', state);
        const url = 'https://accounts.google.com/o/oauth2/v2/auth' +
            `?client_id=${encodeURIComponent(clientId)}` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            '&response_type=code' +
            '&scope=openid%20email%20profile' +
            `&state=${encodeURIComponent(state)}` +
            '&prompt=select_account';
        window.location.href = url;
    },

    // ── OAuth providers visibility ─────
    async _loadOAuthProviders() {
        try {
            const providers = await Api.get('/api/oauth/providers');
            if (!providers.google) document.getElementById('btn-google-login')?.classList.add('d-none');
            if (!providers.microsoft) document.getElementById('btn-microsoft-login')?.classList.add('d-none');
            if (!providers.github) document.getElementById('btn-github-login')?.classList.add('d-none');
            // Hide entire divider if no providers configured
            if (!providers.google && !providers.microsoft && !providers.github) {
                document.getElementById('oauth-divider')?.classList.add('d-none');
                document.getElementById('oauth-buttons')?.classList.add('d-none');
            }
        } catch { /* ignore — show all buttons by default */ }
    },

    // ── Microsoft / GitHub OAuth (redirect flow) ─────
    async _oauthLogin(provider) {
        try {
            const info = await Api.get(`/api/oauth/${provider}/url`);
            const redirectUri = `${window.location.origin}${window.location.pathname}`;
            // Generate cryptographic CSRF state token
            const stateBytes = crypto.getRandomValues(new Uint8Array(16));
            const csrfToken = Array.from(stateBytes, b => b.toString(16).padStart(2, '0')).join('');
            const stateParam = `${provider}:${csrfToken}`;
            sessionStorage.setItem('oauth_state', stateParam);
            let url;
            if (provider === 'microsoft') {
                url = `${info.url}?client_id=${info.client_id}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=openid+email+profile&state=${encodeURIComponent(stateParam)}`;
            } else if (provider === 'github') {
                url = `${info.url}?client_id=${info.client_id}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user:email&state=${encodeURIComponent(stateParam)}`;
            }
            if (url) window.location.href = url;
        } catch (err) {
            this.toast(`${provider} Sign-In non configurato. Usa username e password.`, 'info');
        }
    },

    async _handleOAuthCallback() {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const state = params.get('state');
        if (!code || !state) return;

        // Validate CSRF state token
        const savedState = sessionStorage.getItem('oauth_state');
        sessionStorage.removeItem('oauth_state');
        if (!savedState || savedState !== state) {
            this.toast('OAuth state mismatch — possible CSRF attack', 'danger');
            const cleanUrl = window.location.origin + window.location.pathname;
            window.history.replaceState({}, '', cleanUrl);
            return;
        }

        // Extract provider from state (format: "provider:csrftoken")
        const provider = state.split(':')[0];
        if (!['google', 'microsoft', 'github'].includes(provider)) return;

        // Clean URL
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);

        try {
            // Google uses /api/oauth/google/code, others use /api/oauth/{provider}
            const endpoint = provider === 'google' ? '/api/oauth/google/code' : `/api/oauth/${provider}`;
            const result = await Api.post(endpoint, {
                code,
                redirect_uri: cleanUrl,
            });
            Api.setSession(result.access_token, result.user);
            this.showApp();
        } catch (err) {
            this.toast(`${provider} login failed: ${err.message}`, 'danger');
            this.showLogin();
        }
    },

    // ── Create Story (modal) ─────────────
    // Template definitions: each generates starter slides after story creation
    _storyTemplates: {
        sidecar: {
            icon: 'bi-layout-sidebar',
            slides: [
                { title: 'Cover', layout: 'cover', narrative: '<p>Your story starts here...</p>' },
                { title: 'Chapter 1', layout: 'side-left', narrative: '<p>Add your narrative text here.</p>' },
                { title: 'Chapter 2', layout: 'side-right', narrative: '<p>Continue your story...</p>' },
            ],
        },
        tour: {
            icon: 'bi-geo-alt',
            slides: [
                { title: 'Welcome', layout: 'cover', narrative: '<p>Welcome to the tour!</p>' },
                { title: 'Stop 1', layout: 'side-left', narrative: '<p>Describe this place...</p>' },
                { title: 'Stop 2', layout: 'side-left', narrative: '<p>Next stop on the tour...</p>' },
                { title: 'Stop 3', layout: 'side-left', narrative: '<p>Another interesting location...</p>' },
            ],
        },
        narrative: {
            icon: 'bi-journal-text',
            slides: [
                { title: 'Introduction', layout: 'text-only', narrative: '<h1>Your Title</h1><p>Start writing your article...</p>' },
                { title: '', layout: 'text-media', narrative: '<p>Text with media side by side.</p>' },
                { title: 'Map Section', layout: 'side-left', narrative: '<p>Here the map tells part of the story.</p>' },
                { title: '', layout: 'separator', narrative: '' },
                { title: 'Conclusion', layout: 'text-only', narrative: '<p>Wrap up your narrative.</p>' },
            ],
        },
        presentation: {
            icon: 'bi-easel',
            slides: [
                { title: 'Title Slide', layout: 'cover', narrative: '<h1>Presentation Title</h1><p>Subtitle here</p>' },
                { title: '', layout: 'separator', narrative: '' },
                { title: 'Data', layout: 'center', narrative: '<p>Add charts and data visualizations.</p>' },
                { title: 'Full Map', layout: 'full-map', narrative: '' },
                { title: 'Conclusion', layout: 'center', narrative: '<p>Key takeaways.</p>' },
            ],
        },
        city_tour: {
            icon: 'bi-buildings',
            slides: [
                { title: '', layout: 'cover', narrative: '<h1>Discovering the City</h1><p>An interactive walking tour through history, architecture, and culture. Scroll down to begin your journey.</p>' },
                { title: 'The Historic Center', layout: 'side-left', narrative: '<h2>The Historic Center</h2><p>Every great city has a beating heart. The historic center is where centuries of stories overlap: cobblestone streets, ornate facades, and hidden courtyards waiting to be discovered.</p><p>Navigate the map to explore the area, or zoom in to see individual landmarks.</p>' },
                { title: 'Markets & Local Life', layout: 'side-right', narrative: '<h2>Markets & Local Life</h2><p>The best way to understand a city is through its markets. Here the aromas, colors, and sounds tell a story that no guidebook can capture.</p><p><em>Tip: add markers on the map to highlight your favorite stalls and shops.</em></p>' },
                { title: 'Panoramic Views', layout: 'side-left', narrative: '<h2>Panoramic Views</h2><p>Climb to the highest point for a breathtaking panorama. From up here, the urban fabric reveals its logic: the river, the main squares, the green corridors connecting neighborhoods.</p>' },
                { title: '', layout: 'separator', narrative: '<h1>Until Next Time</h1><p>Thank you for exploring with us. Every city has infinite stories to tell.</p>' },
            ],
        },
        historical_journey: {
            icon: 'bi-hourglass-split',
            slides: [
                { title: '', layout: 'cover', narrative: '<h1>A Journey Through Time</h1><p>Explore how this place has transformed across the centuries. Maps, data, and narratives guide you through the key turning points.</p>' },
                { title: 'The Origins', layout: 'center', narrative: '<h2>The Origins</h2><p>Every place has a beginning. Archaeological evidence and early maps reveal the first settlements, the choice of location, and the natural resources that shaped early life here.</p><p>Use the map comparison tool to overlay historical maps with the modern view.</p>' },
                { title: 'Growth & Transformation', layout: 'side-left', narrative: '<h2>Growth & Transformation</h2><p>As centuries passed, the landscape changed dramatically. New roads, buildings, and infrastructure reshaped the territory. Add layers to visualize land use changes over time.</p>' },
                { title: 'The Modern Era', layout: 'side-right', narrative: '<h2>The Modern Era</h2><p>Today, the traces of the past coexist with contemporary life. Understanding this layered history helps us appreciate what we see and plan for the future.</p><p><em>Consider adding charts to show population growth or land use statistics.</em></p>' },
            ],
        },
        photo_story: {
            icon: 'bi-camera',
            slides: [
                { title: '', layout: 'cover', narrative: '<h1>A Visual Story</h1><p>Let your images speak. This template is designed for photo essays and visual narratives. Replace the placeholder text with your captions.</p>' },
                { title: 'The Scene', layout: 'full-media', narrative: '<h2>Set the Scene</h2><p>Upload a striking image as the background for this slide. The caption appears at the bottom.</p>' },
                { title: 'Details', layout: 'text-media', narrative: '<h2>The Details</h2><p>Pair your narrative with a photo side by side. This layout works well for explaining context, showing before/after shots, or adding depth to your visual story.</p>' },
                { title: 'The Map Connection', layout: 'side-left', narrative: '<h2>Where It Happened</h2><p>Place your photos on the map with markers. Each marker can contain an image and a description, turning the map into a geo-referenced photo album.</p>' },
            ],
        },
        data_story: {
            icon: 'bi-bar-chart-line',
            slides: [
                { title: '', layout: 'cover', narrative: '<h1>Data-Driven Insights</h1><p>Numbers tell stories too. This template helps you combine maps, charts, and narrative to present data in a compelling way.</p>' },
                { title: 'The Data', layout: 'side-left', narrative: '<h2>Exploring the Data</h2><p>Use the chart wizard to create a visualization from your dataset. Bar charts, line graphs, pie charts -- choose what best represents your data.</p><p><em>Tip: paste data directly from a spreadsheet, or load a CSV file.</em></p>' },
                { title: 'Spatial Patterns', layout: 'full-map', narrative: '' },
            ],
        },
    },

    async createNewStory() {
        const t = I18n.t.bind(I18n);
        const templates = ['sidecar', 'tour', 'narrative', 'presentation', 'city_tour', 'historical_journey', 'photo_story', 'data_story'];

        const templateCards = templates.map(key => {
            const tmpl = this._storyTemplates[key];
            return `<div class="story-template-card ${key === 'sidecar' ? 'active' : ''}" data-template="${key}"
                onclick="document.querySelectorAll('.story-template-card').forEach(c=>c.classList.remove('active'));this.classList.add('active');document.getElementById('modal-story-template').value='${key}';">
                <i class="bi ${tmpl.icon}"></i>
                <strong>${t('story.template_' + key)}</strong>
                <small>${t('story.template_' + key + '_desc')}</small>
            </div>`;
        }).join('');

        const result = await this.modal({
            title: t('story.new_title'),
            body: `
                <div class="mb-3">
                    <label class="form-label">${t('story.title_label')}</label>
                    <input type="text" class="form-control" id="modal-story-title"
                           placeholder="${t('story.title_placeholder')}" required>
                </div>
                <div class="mb-3">
                    <label class="form-label">${t('story.desc_label')}</label>
                    <textarea class="form-control" id="modal-story-desc" rows="2"></textarea>
                </div>
                <div class="mb-3">
                    <label class="form-label">${t('story.template')}</label>
                    <div class="story-template-grid">${templateCards}</div>
                    <input type="hidden" id="modal-story-template" value="sidecar">
                </div>
                <div class="mb-3">
                    <label class="form-label">${t('story.visibility')}</label>
                    <select class="form-select" id="modal-story-visibility">
                        <option value="private">${t('story.visibility_private')}</option>
                        <option value="public">${t('story.visibility_public')}</option>
                        <option value="unlisted">${t('story.visibility_unlisted')}</option>
                    </select>
                </div>
            `,
            confirmText: t('action.confirm'),
            onConfirm: () => ({
                title: document.getElementById('modal-story-title')?.value,
                description: document.getElementById('modal-story-desc')?.value || null,
                visibility: document.getElementById('modal-story-visibility')?.value || 'private',
                template: document.getElementById('modal-story-template')?.value || 'sidecar',
            }),
        });

        if (!result || !result.title) return;
        try {
            const story = await Api.createStory({
                title: result.title,
                description: result.description,
                visibility: result.visibility,
            });

            // Create starter slides from template
            const tmpl = this._storyTemplates[result.template];
            if (tmpl) {
                for (let i = 0; i < tmpl.slides.length; i++) {
                    const s = tmpl.slides[i];
                    try {
                        await Api.createSlide({
                            story_id: story.id,
                            title: s.title,
                            narrative: s.narrative,
                            layout: s.layout,
                            sort_order: i,
                        });
                    } catch { /* continue with other slides */ }
                }
            }

            this.toast(t('story.created'), 'success');
            StoryEditor.load(story.id);
        } catch (err) {
            this.toast(err.message, 'danger');
        }
    },

    async _viewPublicStory(storyId) {
        try {
            const data = await Api.getStoryFull(storyId);
            document.getElementById('landing-page').classList.add('d-none');
            document.getElementById('login-screen').classList.add('d-none');
            document.getElementById('app').classList.add('d-none');
            StoryViewer.load(data);
        } catch (err) {
            this.toast(I18n.t('story.not_found'), 'danger');
        }
    },

    async _viewSharedStory(token) {
        try {
            const story = await Api.getSharedStory(token);
            const data = await Api.getStoryFull(story.id);
            document.getElementById('landing-page').classList.add('d-none');
            document.getElementById('login-screen').classList.add('d-none');
            document.getElementById('app').classList.add('d-none');
            StoryViewer.load(data);
        } catch (err) {
            this.toast(I18n.t('story.share_invalid'), 'danger');
        }
    },

    async _viewPublicList() {
        document.getElementById('landing-page').classList.add('d-none');
        document.getElementById('login-screen').classList.add('d-none');
        document.getElementById('app').classList.remove('d-none');
        document.getElementById('main-navbar').classList.add('d-none');
        this.showPanel('dashboard');
        Dashboard.loadPublic();
    },

    async _loadEmbed(storyId) {
        try {
            const data = await Api.get(`/api/stories/${storyId}/embed`);
            // Hide all UI except viewer
            document.getElementById('landing-page').classList.add('d-none');
            document.getElementById('login-screen').classList.add('d-none');
            document.getElementById('app').classList.add('d-none');
            document.getElementById('main-navbar')?.classList.add('d-none');

            // Apply embed theme override if specified
            if (this.embedOptions.theme) {
                data.story.settings = { ...(data.story.settings || {}), theme: this.embedOptions.theme };
            }

            // Add embed-mode class to viewer
            const viewer = document.getElementById('story-viewer');
            viewer.classList.add('embed-mode');
            if (this.embedOptions.controls === 'minimal') {
                viewer.classList.add('embed-minimal');
            }

            StoryViewer.load(data);
        } catch (err) {
            document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#94a3b8;font-family:sans-serif">Story not found</div>';
        }
    },

    // ══ Modal System ══════════════════════
    modal(opts) {
        return new Promise((resolve) => {
            const id = 'tm-modal-' + Date.now();
            const btnClass = opts.danger ? 'btn-danger' : 'btn-primary';
            const html = `
                <div class="modal fade" id="${id}" tabindex="-1" data-bs-backdrop="static">
                    <div class="modal-dialog ${opts.size === 'lg' ? 'modal-lg' : opts.size === 'sm' ? 'modal-sm' : ''}">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">${opts.title || ''}</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">${opts.body || ''}</div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-sm btn-outline-light" data-bs-dismiss="modal">
                                    ${opts.cancelText || I18n.t('action.cancel')}
                                </button>
                                <button type="button" class="btn btn-sm ${btnClass}" id="${id}-confirm">
                                    ${opts.confirmText || I18n.t('action.confirm')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', html);
            const el = document.getElementById(id);
            const modal = new bootstrap.Modal(el);

            let resolved = false;

            document.getElementById(`${id}-confirm`).addEventListener('click', () => {
                resolved = true;
                const result = opts.onConfirm ? opts.onConfirm() : true;
                modal.hide();
                resolve(result);
            });

            el.querySelectorAll('input, select').forEach(input => {
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        document.getElementById(`${id}-confirm`).click();
                    }
                });
            });

            el.addEventListener('hidden.bs.modal', () => {
                el.remove();
                if (!resolved) resolve(null);
            });

            modal.show();
            setTimeout(() => el.querySelector('input, textarea, select')?.focus(), 300);
        });
    },

    async confirm(message, opts = {}) {
        const result = await this.modal({
            title: opts.title || I18n.t('action.confirm'),
            body: `<p style="margin:0">${this.escHtml(message)}</p>`,
            confirmText: opts.confirmText || I18n.t('action.confirm'),
            danger: opts.danger,
            onConfirm: () => true,
        });
        return !!result;
    },

    async prompt(label, defaultValue = '', opts = {}) {
        const inputId = 'tm-prompt-' + Date.now();
        const result = await this.modal({
            title: opts.title || label,
            body: `
                <div class="mb-0">
                    ${opts.hideLabel ? '' : `<label class="form-label">${this.escHtml(label)}</label>`}
                    <input type="${opts.type || 'text'}" class="form-control" id="${inputId}"
                           value="${this.escHtml(defaultValue)}" placeholder="${this.escHtml(opts.placeholder || '')}">
                </div>
            `,
            confirmText: opts.confirmText || I18n.t('action.confirm'),
            onConfirm: () => document.getElementById(inputId)?.value || '',
        });
        return result;
    },

    // ── Toast ────────────────────────────
    toast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const id = 'toast-' + Date.now();
        const iconMap = {
            success: 'bi-check-circle-fill',
            danger: 'bi-exclamation-triangle-fill',
            warning: 'bi-exclamation-circle-fill',
            info: 'bi-info-circle-fill'
        };
        const bgMap = {
            success: 'text-bg-success',
            danger: 'text-bg-danger',
            warning: 'text-bg-warning',
            info: 'text-bg-primary'
        };
        container.insertAdjacentHTML('beforeend', `
            <div id="${id}" class="toast align-items-center ${bgMap[type] || bgMap.info} border-0" role="alert">
                <div class="d-flex">
                    <div class="toast-body"><i class="bi ${iconMap[type] || iconMap.info} me-2"></i>${App.escHtml(message)}</div>
                    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
                </div>
            </div>
        `);
        const el = document.getElementById(id);
        const toast = new bootstrap.Toast(el, { delay: 4000 });
        toast.show();
        el.addEventListener('hidden.bs.toast', () => el.remove());
    },

    // ── Utilities ────────────────────────
    escHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    /** Sanitize user-generated HTML (narratives, popups) via DOMPurify */
    sanitize(html) {
        if (!html) return '';
        if (typeof DOMPurify !== 'undefined') {
            return DOMPurify.sanitize(html, {
                ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','br','strong','b','em','i','u','s',
                    'a','ul','ol','li','blockquote','pre','code','img','table','thead','tbody',
                    'tr','th','td','hr','span','div','figure','figcaption','sup','sub','small'],
                ALLOWED_ATTR: ['href','src','alt','title','class','style','target','width','height',
                    'colspan','rowspan'],
                ALLOW_DATA_ATTR: false,
            });
        }
        return html;
    },

    formatDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        const loc = { it: 'it-IT', en: 'en-US', es: 'es-ES' }[I18n.getLang()] || 'it-IT';
        return d.toLocaleDateString(loc, { day: '2-digit', month: 'short', year: 'numeric' });
    },
};

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
