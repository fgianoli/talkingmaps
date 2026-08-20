/**
 * Lightweight structural check for Python sources — no interpreter available here.
 * Catches what scripted edits actually break: unbalanced brackets, mixed indentation,
 * a block header with no body, and stray merge/edit artefacts.
 */
const fs = require('fs');
const path = require('path');

const BACKEND = path.resolve(__dirname, '..', '..', 'backend');

function collectPython(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        if (entry.name === '__pycache__') return [];
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return collectPython(full);
        return entry.name.endsWith('.py') ? [full] : [];
    });
}

const files = collectPython(BACKEND).sort();
let problems = 0;
const report = (f, line, msg) => { console.log(`  ${path.basename(f)}:${line}  ${msg}`); problems++; };

// Strip strings and comments so bracket counting is not fooled by text
function strip(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
        const three = src.slice(i, i + 3);
        if (three === '"""' || three === "'''") {
            const end = src.indexOf(three, i + 3);
            const chunk = src.slice(i, end === -1 ? n : end + 3);
            out += chunk.replace(/[^\n]/g, ' ');
            i = end === -1 ? n : end + 3;
            continue;
        }
        const c = src[i];
        if (c === '"' || c === "'") {
            let j = i + 1;
            while (j < n && src[j] !== c) {
                if (src[j] === '\\') j++;
                if (src[j] === '\n') break;
                j++;
            }
            out += ' '.repeat(j - i + 1);
            i = j + 1;
            continue;
        }
        if (c === '#') {
            const eol = src.indexOf('\n', i);
            const stop = eol === -1 ? n : eol;
            out += ' '.repeat(stop - i);
            i = stop;
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

for (const f of files) {
    const src = fs.readFileSync(f, 'utf8').split('\r\n').join('\n');
    const bare = strip(src);
    const lines = src.split('\n');
    const bareLines = bare.split('\n');

    // 1. Bracket balance
    const stack = [];
    const pairs = { ')': '(', ']': '[', '}': '{' };
    bareLines.forEach((l, idx) => {
        for (const ch of l) {
            if ('([{'.includes(ch)) stack.push({ ch, line: idx + 1 });
            else if (')]}'.includes(ch)) {
                const top = stack.pop();
                if (!top || top.ch !== pairs[ch]) report(f, idx + 1, `unbalanced '${ch}'`);
            }
        }
    });
    if (stack.length) report(f, stack[stack.length - 1].line, `unclosed '${stack[stack.length - 1].ch}'`);

    // 2. Tabs in indentation
    lines.forEach((l, idx) => {
        if (/^[ ]*\t/.test(l)) report(f, idx + 1, 'tab in indentation');
    });

    // 3. A block header must be followed by a deeper-indented line
    bareLines.forEach((l, idx) => {
        if (!/:\s*$/.test(l)) return;
        if (!/^\s*(def |async def |class |if |elif |else|for |while |try|except|finally|with )/.test(l)) return;
        const indent = l.match(/^\s*/)[0].length;
        for (let k = idx + 1; k < bareLines.length; k++) {
            const next = bareLines[k];
            if (!next.trim()) continue;
            const nextIndent = next.match(/^\s*/)[0].length;
            if (nextIndent <= indent) report(f, idx + 1, `block header has no body: ${l.trim().slice(0, 60)}`);
            break;
        }
    });

    // 4. Edit artefacts
    lines.forEach((l, idx) => {
        if (/^(<<<<<<<|=======$|>>>>>>>)/.test(l)) report(f, idx + 1, 'merge conflict marker');
        if (/\bNOT FOUND\b|\bNOT UNIQUE\b/.test(l)) report(f, idx + 1, 'script artefact left in file');
    });

    // 5. Duplicate route decorators for the same method+path
    const routes = new Map();
    lines.forEach((l, idx) => {
        const m = l.match(/@router\.(get|post|put|delete|patch)\("([^"]*)"\)/);
        if (!m) return;
        const key = `${m[1]} ${m[2]}`;
        if (routes.has(key)) report(f, idx + 1, `duplicate route ${key} (also line ${routes.get(key)})`);
        else routes.set(key, idx + 1);
    });
}

console.log(problems ? `\n${problems} structural problem(s)` : `\nNo structural problems in ${files.length} Python file(s)`);
process.exit(problems ? 1 : 0);
