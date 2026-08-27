"use strict";
// Container-level checking, ported from SharpDenizenTools' ScriptChecker.cs:919-1145
// (`CheckAllContainers`, Part A).
//
// THIS IS THE MODULE THAT TURNS EVERYTHING ON. `checkAsScript` below is the only thing in the
// whole port that calls `checkSingleCommand`, which calls `checkSingleArgument`, which calls
// `checkSingleTag`. Phases 2C-4 and 2C-5 built all of that and left it unreachable; this is the
// driver that decides which lines of a container are code and hands them over.
//
// PART B IS PHASE 2C-7. The per-type special checks for `command`, `assignment` and `world`
// (:1146-1319) are not here: the world branch needs ScriptEventCouldMatcher, EventTools and
// AdvancedMatcher, none of which are ported, so it is a phase of its own rather than a tail on
// this one.
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAllContainers = void 0;
const scriptWarnings_1 = require("./scriptWarnings");
const scriptTypes_1 = require("./scriptTypes");
const tagChecks_1 = require("./tagChecks");
const commandSpecifics_1 = require("./commandSpecifics");
/** Characters a script title may contain. Ported from ScriptChecker.cs:910. */
const SCRIPT_TITLE_CHARACTERS_ALLOWED = 'abcdefghijklmnopqrstuvwxyz0123456789_';
/** Whether every character of `text` is an allowed script-title character. */
function isOnlyTitleCharacters(text) {
    for (const ch of text) {
        if (!SCRIPT_TITLE_CHARACTERS_ALLOWED.includes(ch)) {
            return false;
        }
    }
    return true;
}
/** ASCII-only lowercasing, matching FreneticUtilities' `ToLowerFast()`. */
function toLowerFast(text) {
    return text.replace(/[A-Z]/g, (c) => c.toLowerCase());
}
/** FreneticUtilities' `string.Before(char)`. */
function before(input, match) {
    const index = input.indexOf(match);
    return index < 0 ? input : input.slice(0, index);
}
/** Escapes a backtick for a message, as the C# does with `Replace('`', '\'')`. */
function safe(text) {
    return text.replaceAll('`', "'");
}
/**
 * Checks every converted container. Ported from ScriptChecker.cs:919-1145.
 *
 * Nothing here needs meta EXCEPT the two `enumerated_script_name` probes, which are guarded
 * individually -- so a cold start still gets the whole structural pass, and the tag and command
 * layers below skip themselves.
 */
function checkAllContainers(checker) {
    // ScriptChecker.cs:921
    for (const script of checker.generatedWorkspace.scripts.values()) {
        // ScriptChecker.cs:923-926. Every Part A warning goes through this: the message is
        // prefixed with the script's name and the range is always the WHOLE line.
        const warnScript = (warns, line, key, warning) => {
            var _a, _b;
            checker.warn(warns, line, key, `In script \`${safe(script.name)}\`: ${warning}`, 0, (_b = (_a = checker.lines[line]) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0);
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
exports.checkAllContainers = checkAllContainers;
/** One container's worth of Part A. Split out only so the try/catch above stays readable. */
function checkOneContainer(checker, script, warnScript) {
    // ScriptChecker.cs:930-937: the script title itself.
    if (script.name.includes(' ')) {
        warnScript(checker.minorWarnings, script.lineNumber, 'spaced_script_name', "Script titles should not contain spaces - consider the '_' underscore symbol instead.");
    }
    else if (!isOnlyTitleCharacters(script.name)) {
        warnScript(checker.minorWarnings, script.lineNumber, 'non_alphanumeric_script_name', "Script titles should be primarily alphanumeric, and shouldn't contain symbols other than '_' underscores.");
    }
    // ScriptChecker.cs:938-941
    if (script.name.length < 4) {
        warnScript(checker.warnings, script.lineNumber, 'short_script_name', "Overly short script title - script titles should be relatively long, unique text that definitely won't appear anywhere else.");
    }
    // ScriptChecker.cs:942-945. Guarded on the data being loaded at all, as the C# guards on
    // `Meta.Data is not null` -- ExtraData arrives over the network like the meta does.
    if (checker.extraData !== null && checker.extraData.all.has(script.name)) {
        warnScript(checker.warnings, script.lineNumber, 'enumerated_script_name', 'Dangerous script title - exactly matches a core keyword in Minecraft. Use a more unique name.');
    }
    // ScriptChecker.cs:946-949
    if ((checker.meta !== null && checker.meta.commands.has(script.name)) || scriptTypes_1.KNOWN_SCRIPT_TYPES.has(script.name)) {
        warnScript(checker.warnings, script.lineNumber, 'enumerated_script_name', 'Dangerous script title - exactly matches a Denizen command or keyword. Use a more unique name.');
    }
    // ScriptChecker.cs:950-956
    const scriptSection = script.keys;
    const typeEntry = scriptSection.get(scriptWarnings_1.LineTrackedString.textKey('type'));
    const typeString = typeEntry === undefined ? undefined : typeEntry.value;
    if (!(typeString instanceof scriptWarnings_1.LineTrackedString)) {
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
        if (!scriptSection.has(scriptWarnings_1.LineTrackedString.textKey(key))) {
            warnScript(checker.warnings, typeString.line, 'missing_key_' + typeString.text, `Missing required key \`${key}\` (check \`!lang ${typeString.text} script containers\` for format rules)!`);
        }
    }
    // ScriptChecker.cs:964-970
    for (const key of knownType.likelyBadKeys) {
        if (scriptSection.has(scriptWarnings_1.LineTrackedString.textKey(key))) {
            warnScript(checker.warnings, typeString.line, 'bad_key_' + typeString.text, `Unexpected key \`${safe(key)}\` (probably doesn't belong in this script type - check \`!lang ${typeString.text} script containers\` for format rules)!`);
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
        const checkAsScript = (list, context) => {
            const ctx = context !== null && context !== void 0 ? context : new tagChecks_1.ScriptCheckContext();
            // ScriptChecker.cs:982-985. NOTE the `.Before('[')` -- the C# DOES cut definition
            // names at the bracket here, which is the same cut its `define` command branch
            // omits. That asymmetry is what deviation 9 corrected at the other site.
            const defsEntry = scriptSection.get(scriptWarnings_1.LineTrackedString.textKey('definitions'));
            if (defsEntry !== undefined && defsEntry.value instanceof scriptWarnings_1.LineTrackedString) {
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
                if (listEntry instanceof scriptWarnings_1.LineTrackedString) {
                    (0, commandSpecifics_1.checkSingleCommand)(checker, listEntry.line, listEntry.startChar, listEntry.text, ctx, script);
                }
                else if (listEntry instanceof Map) {
                    const onlyEntry = listEntry.values().next().value;
                    if (onlyEntry === undefined) {
                        continue;
                    }
                    (0, commandSpecifics_1.checkSingleCommand)(checker, onlyEntry.key.line, onlyEntry.key.startChar, onlyEntry.key.text, ctx, script);
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
                        checkAsScript(onlyEntry.value, ctx);
                    }
                }
            }
        };
        /** ScriptChecker.cs:1019-1032. */
        const checkBasicList = (list, canBeScript) => {
            for (const listEntry of list) {
                if (listEntry instanceof scriptWarnings_1.LineTrackedString) {
                    (0, tagChecks_1.checkSingleDataLine)(checker, listEntry.line, listEntry.startChar, listEntry.text, null, (l, s, t, c) => (0, tagChecks_1.checkSingleTag)(checker, l, s, t, c));
                }
                else if (canBeScript) {
                    warnScript(checker.warnings, keyLine.line, 'script_should_be_list', `Key \`${safe(keyName)}\` appears to contain a script, when a data list was expected (check \`!lang ${typeString.text} script containers\` for format rules).`);
                }
            }
        };
        if (Array.isArray(valueAtKey)) {
            // ScriptChecker.cs:1033-1064.
            if ((0, scriptTypes_1.matchesSet)(keyName, scriptTypes_1.ALWAYS_DATA_KEYS) || typeString.text === 'data') {
                checkBasicList(valueAtKey, false);
            }
            else if ((0, scriptTypes_1.matchesSet)(keyName, knownType.scriptKeys) || (0, scriptTypes_1.matchesSet)(keyName, scriptTypes_1.ALWAYS_SCRIPT_KEYS)) {
                checkAsScript(valueAtKey);
            }
            else if ((0, scriptTypes_1.matchesSet)(keyName, knownType.listKeys)) {
                checkBasicList(valueAtKey, true);
            }
            else if ((0, scriptTypes_1.matchesSet)(keyName, knownType.valueKeys)) {
                warnScript(checker.warnings, keyLine.line, 'list_should_be_value', `Bad key \`${safe(keyName)}\` (was expected to be a direct Value, but was instead a list - check \`!lang ${typeString.text} script containers\` for format rules)!`);
            }
            else if (knownType.strict) {
                warnScript(checker.warnings, keyLine.line, 'unknown_key_' + typeString.text, `Unexpected list key \`${safe(keyName)}\` (unrecognized - check \`!lang ${typeString.text} script containers\` for format rules)!`);
            }
            else if (knownType.canHaveRandomScripts) {
                checkAsScript(valueAtKey);
            }
            else {
                checkBasicList(valueAtKey, true);
            }
        }
        else if (valueAtKey instanceof scriptWarnings_1.LineTrackedString) {
            // ScriptChecker.cs:1065-1102.
            const context = new tagChecks_1.ScriptCheckContext();
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
            const onTag = (l, s, t, c) => (0, tagChecks_1.checkSingleTag)(checker, l, s, t, c);
            if ((0, scriptTypes_1.matchesSet)(keyName, knownType.valueKeys) || keyName === 'description') {
                // C# QUIRK: `lineAtKey.StartChar + 2`, where the else branch at :1100 uses
                // `keyLine.StartChar`. Two different anchors for the same kind of call, in
                // adjacent branches. Ported verbatim.
                (0, tagChecks_1.checkSingleDataLine)(checker, keyLine.line, valueAtKey.startChar + 2, valueAtKey.text, context, onTag);
            }
            else if ((0, scriptTypes_1.matchesSet)(keyName, knownType.listKeys) || (0, scriptTypes_1.matchesSet)(keyName, knownType.scriptKeys)) {
                warnScript(checker.warnings, keyLine.line, 'bad_key_' + typeString.text, `Bad key \`${safe(keyName)}\` (was expected to be a list or script, but was instead a direct Value - check \`!lang ${typeString.text} script containers\` for format rules)!`);
            }
            else if (knownType.strict && keyName !== 'data') {
                warnScript(checker.warnings, keyLine.line, 'unknown_key_' + typeString.text, `Unexpected value key \`${safe(keyName)}\` (unrecognized - check \`!lang ${typeString.text} script containers\` for format rules)!`);
            }
            else {
                (0, tagChecks_1.checkSingleDataLine)(checker, keyLine.line, keyLine.startChar, valueAtKey.text, context, onTag);
            }
        }
        else if (valueAtKey instanceof Map) {
            // ScriptChecker.cs:1103-1144.
            const keyText = keyName + '.*';
            const checkSubMaps = (subMap, canBeScript) => {
                for (const subEntry of subMap.values()) {
                    const subValue = subEntry.value;
                    if (subValue instanceof scriptWarnings_1.LineTrackedString) {
                        (0, tagChecks_1.checkSingleDataLine)(checker, subValue.line, subValue.startChar, subValue.text, null, (l, s, t, c) => (0, tagChecks_1.checkSingleTag)(checker, l, s, t, c));
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
                || scriptTypes_1.ALWAYS_SCRIPT_KEYS.includes(keyName)
                || knownType.valueKeys.includes('*') || knownType.listKeys.includes('*') || knownType.scriptKeys.includes('*')) {
                checkSubMaps(valueAtKey, typeString.text !== 'data' && !(0, scriptTypes_1.matchesSet)(keyName, scriptTypes_1.ALWAYS_DATA_KEYS));
            }
            else if (knownType.strict && keyName !== 'data') {
                warnScript(checker.warnings, keyLine.line, 'unknown_key_' + typeString.text, `Unexpected submapping key \`${safe(keyName)}\` (unrecognized - check \`!lang ${typeString.text} script containers\` for format rules)!`);
            }
            else {
                checkSubMaps(valueAtKey, typeString.text !== 'data' && !keyName.startsWith('definemap') && !(0, scriptTypes_1.matchesSet)(keyName, scriptTypes_1.ALWAYS_DATA_KEYS));
            }
        }
    }
}
//# sourceMappingURL=containerChecks.js.map