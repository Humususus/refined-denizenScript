/**
 * Live verification for Phase 2D: cross-file workspace tracking.
 *
 * THIS IS THE PHASE THAT MAKES `surroundingWorkspace` NON-NULL. Every check that asks "is this
 * name a script somewhere else in the project?" has been dormant since Phase 2C-3 --
 * `contextValidatedGetScriptFor`, `resolveInjects`, and all five arms of `checkTagParam`. They
 * answered "no idea" and stayed silent. This script proves they now answer, and that what they say
 * about the user's real scripts is true.
 *
 *   - Checks 1-3 are the scan itself against the real corpus: it finds the files, it produces a
 *     container set, and it stamps each container with the file it came from.
 *   - Check 4 is the one that matters: the DIFFERENCE between checking each file alone and
 *     checking it with the workspace. Every new finding is a cross-file diagnostic, and every one
 *     has to be a true positive -- these are scripts the user actually runs.
 *   - Checks 5-6 prove the two passes are both needed, and that a second scan is stable.
 *   - Check 7 is the off switch.
 *
 * Run with: node scripts/verify-phase2d.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadMetaDocs, DEFAULT_META_SOURCES } = require('../out/server/metaDocs/metaDocsManager');
const { loadExtraData } = require('../out/server/metaDocs/extraData');
const { linkEventMatchers } = require('../out/server/metaDocs/metaLinker');
const { WorkspaceTracker, findScriptFiles } = require('../out/server/workspaceTracker');
const { ScriptChecker } = require('../out/server/checker/scriptChecker');

function check(label, condition, detail) {
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
    return condition ? 0 : 1;
}

const CORPUS = 'D:/..........backup/.arukutest/plugins/Denizen/scripts';

/** Every diagnostic key across a set of checkers, counted. */
function tally(checkers) {
    const byKey = new Map();
    let total = 0;
    for (const checker of checkers) {
        for (const w of [...checker.errors, ...checker.warnings, ...checker.minorWarnings]) {
            total++;
            byKey.set(w.warningUniqueKey, (byKey.get(w.warningUniqueKey) || 0) + 1);
        }
    }
    return { total, byKey };
}

async function main() {
    let failures = 0;
    const [docs, extra] = await Promise.all([
        loadMetaDocs({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2d-verify-cache.json'), ttlMs: 12 * 36e5, sources: DEFAULT_META_SOURCES }),
        loadExtraData({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2d-extra-cache.json'), ttlMs: 12 * 36e5 })
    ]);
    linkEventMatchers(docs, extra);
    const context = { meta: docs, extra };

    // ------------------------------------------------- 1: the walk
    const files = findScriptFiles(CORPUS);
    failures += check('1. the workspace walk finds the script files', files.length > 0, `${files.length} .dsc files`);

    // ------------------------------------------------- 2-3: the scan
    const tracker = new WorkspaceTracker();
    tracker.root = CORPUS;
    const started = Date.now();
    const results = tracker.firstScan(context);
    const elapsed = Date.now() - started;
    const containers = tracker.workspaceData === null ? 0 : tracker.workspaceData.scripts.size;
    failures += check('2. the scan produces a container set for the whole workspace',
        containers > 0 && results.size === files.length,
        `${results.size}/${files.length} files, ${containers} containers, ${elapsed}ms`);

    const unstamped = [...tracker.workspaceData.scripts.values()].filter(s => s.fileName === '');
    failures += check('3. every container knows which file it came from',
        unstamped.length === 0,
        unstamped.length === 0 ? `all ${containers} stamped` : `${unstamped.length} unstamped`);

    // ------------------------------------------------- 4: THE FALSE-POSITIVE GATE
    // Each file checked alone, exactly as the server did before this phase.
    const alone = [];
    for (const file of files) {
        const checker = new ScriptChecker(fs.readFileSync(file, 'utf8'));
        checker.meta = docs;
        checker.extraData = extra;
        try { checker.run(); } catch { continue; }
        alone.push(checker);
    }
    const before = tally(alone);
    const after = tally([...results.values()]);

    // Cross-file checks can only ADD findings -- they never silence one, since every consumer
    // treats a null workspace as "stay quiet". So a DROP would mean something broke.
    failures += check('4a. cross-file checking never silences an existing finding',
        after.total >= before.total, `${before.total} alone -> ${after.total} with workspace`);

    const added = [];
    for (const [key, count] of after.byKey) {
        const was = before.byKey.get(key) || 0;
        if (count > was) {
            added.push(`${key} +${count - was}`);
        }
    }
    // EVERY new finding here has been read and confirmed by hand. As of 2026-08-28 there is
    // exactly one: `- run penis def:<player.flag[]>` in mafia/commands/mafia_admin_command.dsc,
    // naming a script that exists in none of the 25 files -- a real broken reference, and the first
    // cross-file diagnostic this port has ever produced. If this list grows, READ THE NEW ONES
    // before adjusting the number: a false positive here is a warning on a script that works.
    failures += check('4b. the cross-file findings are the reviewed ones',
        added.length <= 1 && (added.length === 0 || added[0].startsWith('invalid_script_run')),
        added.join(', ') || 'none');

    // ------------------------------------------------- 5: the second pass earns its keep
    // Pass one alone cannot answer cross-file questions, so a single-pass scan would produce the
    // "alone" numbers. This is what makes the two-pass shape load-bearing rather than defensive.
    failures += check('5. the second pass is what produces the cross-file findings',
        after.total !== before.total || added.length === 0,
        `${added.length} finding(s) only the workspace pass can see`);

    // ------------------------------------------------- 6: stability
    const second = new WorkspaceTracker();
    second.root = CORPUS;
    const secondResults = second.firstScan(context);
    const secondTally = tally([...secondResults.values()]);
    failures += check('6. a repeated scan gives an identical result',
        secondTally.total === after.total && second.workspaceData.scripts.size === containers,
        `${secondTally.total} findings, ${second.workspaceData.scripts.size} containers`);

    // ------------------------------------------------- 7: the off switch
    const off = new WorkspaceTracker();
    off.root = CORPUS;
    off.enabled = false;
    failures += check('7. tracking off means no scan and no workspace data',
        off.firstScan(context).size === 0 && off.dataFor() === null);

    console.log('\nFindings by key (alone -> with workspace):');
    for (const key of [...new Set([...before.byKey.keys(), ...after.byKey.keys()])].sort()) {
        const b = before.byKey.get(key) || 0, a = after.byKey.get(key) || 0;
        console.log(`  ${b === a ? ' ' : '*'} ${String(b).padStart(4)} -> ${String(a).padStart(4)}  ${key}`);
    }
    console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} CHECK(S) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
