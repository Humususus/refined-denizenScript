/**
 * Live verification for Phase 2C-3: loads real Denizen meta and real Minecraft enum data over
 * the network (the same way the server does on startup), then exercises the container
 * conversion built in this phase -- `convertContainers`, `preprocContainer` and `mergeData`
 * (src/server/checker/containerConvert.ts) -- through `ScriptChecker.run()` and
 * `buildDiagnostics` (src/server/server.ts), end to end.
 *
 * WHAT THIS PHASE CHANGES FOR THE USER: almost nothing, and that is the first thing checked
 * below. The phase produces DATA -- `defNames`, `saveEntryNames`, `serverFlags`, `objectFlags`,
 * `injectedPaths` -- which Phase 2C-4 will check tags against. The three new diagnostics it adds
 * are all about containers being structurally invalid.
 *
 * The 652-test unit suite already pins each branch against hand-built fixtures. What it does NOT
 * prove is the two things this script is for:
 *
 *   1. THAT THE HARVEST ACTUALLY REACHES REAL SCRIPTS. A branch that silently fails to collect a
 *      definition looks exactly like success from inside the checker -- nothing warns, no
 *      diagnostic moves -- right up until 2C-4 reports that name as undefined on a script that
 *      is correct. Check 4 below walks a hand-traced script and names every expected entry.
 *   2. THAT THE THREE NEW ERRORS REACH THE USER AS ERRORS. Which list a `Warn` call names is the
 *      only thing deciding squiggle colour, and nothing but an end-to-end check catches a
 *      swapped one.
 *
 * Run with: node scripts/verify-phase2c3.js
 */
const path = require('path');
const os = require('os');
const { loadMetaDocs, DEFAULT_META_SOURCES } = require('../out/server/metaDocs/metaDocsManager');
const { loadExtraData } = require('../out/server/metaDocs/extraData');
const { provideCompletions } = require('../out/server/providers/completionProvider');
const { ScriptChecker } = require('../out/server/checker/scriptChecker');
const { buildDiagnostics } = require('../out/server/server');
const { DiagnosticSeverity } = require('vscode-languageserver/node');

function check(label, condition, detail) {
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
    return condition ? 0 : 1;
}

/** Runs a script through the full checker + buildDiagnostics pipeline, as the server would. */
function diagnose(script) {
    const checker = new ScriptChecker(script);
    checker.run();
    return { checker, diagnostics: buildDiagnostics(checker) };
}

/** A one-line summary of a diagnostic list, for FAIL detail. */
function describe(diagnostics) {
    return diagnostics.map(d => `${d.code}@${d.range.start.line}:${d.range.start.character}-${d.range.end.character}`).join(', ');
}

/** Sorted contents of a MixedKnowledgeSet's exact half. */
function exact(set) {
    return Array.from(set.exactKnown).sort();
}

/**
 * The definition names `procAsScript` adds to every task container unconditionally
 * (ScriptChecker.cs:1881-1891). Subtracted below so the assertions can stay exact.
 */
const TASK_BASELINE = ['shot_entities', 'last_entity', 'location', 'hit_entities',
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
function ownDefs(container) {
    return exact(container.defNames).filter(d => !TASK_BASELINE.includes(d));
}

Promise.all([
    loadMetaDocs({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2c3-verify-cache.json'), ttlMs: 12 * 60 * 60 * 1000, sources: DEFAULT_META_SOURCES }),
    loadExtraData({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2c3-verify.fds'), ttlMs: 15 * 24 * 60 * 60 * 1000 })
]).then(([docs, extra]) => {
    console.log(`Loaded ${docs.commands.size} commands, ${docs.tags.size} tags, ${docs.mechanisms.size} mechanisms, ${docs.loadErrors.length} meta error(s).`);
    console.log(`ExtraData: ${extra.materials.size} materials, ${extra.statistics.size} statistics, ${extra.entities.size} entity types.`);
    let failures = 0;

    failures += check('precondition: real meta actually loaded (commands.size > 0)', docs.commands.size > 0, `${docs.commands.size}`);
    failures += check('precondition: real ExtraData actually loaded (materials.size > 0)', extra.materials.size > 0, `${extra.materials.size}`);

    // ------------------------------------------------------------------------------------
    // 1. NOTHING NEW FIRES ON GOOD SCRIPTS. Phase 2C-2's realistic three-container fixture,
    //    unchanged, must still be silent now that conversion and harvesting run on top of it.
    //    If this phase were going to hurt the user, this is where it would show.
    // ------------------------------------------------------------------------------------
    const realisticScript = [
        '# Greets a player, reacts to two events, and holds a little data.',
        'my_greeting_task:',
        '  type: task',
        '  debug: false',
        '  definitions: target|message',
        '  script:',
        '  - define greeting Hello there, <player.name>!',
        '  - narrate <[greeting]>',
        '  - if <player.has_flag[greeted]>:',
        '    - narrate "Welcome back."',
        '  - else:',
        '    - narrate "Nice to meet you."',
        '  - flag player greeted:true',
        '',
        'my_world_events:',
        '  type: world',
        '  events:',
        '    after player breaks stone:',
        '    - narrate "You broke stone."',
        '    - run my_greeting_task',
        '    on player joins:',
        '    - flag player last_join:<util.time_now>',
        '',
        'my_data_holder:',
        '  type: data',
        '  data:',
        '    greeting_prefix: "[Server]"',
        '    max_uses: 5'
    ].join('\n');
    const realistic = diagnose(realisticScript);
    failures += check('a realistic three-container script STILL yields ZERO diagnostics after conversion',
        realistic.diagnostics.length === 0,
        `${realistic.diagnostics.length} diagnostic(s): ${describe(realistic.diagnostics)}`);

    // ------------------------------------------------------------------------------------
    // 2-4. THE THREE NEW Errors-SEVERITY CONTAINER PROBLEMS.
    // ------------------------------------------------------------------------------------

    // 2. invalid_container, both sites. They share a code, so only the MESSAGE tells them apart.
    const noContent = diagnose('my_task: hello');
    const noContentDiags = noContent.diagnostics.filter(d => d.code === 'invalid_container');
    failures += check('a container whose value is a scalar yields invalid_container "missing content?", severity Error (1)',
        noContentDiags.length === 1 && noContentDiags[0].severity === DiagnosticSeverity.Error
        && noContentDiags[0].message.includes('missing content?'),
        noContentDiags.length === 1 ? `severity=${noContentDiags[0].severity} msg=${JSON.stringify(noContentDiags[0].message)}` : describe(noContent.diagnostics));

    const noType = diagnose('my_task:\n  script:\n  - narrate hi');
    const noTypeDiags = noType.diagnostics.filter(d => d.code === 'invalid_container');
    failures += check("a container with no type key yields invalid_container \"missing 'type' key\", severity Error (1)",
        noTypeDiags.length === 1 && noTypeDiags[0].severity === DiagnosticSeverity.Error
        && noTypeDiags[0].message.includes("missing 'type' key"),
        noTypeDiags.length === 1 ? `severity=${noTypeDiags[0].severity} msg=${JSON.stringify(noTypeDiags[0].message)}` : describe(noType.diagnostics));

    // 3. wrong_type.
    const badType = diagnose('my_task:\n  type: tsak\n  script:\n  - narrate hi');
    const badTypeDiags = badType.diagnostics.filter(d => d.code === 'wrong_type');
    failures += check('an unrecognised type yields wrong_type, severity Error (1)',
        badTypeDiags.length === 1 && badTypeDiags[0].severity === DiagnosticSeverity.Error,
        badTypeDiags.length === 1 ? `severity=${badTypeDiags[0].severity}` : describe(badType.diagnostics));

    // 4. One bad container must not cost the user the rest of the file. All three guards
    // `continue` in the C#; a `return` at any of them would silently drop later containers.
    const mixed = diagnose(
        'a_scalar: hello\n' +
        'no_type:\n  script:\n  - narrate hi\n' +
        'bad_type:\n  type: nope\n' +
        'fine:\n  type: task\n  script:\n  - narrate hi'
    );
    failures += check('three broken containers do not stop the fourth, valid one converting',
        mixed.checker.generatedWorkspace.scripts.size === 1 && mixed.checker.generatedWorkspace.scripts.has('fine'),
        `converted: ${Array.from(mixed.checker.generatedWorkspace.scripts.keys()).join(', ') || '(none)'}`);

    // ------------------------------------------------------------------------------------
    // 5. THE HARVEST -- what this phase exists to produce, and what 2C-4 will consume.
    //    Every expected entry below was traced by hand against the fixture before being written.
    // ------------------------------------------------------------------------------------
    const harvestScript = [
        'harvest_task:',
        '  type: task',
        '  definitions: seeded|other',
        '  script:',
        '  - define explicit hello',
        '  - foreach <[list]> as:item key:mapkey:',
        '    - narrate <[item]>',
        '  - while <[cond]>:',
        '    - narrate loop',
        '  - flag server serverside:1',
        '  - flag player playerside:2',
        '  - spawn zombie save:spawned',
        '  - webget https://example.com save:page',
        '  - inject helper_task',
        '',
        'helper_task:',
        '  type: task',
        '  script:',
        '  - define from_helper 1'
    ].join('\n');
    const harvest = diagnose(harvestScript);
    failures += check('the harvest fixture itself is clean (no diagnostics to muddy the assertions)',
        harvest.diagnostics.length === 0, describe(harvest.diagnostics));

    const ht = harvest.checker.generatedWorkspace.scripts.get('harvest_task');
    failures += check('harvest_task converted', ht !== undefined,
        `scripts: ${Array.from(harvest.checker.generatedWorkspace.scripts.keys()).join(', ')}`);
    if (ht !== undefined) {
        // `seeded`/`other` from `definitions:`; `explicit` from `- define`; `item`+`mapkey`+
        // `loop_index` from the foreach (which falls through to the while arm for `item`);
        // `value` from the bare `- while`; `from_helper` merged in through the inject.
        const expectedDefs = ['explicit', 'from_helper', 'item', 'loop_index', 'mapkey', 'other', 'seeded', 'value'];
        failures += check('defNames holds exactly the definitions this script establishes (plus the merged inject)',
            JSON.stringify(ownDefs(ht)) === JSON.stringify(expectedDefs),
            `${JSON.stringify(ownDefs(ht))} vs ${JSON.stringify(expectedDefs)}`);
        failures += check('the unconditional task baseline is present too (1-10 and the shoot workaround)',
            TASK_BASELINE.every(d => ht.defNames.exactKnown.has(d)),
            `missing: ${TASK_BASELINE.filter(d => !ht.defNames.exactKnown.has(d)).join(', ') || 'none'}`);
        failures += check('serverFlags and objectFlags are SEPARATE, not pooled',
            JSON.stringify(exact(ht.serverFlags)) === JSON.stringify(['serverside'])
            && JSON.stringify(exact(ht.objectFlags)) === JSON.stringify(['playerside']),
            `server=${JSON.stringify(exact(ht.serverFlags))} object=${JSON.stringify(exact(ht.objectFlags))}`);
        failures += check('saveEntryNames holds both save: names -- the index the <entry[...]> work needs',
            JSON.stringify(exact(ht.saveEntryNames)) === JSON.stringify(['page', 'spawned']),
            JSON.stringify(exact(ht.saveEntryNames)));
        failures += check('the inject target was resolved against the file, not just recorded',
            JSON.stringify(Array.from(ht.realInjects)) === JSON.stringify(['helper_task']),
            JSON.stringify(Array.from(ht.realInjects)));
    }

    // mergeData: the workspace-level flag sets are populated from the containers.
    const ws = harvest.checker.generatedWorkspace;
    failures += check('mergeData collected the flags onto the workspace',
        JSON.stringify(exact(ws.allKnownServerFlagNames)) === JSON.stringify(['serverside'])
        && JSON.stringify(exact(ws.allKnownObjectFlagNames)) === JSON.stringify(['playerside']),
        `server=${JSON.stringify(exact(ws.allKnownServerFlagNames))} object=${JSON.stringify(exact(ws.allKnownObjectFlagNames))}`);

    // ------------------------------------------------------------------------------------
    // 6. THE dialog DEVIATION (see the DELIBERATE DEVIATION note in scriptTypes.ts) -- a USER
    //    RULING. `dialog` is in neither the C# table nor Denizen's meta, so without the added
    //    entry every dialog container draws an ERROR. The user reported this exact container in
    //    prompt.md, by name, before the port began.
    // ------------------------------------------------------------------------------------
    const dialogScript = [
        'nicknamechanged:',
        '  type: dialog',
        '  base:',
        '    type: multi',
        '    title: Welcome',
        '  bodies:',
        '    header:',
        '      type: message',
        '      message: Enter a name',
        '  buttons:',
        '    1:',
        '      label: Confirm',
        '      script:',
        '      - define name_regex sometext',
        '      - flag server dialogs.seen:true',
        '      - narrate "done"'
    ].join('\n');
    const dialog = diagnose(dialogScript);
    failures += check('a dialog container yields ZERO diagnostics (it used to be an ERROR)',
        dialog.diagnostics.length === 0, describe(dialog.diagnostics));
    const dc = dialog.checker.generatedWorkspace.scripts.get('nicknamechanged');
    failures += check('that dialog converted, with type "dialog"', dc !== undefined && dc.type === 'dialog',
        dc === undefined ? '(missing)' : dc.type);
    if (dc !== undefined) {
        // Being in the table silences wrong_type; `scriptKeys: ['buttons.*']` is what makes the
        // container USEFUL. Without it, 2C-4 would report <[name_regex]> as undefined inside the
        // very script that defines it.
        failures += check("the dialog's buttons.<n>.script was walked as code",
            ownDefs(dc).includes('name_regex') && exact(dc.serverFlags).includes('dialogs'),
            `defs=${JSON.stringify(ownDefs(dc))} sflags=${JSON.stringify(exact(dc.serverFlags))}`);
    }

    // ------------------------------------------------------------------------------------
    // 7. REGRESSION: Phase 2C-2's assertions, re-run because `run()` now does more work after
    //    the gather. Full commentary lives in verify-phase2c2.js.
    // ------------------------------------------------------------------------------------
    const dupKey = diagnose('my_data:\n  type: data\n  nested:\n    a: 1\n  nested:\n    b: 2');
    const dupKeyDiags = dupKey.diagnostics.filter(d => d.code === 'duplicate_key');
    failures += check('[regression 2c2] duplicate_key still fires once, at severity Error (1)',
        dupKeyDiags.length === 1 && dupKeyDiags[0].severity === DiagnosticSeverity.Error,
        describe(dupKey.diagnostics));

    const dupScript = diagnose('my_task:\n  type: task\nmy_task:\n  type: task');
    failures += check('[regression 2c2] a repeated root name is duplicate_script, NOT duplicate_key',
        dupScript.diagnostics.filter(d => d.code === 'duplicate_script').length === 1
        && dupScript.diagnostics.filter(d => d.code === 'duplicate_key').length === 0,
        describe(dupScript.diagnostics));

    const capDup = diagnose('my_data:\n  type: data\n  Nested:\n    a: 1\n  Nested:\n    b: 2');
    const capDupDiags = capDup.diagnostics.filter(d => d.code === 'duplicate_key');
    failures += check('[regression 2c2] a CAPITALISED duplicate key is squiggled over the word (2-8), not the indent',
        capDupDiags.length === 1 && capDupDiags[0].range.start.character === 2 && capDupDiags[0].range.end.character === 8,
        capDupDiags.length === 1 ? `${capDupDiags[0].range.start.character}-${capDupDiags[0].range.end.character}` : describe(capDup.diagnostics));

    const growth = diagnose('my_task:\n  type: task\n  - narrate hello');
    const growthDiags = growth.diagnostics.filter(d => d.code === 'weird_line_growth');
    failures += check('[regression 2c2] a spacing problem is still a Warning (2), not an Error',
        growthDiags.length === 1 && growthDiags[0].severity === DiagnosticSeverity.Warning,
        describe(growth.diagnostics));

    // ------------------------------------------------------------------------------------
    // 8. REGRESSION: Phase 2C-1's line checks and the two lineChecks deviations.
    // ------------------------------------------------------------------------------------
    const tabDiags = diagnose('  - narrate "one"\n\t- narrate "two"\n\t- narrate "three"').diagnostics.filter(d => d.code === 'raw_tab_symbol');
    failures += check('[regression 2c1] two tabbed lines yield EXACTLY ONE raw_tab_symbol, severity Warning (2)',
        tabDiags.length === 1 && tabDiags[0].severity === DiagnosticSeverity.Warning,
        `${tabDiags.length} diagnostic(s)`);

    const braceDiags = diagnose('on player_types_chat:\n- narrate "hi" {\n- narrate "bye" }').diagnostics.filter(d => d.code === 'brace_syntax');
    failures += check('[regression 2c1] two braced lines yield EXACTLY ONE brace_syntax, severity Error (1)',
        braceDiags.length === 1 && braceDiags[0].severity === DiagnosticSeverity.Error,
        `${braceDiags.length} diagnostic(s)`);

    const spaceDiags = diagnose('- narrate "hi" ').diagnostics.filter(d => d.code === 'stray_space_eol');
    failures += check('[regression 2c1] a trailing space is Information (3), NOT Warning',
        spaceDiags.length === 1 && spaceDiags[0].severity === DiagnosticSeverity.Information,
        `${spaceDiags.length} diagnostic(s)`);

    const uselessA = diagnose('    Narrate <[x]>').diagnostics.filter(d => d.code === 'useless_invalid_line');
    failures += check('[regression 2c1] "    Narrate <[x]>": useless_invalid_line spans the TEXT (4-17), not the indent',
        uselessA.length === 1 && uselessA[0].range.start.character === 4 && uselessA[0].range.end.character === 17,
        uselessA.length === 1 ? `${uselessA[0].range.start.character}-${uselessA[0].range.end.character}` : `${uselessA.length} diagnostic(s)`);

    const sectionB = diagnose('- narrate hi\n    §c').diagnostics.filter(d => d.code === 'color_code_misformat');
    failures += check('[regression 2c1] "§" on a continuation line is reported on line 1, not swallowed',
        sectionB.length === 1 && sectionB[0].range.start.line === 1,
        `${sectionB.length} diagnostic(s)`);

    // ------------------------------------------------------------------------------------
    // 9. REGRESSION, completion: a representative sample carried forward. Diagnostics and
    //    completion share src/server/server.ts.
    // ------------------------------------------------------------------------------------
    const cooldownText = '  - narrate <player.item_cooldown[';
    failures += check('[regression] <player.item_cooldown[ (bare) offers exactly extra.materials.size items',
        provideCompletions(docs, extra, cooldownText, cooldownText.length, 0).length === extra.materials.size,
        `${provideCompletions(docs, extra, cooldownText, cooldownText.length, 0).length} vs ${extra.materials.size}`);

    const withQuaText = '  - narrate <player.item_in_hand.with[qua';
    const withQuaItems = provideCompletions(docs, extra, withQuaText, withQuaText.length, 0);
    failures += check('[regression] <player.item_in_hand.with[qua offers exactly ["quantity="]',
        withQuaItems.length === 1 && withQuaItems[0].label === 'quantity=',
        `${withQuaItems.length} item(s)`);

    const nameText = 'my_task:\n  type: task\n  script:\n  - narr';
    failures += check('[regression] command name completion still offers narrate',
        provideCompletions(docs, extra, nameText, nameText.length, 0).some(i => i.label === 'narrate'));

    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}).catch(err => {
    console.error('Verification failed to run:', err);
    process.exit(1);
});
