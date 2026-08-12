import { describe, it, expect } from 'vitest';
import { findEnumCompleters, COMMAND_VALUE_COMPLETERS, findKeyLineCompleter } from './argumentCompleters';
import { buildExtraData, parseFlatFds } from '../metaDocs/extraData';

const DATA = buildExtraData(parseFlatFds([
    'sounds:', '- BLOCK.STONE.STEP',
    'blocks:', '- STONE',
    'items:', '- STICK',
    'entities:', '- ZOMBIE',
    'particles:', '- FLAME',
    'effects:', '- SMOKE',
    'potion_effects:', '- SPEED',
    'statistics:', '- JUMP',
    ''
].join('\n')));

describe('findEnumCompleters', () => {
    it('matches playsound on its sound prefix', () => {
        const completers = findEnumCompleters('playsound', 'sound');
        expect(completers).toHaveLength(1);
        expect(completers[0].label).toBe('Sound Enum');
        expect(completers[0].values(DATA).has('block.stone.step')).toBe(true);
    });

    it('matches modifyblock on its empty prefix', () => {
        const completers = findEnumCompleters('modifyblock', '');
        expect(completers).toHaveLength(1);
        expect(completers[0].values(DATA).has('stone')).toBe(true);
    });

    it('matches cast on potion effects', () => {
        const completers = findEnumCompleters('cast', '');
        expect(completers).toHaveLength(1);
        expect(completers[0].values(DATA).has('speed')).toBe(true);
    });

    it('matches statistic', () => {
        const completers = findEnumCompleters('statistic', '');
        expect(completers).toHaveLength(1);
        expect(completers[0].values(DATA).has('jump')).toBe(true);
    });

    it('returns an empty array for a command with no registered completer', () => {
        expect(findEnumCompleters('narrate', '')).toEqual([]);
    });

    it('returns an empty array when the prefix does not match a registered one', () => {
        expect(findEnumCompleters('playsound', 'volume')).toEqual([]);
    });

    it('is keyed by lowercase command name', () => {
        expect(findEnumCompleters('PLAYSOUND', 'sound')).toHaveLength(1);
    });

    it('keeps block materials for modifyblock even though C# loses them to a registration collision', () => {
        const completers = findEnumCompleters('modifyblock', '');
        expect(completers).toHaveLength(1);
        expect(completers[0].values(DATA).has('stone')).toBe(true);
    });
});

describe('COMMAND_VALUE_COMPLETERS', () => {
    it('registers every command the C# ByCommand table backs with ExtraData', () => {
        for (const name of ['modifyblock', 'showfake', 'playeffect', 'playsound', 'cast', 'statistic']) {
            expect(COMMAND_VALUE_COMPLETERS.has(name)).toBe(true);
        }
    });
});

describe('findKeyLineCompleter', () => {
    it('maps material to items, matching the C# LinePrefixCompleters table', () => {
        expect(findKeyLineCompleter('material')!.values(DATA).has('stick')).toBe(true);
    });

    it('maps entity_type to entities', () => {
        expect(findKeyLineCompleter('entity_type')!.values(DATA).has('zombie')).toBe(true);
    });

    it('is case-insensitive and tolerates surrounding whitespace on the key', () => {
        expect(findKeyLineCompleter('  MATERIAL ')).not.toBeNull();
    });

    it('returns null for an unregistered key', () => {
        expect(findKeyLineCompleter('title')).toBeNull();
    });
});
