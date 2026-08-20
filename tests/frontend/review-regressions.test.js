/**
 * Regression tests for the four bugs found in review of 161d33e..HEAD.
 * Each block fails against the pre-fix code.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO = path.resolve(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');

const dom = new JSDOM(`<!doctype html><html><body>
  <div id="story-viewer">
    <div id="viewer-toolbar"></div>
    <div id="viewer-narrative"></div>
    <div id="viewer-progress"></div>
    <div id="viewer-map-container"></div>
  </div>
  <div id="editor-props-body"></div>
</body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.org/' });
const w = dom.window;

const stubs = `
const noop = (own) => new Proxy(own, { get: (t, p) => (p in t ? t[p] : () => {}) });
window.TmMap = noop({ getMap: () => null, getState: () => ({}), getDrawFeatures: () => null });
window.TmCharts = noop({}); window.TmGallery = noop({});
window.Cesium3D = noop({}); window.PotreeViewer = noop({}); window.UndoStack = noop({});
window.Api = noop({ updateSlide: async (id, updates) => { window.__saved = { id, updates }; return updates; },
                    isLoggedIn: () => false });
window.Dashboard = noop({}); window.MediaLibrary = noop({}); window.Guide = noop({}); window.CookieConsent = noop({});
window.I18n = I18n; window.App = App; window.TmAnimate = TmAnimate;
App.init = () => {}; // app.js boots itself on DOMContentLoaded; not what we're testing here
window.TmImageCompare = TmImageCompare; window.StoryViewer = StoryViewer; window.StoryEditor = StoryEditor;
I18n.init(); I18n.setLang('en');
`;

// app.js needs a DOM-ish environment at load; it is an object literal so nothing runs on load
w.eval([read('frontend/js/i18n.js'), read('frontend/js/app.js'), read('frontend/js/animate.js'),
        read('frontend/js/compare-image.js'), read('frontend/js/viewer.js'),
        read('frontend/js/editor.js'), stubs].join('\n;\n'));

let failures = 0;
const check = (name, cond, extra) => {
    if (cond) console.log('  PASS  ' + name);
    else { console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + extra : '')); failures++; }
};
const V = w.StoryViewer;

// ═══════════════════════════════════════════════
// BUG 1 — innerHTML += for the scroll hint re-parses the first slide,
//         destroying every listener the embeds just attached.
// ═══════════════════════════════════════════════
console.log('\nBUG 1: scroll hint must not wipe listeners on slide 0');
V._data = { story: { id: 1, title: 'S', settings: {} }, basemaps: [], layers: [], markers: [] };
V._slides = [
    { id: 1, layout: 'text-only', title: 'First', narrative: '<p>a</p>',
      style_overrides: { image_compare: {
          before_url: 'https://example.org/a.jpg', after_url: 'https://example.org/b.jpg', start: 50 } } },
    { id: 2, layout: 'text-only', title: 'Second', narrative: '<p>b</p>', style_overrides: {} },
];
V._buildNarrative();

const slide0 = w.document.querySelector('[data-slide-index="0"]');
check('scroll hint is present', !!slide0.querySelector('.scroll-hint'));
const cmp0 = slide0.querySelector('.tm-imgcmp');
check('comparison widget survived in the DOM', !!cmp0);

const div0 = cmp0.querySelector('.tm-imgcmp-divider');
div0.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
check('keyboard still drives the widget on slide 0',
    cmp0.style.getPropertyValue('--tm-imgcmp-pos') === '100%',
    cmp0.style.getPropertyValue('--tm-imgcmp-pos') || '(no listener — re-parsed)');

// The same slide layout on a later index has always worked; prove the contrast holds after the fix
const slide1 = w.document.querySelector('[data-slide-index="1"]');
check('slide 1 has no scroll hint', !slide1.querySelector('.scroll-hint'));

// ═══════════════════════════════════════════════
// BUG 2 — App.escHtml does not escape quotes, so every value="${escHtml(x)}"
//         in the editor can be broken out of.
// ═══════════════════════════════════════════════
console.log('\nBUG 2: escHtml must be safe inside a double-quoted attribute');
check('double quote escaped', w.App.escHtml('a"b') === 'a&quot;b', JSON.stringify(w.App.escHtml('a"b')));
check('single quote escaped', w.App.escHtml("a'b") === 'a&#39;b', JSON.stringify(w.App.escHtml("a'b")));
check('angle brackets still escaped', w.App.escHtml('<b>') === '&lt;b&gt;', w.App.escHtml('<b>'));
check('ampersand still escaped', w.App.escHtml('a&b') === 'a&amp;b', w.App.escHtml('a&b'));
check('empty input unchanged', w.App.escHtml('') === '');
check('non-string coerced', w.App.escHtml(42) === '42', w.App.escHtml(42));

const E = w.StoryEditor;
const PAYLOAD = '" onfocus="window.__XSS=1" x="';
const hostile = {
    id: 9, layout: 'text-only', title: 'T', narrative: '<p>x</p>', visible: true,
    style_overrides: {
        stats: { items: [{ value: PAYLOAD, label: PAYLOAD, desc: '', prefix: PAYLOAD, suffix: '', decimals: 0 }],
                 columns: 2, duration: 1000 },
        image_compare: { before_url: PAYLOAD, after_url: 'b.jpg', before_label: PAYLOAD, after_label: '',
                         aspect: '16/9', start: 10 },
    },
};
E._slides = [hostile]; E._currentSlideIdx = 0;
E._story = { id: 1, settings: {} }; E._data = { basemaps: [] }; E._storyId = 1;
E._renderProps(hostile);

const doc = w.document;
const statValue = doc.querySelector('.stat-value');
const statLabel = doc.querySelector('.stat-label');
const imgBefore = doc.getElementById('prop-imgcmp-before');
check('stat value attribute did not break out',
    !!statValue && statValue.getAttribute('value') === PAYLOAD && !statValue.hasAttribute('onfocus'),
    statValue ? JSON.stringify(statValue.getAttribute('value')) : 'input missing');
check('stat label attribute did not break out',
    !!statLabel && statLabel.value === PAYLOAD && !statLabel.hasAttribute('onfocus'),
    statLabel ? JSON.stringify(statLabel.value) : 'input missing');
check('stat prefix attribute did not break out',
    doc.querySelector('.stat-prefix')?.value === PAYLOAD && !doc.querySelector('.stat-prefix').hasAttribute('onfocus'));
check('image-compare URL attribute did not break out',
    !!imgBefore && imgBefore.value === PAYLOAD && !imgBefore.hasAttribute('onfocus'),
    imgBefore ? JSON.stringify(imgBefore.value) : 'input missing');
check('image-compare label attribute did not break out',
    doc.getElementById('prop-imgcmp-before-label')?.value === PAYLOAD);
check('no injected handler anywhere in the panel',
    doc.querySelectorAll('#editor-props-body [onfocus]').length === 0,
    String(doc.querySelectorAll('#editor-props-body [onfocus]').length));

// ═══════════════════════════════════════════════
// BUG 3 — a saved start position of 0 was replaced by the 50 default.
// ═══════════════════════════════════════════════
console.log('\nBUG 3: image comparison must honour start = 0');
const mk = (cfg) => {
    const host = w.document.createElement('div');
    return w.TmImageCompare.render(host, { before_url: 'a.jpg', after_url: 'b.jpg', ...cfg });
};
check('start 0 stays at 0%', mk({ start: 0 }).style.getPropertyValue('--tm-imgcmp-pos') === '0%',
    mk({ start: 0 }).style.getPropertyValue('--tm-imgcmp-pos'));
check('start "0" (string) stays at 0%', mk({ start: '0' }).style.getPropertyValue('--tm-imgcmp-pos') === '0%',
    mk({ start: '0' }).style.getPropertyValue('--tm-imgcmp-pos'));
check('aria matches', mk({ start: 0 }).querySelector('.tm-imgcmp-divider').getAttribute('aria-valuenow') === '0');
check('start 35 still honoured', mk({ start: 35 }).style.getPropertyValue('--tm-imgcmp-pos') === '35%');
check('start 100 still honoured', mk({ start: 100 }).style.getPropertyValue('--tm-imgcmp-pos') === '100%');
check('missing start falls back to 50%', mk({}).style.getPropertyValue('--tm-imgcmp-pos') === '50%');
check('garbage start falls back to 50%', mk({ start: 'abc' }).style.getPropertyValue('--tm-imgcmp-pos') === '50%',
    mk({ start: 'abc' }).style.getPropertyValue('--tm-imgcmp-pos'));
check('out-of-range start clamped', mk({ start: 999 }).style.getPropertyValue('--tm-imgcmp-pos') === '100%');

// ═══════════════════════════════════════════════
// BUG 4 — a non-numeric stat value rendered as the literal string "NaN".
// ═══════════════════════════════════════════════
console.log('\nBUG 4: non-numeric stat values must not render as NaN');
const scope = w.document.createElement('div');
w.TmAnimate.renderStats(scope, {
    items: [
        { value: '1.2M', label: 'Pre-formatted', prefix: '~' },
        { value: 500, label: 'Numeric', suffix: ' ha' },
    ],
    duration: 0,
});
w.TmAnimate.runStats(scope);

setTimeout(() => {
    const rendered = [...scope.querySelectorAll('.tm-stat-value')].map(e => e.textContent);
    check('non-numeric value is not NaN', !rendered[0].includes('NaN'), JSON.stringify(rendered[0]));
    check('non-numeric value shown verbatim', rendered[0] === '~1.2M', JSON.stringify(rendered[0]));
    check('numeric neighbour still animates to its target', rendered[1] === '500 ha', JSON.stringify(rendered[1]));

    console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL REGRESSION CHECKS PASSED'));
    process.exit(failures ? 1 : 0);
}, 400);
