"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.contextValidatedIsValidScriptName = exports.contextValidatedGetScriptFor = exports.mergeData = exports.preprocContainer = exports.convertContainers = exports.ScriptingWorkspaceData = exports.ScriptContainerData = void 0;
const scriptWarnings_1 = require("./scriptWarnings");
const mixedKnowledgeSet_1 = require("./mixedKnowledgeSet");
const scriptTypes_1 = require("./scriptTypes");
const buildArgs_1 = require("./buildArgs");
const frenetic_1 = require("./frenetic");
/**
 * The data of a script container. Ported from ScriptContainerData.cs:11-48.
 *
 * The four `MixedKnowledgeSet` fields are what Phase 2C-4 checks tags against, and they are the
 * reason this phase exists.
 */
class ScriptContainerData {
    constructor() {
        /** The name of the script, trimmed and lowercased. (ScriptContainerData.cs:14) */
        this.name = '';
        /** The line the container's TITLE key is on. (:17) */
        this.lineNumber = 0;
        /**
         * The name of the file the script is from. (:20)
         *
         * Declared because the C# declares it, and left empty because `ConvertContainers` never
         * assigns it either -- it is filled by the workspace-scanning path, which is Phase 2D.
         */
        this.fileName = '';
        /** What type the script is ("task", "world", ...), cleaned. (:23) */
        this.type = '';
        /** The metadata for that type. (:26) */
        this.knownType = null;
        /** Definitions established within command sections of this script. (:29) */
        this.defNames = new mixedKnowledgeSet_1.MixedKnowledgeSet();
        /** `save:` argument names established within command sections. (:32) */
        this.saveEntryNames = new mixedKnowledgeSet_1.MixedKnowledgeSet();
        /** Sub-scripts injected within command sections. (:35) */
        this.injectedPaths = new mixedKnowledgeSet_1.MixedKnowledgeSet();
        /** Script names known to actually be injected by this script. (:38) */
        this.realInjects = new Set();
        /** Server flags set by command sections of this script. (:41) */
        this.serverFlags = new mixedKnowledgeSet_1.MixedKnowledgeSet();
        /** Object flags set by command sections of this script. (:44) */
        this.objectFlags = new mixedKnowledgeSet_1.MixedKnowledgeSet();
        /** The container's own keys, as gathered. (:47) */
        this.keys = new Map();
    }
}
exports.ScriptContainerData = ScriptContainerData;
/** A full workspace of scripts. Ported from ScriptingWorkspaceData.cs:10-31. */
class ScriptingWorkspaceData {
    constructor() {
        /** All server flag names set within the workspace. (:13) */
        this.allKnownServerFlagNames = new mixedKnowledgeSet_1.MixedKnowledgeSet();
        /** All object flag names set within the workspace. (:16) */
        this.allKnownObjectFlagNames = new mixedKnowledgeSet_1.MixedKnowledgeSet();
        /** All containers within the workspace, keyed by lowercased name. (:19) */
        this.scripts = new Map();
    }
    /** Merges another workspace's data into this one. (ScriptingWorkspaceData.cs:22-30) */
    mergeIn(other) {
        this.allKnownServerFlagNames.mergeIn(other.allKnownServerFlagNames);
        this.allKnownObjectFlagNames.mergeIn(other.allKnownObjectFlagNames);
        for (const [name, data] of other.scripts) {
            this.scripts.set(name, data);
        }
    }
}
exports.ScriptingWorkspaceData = ScriptingWorkspaceData;
/** FreneticUtilities' `string.Before(char)`: everything before the first occurrence, else all of it. */
function before(input, match) {
    const index = input.indexOf(match);
    return index < 0 ? input : input.slice(0, index);
}
/**
 * FreneticUtilities' `string.After(char)`: everything after the first occurrence.
 *
 * Returns `''` when the character is absent, matching the "after" half of `beforeAndAfter` in
 * containerGather.ts. Every call site below guards on `startsWith('as:')` or `startsWith('key:')`
 * first, so the absent case is unreachable in practice.
 */
function after(input, match) {
    const index = input.indexOf(match);
    return index < 0 ? '' : input.slice(index + match.length);
}
/** ScriptChecker.cs:1958-1961's `StartsWithAny`. */
function startsWithAny(input, ...checks) {
    return checks.some(s => input.startsWith(s));
}
/** C#'s `string.BeforeAndAfter(char, out string after)`, as used at ScriptChecker.cs:1789. */
function splitFirst(input, match) {
    const index = input.indexOf(match);
    if (index < 0) {
        return [input, ''];
    }
    return [input.slice(0, index), input.slice(index + match.length)];
}
/**
 * ScriptChecker.cs:1851-1856's legacy argument-alias list for the `inventory` command, kept in
 * the C#'s order and with its own comment: "inventory command has a long legacy-style list of
 * arg aliases".
 */
const INVENTORY_ARG_ALIASES = [
    'origin', 'o', 'source', 'items', 'item', 'i', 'from', 'f',
    'destination', 'dest', 'd', 'target', 'to', 't',
    'slot', 's',
    'duration', 'expire', 'expires', 'expiration'
];
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
function valueToString(value) {
    if (value instanceof scriptWarnings_1.LineTrackedString) {
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
function convertContainers(checker, containers) {
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
                checker.warn(checker.errors, title.line, 'invalid_container', `Script \`${title.text}\` is invalid - missing content?`, 0, checker.lines[title.line].length);
                continue;
            }
            const map = data;
            // ScriptChecker.cs:1700-1704. NOTE the second half of the condition: a `type:` key
            // holding a SECTION or a LIST rather than a scalar also lands here, and gets the
            // "missing 'type' key" message even though the key is present.
            const typeEntry = map.get(scriptWarnings_1.LineTrackedString.textKey('type'));
            const typeString = typeEntry === undefined ? undefined : typeEntry.value;
            if (!(typeString instanceof scriptWarnings_1.LineTrackedString)) {
                checker.warn(checker.errors, title.line, 'invalid_container', `Script \`${title.text}\` is invalid - missing 'type' key`, 0, checker.lines[title.line].length);
                continue;
            }
            // ScriptChecker.cs:1705
            const cleanType = (0, frenetic_1.toLowerFast)(typeString.text.trim());
            // ScriptChecker.cs:1706-1710
            const scriptType = scriptTypes_1.KNOWN_SCRIPT_TYPES.get(cleanType);
            if (scriptType === undefined) {
                checker.warn(checker.errors, title.line, 'wrong_type', 'Unknown script type (possibly a typo?)!', 0, 
                // C# QUIRK, ported verbatim (ScriptChecker.cs:1708): the warning is REPORTED
                // on the title's line but SIZED from the `type:` line. Those are different
                // lines in every real container, so the range's end has nothing to do with
                // the line it lands on -- it is either short of the title or past its end,
                // and `buildDiagnostics` clamps whatever comes out. Same defect family as
                // the four ranges already corrected by user ruling; reported, not fixed,
                // because the user ruled DEFER on the last one of these.
                checker.lines[typeString.line].length);
                continue;
            }
            // ScriptChecker.cs:1711-1718
            const container = new ScriptContainerData();
            container.name = (0, frenetic_1.toLowerFast)(title.text.trim());
            container.lineNumber = title.line;
            container.keys = map;
            container.type = cleanType;
            container.knownType = scriptType;
            // ScriptChecker.cs:1719-1724: a `definitions:` key seeds the definition set. It may
            // be written either as a list of entries or as one pipe-separated scalar.
            const defsEntry = map.get(scriptWarnings_1.LineTrackedString.textKey('definitions'));
            if (defsEntry !== undefined) {
                const defs = defsEntry.value;
                const rawNames = Array.isArray(defs)
                    ? defs.map(valueToString)
                    : valueToString(defs).split('|');
                // ScriptChecker.cs:1722. NOTE the order -- lowercase, THEN cut at '[', THEN
                // trim -- so `Target [Optional]` becomes `target`, not `target [optional]`.
                container.defNames.addAll(...rawNames.map(d => before((0, frenetic_1.toLowerFast)(d), '[').trim()));
            }
            // ScriptChecker.cs:1725-1726
            preprocContainer(container);
            workspace.scripts.set(container.name, container);
        }
        catch (ex) {
            // ScriptChecker.cs:1728-1732
            checker.warn(checker.errors, title.line, 'exception_internal_container', `Script \`${title.text}\` is invalid - internal exception (check internal debug console)!`, 0, checker.lines[title.line].length);
        }
    }
    resolveInjects(checker);
}
exports.convertContainers = convertContainers;
/**
 * Harvests everything later phases need to know from a container's script keys: definition
 * names, `save:` entry names, flag names and injected paths.
 * Ported from ScriptChecker.cs:1763-1955.
 *
 * THIS IS THE FUNCTION PHASE 2C-4 DEPENDS ON. A branch here that silently fails to collect a
 * name does not look like a bug -- nothing warns, nothing changes -- until 2C-4 reports that
 * name as undefined on a script that is perfectly correct.
 */
function preprocContainer(script) {
    const knownType = script.knownType;
    if (knownType === null) {
        return;
    }
    // ScriptChecker.cs:1765-1768: a data container holds no script at all.
    if (script.type === 'data') {
        return;
    }
    // ScriptChecker.cs:1769-1779: an item container holds no script either, but its `flags:`
    // section names object flags, so those are harvested before the early return.
    //
    // THE RETURN IS LOAD-BEARING, contrary to how it looks. Item is strict, declares no
    // ScriptKeys and has canHaveRandomScripts false, so every TYPE-DRIVEN arm of the cascade
    // below would refuse anyway -- but arm 2 also tests `ALWAYS_SCRIPT_KEYS`, which is
    // type-independent. Without this return, an item with a stray `script:` key (precisely the
    // mistake item's own `likelyBadKeys` exists to flag) would have its contents walked as
    // commands. Pinned by test.
    if (script.type === 'item') {
        const flagsEntry = script.keys.get(scriptWarnings_1.LineTrackedString.textKey('flags'));
        if (flagsEntry !== undefined && flagsEntry.value instanceof Map) {
            for (const flagEntry of flagsEntry.value.values()) {
                script.objectFlags.addAll(before((0, frenetic_1.toLowerFast)(flagEntry.key.text.trim()), '.'));
            }
        }
        return;
    }
    // ScriptChecker.cs:1780-1786
    for (const entry of script.keys.values()) {
        const key = entry.key;
        const valueAtKey = entry.value;
        const keyName = (0, frenetic_1.toLowerFast)(key.text).trim();
        if (keyName === 'data' || keyName === 'description') {
            continue;
        }
        /** ScriptChecker.cs:1787-1878. */
        const procSingleCommand = (cmd) => {
            // ScriptChecker.cs:1789
            const [cmdNameRaw, argTextRaw] = splitFirst(cmd.trim(), ' ');
            const cmdName = (0, frenetic_1.toLowerFast)(cmdNameRaw);
            // ScriptChecker.cs:1790. The NULL checker is deliberate: this tokenises every
            // command of every script in the file, and `bad_quotes`/`missing_quotes` from here
            // would fire with no useful position.
            const fullArgs = (0, buildArgs_1.buildArgs)(key.line, 0, argTextRaw, null).map(a => (0, frenetic_1.toLowerFast)(a.text));
            // ScriptChecker.cs:1791
            const cleanArgs = fullArgs.filter(a => !startsWithAny(a, 'save:', 'player:', 'npc:'));
            switch (cmdName) {
                // ScriptChecker.cs:1794-1800
                case 'define':
                case 'definemap':
                    if (cleanArgs.length > 0) {
                        // -----------------------------------------------------------------
                        // DELIBERATE DEVIATION FROM ScriptChecker.cs -- NOT a porting mistake.
                        // -----------------------------------------------------------------
                        // The C# is `cleanArgs[0].Before(':').Before('.')` -- no `.Before('[')`,
                        // even though the FLAG branch four cases down (:1837) has exactly that
                        // cut. So Denizen's indexed-define syntax records a name nobody can
                        // write:
                        //     - define background[46]:<item[red_dye]>   ->  `background[46]`
                        //     - define background[<[i]>]:<[x]>          ->  `background[`
                        // The real definition is `background`, and `<[background]>` would then
                        // be reported as undefined by Phase 2C-6 on a correct script.
                        //
                        // USER RULING: FIX, on the same grounds as the four range corrections
                        // before it -- a warning on working code is a defect the user can see
                        // and the C# cannot defend. The cut is one word, and it is the one the
                        // sibling branch in this same method already performs.
                        //
                        // Measured on the user's corpus before the change: 161 defines recorded
                        // their name correctly and 3 did not, all of them `background` in
                        // sfx.dsc. Nothing there breaks either way, because that script also
                        // defines `background` plainly -- the fix closes the class of failure
                        // rather than a live one.
                        script.defNames.add(before(before(before(cleanArgs[0], ':'), '.'), '['));
                    }
                    break;
                // ScriptChecker.cs:1801-1809
                case 'inject': {
                    const arg = cleanArgs.find(a => a !== 'instantly' && !a.startsWith('path:'));
                    if (arg !== undefined) {
                        script.injectedPaths.add(before(arg, '.'));
                    }
                    break;
                }
                // ScriptChecker.cs:1810-1833. `foreach` does `goto case "while"` at :1818, so it
                // adds its own two names AND then the loop-variable name that repeat/while add.
                // A copy-pasted body would drift; the shared closure below cannot.
                case 'foreach':
                case 'repeat':
                case 'while': {
                    if (cmdName === 'foreach') {
                        script.defNames.add('loop_index');
                        const keyArg = cleanArgs.find(a => a.startsWith('key:'));
                        if (keyArg !== undefined) {
                            script.defNames.add(before(after(keyArg, ':'), '.'));
                        }
                    }
                    const asArg = cleanArgs.find(a => a.startsWith('as:'));
                    if (asArg !== undefined) {
                        script.defNames.add(before(after(asArg, ':'), '.'));
                    }
                    else {
                        script.defNames.add('value');
                    }
                    break;
                }
                // ScriptChecker.cs:1834-1847. `cleanArgs[0]` is the target; anything that is not
                // literally `server` counts as an object flag.
                case 'flag':
                    if (cleanArgs.length >= 2) {
                        const flag = before(before(before(cleanArgs[1], ':'), '.'), '[');
                        if (cleanArgs[0] === 'server') {
                            script.serverFlags.add(flag);
                        }
                        else {
                            script.objectFlags.add(flag);
                        }
                    }
                    break;
                // ScriptChecker.cs:1848-1862
                case 'inventory':
                    if (cleanArgs.includes('flag')) {
                        const flag = cleanArgs.find(a => !startsWithAny(a, ...INVENTORY_ARG_ALIASES));
                        if (flag !== undefined) {
                            script.objectFlags.add(before(before(flag, ':'), '.'));
                        }
                    }
                    break;
            }
            // ScriptChecker.cs:1864-1872: data like 'stone[flag=x:y]'. NOTE it searches `cmd`,
            // the WHOLE original command text, not the parsed arguments -- and case-sensitively,
            // which is why the casing `procAsScript` passes in below matters.
            const specialFlag = cmd.indexOf('flag=');
            if (specialFlag !== -1) {
                let flagData = cmd.slice(specialFlag + 'flag='.length);
                for (const cut of [' ', ';', ']', ':', '.']) {
                    flagData = before(flagData, cut);
                }
                if (flagData !== '') {
                    script.objectFlags.add(flagData);
                }
            }
            // ScriptChecker.cs:1873-1877. Taken from `fullArgs`, NOT `cleanArgs` -- `save:` is
            // one of the three prefixes :1791 strips, so looking in cleanArgs would find nothing.
            const save = fullArgs.find(a => a.startsWith('save:'));
            if (save !== undefined) {
                script.saveEntryNames.add(after(save, ':'));
            }
        };
        /** ScriptChecker.cs:1879-1908. */
        const procAsScript = (list) => {
            // ScriptChecker.cs:1881-1889. These look like padding and are not: without them,
            // 2C-4 would report false "undefined definition" warnings on ordinary scripts.
            if (script.type === 'task') {
                // "Workaround the weird way shoot command does things" -- the C#'s own comment.
                script.defNames.addAll('shot_entities', 'last_entity', 'location', 'hit_entities');
            }
            else if (script.type === 'economy') {
                script.defNames.add('amount');
            }
            // ScriptChecker.cs:1890-1891: the default `run` command definitions.
            script.defNames.addAll('1', '2', '3', '4', '5', '6', '7', '8', '9', '10');
            // ScriptChecker.cs:1892-1907
            for (const listEntry of list) {
                if (listEntry instanceof scriptWarnings_1.LineTrackedString) {
                    // ScriptChecker.cs:1896: LOWERCASED here...
                    procSingleCommand((0, frenetic_1.toLowerFast)(listEntry.text));
                }
                else if (listEntry instanceof Map) {
                    // ScriptChecker.cs:1900-1905. `subMap.First()` -- a command sub-section has
                    // exactly one key, the command itself.
                    const onlyEntry = listEntry.values().next().value;
                    if (onlyEntry === undefined) {
                        continue;
                    }
                    // ...but NOT lowercased here. C# QUIRK, ported verbatim: it changes what the
                    // case-sensitive `cmd.IndexOf("flag=")` above can find on a `- foo:` line.
                    procSingleCommand(onlyEntry.key.text);
                    if (!onlyEntry.key.text.startsWith('definemap')) {
                        procAsScript(onlyEntry.value);
                    }
                }
            }
        };
        // ScriptChecker.cs:1909-1927: which keys hold script, for a LIST value. The cascade's
        // ORDER is the whole logic -- data keys win over script keys, which win over declared
        // list/value keys and strictness, and only then does `canHaveRandomScripts` decide.
        if (Array.isArray(valueAtKey)) {
            if ((0, scriptTypes_1.matchesSet)(keyName, scriptTypes_1.ALWAYS_DATA_KEYS)) {
                // ScriptChecker.cs:1911-1914: ignore.
                //
                // C# QUIRK: THIS ARM IS DEAD, and is ported anyway. `ALWAYS_DATA_KEYS` holds no
                // `*` and no `X.*` entry, so `matchesSet` here degenerates to plain membership
                // of {'data', 'description'} -- exactly the two names the `continue` at :1783
                // has already skipped, several lines above. Nothing can reach this branch.
                // Verified by enumerating `matchesSet(k, ALWAYS_DATA_KEYS)` against
                // `k === 'data' || k === 'description'` over all 97 key names the type table
                // mentions: no disagreement. Kept so the cascade stays diffable against the C#.
            }
            else if ((0, scriptTypes_1.matchesSet)(keyName, knownType.scriptKeys) || (0, scriptTypes_1.matchesSet)(keyName, scriptTypes_1.ALWAYS_SCRIPT_KEYS)) {
                procAsScript(valueAtKey);
            }
            else if ((0, scriptTypes_1.matchesSet)(keyName, knownType.listKeys) || (0, scriptTypes_1.matchesSet)(keyName, knownType.valueKeys) || knownType.strict) {
                // ScriptChecker.cs:1919-1922: ignore.
            }
            else if (knownType.canHaveRandomScripts) {
                procAsScript(valueAtKey);
            }
        }
        else if (valueAtKey instanceof Map) {
            // ScriptChecker.cs:1928-1953. NOTE that these tests use raw `.includes(keyText)`
            // rather than `matchesSet` -- a DIFFERENT question, since matchesSet would also
            // accept a bare key or a `*`. Following each call site exactly, as the C# does.
            const keyText = keyName + '.*';
            const procSubMaps = (subMap) => {
                for (const subEntry of subMap.values()) {
                    const subValue = subEntry.value;
                    if (Array.isArray(subValue)) {
                        // ScriptChecker.cs:1937
                        if (knownType.scriptKeys.includes(keyText) || (!knownType.listKeys.includes(keyText) && knownType.canHaveRandomScripts)) {
                            procAsScript(subValue);
                        }
                    }
                    else if (subValue instanceof Map) {
                        procSubMaps(subValue);
                    }
                }
            };
            // ScriptChecker.cs:1948-1952
            if (knownType.valueKeys.includes(keyText) || knownType.listKeys.includes(keyText) || knownType.scriptKeys.includes(keyText)
                || scriptTypes_1.ALWAYS_SCRIPT_KEYS.includes(keyName)
                || knownType.valueKeys.includes('*') || knownType.listKeys.includes('*') || knownType.scriptKeys.includes('*')
                || (!knownType.strict && !keyName.startsWith('definemap'))) {
                procSubMaps(valueAtKey);
            }
        }
    }
}
exports.preprocContainer = preprocContainer;
/**
 * Merges every converted container's flag names into the workspace's own sets.
 * Ported from ScriptChecker.cs:2011-2018 (`MergeData`), called from `Run()` at :2034.
 *
 * NOT IN THE ORIGINAL PLAN for this phase -- it was listed under Phase 2D alongside the other
 * `ScriptingWorkspaceData` work. Pulled forward on reading it: it is six lines, it depends on
 * nothing this phase does not already build, and leaving it out would ship a
 * `generatedWorkspace` whose two flag sets are permanently empty, which reads as broken rather
 * than as deferred.
 */
function mergeData(checker) {
    const workspace = checker.generatedWorkspace;
    for (const container of workspace.scripts.values()) {
        workspace.allKnownServerFlagNames.mergeIn(container.serverFlags);
        workspace.allKnownObjectFlagNames.mergeIn(container.objectFlags);
    }
}
exports.mergeData = mergeData;
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
function resolveInjects(checker) {
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
        const recurseAdd = (body) => {
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
/**
 * The first/best container matching `scriptName`, if it is knowable and known.
 * Ported from ScriptChecker.cs:1964-1998.
 *
 * DORMANT UNTIL PHASE 2D. The very first line returns null whenever `surroundingWorkspace` is
 * null, which it always is until cross-file scanning exists. Ported now, with its real shape,
 * so the call sites in `commandSpecifics` read like the C# instead of like a stub someone has to
 * come back and replace.
 */
function contextValidatedGetScriptFor(checker, scriptName, requireType) {
    var _a, _b, _c;
    if (checker.surroundingWorkspace === null || scriptName === null) {
        return null;
    }
    // ScriptChecker.cs:1970-1974
    scriptName = before((0, frenetic_1.toLowerFast)(scriptName), '.');
    if (scriptName.startsWith('script:')) {
        scriptName = after(scriptName, ':');
    }
    let res = null;
    if (scriptName.includes('<')) {
        // ScriptChecker.cs:1976-1984: a tagged name can only be matched by prefix.
        const partial = before(scriptName, '<');
        const matches = (from) => {
            for (const [key, value] of from) {
                if (key.startsWith(partial) && (requireType === null || value.type === requireType)) {
                    return value;
                }
            }
            return null;
        };
        res = (_a = matches(checker.surroundingWorkspace.scripts)) !== null && _a !== void 0 ? _a : matches(checker.generatedWorkspace.scripts);
    }
    else {
        // ScriptChecker.cs:1985-1996
        res = (_c = (_b = checker.surroundingWorkspace.scripts.get(scriptName)) !== null && _b !== void 0 ? _b : checker.generatedWorkspace.scripts.get(scriptName)) !== null && _c !== void 0 ? _c : null;
        if (res !== null && requireType !== null && res.type !== requireType) {
            return null;
        }
    }
    return res;
}
exports.contextValidatedGetScriptFor = contextValidatedGetScriptFor;
/**
 * Whether a script name is null, unknowable, or valid.
 * Ported from ScriptChecker.cs:2001-2008.
 *
 * Returns TRUE -- i.e. "no complaint" -- whenever there is no surrounding workspace, which is
 * why `invalid_script_inject` and `invalid_script_run` cannot fire before Phase 2D.
 */
function contextValidatedIsValidScriptName(checker, scriptName) {
    if (checker.surroundingWorkspace === null || scriptName === null) {
        return true;
    }
    return contextValidatedGetScriptFor(checker, scriptName, null) !== null;
}
exports.contextValidatedIsValidScriptName = contextValidatedIsValidScriptName;
//# sourceMappingURL=containerConvert.js.map