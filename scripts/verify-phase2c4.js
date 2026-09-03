/**
 * Live verification for Phase 2C-4: loads real Denizen meta over the network (the same way the
 * server does on startup) and exercises the tag/argument checking layer built in this phase --
 * `checkSingleTag`, `checkSingleArgument`, `checkSingleDataLine` and `containsObjectNotation`
 * (src/server/checker/tagChecks.ts), plus the tag tracer diagnostics restored in Task 1.
 *
 * NOTHING IN THIS PHASE REACHES THE USER YET. These functions are driven by
 * `CheckAllContainers`, which is Phase 2C-6. This script calls them directly.
 *
 * The unit suite pins each branch against a hand-built meta fixture small enough to reason
 * about. What it CANNOT prove is the thing that decides whether this phase is shippable: how
 * these checks behave against the REAL 2500-tag meta and against real scripts. A fixture with
 * four tags will never tell you that `<player.location.block.material>` resolves; only live meta
 * will. Check 1 and check 6 below are the ones that matter.
 *
 * Run with: node scripts/verify-phase2c4.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadMetaDocs, DEFAULT_META_SOURCES } = require('../out/server/metaDocs/metaDocsManager');
const { ScriptChecker } = require('../out/server/checker/scriptChecker');
const { ScriptCheckContext, checkSingleTag, checkSingleArgument, containsObjectNotation } = require('../out/server/checker/tagChecks');
const { buildArgs } = require('../out/server/checker/buildArgs');

function check(label, condition, detail) {
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
    return condition ? 0 : 1;
}

/** The user's own scripts, used as the false-positive corpus. */
const CORPUS = 'D:/..........backup/.arukutest/plugins/Denizen/scripts';

let META = null;

/** Runs checkSingleTag over one tag with live meta, returning the raised keys and messages. */
function tag(text, context = null) {
    const checker = new ScriptChecker('- narrate placeholder');
    checker.meta = META;
    checkSingleTag(checker, 0, 0, text, context);
    return {
        keys: [...checker.warnings, ...checker.minorWarnings].map(w => w.warningUniqueKey),
        messages: [...checker.warnings, ...checker.minorWarnings].map(w => w.customMessageForm),
        checker
    };
}

function contextWith(defs = [], saves = []) {
    const c = new ScriptCheckContext();
    for (const d of defs) { c.definitions.add(d); }
    for (const s of saves) { c.saveEntries.add(s); }
    return c;
}

function walk(dir, acc) {
    acc = acc || [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p, acc); } else if (e.name.endsWith('.dsc')) { acc.push(p); }
    }
    return acc;
}

loadMetaDocs({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2c4-verify-cache.json'), ttlMs: 12 * 60 * 60 * 1000, sources: DEFAULT_META_SOURCES }).then(docs => {
    META = docs;
    console.log(`Loaded ${docs.commands.size} commands, ${docs.tags.size} tags, ${docs.tagBases.size} tag bases, ${docs.tagParts.size} tag parts, ${docs.loadErrors.length} meta error(s).`);
    let failures = 0;

    failures += check('precondition: real meta actually loaded', docs.tags.size > 1000, `${docs.tags.size} tags`);
    failures += check('precondition: tag bases and parts are indexed', docs.tagBases.size > 0 && docs.tagParts.size > 0,
        `${docs.tagBases.size} bases, ${docs.tagParts.size} parts`);

    // ------------------------------------------------------------------------------------
    // 1. REAL TAGS MUST BE SILENT. Against a four-tag fixture "no warning" proves nothing;
    //    against the real meta it is the whole question. Every tag below is one a Denizen author
    //    would actually write.
    // ------------------------------------------------------------------------------------
    const CLEAN_TAGS = [
        'player.name',
        'player.location',
        'player.location.block.material',
        'player.uuid',
        'player.has_flag[greeted]',
        'player.flag[greeted]',
        'server.has_flag[clans]',
        'util.time_now',
        'list[a|b|c].size',
        'player.item_in_hand.material.name',
        'player.location.find_players_within[10]',
        'element[hello].to_uppercase',
        'queue.id',
        'script.name'
    ];
    let cleanFailures = [];
    for (const t of CLEAN_TAGS) {
        const r = tag(t);
        if (r.keys.length > 0) { cleanFailures.push(`<${t}> -> ${r.keys.join(',')} :: ${r.messages[0]}`); }
    }
    failures += check(`all ${CLEAN_TAGS.length} realistic tags are silent against live meta`,
        cleanFailures.length === 0, cleanFailures.length ? '\n      ' + cleanFailures.join('\n      ') : '');

    // ------------------------------------------------------------------------------------
    // 2. EACH WARNING KEY FIRES ON A GENUINELY BAD TAG.
    // ------------------------------------------------------------------------------------
    failures += check('a nonsense tag base yields bad_tag_base',
        tag('nosuchbasename.foo').keys.includes('bad_tag_base'), tag('nosuchbasename.foo').keys.join(','));

    // The user's own reported case, from mafia/commands/test.dsc.
    const garbage = tag('player.as_biome.asd');
    failures += check("the user's reported garbage tag <player.as_biome.asd> is diagnosed",
        garbage.keys.length > 0, garbage.keys.join(',') + ' :: ' + (garbage.messages[0] || ''));

    failures += check('a bad tag PART yields bad_tag_part',
        tag('player.nosuchpartname').keys.includes('bad_tag_part'), tag('player.nosuchpartname').keys.join(','));

    // ------------------------------------------------------------------------------------
    // 3. DEFINITIONS AND SAVE ENTRIES -- the checks the user is actually waiting for.
    // ------------------------------------------------------------------------------------
    failures += check('<[undefined]> with a context that does not know it yields def_of_nothing',
        tag('[undefined]', contextWith(['known'])).keys.includes('def_of_nothing'));
    failures += check('<[known]> is silent',
        tag('[known]', contextWith(['known'])).keys.length === 0, tag('[known]', contextWith(['known'])).keys.join(','));
    failures += check('<[known.sub]> is silent -- the name is cut at the first dot',
        tag('[known.sub]', contextWith(['known'])).keys.length === 0);
    failures += check('hasUnknowableDefinitions silences def_of_nothing entirely', (() => {
        const c = contextWith([]);
        c.hasUnknowableDefinitions = true;
        return tag('[undefined]', c).keys.length === 0;
    })());

    // A CYRILLIC definition name must resolve. ToLowerFast is ASCII-only, so a Unicode fold here
    // would look the name up under something nothing ever stored -- and this user's scripts are
    // full of Cyrillic. This was a real bug in the first implementation.
    failures += check('a CYRILLIC definition name resolves (ASCII-only folding, as ToLowerFast)',
        tag('[ИМЯ]', contextWith(['ИМЯ'])).keys.length === 0,
        tag('[ИМЯ]', contextWith(['ИМЯ'])).keys.join(',') || 'silent');

    failures += check('<entry[missing].thing> yields entry_of_nothing',
        tag('entry[missing].thing', contextWith([], ['known'])).keys.includes('entry_of_nothing'));
    failures += check('<entry[known].spawned_entity> is silent -- the first part after entry is exempt',
        tag('entry[known].spawned_entity', contextWith([], ['known'])).keys.length === 0,
        tag('entry[known].spawned_entity', contextWith([], ['known'])).keys.join(','));

    // ------------------------------------------------------------------------------------
    // 4. THE context EXEMPTION. `<context.whatever>` is the commonest construct in a world
    //    script and its key cannot be known from meta, so the FIRST part after it is exempt --
    //    and only the first.
    // ------------------------------------------------------------------------------------
    failures += check('<context.anything> is silent', tag('context.anything').keys.length === 0,
        tag('context.anything').keys.join(','));
    failures += check('<context.anything.nosuchpart> still reports the SECOND part',
        tag('context.anything.nosuchpart').keys.includes('bad_tag_part'));

    // ------------------------------------------------------------------------------------
    // 5. THE TRACER DIAGNOSTICS, restored in Task 1 and wired here.
    // ------------------------------------------------------------------------------------
    const traced = tag('player.name[somethingitcannottake]');
    failures += check('a tag part given a parameter it cannot take yields tag_trace_failure',
        traced.keys.includes('tag_trace_failure'), traced.keys.join(',') + ' :: ' + (traced.messages.find(m => m.startsWith('Tag tracer:')) || ''));

    // ------------------------------------------------------------------------------------
    // 6. THE FALSE-POSITIVE SWEEP. Run every tag in the user's real scripts through the checker
    //    with a permissive context, and count what comes out. This is the closest this phase can
    //    get to the real thing before Phase 2C-6 wires it in, and it is the check that decides
    //    whether the phase is safe to build on.
    //
    //    Definitions and save entries are NOT known here (building them per container is 2C-6's
    //    job), so the context is marked unknowable for both -- otherwise every <[x]> in the
    //    corpus would report and drown the signal being measured.
    // ------------------------------------------------------------------------------------
    if (!fs.existsSync(CORPUS)) {
        console.log(`SKIP  corpus sweep -- ${CORPUS} not present`);
    }
    else {
        const permissive = new ScriptCheckContext();
        permissive.hasUnknowableDefinitions = true;
        permissive.hasUnknowableSaveEntries = true;
        const byKey = new Map();
        const samples = [];
        let tagCount = 0, lineCount = 0;
        for (const file of walk(CORPUS).sort()) {
            const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                const text = lines[i];
                const trimmed = text.trim();
                if (!trimmed.startsWith('- ') || !trimmed.includes('<')) { continue; }
                lineCount++;
                const checker = new ScriptChecker(text);
                checker.meta = META;
                // SPLIT INTO ARGUMENTS FIRST, exactly as CheckSingleCommand does
                // (ScriptChecker.cs:797 onwards): command name, then BuildArgs over the rest,
                // then one checkSingleArgument per argument.
                //
                // Passing the whole line as ONE argument -- which an earlier version of this
                // sweep did -- produces a flood of false uneven_tags, because Denizen's
                // comparison operators are `<` and `>`: `- if <[t]> < 0.5:` has two '<' and one
                // '>' when read whole. Split properly it is three arguments -- `<[t]>` (balanced),
                // `<` (length 1, below the :589 gate) and `0.5:` -- and none of them warns. That
                // was a defect in this harness, not in the checker, and it accounted for 17 of
                // the 27 findings the first run reported.
                const [cmdName, argText] = (() => {
                    const body = trimmed.slice(2).trim();
                    const sp = body.indexOf(' ');
                    return sp < 0 ? [body, ''] : [body.slice(0, sp), body.slice(sp + 1)];
                })();
                void cmdName;
                for (const arg of buildArgs(i, 0, argText, null)) {
                    checkSingleArgument(checker, i, arg.startChar, arg.text, permissive, false,
                        (l, s, t, c) => { tagCount++; checkSingleTag(checker, l, s, t, c); });
                }
                for (const w of [...checker.warnings, ...checker.minorWarnings]) {
                    byKey.set(w.warningUniqueKey, (byKey.get(w.warningUniqueKey) || 0) + 1);
                    if (samples.length < 25) {
                        samples.push(`${path.relative(CORPUS, file).split(path.sep).join('/')}:${i + 1}  [${w.warningUniqueKey}]  ${JSON.stringify(trimmed.slice(0, 90))}`);
                    }
                }
            }
        }
        const total = [...byKey.values()].reduce((a, b) => a + b, 0);
        console.log(`\n  corpus sweep: ${lineCount} command lines containing tags, ${tagCount} tags checked`);
        for (const [k, n] of [...byKey].sort((a, b) => b[1] - a[1])) { console.log(`    ${String(n).padStart(4)}  ${k}`); }
        if (samples.length) { console.log('  first findings:'); for (const s of samples) { console.log('    ' + s); } }
        console.log('');
        // Not asserted as zero: some of the user's scripts are deliberately broken, and one file
        // is a hand-built defect fixture. Asserted as a RATE, so a regression that starts warning
        // about everything fails loudly while the known-bad handful does not.
        const rate = tagCount === 0 ? 1 : total / tagCount;
        failures += check('fewer than 5% of real tags draw a warning (a false-positive rate check, not a zero check)',
            rate < 0.05, `${total} warnings over ${tagCount} tags = ${(rate * 100).toFixed(1)}%`);
    }

    // ------------------------------------------------------------------------------------
    // 7. containsObjectNotation against live-looking input.
    // ------------------------------------------------------------------------------------
    failures += check('raw object notation is found', JSON.stringify(containsObjectNotation('e@1234')) === JSON.stringify({ start: 0, end: 1 }));
    failures += check('a normal tag is not object notation', containsObjectNotation('<player.name>') === null);

    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}).catch(err => {
    console.error('Verification failed to run:', err);
    process.exit(1);
});
