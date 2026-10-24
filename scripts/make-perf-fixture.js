// Builds a large .dsc for the performance baseline (R2) out of the user's real scripts.
//
//   node scripts/make-perf-fixture.js [corpusDir] [targetLines=3000]
//
// Writes .superpowers/perf/big.dsc -- gitignored ON PURPOSE: the corpus is the user's private
// server scripts, so nothing derived from it is ever committed.
//
// WHY RENAME. One file holding many files' containers declares some names more than once -- both
// across copies and within the corpus itself (five scratch files each define `My_task`) -- and the
// checker would then spend the benchmark reporting `duplicate_script` instead of doing its normal
// work. So every file chunk suffixes its own container names with `_c<n>`, everywhere the name
// appears as a whole word in that chunk, so `- run name`, `inject` and `<script[name]>` inside it
// keep pointing at a container that exists. References to another file's containers are left
// alone; the benchmark checks without workspace data, so they are never resolved either way.
// bench-server.js refuses to report if a duplicate slips through anyway.

const fs = require('fs');
const path = require('path');
const { findScriptFiles } = require('../out/server/workspaceTracker');

const corpus = process.argv[2] || 'D:/..........backup/.arukutest/plugins/Denizen/scripts';
const target = Number(process.argv[3] || 3000);
const out = path.join(__dirname, '..', '.superpowers', 'perf', 'big.dsc');

if (!fs.existsSync(corpus)) {
    console.error(`Corpus folder not found: ${corpus}\nPass the folder holding your .dsc scripts as the first argument.`);
    process.exit(1);
}
const files = findScriptFiles(corpus);
if (files.length === 0) {
    console.error(`No .dsc files under ${corpus}.`);
    process.exit(1);
}
const texts = files.map(f => fs.readFileSync(f, 'utf8'));
const eol = texts.some(t => t.includes('\r\n')) ? '\r\n' : '\n';
const CONTAINER = /^([A-Za-z0-9_]+):\s*$/;

const chunks = [];
let lines = 0;
let containers = 0;
while (lines < target) {
    for (const text of texts) {
        if (lines >= target) {
            break;
        }
        const body = text.split(/\r?\n/);
        const names = body.map(l => CONTAINER.exec(l)).filter(m => m !== null).map(m => m[1]);
        containers += names.length;
        let renamed = body.join(eol);
        if (names.length > 0) {
            const pattern = new RegExp(`(?<![A-Za-z0-9_])(${names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![A-Za-z0-9_])`, 'g');
            renamed = renamed.replace(pattern, `$1_c${chunks.length}`);
        }
        chunks.push(renamed);
        lines += body.length;
    }
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, chunks.join(eol));
console.log(`${out}: ${lines} lines, ${containers} containers, from ${files.length} files`);
