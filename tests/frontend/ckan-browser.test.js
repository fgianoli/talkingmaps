/**
 * The CKAN browser: the interface that was missing while four backend endpoints
 * sat there working and unreachable.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO = path.resolve(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');

const dom = new JSDOM('<!doctype html><html><body><div id="editor-props-body"></div></body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.org/' });
const w = dom.window;

const HOSTILE = '" onmouseover="window.__XSS=1" x="';

const stubs = `
const noop = (own) => new Proxy(own, { get: (t, p) => (p in t ? t[p] : () => {}) });
window.TmMap = noop({ getMap: () => null, getState: () => ({}), getDrawFeatures: () => null });
window.TmCharts = noop({}); window.TmGallery = noop({}); window.Cesium3D = noop({});
window.PotreeViewer = noop({}); window.UndoManager = noop({ push(){}, canUndo:()=>false, canRedo:()=>false });
window.StoryViewer = noop({}); window.DOMPurify = { sanitize: x => String(x ?? '') };
window.bootstrap = { Modal: class { constructor(){} show(){} hide(){} static getInstance(){ return null; } } };
window.__calls = { search: [], resource: [], import: [], addToStory: [] };
window.__modalOpts = null;
window.__modalAnswer = null;
window.Api = noop({
    ckanPortals: async () => window.__portals,
    ckanSearch: async (...a) => { window.__calls.search.push(a); return window.__searchResult; },
    ckanResource: async (...a) => { window.__calls.resource.push(a); return window.__resource; },
    ckanImportAsLayer: async (body) => { window.__calls.import.push(body); return window.__importResult; },
    listLayers: async () => [],
    isLoggedIn: () => true,
});
window.I18n = I18n; window.App = App; App.init = () => {}; App.toast = () => {};
App.modal = async (opts) => {
    window.__modalOpts = opts;
    document.body.insertAdjacentHTML('beforeend', '<div id="tm-fake-modal">' + opts.body + '</div>');
    const answer = window.__modalAnswer === 'cancel' ? null : opts.onConfirm();
    document.getElementById('tm-fake-modal').remove();
    return answer;
};
window.StoryEditor = StoryEditor;
I18n.init(); I18n.setLang('it');
`;

w.eval([read('frontend/js/i18n.js'), read('frontend/js/app.js'), read('frontend/js/animate.js'),
        read('frontend/js/compare-image.js'), read('frontend/js/viewer.js'),
        read('frontend/js/editor.js'), stubs].join('\n;\n'));

let failures = 0;
const check = (name, cond, extra) => {
    if (cond) console.log('  PASS  ' + name);
    else { console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + extra : '')); failures++; }
};
const E = w.StoryEditor;
const doc = w.document;

E._layers = [];
E._storyId = 1;
E._addLayerToStory = async (id) => { w.__calls.addToStory.push(id); };

w.__portals = [
    { id: 'dati.gov.it', url: 'https://dati.gov.it' },
    { id: 'dati.trentino', url: 'https://dati.trentino.it' },
];

(async () => {
    // ── The browser opens ──
    console.log('\n1. Opening the browser');
    await E._openCkanBrowser();
    const modal = doc.getElementById('ckan-modal');
    check('modal rendered', !!modal);
    const portalSel = doc.getElementById('ckan-portal');
    check('portals listed plus a custom entry', portalSel.options.length === 3, String(portalSel.options.length));
    check('first portal preselected', portalSel.value === 'https://dati.gov.it', portalSel.value);
    check('custom URL field hidden', doc.getElementById('ckan-custom-url').classList.contains('d-none'));

    portalSel.value = '__custom__';
    portalSel.dispatchEvent(new w.Event('change', { bubbles: true }));
    check('choosing "other" reveals the URL field', !doc.getElementById('ckan-custom-url').classList.contains('d-none'));
    doc.getElementById('ckan-custom-url').value = 'https://portale.example.org';
    check('the typed portal is the one queried', E._ckanPortalUrl() === 'https://portale.example.org', E._ckanPortalUrl());
    portalSel.value = 'https://dati.gov.it';
    portalSel.dispatchEvent(new w.Event('change', { bubbles: true }));

    // ── Searching ──
    console.log('\n2. Searching');
    w.__searchResult = {
        count: 2,
        datasets: [
            {
                id: 'a', title: HOSTILE, notes: HOSTILE, organization: 'Comune di ' + HOSTILE,
                resources: [
                    { id: 'r1', name: 'punti.geojson', format: 'GEOJSON', url: 'https://dati.gov.it/r1.geojson' },
                    { id: 'r2', name: 'tabella.csv', format: 'CSV', url: 'https://dati.gov.it/r2.csv' },
                    { id: 'r3', name: 'documento.pdf', format: 'PDF', url: 'https://dati.gov.it/r3.pdf' },
                ],
            },
            { id: 'b', title: 'Senza risorse', notes: '', organization: '', resources: [] },
        ],
    };
    doc.getElementById('ckan-query').value = 'ciclabili';
    doc.getElementById('ckan-format').value = 'GEOJSON';
    await E._ckanSearch();

    const call = w.__calls.search[0];
    check('search sent portal, query and format',
        call[0] === 'https://dati.gov.it' && call[1] === 'ciclabili' && call[2] === 'GEOJSON',
        JSON.stringify(call));

    const results = doc.getElementById('ckan-results');
    check('a dataset with no resources is not listed', !results.textContent.includes('Senza risorse'));
    const importBtns = results.querySelectorAll('.ckan-import');
    check('only importable formats get a button', importBtns.length === 2, String(importBtns.length));
    check('the PDF is marked as not importable', results.textContent.includes('non importabile'));
    check('a hostile title cannot inject',
        !results.querySelector('[onmouseover]') && !w.__XSS && results.textContent.includes(HOSTILE));

    // ── Importing GeoJSON ──
    console.log('\n3. Importing a GeoJSON resource');
    w.__importResult = { id: 42, type: 'geojson', features: 118 };
    const geoBtn = [...importBtns].find(b => b.dataset.format === 'GEOJSON');
    await E._ckanImport(geoBtn);
    check('import called once', w.__calls.import.length === 1);
    check('with the resource URL and format',
        w.__calls.import[0].url === 'https://dati.gov.it/r1.geojson' && w.__calls.import[0].format === 'GEOJSON',
        JSON.stringify(w.__calls.import[0]));
    check('no coordinate question for GeoJSON', w.__calls.resource.length === 0);
    check('the new layer is added to the story', w.__calls.addToStory[0] === 42, JSON.stringify(w.__calls.addToStory));

    // ── Importing CSV ──
    console.log('\n4. Importing a CSV asks for the coordinate columns');
    w.__resource = { columns: ['nome', 'indirizzo', 'latitudine', 'longitudine'], rows: [] };
    w.__importResult = { id: 43, type: 'geojson', features: 7 };
    const csvBtn = [...importBtns].find(b => b.dataset.format === 'CSV');
    await E._ckanImport(csvBtn);
    check('the CSV header was read first', w.__calls.resource.length === 1,
        JSON.stringify(w.__calls.resource));
    check('a dialog asked for the columns', !!w.__modalOpts && w.__modalOpts.body.includes('ckan-lat'));
    const body = w.__modalOpts.body;
    check('latitude column guessed from the header', /value="latitudine" selected/.test(body));
    check('longitude column guessed too', /value="longitudine" selected/.test(body));
    const csvImport = w.__calls.import[1];
    check('import carried the chosen fields',
        csvImport.lat_field === 'latitudine' && csvImport.lon_field === 'longitudine',
        JSON.stringify(csvImport));
    check('and the layer was added', w.__calls.addToStory[1] === 43);

    // ── Cancelling ──
    console.log('\n5. Cancelling the coordinate dialog');
    const before = w.__calls.import.length;
    w.__modalAnswer = 'cancel';
    await E._ckanImport(csvBtn);
    check('nothing is imported', w.__calls.import.length === before, String(w.__calls.import.length));
    w.__modalAnswer = null;

    // ── Empty results ──
    console.log('\n6. A search with nothing usable');
    w.__searchResult = { count: 0, datasets: [] };
    await E._ckanSearch();
    check('says so instead of showing an empty list',
        doc.getElementById('ckan-results').textContent.trim().length > 0
        && doc.getElementById('ckan-results').querySelectorAll('.ckan-import').length === 0);

    // ── Backend error ──
    console.log('\n7. The portal is unreachable');
    w.Api.ckanSearch = async () => { throw new Error('Errore connessione al portale'); };
    await E._ckanSearch();
    check('the error is shown, not swallowed',
        doc.getElementById('ckan-results').textContent.includes('Errore connessione'),
        doc.getElementById('ckan-results').textContent.slice(0, 60));

    console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL CKAN BROWSER CHECKS PASSED'));
    process.exit(failures ? 1 : 0);
})().catch(e => { console.error('THREW:', e.message); process.exit(1); });
