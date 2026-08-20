/**
 * Regression tests for the four frontend findings of the full-codebase review.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO = path.resolve(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');

const dom = new JSDOM(`<!doctype html><html><body>
  <div id="panel-dashboard"></div>
  <div id="panel-media"></div>
  <div id="editor-props-body"></div>
</body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.org/' });
const w = dom.window;

const ATTR = '" onmouseover="window.__XSS=1" x="';
const JSSTR = "');window.__XSS=1;//";

const stubs = `
const noop = (own) => new Proxy(own, { get: (t, p) => (p in t ? t[p] : () => {}) });
window.TmMap = noop({ getMap: () => null, getState: () => ({}), getDrawFeatures: () => null });
window.TmCharts = noop({}); window.TmGallery = noop({}); window.Cesium3D = noop({});
window.PotreeViewer = noop({}); window.UndoStack = noop({}); window.StoryViewer = noop({});
window.DOMPurify = { sanitize: (x) => String(x ?? '') };
window.bootstrap = { Modal: class { constructor(){} show(){} hide(){} static getInstance(){ return null; } } };
window.__copied = null;
Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: (t) => { window.__copied = t; } }, configurable: true });
window.Api = noop({
    getUser: () => ({ id: 1 }),
    updateSlide: async (id, updates) => { window.__saved = { id, updates }; return updates; },
    listAllContributions: async () => [],
    listStories: async () => [],
    isLoggedIn: () => true,
});
window.I18n = I18n; window.App = App; App.init = () => {}; App.toast = () => {};
window.TmAnimate = TmAnimate; window.TmImageCompare = TmImageCompare;
window.StoryEditor = StoryEditor; window.Dashboard = Dashboard; window.MediaLibrary = MediaLibrary;
I18n.init(); I18n.setLang('en');
`;

w.eval([read('frontend/js/i18n.js'), read('frontend/js/app.js'), read('frontend/js/animate.js'),
        read('frontend/js/compare-image.js'), read('frontend/js/viewer.js'), read('frontend/js/editor.js'),
        read('frontend/js/dashboard.js'), read('frontend/js/media-library.js'), stubs].join('\n;\n'));

let failures = 0;
const check = (name, cond, extra) => {
    if (cond) console.log('  PASS  ' + name);
    else { console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + extra : '')); failures++; }
};
const doc = w.document;
const M = w.MediaLibrary, E = w.StoryEditor, D = w.Dashboard;

// ── 1. Media detail: video/audio src were left unescaped ──
console.log('\n1. Media detail preview escaping');
for (const [label, mime, tag] of [['video', 'video/mp4', 'video'], ['audio', 'audio/mpeg', 'audio']]) {
    doc.getElementById('media-detail-modal')?.remove();
    M._showDetail(1, ATTR, 'clip', mime);
    const modal = doc.getElementById('media-detail-modal');
    const el = modal.querySelector(tag);
    check(`${label}: element rendered`, !!el);
    check(`${label}: url intact in src`, el.getAttribute('src') === ATTR, el.getAttribute('src'));
    check(`${label}: no attribute injected`, !modal.querySelector('[onmouseover]') && !w.__XSS);
}
doc.getElementById('media-detail-modal')?.remove();
M._showDetail(1, ATTR, 'shot', 'image/png');
check('image: still escaped', doc.querySelector('#media-detail-modal img').getAttribute('src') === ATTR);

// ── 2. Copy-URL button was an inline JS-string sink ──
console.log('\n2. Copy URL button');
const modal = doc.getElementById('media-detail-modal');
check('no inline handler on the copy button',
    modal.querySelectorAll('[onclick*="clipboard"]').length === 0);
const copyBtn = doc.getElementById('media-copy-url');
check('copy button present', !!copyBtn);
copyBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
check('copies the exact url', w.__copied === ATTR, JSON.stringify(w.__copied));
check('nothing executed', !w.__XSS);

// An apostrophe alone used to make the old handler a syntax error
doc.getElementById('media-detail-modal')?.remove();
w.__copied = null;
M._showDetail(2, "/uploads/o'brien photo.png", 'x', 'image/png');
doc.getElementById('media-copy-url').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
check('an apostrophe in the path still copies', w.__copied === "/uploads/o'brien photo.png", JSON.stringify(w.__copied));

// ── 3. A non-numeric key figure must survive an editor round-trip ──
console.log('\n3. Key figure round-trip');
const slide = {
    id: 9, layout: 'text-only', title: 'T', narrative: '<p>x</p>', visible: true,
    style_overrides: { stats: { items: [
        { value: '1.2M', label: 'Pre-formatted', prefix: '~', suffix: '', decimals: 0, desc: '' },
        { value: 500, label: 'Numeric', prefix: '', suffix: ' ha', decimals: 0, desc: '' },
    ], columns: 2, duration: 1000 } },
};
E._slides = [slide]; E._currentSlideIdx = 0;
E._story = { id: 1, settings: {} }; E._data = { basemaps: [] }; E._storyId = 1;
E._renderProps(slide);

const firstInput = doc.querySelector('.stat-value');
check('the non-numeric value shows in the field', firstInput.value === '1.2M', JSON.stringify(firstInput.value));

E._saveCurrentSlideProps().then(() => {
    const saved = w.__saved.updates.style_overrides.stats.items;
    check('non-numeric value preserved, not zeroed', saved[0].value === '1.2M', JSON.stringify(saved[0].value));
    check('numeric neighbour still stored as a number', saved[1].value === 500 && typeof saved[1].value === 'number',
        JSON.stringify(saved[1].value));

    // And the viewer renders what the editor kept
    const scope = doc.createElement('div');
    w.TmAnimate.renderStats(scope, { items: saved, duration: 0 });
    w.TmAnimate.runStats(scope);

    setTimeout(() => {
        const shown = [...scope.querySelectorAll('.tm-stat-value')].map(e => e.textContent);
        check('viewer shows the pre-formatted figure verbatim', shown[0] === '~1.2M', JSON.stringify(shown[0]));
        check('viewer still counts the numeric one', shown[1] === '500 ha', JSON.stringify(shown[1]));

        // Blank stays blank rather than becoming 0
        doc.querySelector('.stat-value').value = '   ';
        return E._saveCurrentSlideProps().then(() => {
            check('a blank field is not turned into 0',
                w.__saved.updates.style_overrides.stats.items[0].value === '',
                JSON.stringify(w.__saved.updates.style_overrides.stats.items[0].value));

            // ── 4. Moderation panel targeted an element that is not in the document ──
            console.log('\n4. Moderation panel container');
            const indexHtml = read('frontend/index.html');
            check('#dashboard-content really is absent from the page',
                !indexHtml.includes('id="dashboard-content"'));
            check('#panel-dashboard really is present', indexHtml.includes('id="panel-dashboard"'));

            return D.renderModeration(3).then(() => {
                const panel = doc.getElementById('panel-dashboard');
                check('the panel actually renders now', panel.innerHTML.includes('moderation-panel'),
                    panel.innerHTML.slice(0, 60));
                const back = doc.getElementById('mod-back');
                check('back button present', !!back);

                let loaded = false;
                D.load = async () => { loaded = true; };
                back.onclick();
                check('back button calls an existing method', loaded);

                console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL REVIEW-2 CHECKS PASSED'));
                process.exit(failures ? 1 : 0);
            });
        });
    }, 300);
}).catch(e => { console.error('THREW:', e); process.exit(1); });
