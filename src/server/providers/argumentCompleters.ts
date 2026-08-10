/**
 * Which command arguments take a value from a fixed Minecraft enum.
 * Ported from the ByCommand registrations in
 * DenizenLangServer/CommandTabCompletions.cs (static constructor, lines 46-96).
 *
 * Only the ExtraData-backed entries are here. The registrations that resolve
 * against workspace scripts (SuggestScriptByType) or the tag system need
 * machinery that does not exist yet and arrive in later phases.
 */

import { ExtraData } from '../metaDocs/extraData';

/** One `command + prefix -> enum` registration. */
export interface EnumCompleter {
    /** The argument prefix this applies to. `''` means a bare, unprefixed argument. */
    prefix: string;
    /** Human-readable name of the enum, shown in the completion detail. */
    label: string;
    /** The candidate values, drawn from the loaded enum data. */
    values: (data: ExtraData) => Set<string>;
}

function register(map: Map<string, EnumCompleter[]>, commands: string[], completer: EnumCompleter): void {
    for (const command of commands) {
        const existing = map.get(command);
        if (existing === undefined) {
            map.set(command, [completer]);
        }
        else {
            existing.push(completer);
        }
    }
}

function build(): Map<string, EnumCompleter[]> {
    const map = new Map<string, EnumCompleter[]>();
    // C# registers 'modifyblock' twice under the empty prefix: Data.Blocks at
    // CommandTabCompletions.cs:48, then SuggestScriptByType("task", ...) at :68 (as part of the
    // run/runlater/clickable/inject/modifyblock loop). Because Register() assigns into a plain
    // dictionary, the later registration silently overwrites the earlier one, so the live C#
    // server never suggests block materials for modifyblock's bare argument — only task scripts.
    // modifyblock's real syntax is `[<location>...] [<material>|...] ... (<script>) ...`: a
    // required material argument and an optional script argument. Losing the required one to
    // registration order is a C# bug, not intent, so this port keeps the Blocks registration
    // deliberately rather than reproducing the loss. When the workspace-script completer
    // (SuggestScriptByType-equivalent) is ported in a later phase, modifyblock's two sources
    // should be merged into the same '' prefix entry, not have one replace the other.
    register(map, ['modifyblock', 'showfake'], { prefix: '', label: 'Block Material', values: d => d.blocks });
    register(map, ['create', 'spawn', 'fakespawn'], { prefix: '', label: 'Entity Type', values: d => d.entities });
    register(map, ['disguise'], { prefix: 'as', label: 'Entity Type', values: d => d.entities });
    register(map, ['playeffect'], { prefix: 'effect', label: 'Particle Effect', values: d => new Set([...d.particles, ...d.effects]) });
    register(map, ['playsound'], { prefix: 'sound', label: 'Sound Enum', values: d => d.sounds });
    register(map, ['give', 'fakeitem', 'displayitem', 'drop', 'itemcooldown'], { prefix: '', label: 'Item', values: d => d.items });
    register(map, ['take'], { prefix: 'item', label: 'Item', values: d => d.items });
    register(map, ['cast'], { prefix: '', label: 'Potion Effect Type', values: d => d.potionEffects });
    register(map, ['statistic'], { prefix: '', label: 'Statistic', values: d => d.statistics });
    return map;
}

export const COMMAND_VALUE_COMPLETERS: Map<string, EnumCompleter[]> = build();

/** The enum backing `commandName`'s `argPrefix` argument, or null when there is none. */
export function findEnumCompleter(commandName: string, argPrefix: string): EnumCompleter | null {
    const completers = COMMAND_VALUE_COMPLETERS.get(commandName.toLowerCase());
    if (completers === undefined) {
        return null;
    }
    return completers.find(c => c.prefix === argPrefix.toLowerCase()) ?? null;
}
