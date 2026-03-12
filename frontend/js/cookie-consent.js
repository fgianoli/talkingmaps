/**
 * TalkingMaps – Cookie Consent Banner
 * GDPR-compliant, lightweight, no dependencies
 */
const CookieConsent = {
    _key: 'tm_cookie_consent',

    init() {
        if (this.hasConsent()) return;
        this._show();
    },

    hasConsent() {
        return localStorage.getItem(this._key) === 'accepted';
    },

    _show() {
        const t = I18n.t.bind(I18n);
        const html = `
            <div id="cookie-banner" style="
                position:fixed; bottom:0; left:0; right:0; z-index:99999;
                background:rgba(255,255,255,0.97); backdrop-filter:blur(12px);
                border-top:1px solid #e2e8f0; padding:16px 24px;
                display:flex; align-items:center; justify-content:space-between;
                gap:16px; flex-wrap:wrap; font-size:14px; color:#1e293b;
                box-shadow:0 -4px 20px rgba(0,0,0,0.06);
            ">
                <div style="flex:1;min-width:240px;line-height:1.5">
                    <strong>${t('cookie.title')}</strong><br>
                    <span style="color:#64748b;font-size:13px">${t('cookie.text')}</span>
                </div>
                <div style="display:flex;gap:8px;flex-shrink:0">
                    <button id="cookie-accept" class="btn btn-sm btn-primary">${t('cookie.accept')}</button>
                    <button id="cookie-minimal" class="btn btn-sm btn-outline-light">${t('cookie.minimal')}</button>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);

        document.getElementById('cookie-accept')?.addEventListener('click', () => {
            localStorage.setItem(this._key, 'accepted');
            document.getElementById('cookie-banner')?.remove();
        });

        document.getElementById('cookie-minimal')?.addEventListener('click', () => {
            localStorage.setItem(this._key, 'accepted');
            document.getElementById('cookie-banner')?.remove();
        });
    },
};
