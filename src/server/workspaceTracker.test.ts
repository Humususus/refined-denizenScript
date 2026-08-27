import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceTracker, findScriptFiles } from './workspaceTracker';
import { ScriptChecker } from './checker/scriptChecker';
import { createEmptyMetaDocs } from './metaDocs/metaTypes';
import { buildMetaDocs } from './metaDocs/metaDocsManager';
import { createEmptyExtraData } from './metaDocs/extraData';

/**
 * Derived from DenizenLangServer/WorkspaceTracker.cs (150 lines).
 *
 * This is the module that finally makes `surroundingWorkspace` non-null, which is what every
 * cross-file check has been waiting for since Phase 2C-3. Unlike the rest of the checker these
 * tests touch the real filesystem, because walking it is the thing under test.
 */

let root: string;

/** Writes a file under the temp workspace, creating directories as needed. */
function write(relative: string, content: string): string {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
}

function task(name: string): string {
    return `${name}:\n    type: task\n    script:\n    - narrate hi\n`;
}

/** A tracker rooted at the temp workspace, with tracking on. */
function tracker(): WorkspaceTracker {
    const t = new WorkspaceTracker();
    t.root = root;
    return t;
}

const CONTEXT = { meta: createEmptyMetaDocs(), extra: createEmptyExtraData() };

/**
 * A meta documenting just the `run` command, for the cross-file payoff tests.
 *
 * The empty meta above is enough for everything else, but `invalid_script_run` lives inside the
 * `run` branch of `checkSingleCommand`, which is never reached for a command the meta does not
 * know -- so with an empty meta that test passes whether the check works or not.
 */
const RUN_CONTEXT = {
    meta: buildMetaDocs([{
        objectType: 'command', url: 'src#L1',
        data: ['@name run', '@syntax run [<script>] (path:<name>)', '@short Runs a script.',
            '@group core', '@description x', '@usage x', '@end_meta']
    }]),
    extra: createEmptyExtraData()
};

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-workspace-test-'));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe('findScriptFiles (WorkspaceTracker.cs:101)', () => {
    it('finds .dsc files at the root', () => {
        write('a.dsc', task('a_task'));
        expect(findScriptFiles(root).map(f => path.basename(f))).toEqual(['a.dsc']);
    });

    it('recurses into subdirectories', () => {
        // `SearchOption.AllDirectories`. MUTANT CAUGHT: a flat readdir -- a workspace with its
        // scripts in folders would look empty, and every cross-file check would stay silent.
        write('deep/deeper/b.dsc', task('b_task'));
        expect(findScriptFiles(root).map(f => path.basename(f))).toEqual(['b.dsc']);
    });

    it('ignores files that are not .dsc', () => {
        write('notes.txt', 'hello');
        write('config.yml', 'hello');
        expect(findScriptFiles(root)).toEqual([]);
    });

    it('matches the extension case-insensitively', () => {
        write('LOUD.DSC', task('loud_task'));
        expect(findScriptFiles(root).length).toBe(1);
    });

    it('returns an empty list for a directory that does not exist', () => {
        // A workspace root can be stale or unreadable, and that must not throw -- the caller has
        // no better answer than "no files" and a thrown error would abandon the whole scan.
        // MUTANT CAUGHT: dropping the try/catch around readdirSync.
        expect(findScriptFiles(path.join(root, 'nope'))).toEqual([]);
    });

    it('skips an unreadable subdirectory but keeps the rest', () => {
        // MUTANT CAUGHT: letting the error escape, which would lose every file found so far.
        write('good.dsc', task('good_task'));
        const bad = path.join(root, 'bad');
        fs.mkdirSync(bad);
        // A file where a directory is expected is the portable way to make the descent fail.
        fs.rmdirSync(bad);
        fs.writeFileSync(bad, 'not a directory');
        expect(findScriptFiles(root).map(f => path.basename(f))).toEqual(['good.dsc']);
    });
});

describe('WorkspaceTracker.firstScan (WorkspaceTracker.cs:97-135)', () => {
    it('collects every container in the workspace', () => {
        write('a.dsc', task('first_task_name'));
        write('sub/b.dsc', task('second_task_name'));
        const t = tracker();
        t.firstScan(CONTEXT);
        expect([...t.workspaceData!.scripts.keys()].sort()).toEqual(['first_task_name', 'second_task_name']);
    });

    it('gives every checker the merged workspace on the SECOND pass', () => {
        // THE REASON THERE ARE TWO PASSES. The first only discovers what exists; a file checked
        // during it has no cross-file knowledge. Only the second pass can see other files.
        // MUTANT CAUGHT: dropping the second pass, or passing null to it.
        write('a.dsc', task('first_task_name'));
        write('b.dsc', task('second_task_name'));
        const t = tracker();
        const results = t.firstScan(CONTEXT);
        for (const checker of results.values()) {
            expect(checker.surroundingWorkspace).not.toBeNull();
            expect(checker.surroundingWorkspace!.scripts.size).toBe(2);
        }
    });

    it('returns one checker per file, for publishing', () => {
        write('a.dsc', task('first_task_name'));
        write('b.dsc', task('second_task_name'));
        expect(tracker().firstScan(CONTEXT).size).toBe(2);
    });

    it('stamps each container with its file path, relative to the root', () => {
        // WorkspaceTracker.cs:32-36. Without this a container knows nothing about where it lives.
        // MUTANT CAUGHT: storing the absolute path, or not stamping at all.
        write('sub/deep/b.dsc', task('deep_task_name'));
        const t = tracker();
        t.firstScan(CONTEXT);
        expect(t.workspaceData!.scripts.get('deep_task_name')!.fileName).toBe('sub/deep/b.dsc');
    });

    it('does nothing when tracking is switched off', () => {
        // `ClientConfiguration.TrackFullWorkspace` (WorkspaceTracker.cs:42). The user asked for
        // single-file checking; scanning anyway would be both slow and wrong.
        // MUTANT CAUGHT: ignoring the flag.
        write('a.dsc', task('first_task_name'));
        const t = tracker();
        t.enabled = false;
        expect(t.firstScan(CONTEXT).size).toBe(0);
        expect(t.workspaceData).toBeNull();
    });

    it('does nothing when there is no workspace root', () => {
        // A single file opened with no folder. MUTANT CAUGHT: defaulting the root to cwd, which
        // would scan whatever directory the editor happened to start in.
        const t = new WorkspaceTracker();
        expect(t.firstScan(CONTEXT).size).toBe(0);
        // AND the data stays null, rather than becoming an empty workspace. That difference is the
        // whole test: dropping the root guard still yields no files -- findScriptFiles swallows the
        // failure -- but it would leave an EMPTY ScriptingWorkspaceData behind, and empty is not
        // the same as absent. Every cross-file check reads null as "no knowledge, stay quiet" and
        // an empty workspace as "nothing exists anywhere", which turns every `run` into an error.
        // MUTANT CAUGHT: dropping the `root === null` guard from firstScan.
        expect(t.workspaceData).toBeNull();
    });

    it('does not list a file that was deleted before the scan', () => {
        // NOT the same thing as the read guard below, and the difference matters: a file deleted
        // before `findScriptFiles` runs is never listed, so `runOne` is never called for it and
        // its try/catch is not what saves the scan.
        write('good.dsc', task('good_task_name'));
        const gone = write('gone.dsc', task('gone_task_name'));
        fs.rmSync(gone);
        const t = tracker();
        const results = t.firstScan(CONTEXT);
        expect(results.size).toBe(1);
        expect([...t.workspaceData!.scripts.keys()]).toEqual(['good_task_name']);
    });

    it('survives a listed file that cannot be read', () => {
        // DELIBERATE DEVIATION from WorkspaceTracker.cs:143-146, which wraps the whole scan in one
        // try/catch and so loses EVERY file to one bad one. The race is real in a live editor: a
        // file can be deleted between the directory listing and the read.
        //
        // Reproduced by making the failing path a DIRECTORY named `*.dsc`, on which readFileSync
        // throws EISDIR. `findScriptFiles` filters on `isFile()` and would never hand such a path
        // to `runOne`, which is exactly why `scanPaths` takes the list explicitly -- the guard is
        // unreachable through `firstScan` and so untestable through it.
        // MUTANT CAUGHT: hoisting the try/catch out of runOne.
        const good = write('good.dsc', task('good_task_name'));
        const trap = path.join(root, 'trap.dsc');
        fs.mkdirSync(trap);
        expect(() => fs.readFileSync(trap, 'utf-8')).toThrow();
        const t = tracker();
        const results = t.scanPaths([trap, good], CONTEXT);
        expect(results.size).toBe(1);
        expect([...t.workspaceData!.scripts.keys()]).toEqual(['good_task_name']);
    });

    it('records that it has scanned, so it happens once', () => {
        write('a.dsc', task('first_task_name'));
        const t = tracker();
        expect(t.everScanned).toBe(false);
        t.firstScan(CONTEXT);
        expect(t.everScanned).toBe(true);
    });
});

describe('WorkspaceTracker.replace (WorkspaceTracker.cs:40-49)', () => {
    it('adds a newly checked file to the merged data', () => {
        write('a.dsc', task('first_task_name'));
        const t = tracker();
        t.firstScan(CONTEXT);
        const checker = new ScriptChecker(task('brand_new_task'));
        checker.run();
        t.replace(path.join(root, 'b.dsc'), checker);
        expect([...t.workspaceData!.scripts.keys()].sort()).toEqual(['brand_new_task', 'first_task_name']);
    });

    it('REPLACES a file rather than accumulating its old containers', () => {
        // The user renaming a task must not leave the old name visible forever -- every cross-file
        // check would keep accepting a script that no longer exists.
        // MUTANT CAUGHT: merging into the existing data instead of rebuilding from the file map.
        const file = write('a.dsc', task('old_task_name'));
        const t = tracker();
        t.firstScan(CONTEXT);
        expect([...t.workspaceData!.scripts.keys()]).toEqual(['old_task_name']);
        const checker = new ScriptChecker(task('new_task_name'));
        checker.run();
        t.replace(file, checker);
        expect([...t.workspaceData!.scripts.keys()]).toEqual(['new_task_name']);
    });

    it('treats a path differing only in slashes or case as the same file', () => {
        // Windows hands the same file to the server spelled several ways; two keys for one file
        // would merge its containers twice and, worse, keep a stale copy after a rename.
        // MUTANT CAUGHT: using the raw path as the map key.
        const file = write('a.dsc', task('old_task_name'));
        const t = tracker();
        t.firstScan(CONTEXT);
        const checker = new ScriptChecker(task('new_task_name'));
        checker.run();
        t.replace(file.replaceAll('\\', '/').toUpperCase(), checker);
        expect(t.files.size).toBe(1);
        expect([...t.workspaceData!.scripts.keys()]).toEqual(['new_task_name']);
    });

    it('does nothing when tracking is off', () => {
        const t = tracker();
        t.enabled = false;
        const checker = new ScriptChecker(task('a_task_name'));
        checker.run();
        t.replace(path.join(root, 'a.dsc'), checker);
        expect(t.workspaceData).toBeNull();
    });
});

describe('WorkspaceTracker.remove and dataFor', () => {
    it('forgets a deleted file and its containers', () => {
        const file = write('a.dsc', task('first_task_name'));
        write('b.dsc', task('second_task_name'));
        const t = tracker();
        t.firstScan(CONTEXT);
        t.remove(file);
        expect([...t.workspaceData!.scripts.keys()]).toEqual(['second_task_name']);
    });

    it('ignores a file it was not tracking', () => {
        write('a.dsc', task('first_task_name'));
        const t = tracker();
        t.firstScan(CONTEXT);
        t.remove(path.join(root, 'never_seen.dsc'));
        expect([...t.workspaceData!.scripts.keys()]).toEqual(['first_task_name']);
    });

    it('reports null data while tracking is off, without discarding it', () => {
        // `dataFor` is what the diagnostics path reads. Turning tracking off must make the checker
        // see no cross-file data -- but flipping it back on should not require a rescan.
        // MUTANT CAUGHT: having dataFor ignore `enabled`, or having it clear workspaceData.
        write('a.dsc', task('first_task_name'));
        const t = tracker();
        t.firstScan(CONTEXT);
        expect(t.dataFor()).not.toBeNull();
        t.enabled = false;
        expect(t.dataFor()).toBeNull();
        t.enabled = true;
        expect(t.dataFor()!.scripts.size).toBe(1);
    });

    it('reports null before any scan has happened', () => {
        expect(tracker().dataFor()).toBeNull();
    });
});

describe('the cross-file payoff', () => {
    it('resolves a run target defined in ANOTHER file', () => {
        // The whole point of the phase, in one test. `- run other_task_name` is valid only because
        // a different file defines it, and before Phase 2D the checker could not know that.
        write('caller.dsc', 'caller_task_name:\n    type: task\n    script:\n    - run other_task_name\n');
        write('callee.dsc', task('other_task_name'));
        const t = tracker();
        const results = t.firstScan(RUN_CONTEXT);
        const caller = [...results.entries()].find(([f]) => f.endsWith('caller.dsc'))![1];
        // `errors`, not `warnings`: commandSpecifics.ts:270 raises this as an error.
        expect(caller.errors.map(w => w.warningUniqueKey)).not.toContain('invalid_script_run');
    });

    it('reports a run target that exists in NO file', () => {
        // The other half. Without it the test above would pass with checking switched off.
        // MUTANT CAUGHT: never populating surroundingWorkspace, which makes this check silent.
        write('caller.dsc', 'caller_task_name:\n    type: task\n    script:\n    - run no_such_task_anywhere\n');
        write('callee.dsc', task('other_task_name'));
        const t = tracker();
        const results = t.firstScan(RUN_CONTEXT);
        const caller = [...results.entries()].find(([f]) => f.endsWith('caller.dsc'))![1];
        expect(caller.errors.map(w => w.warningUniqueKey)).toContain('invalid_script_run');
    });
});
