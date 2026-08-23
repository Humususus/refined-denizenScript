/**
 * Live verification for Phase 2C-1: loads real Denizen meta and real Minecraft enum data over
 * the network (the same way the server does on startup), then exercises the diagnostics
 * pipeline built in this phase -- `ScriptChecker` (src/server/checker/scriptChecker.ts), the
 * five line-level checks (src/server/checker/lineChecks.ts), and `buildDiagnostics`
 * (src/server/server.ts), which maps the checker's warning lists onto LSP `Diagnostic`s -- end
 * to end.
 *
 * The unit suite (516 tests) already pins each check's behaviour against hand-built
 * `ScriptChecker` instances. What it does NOT prove is the wiring: that `buildDiagnostics`
 * maps `errors`/`warnings`/`minorWarnings` onto the CORRECT LSP severities (not shuffled), that
 * `infos` never reaches a diagnostic, and that all of this still works when the server has real
 * meta loaded next to it, exactly as it would in production. That is what this script is for.
 *
 * It also regression-checks a handful of Phase 2B-6 completion assertions, since this phase's
 * diagnostics wiring landed in the same file (src/server/server.ts) as the completion handler.
 *
 * Run with: node scripts/verify-phase2c1.js
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

Promise.all([
    loadMetaDocs({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2c1-verify-cache.json'), ttlMs: 12 * 60 * 60 * 1000, sources: DEFAULT_META_SOURCES }),
    loadExtraData({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2c1-verify.fds'), ttlMs: 15 * 24 * 60 * 60 * 1000 })
]).then(([docs, extra]) => {
    console.log(`Loaded ${docs.commands.size} commands, ${docs.tags.size} tags, ${docs.mechanisms.size} mechanisms, ${docs.loadErrors.length} meta error(s).`);
    console.log(`ExtraData: ${extra.materials.size} materials, ${extra.statistics.size} statistics, ${extra.entities.size} entity types.`);
    let failures = 0;

    // Sanity: the server context this script proves the checker runs inside really did load
    // real data, not an empty stand-in -- if meta failed to load, everything below still runs
    // (the checker needs none of it) but the "realistic server context" claim would be false.
    failures += check('precondition: real meta actually loaded (commands.size > 0)', docs.commands.size > 0, `${docs.commands.size}`);
    failures += check('precondition: real ExtraData actually loaded (materials.size > 0)', extra.materials.size > 0, `${extra.materials.size}`);

    // 1. TABS -- raw_tab_symbol, Warning, EXACTLY ONE. Two DIFFERENT lines carry a tab, so a
    // mutant that dropped checkForTabs' `break` (lineChecks.ts:249) would push a second warning
    // (dedup in `warn()` is per (line, key), and these are two different lines) and this count
    // assertion -- not a mere presence check -- would catch it.
    const tabScript = '  - narrate "one"\n\t- narrate "two"\n\t- narrate "three"';
    const tabResult = diagnose(tabScript);
    const tabDiags = tabResult.diagnostics.filter(d => d.code === 'raw_tab_symbol');
    failures += check('a script with tabs on two lines yields EXACTLY ONE raw_tab_symbol diagnostic (break survives)',
        tabDiags.length === 1, `${tabDiags.length} diagnostic(s)`);
    failures += check('that raw_tab_symbol diagnostic is severity Warning (2)',
        tabDiags.length === 1 && tabDiags[0].severity === DiagnosticSeverity.Warning,
        tabDiags.length === 1 ? `severity=${tabDiags[0].severity}` : '(missing)');

    // 2. BRACES -- brace_syntax, Error, EXACTLY ONE. Same shape as the tabs check: two
    // DIFFERENT lines end with a brace character, so a dropped `break` (lineChecks.ts:283)
    // would produce two errors instead of one.
    const braceScript = 'on player_types_chat:\n- narrate "hi" {\n- narrate "bye" }';
    const braceResult = diagnose(braceScript);
    const braceDiags = braceResult.diagnostics.filter(d => d.code === 'brace_syntax');
    failures += check('a script with { on two lines yields EXACTLY ONE brace_syntax diagnostic (break survives)',
        braceDiags.length === 1, `${braceDiags.length} diagnostic(s)`);
    failures += check('that brace_syntax diagnostic is severity Error (1) -- the mapping most easily gotten backwards',
        braceDiags.length === 1 && braceDiags[0].severity === DiagnosticSeverity.Error,
        braceDiags.length === 1 ? `severity=${braceDiags[0].severity}` : '(missing)');

    // 3. OLD DEFS -- old_defs, EXACTLY ONE (two lines use <def[...]>, dropped break would give
    // two), and on the Warning severity (checkForOldDefs pushes onto `warnings`, not `errors`).
    const defsScript = '- narrate <def[x]>\n- narrate <def[y]>';
    const defsResult = diagnose(defsScript);
    const defsDiags = defsResult.diagnostics.filter(d => d.code === 'old_defs');
    failures += check('a script with <def[x]> on two lines yields EXACTLY ONE old_defs diagnostic (break survives)',
        defsDiags.length === 1, `${defsDiags.length} diagnostic(s)`);
    failures += check('that old_defs diagnostic is severity Warning (2)',
        defsDiags.length === 1 && defsDiags[0].severity === DiagnosticSeverity.Warning,
        defsDiags.length === 1 ? `severity=${defsDiags[0].severity}` : '(missing)');

    // 4. TRAILING SPACE -- stray_space_eol, Information. This is the check most likely to be
    // MISREAD backwards ("a minor warning is still a warning"): minorWarnings maps to
    // Information (3), not Warning (2).
    const spaceScript = '- narrate "hi" ';
    const spaceResult = diagnose(spaceScript);
    const spaceDiags = spaceResult.diagnostics.filter(d => d.code === 'stray_space_eol');
    failures += check('a trailing space yields a stray_space_eol diagnostic',
        spaceDiags.length === 1, `${spaceDiags.length} diagnostic(s)`);
    failures += check('that stray_space_eol diagnostic is severity Information (3), NOT Warning',
        spaceDiags.length === 1 && spaceDiags[0].severity === DiagnosticSeverity.Information,
        spaceDiags.length === 1 ? `severity=${spaceDiags[0].severity}` : '(missing)');

    // 5. IGNORE DIRECTIVE -- ##ignorewarning raw_tab_symbol suppresses check 1 ENTIRELY. Uses
    // the SAME two-tab-line shape as check 1, so if this regresses to "fewer" rather than
    // "zero" the count assertion (not a truthy/falsy one) will show it.
    const ignoreScript = '##ignorewarning raw_tab_symbol\n- narrate "one"\n\t- narrate "two"\n\t- narrate "three"';
    const ignoreResult = diagnose(ignoreScript);
    const ignoreDiags = ignoreResult.diagnostics.filter(d => d.code === 'raw_tab_symbol');
    failures += check('##ignorewarning raw_tab_symbol suppresses raw_tab_symbol ENTIRELY (zero, not merely fewer)',
        ignoreDiags.length === 0, `${ignoreDiags.length} diagnostic(s)`);
    failures += check('the ignored occurrences were actually counted (ignoredWarnings > 0), proving suppression -- not accidental non-triggering',
        ignoreResult.checker.ignoredWarnings > 0, `ignoredWarnings=${ignoreResult.checker.ignoredWarnings}`);

    // 6. CLEAN SCRIPT -- a realistic, hand-checked Denizen task script must yield ZERO
    // diagnostics. This is the check most likely to expose a real false positive: every line
    // was traced by hand against basicLineFormatCheck/checkForColorCodes/checkForTabs/
    // checkForBraces/checkForOldDefs before being included here (see task-5-report.md for the
    // line-by-line trace). If this comes back non-zero, that is a finding to report, not a
    // script to "fix until green".
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
    failures += check('a clean, realistic Denizen script yields ZERO diagnostics',
        cleanResult.diagnostics.length === 0,
        `${cleanResult.diagnostics.length} diagnostic(s): ${cleanResult.diagnostics.map(d => `${d.code}@${d.range.start.line}`).join(', ')}`);

    // 7. THE '§' DEVIATION -- a USER RULING (see lineChecks.ts's DELIBERATE DEVIATION comment
    // on checkForColorCodes) knowingly diverges from ScriptChecker.cs here, fixing two bugs
    // caused by the C# reading a captured `line` variable but reporting against a `i` that a
    // continuation-skip loop may have already advanced. If a future change "restores fidelity"
    // to the C#, both checks below fail.
    //
    // Case A: "- narrate §c" followed by an indented continuation line. The C# reports on the
    // LAST continuation line (wrong line, and that line doesn't even contain '§'). The fix
    // reports on line 0, where the '§' actually is.
    const sectionCaseA = diagnose('- narrate §c\n    extra');
    const sectionDiagsA = sectionCaseA.diagnostics.filter(d => d.code === 'color_code_misformat');
    failures += check('"- narrate §c" + indented continuation: color_code_misformat reports on line 0 (where the § actually is)',
        sectionDiagsA.length === 1 && sectionDiagsA[0].range.start.line === 0,
        sectionDiagsA.length === 1 ? `line=${sectionDiagsA[0].range.start.line}` : `${sectionDiagsA.length} diagnostic(s)`);

    // Case B: '§' occurs ONLY on a continuation line ("- narrate hi" then "    §c"). The C#
    // reports NOTHING at all (the more serious of the two bugs -- a real misuse goes
    // undiagnosed). The fix reports it on its own line (line 1).
    const sectionCaseB = diagnose('- narrate hi\n    §c');
    const sectionDiagsB = sectionCaseB.diagnostics.filter(d => d.code === 'color_code_misformat');
    failures += check('"- narrate hi" + "    §c": color_code_misformat is reported on the continuation line itself (line 1), not swallowed',
        sectionDiagsB.length === 1 && sectionDiagsB[0].range.start.line === 1,
        sectionDiagsB.length === 1 ? `line=${sectionDiagsB[0].range.start.line}` : `${sectionDiagsB.length} diagnostic(s)`);
    failures += check('that color_code_misformat diagnostic is severity Information (3), same mapping as any other minorWarning',
        sectionDiagsB.length === 1 && sectionDiagsB[0].severity === DiagnosticSeverity.Information,
        sectionDiagsB.length === 1 ? `severity=${sectionDiagsB[0].severity}` : '(missing)');

    // 8. REGRESSION -- a subset of Phase 2B-6's live completion assertions, re-run here because
    // this phase's diagnostics wiring landed in the same file (src/server/server.ts) as the
    // completion handler. Full detail on each of these lives in verify-phase2b6.js; re-run it
    // directly for the complete set. This is a representative sample across the shapes that
    // file covers: an ExtraData enum, a mechanism pair, the client-owns-flags boundary, tag-part
    // narrowing, and base command/name completion.
    const cooldownText = '  - narrate <player.item_cooldown[';
    const cooldownItems = provideCompletions(docs, extra, cooldownText, cooldownText.length, 0);
    failures += check('[regression] <player.item_cooldown[ (bare) offers exactly extra.materials.size items',
        cooldownItems.length === extra.materials.size, `${cooldownItems.length} vs ${extra.materials.size}`);

    const withQuaText = '  - narrate <player.item_in_hand.with[qua';
    const withQuaItems = provideCompletions(docs, extra, withQuaText, withQuaText.length, 0);
    failures += check('[regression] <player.item_in_hand.with[qua offers exactly ["quantity="]',
        withQuaItems.length === 1 && withQuaItems[0].label === 'quantity=',
        `${withQuaItems.length} item(s): ${withQuaItems.map(i => i.label).join(', ')}`);

    const flagText = '  - narrate <player.flag[';
    const flagItems = provideCompletions(docs, extra, flagText, flagText.length, 0);
    failures += check('[regression] <player.flag[ offers NOTHING from the server (client-owns-flags boundary)',
        flagItems.length === 0, `${flagItems.length} item(s)`);

    const playerDotText = '  - narrate <player.';
    const playerTraced = provideCompletions(docs, extra, playerDotText, playerDotText.length, 0);
    const playerUntraced = provideCompletions(docs, extra, playerDotText, playerDotText.length, 0, false);
    failures += check('[regression] <player. traced is non-empty and strictly narrower than untraced',
        playerTraced.length > 0 && playerTraced.length < playerUntraced.length,
        `${playerTraced.length} vs ${playerUntraced.length}`);

    const nameText = 'my_task:\n  type: task\n  script:\n  - narr';
    failures += check('[regression] command name completion still offers narrate',
        provideCompletions(docs, extra, nameText, nameText.length, 0).some(i => i.label === 'narrate'));

    const giveText = '  - give q';
    const give = provideCompletions(docs, extra, giveText, giveText.length, 0);
    failures += check('[regression] give q still returns quantity: first',
        give.length > 0 && give[0].label === 'quantity:',
        `${give.length} item(s): ${give.slice(0, 3).map(i => i.label).join(', ')}`);

    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}).catch(err => {
    console.error('Verification failed to run:', err);
    process.exit(1);
});
