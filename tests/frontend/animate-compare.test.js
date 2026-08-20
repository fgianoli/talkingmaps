const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO = path.resolve(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://example.org/',
});
const w = dom.window;

// Minimal stand-ins for what the modules touch
const exposeGlobals = 'window.I18n = I18n; window.TmAnimate = TmAnimate; window.TmImageCompare = TmImageCompare; I18n.init(); I18n.setLang("it");';
w.eval([
    read('frontend/js/i18n.js'),
    read('frontend/js/animate.js'),
    read('frontend/js/compare-image.js'),
    exposeGlobals,
].join('\n;\n'));

let failures = 0;
const check = (name, cond, extra) => {
    if (cond) console.log('  PASS  ' + name);
    else { console.log('  FAIL  ' + name + (extra ? ' -> ' + extra : '')); failures++; }
};

// ── TmAnimate.renderStats ──
console.log('\nTmAnimate.renderStats');
const root = w.document.getElementById('root');
const ok = w.TmAnimate.renderStats(root, {
    items: [
        { value: 332000000, label: 'Degraded land', suffix: ' km²', desc: 'sub-Saharan Africa' },
        { value: 3.4, label: 'GDP loss', prefix: '$', suffix: 'B', decimals: 1 },
        { value: 0, label: 'Zero is valid' },
    ],
    columns: 3,
    duration: 400,
});
check('returns true', ok === true);
const wrap = root.querySelector('.tm-stats');
check('grid rendered', !!wrap);
check('column var set', wrap.style.getPropertyValue('--tm-stats-cols') === '3', wrap.style.cssText);
const vals = root.querySelectorAll('.tm-stat-value');
check('3 stats rendered', vals.length === 3, String(vals.length));
check('starts at zero (it locale)', vals[0].textContent === '0 km²', JSON.stringify(vals[0].textContent));
check('decimals honoured at zero', vals[1].textContent === '$0,0B', JSON.stringify(vals[1].textContent));
check('desc rendered', root.querySelectorAll('.tm-stat-desc').length === 1);
check('empty items -> false', w.TmAnimate.renderStats(root, { items: [] }) === false);
check('null config -> false', w.TmAnimate.renderStats(root, null) === false);

// ── countUp ──
console.log('\nTmAnimate.countUp');
const target = w.document.createElement('div');
w.TmAnimate.countUp(target, { value: 100, duration: 0, decimals: 0 });
check('duration 0 jumps to target', target.textContent === '100', JSON.stringify(target.textContent));
w.TmAnimate.countUp(target, { value: 1234567, duration: 0, suffix: ' ha' });
check('thousands separator (it)', target.textContent === '1.234.567 ha', JSON.stringify(target.textContent));
w.TmAnimate.countUp(target, { value: 'n/a', duration: 0, prefix: '~' });
check('non-numeric passes through', target.textContent === '~n/a', JSON.stringify(target.textContent));

// animated run reaches the target
const animEl = w.document.createElement('div');
w.TmAnimate.countUp(animEl, { value: 50, duration: 60 });
check('animation starts below target', animEl.textContent === '0', JSON.stringify(animEl.textContent));

// ── runStats ──
console.log('\nTmAnimate.runStats');
const scope = w.document.createElement('div');
w.TmAnimate.renderStats(scope, { items: [{ value: 42, label: 'x' }], duration: 0 });
w.TmAnimate.runStats(scope);
check('timers tracked', Array.isArray(scope._tmStatTimers) && scope._tmStatTimers.length === 1);
w.TmAnimate.runStats(scope); // second entrance must not throw
check('re-entry safe', true);

// ── prepareText ──
console.log('\nTmAnimate.prepareText');
const c1 = w.document.createElement('div');
c1.innerHTML = '<h2>Land at the Brink</h2><p>Body</p>';
w.TmAnimate.prepareText(c1, 'reveal-words');
const words = c1.querySelectorAll('.tm-word-inner');
check('4 words split', words.length === 4, String(words.length));
check('word index var', words[2].style.getPropertyValue('--tm-i') === '2');
check('text preserved', c1.querySelector('h2').textContent === 'Land at the Brink', JSON.stringify(c1.querySelector('h2').textContent));
w.TmAnimate.prepareText(c1, 'reveal-words');
check('idempotent', c1.querySelectorAll('.tm-word-inner').length === 4);

const c2 = w.document.createElement('div');
c2.innerHTML = '<h2>Title <em>with markup</em></h2>';
w.TmAnimate.prepareText(c2, 'reveal-words');
check('heading with markup untouched', c2.querySelectorAll('.tm-word-inner').length === 0 && !!c2.querySelector('em'));

const c3 = w.document.createElement('div');
c3.innerHTML = '<h2>T</h2><p>a</p><p>b</p>';
w.TmAnimate.prepareText(c3, 'stagger');
const items = c3.querySelectorAll('.tm-stagger-item');
check('3 stagger items', items.length === 3, String(items.length));
check('stagger index var', items[2].style.getPropertyValue('--tm-i') === '2');

const c4 = w.document.createElement('div');
c4.innerHTML = '<h2>Plain</h2>';
w.TmAnimate.prepareText(c4, 'fade');
check('other transitions are a no-op', c4.querySelectorAll('.tm-word-inner, .tm-stagger-item').length === 0);
w.TmAnimate.prepareText(null, 'stagger');
check('null container safe', true);

// ── TmImageCompare ──
console.log('\nTmImageCompare.render');
const cmpHost = w.document.createElement('div');
const widget = w.TmImageCompare.render(cmpHost, {
    before_url: 'https://example.org/a.jpg',
    after_url: 'https://example.org/b.jpg',
    before_label: '2010',
    after_label: '2024',
    aspect: '4/3',
    start: 30,
});
check('widget returned', !!widget);
check('two images', cmpHost.querySelectorAll('img.tm-imgcmp-img').length === 2);
check('after wrapper', !!cmpHost.querySelector('.tm-imgcmp-after'));
check('start position', widget.style.getPropertyValue('--tm-imgcmp-pos') === '30%');
check('aspect applied', widget.style.aspectRatio === '4/3', widget.style.aspectRatio);
check('labels', cmpHost.querySelector('.tm-imgcmp-label-left').textContent === '2010'
    && cmpHost.querySelector('.tm-imgcmp-label-right').textContent === '2024');
const div = cmpHost.querySelector('.tm-imgcmp-divider');
check('slider a11y', div.getAttribute('role') === 'slider' && div.getAttribute('aria-valuenow') === '30');
check('localized aria-label', div.getAttribute('aria-label') === w.I18n.t('viewer.compare_drag'), div.getAttribute('aria-label'));

// keyboard
const key = (k, shift) => div.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, shiftKey: !!shift, bubbles: true, cancelable: true }));
key('ArrowRight');
check('ArrowRight nudges +2', widget.style.getPropertyValue('--tm-imgcmp-pos') === '32%', widget.style.getPropertyValue('--tm-imgcmp-pos'));
key('ArrowLeft', true);
check('Shift+ArrowLeft steps -10', widget.style.getPropertyValue('--tm-imgcmp-pos') === '22%', widget.style.getPropertyValue('--tm-imgcmp-pos'));
key('Home');
check('Home snaps to 0', widget.style.getPropertyValue('--tm-imgcmp-pos') === '0%');
key('End');
check('End snaps to 100', widget.style.getPropertyValue('--tm-imgcmp-pos') === '100%');
key('End');
check('clamped at 100', widget.style.getPropertyValue('--tm-imgcmp-pos') === '100%');
check('aria kept in sync', div.getAttribute('aria-valuenow') === '100');

check('missing after_url -> null', w.TmImageCompare.render(w.document.createElement('div'), { before_url: 'a.jpg' }) === null);
check('no container -> null', w.TmImageCompare.render(null, { before_url: 'a', after_url: 'b' }) === null);
const defWidget = w.TmImageCompare.render(w.document.createElement('div'), { before_url: 'a', after_url: 'b' });
check('default start 50%', defWidget.style.getPropertyValue('--tm-imgcmp-pos') === '50%');
check('no labels when unset', defWidget.querySelectorAll('.tm-imgcmp-label').length === 0);

// ── English locale formatting ──
console.log('\nLocale switch');
w.eval("I18n.setLang('en');");
const enEl = w.document.createElement('div');
w.TmAnimate.countUp(enEl, { value: 1234567.5, duration: 0, decimals: 1, suffix: ' km²' });
check('en formatting', enEl.textContent === '1,234,567.5 km²', JSON.stringify(enEl.textContent));

// ── async: animation completes ──
setTimeout(() => {
    console.log('\nAnimation completion');
    check('animated counter reached target', animEl.textContent === '50', JSON.stringify(animEl.textContent));
    console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL SMOKE TESTS PASSED'));
    process.exit(failures ? 1 : 0);
}, 400);
