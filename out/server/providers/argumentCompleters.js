"use strict";
/**
 * Which command arguments take a value from a fixed Minecraft enum.
 * Ported from the ByCommand registrations in
 * DenizenLangServer/CommandTabCompletions.cs (static constructor, lines 46-96).
 *
 * Only the ExtraData-backed entries are here. The registrations that resolve
 * against workspace scripts (SuggestScriptByType) or the tag system need
 * machinery that does not exist yet and arrive in later phases.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.findKeyLineCompleter = exports.KEY_LINE_COMPLETERS = exports.findEnumCompleters = exports.COMMAND_VALUE_COMPLETERS = void 0;
function register(map, commands, completer) {
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
function build() {
    const map = new Map();
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
    // NO C# COUNTERPART: CommandTabCompletions.cs registers only playsound's `sound:` argument,
    // so `sound_category:` completes nothing on either engine.
    //
    // Hardcoded rather than read from ExtraData because there is nothing to read. The meta's
    // own playsound entry documents the argument as `(sound_category:<category_name>)` and then
    // defers to https://hub.spigotmc.org/javadocs/spigot/org/bukkit/SoundCategory.html for the
    // values instead of listing them, and minecraft.fds (extraData.ts) carries no sound-category
    // section either. So this mirrors `determine` below: a literal set, not a data lookup.
    //
    // Lowercase to match every other completer -- ExtraData lowercases everything it parses, and
    // Denizen resolves the argument through ElementTag.asEnum, which is case-insensitive. The
    // Bukkit enum spells them uppercase; typing it that way still matches, because
    // completeEnumValues folds case before filtering.
    register(map, ['playsound'], { prefix: 'sound_category', label: 'Sound Category', values: () => new Set([
            'ambient', 'blocks', 'hostile', 'master', 'music', 'neutral', 'players', 'records', 'voice', 'weather'
        ]) });
    register(map, ['give', 'fakeitem', 'displayitem', 'drop', 'itemcooldown'], { prefix: '', label: 'Item', values: d => d.items });
    register(map, ['take'], { prefix: 'item', label: 'Item', values: d => d.items });
    register(map, ['cast'], { prefix: '', label: 'Potion Effect Type', values: d => d.potionEffects });
    register(map, ['statistic'], { prefix: '', label: 'Statistic', values: d => d.statistics });
    // CommandTabCompletions.cs:66-67 registers `determine` under the empty prefix
    // with a hardcoded set and a null enum key (no documentation attached). It needs
    // neither workspace tracking nor tags, so ExtraData is accepted but unused here.
    register(map, ['determine'], { prefix: '', label: null, values: () => new Set(['cancelled', 'cancelled:false']) });
    return map;
}
exports.COMMAND_VALUE_COMPLETERS = build();
/**
 * Every enum backing `commandName`'s `argPrefix` argument, in registration order.
 * The map stores an array per command specifically so multiple sources can coexist
 * under the same prefix (see the modifyblock note above) — returning only the first
 * match here would silently make any later-registered completer unreachable once
 * appended to the same array, which is the C#'s registration-collision bug mirrored
 * in TypeScript instead of fixed. Returns an empty array when nothing matches.
 */
function findEnumCompleters(commandName, argPrefix) {
    const completers = exports.COMMAND_VALUE_COMPLETERS.get(commandName.toLowerCase());
    if (completers === undefined) {
        return [];
    }
    return completers.filter(c => c.prefix === argPrefix.toLowerCase());
}
exports.findEnumCompleters = findEnumCompleters;
/**
 * Container keys whose value comes from a fixed Minecraft enum.
 * Ported from TextDocumentService.cs:288-292 (LinePrefixCompleters).
 */
exports.KEY_LINE_COMPLETERS = new Map([
    ['material', { prefix: '', label: 'Item', values: (d) => d.items }],
    ['entity_type', { prefix: '', label: 'Entity Type', values: (d) => d.entities }]
]);
/** The enum backing a container key's value, or null when that key takes free text. */
function findKeyLineCompleter(key) {
    var _a;
    return (_a = exports.KEY_LINE_COMPLETERS.get(key.toLowerCase().trim())) !== null && _a !== void 0 ? _a : null;
}
exports.findKeyLineCompleter = findKeyLineCompleter;
//# sourceMappingURL=argumentCompleters.js.map