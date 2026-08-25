// Per-command checks, ported from SharpDenizenTools' ScriptCheckerCommandSpecifics.cs (311
// lines): the registry of command-name -> checker, and the twelve checkers themselves.
//
// Same import rule as the rest of src/server/checker/: no `vscode-languageserver`, no `/node`,
// no `vscode`, no I/O. Meta is reached through the checker, never through an ambient singleton.
//
// NOTHING CALLS THIS YET. `CheckSingleCommand` (Task 4) dispatches through the registry, and
// `CheckAllContainers` (Phase 2C-6) is what drives that.

import type { ScriptChecker } from './scriptChecker';
import type { ScriptCheckContext } from './tagChecks';
import type { CommandArgument } from './buildArgs';
import type { ScriptWarning } from './scriptWarnings';
import type { ScriptContainerData } from './containerConvert';

/**
 * Everything a per-command checker gets to look at.
 * Ported from ScriptCheckerCommandSpecifics.cs:17-67.
 *
 * `context` is non-null here, unlike in `checkSingleTag`. The C# dereferences it unguarded at
 * ScriptChecker.cs:872 and throughout these checkers, because the only caller builds one.
 */
export class CommandCheckDetails {
    checker!: ScriptChecker;
    /** The command name, lowercased and with any leading `~`/`^` already stripped. (:23) */
    commandName!: string;
    /** The whole command line, newlines flattened to spaces. (:26) */
    commandText!: string;
    /** Arguments EXCLUDING the four prefixed forms -- see ScriptChecker.cs:822. (:29) */
    argCount!: number;
    line!: number;
    /** Every argument, including the prefixed ones `argCount` skips. (:35) */
    arguments!: CommandArgument[];
    context!: ScriptCheckContext;
    startChar!: number;
    script!: ScriptContainerData | null;

    /**
     * Warns over an explicit range, or -- when `start`/`end` are omitted -- over the whole
     * command line. Two C# overloads (:47-56) collapsed into one signature; the defaulted form
     * is by far the commoner and is what most of these checkers use.
     */
    warn(warningSet: ScriptWarning[], key: string, message: string, start?: number, end?: number): void {
        const from = start ?? this.startChar;
        const to = end ?? this.startChar + this.commandText.length;
        this.checker.warn(warningSet, this.line, key, message, from, to);
    }

    /**
     * Records a definition this command establishes. (:59-66)
     *
     * NOTE the asymmetry, ported as-is: the name is truncated at the first `.` before being
     * stored, but the `<` test runs on the UNTRUNCATED input. So `<[x]>.sub` sets the unknowable
     * flag even though what gets stored is the empty string before the dot.
     */
    trackDefinition(def: string): void {
        const dot = def.indexOf('.');
        this.context.definitions.add(dot < 0 ? def : def.substring(0, dot));
        if (def.includes('<')) {
            this.context.hasUnknowableDefinitions = true;
        }
    }
}

/** A per-command check. */
export type CommandChecker = (details: CommandCheckDetails) => void;

/** Command name -> checker. Ported from ScriptCheckerCommandSpecifics.cs:70. */
export const COMMAND_CHECKERS: Map<string, CommandChecker> = new Map<string, CommandChecker>();

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
export function register(cmdNames: string[], method: CommandChecker): void {
    let combined = method;
    for (const cmd of cmdNames) {
        const existing = COMMAND_CHECKERS.get(cmd);
        if (existing !== undefined) {
            const previous = combined;
            combined = (details) => { previous(details); existing(details); };
        }
        COMMAND_CHECKERS.set(cmd, combined);
    }
}

/**
 * Bukkit/vanilla commands that should never be run through Denizen's `execute`.
 * Ported from ScriptCheckerCommandSpecifics.cs:87-99 -- 76 names, extracted from the C# source
 * mechanically rather than retyped, and verified the same way.
 */
export const BAD_EXECUTE_COMMANDS: ReadonlySet<string> = new Set<string>([
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
export function argHasPrefix(arg: string): boolean {
    for (let i = 0; i < arg.length; i++) {
        if (PREFIX_FORBIDDEN_SYMBOLS.includes(arg[i])) {
            return arg[i] === ':';
        }
    }
    return false;
}
