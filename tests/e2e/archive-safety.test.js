/**
 * Runtime check for the archive and filename fixes on /api/3d/upload.
 * Builds a ZIP by hand (stored, no compression) so no dependency is needed.
 */
const BASE = process.env.TM_BASE || 'http://localhost:8080';

let failures = 0;
const check = (name, cond, extra) => {
    if (cond) console.log('  PASS  ' + name);
    else { console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + extra : '')); failures++; }
};

// ── Minimal ZIP writer (stored entries) ──
function crc32(buf) {
    let c, table = [];
    for (let n = 0; n < 256; n++) {
        c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    let crc = 0xffffffff;
    for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(entries) {
    const chunks = [], central = [];
    let offset = 0;
    for (const { name, data } of entries) {
        const nameBuf = Buffer.from(name, 'utf8');
        const body = Buffer.from(data, 'utf8');
        const crc = crc32(body);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 6);
        local.writeUInt16LE(0, 8);          // stored
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(body.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        chunks.push(local, nameBuf, body);

        const cen = Buffer.alloc(46);
        cen.writeUInt32LE(0x02014b50, 0);
        cen.writeUInt16LE(20, 4);
        cen.writeUInt16LE(20, 6);
        cen.writeUInt16LE(0, 10);
        cen.writeUInt32LE(crc, 16);
        cen.writeUInt32LE(body.length, 20);
        cen.writeUInt32LE(body.length, 24);
        cen.writeUInt16LE(nameBuf.length, 28);
        cen.writeUInt32LE(offset, 42);
        central.push(cen, nameBuf);

        offset += local.length + nameBuf.length + body.length;
    }
    const centralBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...chunks, centralBuf, end]);
}

async function upload(token, filename, buf) {
    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'application/zip' }), filename);
    const res = await fetch(BASE + '/api/3d/upload', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    let data;
    try { data = await res.json(); } catch { data = null; }
    return { status: res.status, data };
}

(async () => {
    const login = await fetch(BASE + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: process.env.TM_ADMIN_PW }),
    });
    const token = (await login.json()).access_token;
    if (!token) { console.log('no token'); process.exit(1); }

    console.log('\n1. Zip slip: a member escaping the destination');
    const evil = makeZip([
        { name: 'tileset.json', data: '{"asset":{"version":"1.0"}}' },
        { name: '../../../../tmp/pwned.txt', data: 'escaped' },
    ]);
    const evilRes = await upload(token, 'evil.zip', evil);
    check('the archive is rejected', evilRes.status === 400,
        `${evilRes.status} ${JSON.stringify(evilRes.data).slice(0, 140)}`);
    check('and the reason names the escaping member',
        JSON.stringify(evilRes.data || '').includes('esce dalla cartella'),
        JSON.stringify(evilRes.data).slice(0, 140));

    console.log('\n2. An absolute member path');
    const abs = makeZip([
        { name: 'tileset.json', data: '{"asset":{"version":"1.0"}}' },
        { name: '/tmp/abs-pwned.txt', data: 'escaped' },
    ]);
    const absRes = await upload(token, 'abs.zip', abs);
    check('rejected too', absRes.status === 400, `${absRes.status} ${JSON.stringify(absRes.data).slice(0, 140)}`);

    console.log('\n3. A clean archive still uploads');
    const good = makeZip([
        { name: 'tileset.json', data: '{"asset":{"version":"1.0"},"geometricError":1,"root":{}}' },
        { name: 'data/0.b3dm', data: 'x' },
    ]);
    const goodRes = await upload(token, 'good.zip', good);
    check('accepted', goodRes.status === 200, `${goodRes.status} ${JSON.stringify(goodRes.data).slice(0, 200)}`);

    console.log('\n4. Traversal in the uploaded filename itself');
    const trav = await upload(token, '../../../../tmp/evil.zip', good);
    check('handled without escaping (accepted or cleanly refused, never 500)',
        trav.status === 200 || trav.status === 400,
        `${trav.status} ${JSON.stringify(trav.data).slice(0, 140)}`);

    console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL ARCHIVE CHECKS PASSED'));
    process.exit(failures ? 1 : 0);
})().catch(e => { console.error('THREW:', e.message); process.exit(1); });
