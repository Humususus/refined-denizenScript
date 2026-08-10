import { describe, it, expect } from 'vitest';
import { parseFlatFds, buildExtraData, createEmptyExtraData } from './extraData';

const SAMPLE = [
    'biomes:',
    '- BADLANDS',
    '- BEACH',
    'sounds:',
    '- BLOCK.STONE.STEP',
    '- AMBIENT.CAVE',
    'blocks:',
    '- STONE',
    'items:',
    '- STICK',
    '- STONE',
    ''
].join('\n');

describe('parseFlatFds', () => {
    it('groups list entries under their preceding key', () => {
        const sections = parseFlatFds(SAMPLE);
        expect(sections.get('biomes')).toEqual(['BADLANDS', 'BEACH']);
        expect(sections.get('sounds')).toEqual(['BLOCK.STONE.STEP', 'AMBIENT.CAVE']);
    });

    it('ignores blank lines and stray text', () => {
        const sections = parseFlatFds('biomes:\n- BEACH\n\ngarbage without a dash\n- PLAINS\n');
        expect(sections.get('biomes')).toEqual(['BEACH', 'PLAINS']);
    });

    it('returns an empty map for empty input', () => {
        expect(parseFlatFds('').size).toBe(0);
    });

    it('handles CRLF line endings', () => {
        const sections = parseFlatFds('biomes:\r\n- BEACH\r\n');
        expect(sections.get('biomes')).toEqual(['BEACH']);
    });
});

describe('buildExtraData', () => {
    it('lowercases every value, matching the C# GetDataSet behaviour', () => {
        const data = buildExtraData(parseFlatFds(SAMPLE));
        expect(data.sounds.has('block.stone.step')).toBe(true);
        expect(data.sounds.has('BLOCK.STONE.STEP')).toBe(false);
    });

    it('derives materials as the union of blocks and items', () => {
        const data = buildExtraData(parseFlatFds(SAMPLE));
        expect([...data.materials].sort()).toEqual(['stick', 'stone']);
    });

    it('collects every value into `all`', () => {
        const data = buildExtraData(parseFlatFds(SAMPLE));
        expect(data.all.has('badlands')).toBe(true);
        expect(data.all.has('ambient.cave')).toBe(true);
    });

    it('yields empty sets for sections the document omits', () => {
        const data = buildExtraData(parseFlatFds('biomes:\n- BEACH\n'));
        expect(data.sounds.size).toBe(0);
        expect(data.statistics.size).toBe(0);
    });
});

describe('createEmptyExtraData', () => {
    it('produces every set empty', () => {
        const data = createEmptyExtraData();
        expect(data.sounds.size).toBe(0);
        expect(data.materials.size).toBe(0);
        expect(data.all.size).toBe(0);
    });
});
