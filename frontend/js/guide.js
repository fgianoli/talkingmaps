/**
 * TalkingMaps – Interactive Editor Guide
 * Step-by-step tour for first-time users
 */
const Guide = {
    _key: 'tm_guide_done',
    _step: 0,
    _overlay: null,

    _steps: [
        { key: 'welcome', target: null, position: 'center' },
        { key: 'slides', target: '.editor-slides-panel', position: 'right' },
        { key: 'map', target: '.editor-map-area', position: 'center' },
        { key: 'props', target: '.editor-props-panel', position: 'left' },
        { key: 'layers', target: null, position: 'center' },
        { key: 'done', target: null, position: 'center' },
    ],

    shouldShow() {
        return !localStorage.getItem(this._key);
    },

    start() {
        if (!this.shouldShow()) return;
        this._step = 0;
        this._createOverlay();
        this._showStep();
    },

    _createOverlay() {
        if (this._overlay) this._overlay.remove();

        const el = document.createElement('div');
        el.id = 'guide-overlay';
        el.style.cssText = `
            position:fixed;inset:0;z-index:50000;
            background:rgba(15,23,42,0.4);backdrop-filter:blur(2px);
            display:flex;align-items:center;justify-content:center;
        `;
        el.innerHTML = `
            <div id="guide-card" style="
                background:white;border-radius:16px;padding:32px;
                max-width:440px;width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.15);
                text-align:center;position:relative;
            ">
                <div id="guide-step-indicator" style="margin-bottom:16px;display:flex;gap:6px;justify-content:center"></div>
                <h3 id="guide-title" style="font-family:var(--tm-font-display);font-size:22px;margin:0 0 8px;color:#1e293b"></h3>
                <p id="guide-text" style="font-size:15px;color:#64748b;margin:0 0 24px;line-height:1.6"></p>
                <div id="guide-actions" style="display:flex;gap:8px;justify-content:center"></div>
            </div>
        `;
        document.body.appendChild(el);
        this._overlay = el;
    },

    _showStep() {
        const step = this._steps[this._step];
        const t = I18n.t.bind(I18n);

        document.getElementById('guide-title').textContent = t('guide.' + step.key);
        document.getElementById('guide-text').textContent = t('guide.' + step.key + '_text');

        // Step indicators
        const indicator = document.getElementById('guide-step-indicator');
        indicator.innerHTML = this._steps.map((_, i) => `
            <div style="width:8px;height:8px;border-radius:50%;
                background:${i === this._step ? '#4f6df5' : '#e2e8f0'};
                transition:background 0.2s"></div>
        `).join('');

        // Actions
        const actions = document.getElementById('guide-actions');
        const isFirst = this._step === 0;
        const isLast = this._step === this._steps.length - 1;

        let btns = '';
        if (isFirst) {
            btns += `<button class="btn btn-sm btn-outline-light" id="guide-skip">${t('guide.skip')}</button>`;
            btns += `<button class="btn btn-sm btn-primary" id="guide-next">${t('guide.next')}</button>`;
        } else if (isLast) {
            btns += `<button class="btn btn-sm btn-primary" id="guide-finish">${t('guide.finish')}</button>`;
        } else {
            btns += `<button class="btn btn-sm btn-outline-light" id="guide-prev">${t('guide.prev')}</button>`;
            btns += `<button class="btn btn-sm btn-primary" id="guide-next">${t('guide.next')}</button>`;
        }
        actions.innerHTML = btns;

        document.getElementById('guide-skip')?.addEventListener('click', () => this._close());
        document.getElementById('guide-prev')?.addEventListener('click', () => { this._step--; this._showStep(); });
        document.getElementById('guide-next')?.addEventListener('click', () => { this._step++; this._showStep(); });
        document.getElementById('guide-finish')?.addEventListener('click', () => this._close());

        // Highlight target
        if (step.target) {
            const target = document.querySelector(step.target);
            if (target) {
                target.style.position = target.style.position || 'relative';
                target.style.zIndex = '50001';
                target.style.boxShadow = '0 0 0 4px rgba(79,109,245,0.3)';
                target.style.borderRadius = '8px';
                // Clean up previous highlights
                this._steps.forEach(s => {
                    if (s.target && s.target !== step.target) {
                        const el = document.querySelector(s.target);
                        if (el) {
                            el.style.zIndex = '';
                            el.style.boxShadow = '';
                        }
                    }
                });
            }
        }
    },

    _close() {
        localStorage.setItem(this._key, '1');
        // Clean up highlights
        this._steps.forEach(s => {
            if (s.target) {
                const el = document.querySelector(s.target);
                if (el) {
                    el.style.zIndex = '';
                    el.style.boxShadow = '';
                }
            }
        });
        if (this._overlay) {
            this._overlay.remove();
            this._overlay = null;
        }
    },

    reset() {
        localStorage.removeItem(this._key);
    },
};
