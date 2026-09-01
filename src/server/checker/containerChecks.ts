// Container-level checking, ported from SharpDenizenTools' ScriptChecker.cs:919-1145
// (`CheckAllContainers`, Part A).
//
// THIS IS THE MODULE THAT TURNS EVERYTHING ON. `checkAsScript` below is the only thing in the
// whole port that calls `checkSingleCommand`, which calls `checkSingleArgument`, which calls
// `checkSingleTag`. Phases 2C-4 and 2C-5 built all of that and left it unreachable; this is the
// driver that decides which lines of a container are code and hands them over.
//
// PART B (:1146-1319) is `checkTypeSpecifics` below, added in Phase 2C-7: the per-type special
// checks for `command`, `assignment` and `world`. It waited for its own phase because the world
// branch needed ScriptEventCouldMatcher, EventTools, AdvancedMatcher and the ExtraData validators
// ported first, along with the data value sets they read.

import { LineTrackedString } from './scriptWarnings';
import { KNOWN_SCRIPT_TYPES, ALWAYS_SCRIPT_KEYS, ALWAYS_DATA_KEYS, matchesSet } from './scriptTypes';
import { ScriptCheckContext, checkSingleDataLine, checkSingleTag, containsObjectNotation } from './tagChecks';
import { checkSingleCommand, checkCommandMissingColon } from './commandSpecifics';
import { separateSwitches } from './eventTools';
import type { EventSwitch } from './eventTools';
import type { ScriptEventCouldMatcher } from './scriptEventCouldMatcher';
import type { MetaDocs, MetaEvent } from '../metaDocs/metaTypes';
import type { ScriptChecker } from './scriptChecker';
import type { ScriptSection, ScriptList } from './containerGather';
import type { ScriptContainerData } from './containerConvert';
import type { ScriptWarning } from './scriptWarnings';
import { before, toLowerFast } from './frenetic';

/** Characters a script title may contain. Ported from ScriptChecker.cs:910. */
const SCRIPT_TITLE_CHARACTERS_ALLOWED = 'abcdefghijklmnopqrstuvwxyz0123456789_';

/** Whether every character of `text` is an allowed script-title character. */
function isOnlyTitleCharacters(text: string): boolean {
    for (const ch of text) {
        if (!SCRIPT_TITLE_CHARACTERS_ALLOWED.includes(ch)) {
            return false;
        }
    }
    return true;
}

/** Escapes a backtick for a message, as the C# does with `Replace('`', '\'')`. */
function safe(text: string): string {
    return text.replaceAll('`', "'");
}

/**
 * Checks every converted container. Ported from ScriptChecker.cs:919-1145.
 *
 * Nothing here needs meta EXCEPT the two `enumerated_script_name` probes, which are guarded
 * individually -- so a cold start still gets the whole structural pass, and the tag and command
 * layers below skip themselves.
 */
export function checkAllContainers(checker: ScriptChecker): void {
    // ScriptChecker.cs:921
    for (const script of checker.generatedWorkspace.scripts.values()) {
        // ScriptChecker.cs:923-926. Every Part A warning goes through this: the message is
        // prefixed with the script's name and the range is always the WHOLE line.
        const warnScript = (warns: ScriptWarning[], line: number, key: string, warning: string): void => {
            checker.warn(warns, line, key, `In script \`${safe(script.name)}\`: ${warning}`, 0, checker.lines[line]?.length ?? 0);
        };
        // ScriptChecker.cs:928, :1321-1325. One container that throws must not cost the rest of
        // the file its diagnostics.
        try {
            checkOneContainer(checker, script, warnScript);
        }
        catch (ex) {
            warnScript(checker.warnings, script.lineNumber, 'exception_internal', 'Internal exception (check internal debug console)!');
        }
    }
}

type WarnScript = (warns: ScriptWarning[], line: number, key: string, warning: string) => void;

/** One container's worth of Part A. Split out only so the try/catch above stays readable. */
function checkOneContainer(checker: ScriptChecker, script: ScriptContainerData, warnScript: WarnScript): void {
    // ScriptChecker.cs:930-937: the script title itself.
    if (script.name.includes(' ')) {
        warnScript(checker.minorWarnings, script.lineNumber, 'spaced_script_name',
            "Script titles should not contain spaces - consider the '_' underscore symbol instead.");
    }
    else if (!isOnlyTitleCharacters(script.name)) {
        warnScript(checker.minorWarnings, script.lineNumber, 'non_alphanumeric_script_name',
            "Script titles should be primarily alphanumeric, and shouldn't contain symbols other than '_' underscores.");
    }
    // ScriptChecker.cs:938-941
    if (script.name.length < 4) {
        warnScript(checker.warnings, script.lineNumber, 'short_script_name',
            "Overly short script title - script titles should be relatively long, unique text that definitely won't appear anywhere else.");
    }
    // ScriptChecker.cs:942-945. Guarded on the data being loaded at all, as the C# guards on
    // `Meta.Data is not null` -- ExtraData arrives over the network like the meta does.
    if (checker.extraData !== null && checker.extraData.all.has(script.name)) {
        warnScript(checker.warnings, script.lineNumber, 'enumerated_script_name',
            'Dangerous script title - exactly matches a core keyword in Minecraft. Use a more unique name.');
    }
    // ScriptChecker.cs:946-949
    if ((checker.meta !== null && checker.meta.commands.has(script.name)) || KNOWN_SCRIPT_TYPES.has(script.name)) {
        warnScript(checker.warnings, script.lineNumber, 'enumerated_script_name',
            'Dangerous script title - exactly matches a Denizen command or keyword. Use a more unique name.');
    }
    // ScriptChecker.cs:950-956
    const scriptSection = script.keys;
    const typeEntry = scriptSection.get(LineTrackedString.textKey('type'));
    const typeString = typeEntry === undefined ? undefined : typeEntry.value;
    if (!(typeString instanceof LineTrackedString)) {
        // DEAD IN THE C# TOO -- not a porting gap. `ConvertContainers` (:1700-1704) already emits
        // `invalid_container` and `continue`s for a container whose `type` is missing or is not a
        // string, so such a container never reaches GeneratedWorkspace.Scripts and this branch is
        // unreachable from `run()`. Verified by measurement: a type-less container yields
        // `invalid_container`, never `no_type_key`. Ported anyway so the shape stays the C#'s.
        // Any mutant of this branch therefore SURVIVES, and that survival is expected.
        warnScript(checker.errors, script.lineNumber, 'no_type_key', "Missing 'type' key!");
        return;
    }
    const knownType = script.knownType;
    if (knownType === null) {
        // DEAD FOR THE SAME REASON: `ConvertContainers` (:1706-1710) emits `wrong_type` and
        // `continue`s for an unrecognized type, so a converted container always has a known type.
        return;
    }
    // ScriptChecker.cs:957-963
    for (const key of knownType.requiredKeys) {
        if (!scriptSection.has(LineTrackedString.textKey(key))) {
            warnScript(checker.warnings, typeString.line, 'missing_key_' + typeString.text,
                `Missing required key \`${key}\` (check \`!lang ${typeString.text} script containers\` for format rules)!`);
        }
    }
    // ScriptChecker.cs:964-970
    for (const key of knownType.likelyBadKeys) {
        if (scriptSection.has(LineTrackedString.textKey(key))) {
            warnScript(checker.warnings, typeString.line, 'bad_key_' + typeString.text,
                `Unexpected key \`${safe(key)}\` (probably doesn't belong in this script type - check \`!lang ${typeString.text} script containers\` for format rules)!`);
        }
    }
    // ScriptChecker.cs:971-1145: the per-key dispatch.
    for (const entry of scriptSection.values()) {
        const keyLine = entry.key;
        const valueAtKey = entry.value;
        const keyName = keyLine.text;
        // ScriptChecker.cs:974-977. A container's own metadata, not content.
        if (keyName === 'debug' || keyName === 'speed' || keyName === 'type') {
            continue;
        }

        /** ScriptChecker.cs:976-1018. THE DRIVER: this is what makes command checking reachable. */
        const checkAsScript = (list: ScriptList, context?: ScriptCheckContext): void => {
            const ctx = context ?? new ScriptCheckContext();
            // ScriptChecker.cs:982-985. NOTE the `.Before('[')` -- the C# DOES cut definition
            // names at the bracket here, which is the same cut its `define` command branch
            // omits. That asymmetry is what deviation 9 corrected at the other site.
            const defsEntry = scriptSection.get(LineTrackedString.textKey('definitions'));
            if (defsEntry !== undefined && defsEntry.value instanceof LineTrackedString) {
                for (const name of toLowerFast(defsEntry.value.text).split('|')) {
                    ctx.definitions.add(before(name, '[').trim());
                }
            }
            // ScriptChecker.cs:986-995. The same unconditional seeding preprocContainer does --
            // the two run at different times for different consumers, so both need it.
            if (typeString.text === 'task') {
                for (const name of ['shot_entities', 'last_entity', 'location', 'hit_entities']) {
                    ctx.definitions.add(name);
                }
            }
            else if (typeString.text === 'economy') {
                ctx.definitions.add('amount');
            }
            for (const n of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']) {
                ctx.definitions.add(n);
            }
            // ScriptChecker.cs:996-1001. DORMANT: `Injects` is populated by LoadInjects, which is
            // not ported, so this never fires yet. Kept so the shape is the C#'s.
            if (checker.injects.includes(script.name) || checker.injects.includes('*')) {
                ctx.hasUnknowableDefinitions = true;
                ctx.hasUnknowableSaveEntries = true;
            }
            // ScriptChecker.cs:1002-1017
            for (const listEntry of list) {
                if (listEntry instanceof LineTrackedString) {
                    // NOT IN THE C# (user ruling 2026-09-01). This arm is precisely the "command
                    // line with NO trailing colon" case -- one WITH a colon is a ScriptSection and
                    // takes the branch below -- so it is the only place the missing-colon check
                    // can be made without re-parsing the text. See the note on the function.
                    checkCommandMissingColon(checker, listEntry.line, listEntry.startChar, listEntry.text);
                    checkSingleCommand(checker, listEntry.line, listEntry.startChar, listEntry.text, ctx, script);
                }
                else if (listEntry instanceof Map) {
                    const onlyEntry = listEntry.values().next().value;
                    if (onlyEntry === undefined) {
                        continue;
                    }
                    checkSingleCommand(checker, onlyEntry.key.line, onlyEntry.key.startChar, onlyEntry.key.text, ctx, script);
                    // EQUIVALENT MUTANT, proven: this guard can never fire, in the C# either.
                    // A `- definemap x:` line never becomes a sub-map, because the gatherer
                    // (ScriptChecker.cs:1531-1546) special-cases it -- it adds the line as a
                    // PLAIN STRING and then deliberately consumes every more-indented line after
                    // it with a bare `i++`, recording none of them. Measured on the user's real
                    // code: all four definemaps in clans/clans-menu.dsc lose all ten of their
                    // child lines at parse time, so nothing definemap-shaped ever reaches here as
                    // a Map. The guard is ported because the C# has it; a mutant that removes it
                    // survives every test, and that survival is expected rather than a gap.
                    if (!onlyEntry.key.text.startsWith('definemap')) {
                        checkAsScript(onlyEntry.value as ScriptList, ctx);
                    }
                }
            }
        };

        /** ScriptChecker.cs:1019-1032. */
        const checkBasicList = (list: ScriptList, canBeScript: boolean): void => {
            for (const listEntry of list) {
                if (listEntry instanceof LineTrackedString) {
                    checkSingleDataLine(checker, listEntry.line, listEntry.startChar, listEntry.text, null,
                        (l, s, t, c) => checkSingleTag(checker, l, s, t, c));
                }
                else if (canBeScript) {
                    warnScript(checker.warnings, keyLine.line, 'script_should_be_list',
                        `Key \`${safe(keyName)}\` appears to contain a script, when a data list was expected (check \`!lang ${typeString.text} script containers\` for format rules).`);
                }
            }
        };

        if (Array.isArray(valueAtKey)) {
            // ScriptChecker.cs:1033-1064.
            if (matchesSet(keyName, ALWAYS_DATA_KEYS) || typeString.text === 'data') {
                checkBasicList(valueAtKey, false);
            }
            else if (matchesSet(keyName, knownType.scriptKeys) || matchesSet(keyName, ALWAYS_SCRIPT_KEYS)) {
                checkAsScript(valueAtKey);
            }
            else if (matchesSet(keyName, knownType.listKeys)) {
                checkBasicList(valueAtKey, true);
            }
            else if (matchesSet(keyName, knownType.valueKeys)) {
                warnScript(checker.warnings, keyLine.line, 'list_should_be_value',
                    `Bad key \`${safe(keyName)}\` (was expected to be a direct Value, but was instead a list - check \`!lang ${typeString.text} script containers\` for format rules)!`);
            }
            else if (knownType.strict) {
                warnScript(checker.warnings, keyLine.line, 'unknown_key_' + typeString.text,
                    `Unexpected list key \`${safe(keyName)}\` (unrecognized - check \`!lang ${typeString.text} script containers\` for format rules)!`);
            }
            else if (knownType.canHaveRandomScripts) {
                checkAsScript(valueAtKey);
            }
            else {
                checkBasicList(valueAtKey, true);
            }
        }
        else if (valueAtKey instanceof LineTrackedString) {
            // ScriptChecker.cs:1065-1102.
            const context = new ScriptCheckContext();
            // :1068-1085: definitions a value key is allowed to reference, per type.
            if (typeString.text === 'economy' && (keyName === 'format' || keyName === 'has')) {
                context.definitions.add('amount');
            }
            else if (typeString.text === 'format' && keyName === 'format') {
                context.definitions.add('text');
                context.definitions.add('name');
            }
            else if (typeString.text === 'command' && keyName === 'permission message') {
                context.definitions.add('permission');
            }
            else if (typeString.text === 'data') {
                context.hasUnknowableSaveEntries = true;
                context.hasUnknowableDefinitions = true;
            }
            const onTag = (l: number, s: number, t: string, c: ScriptCheckContext | null): void => checkSingleTag(checker, l, s, t, c);
            if (matchesSet(keyName, knownType.valueKeys) || keyName === 'description') {
                // C# QUIRK: `lineAtKey.StartChar + 2`, where the else branch at :1100 uses
                // `keyLine.StartChar`. Two different anchors for the same kind of call, in
                // adjacent branches. Ported verbatim.
                checkSingleDataLine(checker, keyLine.line, valueAtKey.startChar + 2, valueAtKey.text, context, onTag);
            }
            else if (matchesSet(keyName, knownType.listKeys) || matchesSet(keyName, knownType.scriptKeys)) {
                warnScript(checker.warnings, keyLine.line, 'bad_key_' + typeString.text,
                    `Bad key \`${safe(keyName)}\` (was expected to be a list or script, but was instead a direct Value - check \`!lang ${typeString.text} script containers\` for format rules)!`);
            }
            else if (knownType.strict && keyName !== 'data') {
                warnScript(checker.warnings, keyLine.line, 'unknown_key_' + typeString.text,
                    `Unexpected value key \`${safe(keyName)}\` (unrecognized - check \`!lang ${typeString.text} script containers\` for format rules)!`);
            }
            else {
                checkSingleDataLine(checker, keyLine.line, keyLine.startChar, valueAtKey.text, context, onTag);
            }
        }
        else if (valueAtKey instanceof Map) {
            // ScriptChecker.cs:1103-1144.
            const keyText = keyName + '.*';
            const checkSubMaps = (subMap: ScriptSection, canBeScript: boolean): void => {
                for (const subEntry of subMap.values()) {
                    const subValue = subEntry.value;
                    if (subValue instanceof LineTrackedString) {
                        checkSingleDataLine(checker, subValue.line, subValue.startChar, subValue.text, null,
                            (l, s, t, c) => checkSingleTag(checker, l, s, t, c));
                    }
                    else if (Array.isArray(subValue)) {
                        if (canBeScript && (knownType.scriptKeys.includes(keyText)
                            || (!knownType.listKeys.includes(keyText) && knownType.canHaveRandomScripts))) {
                            checkAsScript(subValue);
                        }
                        else {
                            checkBasicList(subValue, canBeScript);
                        }
                    }
                    else if (subValue instanceof Map) {
                        checkSubMaps(subValue, canBeScript);
                    }
                }
            };
            // ScriptChecker.cs:1131-1143. NOTE this gate has NO `(!Strict && !definemap)`
            // fallback disjunct, unlike preprocContainer's at :1948-1949 -- so a strict type
            // whose key matches nothing falls through to `unknown_key_` instead of being walked.
            if (knownType.valueKeys.includes(keyText) || knownType.listKeys.includes(keyText) || knownType.scriptKeys.includes(keyText)
                || ALWAYS_SCRIPT_KEYS.includes(keyName)
                || knownType.valueKeys.includes('*') || knownType.listKeys.includes('*') || knownType.scriptKeys.includes('*')) {
                checkSubMaps(valueAtKey, typeString.text !== 'data' && !matchesSet(keyName, ALWAYS_DATA_KEYS));
            }
            else if (knownType.strict && keyName !== 'data') {
                warnScript(checker.warnings, keyLine.line, 'unknown_key_' + typeString.text,
                    `Unexpected submapping key \`${safe(keyName)}\` (unrecognized - check \`!lang ${typeString.text} script containers\` for format rules)!`);
            }
            else {
                checkSubMaps(valueAtKey, typeString.text !== 'data' && !keyName.startsWith('definemap') && !matchesSet(keyName, ALWAYS_DATA_KEYS));
            }
        }
    }
    // ScriptChecker.cs:1146-1319. Runs ONCE per container, after the key loop -- note the C#'s
    // brace at :1145 closes the foreach, and :1146 sits at its level, not inside it.
    checkTypeSpecifics(checker, script, typeString, scriptSection, warnScript);
}

/**
 * Whether every switch on an event line is one that event accepts.
 * Ported from ScriptChecker.cs:1329-1332.
 *
 * Vacuously true for a line with no switches, as `All` is on an empty list -- which is what makes
 * the ordinary case (no switches at all) prefer the best matcher rather than the first one found.
 */
function allSwitchesValid(docs: MetaDocs, evt: MetaEvent, switches: EventSwitch[]): boolean {
    return switches.every(pair => evt.isValidSwitch(docs, pair.key));
}

/**
 * The per-type special checks: `command`, `assignment` and `world`.
 * Ported from ScriptChecker.cs:1146-1319 (Part B of CheckAllContainers).
 *
 * NULL META IS A REAL STATE HERE, not a defensive habit. The C# reads an ambient `Meta` that is
 * always set by the time Run() gets this far; this port loads the meta asynchronously and checks
 * from the first keystroke, so on a cold start `checker.meta` is genuinely null. Both branches
 * that consult it degrade to "check nothing" rather than guess -- guessing means reporting every
 * event and action in the file as missing for the first few seconds after the editor opens.
 *
 * The world branch has a SECOND such state, and it is subtler: the meta may be loaded while the
 * Minecraft enum data is not, in which case `couldMatchers` is empty and every event line would be
 * reported missing. `linkMatchersWhenReady` in server.ts is what prevents that -- it does not link
 * at all until both have landed -- so an empty `couldMatchers` here means "no events documented",
 * which is only true of an empty meta.
 */
function checkTypeSpecifics(checker: ScriptChecker, script: ScriptContainerData, typeString: LineTrackedString, scriptSection: ScriptSection, warnScript: WarnScript): void {
    // ScriptChecker.cs:1146-1165
    if (typeString.text === 'command') {
        const nameString = scriptSection.get(LineTrackedString.textKey('name'))?.value;
        if (nameString instanceof LineTrackedString) {
            const usageString = scriptSection.get(LineTrackedString.textKey('usage'))?.value;
            if (usageString instanceof LineTrackedString) {
                // :1152. TWO accepted shapes, and the second is not redundant: `/name ` with the
                // trailing space covers a usage that documents arguments, and the bare equality
                // covers a command that takes none. Testing only the prefix would reject `/heal`.
                if (!usageString.text.startsWith(`/${nameString.text} `) && usageString.text !== `/${nameString.text}`) {
                    warnScript(checker.minorWarnings, usageString.line, 'command_script_usage',
                        "Command script usage key doesn't match the name key (the name is the actual thing you need to type in-game, the usage is for '/help' - refer to `!lang command script containers`)!");
                }
            }
            // :1157-1163
            const aliasList = scriptSection.get(LineTrackedString.textKey('aliases'))?.value;
            if (Array.isArray(aliasList) && aliasList.length > 0) {
                const badAlias = aliasList.find(o => o instanceof LineTrackedString && o.text === nameString.text);
                if (badAlias instanceof LineTrackedString) {
                    warnScript(checker.warnings, badAlias.line, 'command_script_aliasname',
                        "A command script alias should not be the same as the command script's name.");
                }
            }
        }
    }
    // ScriptChecker.cs:1166-1198
    else if (typeString.text === 'assignment') {
        const actionsMap = scriptSection.get(LineTrackedString.textKey('actions'))?.value;
        if (actionsMap instanceof Map) {
            for (const entry of actionsMap.values()) {
                const actionValue = entry.key;
                // :1172. Assumes the key starts with `on `, because the gatherer only files action
                // keys that do. A key that does not would lose its first three characters here.
                let actionName = actionValue.text.substring('on '.length);
                if (actionName.includes('@')) {
                    // :1175-1176. NOTE the test is on the STRIPPED name but the positions come from
                    // the FULL text -- deliberate in the C#, and the two agree because stripping
                    // only removes a prefix that cannot contain '@'.
                    //
                    // `Warn`, not `warnScript`: this one reports a precise range and is NOT
                    // prefixed with the script name. Same for `event_object_notation` below.
                    const start = actionValue.startChar + actionValue.text.indexOf('@');
                    const end = actionValue.startChar + actionValue.text.lastIndexOf('@');
                    checker.warn(checker.warnings, actionValue.line, 'action_object_notation',
                        'This action line appears to contain raw object notation. Object notation is not allowed in action lines.', start, end);
                }
                // :1179. Puts the prefix back, so the lookup is against the documented full name.
                //
                // Except that it is not: NO documented action name begins with `on ` -- 0 of the
                // 50 in the live meta -- so re-adding the prefix guarantees the exact-name lookup
                // just below always MISSES, and every action is in practice resolved by the regex
                // fallback, whose `^(on )?` prefix is optional. Stripping and re-adding is
                // therefore a round-trip to nowhere on real data. Ported as-is because it is only
                // unobservable given that naming convention, not by construction.
                actionName = 'on ' + actionName;
                if (checker.meta === null) {
                    continue;
                }
                if (!checker.meta.actions.has(actionName)) {
                    // :1182-1190. The exact-name lookup misses for any action documented with a
                    // fill-in, e.g. `on <entity> enter proximity`, so the regexes are the fallback
                    // that lets `on zombie enter proximity` resolve.
                    let exists = false;
                    for (const action of checker.meta.actions.values()) {
                        if (action.regexMatcher !== null && action.regexMatcher.test(actionName)) {
                            exists = true;
                            break;
                        }
                    }
                    if (!exists) {
                        warnScript(checker.warnings, actionValue.line, 'action_missing',
                            "Assignment script action listed doesn't exist. (Check `!act ...` to find proper action names)!");
                    }
                }
            }
        }
    }
    // ScriptChecker.cs:1199-1319
    else if (typeString.text === 'world') {
        const eventsMap = scriptSection.get(LineTrackedString.textKey('events'))?.value;
        if (eventsMap instanceof Map) {
            for (const entry of eventsMap.values()) {
                checkOneEventLine(checker, entry.key, warnScript);
            }
        }
    }
}

/**
 * One `events:` key of a world script. Ported from ScriptChecker.cs:1203-1317.
 *
 * Split out of `checkTypeSpecifics` only so the four-deep nesting of the C# does not have to be
 * reproduced literally; the body follows it statement for statement.
 */
function checkOneEventLine(checker: ScriptChecker, eventValue: LineTrackedString, warnScript: WarnScript): void {
    // ScriptChecker.cs:1205. `on ` or `after ` is stripped; anything else keeps its whole text.
    let eventName = eventValue.text.substring(
        eventValue.text.startsWith('on ') ? 'on '.length : (eventValue.text.startsWith('after ') ? 'after '.length : 0));
    if (eventName.includes('@')) {
        const atRange = containsObjectNotation(eventName);
        if (atRange !== null) {
            // :1211-1212. THE OFFSET IS SHORT BY THE STRIPPED PREFIX, a C# defect ported as-is:
            // the range is measured against the STRIPPED name but added to `eventValue.startChar`,
            // which points at the start of the FULL text. So on an `on ...` line the underline sits
            // three characters left of the object notation it is reporting. Only the highlight is
            // wrong -- the line, the key and the message are all correct -- and moving it would be
            // a deliberate deviation, so it is documented rather than quietly corrected.
            const start = eventValue.startChar + atRange.start;
            const end = eventValue.startChar + atRange.end;
            checker.warn(checker.warnings, eventValue.line, 'event_object_notation',
                'This event line appears to contain raw object notation. Object notation is not allowed in event lines.', start, end);
        }
    }
    // Cold start: no meta means no events to match against. See checkTypeSpecifics.
    if (checker.meta === null) {
        return;
    }
    const meta = checker.meta;
    // :1216-1217
    const separated = separateSwitches(meta, eventName);
    eventName = separated.cleaned;
    const switches = separated.switches;
    const parts = eventName.split(' ');
    let matchedEvent: MetaEvent | null = null;
    let matched: ScriptEventCouldMatcher | null = null;
    let matchedSwitches = false;
    // :1221-1249. THE SEARCH, and its shape is not the obvious one. It prefers, in order: a
    // matcher whose switches are all valid, then a better matcher whose switches are not. The
    // `matchedSwitches` flag is what stops a merely-better matcher displacing one that actually
    // accepted the switches -- so `on player breaks block flagged:x` reports the switch problem
    // against the event that has a player, not against whichever event scored highest.
    for (const evt of meta.events.values()) {
        for (const matcher of evt.couldMatchers) {
            if (matcher.tryMatch(parts, false, false) > 0) {
                if (matched === null || matcher.isBetterMatchThan(parts, false, matched)) {
                    if (allSwitchesValid(meta, evt, switches)) {
                        matched = matcher;
                        matchedEvent = evt;
                        matchedSwitches = true;
                    }
                    else if (!matchedSwitches) {
                        matched = matcher;
                        matchedEvent = evt;
                    }
                }
                else if (!matchedSwitches && allSwitchesValid(meta, evt, switches)) {
                    // :1241-1246. A WORSE matcher can still win, if it is the first one whose
                    // switches all check out. Reads like a bug and is not: a switch-valid match is
                    // the more useful report even when another matcher scored higher.
                    matched = matcher;
                    matchedEvent = evt;
                    matchedSwitches = true;
                }
            }
        }
    }
    if (matchedEvent === null) {
        // :1252-1259. Nothing matched in full, so try again allowing a PARTIAL match, purely to
        // give the message something to point at. The first partial hit wins -- no scoring.
        for (const evt of meta.events.values()) {
            if (evt.couldMatchers.some(c => c.tryMatch(parts, true, false) > 0)) {
                matchedEvent = evt;
                break;
            }
        }
        if (matchedEvent === null) {
            warnScript(checker.warnings, eventValue.line, 'event_missing',
                "Script Event listed doesn't exist. (Check `!event ...` to find proper event lines)!");
        }
        else {
            // :1266. Same warning KEY, different message -- so `##ignorewarning event_missing`
            // silences both, which is what a user who wants them gone expects.
            warnScript(checker.warnings, eventValue.line, 'event_missing',
                `Script Event listed doesn't exist. Got partial match for '${matchedEvent.name}' - might be incomplete? Check documentation.`);
        }
        return;
    }
    // :1271-1315. The event resolved, so now judge its switches. The five special names are
    // handled HERE rather than deferred to isValidSwitch because each has its own message
    // explaining WHY it does not apply -- isValidSwitch only answers whether it does.
    for (const switchPair of switches) {
        if (switchPair.key === 'cancelled' || switchPair.key === 'ignorecancelled') {
            // The fold here is a SECOND application and cannot change anything -- an equivalent
            // mutant, measured. Section keys are read from `cleanedLines`, which the constructor
            // already put through toLowerFast, so `CANCELLED:MaYbE:` reaches this loop spelled
            // `cancelled:maybe`; and toLowerFast is idempotent (0 differences over 200,000 random
            // ASCII strings). The C# is in exactly the same position at :1275. Kept because it is
            // what the C# says, and because a future caller feeding this unfolded text would need
            // it -- but no test can kill it, and that survival is expected.
            if (toLowerFast(switchPair.value) !== 'true' && toLowerFast(switchPair.value) !== 'false') {
                warnScript(checker.warnings, eventValue.line, 'bad_switch_value',
                    `'${switchPair.key}' switch invalid: must be 'true' or 'false'.`);
            }
        }
        else if (switchPair.key === 'priority' || switchPair.key === 'chance') {
            // :1282. `double.TryParse`. See `parsesAsDouble` for why this is not `Number(...)`.
            if (!parsesAsDouble(switchPair.value)) {
                warnScript(checker.warnings, eventValue.line, 'bad_switch_value',
                    `'${switchPair.key}' switch invalid: must be a decimal number.`);
            }
        }
        else if (switchPair.key === 'in' || switchPair.key === 'location_flagged') {
            if (!matchedEvent.hasLocation) {
                warnScript(checker.warnings, eventValue.line, 'unknown_switch',
                    `'${switchPair.key}' switch is only supported on events that have a known location.`);
            }
        }
        else if (switchPair.key === 'flagged' || switchPair.key === 'permission') {
            if (matchedEvent.player.trim().length === 0) {
                warnScript(checker.warnings, eventValue.line, 'unknown_switch',
                    `'${switchPair.key}' switch is only supported on events that have a linked player.`);
            }
        }
        else if (switchPair.key === 'assigned') {
            if (matchedEvent.npc.trim().length === 0) {
                warnScript(checker.warnings, eventValue.line, 'unknown_switch',
                    `'${switchPair.key}' switch is only supported on events that have a linked NPC.`);
            }
        }
        else {
            if (!matchedEvent.isValidSwitch(meta, switchPair.key)) {
                warnScript(checker.warnings, eventValue.line, 'unknown_switch', 'Switch given is unrecognized.');
            }
        }
    }
}

/**
 * C#'s `double.TryParse(value, out _)`, for the `priority` and `chance` switches
 * (ScriptChecker.cs:1282).
 *
 * NOT `!isNaN(Number(value))`, which would accept things .NET rejects and so silence a real
 * warning: `Number('')` is 0, `Number('0x10')` is 16, `Number('Infinity')` is Infinity, and
 * `Number(' 5 ')` is 5. .NET's default NumberStyles.Float|AllowThousands accepts a leading sign,
 * digits, one decimal point and an exponent -- and permits surrounding whitespace, which is why
 * the trim is present rather than an oversight.
 *
 * There is no separate empty-string guard: the pattern requires at least one digit, so `''`
 * fails it anyway. An explicit guard was written first and then measured redundant over all
 * 10,000 strings of length 0-4 over `05.-+eEx ` -- 0 differences -- and removed rather than left
 * as dead belt-and-braces, the same call made for the source-list guard in metaDocsManager.
 */
function parsesAsDouble(value: string): boolean {
    return /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(value.trim());
}
