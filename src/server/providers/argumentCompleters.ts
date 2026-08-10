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
