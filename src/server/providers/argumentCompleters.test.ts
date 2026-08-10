import { describe, it, expect } from 'vitest';
import { findEnumCompleter, COMMAND_VALUE_COMPLETERS } from './argumentCompleters';
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

describe('findEnumCompleter', () => {
    it('matches playsound on its sound prefix', () => {
        const completer = findEnumCompleter('playsound', 'sound')!;
        expect(completer.label).toBe('Sound Enum');
        expect(completer.values(DATA).has('block.stone.step')).toBe(true);
    });

    it('matches modifyblock on its empty prefix', () => {
        const completer = findEnumCompleter('modifyblock', '')!;
        expect(completer.values(DATA).has('stone')).toBe(true);
    });

    it('matches cast on potion effects', () => {
        expect(findEnumCompleter('cast', '')!.values(DATA).has('speed')).toBe(true);
    });

    it('matches statistic', () => {
        expect(findEnumCompleter('statistic', '')!.values(DATA).has('jump')).toBe(true);
    });

    it('returns null for a command with no registered completer', () => {
        expect(findEnumCompleter('narrate', '')).toBeNull();
    });

    it('returns null when the prefix does not match a registered one', () => {
        expect(findEnumCompleter('playsound', 'volume')).toBeNull();
    });

    it('is keyed by lowercase command name', () => {
        expect(findEnumCompleter('PLAYSOUND', 'sound')).not.toBeNull();
    });

    it('keeps block materials for modifyblock even though C# loses them to a registration collision', () => {
        const completer = findEnumCompleter('modifyblock', '')!;
        expect(completer.values(DATA).has('stone')).toBe(true);
    });
});

describe('COMMAND_VALUE_COMPLETERS', () => {
    it('registers every command the C# ByCommand table backs with ExtraData', () => {
        for (const name of ['modifyblock', 'showfake', 'playeffect', 'playsound', 'cast', 'statistic']) {
            expect(COMMAND_VALUE_COMPLETERS.has(name)).toBe(true);
        }
    });
});
