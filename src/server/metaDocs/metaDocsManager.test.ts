import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildMetaDocs, applyExtensions, loadMetaDocs, DEFAULT_META_SOURCES } from './metaDocsManager';
import type { MetaBlock } from './metaLoader';

describe('DEFAULT_META_SOURCES', () => {
    it('points at the real Denizen source repos, not a nonexistent meta.zip', () => {
        expect(DEFAULT_META_SOURCES).toContain('https://github.com/DenizenScript/Denizen/archive/dev.zip');
        expect(DEFAULT_META_SOURCES).toContain('https://github.com/DenizenScript/Denizen-Core/archive/master.zip');
        expect(DEFAULT_META_SOURCES.some(s => s.includes('meta.zip'))).toBe(false);
    });
});

describe('buildMetaDocs', () => {
    it('constructs a populated MetaDocs from parsed blocks', () => {
        const blocks: MetaBlock[] = [
            { objectType: 'command', url: 'src#L1', data: ['@Name narrate', '@Short x', '@end_meta'] },
            { objectType: 'tag', url: 'src#L2', data: ['@attribute <PlayerTag.name>', '@returns ElementTag', '@end_meta'] }
        ];
        const docs = buildMetaDocs(blocks);
        expect(docs.commands.get('narrate')).toBeDefined();
        expect(docs.tags.get('playertag.name')).toBeDefined();
        expect(docs.loadErrors).toEqual([]);
    });

    it('collects errors for unparsable blocks without throwing', () => {
        const blocks: MetaBlock[] = [
            { objectType: 'not_a_type', url: 'src#L1', data: ['@Name x', '@end_meta'] }
        ];
        const docs = buildMetaDocs(blocks);
        expect(docs.loadErrors.length).toBe(1);
    });
});

describe('applyExtensions', () => {
    it('merges an extension block onto its target object', () => {
        const blocks: MetaBlock[] = [
            { objectType: 'command', url: 'src#L1', data: ['@Name narrate', '@Short original', '@end_meta'] },
            { objectType: 'extension', url: 'src#L2', data: ['@target_type command', '@target_name narrate', '@name narrate ext', '@Short extended', '@end_meta'] }
        ];
        const docs = buildMetaDocs(blocks);
        applyExtensions(docs);
        expect(docs.commands.get('narrate')!.short).toBe('original\n\nextended');
    });

    it('records an error when the extension target type is unknown', () => {
        const blocks: MetaBlock[] = [
            { objectType: 'extension', url: 'src#L1', data: ['@target_type not_a_type', '@target_name x', '@name ext', '@end_meta'] }
        ];
        const docs = buildMetaDocs(blocks);
        applyExtensions(docs);
        expect(docs.loadErrors.some(e => e.includes('invalid target meta type'))).toBe(true);
    });

    it('records an error when the extension target name does not exist', () => {
        const blocks: MetaBlock[] = [
            { objectType: 'extension', url: 'src#L1', data: ['@target_type command', '@target_name does_not_exist', '@name ext', '@end_meta'] }
        ];
        const docs = buildMetaDocs(blocks);
        applyExtensions(docs);
        expect(docs.loadErrors.some(e => e.includes('invalid target meta name'))).toBe(true);
    });
});

describe('loadMetaDocs caching', () => {
    let tmpDir: string;
    let cacheFile: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-meta-cache-'));
        cacheFile = path.join(tmpDir, 'meta-blocks-cache.json');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('downloads and writes the cache file when none exists', async () => {
        const fakeBlocks: MetaBlock[] = [{ objectType: 'command', url: 's#L1', data: ['@Name foo', '@end_meta'] }];
        const downloadSpy = vi.fn(async () => ({ blocks: fakeBlocks, loadErrors: [] as string[] }));
        const docs = await loadMetaDocs({ cacheFile, ttlMs: 1000 * 60, sources: ['https://example.com/x.zip'], downloadFn: downloadSpy });
        expect(downloadSpy).toHaveBeenCalledTimes(1);
        expect(docs.commands.get('foo')).toBeDefined();
        expect(fs.existsSync(cacheFile)).toBe(true);
    });

    it('reuses the cache file within the TTL window instead of downloading again', async () => {
        const fakeBlocks: MetaBlock[] = [{ objectType: 'command', url: 's#L1', data: ['@Name foo', '@end_meta'] }];
        fs.writeFileSync(cacheFile, JSON.stringify(fakeBlocks));
        const downloadSpy = vi.fn(async () => ({ blocks: [] as MetaBlock[], loadErrors: [] as string[] }));
        const docs = await loadMetaDocs({ cacheFile, ttlMs: 1000 * 60 * 60, sources: ['https://example.com/x.zip'], downloadFn: downloadSpy });
        expect(downloadSpy).not.toHaveBeenCalled();
        expect(docs.commands.get('foo')).toBeDefined();
    });

    it('re-downloads when the cache file is older than the TTL', async () => {
        fs.writeFileSync(cacheFile, JSON.stringify([]));
        const oldTime = new Date(Date.now() - 1000 * 60 * 60 * 24);
        fs.utimesSync(cacheFile, oldTime, oldTime);
        const fakeBlocks: MetaBlock[] = [{ objectType: 'command', url: 's#L1', data: ['@Name fresh', '@end_meta'] }];
        const downloadSpy = vi.fn(async () => ({ blocks: fakeBlocks, loadErrors: [] as string[] }));
        const docs = await loadMetaDocs({ cacheFile, ttlMs: 1000 * 60, sources: ['https://example.com/x.zip'], downloadFn: downloadSpy });
        expect(downloadSpy).toHaveBeenCalledTimes(1);
        expect(docs.commands.get('fresh')).toBeDefined();
    });

    it('re-downloads when forceRefresh is true even if the cache is fresh', async () => {
        fs.writeFileSync(cacheFile, JSON.stringify([]));
        const fakeBlocks: MetaBlock[] = [{ objectType: 'command', url: 's#L1', data: ['@Name forced', '@end_meta'] }];
        const downloadSpy = vi.fn(async () => ({ blocks: fakeBlocks, loadErrors: [] as string[] }));
        const docs = await loadMetaDocs({ cacheFile, ttlMs: 1000 * 60 * 60, forceRefresh: true, sources: ['https://example.com/x.zip'], downloadFn: downloadSpy });
        expect(downloadSpy).toHaveBeenCalledTimes(1);
        expect(docs.commands.get('forced')).toBeDefined();
    });

    it('does not write a cache file when every download source fails (empty blocks)', async () => {
        const downloadSpy = vi.fn(async () => ({ blocks: [] as MetaBlock[], loadErrors: ['Source download error for https://example.com/x.zip: network down'] }));
        const docs = await loadMetaDocs({ cacheFile, ttlMs: 1000 * 60, sources: ['https://example.com/x.zip'], downloadFn: downloadSpy });
        expect(downloadSpy).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(cacheFile)).toBe(false);
        expect(docs.loadErrors.some(e => e.includes('network down'))).toBe(true);
    });
});
