import { describe, it, expect } from 'vitest';
import {
    matchEntity, matchItem, matchInventory, matchBlock, matchMaterial, matchArea, matchWorld,
    knownValidatorTypes, SPECIAL_ENTITY_MATCHABLES, ITEM_COULD_MATCH_PREFIXES, INVENTORY_MATCHERS
} from './eventValidators';
import { createEmptyExtraData, ExtraData } from '../metaDocs/extraData';

/**
 * Derived from SharpDenizenTools/MetaHandlers/ExtraData.cs:150-357.
 *
 * The scores are the point. Each matcher answers a CONFIDENCE, and the three interesting values
 * are not "match" and "no match":
 *   10 certain / 7 verified pattern / 5 unverified pattern / 1 unknown-but-plausible / 0 wrong type
 * A matcher that collapsed 1 and 0 together would either warn on every event naming a custom mob,
 * or stop catching `on player breaks zombie:` -- depending which way it collapsed. So every test
 * below asserts the exact number, never a truthiness.
 */

/** A small stand-in for the real Minecraft enum data, with one value of each type. */
function data(): ExtraData {
    const extra = createEmptyExtraData();
    extra.blocks.add('stone');
    extra.blocks.add('oak_log');
    extra.items.add('stick');
    extra.items.add('oak_sign');
    extra.entities.add('zombie');
    extra.entities.add('cave_spider');
    for (const value of [...extra.blocks, ...extra.items, ...extra.entities]) {
        extra.all.add(value);
        extra.materials.add(value);
    }
    return extra;
}

describe('the hardcoded label sets, transcribed from ExtraData.cs', () => {
    // THESE ARE CONTENT TESTS, and they exist because the behavioural tests below cannot be.
    // Those iterate the set they are checking -- `for (const label of INVENTORY_MATCHERS)` -- so
    // deleting a member deletes its own assertion along with it, and the audit duly reported the
    // deletions as SURVIVED. A transcription list is exactly the kind of thing a port gets subtly
    // wrong, so the lists are written out here by hand from the C# instead.

    it('SPECIAL_ENTITY_MATCHABLES matches ExtraData.cs:151-154 exactly', () => {
        expect([...SPECIAL_ENTITY_MATCHABLES].sort()).toEqual([
            'animal', 'entity', 'fish', 'hanging', 'living', 'mob', 'monster', 'npc', 'player',
            'projectile', 'vehicle'
        ]);
    });

    it('ITEM_COULD_MATCH_PREFIXES matches ExtraData.cs:185-188 exactly', () => {
        expect([...ITEM_COULD_MATCH_PREFIXES].sort()).toEqual([
            'item_enchanted', 'item_flagged', 'material_flagged', 'raw_exact', 'vanilla_tagged'
        ]);
    });

    it('INVENTORY_MATCHERS matches ExtraData.cs:222-234, duplicates collapsed', () => {
        // The C# list repeats `workbench`, `crafting` and `player`; a HashSet swallows them, so 37
        // written entries become 34 distinct ones. Asserting the deduplicated form is the honest
        // comparison -- it is what both languages actually hold.
        expect([...INVENTORY_MATCHERS].sort()).toEqual([
            'anvil', 'barrel', 'beacon', 'blast_furnace', 'brewing', 'cartography', 'chest',
            'composter', 'crafting', 'creative', 'dispenser', 'dropper', 'enchanting',
            'ender_chest', 'enderchest', 'entity', 'furnace', 'generic', 'grindstone', 'hopper',
            'inventory', 'lectern', 'location', 'loom', 'merchant', 'notable', 'note', 'npc',
            'player', 'shulker_box', 'smithing', 'smoker', 'stonecutter', 'workbench'
        ]);
    });

    it('keeps `enderchest` and `ender_chest` as two separate labels', () => {
        // Both are in the C# list, spelled differently, and neither is a typo of the other -- the
        // underscored one is the modern name. A port that "tidied" one away would stop matching
        // whichever spelling the script used.
        expect(INVENTORY_MATCHERS.has('enderchest')).toBe(true);
        expect(INVENTORY_MATCHERS.has('ender_chest')).toBe(true);
    });
});

describe('matchEntity (ExtraData.cs:157-182)', () => {
    it('scores a known entity 10', () => {
        expect(matchEntity(data(), 'zombie', false)).toBe(10);
    });

    it('scores each special label 10 even though none is in the enum data', () => {
        // MUTANT CAUGHT: dropping the SpecialEntityMatchables test -- `player` and `npc` are not
        // Minecraft entity types, so without the set they would fall through to the enum tests.
        const extra = data();
        for (const special of SPECIAL_ENTITY_MATCHABLES) {
            expect(extra.entities.has(special)).toBe(false);
            expect(matchEntity(extra, special, false)).toBe(10);
        }
    });

    it('scores each flag prefix 10', () => {
        // MUTANT CAUGHT: dropping any one of the three prefixes.
        expect(matchEntity(data(), 'entity_flagged:cool', false)).toBe(10);
        expect(matchEntity(data(), 'player_flagged:cool', false)).toBe(10);
        expect(matchEntity(data(), 'npc_flagged:cool', false)).toBe(10);
    });

    it('scores a BLOCK or ITEM name 0 -- known, and known to be the wrong type', () => {
        // This is the whole reason `foreign` exists. MUTANT CAUGHT: returning 1 here, which would
        // make `on entity spawns stone:` pass silently.
        expect(matchEntity(data(), 'stone', false)).toBe(0);
        expect(matchEntity(data(), 'stick', false)).toBe(0);
    });

    it('scores an unrecognized word 1, not 0', () => {
        // Custom mobs from plugins are not in the enum data, and warning on them would be a flood
        // of false positives. MUTANT CAUGHT: `return 1` -> `return 0`.
        expect(matchEntity(data(), 'some_custom_mob', false)).toBe(1);
    });

    it('scores an advanced matcher 5 when loose', () => {
        expect(matchEntity(data(), 'zombie|skeleton', false)).toBe(5);
        expect(matchEntity(data(), '*_spider', false)).toBe(5);
    });

    it('scores an advanced matcher 7 when precise AND it hits a real entity', () => {
        // MUTANT CAUGHT: returning 7 without testing the matcher against the enum.
        expect(matchEntity(data(), '*_spider', true)).toBe(7);
    });

    it('scores an advanced matcher 0 when precise and it hits nothing', () => {
        expect(matchEntity(data(), '*_nonsense', true)).toBe(0);
    });

    it('scores a plain unrecognized word 0 when precise -- 1 is a LOOSE-only answer', () => {
        // The precise branch returns before the `return 1` tail is ever reached.
        // MUTANT CAUGHT: letting precise mode fall through to the loose tail.
        expect(matchEntity(data(), 'some_custom_mob', true)).toBe(0);
        expect(matchEntity(data(), 'some_custom_mob', false)).toBe(1);
    });
});

describe('matchItem (ExtraData.cs:191-219)', () => {
    it('scores a known item 10, and the literals item/potion 10', () => {
        expect(matchItem(data(), 'stick', false)).toBe(10);
        expect(matchItem(data(), 'item', false)).toBe(10);
        expect(matchItem(data(), 'potion', false)).toBe(10);
    });

    it('scores "block" a hard 0, checked BEFORE anything else', () => {
        // ExtraData.cs:193-196. The early return is what stops `<item>` and `<block>` matchers
        // tying on the word `block`.
        // MUTANT CAUGHT: moving the `block` test below the 10-tests, or deleting it.
        expect(matchItem(data(), 'block', false)).toBe(0);
        expect(matchItem(data(), 'block', true)).toBe(0);
    });

    it('scores each item prefix 10, matching on the part BEFORE the colon', () => {
        // MUTANT CAUGHT: testing the whole word instead of before(word, ':').
        for (const prefix of ITEM_COULD_MATCH_PREFIXES) {
            expect(matchItem(data(), prefix + ':anything', false)).toBe(10);
        }
    });

    it('scores a bare prefix with no colon 10, because before() returns the whole word', () => {
        // Relies on Frenetic's `Before` returning the input when the separator is absent -- the
        // exact semantic that two copies of `after` in this port had backwards.
        expect(matchItem(data(), 'raw_exact', false)).toBe(10);
    });

    it('scores a BLOCK or ENTITY name 0', () => {
        expect(matchItem(data(), 'stone', false)).toBe(0);
        expect(matchItem(data(), 'zombie', false)).toBe(0);
    });

    it('verifies a pattern against ITEMS, not blocks, when precise', () => {
        // The pattern has to separate the two sets. `oak_*` hits `oak_sign` (item) AND `oak_log`
        // (block), so it scores 7 either way and proves nothing -- the audit caught exactly that.
        // `*_sign` hits only the item; `*_log` only the block.
        // MUTANT CAUGHT: verifying against data.blocks instead of data.items.
        expect(matchItem(data(), '*_sign', true)).toBe(7);
        expect(matchItem(data(), '*_log', true)).toBe(0);
    });
});

describe('matchBlock (ExtraData.cs:264-292)', () => {
    it('scores "item" a hard 0 -- the mirror of matchItem rejecting "block"', () => {
        expect(matchBlock(data(), 'item', false)).toBe(0);
    });

    it('scores the literals material/block and both flag prefixes 10', () => {
        expect(matchBlock(data(), 'material', false)).toBe(10);
        expect(matchBlock(data(), 'block', false)).toBe(10);
        expect(matchBlock(data(), 'vanilla_tagged:anything', false)).toBe(10);
        expect(matchBlock(data(), 'material_flagged:anything', false)).toBe(10);
    });

    it('scores a known block 10 and an item or entity 0', () => {
        expect(matchBlock(data(), 'stone', false)).toBe(10);
        expect(matchBlock(data(), 'stick', false)).toBe(0);
        expect(matchBlock(data(), 'zombie', false)).toBe(0);
    });
});

describe('matchMaterial (ExtraData.cs:295-298)', () => {
    it('takes the MAX of block and item, so both "item" and "block" score 10', () => {
        // Each is a hard 0 in one of the two, and 10 in the other. Math.max is what makes a
        // material matcher accept both.
        // MUTANT CAUGHT: Math.max -> Math.min, which would score both of these 0.
        expect(matchMaterial(data(), 'item', false)).toBe(10);
        expect(matchMaterial(data(), 'block', false)).toBe(10);
    });

    it('accepts both a block and an item name', () => {
        expect(matchMaterial(data(), 'stone', false)).toBe(10);
        expect(matchMaterial(data(), 'stick', false)).toBe(10);
    });

    it('still scores an entity name 0', () => {
        // An entity is foreign to BOTH halves, so the max of two zeroes is zero.
        expect(matchMaterial(data(), 'zombie', false)).toBe(0);
    });
});

describe('matchInventory (ExtraData.cs:237-261)', () => {
    it('scores every label in the set 10, plus the flag prefix', () => {
        for (const label of INVENTORY_MATCHERS) {
            expect(matchInventory(data(), label, false)).toBe(10);
        }
        expect(matchInventory(data(), 'inventory_flagged:cool', false)).toBe(10);
    });

    it('verifies a pattern against the LABEL SET, not the enum data', () => {
        // The one matcher whose "own values" are a hardcoded list rather than game data.
        // MUTANT CAUGHT: verifying against data.items or data.blocks.
        expect(matchInventory(data(), 'ender_*', true)).toBe(7);
        expect(matchInventory(data(), 'oak_*', true)).toBe(0);
    });

    it('scores a block, item or entity name 0', () => {
        expect(matchInventory(data(), 'stone', false)).toBe(0);
        expect(matchInventory(data(), 'stick', false)).toBe(0);
        expect(matchInventory(data(), 'zombie', false)).toBe(0);
    });
});

describe('matchArea (ExtraData.cs:301-321)', () => {
    it('scores the four literals and both prefixes 10', () => {
        for (const word of ['area', 'cuboid', 'polygon', 'ellipsoid']) {
            expect(matchArea(data(), word, false)).toBe(10);
        }
        expect(matchArea(data(), 'area_flagged:cool', false)).toBe(10);
        expect(matchArea(data(), 'biome:plains', false)).toBe(10);
    });

    it('scores a pattern 2 when precise -- NOT 7 and not 0', () => {
        // ExtraData.cs:308-311. There is no enum of known areas, so nothing can be verified; the
        // C# answers a weak-but-nonzero 2 so an area pattern is never reported wrong.
        // MUTANT CAUGHT: reusing the 7-or-0 shape of the other matchers here.
        expect(matchArea(data(), 'my_region_*', true)).toBe(2);
        expect(matchArea(data(), 'totally_nonexistent_*', true)).toBe(2);
    });

    it('scores a plain unknown word 1 loose and 0 precise', () => {
        expect(matchArea(data(), 'my_region', false)).toBe(1);
        expect(matchArea(data(), 'my_region', true)).toBe(0);
    });

    it('scores an item, block or entity name 0', () => {
        expect(matchArea(data(), 'stone', false)).toBe(0);
        expect(matchArea(data(), 'stick', false)).toBe(0);
        expect(matchArea(data(), 'zombie', false)).toBe(0);
    });
});

describe('matchWorld (ExtraData.cs:325-329)', () => {
    it('always answers 1, for anything, in either mode', () => {
        // World names are server configuration; there is nothing to check them against. The C#
        // carries a bare `return 1; // TODO: ?`.
        // MUTANT CAUGHT: making this stricter -- it would warn on every event naming a real world.
        for (const word of ['world', 'my_survival_world', 'stone', 'zombie', '*_nether', '']) {
            expect(matchWorld(data(), word, false)).toBe(1);
            expect(matchWorld(data(), word, true)).toBe(1);
        }
    });
});

describe('knownValidatorTypes (ExtraData.cs:344-356)', () => {
    it('registers exactly the ten names the C# does', () => {
        // MUTANT CAUGHT: adding or dropping a name. An unregistered type name makes every
        // could-matcher using it fail to build, which silently disables those events.
        expect([...knownValidatorTypes(data()).keys()].sort()).toEqual([
            'area', 'block', 'entity', 'hanging', 'inventory', 'item', 'material', 'projectile', 'vehicle', 'world'
        ]);
    });

    it('aliases projectile, hanging and vehicle to the ENTITY matcher', () => {
        // The enum data does not distinguish them, so the C# points all four at MatchEntity.
        // MUTANT CAUGHT: pointing any of them at a different matcher.
        const types = knownValidatorTypes(data());
        for (const alias of ['projectile', 'hanging', 'vehicle']) {
            expect(types.get(alias)!('zombie', false)).toBe(10);
            expect(types.get(alias)!('stone', false)).toBe(0);
        }
    });

    it('points "material" at matchMaterial, not at either half of it', () => {
        // `block` and `item` are each a hard 0 in one half and 10 in the other, so they are the
        // only words that tell the three apart.
        // MUTANT CAUGHT: ['material', matchItem] or ['material', matchBlock].
        const material = knownValidatorTypes(data()).get('material')!;
        expect(material('block', false)).toBe(10);
        expect(material('item', false)).toBe(10);
    });

    it('closes over the data it was given', () => {
        // The validators are built once per docs load and must see that load's enum data.
        const extra = createEmptyExtraData();
        const types = knownValidatorTypes(extra);
        expect(types.get('entity')!('zombie', false)).toBe(1);
        extra.entities.add('zombie');
        expect(types.get('entity')!('zombie', false)).toBe(10);
    });
});
