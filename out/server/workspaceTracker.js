"use strict";
// Cross-file workspace tracking, ported from DenizenLangServer/WorkspaceTracker.cs (150 lines).
//
// WHAT THIS IS FOR. Every check that asks "is this name a script somewhere else in the project?"
// -- `contextValidatedGetScriptFor`, `resolveInjects`, all five arms of `checkTagParam` -- reads
// `checker.surroundingWorkspace`. Until this file existed that was always null, so those checks
// answered "no idea" and stayed silent. This is what fills it in.
//
// Unlike everything under checker/, this module DOES do I/O: it walks the workspace directory and
// reads files. That is its whole job. It is kept out of checker/ for exactly that reason.
//
// DELIBERATE SIMPLIFICATION vs the C#. WorkspaceTracker.cs is a static class holding a
// ConcurrentDictionary, a volatile field, a lock object and a counter, because it is driven from
// several threads. Node's server is single-threaded and its scan is synchronous, so the same
// design here would be ceremony around a mutex nothing contends for. This is a plain class with a
// Map, and the `LastUpdate`/`UpdateLock` machinery (WorkspaceTracker.cs:20-24, :47, :89-96) has no
// counterpart. Nothing about WHAT gets computed changes; see `rescanAll`.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceTracker = exports.findScriptFiles = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const scriptChecker_1 = require("./checker/scriptChecker");
const containerConvert_1 = require("./checker/containerConvert");
/**
 * Every `.dsc` file under `root`, recursively.
 * (WorkspaceTracker.cs:101, `Directory.EnumerateFiles(..., SearchOption.AllDirectories)`)
 *
 * A directory that cannot be read is SKIPPED, not fatal. A workspace routinely contains things the
 * editor process may not open -- a permission-denied folder, a broken symlink, a directory deleted
 * between the listing and the descent -- and none of that is a reason to abandon the scan and leave
 * every cross-file check silent.
 */
function findScriptFiles(root) {
    const found = [];
    const walk = (dir) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch (_a) {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            }
            else if (entry.isFile() && entry.name.toLowerCase().endsWith('.dsc')) {
                found.push(full);
            }
        }
    };
    walk(root);
    return found;
}
exports.findScriptFiles = findScriptFiles;
/**
 * Tracks every script file in the workspace and the combined data they produce.
 * Ported from WorkspaceTracker.cs:14-148.
 */
class WorkspaceTracker {
    constructor() {
        /** Absolute path of the workspace root, or null when there is no workspace open. */
        this.root = null;
        /** Whether to scan at all. (`ClientConfiguration.TrackFullWorkspace`, default true.) */
        this.enabled = true;
        /** Path -> its checker. (WorkspaceTracker.cs:16, `Checkers`) */
        this.files = new Map();
        /** The merged data of every tracked file, or null before the first scan. (:18, `WorkspaceData`) */
        this.workspaceData = null;
        /** Whether the first-time scan has run. (:22, `EverLoadedWorkspace`) */
        this.everScanned = false;
    }
    /**
     * Normalizes a path for use as a map key.
     *
     * The C# spends 24 lines on this (`FixPath`, :53-76) because it is unpicking VS Code's URI
     * escaping by hand, including a heuristic OS check on the first three characters. This port
     * receives real filesystem paths from `findScriptFiles` and converts URIs separately, so all
     * that is left is `path.resolve` -- which already canonicalizes separators and relative
     * segments per platform -- plus a case fold, because Windows hands the same file to the server
     * spelled several ways and two keys for one file would merge its containers twice.
     *
     * A `replaceAll('\\', '/')` was written here first and then measured inert: `path.resolve`
     * turns `a/b.dsc` and `a\b.dsc` into the same string on Windows already, so it never changed
     * which spellings collide. It was removed rather than kept as belt-and-braces -- and on POSIX
     * it would have been actively wrong, mangling a filename that legitimately contains a
     * backslash into a directory separator.
     */
    static normalize(filePath) {
        return path.resolve(filePath).toLowerCase();
    }
    /**
     * Records a checker for a file. (WorkspaceTracker.cs:30-38, `AddInternal`)
     *
     * Stamps `fileName` on every container, which is how a later consumer can say WHICH file a
     * script came from. The C# strips the workspace path to make it relative; same here.
     */
    add(filePath, checker) {
        const key = WorkspaceTracker.normalize(filePath);
        const relative = this.root === null ? filePath : path.relative(this.root, filePath).replaceAll('\\', '/');
        for (const script of checker.generatedWorkspace.scripts.values()) {
            script.fileName = relative;
        }
        this.files.set(key, { checker, relativePath: relative });
    }
    /** Merges every tracked file's own data into one workspace. (WorkspaceTracker.cs:117-122, :136-141) */
    mergeAll() {
        const combined = new containerConvert_1.ScriptingWorkspaceData();
        for (const tracked of this.files.values()) {
            combined.mergeIn(tracked.checker.generatedWorkspace);
        }
        return combined;
    }
    /**
     * Replaces one file's data from an already-run checker, and re-merges.
     * (WorkspaceTracker.cs:40-49, `Replace`)
     *
     * Called for the file the user is editing, on every debounced diagnostic run.
     */
    replace(filePath, checker) {
        if (!this.enabled || this.root === null) {
            return;
        }
        this.add(filePath, checker);
        this.workspaceData = this.mergeAll();
    }
    /**
     * The first-time scan: read every file, check it, merge, then check everything AGAIN with the
     * merged data in hand. (WorkspaceTracker.cs:97-135)
     *
     * THE SECOND PASS IS THE WHOLE POINT and is not redundant. The first pass exists only to
     * discover what scripts the workspace contains; during it `surroundingWorkspace` is null, so
     * every cross-file check is silent and the diagnostics it produces are incomplete. Only once
     * every file's containers are known can a file be checked against them. The C# publishes
     * diagnostics for every file at the end of the second pass (:131), which is why a fresh window
     * shows problems for files that were never opened.
     *
     * Returns the checkers of the second pass, keyed by absolute path, so the caller can publish
     * them. Publishing is not done here: this module has no connection and no business having one.
     */
    firstScan(context) {
        if (!this.enabled || this.root === null) {
            return new Map();
        }
        this.everScanned = true;
        return this.scanPaths(findScriptFiles(this.root), context);
    }
    /**
     * The two passes themselves, over an explicit file list.
     *
     * Split from `firstScan` because "find the files" and "check these files" are separate jobs
     * with separate failure modes -- and because the per-file read guard in `runOne` is only
     * reachable with a path that lists cleanly and then fails to read, which `findScriptFiles`
     * will never hand it. Testing that guard needs a way in.
     */
    scanPaths(paths, context) {
        const results = new Map();
        // Pass one: discover. `null`, NOT `this.workspaceData` -- the C# passes nothing here
        // (:108). On a genuine first scan the two are the same, since nothing has merged yet; they
        // differ only if `replace` ran first, which it can, because a document opened before the
        // meta finishes loading gets diagnosed and fed back in. Passing the partial data would let
        // pass one resolve injects against a fraction of the workspace, and pass one's whole job is
        // to enumerate containers, not to produce results.
        //
        // EXPECTED AUDIT SURVIVOR: no test kills the swap. Pass one's checkers are discarded, and
        // its only outlet is the container set feeding `combined` -- so the difference is real but
        // reaches the outside world through nothing observable. Kept as the C# has it.
        for (const filePath of paths) {
            const checker = this.runOne(filePath, context, null);
            if (checker !== null) {
                this.add(filePath, checker);
            }
        }
        const combined = this.mergeAll();
        // Pass two: check each file against everything discovered.
        for (const filePath of paths) {
            const checker = this.runOne(filePath, context, combined);
            if (checker !== null) {
                this.add(filePath, checker);
                results.set(filePath, checker);
            }
        }
        // Rebuilt from the second pass, whose containers are the ones now stored.
        this.workspaceData = this.mergeAll();
        return results;
    }
    /**
     * Reads and checks one file. Returns null if it could not be read or the check threw.
     *
     * A file that vanished between the listing and the read, or one the process cannot open, must
     * cost only itself -- the C# lets such an exception escape into `UpdateWorkspaceData`'s single
     * try/catch (:143-146), which abandons the ENTIRE scan and leaves the workspace data null.
     * Handling it per file instead is a DELIBERATE DEVIATION, and a small one: it only ever means
     * more of the workspace gets scanned than the C# would manage.
     */
    runOne(filePath, context, surrounding) {
        let text;
        try {
            text = fs.readFileSync(filePath, 'utf-8');
        }
        catch (_a) {
            return null;
        }
        try {
            const checker = new scriptChecker_1.ScriptChecker(text);
            checker.meta = context.meta;
            checker.extraData = context.extra;
            checker.surroundingWorkspace = surrounding;
            checker.run();
            return checker;
        }
        catch (_b) {
            return null;
        }
    }
    /** Forgets a file, e.g. when it is deleted. Re-merges so its scripts stop being visible. */
    remove(filePath) {
        if (this.files.delete(WorkspaceTracker.normalize(filePath))) {
            this.workspaceData = this.mergeAll();
        }
    }
    /** The data a checker should be given for a file, or null when tracking is off or nothing is scanned. */
    dataFor() {
        if (!this.enabled) {
            return null;
        }
        return this.workspaceData;
    }
}
exports.WorkspaceTracker = WorkspaceTracker;
//# sourceMappingURL=workspaceTracker.js.map