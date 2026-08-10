import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseFlatFds, buildExtraData, createEmptyExtraData, loadExtraData } from './extraData';

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
        expect(data.loadErrors).toEqual([]);
    });
});

describe('loadExtraData caching', () => {
    let tmpDir: string;
    let cacheFile: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-extradata-cache-'));
        cacheFile = path.join(tmpDir, 'minecraft-cache.fds');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('downloads and writes the cache file when none exists', async () => {
        const downloadSpy = vi.fn(async () => Buffer.from(SAMPLE, 'utf8'));
        const data = await loadExtraData({ cacheFile, ttlMs: 1000 * 60, downloadFn: downloadSpy });
        expect(downloadSpy).toHaveBeenCalledTimes(1);
        expect(data.sounds.has('block.stone.step')).toBe(true);
        expect(fs.existsSync(cacheFile)).toBe(true);
    });

    it('reuses the cache file within the TTL window instead of downloading again', async () => {
        fs.writeFileSync(cacheFile, SAMPLE);
        const downloadSpy = vi.fn(async () => Buffer.from(SAMPLE, 'utf8'));
        const data = await loadExtraData({ cacheFile, ttlMs: 1000 * 60 * 60, downloadFn: downloadSpy });
        expect(downloadSpy).not.toHaveBeenCalled();
        expect(data.sounds.has('block.stone.step')).toBe(true);
    });

    it('re-downloads when the cache file is older than the TTL', async () => {
        fs.writeFileSync(cacheFile, 'biomes:\n- STALE\n');
        const oldTime = new Date(Date.now() - 1000 * 60 * 60 * 24);
        fs.utimesSync(cacheFile, oldTime, oldTime);
        const downloadSpy = vi.fn(async () => Buffer.from('biomes:\n- FRESH\n', 'utf8'));
        const data = await loadExtraData({ cacheFile, ttlMs: 1000 * 60, downloadFn: downloadSpy });
        expect(downloadSpy).toHaveBeenCalledTimes(1);
        expect(data.biomes.has('fresh')).toBe(true);
        expect(data.biomes.has('stale')).toBe(false);
    });

    it('yields empty sets and a recorded load error when the download rejects', async () => {
        const downloadSpy = vi.fn(async () => { throw new Error('network down'); });
        const data = await loadExtraData({ cacheFile, ttlMs: 1000 * 60, downloadFn: downloadSpy });
        expect(data.sounds.size).toBe(0);
        expect(data.all.size).toBe(0);
        expect(data.loadErrors.length).toBeGreaterThan(0);
        expect(data.loadErrors.some(e => e.includes('network down'))).toBe(true);
    });

    it('does not write a cache file when the downloaded document parses to nothing', async () => {
        const downloadSpy = vi.fn(async () => Buffer.from('garbage without a colon or dash\n', 'utf8'));
        const data = await loadExtraData({ cacheFile, ttlMs: 1000 * 60, downloadFn: downloadSpy });
        expect(downloadSpy).toHaveBeenCalledTimes(1);
        expect(data.all.size).toBe(0);
        expect(fs.existsSync(cacheFile)).toBe(false);
    });
});
