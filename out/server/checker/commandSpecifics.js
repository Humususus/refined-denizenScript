"use strict";
// Per-command checks, ported from SharpDenizenTools' ScriptCheckerCommandSpecifics.cs (311
// lines): the registry of command-name -> checker, and the twelve checkers themselves.
//
// Same import rule as the rest of src/server/checker/: no `vscode-languageserver`, no `/node`,
// no `vscode`, no I/O. Meta is reached through the checker, never through an ambient singleton.
//
// NOTHING CALLS THIS YET. `CheckSingleCommand` (Task 4) dispatches through the registry, and
// `CheckAllContainers` (Phase 2C-6) is what drives that.
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkSingleCommand = exports.argHasPrefix = exports.BAD_EXECUTE_COMMANDS = exports.register = exports.COMMAND_CHECKERS = exports.CommandCheckDetails = void 0;
const containerConvert_1 = require("./containerConvert");
const buildArgs_1 = require("./buildArgs");
const tagChecks_1 = require("./tagChecks");
/**
 * Everything a per-command checker gets to look at.
 * Ported from ScriptCheckerCommandSpecifics.cs:17-67.
 *
 * `context` is non-null here, unlike in `checkSingleTag`. The C# dereferences it unguarded at
 * ScriptChecker.cs:872 and throughout these checkers, because the only caller builds one.
 */
class CommandCheckDetails {
    /**
     * Warns over an explicit range, or -- when `start`/`end` are omitted -- over the whole
     * command line. Two C# overloads (:47-56) collapsed into one signature; the defaulted form
     * is by far the commoner and is what most of these checkers use.
     */
    warn(warningSet, key, message, start, end) {
        const from = start !== null && start !== void 0 ? start : this.startChar;
        const to = end !== null && end !== void 0 ? end : this.startChar + this.commandText.length;
        this.checker.warn(warningSet, this.line, key, message, from, to);
    }
    /**
     * Records a definition this command establishes. (:59-66)
     *
     * NOTE the asymmetry, ported as-is: the name is truncated at the first `.` before being
     * stored, but the `<` test runs on the UNTRUNCATED input. So `<[x]>.sub` sets the unknowable
     * flag even though what gets stored is the empty string before the dot.
     */
    trackDefinition(def) {
        const dot = def.indexOf('.');
        this.context.definitions.add(dot < 0 ? def : def.substring(0, dot));
        if (def.includes('<')) {
            this.context.hasUnknowableDefinitions = true;
        }
    }
}
exports.CommandCheckDetails = CommandCheckDetails;
/** Command name -> checker. Ported from ScriptCheckerCommandSpecifics.cs:70. */
exports.COMMAND_CHECKERS = new Map();
/**
 * Registers a checker for each of `cmdNames`, combining with anything already registered.
 * Ported from ScriptCheckerCommandSpecifics.cs:73-84.
 *
 * TWO THINGS HERE ARE NOT OBVIOUS AND BOTH ARE PORTED FAITHFULLY:
 *
 * 1. THE NEW CHECKER RUNS FIRST. C#'s `method += action` appends the EXISTING delegate to the
 *    new one, so on a second registration the newly-registered check runs before the older one.
 *    That decides the order warnings appear in for the two commands registered twice --
 *    `while` (:114 then :233) and `foreach` (:233 then :253).
 *
 * 2. `method` IS REASSIGNED INSIDE THE LOOP, so once one name in `cmdNames` has combined with an
 *    existing checker, every LATER name in the same array inherits that combination too. A
 *    latent C# bug: it only stays harmless because the one array that hits it,
 *    `["foreach", "repeat", "while"]`, lists the already-registered `while` LAST. Reordering
 *    that array in the C# would change behaviour, and so would reordering it here.
 *
 * (ScriptCheckerCommandSpecifics.cs:80 assigns the OLD delegate and :82 overwrites it on the very
 * next line, so :80 is dead. Not reproduced -- a dead store has no observable effect and copying
 * it would only invite someone to "fix" it later.)
 */
function register(cmdNames, method) {
    let combined = method;
    for (const cmd of cmdNames) {
        const existing = exports.COMMAND_CHECKERS.get(cmd);
        if (existing !== undefined) {
            const previous = combined;
            combined = (details) => { previous(details); existing(details); };
        }
        exports.COMMAND_CHECKERS.set(cmd, combined);
    }
}
exports.register = register;
/**
 * Bukkit/vanilla commands that should never be run through Denizen's `execute`.
 * Ported from ScriptCheckerCommandSpecifics.cs:87-99 -- 76 names, extracted from the C# source
 * mechanically rather than retyped, and verified the same way.
 */
exports.BAD_EXECUTE_COMMANDS = new Set([
    // From the vanilla command list
    'advancement', 'ban', 'banlist', 'bossbar', 'clear', 'clone', 'data', 'datapack', 'deop', 'detect', 'difficulty', 'effect', 'enchant', 'execute',
    'exp', 'experience', 'fill', 'forceload', 'gamemode', 'gamerule', 'help', 'kick', 'kill', 'list', 'locate', 'loot', 'me', 'msg', 'op', 'pardon',
    'particle', 'playsound', 'recipe', 'reload', 'replaceitem', 'say', 'scoreboard', 'seed', 'setblock', 'setmaxplayers', 'setworldspawn',
    'spawnpoint', 'spectate', 'spreadplayers', 'stopsound', 'summon', 'tag', 'team', 'teammsg', 'teleport', 'tell', 'tellraw', 'testfor',
    'testforblock', 'testforblocks', 'time', 'title', 'toggledownfall', 'tp', 'w', 'weather', 'whitelist', 'worldborder', 'worldbuilder', 'xp',
    // Based on seen misuses
    'give', 'take', 'gmc', 'gms', 'gm', 'warp',
    // Obviously never run Denizen or Citizens commands
    'ex', 'exs', 'denizen', 'npc', 'trait'
]);
/** Symbols that may not appear in an argument prefix, including the `:` that ends one. (:102) */
const PREFIX_FORBIDDEN_SYMBOLS = '<> :.!';
/**
 * Whether an argument has a valid, non-tagged prefix.
 * Ported from ScriptCheckerCommandSpecifics.cs:105-109.
 *
 * Finds the FIRST forbidden symbol and requires it to be the `:`. So `save:x` has a prefix,
 * while `a.b:c` does not (the `.` comes first), and neither does `<tag>:x` (the `<` does).
 */
function argHasPrefix(arg) {
    for (let i = 0; i < arg.length; i++) {
        if (PREFIX_FORBIDDEN_SYMBOLS.includes(arg[i])) {
            return arg[i] === ':';
        }
    }
    return false;
}
exports.argHasPrefix = argHasPrefix;
/** ASCII-only lowercasing, matching FreneticUtilities' `ToLowerFast()`. */
function toLowerFast(text) {
    return text.replace(/[A-Z]/g, (c) => c.toLowerCase());
}
/** FreneticUtilities' `string.Before(char)`. */
function before(input, match) {
    const index = input.indexOf(match);
    return index < 0 ? input : input.slice(0, index);
}
/** FreneticUtilities' `string.After(char)`: everything after the first occurrence, else ''. */
function after(input, match) {
    const index = input.indexOf(match);
    return index < 0 ? '' : input.slice(index + match.length);
}
/** ScriptChecker.cs:1958-1961's `StartsWithAny`. */
function startsWithAny(input, ...checks) {
    return checks.some(s => input.startsWith(s));
}
/** C#'s `string.IsNullOrWhiteSpace`. */
function isNullOrWhiteSpace(text) {
    return text === null || text === undefined || text.trim().length === 0;
}
// --------------------------------------------------------------------------------------------
// The twelve checkers, in the C#'s registration order (ScriptCheckerCommandSpecifics.cs:114-308).
// THE ORDER OF THESE CALLS IS BEHAVIOUR, not style: `register` combines new-before-old, and the
// array ['foreach', 'repeat', 'while'] must keep `while` LAST. See `register`'s doc comment.
// --------------------------------------------------------------------------------------------
// ScriptCheckerCommandSpecifics.cs:114-128
register(['if', 'waituntil', 'while'], (details) => {
    let borkLen = ' == true'.length;
    let borkIndex = details.commandText.indexOf(' == true');
    if (borkIndex === -1) {
        borkLen = ' == false'.length;
        borkIndex = details.commandText.indexOf(' == false');
    }
    if (borkIndex !== -1) {
        details.warn(details.checker.errors, 'truly_true', "'== true' style checks are nonsense. Refer to <https://guide.denizenscript.com/guides/troubleshooting/common-mistakes.html#if-true-is-true-equal-to-truly-true-is-the-truth> for more info.", details.startChar + borkIndex, details.startChar + borkIndex + borkLen);
    }
});
// ScriptCheckerCommandSpecifics.cs:129-186 -- the largest of the twelve.
register(['adjust'], (details) => {
    var _a, _b;
    const meta = details.checker.meta;
    if (meta === null) {
        return;
    }
    // :131 -- `def:` and `if:` are the command's own arguments, never the mechanism.
    const argReserved = (s) => s.text.startsWith('def:') || s.text.startsWith('if:');
    // :132-133. First choice: a genuinely prefixed argument. Failing that, a bare word that is
    // not a tag and not a known raw-adjustable object -- whatever is left must be the mechanism.
    const mechanism = (_a = details.arguments.find(s => argHasPrefix(s.text) && !argReserved(s))) !== null && _a !== void 0 ? _a : details.arguments.find(s => !argReserved(s) && !s.text.includes('<') && !meta.rawAdjustables.has(s.text));
    if (mechanism === undefined) {
        // :136-139. A single tag as the second argument is an adjust-by-MapTag, which is legal.
        if (details.arguments.length < 2 || !details.arguments[1].text.startsWith('<') || !details.arguments[1].text.endsWith('>')) {
            details.warn(details.checker.errors, 'bad_adjust_no_mech', 'Malformed adjust command. No mechanism input given.');
        }
        return;
    }
    // :143-144. The C# reads the AMBIENT `MetaDocs.CurrentMeta` here while using
    // `details.Checker.Meta` twelve lines earlier; there is no such singleton in this repo, so
    // both go through the checker.
    const mechanismName = toLowerFast(before(mechanism.text, ':'));
    const possible = Array.from(meta.mechanisms.values()).filter(m => m.mechName === mechanismName);
    let mech = null;
    if (possible.length === 1) {
        mech = possible[0];
    }
    else if (possible.length > 1) {
        // :150-167. Several object types share this mechanism name, so try to pick by which
        // object is being adjusted -- and fall back to the FIRST either way, which means the
        // deprecation message below can name a mechanism from the wrong type. C# QUIRK.
        const objArg = details.arguments.find(s => !argHasPrefix(s.text));
        if (objArg === undefined) {
            mech = possible[0];
        }
        else {
            mech = (_b = possible.find(m => m.mechObject === objArg.text)) !== null && _b !== void 0 ? _b : possible[0];
        }
    }
    if (mech === null) {
        details.warn(details.checker.errors, 'bad_adjust_unknown_mech', 'Malformed adjust command. Mechanism name given is unrecognized.', mechanism.startChar, mechanism.startChar + mechanismName.length);
    }
    else if (!isNullOrWhiteSpace(mech.deprecated)) {
        details.warn(details.checker.errors, 'bad_adjust_deprecated_mech', `Mechanism '${mech.name}' is deprecated: ${mech.deprecated}`, mechanism.startChar, mechanism.startChar + mechanismName.length);
    }
    // :176-184
    const defArg = details.arguments.find(s => s.text.startsWith('def:'));
    if (defArg !== undefined) {
        const defName = toLowerFast(after(defArg.text, ':'));
        if (!details.context.definitions.has(defName) && !details.context.hasUnknowableDefinitions) {
            details.warn(details.checker.errors, 'bad_adjust_unknown_def', 'Malformed adjust command. Definition name given is unrecognized.', defArg.startChar, defArg.startChar + defArg.text.length);
        }
    }
});
// ScriptCheckerCommandSpecifics.cs:187-198
register(['execute'], (details) => {
    if (details.argCount >= 2) {
        // :191 -- `as_server`/`as_player`/... shift the real command to the second argument.
        const bukkitCommandArg = toLowerFast(details.arguments[0].text).startsWith('as_')
            ? details.arguments[1].text
            : details.arguments[0].text;
        const bukkitCommandName = toLowerFast(before(bukkitCommandArg, ' '));
        if (exports.BAD_EXECUTE_COMMANDS.has(bukkitCommandName) || bukkitCommandName.startsWith('minecraft:') || bukkitCommandName.startsWith('bukkit:')) {
            details.warn(details.checker.warnings, 'bad_execute', "Inappropriate usage of the 'execute' command. Execute is for external plugin interop, and should never be used for vanilla commands. Use the relevant Denizen script command or mechanism instead.");
        }
    }
});
// ScriptCheckerCommandSpecifics.cs:199-208
register(['inject'], (details) => {
    var _a;
    // An injected script brings definitions and save entries this file cannot see, so BOTH
    // become unknowable. Without this, 2C-4's def_of_nothing would fire across the whole script.
    details.context.hasUnknowableDefinitions = true;
    details.context.hasUnknowableSaveEntries = true;
    const scrName = (_a = details.arguments.map(a => toLowerFast(a.text)).find(a => a !== 'instantly' && !a.startsWith('path:'))) !== null && _a !== void 0 ? _a : null;
    if (!(0, containerConvert_1.contextValidatedIsValidScriptName)(details.checker, scrName)) {
        details.warn(details.checker.errors, 'invalid_script_inject', `Script name \`${scrName}\` is invalid. Cannot be injected.`);
    }
});
/** ScriptCheckerCommandSpecifics.cs:209 -- arguments of `run` that are not the script name. */
const RUN_OTHER_ARGS = new Set(['instant', 'instantly', 'local', 'locally']);
// ScriptCheckerCommandSpecifics.cs:210-217
register(['run', 'runlater'], (details) => {
    var _a;
    const scrName = (_a = details.arguments.map(a => toLowerFast(a.text))
        .find(a => !RUN_OTHER_ARGS.has(a) && !startsWithAny(a, 'path:', 'id:', 'speed:', 'delay:', 'def:', 'def.', 'defmap:'))) !== null && _a !== void 0 ? _a : null;
    if (!(0, containerConvert_1.contextValidatedIsValidScriptName)(details.checker, scrName)) {
        details.warn(details.checker.errors, 'invalid_script_run', `Script name \`${scrName}\` is invalid. Cannot be ran.`);
    }
});
// ScriptCheckerCommandSpecifics.cs:218-224
register(['queue'], (details) => {
    if (details.argCount === 1 && (toLowerFast(details.arguments[0].text) === 'stop' || toLowerFast(details.arguments[0].text) === 'clear')) {
        details.warn(details.checker.minorWarnings, 'queue_clear', "Old style 'queue clear'. Use the modern 'stop' command instead. Refer to <https://guide.denizenscript.com/guides/troubleshooting/updates-since-videos.html#stop-is-the-new-queue-clear> for more info.");
    }
});
// ScriptCheckerCommandSpecifics.cs:225-232
register(['define', 'definemap'], (details) => {
    // C# QUIRK: gated on argCount but indexes `arguments`, and those differ -- argCount skips
    // the four prefixed forms while `arguments` does not. `- define save:x` therefore tracks a
    // definition called `save` rather than nothing.
    if (details.argCount >= 1) {
        const defName = before(toLowerFast(before(details.arguments[0].text, ':')), '.');
        details.trackDefinition(defName);
    }
});
// ScriptCheckerCommandSpecifics.cs:233-252. `while` is LAST on purpose -- see `register`.
register(['foreach', 'repeat', 'while'], (details) => {
    var _a, _b;
    if (details.commandName !== 'while') {
        const asArgumentRaw = (_b = (_a = details.arguments.find(s => toLowerFast(s.text).startsWith('as:'))) === null || _a === void 0 ? void 0 : _a.text) !== null && _b !== void 0 ? _b : null;
        const asArgument = asArgumentRaw === null ? 'value' : asArgumentRaw.substring('as:'.length);
        details.trackDefinition(toLowerFast(asArgument));
    }
    if (details.commandName !== 'repeat') {
        details.trackDefinition('loop_index');
    }
});
// ScriptCheckerCommandSpecifics.cs:253-265
register(['foreach'], (details) => {
    var _a, _b;
    const keyArgumentRaw = (_b = (_a = details.arguments.find(s => toLowerFast(s.text).startsWith('key:'))) === null || _a === void 0 ? void 0 : _a.text) !== null && _b !== void 0 ? _b : null;
    const keyArgument = keyArgumentRaw === null ? 'key' : keyArgumentRaw.substring('key:'.length);
    details.trackDefinition(toLowerFast(keyArgument));
});
// ScriptCheckerCommandSpecifics.cs:266-287
register(['give'], (details) => {
    if (details.arguments.some(a => a.text === '<player>' || a.text === '<player.name>' || a.text === '<npc>')) {
        details.warn(details.checker.warnings, 'give_player', "The 'give' will automatically give to the linked player, so you do not need to specify that. To specify a different target, use the 'to:<inventory>' argument.");
    }
    // -------------------------------------------------------------------------------------
    // DEAD IN THE C#, AND PORTED DEAD. ScriptCheckerCommandSpecifics.cs:272 reads
    //     FirstOrDefault(a => ScriptChecker.StartsWithAny("quantity:", "unlimit_stack_size",
    //                                                     "to:", "t:", "slot:"))
    // `StartsWithAny(input, params checks)` takes the string to test FIRST -- so this passes the
    // literal "quantity:" as the input and ignores the lambda's own `a` entirely. The predicate
    // is the constant false ("quantity:" starts with none of the other four), `itemGive` is
    // always null, and `give_invalid_item` can never fire. The intent was plainly
    // `!StartsWithAny(a, ...)`: find the first argument that is NOT one of those prefixes.
    //
    // Left dead rather than repaired. Fixing it would turn a silent check into a live one that
    // has never run against a real workspace, on a command used everywhere -- that needs a
    // ruling, not a drive-by. It is doubly unreachable anyway: the body is also gated on
    // `SurroundingWorkspace`, which stays null until Phase 2D.
    // -------------------------------------------------------------------------------------
});
// ScriptCheckerCommandSpecifics.cs:288-294
register(['take'], (details) => {
    if (details.arguments.some(a => !a.text.includes(':') && a.text !== 'money' && a.text !== 'xp' && a.text !== 'iteminhand' && a.text !== 'cursoritem')) {
        details.warn(details.checker.minorWarnings, 'take_raw', "The 'take' command should always be used with a standard prefixed take style, like 'take item:my_item_here' or 'take slot:5'.");
    }
});
// ScriptCheckerCommandSpecifics.cs:295-301
register(['case'], (details) => {
    if (details.argCount === 1 && toLowerFast(details.arguments[0].text).replaceAll(':', '') === 'default') {
        details.warn(details.checker.minorWarnings, 'case_default', "'- case default:' is a likely mistake - you probably meant '- default:'");
    }
});
// ScriptCheckerCommandSpecifics.cs:302-308
register(['determine'], (details) => {
    if (details.arguments.some(arg => toLowerFast(arg.text) === 'canceled')) {
        details.warn(details.checker.minorWarnings, 'typo_cancelled', "'- determine canceled' (one 'L') is a likely mistake - you probably meant '- determine cancelled' (two 'L's)");
    }
});
/**
 * Performs the necessary checks on a single command line.
 * Ported from ScriptChecker.cs:793-882.
 *
 * Four warning keys of its own -- `unknown_command`, `deprecated_command`, `too_few_args`,
 * `too_many_args` -- plus `raw_object_notation`, plus whatever the per-command checker above
 * raises, plus whatever `checkSingleArgument` finds in each argument.
 */
function checkSingleCommand(checker, line, startChar, commandText, context, script) {
    var _a;
    // ScriptChecker.cs:795-804. Needs no meta, so it runs before the cold-start guard below.
    if (commandText.includes('@')) {
        const range = (0, tagChecks_1.containsObjectNotation)(commandText);
        if (range !== null) {
            checker.warn(checker.warnings, line, 'raw_object_notation', 'This line appears to contain raw object notation. There is almost always a better way to write a line than using raw object notation. Consider the relevant object constructor tags.', startChar + range.start, startChar + range.end);
        }
    }
    // ScriptChecker.cs:805-808
    commandText = commandText.replaceAll('\n', ' ');
    const firstSpace = commandText.indexOf(' ');
    const rawName = firstSpace < 0 ? commandText : commandText.substring(0, firstSpace);
    let commandName = toLowerFast(rawName);
    // :808 -- taken BEFORE the sigil is stripped, so `unknown_command`'s range covers the `~`.
    const cmdLen = commandName.length;
    // ScriptChecker.cs:809-812: `~` waits for the command, `^` runs it instantly. Neither is
    // part of the name.
    if (commandName.startsWith('~') || commandName.startsWith('^')) {
        commandName = commandName.substring(1);
    }
    // ScriptChecker.cs:813. The checker IS passed here, unlike from preprocContainer, so
    // `bad_quotes` and `missing_quotes` fire. The offset uses the RAW first part's length, so a
    // sigil still counts toward where the arguments begin.
    const argumentText = firstSpace < 0 ? null : commandText.substring(firstSpace + 1);
    const args = argumentText === null
        ? []
        : (0, buildArgs_1.buildArgs)(line, startChar + rawName.length + 1, argumentText, checker);
    // NOT IN THE C#, which reads an ambient always-present meta. Everything from here on is a
    // comparison against it: with none loaded, `Meta.Commands` holds nothing and EVERY command
    // in the file would be reported unknown. Checking nothing until the docs arrive is the only
    // honest answer -- see the same guard in checkSingleTag.
    if (checker.meta === null) {
        return;
    }
    // ScriptChecker.cs:814-821
    const command = checker.meta.commands.get(commandName);
    if (command === undefined) {
        // :816 -- `case` and `default` are block labels, not commands, and have no meta entry.
        if (commandName !== 'case' && commandName !== 'default') {
            checker.warn(checker.errors, line, 'unknown_command', `Unknown command \`${commandName.replaceAll('`', "'")}\` (typo? Use \`!command [...]\` to find a valid command).`, startChar, startChar + cmdLen);
        }
        return;
    }
    // ScriptChecker.cs:822. The four prefixed forms are the command's own plumbing, not
    // arguments to be counted against its documented arity.
    const argCount = args.filter(s => !s.text.startsWith('save:') && !s.text.startsWith('if:')
        && !s.text.startsWith('player:') && !s.text.startsWith('npc:')).length;
    // ScriptChecker.cs:823-834
    const details = new CommandCheckDetails();
    details.startChar = startChar;
    details.line = line;
    details.commandText = commandText;
    details.argCount = argCount;
    details.arguments = args;
    details.commandName = commandName;
    details.context = context;
    details.script = script;
    details.checker = checker;
    // ScriptChecker.cs:835-838
    if (!isNullOrWhiteSpace(command.deprecated)) {
        checker.warn(checker.errors, line, 'deprecated_command', `Command '${command.name}' is deprecated: ${command.deprecated}`, startChar, startChar + cmdLen);
    }
    // ScriptChecker.cs:839-856: four definitions inferred from SUBSTRINGS of the whole command
    // text. Deliberately global and sloppy -- the C# marks the first with its own TODO ("Handle
    // this locally to the tag, rather than globally pretending it exists"). Ported as-is,
    // because narrowing them would start reporting definitions these tags really do provide.
    if (commandText.includes('parse_tag')) {
        details.trackDefinition('parse_value');
    }
    if (commandText.includes('null_if_tag')) {
        details.trackDefinition('null_if_value');
    }
    if (commandText.includes('parse_value_tag')) {
        details.trackDefinition('parse_value');
        details.trackDefinition('parse_key');
    }
    if (commandText.includes('filter_tag')) {
        details.trackDefinition('filter_key');
        details.trackDefinition('filter_value');
    }
    // ScriptChecker.cs:857-864
    if (argCount < command.required) {
        checker.warn(checker.errors, line, 'too_few_args', `Insufficient arguments... the \`${command.name}\` command requires at least ${command.required} arguments, but you only provided ${argCount}.`, startChar, startChar + commandText.length);
    }
    if (argCount > command.maximum) {
        checker.warn(checker.errors, line, 'too_many_args', `Too many arguments... the \`${command.name}\` command requires no more than ${command.maximum} arguments, but you provided ${argCount}. Did you forget 'quotes'?`, startChar, startChar + commandText.length);
    }
    // ScriptChecker.cs:865-868
    const specific = exports.COMMAND_CHECKERS.get(commandName);
    if (specific !== undefined) {
        specific(details);
    }
    // ScriptChecker.cs:869-877. Read from every argument, not from the filtered set -- `save:`
    // is one of the four the filter drops.
    const saveArgument = (_a = args.find(s => s.text.startsWith('save:'))) === null || _a === void 0 ? void 0 : _a.text;
    if (saveArgument !== undefined) {
        context.saveEntries.add(toLowerFast(saveArgument.substring('save:'.length)));
        if (saveArgument.includes('<')) {
            context.hasUnknowableSaveEntries = true;
        }
    }
    // ScriptChecker.cs:878-881. `isCommand` is TRUE here despite these being the command's
    // ARGUMENTS: the flag suppresses the object-notation check, which already ran once over the
    // whole command text at :795.
    for (const argument of args) {
        (0, tagChecks_1.checkSingleArgument)(checker, line, argument.startChar, argument.text, context, true, (l, s, t, c) => (0, tagChecks_1.checkSingleTag)(checker, l, s, t, c));
    }
}
exports.checkSingleCommand = checkSingleCommand;
//# sourceMappingURL=commandSpecifics.js.map