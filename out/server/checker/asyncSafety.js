"use strict";
/**
 * Which commands and tags are safe to run off the main server thread.
 *
 * SOURCE: the machine-readable `@asyncsave` / `@asyncbase` / `@asynccmd` block in DenizenM's
 * CommonRegistries.java, added by commit a55d500 of
 * https://github.com/Energobro/DenizenM-Tjtoxshpilivili1 -- transcribed here verbatim, in the
 * order the source lists them, so a diff against a later revision of that block is readable.
 *
 * WHY THIS IS HARDCODED, when commandSpecifics.ts and metaTypes.ts both state a preference for
 * reading rules out of the meta instead: the meta has nowhere to put this. `MetaCommand` and
 * `MetaTag` carry no thread-safety field, and `rawValues` is not a back door -- metaObjectFactory
 * only records a key AFTER `applyValue` accepted it, so an unrecognised `@Async` key would land in
 * `loadErrors` and be dropped. If Denizen ever ships this as a `<--[data]` block, `dataValueSets`
 * (metaTypes.ts) reads it with no code change here and this module becomes the fallback.
 *
 * NOTE the `async` command itself is DenizenM's, not core Denizen's. Callers must gate on the
 * loaded meta actually knowing it -- see `asyncBlockCommandName` below.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAsyncSafeTypeTag = exports.isAsyncSafeCommand = exports.asyncBlockCommandName = exports.ASYNC_BARE_SAFE_BASES = exports.ASYNC_MAIN_THREAD_ONLY_BASES = exports.ASYNC_SAFE_TYPE_TAGS = exports.ASYNC_SAFE_EVERYTHING_TYPES = exports.ASYNC_DEFERRABLE_COMMANDS = exports.ASYNC_SAFE_COMMANDS = void 0;
/**
 * `@asynccmd runsAsync`: commands an async queue runs on its own thread.
 * Generated in the source from `AbstractCommand.asyncSafe` / `isAsyncSafe` across core and plugin.
 * Anything absent is handed to the main thread.
 */
exports.ASYNC_SAFE_COMMANDS = new Set([
    'actionbar', 'announce', 'async', 'choose', 'debug', 'debug-invalid-command', 'debugblock',
    'define', 'definemap', 'determine', 'draw', 'else', 'filecopy', 'fileread', 'filewrite',
    'flag', 'foreach', 'goto', 'if', 'image', 'inject', 'log', 'mark', 'narrate', 'playeffect',
    'playsound', 'random', 'ratelimit', 'redis', 'repeat', 'run', 'schematic', 'sidebar', 'sql',
    'stop', 'tablist', 'title', 'toast', 'wait', 'waituntil', 'webget', 'webserver', 'while',
    'yaml'
]);
/**
 * `@asynccmd deferrable`: an async queue may fire these at the main thread and carry on without
 * waiting. They do NOT run on the async thread, so the source lists them separately -- but for
 * diagnostics they are just as fine to write inside an `async` block, because they never stall
 * the queue.
 *
 * The source marks three of them conditionally -- `actionbar(per_player)`, `narrate(per_player)`,
 * `sidebar(per_player)`, `runlater(id)` -- meaning only that form defers. That condition is
 * deliberately NOT modelled: treating the command as deferrable in every form can only cost a
 * missed warning, whereas modelling it wrong would squiggle correct script. Silence is the
 * cheaper error here, and this check is advisory to begin with.
 */
exports.ASYNC_DEFERRABLE_COMMANDS = new Set([
    'actionbar', 'announce', 'compass', 'fakeequip', 'narrate', 'playeffect', 'playsound',
    'runlater', 'showfake', 'sidebar'
]);
/** Object types every one of whose tags is async-safe (`@asyncsave <Type>: (everything)`). */
exports.ASYNC_SAFE_EVERYTHING_TYPES = new Set([
    'biometag', 'enchantmenttag', 'materialtag', 'plugintag', 'tradetag', 'binarytag', 'colortag',
    'customobjecttag', 'durationtag', 'elementtag', 'imagetag', 'javareflectedobjecttag',
    'listtag', 'maptag', 'quaterniontag', 'queuetag', 'scripttag', 'secrettag', 'timetag'
]);
/**
 * `@asyncsave <Type>: <sub-tags>` -- for these object types the listed sub-tags are safe and
 * everything else is handed to the main thread. Keys are lowercased type names.
 *
 * `InventoryTag` and `NPCTag` are marked `(none)` in the source: present with an empty set, which
 * is NOT the same as absent. Absent means "unmarked, assume safe"; empty means "nothing is safe".
 */
exports.ASYNC_SAFE_TYPE_TAGS = new Map([
    ['chunktag', new Set(['add', 'cuboid', 'is_loaded', 'simple', 'sub', 'world', 'x', 'xz', 'z'])],
    ['cuboidtag', new Set([
            'center', 'contains', 'contains_cuboid', 'contains_location', 'corners', 'flag',
            'flag_expiration', 'flag_map', 'get_outline', 'has_flag', 'intersects', 'is_within',
            'list_flags', 'max', 'min', 'outline', 'outline_2d', 'shell', 'shift', 'size', 'volume',
            'walls', 'with_max', 'with_min'
        ])],
    ['ellipsoidtag', new Set([
            'add', 'bounding_box', 'chunks', 'contains', 'contains_location', 'flag',
            'flag_expiration', 'flag_map', 'has_flag', 'include', 'is_within', 'list_flags',
            'location', 'random', 'shell', 'size', 'with_location', 'with_size', 'world'
        ])],
    ['entitytag', new Set(['entity_type', 'script', 'translated_name', 'type', 'uuid'])],
    ['inventorytag', new Set()],
    ['itemtag', new Set([
            'book_author', 'book_map', 'book_pages', 'book_title', 'display', 'durability',
            'enchantment_map', 'enchantment_types', 'enchantments', 'flag', 'flag_expiration',
            'flag_map', 'has_display', 'has_flag', 'has_lore', 'is_enchanted', 'list_flags', 'lore',
            'material', 'max_stack', 'quantity', 'script', 'with_flag'
        ])],
    ['locationtag', new Set([
            'above', 'add', 'backward', 'backward_flat', 'below', 'center', 'chunk', 'distance',
            'distance_squared', 'div', 'down', 'format', 'formatted', 'forward', 'forward_flat',
            'get_chunk', 'left', 'mul', 'normalize', 'pitch', 'points_around_x', 'points_around_y',
            'points_around_z', 'points_between', 'quaternion_between_vectors', 'random_offset', 'raw',
            'relative', 'right', 'rotate_around_x', 'rotate_around_y', 'rotate_around_z',
            'rotate_pitch', 'rotate_yaw', 'round', 'round_down', 'round_to', 'round_to_precision',
            'round_up', 'simple', 'simplex_3d', 'sub', 'to_axis_angle_quaternion', 'up',
            'vector_length', 'vector_length_squared', 'vector_to_face', 'with_pitch', 'with_x',
            'with_y', 'with_yaw', 'with_z', 'world', 'x', 'xyz', 'y', 'yaw', 'z'
        ])],
    ['npctag', new Set()],
    ['playertag', new Set([
            'ban_created', 'ban_created_time', 'ban_expiration', 'ban_expiration_time', 'ban_info',
            'ban_reason', 'ban_source', 'chat_history', 'chat_history_list', 'disguise_to_self',
            'fake_block', 'fake_block_locations', 'fake_entities', 'first_played', 'first_played_time',
            'flag', 'flag_expiration', 'flag_map', 'has_flag', 'has_played_before', 'is_banned',
            'is_online', 'is_op', 'is_player', 'is_whitelisted', 'last_played', 'last_played_time',
            'list_flags', 'name', 'sidebar_lines', 'sidebar_scores', 'sidebar_title', 'uuid',
            'whitelisted'
        ])],
    ['polygontag', new Set([
            'bounding_box', 'contains', 'contains_inclusive', 'contains_location', 'corners', 'flag',
            'flag_expiration', 'flag_map', 'has_flag', 'include_y', 'is_within', 'list_flags', 'max_y',
            'min_y', 'outline', 'outline_2d', 'shell', 'shell_inclusive', 'shift', 'with_corner',
            'with_y_max', 'with_y_min', 'world'
        ])],
    ['worldtag', new Set([
            'allows_animals', 'allows_monsters', 'allows_pvp', 'ambient_spawn_limit',
            'animal_spawn_limit', 'auto_save', 'can_generate_structures', 'difficulty',
            'duration_since_created', 'environment', 'hardcore', 'has_storm', 'is_day', 'is_night',
            'keep_spawn', 'max_height', 'min_height', 'monster_spawn_limit', 'moon_phase', 'name',
            'sea_level', 'seed', 'simulation_distance', 'sky_darkness', 'thunder_duration',
            'thundering', 'ticks_per_animal_spawn', 'ticks_per_monster_spawn', 'time', 'time_duration',
            'time_full', 'time_period', 'view_distance', 'water_animal_spawn_limit',
            'weather_duration', 'world_type'
        ])]
]);
/**
 * `@asyncbase mainThreadOnly`: tag BASES that cost a main-thread hand-off when a tag is WRITTEN
 * starting with them. A separate axis from the object-type map above -- the same object reached
 * through a definition is governed by its TYPE, not by how some other tag spelled it.
 */
exports.ASYNC_MAIN_THREAD_ONLY_BASES = new Set([
    'biome', 'chunk', 'cuboid', 'ellipsoid', 'enchantment', 'entity', 'inventory', 'item',
    'plugin', 'polygon', 'trade', 'world', 'player', 'server', 'npc'
]);
/**
 * `@asyncbase bareSafe`: bases that are free to MENTION off-thread (`<player>` on its own resolves
 * to the queue's linked player without touching the server), even though they are main-thread-only
 * once a sub-tag is read off them.
 */
exports.ASYNC_BARE_SAFE_BASES = new Set(['player', 'npc']);
/**
 * The command name opening an async block, or null when this line does not open one.
 *
 * Takes the raw block-opening line text (no trailing `:`), e.g. `async` or `~async`. The `~`/`^`
 * sigils are stripped the same way checkSingleCommand strips them.
 */
function asyncBlockCommandName(blockLineText) {
    const firstSpace = blockLineText.indexOf(' ');
    let name = (firstSpace < 0 ? blockLineText : blockLineText.substring(0, firstSpace)).toLowerCase();
    if (name.startsWith('~') || name.startsWith('^')) {
        name = name.substring(1);
    }
    return name === 'async' ? name : null;
}
exports.asyncBlockCommandName = asyncBlockCommandName;
/**
 * Whether `commandName` (lowercased, sigils already stripped) can appear inside an `async` block
 * without stalling the queue on the main thread.
 *
 * Deferrable counts as safe -- see the note on ASYNC_DEFERRABLE_COMMANDS.
 */
function isAsyncSafeCommand(commandName) {
    return exports.ASYNC_SAFE_COMMANDS.has(commandName) || exports.ASYNC_DEFERRABLE_COMMANDS.has(commandName);
}
exports.isAsyncSafeCommand = isAsyncSafeCommand;
/**
 * Whether reading `subTag` off an object of type `typeName` is async-safe.
 *
 * Returns true for any type the source does not mark at all: the map covers exactly the types
 * DenizenM audited, and an unaudited type must not be squiggled on a guess.
 */
function isAsyncSafeTypeTag(typeName, subTag) {
    const type = typeName.toLowerCase();
    if (exports.ASYNC_SAFE_EVERYTHING_TYPES.has(type)) {
        return true;
    }
    const safe = exports.ASYNC_SAFE_TYPE_TAGS.get(type);
    if (safe === undefined) {
        return true;
    }
    return safe.has(subTag.toLowerCase());
}
exports.isAsyncSafeTypeTag = isAsyncSafeTypeTag;
//# sourceMappingURL=asyncSafety.js.map