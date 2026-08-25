// Container conversion, ported from SharpDenizenTools' ScriptChecker.cs:1689-1760
// (`ConvertContainers`), plus ScriptContainerData.cs and ScriptingWorkspaceData.cs.
// This module must stay dependency-free: no `vscode-languageserver` import, no I/O.
//
// `gatherActualContainers` (Phase 2C-2) produces a nested map of keys to values -- the file's
// SHAPE. This turns that shape into a list of real containers: each one's name, line, declared
// type and the metadata for that type. It also raises the three container-level errors.
//
// The point of the phase is the DATA, not the diagnostics. `<[x]>` on an undefined definition
// can only be checked against `defNames`, and `<server.flag[y]>` against `serverFlags`; those
// live on `ScriptContainerData` and are filled by `preprocContainer` (Task 5).

import { LineTrackedString } from './scriptWarnings';
import { MixedKnowledgeSet } from './mixedKnowledgeSet';
import { KNOWN_SCRIPT_TYPES } from './scriptTypes';
import type { KnownScriptType } from './scriptTypes';
import type { ScriptSection, SectionValue } from './containerGather';
// `import type` (not a plain import) is load-bearing: scriptChecker.ts imports this module for
// real, so a value import here would close a require() cycle at runtime. Same pattern as
// lineChecks.ts and containerGather.ts.
import type { ScriptChecker } from './scriptChecker';

/**
 * The data of a script container. Ported from ScriptContainerData.cs:11-48.
 *
 * The four `MixedKnowledgeSet` fields are what Phase 2C-4 checks tags against, and they are the
 * reason this phase exists.
 */
export class ScriptContainerData {
    /** The name of the script, trimmed and lowercased. (ScriptContainerData.cs:14) */
    name = '';
    /** The line the container's TITLE key is on. (:17) */
    lineNumber = 0;
    /**
     * The name of the file the script is from. (:20)
     *
     * Declared because the C# declares it, and left empty because `ConvertContainers` never
     * assigns it either -- it is filled by the workspace-scanning path, which is Phase 2D.
     */
    fileName = '';
    /** What type the script is ("task", "world", ...), cleaned. (:23) */
    type = '';
    /** The metadata for that type. (:26) */
    knownType: KnownScriptType | null = null;
    /** Definitions established within command sections of this script. (:29) */
    defNames = new MixedKnowledgeSet();
    /** `save:` argument names established within command sections. (:32) */
    saveEntryNames = new MixedKnowledgeSet();
    /** Sub-scripts injected within command sections. (:35) */
    injectedPaths = new MixedKnowledgeSet();
    /** Script names known to actually be injected by this script. (:38) */
    realInjects = new Set<string>();
    /** Server flags set by command sections of this script. (:41) */
    serverFlags = new MixedKnowledgeSet();
    /** Object flags set by command sections of this script. (:44) */
    objectFlags = new MixedKnowledgeSet();
    /** The container's own keys, as gathered. (:47) */
    keys: ScriptSection = new Map();
}

/** A full workspace of scripts. Ported from ScriptingWorkspaceData.cs:10-31. */
export class ScriptingWorkspaceData {
    /** All server flag names set within the workspace. (:13) */
    allKnownServerFlagNames = new MixedKnowledgeSet();
    /** All object flag names set within the workspace. (:16) */
    allKnownObjectFlagNames = new MixedKnowledgeSet();
    /** All containers within the workspace, keyed by lowercased name. (:19) */
    scripts = new Map<string, ScriptContainerData>();

    /** Merges another workspace's data into this one. (ScriptingWorkspaceData.cs:22-30) */
    mergeIn(other: ScriptingWorkspaceData): void {
        this.allKnownServerFlagNames.mergeIn(other.allKnownServerFlagNames);
        this.allKnownObjectFlagNames.mergeIn(other.allKnownObjectFlagNames);
        for (const [name, data] of other.scripts) {
            this.scripts.set(name, data);
        }
    }
}

/**
 * ASCII-only lowercasing, matching FreneticUtilities' `ToLowerFast()`.
 *
 * Same helper and same reasoning as containerGather.ts's copy: a plain `toLowerCase()` is
 * Unicode-aware and can CHANGE A STRING'S LENGTH ('İ' U+0130 lowercases to two code units).
 * Here that would corrupt a container's `name`, which is the key the whole workspace is
 * indexed by.
 */
function toLowerFast(text: string): string {
    return text.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** FreneticUtilities' `string.Before(char)`: everything before the first occurrence, else all of it. */
function before(input: string, match: string): string {
    const index = input.indexOf(match);
    return index < 0 ? input : input.slice(0, index);
}

/**
 * What the C# gets from calling `.ToString()` on a `SectionValue`.
 *
 * `LineTrackedString.ToString()` is overridden to return `Text` (ScriptChecker.cs:1387-1391),
 * which is the only case `ConvertContainers` actually cares about.
 *
 * UNAVOIDABLE DIVERGENCE for the other two arms, and it is harmless. When `definitions:` holds a
 * SECTION rather than a scalar, C# reaches `Dictionary<,>.ToString()` and gets the .NET type
 * name; we cannot reproduce that string and there is no reason to want to. Either way the result
 * is one meaningless entry in `defNames` -- a "definition" nobody could ever write -- so the
 * observable behaviour (2C-4 accepting one impossible name) is identical.
 */
function valueToString(value: SectionValue): string {
    if (value instanceof LineTrackedString) {
        return value.text;
    }
    if (Array.isArray(value)) {
        return '[list]';
    }
    return '[section]';
}

/**
 * Converts the raw container structure into trackable container objects, storing them on the
 * checker's `generatedWorkspace`. Ported from ScriptChecker.cs:1689-1760.
 *
 * Three error keys come out of four call sites: `invalid_container` (:1697 missing content and
 * :1702 missing type), `wrong_type` (:1708) and `exception_internal_container` (:1730). All four
 * go onto `errors`.
 */
export function convertContainers(checker: ScriptChecker, containers: ScriptSection): void {
    const workspace = checker.generatedWorkspace;
    // ScriptChecker.cs:1691
    for (const entry of containers.values()) {
        const title = entry.key;
        const data = entry.value;
        // ScriptChecker.cs:1693, :1728-1732. The try/catch is SPECIFIED BEHAVIOUR, not
        // defensive noise: one container that throws must not take the rest of the file down.
        try {
            // ScriptChecker.cs:1695-1699. A container whose value is a scalar or a list has no
            // keys to read, so there is nothing to convert.
            if (!(data instanceof Map)) {
                checker.warn(
                    checker.errors,
                    title.line,
                    'invalid_container',
                    `Script \`${title.text}\` is invalid - missing content?`,
                    0,
                    checker.lines[title.line].length
                );
                continue;
            }
            const map: ScriptSection = data;
            // ScriptChecker.cs:1700-1704. NOTE the second half of the condition: a `type:` key
            // holding a SECTION or a LIST rather than a scalar also lands here, and gets the
            // "missing 'type' key" message even though the key is present.
            const typeEntry = map.get(LineTrackedString.textKey('type'));
            const typeString = typeEntry === undefined ? undefined : typeEntry.value;
            if (!(typeString instanceof LineTrackedString)) {
                checker.warn(
                    checker.errors,
                    title.line,
                    'invalid_container',
                    `Script \`${title.text}\` is invalid - missing 'type' key`,
                    0,
                    checker.lines[title.line].length
                );
                continue;
            }
            // ScriptChecker.cs:1705
            const cleanType = toLowerFast(typeString.text.trim());
            // ScriptChecker.cs:1706-1710
            const scriptType = KNOWN_SCRIPT_TYPES.get(cleanType);
            if (scriptType === undefined) {
                checker.warn(
                    checker.errors,
                    title.line,
                    'wrong_type',
                    'Unknown script type (possibly a typo?)!',
                    0,
                    // C# QUIRK, ported verbatim (ScriptChecker.cs:1708): the warning is REPORTED
                    // on the title's line but SIZED from the `type:` line. Those are different
                    // lines in every real container, so the range's end has nothing to do with
                    // the line it lands on -- it is either short of the title or past its end,
                    // and `buildDiagnostics` clamps whatever comes out. Same defect family as
                    // the four ranges already corrected by user ruling; reported, not fixed,
                    // because the user ruled DEFER on the last one of these.
                    checker.lines[typeString.line].length
                );
                continue;
            }
            // ScriptChecker.cs:1711-1718
            const container = new ScriptContainerData();
            container.name = toLowerFast(title.text.trim());
            container.lineNumber = title.line;
            container.keys = map;
            container.type = cleanType;
            container.knownType = scriptType;
            // ScriptChecker.cs:1719-1724: a `definitions:` key seeds the definition set. It may
            // be written either as a list of entries or as one pipe-separated scalar.
            const defsEntry = map.get(LineTrackedString.textKey('definitions'));
            if (defsEntry !== undefined) {
                const defs = defsEntry.value;
                const rawNames: string[] = Array.isArray(defs)
                    ? defs.map(valueToString)
                    : valueToString(defs).split('|');
                // ScriptChecker.cs:1722. NOTE the order -- lowercase, THEN cut at '[', THEN
                // trim -- so `Target [Optional]` becomes `target`, not `target [optional]`.
                container.defNames.addAll(...rawNames.map(d => before(toLowerFast(d), '[').trim()));
            }
            // ScriptChecker.cs:1725-1726. `preprocContainer` lands in Task 5 and its call goes
            // here; until then a container is stored with its harvesting sets empty.
            workspace.scripts.set(container.name, container);
        } catch (ex) {
            // ScriptChecker.cs:1728-1732
            checker.warn(
                checker.errors,
                title.line,
                'exception_internal_container',
                `Script \`${title.text}\` is invalid - internal exception (check internal debug console)!`,
                0,
                checker.lines[title.line].length
            );
        }
    }
    resolveInjects(checker);
}

/**
 * Resolves each script's `inject` targets and merges the injected scripts' definitions and save
 * entries into the injecting script. Ported from ScriptChecker.cs:1734-1759.
 *
 * Split out of `convertContainers` purely for readability; behaviour is identical.
 *
 * `surroundingWorkspace` is always null in this phase -- cross-file workspace data is Phase 2D --
 * so `combined` is just this file's scripts. The single-file half still matters: a task that
 * injects another task in the same file inherits its definitions, and without that Phase 2C-4
 * would report them as undefined.
 */
function resolveInjects(checker: ScriptChecker): void {
    const workspace = checker.generatedWorkspace;
    // ScriptChecker.cs:1734-1738
    const combined = new Map(workspace.scripts);
    if (checker.surroundingWorkspace !== null) {
        for (const [name, data] of checker.surroundingWorkspace.scripts) {
            combined.set(name, data);
        }
    }
    // ScriptChecker.cs:1739-1759
    for (const script of workspace.scripts.values()) {
        if (!script.injectedPaths.any()) {
            continue;
        }
        // ScriptChecker.cs:1745-1757. `RealInjects.Add` returning false is the recursion guard:
        // a script that injects itself, directly or through a cycle, must terminate.
        const recurseAdd = (body: ScriptContainerData): void => {
            for (const injected of body.injectedPaths.getAllMatchesIn(combined.keys())) {
                if (script.realInjects.has(injected)) {
                    continue;
                }
                script.realInjects.add(injected);
                const injectedScript = combined.get(injected);
                if (injectedScript === undefined) {
                    continue;
                }
                script.defNames.mergeIn(injectedScript.defNames);
                script.saveEntryNames.mergeIn(injectedScript.saveEntryNames);
                recurseAdd(injectedScript);
            }
        };
        recurseAdd(script);
    }
}
