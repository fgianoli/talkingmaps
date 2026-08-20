/**
 * Editor round-trip: does the props panel render the new sections, and does
 * autosave collect them back into style_overrides in the shape the viewer expects?
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO = path.resolve(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');

const dom = new JSDOM('<!doctype html><html><body><div id="editor-props-body"></div></body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.org/' });
const w = dom.window;

let savedPayload = null;
const stubs = `
const noopModule = (own) => new Proxy(own, { get: (t, p) => (p in t ? t[p] : () => {}) });
window.App = {
    escHtml: s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    sanitize: s => s, toast(){}, escHtmlAttr: s => s,
};
window.TmMap = noopModule({ getMap: () => null, getState: () => ({}), getDrawFeatures: () => null });
window.TmCharts = noopModule({});
window.Cesium3D = noopModule({});
window.PotreeViewer = noopModule({});
window.UndoStack = noopModule({});
window.Api = {
    updateSlide: async (id, updates) => { window.__saved = { id, updates }; return updates; },
};
window.I18n = I18n;
window.StoryEditor = StoryEditor;
I18n.init(); I18n.setLang('it');
`;

w.eval([read('frontend/js/i18n.js'), read('frontend/js/editor.js'), stubs].join('\n;\n'));

let failures = 0;
const check = (name, cond, extra) => {
    if (cond) console.log('  PASS  ' + name);
    else { console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + extra : '')); failures++; }
};

const E = w.StoryEditor;
const slide = {
    id: 7, layout: 'text-only', title: 'A Crisis Measured in Hectares',
    narrative: '<p>Body</p>', visible: true,
    style_overrides: {
        transition: 'stagger',
        stats: {
            items: [
                { value: 332000000, label: 'Superficie degradata', suffix: ' km²', desc: 'Africa subsahariana', prefix: '', decimals: 0 },
                { value: 3.4, label: 'Perdite annue', prefix: '$', suffix: 'B', decimals: 1, desc: '' },
            ],
            columns: 2, duration: 2400,
        },
        image_compare: {
            before_url: 'https://example.org/a.jpg', after_url: 'https://example.org/b.jpg',
            before_label: '2010', after_label: '2024', aspect: '4/3', start: 35,
        },
    },
};
E._slides = [slide];
E._currentSlideIdx = 0;
E._story = { id: 1, settings: { theme: 'dark' } };
E._data = { basemaps: [{ id: 1, name: 'Streets' }] };
E._storyId = 1;

E._renderProps(slide);

console.log('\nProps panel renders the new sections');
const doc = w.document;
check('key figures section present', !!doc.getElementById('stats-items-list'));
check('2 stat rows rendered', doc.querySelectorAll('.stat-item').length === 2, String(doc.querySelectorAll('.stat-item').length));
check('value prefilled', doc.querySelector('.stat-value').value === '332000000', doc.querySelector('.stat-value').value);
check('suffix prefilled', doc.querySelector('.stat-suffix').value === ' km²', JSON.stringify(doc.querySelector('.stat-suffix').value));
check('columns prefilled', doc.getElementById('prop-stats-columns').value === '2');
check('duration prefilled', doc.getElementById('prop-stats-duration').value === '2400');
check('image compare before URL', doc.getElementById('prop-imgcmp-before').value === 'https://example.org/a.jpg');
check('image compare after label', doc.getElementById('prop-imgcmp-after-label').value === '2024');
check('aspect prefilled', doc.getElementById('prop-imgcmp-aspect').value === '4/3');
check('start prefilled', doc.getElementById('prop-imgcmp-start').value === '35');

console.log('\nTransition select');
const tsel = doc.getElementById('prop-transition');
const opts = [...tsel.options].map(o => o.value);
check('new transitions offered', opts.includes('reveal-words') && opts.includes('stagger'), opts.join(','));
check('current value selected', tsel.value === 'stagger', tsel.value);
check('labels localized (it)', [...tsel.options].find(o => o.value === 'reveal-words').textContent === 'Parole a comparsa',
    [...tsel.options].find(o => o.value === 'reveal-words').textContent);

console.log('\nEdit in the panel, then autosave');
// Simulate the user editing fields
doc.querySelectorAll('.stat-item')[1].querySelector('.stat-value').value = '4.8';
doc.querySelectorAll('.stat-item')[1].querySelector('.stat-label').value = 'Perdite riviste';
doc.getElementById('prop-stats-columns').value = '4';
doc.getElementById('prop-stats-duration').value = '0';
doc.getElementById('prop-imgcmp-start').value = '0';
doc.getElementById('prop-imgcmp-after-label').value = '2025';
tsel.value = 'reveal-words';

E._saveCurrentSlideProps().then(() => {
    const saved = w.__saved;
    check('updateSlide called', !!saved && saved.id === 7);
    const so = saved.updates.style_overrides;
    check('transition saved', so.transition === 'reveal-words', so.transition);
    check('2 stats saved', so.stats.items.length === 2, String(so.stats.items.length));
    check('edited value parsed as number', so.stats.items[1].value === 4.8, JSON.stringify(so.stats.items[1].value));
    check('edited label saved', so.stats.items[1].label === 'Perdite riviste', so.stats.items[1].label);
    check('untouched item preserved', so.stats.items[0].value === 332000000 && so.stats.items[0].suffix === ' km²');
    check('decimals preserved', so.stats.items[1].decimals === 1, String(so.stats.items[1].decimals));
    check('columns saved', so.stats.columns === 4, String(so.stats.columns));
    check('duration 0 is not overwritten by the default', so.stats.duration === 0, String(so.stats.duration));
    check('image compare saved', !!so.image_compare);
    check('start 0 is not overwritten by the default', so.image_compare.start === 0, String(so.image_compare.start));
    check('label edit saved', so.image_compare.after_label === '2025', so.image_compare.after_label);
    check('aspect saved', so.image_compare.aspect === '4/3', so.image_compare.aspect);

    // Clearing one URL must drop the whole block, not save a half-configured widget
    console.log('\nClearing the "after" image disables the comparison');
    doc.getElementById('prop-imgcmp-after').value = '';
    return E._saveCurrentSlideProps().then(() => {
        check('image_compare nulled', w.__saved.updates.style_overrides.image_compare === null,
            JSON.stringify(w.__saved.updates.style_overrides.image_compare));
        check('stats untouched by that', w.__saved.updates.style_overrides.stats.items.length === 2);

        console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL EDITOR ROUND-TRIP CHECKS PASSED'));
        process.exit(failures ? 1 : 0);
    });
}).catch(e => { console.error('THREW:', e); process.exit(1); });
