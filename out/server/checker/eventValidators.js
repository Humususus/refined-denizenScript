"use strict";
// Ported from SharpDenizenTools/MetaHandlers/ExtraData.cs:150-357 -- the seven type matchers and
// the validator registry that event could-matching is built on.
//
// WHY THESE LIVE HERE AND NOT IN ../metaDocs/extraData.ts. The C# hangs them off `ExtraData` as
// instance methods. This port cannot: `extraData.ts` does file and network I/O, and everything in
// src/server/checker/ is required to stay I/O-free so the checker can be exercised as a pure
// function. So the matchers take the data as a parameter instead of owning it. Nothing about the
// behaviour changes -- this is a module boundary, not a deviation.
//
// WHAT THE RETURN VALUE MEANS. Every matcher returns a confidence, not a boolean:
//     10  certain: an exact known name, or a documented prefix like `item_flagged:`
//      7  precise mode only: an advanced matcher that provably hits at least one real value
//      5  loose mode only: an advanced matcher, contents unverified
//      1  unrecognized, but not known to be something else -- "probably a name we can't see"
//      0  actively wrong: a known name of the WRONG type
// The 1-vs-0 distinction is what stops the checker warning about every event that mentions a
// custom NPC name or a plugin's item, while still catching `on player breaks zombie:`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.knownValidatorTypes = exports.matchWorld = exports.matchArea = exports.matchMaterial = exports.matchBlock = exports.matchInventory = exports.matchItem = exports.matchEntity = exports.INVENTORY_MATCHERS = exports.ITEM_COULD_MATCH_PREFIXES = exports.SPECIAL_ENTITY_MATCHABLES = void 0;
const advancedMatcher_1 = require("./advancedMatcher");
const frenetic_1 = require("./frenetic");
/** Known always-valid entity labels. (ExtraData.cs:151-154) */
exports.SPECIAL_ENTITY_MATCHABLES = new Set([
    'entity', 'npc', 'player', 'living', 'vehicle', 'fish', 'projectile', 'hanging', 'monster', 'mob', 'animal'
]);
/** Known always-valid item label prefixes. (ExtraData.cs:185-188) */
exports.ITEM_COULD_MATCH_PREFIXES = new Set([
    'item_flagged', 'vanilla_tagged', 'item_enchanted', 'material_flagged', 'raw_exact'
]);
/**
 * Known always-valid inventory labels. (ExtraData.cs:222-234)
 *
 * The C# list repeats `workbench`, `crafting` and `player`; a HashSet swallows the duplicates, and
 * so does a Set here. The upstream comment on the second half -- "This should maybe be in the data
 * file" -- is preserved below because it flags the half most likely to drift from the game.
 */
exports.INVENTORY_MATCHERS = new Set([
    'inventory', 'notable', 'note',
    'npc', 'player', 'crafting', 'enderchest', 'workbench', 'entity', 'location', 'generic',
    // This should maybe be in the data file.
    'chest', 'dispenser', 'dropper', 'furnace', 'workbench', 'crafting', 'enchanting', 'brewing', 'player',
    'creative', 'merchant', 'ender_chest', 'anvil', 'smithing', 'beacon', 'hopper', 'shulker_box', 'barrel', 'blast_furnace',
    'lectern', 'smoker', 'loom', 'cartography', 'grindstone', 'stonecutter', 'composter',
    // DELIBERATE DEVIATION (user report 2026-09-02): four inventory types Minecraft added after
    // the C# list was written. `on <item> moves from hopper to jukebox:` runs fine in Denizen but
    // was reported as a nonexistent event.
    //
    // WHY THESE FOUR AND NOT MORE. A word reaching `fallbackScore` below is only ever reported as
    // WRONG when it is a known block or item -- an unrecognised word (an inventory script's name,
    // a notable) scores 1 and is left alone. So the false positives are exactly the inventory
    // types that are also blocks, and nothing else needs adding to silence them. Measured against
    // the live enum data: each of these four scored 0 before this line and 10 after.
    //
    // These are `org.bukkit.event.inventory.InventoryType` values, which is the same source the
    // list above draws on -- NOT block names. `smithing_table`, `crafting_table`,
    // `enchanting_table`, `brewing_stand` and `trapped_chest` are deliberately absent: those are
    // block names whose inventory types are already present under their real names (`smithing`,
    // `crafting`, `enchanting`, `brewing`, `chest`), and adding them would stop a genuine typo
    // being caught.
    //
    // This list is hand-maintained and will fall behind again -- upstream says as much in the
    // comment above. If keeping up with it becomes a nuisance, the alternative is to drop the
    // block/item half of the `foreign` argument for inventories, which would stop this whole class
    // of false positive at the cost of never catching a block that has no inventory at all.
    'jukebox', 'chiseled_bookshelf', 'decorated_pot', 'crafter'
]);
/**
 * The shared tail of five of the seven matchers: what to answer once the "certainly right" test
 * above has already failed. (ExtraData.cs:165-182 and its four near-copies.)
 *
 * NOT a refactor of the C# for tidiness -- the five copies there are character-for-character the
 * same but for which set counts as "some other type", and collapsing them keeps that one real
 * difference visible instead of buried in five look-alike blocks.
 *
 * @param own       the values that ARE this type; an advanced matcher hitting one of these is
 *                  what earns the 7 in precise mode
 * @param foreign   values belonging to OTHER types; a plain word found here scores 0, which is the
 *                  only way this function ever reports something as definitely wrong
 */
function fallbackScore(word, precise, own, foreign) {
    if (precise) {
        if ((0, advancedMatcher_1.isAdvancedMatchable)(word)) {
            if (own === null) {
                // ExtraData.cs:308-311 (areas): no enum of known areas exists, so a pattern cannot
                // be verified against one. The C# answers 2 rather than 7 or 0 -- weaker than a
                // verified hit but still a match, so an area pattern is never reported wrong.
                return 2;
            }
            const matcher = (0, advancedMatcher_1.createMatcher)(word);
            for (const candidate of own) {
                if (matcher.doesMatch(candidate)) {
                    return 7;
                }
            }
            return 0;
        }
        return 0;
    }
    if ((0, advancedMatcher_1.isAdvancedMatchable)(word)) {
        return 5;
    }
    for (const set of foreign) {
        if (set.has(word)) {
            return 0;
        }
    }
    return 1;
}
/** Type matcher for EntityTag. (ExtraData.cs:157-182) */
function matchEntity(data, word, precise) {
    if (word.startsWith('entity_flagged:') || word.startsWith('player_flagged:') || word.startsWith('npc_flagged:')
        || exports.SPECIAL_ENTITY_MATCHABLES.has(word)
        || data.entities.has(word)) {
        return 10;
    }
    return fallbackScore(word, precise, data.entities, [data.blocks, data.items]);
}
exports.matchEntity = matchEntity;
/** Type matcher for ItemTag. (ExtraData.cs:191-219) */
function matchItem(data, word, precise) {
    // ExtraData.cs:193-196. `block` is rejected up front, BEFORE the 10-tests -- an event that
    // says `block` wants MatchBlock, and letting it through here would make `<item>` and `<block>`
    // could-matchers tie on it.
    if (word === 'block') {
        return 0;
    }
    // NOTE `before(word, ':')` and not the whole word: these are prefixes, so `item_flagged:cool`
    // matches on `item_flagged`. `before` returns the whole string when there is no colon, so a
    // bare `raw_exact` also scores 10.
    if (exports.ITEM_COULD_MATCH_PREFIXES.has((0, frenetic_1.before)(word, ':'))
        || word === 'item' || word === 'potion'
        || data.items.has(word)) {
        return 10;
    }
    return fallbackScore(word, precise, data.items, [data.blocks, data.entities]);
}
exports.matchItem = matchItem;
/** Type matcher for InventoryTag. (ExtraData.cs:237-261) */
function matchInventory(data, word, precise) {
    if (exports.INVENTORY_MATCHERS.has(word)
        || word.startsWith('inventory_flagged:')) {
        return 10;
    }
    return fallbackScore(word, precise, exports.INVENTORY_MATCHERS, [data.blocks, data.items, data.entities]);
}
exports.matchInventory = matchInventory;
/** Type matcher for blocks. (ExtraData.cs:264-292) */
function matchBlock(data, word, precise) {
    // ExtraData.cs:266-269, the mirror of the `block` rejection in matchItem.
    if (word === 'item') {
        return 0;
    }
    if (word === 'material' || word === 'block'
        || word.startsWith('vanilla_tagged:') || word.startsWith('material_flagged:')
        || data.blocks.has(word)) {
        return 10;
    }
    return fallbackScore(word, precise, data.blocks, [data.items, data.entities]);
}
exports.matchBlock = matchBlock;
/**
 * Type matcher for MaterialTag. (ExtraData.cs:295-298)
 *
 * `Math.max` of the other two, which is why `item` and `block` -- each a hard 0 in one of them --
 * both still score 10 here.
 */
function matchMaterial(data, word, precise) {
    return Math.max(matchBlock(data, word, precise), matchItem(data, word, precise));
}
exports.matchMaterial = matchMaterial;
/** Type matcher for areas. (ExtraData.cs:301-321) */
function matchArea(data, word, precise) {
    if (word === 'area' || word === 'cuboid' || word === 'polygon' || word === 'ellipsoid'
        || word.startsWith('area_flagged:') || word.startsWith('biome:')) {
        return 10;
    }
    // `null` for the own-values: see fallbackScore. There is no enum of areas to verify against,
    // so precise mode answers 2 instead of 7-or-0.
    return fallbackScore(word, precise, null, [data.items, data.blocks, data.entities]);
}
exports.matchArea = matchArea;
/**
 * Type matcher for WorldTag. (ExtraData.cs:325-329)
 *
 * Always 1. World names are server configuration, so there is nothing to check them against; the
 * C# carries a bare `return 1; // TODO: ?` here. Ported as-is, TODO and all: making this stricter
 * would warn on every event mentioning a real world on the user's server.
 */
function matchWorld(_data, _word, _precise) {
    return 1;
}
exports.matchWorld = matchWorld;
/**
 * Validator type data for event matching. (ExtraData.cs:344-356)
 *
 * The four entity aliases are the C#'s: `projectile`, `hanging` and `vehicle` are all checked as
 * plain entities, because the enum data does not distinguish them.
 */
function knownValidatorTypes(data) {
    return new Map([
        ['entity', (w, p) => matchEntity(data, w, p)],
        ['projectile', (w, p) => matchEntity(data, w, p)],
        ['hanging', (w, p) => matchEntity(data, w, p)],
        ['vehicle', (w, p) => matchEntity(data, w, p)],
        ['item', (w, p) => matchItem(data, w, p)],
        ['inventory', (w, p) => matchInventory(data, w, p)],
        ['block', (w, p) => matchBlock(data, w, p)],
        ['material', (w, p) => matchMaterial(data, w, p)],
        ['area', (w, p) => matchArea(data, w, p)],
        ['world', (w, p) => matchWorld(data, w, p)]
    ]);
}
exports.knownValidatorTypes = knownValidatorTypes;
//# sourceMappingURL=eventValidators.js.map