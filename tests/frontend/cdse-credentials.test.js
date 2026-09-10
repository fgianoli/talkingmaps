/**
 * Per-user Copernicus credentials.
 *
 * The runtime half — translations and the account panel — is exercised for real.
 * The server half is checked at source level, because this machine has no Python
 * outside the container; those checks guard decisions that are easy to undo by
 * accident rather than logic that needs executing.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO = path.resolve(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');

let failures = 0;
const check = (name, cond, extra) => {
    if (cond) console.log('  PASS  ' + name);
    else { console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + extra : '')); failures++; }
};

// ── Translations ──
console.log('\nTranslations');

const dom = new JSDOM('<!doctype html><body></body>',
    { runScripts: 'outside-only', url: 'https://example.org/' });
dom.window.eval(read('frontend/js/i18n.js') + ';window.I18n = I18n;');
const I18n = dom.window.I18n;
I18n.init();

const KEYS = ['cdse.title', 'cdse.intro', 'cdse.client_id', 'cdse.client_secret',
    'cdse.secret_hint', 'cdse.test', 'cdse.testing', 'cdse.saved',
    'cdse.test_ok', 'cdse.test_failed', 'cdse.quota_notice', 'cdse.how_to'];

for (const lang of ['it', 'en', 'es', 'ca', 'fr']) {
    I18n.setLang(lang);
    const missing = KEYS.filter(k => {
        const v = I18n.t(k);
        return !v || v === k;
    });
    check(lang + ' has every CDSE string', missing.length === 0, missing.join(', '));
}

// Apostrophes in the Italian, Catalan and French strings were mangled once by a
// scripted edit, which parses fine right up until it does not.
I18n.setLang('it');
check('Italian text is not broken by its apostrophes',
    I18n.t('cdse.intro').includes("l'uso"), I18n.t('cdse.intro').slice(0, 60));
I18n.setLang('fr');
check('French text is not broken by its apostrophes',
    I18n.t('cdse.secret_hint').includes("d'être"), I18n.t('cdse.secret_hint').slice(0, 60));

// ── The account panel ──
console.log('\nAccount panel');

const dashboard = read('frontend/js/dashboard.js');
check('the panel reads the stored settings', /Api\.getCdseSettings\(\)/.test(dashboard));
check('it offers a client id field', /id="cdse-client-id"/.test(dashboard));
check('it offers a client secret field', /id="cdse-client-secret"/.test(dashboard));
check('it wires a save action', /_saveCdseSettings\(\)/.test(dashboard));
check('it wires a connection test', /_testCdseCredentials\(\)/.test(dashboard));

// The secret must reach the form as a placeholder, never as a field value: a value
// would be submitted straight back and overwrite the stored secret with its mask.
const secretField = dashboard.match(/id="cdse-client-secret"[\s\S]{0,320}?>/);
check('the masked secret is a placeholder, not a value',
    !!secretField && /placeholder="\$\{cdseSettings\.client_secret_set/.test(secretField[0])
        && /value=""/.test(secretField[0]),
    secretField ? secretField[0].replace(/\s+/g, ' ').slice(0, 150) : 'field not found');

const api = read('frontend/js/api.js');
for (const [name, route] of [
    ['getCdseSettings', '/api/cdse/settings'],
    ['updateCdseSettings', '/api/cdse/settings'],
    ['testCdseCredentials', '/api/cdse/test'],
]) {
    check('Api.' + name + ' calls ' + route,
        new RegExp(name + '\\([^)]*\\)\\s*\\{[^}]*' + route.replace(/\//g, '\\/')).test(api));
}

// ── Server-side decisions ──
console.log('\nServer-side decisions');

const router = read('backend/routers/cdse.py');

// The whole point of per-user credentials is that CDSE bills whoever asks. A
// fallback to a server-wide pair would quietly undo that.
check('the router never falls back to the environment pair',
    !/dev_credentials/.test(router));
check('a user without credentials is refused rather than served',
    /Nessuna credenziale Copernicus configurata/.test(router));

// Saving the form untouched must not replace the real secret with its own mask.
check('an echoed mask does not overwrite the stored secret',
    /startswith\(MASK\)/.test(router));
check('the secret is encrypted before it is written',
    /encrypt_api_key\(secret\)/.test(router));
check('the test endpoint spends the token on a catalogue search',
    /CATALOG_URL/.test(router));

const mainPy = read('backend/main.py');
check('the CDSE router is mounted', /cdse_router\.router, prefix="\/api\/cdse"/.test(mainPy));

// users lives in the system database, which nothing migrated until now: a column
// added there would never have reached a running installation.
check('system migrations run at startup',
    /run_migrations\(engine_system, SYSTEM_MIGRATIONS_DIR\)/.test(mainPy));

const migrate = read('backend/core/migrate.py');
check('the runner takes a directory', /def run_migrations\(engine, directory/.test(migrate));
check('it looks in the directory it was given', /_migration_files\(directory\)/.test(migrate));

const systemMigrations = fs.readdirSync(path.join(REPO, 'backend', 'migrations_system'));
check('a system migration adds the column', systemMigrations.length > 0, systemMigrations.join(', '));
const migrationSql = read('backend/migrations_system/' + systemMigrations[0]);
check('the migration is re-runnable', /ADD COLUMN IF NOT EXISTS cdse_settings/.test(migrationSql));
check('a fresh install gets the column too',
    /cdse_settings JSONB/.test(read('backend/setup_system.sql')));

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL CDSE CREDENTIAL CHECKS PASSED'));
process.exit(failures ? 1 : 0);
