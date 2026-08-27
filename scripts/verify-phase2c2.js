/**
 * Live verification for Phase 2C-2: loads real Denizen meta and real Minecraft enum data over
 * the network (the same way the server does on startup), then exercises the container structure
 * parser built in this phase -- `gatherActualContainers`
 * (src/server/checker/containerGather.ts) -- through `ScriptChecker.run()` and `buildDiagnostics`
 * (src/server/server.ts), end to end.
 *
 * The unit suite (552 tests) already pins each of the thirteen structural warnings against
 * hand-built `ScriptChecker` instances. What it does NOT prove is the two things this script is
 * for:
 *
 *   1. THAT THE PARSER DOES NOT FIRE ON REAL SCRIPTS. This phase adds thirteen warnings, most of
 *      them about spacing, to a checker that until now only looked at single lines. The realistic
 *      risk of this phase is not a missed warning -- it is a FALSE POSITIVE on a script that is
 *      perfectly fine, which the user sees as the extension underlining their working code.
 *      Check 1 below is the one that would show that, and its script was traced by hand against
 *      the parser before being included. If it comes back non-zero, that is a finding to REPORT,
 *      not a script to edit until it passes.
 *   2. THAT THE SEVERITY ROUTING SURVIVES THE TRIP. Four of the thirteen go onto `errors` and nine
 *      onto `warnings`; which list a `Warn` call names is the only thing deciding squiggle colour,
 *      and nothing but an end-to-end check catches a swapped one.
 *
 * It also proves the parser produced a USABLE STRUCTURE (check 7) rather than merely staying
 * quiet, and re-runs Phase 2C-1's diagnostics assertions, since `run()` now calls the gather
 * alongside the five line-level checks and could disturb them.
 *
 * Run with: node scripts/verify-phase2c2.js
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

/** The value stored under `key` in a parsed section, or undefined. See containerGather's SectionEntry. */
function valueOf(section, key) {
    const entry = section && section.get(key);
    return entry === undefined ? undefined : entry.value;
}

/** The LineTrackedString a section recorded as its key -- i.e. where the key was found. */
function keyOf(section, key) {
    const entry = section && section.get(key);
    return entry === undefined ? undefined : entry.key;
}

/** A one-line summary of a diagnostic list, for FAIL detail. */
function describe(diagnostics) {
    return diagnostics.map(d => `${d.code}@${d.range.start.line}:${d.range.start.character}-${d.range.end.character}`).join(', ');
}

Promise.all([
    loadMetaDocs({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2c2-verify-cache.json'), ttlMs: 12 * 60 * 60 * 1000, sources: DEFAULT_META_SOURCES }),
    loadExtraData({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2c2-verify.fds'), ttlMs: 15 * 24 * 60 * 60 * 1000 })
]).then(([docs, extra]) => {
    console.log(`Loaded ${docs.commands.size} commands, ${docs.tags.size} tags, ${docs.mechanisms.size} mechanisms, ${docs.loadErrors.length} meta error(s).`);
    console.log(`ExtraData: ${extra.materials.size} materials, ${extra.statistics.size} statistics, ${extra.entities.size} entity types.`);
    let failures = 0;

    // Sanity: the server context this script proves the checker runs inside really did load real
    // data, not an empty stand-in. The checker needs none of it, so everything below still runs
    // either way -- but the "realistic server context" claim would be false.
    failures += check('precondition: real meta actually loaded (commands.size > 0)', docs.commands.size > 0, `${docs.commands.size}`);
    failures += check('precondition: real ExtraData actually loaded (materials.size > 0)', extra.materials.size > 0, `${extra.materials.size}`);

    // ------------------------------------------------------------------------------------
    // 1. THE CHECK THIS PHASE EXISTS TO SURVIVE: a realistic multi-container file, ZERO
    //    diagnostics. Three containers of three different types, in three different shapes, all
    //    of which the parser has to walk without complaining:
    //      - a TASK with a script list, an `- if ...:`/`- else:` pair (so buildingSubList opens
    //        a sub-list at 4 and a dedent must restore the outer list from spacedlists at 2),
    //      - a WORLD with an `events:` block whose event keys sit at 4 and whose command lists
    //        sit at 4 TOO -- the standard Denizen shape, and the one where `spaces == pspaces`
    //        has to mean "the pending key becomes a list" rather than any of the three spacing
    //        warnings,
    //      - a DATA container, whose free-form keys must not draw key_line_looks_like_command.
    //    Blank lines separate the containers, which the :1425 skip must step over WITHOUT
    //    updating pspaces -- so the dedent back to column 0 is judged against the last real line.
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
        // Unquoted since Phase 2C-6: `CheckSingleDataLine` (ScriptChecker.cs:632-634) warns
        // `invalid_data_line_quotes` on any data line containing a double quote, because Denizen
        // does not strip them -- `"[Server]"` would literally include the quote characters. The
        // check was correct and this fixture was not; it only looked clean while Part A was
        // unported and nothing drove the data-line layer.
        '    greeting_prefix: [Server]',
        '    max_uses: 5'
    ].join('\n');
    const realistic = diagnose(realisticScript);
    failures += check('a realistic three-container script (task + world + data) yields ZERO diagnostics',
        realistic.diagnostics.length === 0,
        `${realistic.diagnostics.length} diagnostic(s): ${describe(realistic.diagnostics)}`);

    // ------------------------------------------------------------------------------------
    // 2-5. THE FOUR Errors-SEVERITY STRUCTURAL PROBLEMS. Each must reach the user as
    //      DiagnosticSeverity.Error (1), not Warning (2) -- the routing decided solely by which
    //      list the Warn call names, and invisible to a unit test on the check alone.
    // ------------------------------------------------------------------------------------

    // 2. duplicate_key (:1615) -- two `nested:` keys inside the same container.
    const dupKey = diagnose('my_data:\n  type: data\n  nested:\n    a: 1\n  nested:\n    b: 2');
    const dupKeyDiags = dupKey.diagnostics.filter(d => d.code === 'duplicate_key');
    failures += check('a repeated key inside one container yields exactly one duplicate_key diagnostic',
        dupKeyDiags.length === 1, `${dupKeyDiags.length} diagnostic(s): ${describe(dupKey.diagnostics)}`);
    failures += check('that duplicate_key diagnostic is severity Error (1)',
        dupKeyDiags.length === 1 && dupKeyDiags[0].severity === DiagnosticSeverity.Error,
        dupKeyDiags.length === 1 ? `severity=${dupKeyDiags[0].severity}` : '(missing)');

    // 3. duplicate_script (:1611) -- the SAME code path as duplicate_key, discriminated only by
    // whether the section being written to is the file root. A mutant that dropped that
    // discriminator would emit duplicate_key here and still pass check 2.
    const dupScript = diagnose('my_task:\n  type: task\nmy_task:\n  type: task');
    const dupScriptDiags = dupScript.diagnostics.filter(d => d.code === 'duplicate_script');
    failures += check('a container name repeated at ROOT level yields duplicate_script, NOT duplicate_key',
        dupScriptDiags.length === 1 && dupScript.diagnostics.filter(d => d.code === 'duplicate_key').length === 0,
        describe(dupScript.diagnostics));
    failures += check('that duplicate_script diagnostic is severity Error (1)',
        dupScriptDiags.length === 1 && dupScriptDiags[0].severity === DiagnosticSeverity.Error,
        dupScriptDiags.length === 1 ? `severity=${dupScriptDiags[0].severity}` : '(missing)');

    // 4. empty_command_section (:1484) -- `- if x:` whose sub-list never arrives, because the
    // next line is back at the same depth.
    const emptyCmd = diagnose('my_task:\n  type: task\n  script:\n  - if <player.is_op>:\n  - narrate done');
    const emptyCmdDiags = emptyCmd.diagnostics.filter(d => d.code === 'empty_command_section');
    failures += check('"- if x:" with nothing indented under it yields empty_command_section',
        emptyCmdDiags.length === 1, `${emptyCmdDiags.length} diagnostic(s): ${describe(emptyCmd.diagnostics)}`);
    failures += check('that empty_command_section diagnostic is severity Error (1)',
        emptyCmdDiags.length === 1 && emptyCmdDiags[0].severity === DiagnosticSeverity.Error,
        emptyCmdDiags.length === 1 ? `severity=${emptyCmdDiags[0].severity}` : '(missing)');

    // 5. empty_section (:1627) -- a key line whose contents never arrive.
    const emptySec = diagnose('my_task:\nother_task:\n  type: task');
    const emptySecDiags = emptySec.diagnostics.filter(d => d.code === 'empty_section');
    failures += check('a container header with no contents yields empty_section',
        emptySecDiags.length === 1, `${emptySecDiags.length} diagnostic(s): ${describe(emptySec.diagnostics)}`);
    failures += check('that empty_section diagnostic is severity Error (1)',
        emptySecDiags.length === 1 && emptySecDiags[0].severity === DiagnosticSeverity.Error,
        emptySecDiags.length === 1 ? `severity=${emptySecDiags[0].severity}` : '(missing)');

    // ------------------------------------------------------------------------------------
    // 6. A SPACING PROBLEM MUST BE A Warning (2), NOT AN ERROR. The nine spacing/shape problems
    //    share their machinery with the four above and differ only in the list they are pushed
    //    onto; this is the assertion that a wholesale "route everything to errors" mistake, or a
    //    single mis-typed list name, cannot survive.
    // ------------------------------------------------------------------------------------
    const growth = diagnose('my_task:\n  type: task\n  - narrate hello');
    const growthDiags = growth.diagnostics.filter(d => d.code === 'weird_line_growth');
    failures += check('a "- " line with no list to join yields weird_line_growth',
        growthDiags.length === 1, `${growthDiags.length} diagnostic(s): ${describe(growth.diagnostics)}`);
    failures += check('that weird_line_growth diagnostic is severity Warning (2), NOT Error',
        growthDiags.length === 1 && growthDiags[0].severity === DiagnosticSeverity.Warning,
        growthDiags.length === 1 ? `severity=${growthDiags[0].severity}` : '(missing)');

    // ------------------------------------------------------------------------------------
    // 7. THE PARSED STRUCTURE ITSELF. Everything above would still pass if `gatherActualContainers`
    //    returned an empty map and simply never warned -- which is exactly the failure mode Phase
    //    2C-3 would inherit, since it consumes this structure rather than the diagnostics. So:
    //    walk the structure of check 1's script and prove it is usable.
    // ------------------------------------------------------------------------------------
    const root = realistic.checker.containers;
    failures += check('run() parked a container structure on the checker (not null)', root !== null && root !== undefined,
        `${root === null ? 'null' : typeof root}`);
    failures += check('the structure holds exactly the three containers, in file order',
        root !== null && JSON.stringify(Array.from(root.keys())) === JSON.stringify(['my_greeting_task', 'my_world_events', 'my_data_holder']),
        root === null ? '(null)' : Array.from(root.keys()).join(', '));

    const task = valueOf(root, 'my_greeting_task');
    failures += check('my_greeting_task holds type/debug/definitions/script, in file order',
        task instanceof Map && JSON.stringify(Array.from(task.keys())) === JSON.stringify(['type', 'debug', 'definitions', 'script']),
        task instanceof Map ? Array.from(task.keys()).join(', ') : `${task}`);
    const taskType = valueOf(task, 'type');
    failures += check('my_greeting_task.type is the scalar "task", recorded on its own line (2)',
        taskType !== undefined && taskType.text === 'task' && taskType.line === 2,
        taskType === undefined ? '(missing)' : `"${taskType.text}" @line ${taskType.line}`);
    // The seven `- ` lines of that script collapse to FIVE list entries: the two indented
    // narrates live inside the if/else sub-sections, not on the outer list. Spelled out entry by
    // entry rather than counted, because a count alone would pass on a list that had swallowed
    // the sub-lists flat -- which is precisely the mistake worth catching here. The last entry
    // matters most: reaching it means the dedent from 4 back to 2 restored the OUTER list from
    // `spacedlists` (:1432-1435) instead of leaving `flag` inside the else block.
    const taskScript = valueOf(task, 'script');
    const scriptShape = Array.isArray(taskScript)
        ? taskScript.map(e => (e instanceof Map ? `{${Array.from(e.keys()).join(',')}}` : e.text))
        : null;
    failures += check('my_greeting_task.script is a 5-entry list: 2 commands, the if/else sub-sections, then the outer-list flag',
        scriptShape !== null && JSON.stringify(scriptShape) === JSON.stringify([
            'define greeting Hello there, <player.name>!',
            'narrate <[greeting]>',
            '{if <player.has_flag[greeted]>}',
            '{else}',
            'flag player greeted:true'
        ]),
        scriptShape === null ? `${taskScript}` : `${scriptShape.length} entries: ${scriptShape.join(' | ')}`);
    failures += check('the first script entry is the raw text after "- ", case preserved, anchored at column 4',
        Array.isArray(taskScript) && taskScript[0] && taskScript[0].text === 'define greeting Hello there, <player.name>!' && taskScript[0].startChar === 4,
        Array.isArray(taskScript) && taskScript[0] ? `"${taskScript[0].text}" @char ${taskScript[0].startChar}` : '(missing)');
    // The `- if ...:` entry is a single-key section wrapping its own sub-list (:1486-1491) --
    // the shape Phase 2C-3 has to walk to reach commands nested inside control flow.
    const ifEntry = Array.isArray(taskScript) ? taskScript[2] : undefined;
    const ifBody = ifEntry instanceof Map ? valueOf(ifEntry, 'if <player.has_flag[greeted]>') : undefined;
    failures += check('the "- if ...:" entry is a sub-section whose one key holds a 1-entry sub-list',
        Array.isArray(ifBody) && ifBody.length === 1 && ifBody[0].text === 'narrate "Welcome back."',
        Array.isArray(ifBody) ? `${ifBody.length} entries: ${ifBody.map(e => e.text).join(' | ')}` : '(not a sub-list)');

    // The world container's events block: a section inside a section, each event key holding a
    // list. This is the shape most likely to be flattened by a parser bug, and check 1 would not
    // notice because a flattened structure warns just as little as a correct one.
    const events = valueOf(valueOf(root, 'my_world_events'), 'events');
    failures += check('my_world_events.events is a section holding both event keys, lowercased',
        events instanceof Map && JSON.stringify(Array.from(events.keys())) === JSON.stringify(['after player breaks stone', 'on player joins']),
        events instanceof Map ? Array.from(events.keys()).join(' | ') : `${events}`);
    const breakEvent = valueOf(events, 'after player breaks stone');
    failures += check('the "after player breaks stone" event holds its 2-command list',
        Array.isArray(breakEvent) && breakEvent.length === 2 && breakEvent[1].text === 'run my_greeting_task',
        Array.isArray(breakEvent) ? `${breakEvent.length}: ${breakEvent.map(e => e.text).join(' | ')}` : `${breakEvent}`);

    // ------------------------------------------------------------------------------------
    // 8. THE :1424 DEVIATION (containerGather.ts's DELIBERATE DEVIATION note) -- a USER RULING.
    //    The C# computes `cleanStartCut = line.IndexOf(cleaned[0])` with `cleaned` lowercased and
    //    `line` raw, so on a CAPITALISED key it searches for a character the key does not contain.
    //    This is the only place the consequence is proven at the PUBLISHED range, which is what
    //    the user actually sees -- and where the defect used to hide, because buildDiagnostics'
    //    clamp (DiagnosticProvider.cs:86-92) turns the parser's -1 into a plausible-looking 0.
    //    Same family, and the same user report, as the useless_invalid_line range in check 12.
    // ------------------------------------------------------------------------------------
    // Case A: no match at all. "Nested" contains no lowercase 'n', so the C# yields -1 and the
    // red squiggle lands on the four-space indent (0-6) instead of over the word (2-8).
    const capDup = diagnose('my_data:\n  type: data\n  Nested:\n    a: 1\n  Nested:\n    b: 2');
    const capDupDiags = capDup.diagnostics.filter(d => d.code === 'duplicate_key');
    failures += check('a CAPITALISED duplicate key is squiggled over the WORD (2-8), not over the indent (0-6)',
        capDupDiags.length === 1 && capDupDiags[0].range.start.character === 2 && capDupDiags[0].range.end.character === 8,
        capDupDiags.length === 1 ? `${capDupDiags[0].range.start.character}-${capDupDiags[0].range.end.character}` : describe(capDup.diagnostics));

    // Case B: the nastier half -- a match in the WRONG PLACE, which no clamp and no log flags.
    // "Test" DOES contain a lowercase 't' (its last character), so the C# returns index 5 of
    // "  Test:" and the structure records the key five characters in. Nothing about that looks
    // wrong from the outside, which is why the fix removed the search rather than guarding -1.
    const capStruct = diagnose('my_data:\n  type: data\n  Test:\n    a: 1');
    const capContainer = valueOf(capStruct.checker.containers, 'my_data');
    const capKey = keyOf(capContainer, 'test');
    failures += check('a capitalised key whose lowercase letter occurs LATER is still recorded at column 2, not 5',
        capKey !== undefined && capKey.startChar === 2,
        capKey === undefined ? '(missing)' : `startChar=${capKey.startChar}`);

    // Case C: a TAB indent. `cleanStartCut` is taken from the RAW line, not the tab-expanded one
    // the C# searches, because LSP columns count a tab as ONE character -- an expanded index
    // over-reports by three per tab and lands the squiggle past the key. The indent WIDTH used
    // for the parser's own spacing comparisons still comes from the expanded line, which is what
    // makes this file parse as a container at all.
    const tabStruct = diagnose('my_task:\n\ttype: task');
    const tabContainer = valueOf(tabStruct.checker.containers, 'my_task');
    const tabKey = keyOf(tabContainer, 'type');
    failures += check('a TAB-indented key is recorded at raw column 1, not expanded column 4',
        tabKey !== undefined && tabKey.startChar === 1,
        tabKey === undefined ? '(missing -- the tab-indented container did not parse)' : `startChar=${tabKey.startChar}`);

    // ------------------------------------------------------------------------------------
    // 9-13. REGRESSION: Phase 2C-1's assertions, re-run because `run()` now calls the gather
    //       alongside the five line-level checks (scriptChecker.ts:120). A new step in a shared
    //       pipeline is exactly the change that disturbs its neighbours. Full commentary on each
    //       of these lives in verify-phase2c1.js; run it directly for the reasoning.
    // ------------------------------------------------------------------------------------

    // 9. Tabs -- exactly one raw_tab_symbol across two tabbed lines (the `break` survives).
    const tabResult = diagnose('  - narrate "one"\n\t- narrate "two"\n\t- narrate "three"');
    const tabDiags = tabResult.diagnostics.filter(d => d.code === 'raw_tab_symbol');
    failures += check('[regression 2c1] two tabbed lines yield EXACTLY ONE raw_tab_symbol, severity Warning (2)',
        tabDiags.length === 1 && tabDiags[0].severity === DiagnosticSeverity.Warning,
        `${tabDiags.length} diagnostic(s)${tabDiags.length === 1 ? `, severity=${tabDiags[0].severity}` : ''}`);

    // 10. Braces -- exactly one brace_syntax, and on the Error severity.
    const braceResult = diagnose('on player_types_chat:\n- narrate "hi" {\n- narrate "bye" }');
    const braceDiags = braceResult.diagnostics.filter(d => d.code === 'brace_syntax');
    failures += check('[regression 2c1] two braced lines yield EXACTLY ONE brace_syntax, severity Error (1)',
        braceDiags.length === 1 && braceDiags[0].severity === DiagnosticSeverity.Error,
        `${braceDiags.length} diagnostic(s)${braceDiags.length === 1 ? `, severity=${braceDiags[0].severity}` : ''}`);

    // 11. Old defs (Warning) and trailing space (Information, NOT Warning).
    const defsResult = diagnose('- narrate <def[x]>\n- narrate <def[y]>');
    const defsDiags = defsResult.diagnostics.filter(d => d.code === 'old_defs');
    failures += check('[regression 2c1] two <def[...]> lines yield EXACTLY ONE old_defs, severity Warning (2)',
        defsDiags.length === 1 && defsDiags[0].severity === DiagnosticSeverity.Warning,
        `${defsDiags.length} diagnostic(s)${defsDiags.length === 1 ? `, severity=${defsDiags[0].severity}` : ''}`);
    const spaceResult = diagnose('- narrate "hi" ');
    const spaceDiags = spaceResult.diagnostics.filter(d => d.code === 'stray_space_eol');
    failures += check('[regression 2c1] a trailing space yields stray_space_eol at severity Information (3), NOT Warning',
        spaceDiags.length === 1 && spaceDiags[0].severity === DiagnosticSeverity.Information,
        `${spaceDiags.length} diagnostic(s)${spaceDiags.length === 1 ? `, severity=${spaceDiags[0].severity}` : ''}`);

    // 12. The ##ignorewarning directive, and the two lineChecks deviations (the '§' hoist and the
    // corrected useless_invalid_line range the user reported on manual acceptance of 2C-1).
    const ignoreResult = diagnose('##ignorewarning raw_tab_symbol\n- narrate "one"\n\t- narrate "two"\n\t- narrate "three"');
    failures += check('[regression 2c1] ##ignorewarning suppresses raw_tab_symbol ENTIRELY, and counted the suppressions',
        ignoreResult.diagnostics.filter(d => d.code === 'raw_tab_symbol').length === 0 && ignoreResult.checker.ignoredWarnings > 0,
        `${ignoreResult.diagnostics.filter(d => d.code === 'raw_tab_symbol').length} diagnostic(s), ignoredWarnings=${ignoreResult.checker.ignoredWarnings}`);

    const sectionA = diagnose('- narrate §c\n    extra').diagnostics.filter(d => d.code === 'color_code_misformat');
    failures += check('[regression 2c1] "§" + continuation line: color_code_misformat reports on line 0, where the § is',
        sectionA.length === 1 && sectionA[0].range.start.line === 0,
        sectionA.length === 1 ? `line=${sectionA[0].range.start.line}` : `${sectionA.length} diagnostic(s)`);
    const sectionB = diagnose('- narrate hi\n    §c').diagnostics.filter(d => d.code === 'color_code_misformat');
    failures += check('[regression 2c1] "§" on a continuation line only: reported on line 1 at severity Information (3), not swallowed',
        sectionB.length === 1 && sectionB[0].range.start.line === 1 && sectionB[0].severity === DiagnosticSeverity.Information,
        sectionB.length === 1 ? `line=${sectionB[0].range.start.line}, severity=${sectionB[0].severity}` : `${sectionB.length} diagnostic(s)`);

    const uselessA = diagnose('    Narrate <[x]>').diagnostics.filter(d => d.code === 'useless_invalid_line');
    failures += check('[regression 2c1] "    Narrate <[x]>": useless_invalid_line spans the TEXT (4-17), not the indent (0-16)',
        uselessA.length === 1 && uselessA[0].range.start.character === 4 && uselessA[0].range.end.character === 17,
        uselessA.length === 1 ? `${uselessA[0].range.start.character}-${uselessA[0].range.end.character}` : `${uselessA.length} diagnostic(s)`);
    const uselessB = diagnose('\tNarrate <[x]>').diagnostics.filter(d => d.code === 'useless_invalid_line');
    failures += check('[regression 2c1] "\\tNarrate <[x]>": a TAB indent is cleared too (1-14), so countPreSpaces was not reused',
        uselessB.length === 1 && uselessB[0].range.start.character === 1 && uselessB[0].range.end.character === 14,
        uselessB.length === 1 ? `${uselessB[0].range.start.character}-${uselessB[0].range.end.character}` : `${uselessB.length} diagnostic(s)`);
    const uselessC = diagnose('    <[x]>').diagnostics.filter(d => d.code === 'useless_invalid_line');
    failures += check('[regression 2c1] "    <[x]>": useless_invalid_line still FIRES, at 4-9 -- only the range moved',
        uselessC.length === 1 && uselessC[0].range.start.character === 4 && uselessC[0].range.end.character === 9,
        uselessC.length === 1 ? `${uselessC[0].range.start.character}-${uselessC[0].range.end.character}` : `${uselessC.length} diagnostic(s)`);

    // 13. Phase 2C-1's clean-script assertion. Narrower than check 1 above (one container, no
    // events block, no data container), but it is the exact script 2C-1 was signed off against,
    // so a regression in the shared pipeline shows up here as a diff against a known-good run.
    const cleanScript = [
        '# Greets a player and reports on their surroundings.',
        'my_greeting_task:',
        '  type: task',
        '  debug: false',
        '  script:',
        '  - define greeting Hello there, <player.name>!',
        '  - narrate <[greeting]>',
        '  - if <player.location.block.material> matches air:',
        '    - narrate "You are standing in the air!"',
        '  - else:',
        '    - narrate "You are standing on solid ground."',
        '  - flag player greeted:true',
        '  - wait 1s',
        '  - stop'
    ].join('\n');
    const cleanResult = diagnose(cleanScript);
    failures += check("[regression 2c1] Phase 2C-1's clean script still yields ZERO diagnostics now that the gather runs too",
        cleanResult.diagnostics.length === 0,
        `${cleanResult.diagnostics.length} diagnostic(s): ${describe(cleanResult.diagnostics)}`);

    // 14. REGRESSION, completion: a representative sample carried forward from verify-phase2c1.js,
    // itself a sample of verify-phase2b6.js. Diagnostics and completion share src/server/server.ts.
    const cooldownText = '  - narrate <player.item_cooldown[';
    failures += check('[regression] <player.item_cooldown[ (bare) offers exactly extra.materials.size items',
        provideCompletions(docs, extra, cooldownText, cooldownText.length, 0).length === extra.materials.size,
        `${provideCompletions(docs, extra, cooldownText, cooldownText.length, 0).length} vs ${extra.materials.size}`);

    const withQuaText = '  - narrate <player.item_in_hand.with[qua';
    const withQuaItems = provideCompletions(docs, extra, withQuaText, withQuaText.length, 0);
    failures += check('[regression] <player.item_in_hand.with[qua offers exactly ["quantity="]',
        withQuaItems.length === 1 && withQuaItems[0].label === 'quantity=',
        `${withQuaItems.length} item(s): ${withQuaItems.map(i => i.label).join(', ')}`);

    const flagText = '  - narrate <player.flag[';
    failures += check('[regression] <player.flag[ offers NOTHING from the server (client-owns-flags boundary)',
        provideCompletions(docs, extra, flagText, flagText.length, 0).length === 0,
        `${provideCompletions(docs, extra, flagText, flagText.length, 0).length} item(s)`);

    const nameText = 'my_task:\n  type: task\n  script:\n  - narr';
    failures += check('[regression] command name completion still offers narrate',
        provideCompletions(docs, extra, nameText, nameText.length, 0).some(i => i.label === 'narrate'));

    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}).catch(err => {
    console.error('Verification failed to run:', err);
    process.exit(1);
});
