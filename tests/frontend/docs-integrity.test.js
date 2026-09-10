/**
 * The documentation page is one long file with a hand-written sidebar, so the
 * menu and the sections drift apart quietly: a link survives a renamed anchor
 * and simply scrolls nowhere, and a new section stays invisible because nobody
 * remembers to list it. Neither shows up as an error anywhere.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(REPO, 'frontend', 'docs.html'), 'utf8');
const doc = new JSDOM(html).window.document;

let failures = 0;
const check = (name, cond, extra) => {
    if (cond) console.log('  PASS  ' + name);
    else { console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + extra : '')); failures++; }
};

const sidebarLinks = [...doc.querySelectorAll('.docs-sidebar a[href^="#"]')]
    .map(a => a.getAttribute('href').slice(1));
const sections = [...doc.querySelectorAll('h2[id]')].map(h => h.id);
const allIds = [...doc.querySelectorAll('[id]')].map(e => e.id);

console.log('\nDocumentation navigation');

check('the sidebar is not empty', sidebarLinks.length > 0, sidebarLinks.length);

const dangling = sidebarLinks.filter(href => !allIds.includes(href));
check('every menu entry points at a section that exists', dangling.length === 0, dangling.join(', '));

const unlisted = sections.filter(id => !sidebarLinks.includes(id));
check('every section is reachable from the menu', unlisted.length === 0, unlisted.join(', '));

const seen = new Set();
const duplicates = allIds.filter(id => (seen.has(id) ? true : (seen.add(id), false)));
check('no id is used twice', duplicates.length === 0, duplicates.join(', '));

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL DOCS CHECKS PASSED'));
process.exit(failures ? 1 : 0);
