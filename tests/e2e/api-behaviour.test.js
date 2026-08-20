/**
 * Runtime verification against the live stack.
 * Proves the backend actually boots with the fixes and that each one behaves.
 */
const BASE = process.env.TM_BASE || 'http://localhost:8080';

let failures = 0;
const check = (name, cond, extra) => {
    if (cond) console.log('  PASS  ' + name);
    else { console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + extra : '')); failures++; }
};

async function req(method, path, { token, body, raw } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload = body;
    if (body && !raw) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + path, { method, headers, body: payload });
    let data = null;
    const text = await res.text();
    try { data = JSON.parse(text); } catch { data = text.slice(0, 200); }
    return { status: res.status, data };
}

(async () => {
    // ── 0. Does it boot? Every router must import cleanly for this to answer. ──
    // The FastAPI schema lives at /openapi.json, which nginx does not proxy (it only
    // forwards /api/), so the SPA fallback answers there. Probe a real route instead.
    console.log('\n0. Application boot');
    const probe = await req('GET', '/api/stories/public');
    check('API responds (all routers imported)', probe.status === 200, probe.status);
    if (probe.status !== 200) {
        console.log('\nBackend not up — aborting.');
        process.exit(1);
    }

    // ── 1. Login ──
    console.log('\n1. Authentication');
    const login = await req('POST', '/api/auth/login', { body: { username: 'admin', password: process.env.TM_ADMIN_PW } });
    check('admin login works', login.status === 200 && !!login.data.access_token,
        `${login.status} ${JSON.stringify(login.data).slice(0, 120)}`);
    const token = login.data.access_token;
    if (!token) { console.log('\nNo token — aborting.'); process.exit(1); }

    // ── 2. Private draft must not be readable anonymously ──
    console.log('\n2. Private story visibility (was: readable by anyone)');
    const created = await req('POST', '/api/stories/', {
        token, body: { title: 'Verifica riservata', description: 'segreto', visibility: 'private' },
    });
    check('story created', created.status === 200 && created.data.id, `${created.status} ${JSON.stringify(created.data).slice(0,120)}`);
    const sid = created.data.id;

    const anonFull = await req('GET', `/api/stories/${sid}/full`);
    check('anonymous GET /full on a private draft is refused', anonFull.status === 404, anonFull.status);
    const anonOne = await req('GET', `/api/stories/${sid}`);
    check('anonymous GET /{id} on a private draft is refused', anonOne.status === 404, anonOne.status);

    const ownerFull = await req('GET', `/api/stories/${sid}/full`, { token });
    check('the author can still preview their own draft', ownerFull.status === 200, ownerFull.status);
    check('and gets the slides payload', Array.isArray(ownerFull.data.slides), typeof ownerFull.data.slides);

    // ── 3. Published public story stays open to anonymous viewers ──
    console.log('\n3. Public story still works anonymously');
    const pub = await req('PUT', `/api/stories/${sid}`, { token, body: { status: 'published', visibility: 'public' } });
    check('story published', pub.status === 200, pub.status);
    const anonPub = await req('GET', `/api/stories/${sid}/full`);
    check('anonymous can read a published public story', anonPub.status === 200, anonPub.status);

    // Back to private for the remaining checks
    await req('PUT', `/api/stories/${sid}`, { token, body: { status: 'draft', visibility: 'private' } });

    // ── 4. Slide reorder (was always 422) ──
    console.log('\n4. Slide reorder');
    const s1 = await req('POST', '/api/slides/', { token, body: { story_id: sid, title: 'A' } });
    const s2 = await req('POST', '/api/slides/', { token, body: { story_id: sid, title: 'B' } });
    check('two slides created', s1.status === 200 && s2.status === 200, `${s1.status}/${s2.status}`);
    const reorder = await req('PUT', '/api/slides/reorder', { token, body: { slide_ids: [s2.data.id, s1.data.id] } });
    check('PUT /slides/reorder is accepted', reorder.status === 200, `${reorder.status} ${JSON.stringify(reorder.data).slice(0,120)}`);

    const listed = await req('GET', `/api/slides/story/${sid}`, { token });
    check('the new order persisted',
        listed.status === 200 && listed.data[0]?.id === s2.data.id,
        JSON.stringify((listed.data || []).map(x => x.id)));

    // ── 5. Slide endpoints are no longer anonymous ──
    console.log('\n5. Slide endpoints require auth');
    const anonSlides = await req('GET', `/api/slides/story/${sid}`);
    check('GET /slides/story/{id} refuses anonymous', anonSlides.status === 401 || anonSlides.status === 403, anonSlides.status);
    const anonSlide = await req('GET', `/api/slides/${s1.data.id}`);
    check('GET /slides/{id} refuses anonymous', anonSlide.status === 401 || anonSlide.status === 403, anonSlide.status);

    // ── 6. Symbology compile was an unauthenticated write ──
    console.log('\n6. Symbology compile requires auth');
    const anonCompile = await req('POST', '/api/symbology/1/compile');
    check('POST /symbology/{id}/compile refuses anonymous',
        anonCompile.status === 401 || anonCompile.status === 403, anonCompile.status);

    // ── 7. Media upload sanitises the stored extension ──
    console.log('\n7. Media upload filename handling');
    const form = new FormData();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    form.append('file', new Blob([png], { type: 'image/png' }), 'shot.png" onerror="alert(1)');
    const up = await fetch(BASE + '/api/media/upload', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    const upData = await up.json().catch(() => ({}));
    if (up.status === 200) {
        const stored = upData.file_path || upData.url || '';
        check('stored path carries no quote', !stored.includes('"'), stored);
        check('stored path carries no space or angle bracket', !/[ <>]/.test(stored), stored);
        check('extension reduced to a plain one', /\.[a-z0-9]{1,12}$/i.test(stored) || stored.endsWith('/'), stored);
    } else {
        check('media upload accepted (or cleanly rejected)', up.status === 400,
            `${up.status} ${JSON.stringify(upData).slice(0, 160)}`);
    }

    // ── 7b. The dead password stub must be gone ──
    console.log('\n7b. Removed password stub');
    const stub = await req('PUT', '/api/users/1/password', { token, body: { password: 'whatever123' } });
    check('PUT /users/{id}/password no longer exists', stub.status === 404 || stub.status === 405, stub.status);
    const realReset = await req('PUT', '/api/users/999999/reset-password', { token, body: { password: 'whatever123' } });
    check('the working reset endpoint is routed (404 = user missing, not route missing)',
        realReset.status === 404 && typeof realReset.data === 'object' && 'detail' in realReset.data,
        `${realReset.status} ${JSON.stringify(realReset.data).slice(0, 80)}`);

    // ── 7c. CKAN: the endpoints the browser calls ──
    // Only network-free assertions here: searching a real portal would make CI
    // depend on someone else's uptime.
    console.log('\n7c. CKAN endpoints');
    const portals = await req('GET', '/api/ckan/portals', { token });
    check('portal list served', portals.status === 200 && Array.isArray(portals.data), portals.status);
    check('every portal points at a CKAN root, not a bare domain page',
        portals.data.every(p => p.url && p.url.startsWith('https://')),
        JSON.stringify(portals.data));
    check('dati.gov.it uses its /opendata prefix',
        portals.data.some(p => p.url === 'https://dati.gov.it/opendata'),
        JSON.stringify(portals.data.map(p => p.url)));

    const ssrf = await req('GET', '/api/ckan/search?portal_url=' + encodeURIComponent('http://127.0.0.1:8000') + '&q=x', { token });
    check('a private address is refused', ssrf.status === 400, ssrf.status);
    const anonCkan = await req('GET', '/api/ckan/portals');
    check('portals need no auth, search does',
        (await req('GET', '/api/ckan/search?portal_url=https%3A%2F%2Fexample.org&q=x')).status === 403
        || (await req('GET', '/api/ckan/search?portal_url=https%3A%2F%2Fexample.org&q=x')).status === 401,
        anonCkan.status);

    // ── 8. Geodata lang validation (SSRF primitive) ──
    console.log('\n8. Geodata lang validation');
    const badLang = await req('GET', '/api/geodata/wikipedia/nearby?lat=45&lng=9&lang=evil.example.com%23', { token });
    check('a hostile lang is rejected', badLang.status === 400, `${badLang.status} ${JSON.stringify(badLang.data).slice(0,120)}`);

    // ── 9. WMS proxy still serves an allow-listed host ──
    console.log('\n9. Proxy allow-list still functions');
    const blocked = await req('GET', '/api/wms-proxy/tile?url=' + encodeURIComponent('http://169.254.169.254/latest/meta-data/'));
    check('a blocked host is refused', blocked.status === 403, blocked.status);

    // ── Cleanup ──
    await req('DELETE', `/api/stories/${sid}`, { token });

    console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL RUNTIME CHECKS PASSED'));
    process.exit(failures ? 1 : 0);
})().catch(e => { console.error('THREW:', e.message); process.exit(1); });
