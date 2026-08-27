/**
 * Live verification for Phase 2C-7: `checkAllContainers` Part B
 * (ScriptChecker.cs:1146-1319) and the event-matching stack underneath it.
 *
 * WHY THIS EXISTS ALONGSIDE THE UNIT SUITE. containerChecksPartB.test.ts runs against a
 * hand-built miniature meta -- three events, two actions -- which is the right way to test the
 * branching, and the wrong way to find out whether the port agrees with 399 real documented
 * events. Everything here runs against the LIVE meta and the real Minecraft enum data:
 *
 *   - Checks 1-2 are the port's own consistency: every documented event format must compile to
 *     could-matchers with no parse errors, and every documented event must then MATCH ITS OWN
 *     documented name. That second one is the strongest single check in this file -- it exercises
 *     the whole stack (paren expansion, validators, advanced matcher, scoring) against 490 real
 *     inputs whose correct answer is known by construction.
 *   - Check 3 is the same for actions and their regexes.
 *   - Checks 4-6 are the false-positive gate on the user's real corpus, where a regression would
 *     show up as event lines they actually wrote being reported missing.
 *   - Check 7 proves the cold-start guards: no meta must mean no Part B findings, not a crash.
 *
 * Run with: node scripts/verify-phase2c7.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadMetaDocs, DEFAULT_META_SOURCES } = require('../out/server/metaDocs/metaDocsManager');
const { loadExtraData } = require('../out/server/metaDocs/extraData');
const { linkEventMatchers } = require('../out/server/metaDocs/metaLinker');
const { ScriptChecker } = require('../out/server/checker/scriptChecker');
const { separateSwitches } = require('../out/server/checker/eventTools');

function check(label, condition, detail) {
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
    return condition ? 0 : 1;
}

const CORPUS = 'D:/..........backup/.arukutest/plugins/Denizen/scripts';

function walk(dir, acc) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(p, acc); }
        else if (entry.name.endsWith('.dsc')) { acc.push(p); }
    }
    return acc;
}

async function main() {
    let failures = 0;
    const [docs, extra] = await Promise.all([
        loadMetaDocs({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2c7-verify-cache.json'), ttlMs: 12 * 36e5, sources: DEFAULT_META_SOURCES }),
        loadExtraData({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2c7-extra-cache.json'), ttlMs: 12 * 36e5 })
    ]);

    // ------------------------------------------------- 1: every format compiles
    const errorsBefore = docs.loadErrors.length;
    linkEventMatchers(docs, extra);
    const parseErrors = docs.loadErrors.length - errorsBefore;
    let formats = 0, matchers = 0;
    for (const evt of docs.events.values()) {
        formats += evt.events.length;
        matchers += evt.couldMatchers.length;
    }
    failures += check('1. every documented event format compiles to could-matchers',
        parseErrors === 0 && matchers >= formats,
        `${formats} formats -> ${matchers} matchers, ${parseErrors} parse errors`);

    // ------------------------------------------------- 2: every matcher accepts an instance of itself
    // For each could-matcher, build the event line a user would actually write for it, and check
    // the matcher accepts it. Two substitutions are needed, and NEITHER can use the cleaned name:
    //   - `a|b|c` is an alternation, so the line carries ONE of the options. The cleaned name keeps
    //     the pipes verbatim, which is why an earlier version of this check failed on all 31 events
    //     with an alternation in their format -- the premise was wrong, not the matcher.
    //   - `<block>` is a fill-in, so the line carries a real block name.
    // A quoted `<'label'>` accepts anything, so any word does.
    const SAMPLE = {
        entity: 'zombie', projectile: 'zombie', hanging: 'zombie', vehicle: 'zombie',
        item: 'stick', inventory: 'chest', block: 'stone', material: 'stone',
        area: 'cuboid', world: 'world'
    };
    for (const [type, word] of Object.entries(SAMPLE)) {
        const known = extra.entities.has(word) || extra.items.has(word) || extra.blocks.has(word)
            || ['chest', 'cuboid', 'world'].includes(word);
        if (!known) { console.log(`  NOTE sample word '${word}' for <${type}> is not in the enum data`); }
    }
    function instanceOf(part) {
        if (part.startsWith('<') && part.endsWith('>')) {
            const inner = part.slice(1, -1);
            if (inner.startsWith("'")) { return 'anything'; }
            return SAMPLE[inner] !== undefined ? SAMPLE[inner] : 'anything';
        }
        return part.includes('|') ? part.split('|')[0] : part;
    }
    let selfMatched = 0, selfTotal = 0;
    const selfFailed = [];
    for (const evt of docs.events.values()) {
        for (const matcher of evt.couldMatchers) {
            selfTotal++;
            const parts = matcher.parts.filter(p => p.length > 0).map(instanceOf);
            if (matcher.tryMatch(parts, false, false) > 0) { selfMatched++; }
            else { selfFailed.push(`${matcher.format}  <-  ${parts.join(' ')}`); }
        }
    }
    failures += check('2. every could-matcher accepts a canonical instance of its own format',
        selfFailed.length === 0,
        `${selfMatched}/${selfTotal} matched${selfFailed.length ? `; first misses: ${selfFailed.slice(0, 5).join(' | ')}` : ''}`);

    // ------------------------------------------------- 3: every action resolves
    // Exactly what the assignment branch does: exact lookup, then the regex fallback.
    let actionOk = 0, actionFailed = [];
    for (const act of docs.actions.values()) {
        for (const name of act.cleanActions) {
            const full = 'on ' + name;
            const hit = docs.actions.has(full)
                || [...docs.actions.values()].some(a => a.regexMatcher !== null && a.regexMatcher.test(full));
            if (hit) { actionOk++; } else { actionFailed.push(full); }
        }
    }
    failures += check('3. every documented action resolves through the exact-or-regex lookup',
        actionFailed.length === 0,
        `${actionOk} names${actionFailed.length ? `; first misses: ${actionFailed.slice(0, 5).join(' | ')}` : ''}`);

    // ------------------------------------------------- 4-6: the real corpus
    const files = walk(CORPUS, []);
    let lines = 0, findings = 0, crashes = 0, worlds = 0, eventLines = 0;
    const byKey = new Map();
    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        lines += text.split('\n').length;
        const checker = new ScriptChecker(text);
        checker.meta = docs;
        checker.extraData = extra;
        try { checker.run(); }
        catch (e) { crashes++; console.log(`  CRASH ${file}: ${e.message}`); continue; }
        for (const script of checker.generatedWorkspace.scripts.values()) {
            const type = script.keys.get('type');
            if (type && type.value && type.value.text === 'world') {
                worlds++;
                const events = script.keys.get('events');
                if (events && events.value instanceof Map) { eventLines += events.value.size; }
            }
        }
        for (const w of [...checker.errors, ...checker.warnings, ...checker.minorWarnings, ...checker.infos]) {
            findings++;
            byKey.set(w.warningUniqueKey, (byKey.get(w.warningUniqueKey) || 0) + 1);
        }
    }
    failures += check('4. the corpus still parses without crashing', crashes === 0, `${files.length} files, ${lines} lines`);
    // THE FALSE-POSITIVE GATE. These are event lines the user actually wrote and runs, so every
    // one of them is by definition a real event -- any `event_missing` here is the port's fault,
    // not theirs. Same for the switch keys.
    const eventFindings = (byKey.get('event_missing') || 0) + (byKey.get('unknown_switch') || 0)
        + (byKey.get('bad_switch_value') || 0) + (byKey.get('event_object_notation') || 0);
    failures += check('5. no Part B world findings on the real corpus',
        eventFindings === 0,
        `${worlds} world containers, ${eventLines} event lines, ${eventFindings} findings`);
    const rate = findings / lines * 100;
    failures += check('6. corpus finding rate stays in the reviewed band',
        rate <= 6, `${rate.toFixed(2)}% of lines (${findings} findings across ${lines}); reviewed snapshots ran 3.44-4.10%`);

    // ------------------------------------------------- 7: cold start
    // Part B must degrade to "check nothing" without meta, NOT throw -- a throw would be caught by
    // the per-container handler and surface as `exception_internal`, replacing every real finding
    // in that container with an internal error.
    const coldScript = [
        'my_cold_start_world_script:', '    type: world', '    events:',
        '        on totally nonexistent event thing nonsense_switch:x:', '        - narrate hi'
    ].join('\n');
    const cold = new ScriptChecker(coldScript);
    cold.run();
    const coldKeys = [...cold.errors, ...cold.warnings, ...cold.minorWarnings].map(w => w.warningUniqueKey);
    failures += check('7. no meta means no Part B findings and no internal exception',
        !coldKeys.includes('event_missing') && !coldKeys.includes('unknown_switch') && !coldKeys.includes('exception_internal'),
        coldKeys.join(',') || '(nothing)');

    // ------------------------------------------------- 8: switches separate as documented
    // `not_switches` is live data, so this is worth asserting against the real set rather than a
    // fixture: a prefix listed there must stay part of the event line.
    const separated = separateSwitches(docs, 'player breaks item_flagged:cool priority:5');
    failures += check('8. not_switches keeps a documented prefix out of the switch list',
        separated.cleaned === 'player breaks item_flagged:cool' && separated.switches.length === 1,
        `cleaned='${separated.cleaned}', switches=${JSON.stringify(separated.switches)}`);

    console.log('\nFindings by key:');
    for (const [key, count] of [...byKey].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(count).padStart(4)}  ${key}`);
    }
    console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} CHECK(S) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
