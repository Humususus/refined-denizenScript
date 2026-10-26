import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildMetaDocs, applyExtensions, loadMetaDocs, cacheFileFor, DEFAULT_META_SOURCES, FetchResult } from './metaDocsManager';
import type { MetaBlock } from './metaLoader';

describe('DEFAULT_META_SOURCES', () => {
    it('points at the real Denizen source repos, not a nonexistent meta.zip', () => {
        expect(DEFAULT_META_SOURCES).toContain('https://github.com/DenizenScript/Denizen/archive/dev.zip');
        expect(DEFAULT_META_SOURCES).toContain('https://github.com/DenizenScript/Denizen-Core/archive/master.zip');
        expect(DEFAULT_META_SOURCES.some(s => s.includes('meta.zip'))).toBe(false);
    });
});

/**
 * Extra sources OVERRIDING the official meta, reported 2026-09-03.
 *
 * `effectiveSources` puts the add-ons and the user's own sources after the official ones precisely so a fork can
 * redefine a command or tag. That rests on two things: registration being last-wins, and the block
 * order being the SOURCE order. The second was not true -- see the note on `loadMetaDocs`.
 */
describe('later sources override earlier ones', () => {
    it('registers the LAST block of a duplicated name, for commands and tags alike', () => {
        // MUTANT CAUGHT: registering only the first, or skipping a name already present.
        const docs = buildMetaDocs([
            { objectType: 'command', url: 'official#L1', data: ['@Name narrate', '@Short official', '@end_meta'] },
            { objectType: 'tag', url: 'official#L2', data: ['@attribute <PlayerTag.name>', '@returns ElementTag', '@description official', '@end_meta'] },
            { objectType: 'command', url: 'fork#L1', data: ['@Name narrate', '@Short forked', '@end_meta'] },
            { objectType: 'tag', url: 'fork#L2', data: ['@attribute <PlayerTag.name>', '@returns ElementTag', '@description forked', '@end_meta'] }
        ]);
        expect(docs.commands.get('narrate')!.short).toBe('forked');
        expect(docs.tags.get('playertag.name')!.description).toContain('forked');
    });

    it('keeps one entry per name rather than accumulating duplicates', () => {
        const docs = buildMetaDocs([
            { objectType: 'command', url: 'a#L1', data: ['@Name narrate', '@Short one', '@end_meta'] },
            { objectType: 'command', url: 'b#L1', data: ['@Name narrate', '@Short two', '@end_meta'] }
        ]);
        expect(docs.commands.size).toBe(1);
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

/**
 * The per-source cache (2.8.0). Each source has its own file, revalidated on every load with the
 * archive's ETag: a 304 keeps the cached blocks, a 200 replaces them, a network failure keeps them.
 *
 * WHY: the 2.7.0 cache was one file for the whole source list, reused for 12 hours. An add-on its
 * author updated within that window was not fetched again when VS Code restarted -- the user's
 * report "add-ons don't update after a restart" (spec 5b). The invariants the old tests pinned are
 * ported below, each where it still applies.
 */
describe('loadMetaDocs per-source cache', () => {
    let cacheDir: string;
    const A = 'https://example.com/a.zip';
    const B = 'https://example.com/b.zip';

    /** A real zip holding one .java file that documents the given commands. */
    function archive(...commands: string[]): Buffer {
        const zip = new AdmZip();
        const java = commands.map(c => `// <--[command]\n// @Name ${c}\n// @Short s\n// -->\n`).join('');
        zip.addFile('src/Meta.java', Buffer.from(java, 'utf-8'));
        return zip.toBuffer();
    }
    const ok = (data: Buffer, etag: string | null = '"e1"'): FetchResult => ({ status: 'ok', data, etag });
    const writeCache = (url: string, blocks: MetaBlock[], extra: Record<string, unknown> = {}) => {
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(cacheFileFor(cacheDir, url), JSON.stringify({ version: 3, url, etag: '"e0"', blocks, ...extra }));
    };
    const cmd = (name: string): MetaBlock => ({ objectType: 'command', url: `s#${name}`, data: [`@Name ${name}`, '@end_meta'] });

    beforeEach(() => {
        cacheDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-meta-cache-')), 'meta-sources');
    });
    afterEach(() => {
        fs.rmSync(path.dirname(cacheDir), { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('downloads every source and writes one cache file per source', async () => {
        const fetchFn = vi.fn(async (url: string) => ok(archive(url === A ? 'alpha' : 'beta')));
        const { docs, status } = await loadMetaDocs({ cacheDir, sources: [A, B], fetchFn });
        expect(docs.commands.get('alpha')).toBeDefined();
        expect(docs.commands.get('beta')).toBeDefined();
        expect(status.map(s => s.state)).toEqual(['downloaded', 'downloaded']);
        expect(fs.existsSync(cacheFileFor(cacheDir, A))).toBe(true);
        expect(fs.existsSync(cacheFileFor(cacheDir, B))).toBe(true);
    });

    it('stamps version, URL and ETag into the file it writes', async () => {
        await loadMetaDocs({ cacheDir, sources: [A], fetchFn: async () => ok(archive('alpha'), '"tag-7"') });
        const written = JSON.parse(fs.readFileSync(cacheFileFor(cacheDir, A), 'utf-8'));
        expect(written).toMatchObject({ version: 3, url: A, etag: '"tag-7"' });
        expect(written.blocks.length).toBe(1);
    });

    // The fix for "add-ons don't update after a restart": every load asks the server.
    it('revalidates a cached source with its ETag and keeps the blocks on a 304', async () => {
        writeCache(A, [cmd('cached')]);
        const before = fs.statSync(cacheFileFor(cacheDir, A)).mtimeMs;
        const fetchFn = vi.fn(async (): Promise<FetchResult> => ({ status: 'not-modified' }));
        const { docs, status } = await loadMetaDocs({ cacheDir, sources: [A], fetchFn });
        expect(fetchFn).toHaveBeenCalledWith(A, '"e0"');
        expect(docs.commands.get('cached')).toBeDefined();
        expect(status[0].state).toBe('unchanged');
        expect(fs.statSync(cacheFileFor(cacheDir, A)).mtimeMs).toBe(before);
    });

    it('replaces the cached blocks when the archive changed', async () => {
        writeCache(A, [cmd('stale')]);
        const { docs, status } = await loadMetaDocs({ cacheDir, sources: [A], fetchFn: async () => ok(archive('fresh'), '"e2"') });
        expect(docs.commands.get('fresh')).toBeDefined();
        expect(docs.commands.get('stale')).toBeUndefined();
        expect(status[0].state).toBe('downloaded');
        expect(JSON.parse(fs.readFileSync(cacheFileFor(cacheDir, A), 'utf-8')).etag).toBe('"e2"');
    });

    // Ported from 2026-08-28 ("everything is broken" while the CDN dropped TLS): old-but-complete
    // meta beats none.
    it('serves the cached blocks when the network fails, and says so', async () => {
        writeCache(A, [cmd('cached')]);
        const before = fs.statSync(cacheFileFor(cacheDir, A)).mtimeMs;
        const { docs, status } = await loadMetaDocs({ cacheDir, sources: [A], fetchFn: async () => { throw new Error('socket hang up'); } });
        expect(docs.commands.get('cached')).toBeDefined();
        expect(status[0].state).toBe('cached-offline');
        expect(docs.loadErrors.some(e => e.startsWith(`Using cached meta for ${A}`) && e.includes('socket hang up'))).toBe(true);
        // Not re-stamped: the next load must still try the network.
        expect(fs.statSync(cacheFileFor(cacheDir, A)).mtimeMs).toBe(before);
    });

    // Ported from 2026-08-28: a partial download must not become a cache. Per source, a failed
    // source writes nothing while the others are cached and served.
    it('a source that fails with no cache is reported, contributes nothing, and writes nothing', async () => {
        const fetchFn = async (url: string) => { if (url === B) { throw new Error('network down'); } return ok(archive('alpha')); };
        const { docs, status } = await loadMetaDocs({ cacheDir, sources: [A, B], fetchFn });
        expect(docs.commands.get('alpha')).toBeDefined();
        expect(status.map(s => s.state)).toEqual(['downloaded', 'failed']);
        expect(fs.existsSync(cacheFileFor(cacheDir, B))).toBe(false);
        expect(docs.loadErrors.some(e => e.startsWith(`Source download error for ${B}`) && e.includes('network down'))).toBe(true);
    });

    it('caches a source that downloaded but had a parse complaint', async () => {
        const zip = new AdmZip();
        zip.addFile('src/Meta.java', Buffer.from('// <--[command]\n// @Name alpha\n// -->\n// <--[nonsense]\n// @Name x\n// -->\n', 'utf-8'));
        const { docs } = await loadMetaDocs({ cacheDir, sources: [A], fetchFn: async () => ok(zip.toBuffer()) });
        expect(docs.loadErrors.length).toBeGreaterThan(0);
        expect(fs.existsSync(cacheFileFor(cacheDir, A))).toBe(true);
    });

    // Spec anti-goal: a disabled source is still downloaded.
    it('never fetches a source that is not in the list, even with its cache file present', async () => {
        writeCache(B, [cmd('disabled')]);
        const fetchFn = vi.fn(async () => ok(archive('alpha')));
        const { docs } = await loadMetaDocs({ cacheDir, sources: [A], fetchFn });
        expect(fetchFn.mock.calls.map(c => c[0])).toEqual([A]);
        expect(docs.commands.get('disabled')).toBeUndefined();
    });

    it('fetches without an ETag when forced', async () => {
        writeCache(A, [cmd('cached')]);
        const fetchFn = vi.fn(async () => ok(archive('forced')));
        const { docs } = await loadMetaDocs({ cacheDir, sources: [A], forceRefresh: true, fetchFn });
        expect(fetchFn).toHaveBeenCalledWith(A, null);
        expect(docs.commands.get('forced')).toBeDefined();
    });

    // Ported from the version-2 bump: a file this code did not write in this format is not used.
    it('treats another version, another URL or a corrupt file as no cache, without throwing', async () => {
        const fail = async (): Promise<FetchResult> => { throw new Error('offline'); };
        writeCache(A, [cmd('v2')], { version: 2 });
        expect((await loadMetaDocs({ cacheDir, sources: [A], fetchFn: fail })).status[0].state).toBe('failed');
        writeCache(A, [cmd('other')], { url: 'https://example.com/OTHER.zip' });
        expect((await loadMetaDocs({ cacheDir, sources: [A], fetchFn: fail })).docs.commands.get('other')).toBeUndefined();
        fs.writeFileSync(cacheFileFor(cacheDir, A), '{"version":3,"blocks":[{"objec');
        const corrupt = await loadMetaDocs({ cacheDir, sources: [A], fetchFn: fail });
        expect(corrupt.status[0].state).toBe('failed');
        expect(corrupt.docs.commands.size).toBe(0);
    });

    it('asks without an ETag when the cache has none, and treats a 304 without a cache as a failure', async () => {
        writeCache(A, [cmd('cached')], { etag: null });
        const fetchFn = vi.fn(async () => ok(archive('alpha')));
        await loadMetaDocs({ cacheDir, sources: [A], fetchFn });
        expect(fetchFn).toHaveBeenCalledWith(A, null);
        const { status } = await loadMetaDocs({ cacheDir, sources: [B], fetchFn: async () => ({ status: 'not-modified' }) });
        expect(status[0].state).toBe('failed');
    });

    // Ported from downloadOrder.test.ts (2026-09-03): registration is last-wins, so the blocks must
    // come back in SOURCE order, whichever download finishes first.
    it('returns blocks in source order even when the last source downloads first', async () => {
        const fetchFn = async (url: string) => {
            if (url === A) {
                await new Promise(r => setTimeout(r, 30));
                return ok(archive('narrate'));
            }
            const zip = new AdmZip();
            zip.addFile('src/Fork.java', Buffer.from('// <--[command]\n// @Name narrate\n// @Short forked\n// -->\n', 'utf-8'));
            return ok(zip.toBuffer());
        };
        const { docs, status } = await loadMetaDocs({ cacheDir, sources: [A, B], fetchFn });
        expect(docs.commands.get('narrate')!.short).toBe('forked');
        expect(status.map(s => s.url)).toEqual([A, B]);
    });

    it('leaves the 2.7.0 single-file cache alone', async () => {
        const old = path.join(path.dirname(cacheDir), 'meta-blocks-cache.json');
        fs.writeFileSync(old, JSON.stringify({ version: 2, sources: [A], blocks: [cmd('legacy')] }));
        const { docs } = await loadMetaDocs({ cacheDir, sources: [A], fetchFn: async () => ok(archive('alpha')) });
        expect(docs.commands.get('legacy')).toBeUndefined();
        expect(fs.existsSync(old)).toBe(true);
    });

    // Final review I3: a read-only LOCALAPPDATA or a full disk made every source "failed" and left
    // the editor with no meta, though every download had succeeded.
    it('serves a download even when its cache file cannot be written', async () => {
        fs.writeFileSync(cacheDir, 'a file where the cache directory should be');
        const { docs, status } = await loadMetaDocs({ cacheDir, sources: [A], fetchFn: async () => ok(archive('alpha')) });
        expect(docs.commands.get('alpha')).toBeDefined();
        expect(status[0].state).toBe('downloaded');
        expect(docs.loadErrors.some(e => e.startsWith(`Could not cache meta for ${A}`))).toBe(true);
    });

    it('counts each source\'s blocks in its status', async () => {
        const { status } = await loadMetaDocs({ cacheDir, sources: [A], fetchFn: async () => ok(archive('one', 'two')) });
        expect(status[0]).toEqual({ url: A, state: 'downloaded', blocks: 2 });
    });
});
