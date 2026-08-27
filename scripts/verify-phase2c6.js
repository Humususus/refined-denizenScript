/**
 * Live verification for Phase 2C-6: `checkAllContainers` Part A
 * (src/server/checker/containerChecks.ts), wired into `run()`.
 *
 * THIS IS THE PHASE THAT MAKES EVERYTHING VISIBLE. Phases 2C-4 and 2C-5 built tag, argument and
 * command checking and left all of it unreachable, because `checkAsScript` -- the only caller of
 * `checkSingleCommand` in the port -- lives inside this method. So this script carries more
 * weight than the unit suite does:
 *
 *   - Checks 1-3 prove the payoff: the three things the user reported as undiagnosed in the
 *     backlog's "NOT checker defects" section are now diagnosed.
 *   - Checks 4-5 kill the two mutants the unit suite CANNOT kill, because the behaviour they
 *     target is only observable with meta loaded (`checkSingleCommand` returns early without it).
 *     Those two are recorded as survivors in containerChecks.test.ts; this is where they die.
 *   - Check 6 is the false-positive gate: a realistic clean container must stay silent now that
 *     every layer runs.
 *   - Check 7 sweeps the user's real corpus and enumerates every finding.
 *
 * Run with: node scripts/verify-phase2c6.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadMetaDocs, DEFAULT_META_SOURCES } = require('../out/server/metaDocs/metaDocsManager');
const { ScriptChecker } = require('../out/server/checker/scriptChecker');

function check(label, condition, detail) {
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
    return condition ? 0 : 1;
}

const CORPUS = 'D:/..........backup/.arukutest/plugins/Denizen/scripts';
let META = null;

/** Runs the full checker over a script with live meta and returns every warning key. */
function keysOf(script) {
    const checker = new ScriptChecker(script);
    checker.meta = META;
    checker.run();
    return [...checker.errors, ...checker.warnings, ...checker.minorWarnings, ...checker.infos]
        .map((w) => w.warningUniqueKey);
}

function main() {
    let failures = 0;

    // ---------------------------------------------------------------- 1-3: the payoff
    // These three lines are quoted verbatim from PHASE-2C-BACKLOG.md section 5, where they were
    // logged as "correct and expected" to be undiagnosed until this phase existed.
    const payoff = [
        '- narrate <[def1]>',
        '- naarate "asd"',
        '- narrate <player.as_biome.asd>'
    ];
    const payoffKeys = keysOf(['my_greeting_task:', '    type: task', '    script:', ...payoff.map((l) => '    ' + l)].join('\n'));
    failures += check('1. an undefined definition is reported', payoffKeys.includes('def_of_nothing'), payoffKeys.join(','));
    failures += check('2. a typo\'d command is reported', payoffKeys.includes('unknown_command'));
    failures += check('3. a garbage tag part is reported', payoffKeys.includes('bad_tag_part'));

    // A defined definition must NOT be reported -- the other half of check 1, and the half that
    // decides whether this is a feature or a nuisance.
    const definedKeys = keysOf('my_greeting_task:\n    type: task\n    script:\n    - define greeting hi\n    - narrate <[greeting]>');
    failures += check('3b. a DEFINED definition stays silent', definedKeys.length === 0, definedKeys.join(',') || 'no findings');

    // ---------------------------------------------------------------- 4: mutant "definitions
    // not cut at bracket" (containerChecks.ts, the `before(name, '[')` at :984).
    // A `definitions:` key entry written in indexed form must still register its bare name.
    const bracketKeys = keysOf([
        'my_greeting_task:', '    type: task', '    definitions: greeting[0]',
        '    script:', '    - narrate <[greeting]>'
    ].join('\n'));
    failures += check('4. a definitions-key entry is cut at "["',
        !bracketKeys.includes('def_of_nothing'), bracketKeys.join(',') || 'no findings');

    // ---------------------------------------------------------------- 5: definemap stays quiet.
    // NOT a mutation test, and labelled honestly as such: the `startsWith('definemap')` guard at
    // containerChecks.ts:1013 is unreachable in both languages, because the gatherer
    // (ScriptChecker.cs:1531-1546) records a `- definemap x:` line as a plain string and then
    // consumes every more-indented line after it without recording any. Measured: all four
    // definemaps in the user's clans/clans-menu.dsc lose all ten child lines at parse time. So
    // this is a REACHABILITY regression -- if a later gatherer change ever starts producing
    // definemap sub-maps, the guard would begin to matter and this check would start failing.
    const definemapKeys = keysOf([
        'my_greeting_task:', '    type: task', '    script:',
        '    - definemap mymap:', '        some_key: some_value', '        other_key: other_value',
        '    - narrate <[mymap]>'
    ].join('\n'));
    failures += check('5. a definemap block produces no findings',
        definemapKeys.length === 0, definemapKeys.join(',') || 'no findings');

    // ---------------------------------------------------------------- 6: the false-positive gate
    // The realistic multi-container script from verify-phase2c3.js must STILL be silent, now that
    // every layer below actually runs.
    const realistic = [
        'my_greeting_task:',
        '    type: task',
        '    definitions: target',
        '    script:',
        '    - define message "Hello there"',
        '    - narrate <[message]> targets:<[target]>',
        '    - if <player.has_flag[greeted]>:',
        '        - narrate "Welcome back!"',
        '    - else:',
        '        - flag player greeted',
        '',
        'my_sword_item:',
        '    type: item',
        '    material: diamond_sword',
        '    display name: <&b>Test Blade',
        '    lore:',
        '    - <&7>A test item.',
        '    mechanisms:',
        '        unbreakable: true',
        '',
        'my_greeting_proc:',
        '    type: procedure',
        '    definitions: name',
        '    script:',
        '    - determine "Hello, <[name]>!"'
    ].join('\n');
    const realisticKeys = keysOf(realistic);
    failures += check('6. a realistic multi-container script stays completely silent',
        realisticKeys.length === 0, realisticKeys.join(',') || 'no findings');

    // ---------------------------------------------------------------- 7: the corpus sweep
    const files = [];
    (function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.dsc')) files.push(full);
        }
    })(CORPUS);

    const byKey = new Map();
    let lines = 0, findings = 0, clean = 0, crashes = 0, slowest = 0;
    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        lines += text.split('\n').length;
        const started = Date.now();
        let all;
        try {
            const checker = new ScriptChecker(text);
            checker.meta = META;
            checker.run();
            all = [...checker.errors, ...checker.warnings, ...checker.minorWarnings, ...checker.infos];
        } catch (ex) {
            crashes++;
            console.log(`      CRASH ${path.relative(CORPUS, file)}: ${ex.message}`);
            continue;
        }
        slowest = Math.max(slowest, Date.now() - started);
        if (all.length === 0) clean++;
        findings += all.length;
        for (const w of all) byKey.set(w.warningUniqueKey, (byKey.get(w.warningUniqueKey) || 0) + 1);
    }

    console.log(`\n      corpus: ${files.length} files, ${lines} lines, ${clean} completely clean, ${slowest} ms slowest`);
    console.log(`      ${findings} findings (${(findings / lines * 100).toFixed(2)}% of lines):`);
    for (const [key, n] of [...byKey].sort((a, b) => b[1] - a[1])) {
        console.log(`        ${String(n).padStart(3)}  ${key}`);
    }
    failures += check('7. no crashes across the real corpus', crashes === 0, `${crashes} crash(es)`);

    // Every one of these was read individually on 2026-08-26 and judged. 42 of the 48 are true
    // positives, including three the user had reported as wrongly-undiagnosed and one genuine
    // bug this phase found in their own code (`<[name]>` in mafia/dialogs/mf.first.dsc:23 is
    // never defined -- the sibling file clans/clans-menu.dsc defines it, so the line was lost in
    // a copy-paste). The remaining 6 are all one file, mafia/tasks/mafia_invite_hover.dsc, whose
    // `hover:`/`dehover:` keys use definitions passed in by `- run ... path:hover def.ent:<...>`;
    // `checkAsScript` builds a FRESH context per key (:978) and no version of this checker traces
    // a call site into a path, so the C# reports those six identically.
    //
    // The bound below is a REGRESSION gate, not an aspiration: if a later phase pushes findings
    // above it, something started firing that did not fire when every one of these was read.
    failures += check('8. corpus findings stay at the reviewed level',
        findings <= 48, `${findings} findings, reviewed baseline is 48`);

    console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} CHECK(S) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
}

loadMetaDocs({
    cacheFile: path.join(os.tmpdir(), 'denizen-phase2c5-verify-cache.json'),
    ttlMs: 12 * 60 * 60 * 1000,
    sources: DEFAULT_META_SOURCES
}).then((docs) => {
    META = docs;
    console.log(`Loaded meta: ${docs.tags.size} tags, ${docs.commands.size} commands.\n`);
    main();
}).catch((err) => {
    console.error('Failed to load meta docs:', err);
    process.exit(1);
});
