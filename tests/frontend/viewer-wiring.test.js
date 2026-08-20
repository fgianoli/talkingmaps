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
V._data = { story: { id: 1, title: 'Land at the Brink', settings: {} }, basemaps: [], layers: [], markers: [] };
V._slides = [
    {
        id: 1, layout: 'cover', title: 'Land at the Brink',
        narrative: '<p>An interactive investigation.</p>',
        style_overrides: { transition: 'reveal-words' },
    },
    {
        id: 2, layout: 'text-only', title: 'A Crisis Measured in Hectares',
        narrative: '<p>The numbers.</p>',
        style_overrides: {
            transition: 'stagger',
            stats: {
                items: [
                    { value: 332000000, label: 'Superficie degradata', suffix: ' km²', desc: 'Africa subsahariana' },
                    { value: 65, label: 'Terreni agricoli', suffix: '%' },
                    { value: 3.4, label: 'Perdite annue', prefix: '$', suffix: 'B', decimals: 1 },
                    { value: 34, label: 'Paesi colpiti' },
                ],
                columns: 4, duration: 0,
            },
        },
    },
    {
        id: 3, layout: 'text-only', title: '14 anni di cambiamento',
        narrative: '<p>Trascina la maniglia.</p>',
        style_overrides: {
            transition: 'fade',
            image_compare: {
                before_url: 'https://example.org/sahel-2010.jpg',
                after_url: 'https://example.org/sahel-2024.jpg',
                before_label: '2010', after_label: '2024', aspect: '16/9', start: 40,
            },
        },
    },
    { id: 4, layout: 'side-left', title: 'Plain slide', narrative: '<p>No extras.</p>', style_overrides: {} },
];

V._buildNarrative();

console.log('\nNarrative build');
const slideEls = w.document.querySelectorAll('.viewer-slide');
check('4 slides built', slideEls.length === 4, String(slideEls.length));
check('transition attr propagated', slideEls[0].dataset.transition === 'reveal-words', slideEls[0].dataset.transition);

console.log('\nWord reveal (slide 1)');
const w1 = slideEls[0].querySelectorAll('.tm-word-inner');
check('title split into 4 words', w1.length === 4, String(w1.length));
check('title text intact', slideEls[0].querySelector('h2').textContent === 'Land at the Brink',
    JSON.stringify(slideEls[0].querySelector('h2').textContent));
check('last word indexed', w1[3].style.getPropertyValue('--tm-i') === '3');

console.log('\nKey figures (slide 2)');
const statsWrap = slideEls[1].querySelector('.tm-stats');
check('stats grid rendered', !!statsWrap);
check('4 figures', slideEls[1].querySelectorAll('.tm-stat').length === 4);
const firstVal = slideEls[1].querySelector('.tm-stat-value');
check('renders at zero before activation', firstVal.textContent === '0 km²', JSON.stringify(firstVal.textContent));
check('target stored in dataset', firstVal.dataset.value === '332000000', firstVal.dataset.value);
check('stagger applied to children too', slideEls[1].querySelectorAll('.tm-stagger-item').length > 0);

console.log('\nImage comparison (slide 3)');
const cmp = slideEls[2].querySelector('.tm-imgcmp');
check('widget rendered', !!cmp);
check('inside its container', !!slideEls[2].querySelector('.slide-imgcmp-container .tm-imgcmp'));
check('start position honoured', cmp.style.getPropertyValue('--tm-imgcmp-pos') === '40%');
const imgs = [...cmp.querySelectorAll('img')].map(i => i.getAttribute('src'));
check('both images wired', imgs.length === 2 && imgs[0].endsWith('sahel-2010.jpg') && imgs[1].endsWith('sahel-2024.jpg'), imgs.join(' | '));
check('URLs normalised through _sanitizeUrl', imgs.every(u => u.startsWith('https://')), imgs.join(' | '));

console.log('\nControl slide (slide 4)');
check('no stats leaked', slideEls[3].querySelectorAll('.tm-stats').length === 0);
check('no comparison leaked', slideEls[3].querySelectorAll('.tm-imgcmp').length === 0);
check('no word split on fade slide', slideEls[3].querySelectorAll('.tm-word-inner').length === 0);

console.log('\nSlide activation triggers the count-up');
V._onSlideEnter(1);
check('animate-in class applied', slideEls[1].querySelector('.viewer-slide-content').classList.contains('slide-animate-in'));
check('stat timers scheduled', Array.isArray(slideEls[1]._tmStatTimers) && slideEls[1]._tmStatTimers.length === 4,
    String(slideEls[1]._tmStatTimers && slideEls[1]._tmStatTimers.length));

setTimeout(() => {
    const finals = [...slideEls[1].querySelectorAll('.tm-stat-value')].map(e => e.textContent);
    check('counters reached their targets', finals[0] === '332.000.000 km²' && finals[1] === '65%'
        && finals[2] === '$3,4B' && finals[3] === '34', finals.join(' | '));

    // Re-entering the slide must restart cleanly, not double-count
    V._onSlideEnter(1);
    setTimeout(() => {
        const again = [...slideEls[1].querySelectorAll('.tm-stat-value')].map(e => e.textContent);
        check('re-entry re-runs to the same values', again.join('|') === finals.join('|'), again.join(' | '));

        // Sanity: activating a slide with no stats must not throw
        let threw = false;
        try { V._onSlideEnter(3); } catch (e) { threw = true; console.log('    ' + e.message); }
        check('activating a plain slide is safe', !threw);

        console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL INTEGRATION CHECKS PASSED'));
        process.exit(failures ? 1 : 0);
    }, 800);
}, 800);
