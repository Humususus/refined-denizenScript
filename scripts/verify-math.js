// The offline math evaluator against the real script corpus.
//
// The unit tests pin the arithmetic. This pins the PROMISE the interface makes: when the evaluator
// says "needs these values", supplying them must actually produce a number. An earlier version
// broke that promise on the user's own scripts -- it asked for `members` in
// `<[members].size.div[3]>` and would then have choked on `.size` whatever was typed.
//
// Run: node scripts/verify-math.js
const fs = require('fs');
const path = require('path');

const { evaluateMathTag, looksArithmetic } = require('../out/mathEval');
const { findTagAt } = require('../out/tagFormatter');

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

/** Every distinct arithmetic tag in the corpus, with where it was found. */
const found = [];
for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').replace(/\r/g, '').split('\n');
    for (let i = 0; i < lines.length; i++) {
        const seen = new Set();
        for (let ch = 0; ch < lines[i].length; ch++) {
            const tag = findTagAt(lines[i], ch);
            if (tag === null || seen.has(tag.start)) { continue; }
            seen.add(tag.start);
            if (looksArithmetic(tag.text)) {
                found.push({ text: tag.text, where: `${path.relative(CORPUS, file)}:${i + 1}` });
            }
        }
    }
}

check('1. the corpus contains arithmetic to test against', found.length > 20,
    `${files.length} files, ${found.length} arithmetic tag(s)`);

// 2 -- nothing may crash. The evaluator walks arbitrary user text.
let crashes = [];
for (const item of found) {
    try { evaluateMathTag(item.text); }
    catch (ex) { crashes.push(`${item.where}: ${ex.message}`); }
}
check('2. no expression crashes the evaluator', crashes.length === 0, crashes.slice(0, 3).join(' | ') || 'none');

// 3 -- THE PROMISE. Supply a value for everything asked for, repeatedly, and the result must
// become a number. Looping because supplying one value can reveal the next.
const broken = [];
let resolved = 0;
for (const item of found) {
    const supplied = new Map();
    let result = evaluateMathTag(item.text, supplied);
    for (let round = 0; round < 32 && result.kind === 'needs-input'; round++) {
        for (const name of result.inputs) {
            // 2 rather than 1: it survives a `div`, and unlike 0 it does not hide a mistake by
            // making everything collapse to zero.
            supplied.set(name, 2);
        }
        result = evaluateMathTag(item.text, supplied);
    }
    // "Undefined for these values" IS a completed evaluation, not a broken promise. Substituting 2
    // into an easing curve written for 0..1 genuinely produces `sqrt` of a negative, and Denizen
    // returns null there too. What must not happen is being left asking for more input, or being
    // told the expression is not arithmetic after all.
    const undefinedResult = result.kind === 'unsupported' && result.reason.startsWith('Undefined');
    if (result.kind === 'value' || undefinedResult) { resolved++; }
    else { broken.push(`${item.where} ${item.text} -> ${result.kind}${result.kind === 'unsupported' ? ` (${result.reason})` : ''}`); }
}
check('3. every expression completes once its inputs are supplied', broken.length === 0,
    broken.slice(0, 5).join(' | ') || `${resolved}/${found.length}`);

// 4 -- and the inputs asked for are ones a person can recognise: each must appear in the tag text.
const unrecognisable = [];
for (const item of found) {
    const result = evaluateMathTag(item.text);
    if (result.kind !== 'needs-input') { continue; }
    for (const name of result.inputs) {
        // Compared case-insensitively: parseTag lowercases, so `<[membersList]>` is reported as
        // `[memberslist]`. Denizen matches names case-insensitively too, so this is cosmetic.
        if (!item.text.toLowerCase().includes(name.toLowerCase())) {
            unrecognisable.push(`${item.where}: asked for "${name}", not in ${item.text}`);
        }
    }
}
check('4. every requested input is visible in the expression itself', unrecognisable.length === 0,
    unrecognisable.slice(0, 3).join(' | ') || 'all recognisable');

// 5 -- a constant expression evaluates with no input at all, which is the hover's whole point.
const constant = evaluateMathTag('<element[1].sub[<element[2].mul[3]>]>');
check('5. a fully constant expression needs nothing and evaluates', constant.kind === 'value' && constant.value === -5,
    constant.kind === 'value' ? `= ${constant.display}` : constant.kind);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
