/**
 * Tests for StoryViewer._initTimeline() / _initSlideAudio() and the
 * TmMap time-filter helpers they drive.
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
const noop = (own) => new Proxy(own, { get: (t, p) => (p in t ? t[p] : () => {}) });
window.App = {
    escHtml: s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    sanitize: s => s, toast(){}, embedMode: false,
};
window.calls = { setFilter: [], clearFilter: [] };
window.TmMap = noop({
    getMap: () => null, getState: () => ({}), getDrawFeatures: () => null,
    setLayerTimeFilter: (id, filter) => window.calls.setFilter.push({ id, filter }),
    clearLayerTimeFilter: (id) => window.calls.clearFilter.push(id),
});
window.TmCharts = noop({}); window.TmGallery = noop({});
window.Cesium3D = noop({}); window.PotreeViewer = noop({});
// jsdom has no media playback — model just enough of it
window.HTMLMediaElement.prototype.play = function () { this.__paused = false; this.dispatchEvent(new window.Event('play')); return Promise.resolve(); };
window.HTMLMediaElement.prototype.pause = function () { this.__paused = true; this.dispatchEvent(new window.Event('pause')); };
Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', { get() { return this.__paused !== false; } });
window.I18n = I18n; window.TmAnimate = TmAnimate; window.TmImageCompare = TmImageCompare;
window.StoryViewer = StoryViewer;
I18n.init(); I18n.setLang('en');
`;

w.eval([read('frontend/js/i18n.js'), read('frontend/js/animate.js'),
        read('frontend/js/compare-image.js'), read('frontend/js/viewer.js'), stubs].join('\n;\n'));

let failures = 0;
const check = (name, cond, extra) => {
    if (cond) console.log('  PASS  ' + name);
    else { console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + extra : '')); failures++; }
};
const V = w.StoryViewer;

// ── Step building ──
console.log('\n_buildTimelineSteps');
const years = V._buildTimelineSteps('2000', '2023');
check('numeric domain detected', years.numeric === true);
check('one step per year', years.values.length === 24, String(years.values.length));
check('first and last', years.values[0] === 2000 && years.values[23] === 2023);
check('labels are plain years', years.labels[5] === '2005', years.labels[5]);

const reversed = V._buildTimelineSteps('2023', '2000');
check('reversed range is normalised', reversed.values[0] === 2000 && reversed.values[23] === 2023);

const wide = V._buildTimelineSteps('0', '100000');
check('wide numeric range capped at 101 steps', wide.values.length === 101, String(wide.values.length));
check('wide range still ends on the target', wide.values[100] === 100000, String(wide.values[100]));

const single = V._buildTimelineSteps('2010', '2010');
check('degenerate range yields one step', single.values.length === 1 && single.values[0] === 2010,
    JSON.stringify(single.values));

const dates = V._buildTimelineSteps('2000-01-01', '2000-12-31');
check('date domain detected', dates.numeric === false);
check('61 date steps', dates.values.length === 61, String(dates.values.length));
check('cursor is a plain ISO date', /^\d{4}-\d{2}-\d{2}$/.test(dates.values[0]), dates.values[0]);
check('starts at the start date', dates.values[0] === '2000-01-01', dates.values[0]);
check('ends at the end date', dates.values[60] === '2000-12-31', dates.values[60]);

const sameDay = V._buildTimelineSteps('2020-05-01T00:00:00Z', '2020-05-01T23:00:00Z');
check('sub-day range keeps the time of day', /T\d{2}:\d{2}:\d{2}$/.test(sameDay.values[30]), sameDay.values[30]);

check('garbage input -> null', V._buildTimelineSteps('foo', 'bar') === null);
check('half-configured -> null', V._buildTimelineSteps('2000', '') === null);
check('missing input -> null', V._buildTimelineSteps(null, null) === null);
check('mixed number/date -> treated as dates or null',
    V._buildTimelineSteps('2000', '2001-06-01') === null || V._buildTimelineSteps('2000', '2001-06-01').numeric === false);

// ── Filter semantics ──
// Re-implement the two MapLibre expression shapes so we can assert on real features
console.log('\nGenerated filter selects the right features');
const evalFilter = (filter, props) => {
    const [op, ...args] = filter;
    if (op === 'all') return args.every(a => evalFilter(a, props));
    if (op === 'has') return Object.prototype.hasOwnProperty.call(props, args[0]);
    if (op === '<=') return evalExpr(args[0], props) <= evalExpr(args[1], props);
    throw new Error('unsupported op ' + op);
};
const evalExpr = (e, props) => {
    if (!Array.isArray(e)) return e;
    const [op, ...args] = e;
    if (op === 'get') return props[args[0]];
    if (op === 'to-string') return String(evalExpr(args[0], props));
    if (op === 'to-number') { const n = Number(evalExpr(args[0], props)); return isFinite(n) ? n : args[1]; }
    if (op === 'slice') return String(evalExpr(args[0], props)).slice(args[1], args[2]);
    throw new Error('unsupported expr ' + op);
};

V._slides = [{
    id: 1, layout: 'side-left', title: 'T', narrative: '<p>x</p>', style_overrides: {},
    map_config: { timeline: { enabled: true, layer_id: 'quakes', date_field: 'when', start: '2000-01-01', end: '2000-12-31', speed: 'fast' } },
}];
V._data = { story: { id: 1, title: 'S', settings: {} }, basemaps: [], layers: [], markers: [] };
V._buildNarrative();
V._initTimeline(V._slides[0], V._slides[0].map_config.timeline);

const firstFilter = w.calls.setFilter[0].filter;
check('filter targets the configured layer', w.calls.setFilter[0].id === 'quakes');
check('cursor starts at the range start',
    evalFilter(firstFilter, { when: '2000-01-01' }) === true);
check('a later feature is hidden at step 0',
    evalFilter(firstFilter, { when: '2000-08-15' }) === false);
check('same-day timestamp is included despite the longer string',
    evalFilter(firstFilter, { when: '2000-01-01T09:30:00Z' }) === true);
check('a feature missing the field is excluded',
    evalFilter(firstFilter, { other: 1 }) === false);

// Numeric flavour
const numSteps = V._buildTimelineSteps('2000', '2005');
const numFilter = ['all', ['has', 'yr'], ['<=', ['to-number', ['get', 'yr'], 1e15], numSteps.values[2]]];
check('numeric: earlier year included', evalFilter(numFilter, { yr: 2001 }) === true);
check('numeric: cursor year included', evalFilter(numFilter, { yr: 2002 }) === true);
check('numeric: later year excluded', evalFilter(numFilter, { yr: 2003 }) === false);
check('numeric: numeric string works', evalFilter(numFilter, { yr: '2001' }) === true);
check('numeric: non-numeric value excluded', evalFilter(numFilter, { yr: 'n/a' }) === false);

// ── Control ──
console.log('\nPlayback control');
const control = w.document.getElementById('viewer-timeline-control');
check('control rendered', !!control);
check('uses the existing stylesheet class', control.className === 'timeline-control');
const range = control.querySelector('input[type=range]');
const label = control.querySelector('.timeline-label');
const btn = control.querySelector('button');
check('range spans the steps', range.max === '60' && range.min === '0', range.min + '..' + range.max);
check('label shows the first step', !!label.textContent && label.textContent.length > 0, label.textContent);
check('autoplays on entry', V._timelinePlaying === true);
check('button offers pause while playing', btn.innerHTML.includes('pause-fill'), btn.innerHTML);

setTimeout(() => {
    console.log('\nAfter ~1s at "fast" speed');
    check('cursor advanced', V._timelineIndex >= 2, String(V._timelineIndex));
    const advanced = w.calls.setFilter.length;
    check('a filter was pushed per step', advanced >= 3, String(advanced));

    btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    check('pause stops playback', V._timelinePlaying === false);
    const frozen = V._timelineIndex;

    // Scrubbing
    range.value = '60';
    range.dispatchEvent(new w.Event('input', { bubbles: true }));
    check('scrubbing moves the cursor', V._timelineIndex === 60, String(V._timelineIndex));
    check('scrubbing pushed a filter', w.calls.setFilter[w.calls.setFilter.length - 1].id === 'quakes');
    const endFilter = w.calls.setFilter[w.calls.setFilter.length - 1].filter;
    check('at the end everything in range is visible',
        evalFilter(endFilter, { when: '2000-08-15' }) === true);
    check('button offers replay at the end', btn.innerHTML.includes('arrow-counterclockwise'), btn.innerHTML);
    check('paused index was not advancing', frozen <= 60);

    // Replay from the end
    btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    check('replay restarts from step 0', V._timelineIndex === 0, String(V._timelineIndex));
    V._stopTimeline();

    // ── Teardown ──
    console.log('\nLeaving the slide');
    w.calls.clearFilter.length = 0;
    V._clearTimelineFilter();
    check('layer filter restored', w.calls.clearFilter[0] === 'quakes', JSON.stringify(w.calls.clearFilter));
    check('clearing twice is a no-op', (V._clearTimelineFilter(), w.calls.clearFilter.length === 1),
        String(w.calls.clearFilter.length));

    // ── Full slide activation, the way the scroll observer drives it ──
    console.log('\n_onSlideEnter wiring');
    w.document.getElementById('viewer-timeline-control')?.remove();
    w.calls.setFilter.length = 0;
    w.calls.clearFilter.length = 0;

    V._slides = [
        { id: 10, layout: 'side-left', title: 'Timed', narrative: '<p>a</p>', style_overrides: {},
          map_center: { lng: 9, lat: 45 }, map_zoom: 6,
          map_config: { timeline: { enabled: true, layer_id: 'quakes', date_field: 'when',
                                    start: '2000', end: '2005', speed: 'slow' } } },
        { id: 11, layout: 'side-left', title: 'Plain', narrative: '<p>b</p>', style_overrides: {} },
    ];
    V._buildNarrative();

    V._onSlideEnter(0);
    check('entering a timed slide builds the control', !!w.document.getElementById('viewer-timeline-control'));
    check('and starts filtering the layer', w.calls.setFilter.length >= 1 && w.calls.setFilter[0].id === 'quakes');
    check('playback running', V._timelinePlaying === true);

    V._onSlideEnter(1);
    check('leaving removes the control', !w.document.getElementById('viewer-timeline-control'));
    check('leaving stops playback', V._timelinePlaying === false);
    check('leaving restores the layer filter', w.calls.clearFilter.includes('quakes'),
        JSON.stringify(w.calls.clearFilter));
    check('no filter is left applied', V._timelineLayerId === null, String(V._timelineLayerId));

    // A slide whose timeline is misconfigured must not build a control or throw
    V._slides = [{ id: 12, layout: 'side-left', title: 'Bad', narrative: '<p>c</p>', style_overrides: {},
        map_config: { timeline: { enabled: true, layer_id: 'quakes', date_field: 'when', start: 'x', end: 'y' } } }];
    V._buildNarrative();
    let threw = false;
    try { V._onSlideEnter(0); } catch (e) { threw = true; console.log('    ' + e.message); }
    check('unparseable range does not throw', !threw);
    check('and builds no control', !w.document.getElementById('viewer-timeline-control'));
    V._stopTimeline();

    // ── Audio ──
    console.log('\nSlide audio');
    const audioSlide = { id: 2, layout: 'side-left', title: 'A', narrative: '<p>y</p>', style_overrides: {},
        audio_url: 'https://example.org/narration.mp3', audio_autoplay: true };
    V._slides = [audioSlide];
    V._buildNarrative();
    V._initSlideAudio(audioSlide, 0);

    const ac = w.document.getElementById('viewer-audio-control');
    check('audio control rendered', !!ac);
    check('uses the existing stylesheet class', ac.className === 'slide-audio-control');
    check('rendered inside the slide card', !!w.document.querySelector('.viewer-slide-content .slide-audio-control'));
    check('audio element retained for cleanup', !!V._currentAudio && V._currentAudio.src.endsWith('narration.mp3'),
        V._currentAudio && V._currentAudio.src);
    check('autoplay started it', V._currentAudio.paused === false);
    const abtn = ac.querySelector('button');
    check('button shows pause while playing', abtn.innerHTML.includes('pause-fill'), abtn.innerHTML);

    abtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    check('click pauses', V._currentAudio.paused === true);
    check('button flips to play', abtn.innerHTML.includes('play-fill'), abtn.innerHTML);
    abtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    check('click resumes', V._currentAudio.paused === false);

    // Time display
    V._currentAudio.dispatchEvent(new w.Event('timeupdate'));
    check('time label present', /^\d+:\d{2}$/.test(ac.querySelector('.slide-audio-time').textContent),
        ac.querySelector('.slide-audio-time').textContent);

    // Error handling
    V._currentAudio.dispatchEvent(new w.Event('error'));
    check('error replaces the control with a message',
        ac.textContent === w.I18n.t('viewer.audio_error'), ac.textContent);

    // No URL -> nothing rendered
    w.document.getElementById('viewer-audio-control')?.remove();
    V._initSlideAudio({ id: 3, audio_url: '' }, 0);
    check('no audio_url renders nothing', !w.document.getElementById('viewer-audio-control'));

    console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL TIMELINE + AUDIO CHECKS PASSED'));
    process.exit(failures ? 1 : 0);
}, 1000);
