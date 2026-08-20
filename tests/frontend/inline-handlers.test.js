/**
 * The six inline-handler call sites that spliced user data into a JS string
 * inside onclick="..." are now data-* attributes plus real listeners.
 * Each block proves: (a) a hostile value cannot inject, (b) the action still fires
 * with the value intact.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO = path.resolve(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');

const dom = new JSDOM(`<!doctype html><html><body>
  <div id="collab-search-results"></div>
  <div id="collab-list"></div>
  <div id="media-library-panel"></div>
  <div id="panel-dashboard"></div>
  <div id="stories-grid"></div>
</body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.org/' });
const w = dom.window;

// Two payloads: one breaks the HTML attribute, one breaks the JS string inside it
const ATTR = '" onmouseover="window.__XSS=1" x="';
const JSSTR = "');window.__XSS=1;//";

const stubs = `
const noop = (own) => new Proxy(own, { get: (t, p) => (p in t ? t[p] : () => {}) });
window.__calls = [];
window.TmMap = noop({ getMap: () => null, getState: () => ({}), getDrawFeatures: () => null });
window.TmCharts = noop({}); window.TmGallery = noop({}); window.Cesium3D = noop({});
window.PotreeViewer = noop({}); window.UndoStack = noop({}); window.StoryViewer = noop({});
window.DOMPurify = { sanitize: (x) => String(x ?? '') };
window.bootstrap = { Modal: class { constructor(){} show(){} hide(){} static getInstance(){ return null; } } };
window.Api = noop({
    getUser: () => ({ id: 1 }),
    searchUsers: async () => window.__users,
    listServices: async () => window.__services,
    getCapabilities: async () => ({ layers: window.__caps }),
    listMedia: async () => window.__media,
    listAllContributions: async () => window.__contribs,
    listStories: async () => window.__stories,
    isLoggedIn: () => true,
});
window.I18n = I18n; window.App = App;
App.init = () => {}; App.toast = () => {};
window.StoryEditor = StoryEditor; window.Dashboard = Dashboard; window.MediaLibrary = MediaLibrary;
I18n.init(); I18n.setLang('en');
`;

w.eval([read('frontend/js/i18n.js'), read('frontend/js/app.js'), read('frontend/js/animate.js'),
        read('frontend/js/compare-image.js'), read('frontend/js/viewer.js'), read('frontend/js/editor.js'),
        read('frontend/js/dashboard.js'), read('frontend/js/media-library.js'), stubs].join('\n;\n'));

let failures = 0;
const check = (name, cond, extra) => {
    if (cond) console.log('  PASS  ' + name);
    else { console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + extra : '')); failures++; }
};
// Any attribute the markup did not intend, or a leftover inline handler, is an injection
const clean = (root) => {
    if (root.querySelector('[onmouseover]')) return false;
    if (w.__XSS) return false;
    return true;
};
const noInlineHandlers = (root) =>
    root.querySelectorAll('[onclick],[onchange],[onmouseover],[onfocus]').length === 0;

const E = w.StoryEditor, D = w.Dashboard, M = w.MediaLibrary;
const doc = w.document;

// ── 1. Collaborator search ──
console.log('\n1. Collaborator search results');
w.__users = [{ id: 42, username: ATTR, display_name: ATTR, email: 'a@b.c', avatar: '' }];
E._storyId = 1;
let addCollabArgs = null;
E._addCollab = (...a) => { addCollabArgs = a; };
E._searchCollabUsers('x').then(() => {
    const host = doc.getElementById('collab-search-results');
    check('no injected attribute', clean(host));
    check('no inline handler left', noInlineHandlers(host));
    check('username survives verbatim in dataset',
        host.querySelector('[data-collab-username]')?.dataset.collabUsername === ATTR);
    host.querySelector('button').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    check('click still calls _addCollab with the right id',
        addCollabArgs && addCollabArgs[0] === 42, JSON.stringify(addCollabArgs));
    check('and the username intact', addCollabArgs && addCollabArgs[1] === ATTR);

    // ── 2. Service catalog explore/delete ──
    console.log('\n2. Service catalog');
    w.__services = [{ id: 7, name: ATTR, service_type: ATTR, url: ATTR, description: '' }];
    let exploreArgs = null, deleteArgs = null;
    const realExploreService = E._exploreService;
    E._exploreService = (...a) => { exploreArgs = a; };
    E._deleteService = (...a) => { deleteArgs = a; };
    return E._openServiceCatalog().then(() => {
        const modal = doc.getElementById('service-catalog-modal');
        check('modal rendered', !!modal);
        check('no injected attribute', clean(modal));
        check('no inline handler on the action buttons',
            modal.querySelectorAll('[data-explore-service][onclick], [data-delete-service][onclick]').length === 0);
        const explore = modal.querySelector('[data-explore-service]');
        explore.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
        check('explore fires with id, type and url intact',
            exploreArgs && exploreArgs[0] === 7 && exploreArgs[1] === ATTR && exploreArgs[2] === ATTR,
            JSON.stringify(exploreArgs));
        modal.querySelector('[data-delete-service]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
        check('delete fires with the id', deleteArgs && deleteArgs[0] === 7, JSON.stringify(deleteArgs));

        // ── 3. Layers from GetCapabilities ──
        console.log('\n3. Layers listed from a service');
        E._exploreService = realExploreService; // restore the real one
        doc.body.insertAdjacentHTML('beforeend', '<div id="service-layers-7"></div>');
        w.__caps = [{ name: JSSTR, title: ATTR }];
        let addLayerArgs = null;
        E._addLayerFromService = (...a) => { addLayerArgs = a; };
        return E._exploreService(7, 'wms', 'https://example.org/wms').then(() => {
            const host = doc.getElementById('service-layers-7');
            check('no injected attribute', clean(host));
            check('no inline handler left', noInlineHandlers(host));
            host.querySelector('[data-add-layer]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
            check('add fires with the capabilities values intact',
                addLayerArgs && addLayerArgs[2] === JSSTR && addLayerArgs[3] === ATTR,
                JSON.stringify(addLayerArgs));
            check('service type and url come from the closure',
                addLayerArgs && addLayerArgs[0] === 'wms' && addLayerArgs[1] === 'https://example.org/wms');

            // ── 4. Media library grid ──
            console.log('\n4. Media library grid');
            const grid = doc.getElementById('media-library-panel');
            grid.innerHTML = `<div class="media-grid">${M._renderMediaItems([
                { id: 5, file_path: ATTR, original_name: JSSTR, mime_type: 'image/png', thumbnail_path: '' },
            ])}</div>`;
            let detailArgs = null;
            M._showDetail = (...a) => { detailArgs = a; };
            M._setupMediaItems();
            check('no injected attribute', clean(grid));
            check('no inline handler left', noInlineHandlers(grid));
            grid.querySelector('.media-item').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
            check('click opens the detail with id, url and name intact',
                detailArgs && detailArgs[0] === 5 && detailArgs[1] === ATTR && detailArgs[2] === JSSTR,
                JSON.stringify(detailArgs));

            // ── 5. Story card moderation entry ──
            console.log('\n5. Story card moderation entry');
            const cardsHtml = D._renderStoryCards([{
                id: 3, title: ATTR, status: 'published', author_id: 1, share_token: 'tok',
                settings: { participatory_enabled: true },
            }]);
            const cards = doc.getElementById('stories-grid');
            cards.innerHTML = cardsHtml;
            check('no injected attribute', clean(cards));
            // The payload still appears in cardsHtml as escaped *text* (the title is
            // rendered), so assert on the DOM, not on the raw string.
            check('moderation handler carries only the numeric id',
                /renderModeration\(3\);/.test(cardsHtml),
                (cardsHtml.match(/renderModeration\([^)]*\)/) || ['(absent)'])[0]);
            // The card legitimately keeps inline handlers that take only a numeric id,
            // so assert the payload never became markup rather than banning them outright.
            check('the hostile title renders as inert text',
                cards.textContent.includes(ATTR) && !cards.querySelector('[onmouseover]') && !w.__XSS);
            check('title still resolvable by id', D._storyTitles[3] === ATTR, JSON.stringify(D._storyTitles?.[3]));

            // ── 6. Contribution media in the moderation list ──
            console.log('\n6. Contribution media');
            w.__contribs = [{ id: 1, media_url: ATTR, media_type: 'image', thumbnail_url: '',
                              status: 'pending', lat: 1, lng: 2, created_at: '2024-01-01' }];
            return D.renderModeration(3).then(() => {
                const panel = doc.getElementById('panel-dashboard');
                check('no injected attribute', clean(panel));
                check('no inline handler on the media', noInlineHandlers(panel));
                const img = panel.querySelector('.mod-media-open');
                check('media url kept in dataset', img?.dataset.mediaUrl === ATTR, img?.dataset.mediaUrl);
                let opened = 'not called';
                w.open = (u) => { opened = u; };
                img.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
                check('a non-http url is not opened', opened === 'not called', String(opened));

                // …but a legitimate one still is
                img.dataset.mediaUrl = '/uploads/photo.jpg';
                img.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
                check('a normal url still opens', opened === '/uploads/photo.jpg', String(opened));

                console.log('\nGlobal: window.__XSS is ' + (w.__XSS ? 'SET — injection succeeded' : 'unset'));
                check('nothing executed anywhere', !w.__XSS);

                console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL INLINE-HANDLER CHECKS PASSED'));
                process.exit(failures ? 1 : 0);
            });
        });
    });
}).catch(e => { console.error('THREW:', e); process.exit(1); });
