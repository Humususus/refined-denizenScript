"use strict";
// The known script type table, ported from SharpDenizenTools' ScriptChecker.cs:22-48, :885-907
// and :913-916. This module must stay dependency-free: it imports nothing at all.
//
// This is pure DATA, and it is the highest-risk transcription in Phase 2C-3. Every entry decides
// how a container's keys are classified: whether a section is script to be walked for
// definitions, a plain list to be ignored, or an unrecognised key. A single dropped string
// silently changes that classification, and nothing downstream would look wrong -- Phase 2C-4
// would simply fail to collect some definitions and then report them as undefined, on scripts
// that are correct.
//
// The table was therefore NOT verified by reading it against the C# side by side. It was checked
// by a throwaway extractor that parses the C# source text and diffs it field by field against
// this file's compiled output. Redo that if you edit anything here.
//
// There is exactly ONE intentional exception to the porting rule in this file, labelled
// DELIBERATE DEVIATION at its site and taken as a USER RULING: the `dialog` entry, which the C#
// does not have and which the user's own scripts need. The extractor knows about it by name and
// still diffs every other entry strictly.
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchesSet = exports.ALWAYS_DATA_KEYS = exports.ALWAYS_SCRIPT_KEYS = exports.KNOWN_SCRIPT_TYPES = void 0;
/** Applies ScriptChecker.cs:888-906's field initialisers to a partial entry. */
function knownType(partial) {
    var _a, _b, _c, _d, _e, _f, _g;
    return {
        requiredKeys: (_a = partial.requiredKeys) !== null && _a !== void 0 ? _a : [],
        likelyBadKeys: (_b = partial.likelyBadKeys) !== null && _b !== void 0 ? _b : [],
        valueKeys: (_c = partial.valueKeys) !== null && _c !== void 0 ? _c : [],
        listKeys: (_d = partial.listKeys) !== null && _d !== void 0 ? _d : [],
        scriptKeys: (_e = partial.scriptKeys) !== null && _e !== void 0 ? _e : [],
        strict: (_f = partial.strict) !== null && _f !== void 0 ? _f : false,
        canHaveRandomScripts: (_g = partial.canHaveRandomScripts) !== null && _g !== void 0 ? _g : true
    };
}
/**
 * Every known script type name, in the C#'s declaration order.
 * Ported from ScriptChecker.cs:22-42. Sixteen entries: five Denizen Core, eleven Denizen-Bukkit.
 *
 * A `Map` rather than a plain object so that lookup by an arbitrary user-supplied type string
 * cannot reach `Object.prototype` -- `KNOWN_SCRIPT_TYPES.get('constructor')` is undefined, where
 * a record's would not be. `ConvertContainers` looks these up with exactly such a string.
 */
exports.KNOWN_SCRIPT_TYPES = new Map([
    // Denizen Core (ScriptChecker.cs:24-29)
    ['custom', knownType({
            likelyBadKeys: ['script', 'actions', 'events', 'steps'],
            valueKeys: ['inherit', '*'],
            scriptKeys: ['tags.*', 'mechanisms.*'],
            strict: false,
            canHaveRandomScripts: false
        })],
    ['procedure', knownType({
            requiredKeys: ['script'],
            likelyBadKeys: ['events', 'actions', 'steps'],
            valueKeys: ['definitions'],
            scriptKeys: ['script', '*'],
            strict: true
        })],
    ['task', knownType({
            requiredKeys: ['script'],
            likelyBadKeys: ['events', 'actions', 'steps'],
            valueKeys: ['definitions'],
            scriptKeys: ['script'],
            strict: false
        })],
    ['world', knownType({
            requiredKeys: ['events'],
            valueKeys: ['enabled'],
            likelyBadKeys: ['script', 'actions', 'steps'],
            scriptKeys: ['events.*'],
            strict: false
        })],
    ['data', knownType({
            likelyBadKeys: ['script', 'actions', 'steps', 'events'],
            valueKeys: ['*'],
            listKeys: ['*'],
            strict: false,
            canHaveRandomScripts: false
        })],
    // Denizen-Bukkit (ScriptChecker.cs:31-41)
    ['assignment', knownType({
            requiredKeys: ['actions'],
            likelyBadKeys: ['script', 'steps', 'events'],
            valueKeys: ['default constants.*', 'constants.*', 'enabled'],
            listKeys: ['interact scripts'],
            scriptKeys: ['actions.*'],
            strict: true
        })],
    ['book', knownType({
            requiredKeys: ['title', 'author', 'text'],
            likelyBadKeys: ['script', 'actions', 'steps', 'events'],
            valueKeys: ['title', 'author', 'signed'],
            listKeys: ['text'],
            strict: true,
            canHaveRandomScripts: false
        })],
    ['command', knownType({
            requiredKeys: ['name', 'description', 'usage', 'script'],
            likelyBadKeys: ['steps', 'actions', 'events'],
            valueKeys: ['name', 'description', 'usage', 'permission', 'permission message', 'enabled', 'aliases'],
            listKeys: ['aliases'],
            scriptKeys: ['allowed help', 'tab complete', 'script'],
            strict: false
        })],
    ['economy', knownType({
            requiredKeys: ['priority', 'name single', 'name plural', 'digits', 'format', 'balance', 'has', 'withdraw', 'deposit'],
            likelyBadKeys: ['script', 'actions', 'steps', 'events'],
            valueKeys: ['priority', 'name single', 'name plural', 'digits', 'format', 'balance', 'has', 'enabled'],
            scriptKeys: ['withdraw', 'deposit'],
            strict: true,
            canHaveRandomScripts: false
        })],
    ['entity', knownType({
            requiredKeys: ['entity_type'],
            likelyBadKeys: ['script', 'actions', 'steps', 'events'],
            valueKeys: ['entity_type', 'flags.*', 'mechanisms.*'],
            listKeys: ['flags.*', 'mechanisms.*'],
            strict: true,
            canHaveRandomScripts: false
        })],
    ['format', knownType({
            requiredKeys: ['format'],
            likelyBadKeys: ['script', 'actions', 'steps', 'events'],
            valueKeys: ['format'],
            strict: true,
            canHaveRandomScripts: false
        })],
    ['interact', knownType({
            requiredKeys: ['steps'],
            valueKeys: ['enabled'],
            likelyBadKeys: ['script', 'actions', 'events'],
            scriptKeys: ['steps.*'],
            strict: true
        })],
    ['inventory', knownType({
            requiredKeys: ['inventory'],
            likelyBadKeys: ['script', 'steps', 'actions', 'events'],
            valueKeys: ['inventory', 'title', 'size', 'definitions.*', 'gui'],
            scriptKeys: ['procedural items'],
            listKeys: ['slots'],
            strict: true,
            canHaveRandomScripts: false
        })],
    ['item', knownType({
            requiredKeys: ['material'],
            likelyBadKeys: ['script', 'steps', 'actions', 'events'],
            valueKeys: ['material', 'mechanisms.*', 'display name', 'durability', 'recipes.*', 'no_id', 'color', 'book', 'flags.*', 'allow in material recipes'],
            listKeys: ['mechanisms.*', 'lore', 'enchantments', 'recipes.*', 'flags.*'],
            strict: true,
            canHaveRandomScripts: false
        })],
    ['map', knownType({
            likelyBadKeys: ['script', 'steps', 'actions', 'events'],
            valueKeys: ['original', 'display name', 'auto update', 'objects.*', 'contextual'],
            strict: true,
            canHaveRandomScripts: false
        })],
    // -----------------------------------------------------------------
    // DELIBERATE DEVIATION FROM ScriptChecker.cs -- NOT a porting mistake.
    // -----------------------------------------------------------------
    // `dialog` is NOT in the C#'s table, and is not in Denizen's downloadable meta either --
    // the meta ships 17 "script container" language pages and none of them is dialog. It is a
    // recent Denizen container type that the vendored SharpDenizenTools predates entirely.
    //
    // Without this entry, `convertContainers` reports `wrong_type` -- an ERROR-severity
    // diagnostic on the container's title line -- for every dialog container. Measured on the
    // user's own scripts: 2 of 44 containers, both perfectly valid.
    //
    // USER RULING, and one they had already asked for before this port began: prompt.md names
    // this exact container ("Еще убрать error подсветку у Контейнера / nicknameChanged: /
    // type: dialog ... Ну типо поддержку этого контейнера добавь").
    //
    // THE FIELDS ARE DELIBERATELY CONSERVATIVE, because every field here can only ADD
    // diagnostics and the point of the change is to remove one:
    //   - `requiredKeys` and `likelyBadKeys` are EMPTY ON PURPOSE. Both exist to drive warnings
    //     in CheckAllContainers (Phase 2C-4). With no authoritative meta to copy, anything put
    //     here would be invented, and inventing a required key turns a valid minimal dialog into
    //     a new error -- trading one false positive for another.
    //   - `strict: false`, so unrecognised keys never warn.
    //   - `canHaveRandomScripts: false`, so a list under `base`/`bodies`/`inputs` is NOT walked
    //     as commands. Only the one key that genuinely holds code is.
    //   - `scriptKeys: ['buttons.*']` is the one thing that must be right: a dialog's code lives
    //     at `buttons.<n>.script`, and `keyText` at ScriptChecker.cs:1930 is built from the
    //     TOP-LEVEL key name, so `buttons.*` is the expression that reaches it -- exactly the
    //     shape `world` uses for `events.*`.
    // Derived by reading the user's two real dialog containers; re-derive if Denizen publishes
    // real meta for this type.
    ['dialog', knownType({
            valueKeys: ['base.*', 'bodies.*', 'inputs.*'],
            scriptKeys: ['buttons.*'],
            strict: false,
            canHaveRandomScripts: false
        })],
    ['enchantment', knownType({
            likelyBadKeys: ['script', 'steps', 'actions', 'events'],
            scriptKeys: ['after attack', 'after hurt'],
            valueKeys: ['id', 'rarity', 'category', 'full_name', 'min_level', 'max_level', 'min_cost', 'max_cost',
                'treasure_only', 'is_curse', 'is_tradable', 'is_discoverable', 'is_compatible', 'can_enchant',
                'damage_bonus', 'damage_protection', 'enabled'],
            listKeys: ['slots'],
            strict: true,
            canHaveRandomScripts: false
        })]
]);
/** Keys that always mean a section is a script. (ScriptChecker.cs:45) */
exports.ALWAYS_SCRIPT_KEYS = ['script', 'scripts', 'subscripts', 'subtasks', 'inject', 'injects', 'injectables', 'subprocedures'];
/** Keys that always mean simple data. (ScriptChecker.cs:48) */
exports.ALWAYS_DATA_KEYS = ['data', 'description'];
/**
 * Whether a key matches a key-set, with asterisk support. Ported from ScriptChecker.cs:913-916.
 *
 * Three ways to match: the key itself, the key with a `.*` suffix (so `events` matches a set
 * declaring `events.*`), or a bare `*` in the set, which matches EVERYTHING.
 *
 * NOTE that `PreprocContainer` does not use this helper everywhere. At ScriptChecker.cs:1937 and
 * :1948 it tests `set.Contains(keyName + ".*")` directly instead, which is a DIFFERENT question:
 * `matchesSet` would also accept a bare `keyName` or a `*`, and those sites deliberately do not.
 * Follow each call site rather than normalising them.
 */
function matchesSet(key, keySet) {
    return keySet.includes(key) || keySet.includes(`${key}.*`) || keySet.includes('*');
}
exports.matchesSet = matchesSet;
//# sourceMappingURL=scriptTypes.js.map