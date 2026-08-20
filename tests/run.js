#!/usr/bin/env node
/**
 * Test runner.
 *
 * Each suite is a standalone script that prints its own PASS/FAIL lines and exits
 * non-zero on failure, so the runner spawns them as child processes and aggregates
 * the results. Suites stay independent of the runner and of each other, and one
 * crashing cannot take the rest down.
 *
 *   node tests/run.js              all suites except e2e
 *   node tests/run.js frontend     one group
 *   node tests/run.js e2e          needs a running stack (see below)
 *   node tests/run.js --all        every group, e2e included
 *
 * The e2e group talks to a live instance. Point it somewhere with TM_BASE
 * (default http://localhost:8080) and give it the admin password in TM_ADMIN_PW.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const GROUPS = ['backend', 'frontend', 'e2e'];
const DEFAULT_GROUPS = ['backend', 'frontend']; // e2e is opt-in: it needs a stack

const args = process.argv.slice(2);
const wantAll = args.includes('--all');
const named = args.filter(a => !a.startsWith('--'));
const groups = wantAll ? GROUPS : (named.length ? named : DEFAULT_GROUPS);

for (const g of groups) {
    if (!GROUPS.includes(g)) {
        console.error(`Unknown group "${g}". Available: ${GROUPS.join(', ')}`);
        process.exit(2);
    }
}

const BOLD = '\x1b[1m', RED = '\x1b[31m', GREEN = '\x1b[32m', DIM = '\x1b[2m', OFF = '\x1b[0m';

function suitesIn(group) {
    const dir = path.join(__dirname, group);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort()
        .map(f => ({ group, name: f.replace(/\.test\.js$/, ''), file: path.join(dir, f) }));
}

const suites = groups.flatMap(suitesIn);
if (!suites.length) {
    console.error('No suites found.');
    process.exit(2);
}

if (groups.includes('e2e')) {
    const base = process.env.TM_BASE || 'http://localhost:8080';
    console.log(`${DIM}e2e target: ${base}${OFF}`);
    if (!process.env.TM_ADMIN_PW) {
        console.error(`${RED}TM_ADMIN_PW is not set — the e2e suites need the admin password.${OFF}`);
        process.exit(2);
    }
}

const started = Date.now();
const failures = [];

for (const suite of suites) {
    process.stdout.write(`${BOLD}${suite.group}/${suite.name}${OFF} … `);
    const res = spawnSync(process.execPath, [suite.file], {
        encoding: 'utf8',
        env: process.env,
        cwd: path.resolve(__dirname, '..'),
    });
    const output = `${res.stdout || ''}${res.stderr || ''}`;
    // Prefer the suite's own verdict line: stderr is appended after stdout, so a
    // stray warning would otherwise be reported as the result.
    const lines = (res.stdout || '').trim().split('\n').filter(Boolean);
    const verdict = [...lines].reverse().find(l => /PASSED|FAILURE|problem\(s\)|file\(s\)/.test(l));
    const summary = verdict || lines.pop() || '(no output)';

    if (res.status === 0) {
        console.log(`${GREEN}ok${OFF} ${DIM}${summary}${OFF}`);
    } else {
        console.log(`${RED}FAILED${OFF}`);
        failures.push({ suite, output });
    }
}

if (failures.length) {
    for (const { suite, output } of failures) {
        console.log(`\n${RED}${BOLD}── ${suite.group}/${suite.name} ──${OFF}`);
        // Only the failing lines plus the tail, so CI logs stay readable
        const lines = output.split('\n');
        const failed = lines.filter(l => l.includes('FAIL') || l.includes('THREW') || l.includes('Error'));
        console.log(failed.length ? failed.join('\n') : lines.slice(-25).join('\n'));
    }
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(
    failures.length
        ? `\n${RED}${BOLD}${failures.length} of ${suites.length} suites failed${OFF} (${seconds}s)`
        : `\n${GREEN}${BOLD}All ${suites.length} suites passed${OFF} (${seconds}s)`
);
process.exit(failures.length ? 1 : 0);
