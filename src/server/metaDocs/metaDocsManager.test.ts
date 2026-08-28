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

    it('does NOT cache a download in which a source failed to fetch', async () => {
        // THE BUG THIS GATE DIED OF, hit while running the verify scripts on 2026-08-28. Sources
        // are fetched in parallel, so one failing still leaves the others' blocks -- and the old
        // `blocks.length > 0` gate happily wrote that fraction to disk, where the TTL then served
        // it for twelve hours. The caches written during that wobble held 536 tags instead of
        // 2493: completion went near-empty and the checker called 87% of real command lines
        // unknown commands.
        // MUTANT CAUGHT: dropping the failedSources half of the condition.
        const partial: MetaBlock[] = [{ objectType: 'command', url: 's#L1', data: ['@Name foo', '@end_meta'] }];
        const downloadSpy = vi.fn(async () => ({
            blocks: partial,
            loadErrors: ['Source download error for https://example.com/b.zip: socket hang up'],
            failedSources: ['https://example.com/b.zip']
        }));
        const docs = await loadMetaDocs({
            cacheFile, ttlMs: 1000 * 60,
            sources: ['https://example.com/a.zip', 'https://example.com/b.zip'],
            downloadFn: downloadSpy
        });
        // The half that arrived is still SERVED -- degrading to nothing would be worse than
        // degrading to less -- it is only the persisting that is refused.
        expect(docs.commands.get('foo')).toBeDefined();
        expect(fs.existsSync(cacheFile)).toBe(false);
    });

    it('caches a download whose sources all fetched but one had a PARSE complaint', async () => {
        // `loadErrors` mixes fetch failures with parse complaints from sources that downloaded
        // perfectly well. Gating on it would mean never caching at all the moment upstream meta
        // contains one malformed block, turning every editor start into a full re-download.
        // MUTANT CAUGHT: gating on `loadErrors.length === 0` instead of `failedSources`.
        const blocks: MetaBlock[] = [{ objectType: 'command', url: 's#L1', data: ['@Name foo', '@end_meta'] }];
        const downloadSpy = vi.fn(async () => ({
            blocks,
            loadErrors: ['While processing s#L2 found unknown meta type "nonsense".'],
            failedSources: [] as string[]
        }));
        await loadMetaDocs({ cacheFile, ttlMs: 1000 * 60, sources: ['https://example.com/a.zip'], downloadFn: downloadSpy });
        expect(fs.existsSync(cacheFile)).toBe(true);
    });

    it('treats a stub that omits failedSources as "everything fetched"', async () => {
        // The field is optional so an injected fake need not simulate the network, and every other
        // caching test in this file relies on that reading -- an absent field must mean "no
        // failures", not "unknown, so refuse to cache".
        // MUTANT CAUGHT: `result.failedSources.length === 0` without the `?? []`, which throws; or
        // treating undefined as a failure, which would silently stop the cache ever being written.
        const blocks: MetaBlock[] = [{ objectType: 'command', url: 's#L1', data: ['@Name foo', '@end_meta'] }];
        const downloadSpy = vi.fn(async () => ({ blocks, loadErrors: [] as string[] }));
        await loadMetaDocs({ cacheFile, ttlMs: 1000 * 60, sources: ['https://example.com/a.zip'], downloadFn: downloadSpy });
        expect(fs.existsSync(cacheFile)).toBe(true);
    });

    it('reuses the cache file within the TTL window instead of downloading again', async () => {
        // The cache records the source list it was built from, so the fixture has to as well.
        const fakeBlocks: MetaBlock[] = [{ objectType: 'command', url: 's#L1', data: ['@Name foo', '@end_meta'] }];
        fs.writeFileSync(cacheFile, JSON.stringify({ sources: ['https://example.com/x.zip'], blocks: fakeBlocks }));
        const downloadSpy = vi.fn(async () => ({ blocks: [] as MetaBlock[], loadErrors: [] as string[] }));
        const docs = await loadMetaDocs({ cacheFile, ttlMs: 1000 * 60 * 60, sources: ['https://example.com/x.zip'], downloadFn: downloadSpy });
        expect(downloadSpy).not.toHaveBeenCalled();
        expect(docs.commands.get('foo')).toBeDefined();
    });

    it('re-downloads when an extra source was ADDED, even inside the TTL', async () => {
        // THE BUG THIS SETTING DIED OF, reported by the user 2026-08-27 as
        // "extra_source doesn't work". The cache used to be identified by file path and age
        // alone, so adding a URL to `denizenscript.server.extra_sources` changed nothing at all
        // until the 12-hour TTL happened to lapse.
        // MUTANT: drop the sameSources check, or make it always return true.
        const cachedBlocks: MetaBlock[] = [{ objectType: 'command', url: 's#L1', data: ['@Name stale', '@end_meta'] }];
        fs.writeFileSync(cacheFile, JSON.stringify({ sources: ['https://example.com/x.zip'], blocks: cachedBlocks }));
        const fresh: MetaBlock[] = [{ objectType: 'command', url: 's#L1', data: ['@Name from_extra', '@end_meta'] }];
        const downloadSpy = vi.fn(async () => ({ blocks: fresh, loadErrors: [] as string[] }));
        const docs = await loadMetaDocs({
            cacheFile, ttlMs: 1000 * 60 * 60,
            sources: ['https://example.com/x.zip', 'https://example.com/denizenm.zip'],
            downloadFn: downloadSpy
        });
        expect(downloadSpy).toHaveBeenCalledWith(['https://example.com/x.zip', 'https://example.com/denizenm.zip']);
        expect(docs.commands.get('from_extra')).toBeDefined();
        expect(docs.commands.get('stale')).toBeUndefined();
    });

    it('re-downloads when an extra source was REMOVED, even inside the TTL', async () => {
        // The other direction, and the one a length-only check would miss in reverse: a stale
        // cache must not keep serving a source the user just deleted.
        // MUTANT: compare only `cached.sources.length`.
        const cachedBlocks: MetaBlock[] = [{ objectType: 'command', url: 's#L1', data: ['@Name from_extra', '@end_meta'] }];
        fs.writeFileSync(cacheFile, JSON.stringify({ sources: ['https://example.com/x.zip', 'https://example.com/extra.zip'], blocks: cachedBlocks }));
        const fresh: MetaBlock[] = [{ objectType: 'command', url: 's#L1', data: ['@Name official_only', '@end_meta'] }];
        const downloadSpy = vi.fn(async () => ({ blocks: fresh, loadErrors: [] as string[] }));
        const docs = await loadMetaDocs({ cacheFile, ttlMs: 1000 * 60 * 60, sources: ['https://example.com/x.zip'], downloadFn: downloadSpy });
        expect(downloadSpy).toHaveBeenCalledTimes(1);
        expect(docs.commands.get('official_only')).toBeDefined();
    });

    it('re-downloads when the same sources are listed in a different order', async () => {
        // MUTANT: compare the two lists as sets. Order IS significant -- downloadAllBlocks merges
        // archives in the order given and later blocks can override earlier ones, so the same
        // URLs in a different order are a different result, not the same one.
        const cachedBlocks: MetaBlock[] = [{ objectType: 'command', url: 's#L1', data: ['@Name cached_order', '@end_meta'] }];
        fs.writeFileSync(cacheFile, JSON.stringify({ sources: ['https://example.com/a.zip', 'https://example.com/b.zip'], blocks: cachedBlocks }));
        const downloadSpy = vi.fn(async () => ({ blocks: [{ objectType: 'command', url: 's#L1', data: ['@Name new_order', '@end_meta'] }] as MetaBlock[], loadErrors: [] as string[] }));
        const docs = await loadMetaDocs({ cacheFile, ttlMs: 1000 * 60 * 60, sources: ['https://example.com/b.zip', 'https://example.com/a.zip'], downloadFn: downloadSpy });
        expect(downloadSpy).toHaveBeenCalledTimes(1);
        expect(docs.commands.get('new_order')).toBeDefined();
    });

    it('treats a pre-2026-08-27 bare-array cache file as a miss', async () => {
        // The old format carries no source list, so it cannot be shown to match. One extra
        // download on first upgrade is the correct price; silently trusting it is not.
        // MUTANT: accept an array-shaped cache as matching.
        fs.writeFileSync(cacheFile, JSON.stringify([{ objectType: 'command', url: 's#L1', data: ['@Name old_format', '@end_meta'] }]));
        const downloadSpy = vi.fn(async () => ({ blocks: [{ objectType: 'command', url: 's#L1', data: ['@Name refreshed', '@end_meta'] }] as MetaBlock[], loadErrors: [] as string[] }));
        const docs = await loadMetaDocs({ cacheFile, ttlMs: 1000 * 60 * 60, sources: ['https://example.com/x.zip'], downloadFn: downloadSpy });
        expect(downloadSpy).toHaveBeenCalledTimes(1);
        expect(docs.commands.get('refreshed')).toBeDefined();
    });

    it('writes the source list into the cache it creates', async () => {
        // MUTANT: keep writing a bare array. Then every run after the first is a cache miss and
        // the extension re-downloads all meta on every window reload.
        const downloadSpy = vi.fn(async () => ({ blocks: [{ objectType: 'command', url: 's#L1', data: ['@Name foo', '@end_meta'] }] as MetaBlock[], loadErrors: [] as string[] }));
        await loadMetaDocs({ cacheFile, ttlMs: 1000 * 60 * 60, sources: ['https://example.com/x.zip'], downloadFn: downloadSpy });
        expect(JSON.parse(fs.readFileSync(cacheFile, 'utf-8')).sources).toEqual(['https://example.com/x.zip']);
        // And the file it just wrote must be accepted on the next load, or the cache is useless.
        const second = vi.fn(async () => ({ blocks: [] as MetaBlock[], loadErrors: [] as string[] }));
        const docs = await loadMetaDocs({ cacheFile, ttlMs: 1000 * 60 * 60, sources: ['https://example.com/x.zip'], downloadFn: second });
        expect(second).not.toHaveBeenCalled();
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
