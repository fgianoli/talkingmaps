/**
 * Participatory maps: the reader-facing half.
 *
 * The wiring for contributions has been in place for a while, but three things
 * in it were wrong in ways that only show up when real values run through it:
 * a contribution on the Greenwich meridian vanished, an uploaded filename could
 * carry script into every reader's browser, and a category name could inject an
 * attribute into the submission form. Each check below fails without its fix.
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
</body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.org/' });
const w = dom.window;

const stubs = `
window.App = {
    escHtml: s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    sanitize: s => s,
    toast: (msg, kind) => { window.toasts.push({ msg, kind }); },
    embedMode: false,
};
window.toasts = [];
// Deliberately a pass-through: the popup HTML never reaches DOMPurify at runtime
// either, because Popup.setHTML() does not sanitise. Escaping has to be in the
// builder itself, and this stub is what proves it is.
window.DOMPurify = { sanitize: s => String(s) };
const noopModule = (own) => new Proxy(own, { get: (t, p) => (p in t ? t[p] : () => {}) });
window.TmCharts = noopModule({});
window.TmGallery = noopModule({});
window.TmMap = noopModule({ getMap: () => null, getState: () => ({}), getDrawFeatures: () => null });
window.Cesium3D = noopModule({});
window.PotreeViewer = noopModule({});
window.Api = { isLoggedIn: () => true, listContributions: async () => [] };

window.placed = [];
window.popupHtml = null;
window.maplibregl = {
    Marker: function (o) {
        this._el = o && o.element;
        this.setLngLat = function (ll) { this._ll = ll; return this; };
        this.setPopup = function () { return this; };
        this.addTo = function () { window.placed.push({ ll: this._ll, el: this._el }); return this; };
        this.remove = function () { return this; };
    },
    Popup: function () {
        this.setHTML = function (h) { window.popupHtml = h; return this; };
        this.setLngLat = function () { return this; };
        this.addTo = function () { return this; };
        this.remove = function () {};
    },
};
window.I18n = I18n;
window.TmAnimate = TmAnimate;
window.TmImageCompare = TmImageCompare;
window.StoryViewer = StoryViewer;
I18n.init(); I18n.setLang('it');
`;

w.eval([read('frontend/js/i18n.js'), read('frontend/js/animate.js'),
        read('frontend/js/compare-image.js'), read('frontend/js/viewer.js'), stubs].join('\n;\n'));

let failures = 0;
const check = (name, cond, extra) => {
    if (cond) console.log('  PASS  ' + name);
    else { console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + extra : '')); failures++; }
};

const V = w.StoryViewer;

V._data = {
    story: {
        id: 1,
        settings: {
            participatory_enabled: true,
            participatory_categories: ['Verde pubblico', 'Rischio" onmouseover="alert(1)'],
        },
    },
};
V._slides = [
    { id: 1, layout: 'cover', title: 'Copertina' },
    { id: 2, layout: 'side-left', title: 'Con mappa' },
    { id: 3, layout: 'text-only', title: 'Senza mappa' },
];

// ── Placing markers ──
console.log('\nContribution markers');

V._contributions = [
    { id: 1, lng: 12.4, lat: 41.9, title: 'Normale', created_at: '2026-01-01' },
    { id: 2, lng: 0, lat: 0, title: 'Meridiano di Greenwich', created_at: '2026-01-01' },
    { id: 3, lng: 9, lat: 45, title: 'Con foto', created_at: '2026-01-01' },
];
V._map = { on() {}, off() {} };
w.placed = [];
V._renderContributionMarkers();

// A truthiness test drops a point at lng 0 or lat 0 — Greenwich and the equator
// are real places, and this is a feature about placing points on real places.
check('a contribution at 0,0 is still placed', w.placed.length === 3, w.placed.length + ' of 3');
check('the null island point keeps its coordinates',
    w.placed.some(p => p.ll[0] === 0 && p.ll[1] === 0),
    JSON.stringify(w.placed.map(p => p.ll)));

// The renderer set a data-category attribute that no stylesheet ever read, so a
// map of four categories drew four identical red pins.
console.log('\nTelling categories apart');

V._contributions = [
    { id: 1, lng: 11.34, lat: 44.49, title: 'A', category: 'Verde pubblico', created_at: '2026-01-01' },
    { id: 2, lng: 11.35, lat: 44.50, title: 'B', category: 'Rischio" onmouseover="alert(1)', created_at: '2026-01-01' },
    { id: 3, lng: 11.36, lat: 44.51, title: 'C', created_at: '2026-01-01' },
];
w.placed = [];
V._renderContributionMarkers();
const classOf = i => (w.placed[i].el.className || '');
check('the first category gets its own colour class', /tm-cat-0\b/.test(classOf(0)), classOf(0));
check('a second category gets a different one', /tm-cat-1\b/.test(classOf(1)), classOf(1));
check('an uncategorised contribution stays on the default pin',
    !/tm-cat-/.test(classOf(2)), classOf(2));

const viewerCss = read('frontend/css/viewer.css');
for (let i = 0; i < 6; i++) {
    check('the stylesheet defines colour slot ' + i,
        new RegExp('\\.tm-contribution-marker\\.tm-cat-' + i + '\\b').test(viewerCss));
}

// A contribution with no usable coordinates is skipped rather than crashing
V._contributions = [{ id: 9, lng: null, lat: undefined, title: 'Rotto', created_at: '2026-01-01' }];
w.placed = [];
let threw = false;
try { V._renderContributionMarkers(); } catch (e) { threw = true; }
check('a contribution without coordinates is skipped, not thrown on', !threw && w.placed.length === 0);

// ── The popup ──
console.log('\nContribution popup');

// media_url ends in an extension the uploader chose. It used to be spliced into
// an inline onclick, so a filename could run script for every reader.
const popup = V._buildContributionPopup({
    id: 3, lng: 9, lat: 45, title: 'Con foto',
    media_type: 'image',
    media_url: "/uploads/media/images/ab.jpg');alert(1)//",
    category: 'Rischio" onmouseover="alert(1)',
    created_at: '2026-01-01',
});
check('the image popup carries no inline handler', !/onclick=/.test(popup),
    (popup.match(/<img[^>]*>|<a[^>]*>/g) || []).join(' '));
check('a quote in the media URL cannot close the attribute',
    !popup.includes("');alert(1)//'") && !popup.includes(`');alert(1)//"`));
check('the full image still opens in a new tab',
    /<a href="[^"]*" target="_blank" rel="noopener noreferrer">/.test(popup));
check('a quote in the category cannot open an attribute',
    !/<span[^>]+onmouseover/.test(popup));

// ── The submission form ──
console.log('\nSubmission form');

w.popupHtml = null;
V._showContributionForm(12.4, 41.9);
const form = w.popupHtml || '';
check('category names are escaped into the option list',
    !/<option value="Rischio" onmouseover=/.test(form),
    (form.match(/<option value="Rischio[^<]*<\/option>/) || ['n/d'])[0]);
check('the harmless category still reaches the list', form.includes('Verde pubblico'));

// ── The contribute button ──
console.log('\nContribute button');

// The map sits behind an opaque panel on cover and text-only slides, so telling
// the reader to "click on the map" there asks for something they cannot do.
const btn = w.document.createElement('button');
btn.id = 'tm-contribute-btn';
w.document.getElementById('story-viewer').appendChild(btn);

V._syncContributeButton(V._slides[1]);
check('the button shows on a slide that has a map', btn.style.display !== 'none', btn.style.display);
V._syncContributeButton(V._slides[2]);
check('the button hides on a text-only slide', btn.style.display === 'none', btn.style.display);
V._syncContributeButton(V._slides[0]);
check('the button hides on the cover', btn.style.display === 'none', btn.style.display);

// Starting the mode on a mapless slide should say so rather than wait forever
V._currentSlide = 2;
V._contributionMode = false;
w.toasts = [];
V._startContributionMode();
check('asking to contribute from a mapless slide explains why it cannot',
    V._contributionMode === false && w.toasts.length === 1, JSON.stringify(w.toasts));

// And on a map slide it arms, then disarms cleanly on Escape
V._currentSlide = 1;
let onCount = 0, offCount = 0;
V._map = { on: () => { onCount++; }, off: () => { offCount++; } };
V._startContributionMode();
check('the mode arms on a map slide', V._contributionMode === true && onCount === 1);
const esc = new w.KeyboardEvent('keydown', { key: 'Escape' });
w.document.dispatchEvent(esc);
check('Escape leaves no click handler behind', V._contributionMode === false && offCount === 1);

// ── The upload path on the server ──
console.log('\nServer-side upload hardening');

// Contributions are the most open upload in the app: any logged-in reader can
// post one. It was the only upload route not sanitising the extension.
const contribPy = read('backend/routers/contributions.py');
check('the contributions route sanitises the uploaded extension',
    /safe_extension\(/.test(contribPy));
check('it no longer takes the raw extension from the filename',
    !/os\.path\.splitext\(file\.filename\)/.test(contribPy));

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL PARTICIPATORY CHECKS PASSED'));
process.exit(failures ? 1 : 0);
