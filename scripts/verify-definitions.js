// Go-to-definition against the real script corpus: index every .dsc, then resolve every reference
// the provider would offer a jump from.
//
// The unit tests in src/definitionIndex.test.ts pin the rules. This pins the RESULT on real code,
// which is what caught the two write forms the first version missed -- the `flag` mechanism inside
// `with[...]`, and `- run container.subkey`.
//
// Run: node scripts/verify-definitions.js
const fs = require('fs');
const path = require('path');

const { indexDefinitions, referenceAt, sameName, nameCandidates } = require('../out/definitionIndex');

const CORPUS = 'D:/..........backup/.arukutest/plugins/Denizen/scripts';

let failures = 0;
function check(name, ok, detail) {
    console.log(`${ok ? 'PASS ' : 'FAIL '} ${name}${detail === undefined ? '' : ` -- ${detail}`}`);
    if (!ok) { failures++; }
}

if (!fs.existsSync(CORPUS)) {
    console.log(`SKIPPED -- the corpus is not on this machine (${CORPUS}).`);
    process.exit(0);
}

const files = [];
(function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); }
        else if (entry.name.endsWith('.dsc')) { files.push(full); }
    }
})(CORPUS);

const containers = [];
const flags = [];
const texts = new Map();
for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    texts.set(file, text);
    const symbols = indexDefinitions(text);
    for (const c of symbols.containers) { containers.push({ ...c, file }); }
    for (const f of symbols.flags) { flags.push({ ...f, file }); }
}

check('1. the corpus indexes containers and flag writes',
    containers.length > 30 && flags.length > 30,
    `${files.length} files, ${containers.length} containers, ${flags.length} flag writes`);

/** Every location defining `name`, most-specific candidate first, stopping at the first hit. */
function resolve(kind, name) {
    const pool = kind === 'container' ? containers : flags;
    for (const candidate of nameCandidates(kind, name)) {
        const hits = pool.filter(s => sameName(s.name, candidate));
        if (hits.length > 0) { return hits; }
    }
    return [];
}

let refs = 0, resolved = 0;
const unresolved = [];
for (const [file, text] of texts) {
    const lines = text.replace(/\r/g, '').split('\n');
    for (let i = 0; i < lines.length; i++) {
        const seen = new Set();
        for (let ch = 0; ch <= lines[i].length; ch++) {
            const ref = referenceAt(lines[i], ch);
            if (ref === null) { continue; }
            const key = `${ref.kind}:${ref.name}:${ref.startChar}`;
            if (seen.has(key)) { continue; }
            seen.add(key);
            refs++;
            if (resolve(ref.kind, ref.name).length > 0) { resolved++; }
            else { unresolved.push(`${path.relative(CORPUS, file)}:${i + 1} [${ref.kind}] ${ref.name}`); }
        }
    }
}

const rate = resolved / refs * 100;
console.log(`\n      ${refs} reference(s), ${resolved} resolve (${rate.toFixed(0)}%)`);
console.log(`      unresolved (${unresolved.length}):`);
for (const u of unresolved) { console.log('        ' + u); }
console.log('');

// The ceiling is a REVIEWED number, not an aspiration. Every reference still unresolved at the
// time of writing was checked by hand and is correct to leave alone: five flags that the corpus
// only ever READS (written by another plugin, or in a file not in this folder), one built from a
// tag (`clans.<[clan]>.members`), one script that genuinely does not exist (`- run penis`, which
// the checker also reports as invalid_script_run), and one flag on a definition-held item.
// A DROP below this band means a write form stopped being indexed.
check('2. the resolution rate stays in the reviewed band', rate >= 85,
    `${rate.toFixed(0)}%; reviewed at 90%`);

// 3 -- the two forms that were missing in the first version. Named explicitly so a regression says
// which one broke rather than only moving the percentage.
check('3. the flag MECHANISM inside with[...] is indexed',
    flags.some(f => sameName(f.name, 'pages')) && flags.some(f => sameName(f.name, 'arrow')),
    'pages and arrow are set only by `with[...;flag=name:value]`');

check('4. a dotted script name falls back to its container',
    resolve('container', 'mafiaLobbyWaiting.wait_text').length > 0,
    '`- run mafiaLobbyWaiting.wait_text` resolves to the mafiaLobbyWaiting container');

// 5 -- the jump must land on the NAME, so the editor highlights it rather than a whole line.
const sample = containers.find(c => sameName(c.name, 'mafiaInvitePrompt'));
check('5. a container location covers exactly its name', sample !== undefined
    && texts.get(sample.file).replace(/\r/g, '').split('\n')[sample.line].slice(sample.startChar, sample.endChar) === sample.name,
    sample === undefined ? 'mafiaInvitePrompt not found' : `${path.relative(CORPUS, sample.file)}:${sample.line + 1}`);

// 6 -- a name used by BOTH a flag and a container must resolve to the right one for each kind.
//
// The corpus really contains such a collision (`clan`), which makes it a free fixture rather than
// a hypothetical. Collisions are expected and harmless -- the two are separate namespaces in
// Denizen -- so the property worth checking is not their absence but that resolution keeps them
// apart. MUTANT CAUGHT: picking the symbol pool by anything other than the reference's kind.
const collisions = flags.filter(f => containers.some(c => sameName(c.name, f.name))).map(f => f.name);
const misrouted = collisions.filter(name =>
    resolve('flag', name).some(hit => !flags.includes(hit))
    || resolve('container', name).some(hit => !containers.includes(hit)));
check('6. a name used as both a flag and a container resolves to the right one for each kind',
    misrouted.length === 0,
    collisions.length === 0 ? 'no collisions in the corpus' : `collisions checked: ${[...new Set(collisions)].join(', ')}`);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
