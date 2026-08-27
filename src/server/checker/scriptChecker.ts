// ScriptChecker, ported from SharpDenizenTools' ScriptChecker.cs.
// This module must stay dependency-free: no `vscode-languageserver` import, no I/O.
// It builds on the pure warning model in ./scriptWarnings.

import { WarningCollector } from './scriptWarnings';
import {
    basicLineFormatCheck,
    checkForBraces,
    checkForColorCodes,
    checkForOldDefs,
    checkForTabs
} from './lineChecks';
import { gatherActualContainers } from './containerGather';
import { convertContainers, mergeData, ScriptingWorkspaceData } from './containerConvert';
import { checkAllContainers } from './containerChecks';
// `import type`: ScriptSection is a type alias, used only in type position below. A value
// import would be redundant with the line above; keeping it type-only makes the emitted JS
// carry exactly one require() for this module.
import type { ScriptSection } from './containerGather';
import type { MetaDocs } from '../metaDocs/metaTypes';
import type { ExtraData } from '../metaDocs/extraData';
import { before, toLowerFast } from './frenetic';

/**
 * Checks a script's validity. Ported from ScriptChecker.cs. `run()` now covers every step of the
 * C#'s own `Run()` (:2020-2036) except `CheckYAML` (:2025), which needs a YAML parser and so
 * conflicts with this port's no-new-dependencies rule; it is tracked in the backlog rather than
 * silently skipped.
 *
 * `ScriptChecker` extends `WarningCollector` (rather than composing it) so that `errors`,
 * `warnings`, `minorWarnings`, `infos`, `ignoredWarnings`, `ignoredWarningTypes` and `warn(...)`
 * are surfaced directly as this class's own members, mirroring how ScriptChecker.cs declares
 * them as fields on itself (:108-127) rather than on a separate collaborator.
 */
export class ScriptChecker extends WarningCollector {
    /** The full original script text, pre-normalization. (ScriptChecker.cs:65-66, `FullOriginalScript`) */
    fullOriginalScript: string;
    /** All lines of the script. (ScriptChecker.cs:68-69, `Lines`) */
    lines: string[];
    /** All lines, pre-trimmed and lowercased. (ScriptChecker.cs:71-72, `CleanedLines`) */
    cleanedLines: string[];
    /** The number of lines that were comments. (ScriptChecker.cs:74-75, `CommentLines`) */
    commentLines = 0;
    /** The number of lines that were blank. (ScriptChecker.cs:77-78, `BlankLines`) */
    blankLines = 0;
    /**
     * The number of lines that were structural (ending with a colon).
     * (ScriptChecker.cs:80-81, `StructureLines`)
     *
     * Not called out in the task's interface list, but it's computed by the very same
     * `ClearCommentsFromLines` loop this task ports (ScriptChecker.cs:210-213), so leaving it
     * out would mean porting only part of the method body.
     */
    structureLines = 0;
    /**
     * The number of lines that were code (starting with a dash).
     * (ScriptChecker.cs:83-84, `CodeLines`) See the note on `structureLines` above; same
     * reasoning applies (ScriptChecker.cs:206-209).
     */
    codeLines = 0;
    /**
     * The raw container structure gathered by `gatherActualContainers`, or `null` before
     * `run()` has been called.
     *
     * The C# keeps this as a local in `Run()` (ScriptChecker.cs:2031) and hands it straight to
     * `ConvertContainers`. It stays a field here because it is the only view of the parse
     * result before conversion, and Phase 2C-2's tests and verify script both assert on it.
     */
    containers: ScriptSection | null = null;

    /**
     * The converted containers of THIS file. (ScriptChecker.cs:130-131, `GeneratedWorkspace`)
     *
     * Populated by `convertContainers` during `run()`. This is what Phase 2C-4 checks tags
     * against, and the reason Phase 2C-3 exists.
     */
    generatedWorkspace: ScriptingWorkspaceData = new ScriptingWorkspaceData();

    /**
     * Workspace data from the OTHER files around this one, or `null`.
     * (ScriptChecker.cs:133-134, `SurroundingWorkspace`)
     *
     * Always null for now: cross-file scanning is Phase 2D. It is declared because
     * `resolveInjects` reads it (ScriptChecker.cs:1735), and giving it its real name now means
     * that code is the C#'s shape rather than a stub to revisit.
     */
    surroundingWorkspace: ScriptingWorkspaceData | null = null;

    /**
     * The loaded Denizen meta, or `null` if it is not available.
     * (ScriptChecker.cs:63, `Meta`)
     *
     * The C# reads an ambient singleton at `Run()` (`Meta = MetaDocs.CurrentMeta`, :2023). This
     * repo has no such singleton, so the docs are handed in by whoever constructs the checker --
     * `server.ts`, which already holds them.
     *
     * NULL IS A REAL STATE, NOT A DEFENSIVE ONE. Diagnostics run from the first keystroke, while
     * meta is still downloading on a cold start. Every consumer must degrade to "check nothing"
     * rather than guess, because guessing means underlining every tag in the file for the first
     * few seconds after the editor opens.
     */
    meta: MetaDocs | null = null;

    /**
     * The loaded Minecraft enum data, or null. (ScriptChecker.cs:63's `Meta.Data`)
     *
     * Separate from `meta` here because this repo loads it separately, where the C# hangs it off
     * the MetaDocs object. Only `enumerated_script_name` reads it, and that check is guarded --
     * the C# guards the same spot with `Meta.Data is not null` -- so a null is a real, harmless
     * cold-start state rather than a stub.
     */
    extraData: ExtraData | null = null;

    /**
     * Script names known to be injected into. (ScriptChecker.cs:124, `Injects`)
     *
     * Populated by `loadInjects` during `run()`. A name here (or the wildcard `'*'`) exempts that
     * container from definition checking, because an injected script inherits definitions the
     * checker cannot see from this file alone.
     */
    injects: string[] = [];

    /**
     * Constructs the checker from a script string.
     * Ported from ScriptChecker.cs:137-146.
     */
    constructor(script: string) {
        super();
        // ScriptChecker.cs:139
        this.fullOriginalScript = script;
        // ScriptChecker.cs:140-143: normalize CRLF and lone CR to LF before splitting, but only
        // when the script actually contains a '\r' at all.
        if (script.includes('\r')) {
            script = script.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
        }
        // ScriptChecker.cs:144
        this.lines = script.split('\n');
        // ScriptChecker.cs:145: `Lines.Select(s => s.Trim().ToLowerFast())`.
        //
        // `toLowerFast`, not `toLowerCase`. This was the last of five copies of the ASCII fold to
        // still be a Unicode one, and it is the most consequential: `cleanedLines` is what the
        // gatherer reads, so it decides how EVERY container title and key in the file is spelled
        // downstream. A Unicode fold rewrites Cyrillic, Greek and Turkish identifiers on the way
        // in, while the raw `lines` keep their case -- and the two are compared against each
        // other. The same slip in `tagChecks.ts` once made `- define ИМЯ` report a false
        // `def_of_nothing`.
        this.cleanedLines = this.lines.map((s) => toLowerFast(s.trim()));
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
    run(): void {
        // ScriptChecker.cs:2024
        this.clearCommentsFromLines();
        // ScriptChecker.cs:2026. Position kept for diffability, and it is NOT load-bearing:
        // running this before `clearCommentsFromLines` instead is an equivalent mutant, measured.
        // The only lines the strip changes are `#`-prefixed ones, which it blanks to `''` -- and
        // neither `#...` nor `''` starts with `- inject `, so no line can be seen as an inject on
        // one side of the strip and not the other. 0 differences across every combination of
        // comment prefix and line body tried.
        this.loadInjects();
        // ScriptChecker.cs:2027-2030, in this exact order.
        basicLineFormatCheck(this);
        // Not in the C# Run() -- this scan is inline in BasicLineFormatCheck there
        // (ScriptChecker.cs:356-360) and was split out to fix two defects; see the DELIBERATE
        // DEVIATION note in ./lineChecks. It runs immediately after the check it came from, so
        // that its warnings keep the position they used to have in `minorWarnings` relative to
        // `stray_space_eol` on the same line, and so the split stays obvious to a reader
        // diffing this method against the C#.
        checkForColorCodes(this);
        checkForTabs(this);
        checkForBraces(this);
        checkForOldDefs(this);
        // ScriptChecker.cs:2031. Must come after `clearCommentsFromLines`, which blanks comment
        // lines in both arrays -- otherwise every comment would be parsed as a structural line.
        this.containers = gatherActualContainers(this);
        // ScriptChecker.cs:2032. The C# passes the gather's result straight in as a local; it
        // is parked on `this.containers` first because 2C-2's tests assert on it directly.
        convertContainers(this, this.containers);
        // ScriptChecker.cs:2033. THE STEP THAT MAKES TAG AND COMMAND CHECKING VISIBLE: its
        // nested `checkAsScript` is the only caller of `checkSingleCommand` in the whole port,
        // and that in turn is what reaches `checkSingleArgument` and `checkSingleTag`. Note it
        // runs BEFORE mergeData, so the cross-file merge cannot influence this file's own checks.
        checkAllContainers(this);
        // ScriptChecker.cs:2034. Runs after conversion, since it reads what preprocContainer
        // harvested onto each container.
        mergeData(this);
        // ScriptChecker.cs:2035. Last, so it counts the ignored warnings that every earlier step
        // accumulated. Being last is the C#'s order but not a requirement: swapping it with
        // `mergeData` is an equivalent mutant, since `mergeData` only unions MixedKnowledgeSets --
        // it emits no warning and touches none of the four line counters.
        this.collectStatisticInfos();
    }

    /**
     * Finds the scripts this file injects into. Ported from ScriptChecker.cs:279-310.
     *
     * WHAT `injects` IS FOR. A script that is injected into gains whatever definitions the
     * injecting script had, and there is no way to know which those are from the injected script
     * alone. So a container named here is exempted from definition checking entirely
     * (`hasUnknowableDefinitions`, containerChecks.ts) rather than drowned in false
     * `def_of_nothing` warnings.
     *
     * TWO FORMS, and they are not symmetrical:
     *   - `- inject locally <something>` injects into a script in THIS file, so the target is
     *     found by walking BACKWARDS to the nearest top-level container title.
     *   - `- inject some_script` names the target directly.
     *
     * `'*'` means "every script", and is added when the target is tag-built and therefore
     * unknowable -- the same "exempt rather than guess" reflex as MixedKnowledgeSet's empty
     * prefix.
     */
    loadInjects(): void {
        for (let i = 0; i < this.cleanedLines.length; i++) {
            // ScriptChecker.cs:283
            if (this.cleanedLines[i].startsWith('- inject ')) {
                const line = this.cleanedLines[i].substring('- inject '.length);
                // ScriptChecker.cs:286. `Contains`, not `StartsWith`: `locally` may follow other
                // arguments, as in `- inject locally instantly`.
                if (line.includes('locally')) {
                    for (let x = i; x >= 0; x--) {
                        // ScriptChecker.cs:290. THREE conditions, and the third is the one doing
                        // the real work: a top-level container title is a non-empty line ending
                        // in ':' that starts at column zero. Tabs are expanded to four spaces
                        // first, so a tab-indented key is not mistaken for a title -- note that
                        // test is against the RAW line, since `cleanedLines` is trimmed and would
                        // never start with a space.
                        if (this.cleanedLines[x].length > 0 && this.cleanedLines[x].endsWith(':')
                            && !this.lines[x].replaceAll('\t', '    ').startsWith(' ')) {
                            this.injects.push(this.cleanedLines[x].slice(0, -1));
                            break;
                        }
                    }
                }
                else {
                    // ScriptChecker.cs:301-307
                    const target = before(line, ' ');
                    this.injects.push(before(target, '.'));
                    if (target.includes('<')) {
                        this.injects.push('*');
                    }
                }
            }
        }
    }

    /**
     * Reports the per-file line statistics. Ported from ScriptChecker.cs:1676-1687.
     *
     * LINE -1, deliberately: these describe the file, not any line in it. `server.ts` does not
     * publish `infos` as diagnostics at all -- statistics in the Problems panel would be noise --
     * so this exists for the verify scripts and for any future consumer that wants a summary.
     */
    collectStatisticInfos(): void {
        this.warn(this.infos, -1, 'stat_structural', `(Statistics) Total structural lines: ${this.structureLines}`, 0, 0);
        this.warn(this.infos, -1, 'stat_livecode', `(Statistics) Total live code lines: ${this.codeLines}`, 0, 0);
        this.warn(this.infos, -1, 'stat_comment', `(Statistics) Total comment lines: ${this.commentLines}`, 0, 0);
        this.warn(this.infos, -1, 'stat_blank', `(Statistics) Total blank lines: ${this.blankLines}`, 0, 0);
        // ScriptChecker.cs:1682-1685. Conditional, unlike the four above: a file that ignored
        // nothing should not carry a line saying so.
        if (this.ignoredWarnings > 0) {
            this.warn(this.infos, -1, 'stat_ignore_warnings', `(Statistics) Total ignored warnings: ${this.ignoredWarnings}`, 0, 0);
        }
    }

    /**
     * Clears all comment lines. Ported from ScriptChecker.cs:183-215 in full (the task brief's
     * plan text only quotes the opening lines of this method; the rest is reproduced here).
     */
    clearCommentsFromLines(): void {
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
                    this.warn(
                        this.minorWarnings,
                        i,
                        'todo_comment',
                        `TODO Line: ${this.lines[i].trim()}`,
                        this.lines[i].indexOf('#'),
                        this.lines[i].length
                    );
                }
                // ScriptChecker.cs:198-200: blank both arrays in place (never splice/remove) so
                // that line numbers stay stable for every warning produced by later checks.
                this.cleanedLines[i] = '';
                this.lines[i] = '';
                this.commentLines++;
            } else if (this.cleanedLines[i] === '') {
                // ScriptChecker.cs:202-204
                this.blankLines++;
            } else if (this.cleanedLines[i].startsWith('-')) {
                // ScriptChecker.cs:206-208
                this.codeLines++;
            } else if (this.cleanedLines[i].endsWith(':')) {
                // ScriptChecker.cs:210-212
                this.structureLines++;
            }
        }
    }
}
