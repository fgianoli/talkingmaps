/**
 * Layers must survive being added before the map style has loaded.
 *
 * MapLibre returns the Map object immediately but refuses addSource/addLayer until
 * the style is ready, so a story that adds its layers straight after init() lost
 * them silently — the layer never appeared and anything keyed to it (visibility,
 * the temporal filter) had nothing to attach to.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO = path.resolve(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');

const dom = new JSDOM('<!doctype html><html><body><div id="viewer-map"></div></body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.org/' });
const w = dom.window;

let failures = 0;
const check = (name, cond, extra) => {
    if (cond) console.log('  PASS  ' + name);
    else { console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + extra : '')); failures++; }
};

// A MapLibre stand-in that behaves like the real one: it throws on addSource until
// the style has loaded, and emits "styledata" when it does.
const stub = `
class FakeMap {
    constructor() {
        this._styleLoaded = false;
        this._once = {};
        this._on = {};
        this.sources = {};
        this.layers = {};
        this.filters = {};
        this.layout = {};
    }
    isStyleLoaded() { return this._styleLoaded; }
    once(event, cb) { (this._once[event] = this._once[event] || []).push(cb); }
    on(event, cb) { (this._on[event] = this._on[event] || []).push(cb); }
    off(event, cb) {
        this._on[event] = (this._on[event] || []).filter(f => f !== cb);
        this._once[event] = (this._once[event] || []).filter(f => f !== cb);
    }
    fire(event) {
        const onceList = this._once[event] || [];
        this._once[event] = [];
        [...onceList, ...(this._on[event] || [])].forEach(cb => cb());
    }
    finishLoading() { this._styleLoaded = true; this.fire('styledata'); }
    _assertLoaded(what) {
        if (!this._styleLoaded) throw new Error('Style is not done loading (' + what + ')');
    }
    addSource(id, cfg) { this._assertLoaded('addSource'); this.sources[id] = cfg; }
    getSource(id) { return this.sources[id]; }
    addLayer(def) { this._assertLoaded('addLayer'); this.layers[def.id] = def; }
    getLayer(id) { return this.layers[id]; }
    removeLayer(id) { delete this.layers[id]; }
    removeSource(id) { delete this.sources[id]; }
    setFilter(id, f) { this.filters[id] = f; }
    getFilter(id) { return this.filters[id] || null; }
    setLayoutProperty(id, prop, val) { (this.layout[id] = this.layout[id] || {})[prop] = val; }
    setPaintProperty() {}
    addControl() {}
    getCenter() { return { lng: 0, lat: 0 }; }
    getZoom() { return 5; }
    getBearing() { return 0; }
    getPitch() { return 0; }
    getContainer() { return document.getElementById('viewer-map'); }
    getStyle() { this._assertLoaded('getStyle'); return { layers: [], sources: {} }; }
    setStyle() {}
    remove() {}
    resize() {}
    flyTo() {} easeTo() {} jumpTo() {} fitBounds() {}
}
window.__FakeMap = FakeMap;
window.maplibregl = {
    Map: FakeMap,
    NavigationControl: class {},
    ScaleControl: class {},
    Marker: class { setLngLat() { return this; } addTo() { return this; } remove() {} },
    Popup: class { setHTML() { return this; } setLngLat() { return this; } },
};
window.TmMap = TmMap;
`;

w.eval([read('frontend/js/map.js'), stub].join('\n;\n'));

const TmMap = w.TmMap;
const layerConfig = {
    id: 7,
    layer_type: 'geojson',
    source_config: { data: { type: 'FeatureCollection', features: [] } },
    style_config: { type: 'circle', paint: { 'circle-radius': 8, 'circle-color': '#1b6b7a' } },
};

console.log('\nAdding a layer before the style has loaded');
TmMap.init('viewer-map', { basemaps: [] });
const map = TmMap.getMap();
check('map created, style not loaded yet', map.isStyleLoaded() === false);

let threw = null;
try { TmMap.addLayer(layerConfig); } catch (e) { threw = e.message; }
check('addLayer does not throw', threw === null, threw);
check('and nothing was added yet', Object.keys(map.layers).length === 0);

map.finishLoading();
check('the layer arrives once the style loads', !!map.getLayer('layer-7'),
    JSON.stringify(Object.keys(map.layers)));
check('with its source', !!map.getSource('layer-7'));
check('and the id map is populated', TmMap._layerIdMap[7] === 'layer-7', JSON.stringify(TmMap._layerIdMap));

console.log('\nOnce loaded, adding is immediate');
TmMap.addLayer({ ...layerConfig, id: 8 });
check('no deferral needed', !!map.getLayer('layer-8'));

console.log('\nwhenReady');
const order = [];
TmMap._map = new w.__FakeMap();
TmMap.whenReady(() => order.push('deferred'));
check('callback held while loading', order.length === 0);
TmMap._map.finishLoading();
check('callback ran on load', order.join() === 'deferred');
TmMap.whenReady(() => order.push('immediate'));
check('callback runs at once when already loaded', order.join() === 'deferred,immediate');

console.log('\nThe temporal filter can attach to a deferred layer');
TmMap._map = new w.__FakeMap();
TmMap._layerIdMap = {};
TmMap._timeFilterBase = {};
TmMap.addLayer(layerConfig);
TmMap._map.finishLoading();
TmMap.setLayerTimeFilter(7, ['all', ['has', 'anno'], ['<=', ['to-number', ['get', 'anno'], 1e15], 2020]]);
const applied = TmMap._map.getFilter('layer-7');
check('filter applied to the real layer', Array.isArray(applied) && applied[0] === 'all',
    JSON.stringify(applied));
TmMap.clearLayerTimeFilter(7);
check('and restored on clear', TmMap._map.getFilter('layer-7') === null,
    JSON.stringify(TmMap._map.getFilter('layer-7')));


// ── Basemap churn ──────────────────────────────────────
// setStyle() rebuilds the style and briefly removes every story layer. The viewer
// asks for a basemap on each slide, so doing it unconditionally wiped the layers on
// every scroll and left the temporal filter with nothing to attach to.
console.log('\nsetBasemap only rebuilds when the basemap changes');
TmMap._map = new w.__FakeMap();
TmMap._layerIdMap = {};
TmMap._timeFilterBase = {};
TmMap._currentBasemapKey = TmMap._basemapKey({ id: 1, name: 'Streets' }, false);
TmMap._map.finishLoading();

let styleRebuilds = 0;
TmMap._map.setStyle = () => { styleRebuilds++; };

TmMap.setBasemap({ id: 1, name: 'Streets' });
check('asking for the basemap already shown does nothing', styleRebuilds === 0, String(styleRebuilds));
TmMap.setBasemap({ id: 1, name: 'Streets' });
TmMap.setBasemap({ id: 1, name: 'Streets' });
check('and repeating it still does nothing', styleRebuilds === 0, String(styleRebuilds));

TmMap.setBasemap({ id: 2, name: 'Satellite' });
check('a different basemap does rebuild', styleRebuilds === 1, String(styleRebuilds));
check('the new one is remembered', TmMap._currentBasemapKey === '2', TmMap._currentBasemapKey);
TmMap.setBasemap({ id: 2, name: 'Satellite' });
check('and is then skipped in turn', styleRebuilds === 1, String(styleRebuilds));

TmMap.setBasemap(null, true);
check('"no background" counts as its own basemap', styleRebuilds === 2 && TmMap._currentBasemapKey === 'none',
    TmMap._currentBasemapKey);

console.log('\nA time filter waits for a layer the style has not rebuilt yet');
TmMap._map = new w.__FakeMap();
TmMap._layerIdMap = {};
TmMap._timeFilterBase = {};
TmMap.addLayer(layerConfig);
TmMap._map.finishLoading();
check('layer present', !!TmMap._map.getLayer('layer-7'));
TmMap._map.removeLayer('layer-7');          // as a setStyle would, mid-rebuild
TmMap._map._styleLoaded = false;
TmMap.setLayerTimeFilter(7, ['all', ['has', 'anno']]);
check('the filter is not lost while the layer is missing', TmMap._map.getFilter('layer-7') === null);
TmMap._map.addLayerRaw = TmMap._map.addLayer;
TmMap._map._styleLoaded = true;
TmMap._map.layers['layer-7'] = { id: 'layer-7', type: 'circle' };
TmMap._map.fire('styledata');
check('and lands once the layer is back', Array.isArray(TmMap._map.getFilter('layer-7')),
    JSON.stringify(TmMap._map.getFilter('layer-7')));

// A styledata that arrives while the style is still settling must not strand the
// callback. whenReady used a one-shot listener, so when the first event found
// isStyleLoaded() still false it re-armed for one that never came — and the first
// slide never activated, leaving its reveal-words title hidden behind its mask.
console.log('\nwhenReady survives a premature styledata');
TmMap._map = new w.__FakeMap();
let ran = 0;
TmMap.whenReady(() => ran++);
TmMap._map.fire('styledata');            // style still loading
check('a premature event does not fire the callback', ran === 0, String(ran));
TmMap._map.fire('styledata');            // and again, still loading
check('nor does a second one', ran === 0, String(ran));
TmMap._map._styleLoaded = true;
TmMap._map.fire('styledata');
check('it runs once the style is genuinely ready', ran === 1, String(ran));
TmMap._map.fire('styledata');
check('and only once', ran === 1, String(ran));

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL MAP TIMING CHECKS PASSED'));
process.exit(failures ? 1 : 0);
