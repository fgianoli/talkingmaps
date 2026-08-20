/**
 * Static audit of the 15 backend findings. No Python interpreter or Docker daemon
 * is available in this environment, so this asserts on the source: the vulnerable
 * pattern must be gone and the guard must be present. Weaker than a runtime test —
 * it proves the change was made, not that the app still boots.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const src = f => fs.readFileSync(path.join(REPO, f), 'utf8');

let failures = 0;
const check = (name, cond, extra) => {
    if (cond) console.log('  PASS  ' + name);
    else { console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + extra : '')); failures++; }
};
// Function body from `async def name(` up to the next top-level def
const body = (text, fnName) => {
    const i = text.indexOf(`async def ${fnName}(`);
    if (i === -1) return '';
    const rest = text.slice(i);
    const next = rest.slice(1).search(/\n(async def |def |@router)/);
    return next === -1 ? rest : rest.slice(0, next + 1);
};

const stories = src('backend/routers/stories.py');
const slides = src('backend/routers/slides.py');
const upload3d = src('backend/routers/upload3d.py');
const layers = src('backend/routers/layers.py');
const media = src('backend/routers/media.py');
const auth = src('backend/routers/auth.py');
const geodata = src('backend/routers/geodata.py');
const wms = src('backend/routers/wms_proxy.py');
const wfs = src('backend/routers/wfs_proxy.py');
const symb = src('backend/routers/symbology.py');
const users = src('backend/routers/users.py');
const security = src('backend/core/security.py');

console.log('\n1. upload3d: path traversal on the saved filename');
check('filename is sanitised', upload3d.includes('safe_filename(file.filename'));
check('raw filename no longer joined into the path',
    !/original_path = os\.path\.join\(asset_dir, file\.filename/.test(upload3d) &&
    !upload3d.includes('original_filename = file.filename'));

console.log('\n2. stories: /full and /{id} were unauthenticated');
check('a read guard exists', stories.includes('async def _can_read_story('));
check('/full checks it', body(stories, 'get_story_full').includes('_can_read_story'));
check('/{story_id} checks it', body(stories, 'get_story').includes('_can_read_story'));
check('both take the optional-auth dependency',
    body(stories, 'get_story_full').includes('get_current_user_optional') &&
    body(stories, 'get_story').includes('get_current_user_optional'));
check('anonymous callers are still served public stories',
    /status.*==.*"published".*\n?.*visibility.*in \("public", "unlisted"\)/s.test(stories));
check('failure answers 404, not 403',
    /_can_read_story\(db, dict\(story\), user\):\s*\n\s*raise HTTPException\(status_code=404/.test(stories));

console.log('\n3. stories: restore_version wiped slides with no ownership check');
check('ownership is checked', body(stories, 'restore_version').includes('_check_story_access'));
check('and it demands editor rights', /restore_version[\s\S]{0,400}require_role="editor"/.test(stories));

console.log('\n4. slides: PUT /reorder was shadowed by PUT /{slide_id}');
check('/reorder is declared before /{slide_id}',
    slides.indexOf('@router.put("/reorder")') < slides.indexOf('@router.put("/{slide_id}")'));
check('reorder verifies the slides belong to one story', body(slides, 'reorder_slides').includes('storie diverse'));
check('reorder checks access', body(slides, 'reorder_slides').includes('require_story_access'));

console.log('\n5. stories: duplicate copied any story by id');
check('access is checked', body(stories, 'duplicate_story').includes('_check_story_access'));

console.log('\n6. slides: CRUD checked the role but never the story');
check('shared authz module exists', fs.existsSync(path.join(REPO, 'backend/core/authz.py')));
for (const fn of ['list_slides', 'get_slide', 'create_slide', 'update_slide', 'delete_slide',
                  'add_marker', 'update_marker', 'delete_marker']) {
    check(`${fn} is story-scoped`, /require_(story|slide|marker)_access/.test(body(slides, fn)));
}
check('GET /slides/story/{id} is no longer anonymous',
    body(slides, 'list_slides').includes('Depends(require_editor)'));

console.log('\n7. zip slip on user archives');
check('safe_extract helper exists', fs.existsSync(path.join(REPO, 'backend/core/safe_files.py')));
check('no raw extractall left in upload3d', !upload3d.includes('.extractall('));
check('no raw extractall left in layers', !layers.includes('zf.extractall('));
check('upload3d uses safe_extract twice', (upload3d.match(/safe_extract\(/g) || []).length === 2);
check('layers uses safe_extract', layers.includes('safe_extract(zf, tmpdir)'));
const safeFiles = src('backend/core/safe_files.py');
check('safe_extract rejects escaping members', safeFiles.includes('esce dalla cartella di destinazione'));
check('safe_extract rejects symlinks', safeFiles.includes('0xA000'));

console.log('\n8. auth: change_password crashed on OAuth accounts');
check('empty hash is guarded', /if not row or not row\[0\]:/.test(auth));
check('guard precedes verify_password',
    auth.indexOf('if not row or not row[0]:') < auth.indexOf('verify_password(req.current_password'));

console.log('\n9. stories: AND/OR precedence dropped the status filter');
check('the OR group is parenthesised',
    stories.includes('WHERE (s.author_id = :uid OR sc.user_id = :uid)'));

console.log('\n10. geodata: lang was interpolated into the hostname');
check('lang is validated', geodata.includes('re.fullmatch'));
check('validation runs before the request',
    geodata.indexOf('re.fullmatch') < geodata.indexOf('wikipedia.org'));

console.log('\n11. stories: bare except left the session poisoned');
check('no "except Exception: pass" remains around commits',
    !/except Exception:\s*\n\s*pass/.test(stories));
check('rollbacks are in place', (stories.match(/rollback\(\)/g) || []).length >= 4);

console.log('\n12. proxies: redirects bypassed the SSRF guard');
check('safe_http helper exists', fs.existsSync(path.join(REPO, 'backend/core/safe_http.py')));
check('wms no longer auto-follows redirects', !wms.includes('follow_redirects=True'));
check('wfs no longer auto-follows redirects', !wfs.includes('follow_redirects=True'));
check('wms revalidates each hop', (wms.match(/fetch_validated\(/g) || []).length === 2);
check('wfs revalidates each hop', (wfs.match(/fetch_validated\(/g) || []).length === 2);
check('the helper re-runs the validator per hop',
    src('backend/core/safe_http.py').includes('allowed = validator(current)'));

console.log('\n13. symbology: writes with no owner check');
check('ownership helper exists', symb.includes('async def _require_symbology_owner('));
for (const fn of ['update_symbology', 'delete_symbology', 'recompile_symbology']) {
    check(`${fn} checks ownership`, body(symb, fn).includes('_require_symbology_owner'));
}
check('compile is no longer anonymous', body(symb, 'recompile_symbology').includes('Depends(require_editor)'));

console.log('\n14. media: story_id replaced the owner filter');
check('both filters are combined', media.includes('" AND ".join(clauses)'));
check('owner filter is no longer in an elif', !/elif user\["role"\] != "admin":/.test(media));
check('upload extension is sanitised', media.includes('safe_extension(file.filename)'));

console.log('\n15. users: dead password stub');
check('the stub is gone', !users.includes('@router.put("/{user_id}/password")'));
check('the working endpoint remains', users.includes('@router.put("/{user_id}/reset-password")'));

console.log('\nSupporting: optional auth dependency');
check('get_current_user_optional exists', security.includes('async def get_current_user_optional('));
check('it uses a non-erroring bearer scheme', security.includes('HTTPBearer(auto_error=False)'));
check('it returns None for anonymous callers', /if credentials is None:\s*\n\s*return None/.test(security));

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL BACKEND AUDIT CHECKS PASSED'));
process.exit(failures ? 1 : 0);
