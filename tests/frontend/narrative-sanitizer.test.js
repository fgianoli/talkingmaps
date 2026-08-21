/**
 * The narrative sanitizer must keep the attributes the viewer reads back.
 *
 * App.sanitize ran DOMPurify with ALLOW_DATA_ATTR: false and an allowlist that
 * named no data attribute, so it stripped data-tm-link from hotspot links and
 * data-lat/lng/zoom from embedded express maps. The markup survived and looked
 * right; the information it carried was gone, and both features did nothing.
 *
 * Run against the real DOMPurify, because the whole bug was an assumption about
 * how its options interact.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');

const REPO = path.resolve(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');

const dom = new JSDOM('<!doctype html><html><body></body></html>',
    { runScripts: 'outside-only', url: 'https://example.org/' });
const w = dom.window;
w.DOMPurify = createDOMPurify(w);
w.eval(read('frontend/js/app.js') + '\n;window.App = App; App.init = () => {};');

let failures = 0;
const check = (name, cond, extra) => {
    if (cond) console.log('  PASS  ' + name);
    else { console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + extra : '')); failures++; }
};
const App = w.App;
const parse = html => { const d = w.document.createElement('div'); d.innerHTML = html; return d; };

console.log('\nHotspot links keep their target');
const link = '<p>Il <a href="#" class="tm-map-link" data-tm-link="marker:42" data-lng="12.49" data-lat="41.89">Foro</a> era il centro.</p>';
const cleanLink = parse(App.sanitize(link));
const a = cleanLink.querySelector('a');
check('the link survives', !!a);
check('data-tm-link survives', a.getAttribute('data-tm-link') === 'marker:42', a.getAttribute('data-tm-link'));
check('the viewer selector finds it', !!cleanLink.querySelector('[data-tm-link]'));
check('coordinates survive', a.getAttribute('data-lat') === '41.89' && a.getAttribute('data-lng') === '12.49');

console.log('\nExpress maps keep their coordinates');
const emap = '<div class="express-map" data-lat="41.7554" data-lng="12.2911" data-zoom="14" data-marker="true" data-size="medium"></div>';
const cleanMap = parse(App.sanitize(emap));
const el = cleanMap.querySelector('.express-map');
check('the container survives', !!el);
check('lat survives', el.dataset.lat === '41.7554', el.dataset.lat);
check('lng survives', el.dataset.lng === '12.2911', el.dataset.lng);
check('zoom survives', el.dataset.zoom === '14', el.dataset.zoom);
check('marker flag survives', el.dataset.marker === 'true', el.dataset.marker);
check('size survives', el.dataset.size === 'medium', el.dataset.size);
// What _initExpressMap actually computes from them
check('parses to real coordinates, not 0,0',
    parseFloat(el.dataset.lat) === 41.7554 && parseFloat(el.dataset.lng) === 12.2911);

console.log('\nEverything dangerous is still removed');
const nasty = [
    ['<script>window.__X=1</script><p>ciao</p>', 'script'],
    ['<p onclick="window.__X=1">ciao</p>', '[onclick]'],
    ['<img src=x onerror="window.__X=1">', '[onerror]'],
    ['<iframe src="https://evil.example"></iframe>', 'iframe'],
    ['<p data-evil="1">ciao</p>', '[data-evil]'],
    ['<a href="javascript:window.__X=1">click</a>', '[href^="javascript"]'],
];
for (const [html, selector] of nasty) {
    const out = parse(App.sanitize(html));
    check(`${selector} is stripped`, !out.querySelector(selector), App.sanitize(html).slice(0, 60));
}
check('no arbitrary data attribute slips through',
    !parse(App.sanitize('<p data-anything="1">x</p>')).querySelector('[data-anything]'));
check('nothing executed', !w.__X);

console.log('\nOrdinary formatting is untouched');
const rich = '<h2>Titolo</h2><p><strong>grassetto</strong> e <em>corsivo</em></p><ul><li>uno</li></ul>';
check('headings, emphasis and lists survive', App.sanitize(rich) === rich, App.sanitize(rich));

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL SANITIZER CHECKS PASSED'));
process.exit(failures ? 1 : 0);
