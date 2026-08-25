"use strict";
// ScriptChecker, ported from SharpDenizenTools' ScriptChecker.cs.
// This module must stay dependency-free: no `vscode-languageserver` import, no I/O.
// It builds on the pure warning model in ./scriptWarnings.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScriptChecker = void 0;
const scriptWarnings_1 = require("./scriptWarnings");
const lineChecks_1 = require("./lineChecks");
const containerGather_1 = require("./containerGather");
const containerConvert_1 = require("./containerConvert");
/**
 * Checks a script's validity. Ported from ScriptChecker.cs. So far this covers line
 * preparation (the constructor, ScriptChecker.cs:137-146), comment stripping
 * (ClearCommentsFromLines, ScriptChecker.cs:183-215) and the five line-level checks (see
 * ./lineChecks, ScriptChecker.cs:313-419). The rest of the C# class (CheckYAML, LoadInjects,
 * the container checks, statistic infos) is still out of scope and lands in later tasks.
 *
 * `ScriptChecker` extends `WarningCollector` (rather than composing it) so that `errors`,
 * `warnings`, `minorWarnings`, `infos`, `ignoredWarnings`, `ignoredWarningTypes` and `warn(...)`
 * are surfaced directly as this class's own members, mirroring how ScriptChecker.cs declares
 * them as fields on itself (:108-127) rather than on a separate collaborator.
 */
class ScriptChecker extends scriptWarnings_1.WarningCollector {
    /**
     * Constructs the checker from a script string.
     * Ported from ScriptChecker.cs:137-146.
     */
    constructor(script) {
        super();
        /** The number of lines that were comments. (ScriptChecker.cs:74-75, `CommentLines`) */
        this.commentLines = 0;
        /** The number of lines that were blank. (ScriptChecker.cs:77-78, `BlankLines`) */
        this.blankLines = 0;
        /**
         * The number of lines that were structural (ending with a colon).
         * (ScriptChecker.cs:80-81, `StructureLines`)
         *
         * Not called out in the task's interface list, but it's computed by the very same
         * `ClearCommentsFromLines` loop this task ports (ScriptChecker.cs:210-213), so leaving it
         * out would mean porting only part of the method body.
         */
        this.structureLines = 0;
        /**
         * The number of lines that were code (starting with a dash).
         * (ScriptChecker.cs:83-84, `CodeLines`) See the note on `structureLines` above; same
         * reasoning applies (ScriptChecker.cs:206-209).
         */
        this.codeLines = 0;
        /**
         * The raw container structure gathered by `gatherActualContainers`, or `null` before
         * `run()` has been called.
         *
         * The C# keeps this as a local in `Run()` (ScriptChecker.cs:2031) and hands it straight to
         * `ConvertContainers`. It stays a field here because it is the only view of the parse
         * result before conversion, and Phase 2C-2's tests and verify script both assert on it.
         */
        this.containers = null;
        /**
         * The converted containers of THIS file. (ScriptChecker.cs:130-131, `GeneratedWorkspace`)
         *
         * Populated by `convertContainers` during `run()`. This is what Phase 2C-4 checks tags
         * against, and the reason Phase 2C-3 exists.
         */
        this.generatedWorkspace = new containerConvert_1.ScriptingWorkspaceData();
        /**
         * Workspace data from the OTHER files around this one, or `null`.
         * (ScriptChecker.cs:133-134, `SurroundingWorkspace`)
         *
         * Always null for now: cross-file scanning is Phase 2D. It is declared because
         * `resolveInjects` reads it (ScriptChecker.cs:1735), and giving it its real name now means
         * that code is the C#'s shape rather than a stub to revisit.
         */
        this.surroundingWorkspace = null;
        // ScriptChecker.cs:139
        this.fullOriginalScript = script;
        // ScriptChecker.cs:140-143: normalize CRLF and lone CR to LF before splitting, but only
        // when the script actually contains a '\r' at all.
        if (script.includes('\r')) {
            script = script.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
        }
        // ScriptChecker.cs:144
        this.lines = script.split('\n');
        // ScriptChecker.cs:145
        this.cleanedLines = this.lines.map((s) => s.trim().toLowerCase());
    }
    /**
     * Runs the full script check. Ported from ScriptChecker.cs:2020-2036.
     *
     * Only the steps that have actually been ported are called. The C# `Run()` additionally
     * does `Meta = MetaDocs.CurrentMeta` (:2023), `CheckYAML()` (:2025), `LoadInjects()` (:2026),
     * `GatherActualContainers()`/`ConvertContainers()`/`CheckAllContainers()` (:2031-2033),
     * `MergeData()` (:2034) and `CollectStatisticInfos()` (:2035); those land in later tasks and
     * will slot into the gaps below, keeping this method's relative order intact.
     *
     * Order matters and is not arbitrary: `clearCommentsFromLines` blanks comment lines in
     * BOTH `lines` and `cleanedLines` first, so the five line checks never report against text
     * inside a comment, and `##ignorewarning` directives are registered before any warning can
     * be raised.
     */
    run() {
        // ScriptChecker.cs:2024
        this.clearCommentsFromLines();
        // ScriptChecker.cs:2027-2030, in this exact order.
        (0, lineChecks_1.basicLineFormatCheck)(this);
        // Not in the C# Run() -- this scan is inline in BasicLineFormatCheck there
        // (ScriptChecker.cs:356-360) and was split out to fix two defects; see the DELIBERATE
        // DEVIATION note in ./lineChecks. It runs immediately after the check it came from, so
        // that its warnings keep the position they used to have in `minorWarnings` relative to
        // `stray_space_eol` on the same line, and so the split stays obvious to a reader
        // diffing this method against the C#.
        (0, lineChecks_1.checkForColorCodes)(this);
        (0, lineChecks_1.checkForTabs)(this);
        (0, lineChecks_1.checkForBraces)(this);
        (0, lineChecks_1.checkForOldDefs)(this);
        // ScriptChecker.cs:2031. Must come after `clearCommentsFromLines`, which blanks comment
        // lines in both arrays -- otherwise every comment would be parsed as a structural line.
        this.containers = (0, containerGather_1.gatherActualContainers)(this);
        // ScriptChecker.cs:2032. The C# passes the gather's result straight in as a local; it
        // is parked on `this.containers` first because 2C-2's tests assert on it directly.
        (0, containerConvert_1.convertContainers)(this, this.containers);
        // ScriptChecker.cs:2034. Runs after conversion, since it reads what preprocContainer
        // harvested onto each container.
        (0, containerConvert_1.mergeData)(this);
        // Still out of scope: CheckAllContainers (:2033) and CollectStatisticInfos (:2035).
    }
    /**
     * Clears all comment lines. Ported from ScriptChecker.cs:183-215 in full (the task brief's
     * plan text only quotes the opening lines of this method; the rest is reproduced here).
     */
    clearCommentsFromLines() {
        for (let i = 0; i < this.cleanedLines.length; i++) {
            if (this.cleanedLines[i].startsWith('#')) {
                // ScriptChecker.cs:189-192: NOTE the asymmetry -- the "##" prefix check runs
                // against the RAW line (this.lines[i]), not the cleaned one, while the
                // "##ignorewarning " directive text is matched against the cleaned line. This
                // means a directive with leading whitespace before the "##" (which only the
                // cleaned line would trim away) is deliberately NOT recognized as an ignore
                // directive. It looks like a bug until you see it's load-bearing in the C#, so
                // it's ported as-is rather than "fixed".
                if (this.lines[i].startsWith('##') && this.cleanedLines[i].startsWith('##ignorewarning ')) {
                    this.ignoredWarningTypes.add(this.cleanedLines[i].slice('##ignorewarning '.length));
                }
                // ScriptChecker.cs:193-197
                const comment = this.cleanedLines[i].slice(1).trim();
                if (comment.startsWith('todo')) {
                    this.warn(this.minorWarnings, i, 'todo_comment', `TODO Line: ${this.lines[i].trim()}`, this.lines[i].indexOf('#'), this.lines[i].length);
                }
                // ScriptChecker.cs:198-200: blank both arrays in place (never splice/remove) so
                // that line numbers stay stable for every warning produced by later checks.
                this.cleanedLines[i] = '';
                this.lines[i] = '';
                this.commentLines++;
            }
            else if (this.cleanedLines[i] === '') {
                // ScriptChecker.cs:202-204
                this.blankLines++;
            }
            else if (this.cleanedLines[i].startsWith('-')) {
                // ScriptChecker.cs:206-208
                this.codeLines++;
            }
            else if (this.cleanedLines[i].endsWith(':')) {
                // ScriptChecker.cs:210-212
                this.structureLines++;
            }
        }
    }
}
exports.ScriptChecker = ScriptChecker;
//# sourceMappingURL=scriptChecker.js.map