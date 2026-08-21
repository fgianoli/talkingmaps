/**
 * Integration check: does StoryViewer actually wire the three new features
 * into the narrative it builds? Heavy deps (MapLibre, Cesium, Api) are stubbed.
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
    embedMode: false,
};
// Any method not explicitly defined becomes a no-op, so the viewer can run headless
const noopModule = (own) => new Proxy(own, { get: (t, p) => (p in t ? t[p] : () => {}) });
window.TmCharts = noopModule({});
window.TmGallery = noopModule({});
window.TmMap = noopModule({ getMap: () => null, getState: () => ({}), getDrawFeatures: () => null });
window.Cesium3D = noopModule({});
window.PotreeViewer = noopModule({});
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

// A story exercising all three features plus a control slide

// Every built-in template — and the five seeded system templates — write the
// heading into both slide.title and the narrative. Printing the title
// unconditionally therefore showed it twice on any story made from one.
V._data = { story: { id: 1, title: 'S', settings: {} }, basemaps: [], layers: [], markers: [] };
V._slides = [
    { id: 20, layout: 'cover', title: "Un giro d'Italia",
      narrative: "<h1>Un giro d'Italia</h1><p>Quattro città.</p>", style_overrides: {} },
    { id: 21, layout: 'text-only', title: 'Le cifre',
      narrative: '<h2>Quattro numeri</h2><p>Titolo e heading diversi.</p>', style_overrides: {} },
    { id: 22, layout: 'text-only', title: 'Solo titolo',
      narrative: '<p>Nessun heading qui.</p>', style_overrides: {} },
    { id: 23, layout: 'text-only', title: 'Prima e dopo',
      narrative: '<h2>Prima e dopo!</h2><p>Cambia solo la punteggiatura.</p>', style_overrides: {} },
    { id: 24, layout: 'text-only', title: 'Con markup',
      narrative: '<h2><em>Con</em> markup</h2><p>Heading con tag interni.</p>', style_overrides: {} },
    { id: 25, layout: 'text-only', title: 'Dopo un paragrafo',
      narrative: '<p>Intro.</p><h2>Dopo un paragrafo</h2>', style_overrides: {} },
];
V._buildNarrative();

const headings = (i) => [...w.document.querySelectorAll(
    `[data-slide-index="${i}"] h1, [data-slide-index="${i}"] h2`)].map(h => h.textContent.trim());

console.log('\nA title the narrative already carries is not printed twice');
const t0 = headings(0);
check('shown once, not twice', t0.filter(h => h === "Un giro d'Italia").length === 1, JSON.stringify(t0));
check('and the narrative keeps its own h1', t0.length === 1, JSON.stringify(t0));

console.log('\nEverything else still gets its title');
check('a different title is kept alongside the heading',
    headings(1).join('|') === 'Le cifre|Quattro numeri', JSON.stringify(headings(1)));
check('a narrative with no heading gets the title', headings(2).includes('Solo titolo'), JSON.stringify(headings(2)));
check('punctuation alone is not a difference', headings(3).length === 1, JSON.stringify(headings(3)));
check('a heading with inner markup is still recognised', headings(4).length === 1, JSON.stringify(headings(4)));
check('a heading further down still counts as the same title',
    headings(5).length === 1, JSON.stringify(headings(5)));

console.log('\nThe title survives where it is actually needed');
check('slide.title untouched on the model', V._slides[0].title === "Un giro d'Italia");

// The narrative container is reused between stories and keeps its scroll offset, so
// opening a second story after reading part of a first one started partway in — at
// whichever slide happened to sit at that pixel position.
console.log('\nBuilding a narrative resets the scroll position');
const narrative = w.document.getElementById('viewer-narrative');
narrative.scrollTop = 1400;
V._buildNarrative();
check('a rebuild returns the container to the top', narrative.scrollTop === 0, String(narrative.scrollTop));

// Every layout that shows a map has to say where its text card goes, or the card
// spreads across the middle and covers the map. image-map was the one that never
// did, and its whole point is a drawing you are meant to look at.
console.log('\nEvery map layout positions its card');
const cssRaw = read('frontend/css/viewer.css');
const css = cssRaw.replace(/@media[^{]*{(?:[^{}]|{[^{}]*})*}/g, '');
const MAP_LAYOUTS = ['side-left', 'side-right', 'center', 'full-map', 'image-map', 'globe-3d', 'potree-3d'];
for (const layout of MAP_LAYOUTS) {
    const rule = new RegExp('\\.slide-layout-' + layout + '[\\s,][^{]*\\{[^}]*' +
        '(width|max-width|position|display|justify-content)', 'm');
    check(layout + ' has positioning of its own', rule.test(css));
}

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL SLIDE TITLE CHECKS PASSED'));
process.exit(failures ? 1 : 0);
