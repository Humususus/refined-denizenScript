import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `downloadAllBlocks` must return blocks in SOURCE order, not in download-completion order.
 *
 * This lives in its own file because it mocks `./metaLoader`, and a module mock applies to the
 * whole file -- metaDocsManager.test.ts drives the real parser and must keep doing so.
 *
 * WHY IT MATTERS. Registration is last-wins, and `combineSources` puts the user's `extra_sources`
 * after the official ones so a fork can override a command it redefines. Pushing each archive's
 * blocks as it arrived made that depend on which download finished first: the same configuration
 * would override the official meta or not, according to the network. Reported 2026-09-03.
 */

const downloadBinary = vi.fn();
const extractJavaCommentLines = vi.fn();
const extractMetaBlocks = vi.fn();

vi.mock('./metaLoader', () => ({
    downloadBinary: (...args: unknown[]) => downloadBinary(...args),
    extractJavaCommentLines: (...args: unknown[]) => extractJavaCommentLines(...args),
    extractMetaBlocks: (...args: unknown[]) => extractMetaBlocks(...args)
}));

const { downloadAllBlocks } = await import('./metaDocsManager');

/** Resolves after `ms`, so a later source can be made to finish first. */
const after = <T>(ms: number, value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), ms));

beforeEach(() => {
    downloadBinary.mockReset();
    extractJavaCommentLines.mockReset();
    extractMetaBlocks.mockReset();
    extractJavaCommentLines.mockImplementation((data: Buffer) => [String(data)]);
    // One block per source, named after it, so the returned order is readable.
    extractMetaBlocks.mockImplementation((src: string, lines: string[]) =>
        [{ objectType: 'command', url: `${src}#L1`, data: [`@Name ${lines[0]}`, '@end_meta'] }]);
});

describe('downloadAllBlocks ordering', () => {
    it('returns blocks in source order even when the LAST source downloads first', async () => {
        // The failure this pins: `official` is slow, `fork` is instant. Pushed on completion, the
        // fork's blocks would land first and the official meta would then override THEM -- the
        // exact opposite of what the source order asks for.
        // MUTANT CAUGHT: appending inside the Promise.all callback.
        downloadBinary.mockImplementation((src: string) =>
            src === 'official' ? after(30, 'official') : Promise.resolve('fork'));
        const result = await downloadAllBlocks(['official', 'fork']);
        expect(result.blocks.map(b => b.url)).toEqual(['official#L1', 'fork#L1']);
    });

    it('holds the order across several sources finishing out of sequence', async () => {
        const delays: Record<string, number> = { a: 40, b: 0, c: 20, d: 10 };
        downloadBinary.mockImplementation((src: string) => after(delays[src], src));
        const result = await downloadAllBlocks(['a', 'b', 'c', 'd']);
        expect(result.blocks.map(b => b.url)).toEqual(['a#L1', 'b#L1', 'c#L1', 'd#L1']);
    });

    it('keeps the order when a middle source fails outright', async () => {
        downloadBinary.mockImplementation((src: string) =>
            src === 'b' ? Promise.reject(new Error('socket hang up')) : after(src === 'a' ? 20 : 0, src));
        const result = await downloadAllBlocks(['a', 'b', 'c']);
        expect(result.blocks.map(b => b.url)).toEqual(['a#L1', 'c#L1']);
        expect(result.failedSources).toEqual(['b']);
    });

    it('reports failures and errors in source order too, so a re-run reads identically', async () => {
        // Not correctness, but a report whose line order changes between runs is a report nobody
        // can diff.
        downloadBinary.mockImplementation((src: string) =>
            src === 'a' ? after(30, 'a').then(() => Promise.reject(new Error('slow failure')))
                : Promise.reject(new Error('fast failure')));
        const result = await downloadAllBlocks(['a', 'b']);
        expect(result.failedSources).toEqual(['a', 'b']);
        expect(result.loadErrors[0]).toContain('for a');
        expect(result.loadErrors[1]).toContain('for b');
    });

    it('collects parse complaints per source without losing any', async () => {
        downloadBinary.mockImplementation((src: string) => Promise.resolve(src));
        extractMetaBlocks.mockImplementation((src: string, _lines: string[], errors: string[]) => {
            errors.push(`complaint from ${src}`);
            return [{ objectType: 'command', url: `${src}#L1`, data: [`@Name ${src}`, '@end_meta'] }];
        });
        const result = await downloadAllBlocks(['a', 'b']);
        expect(result.loadErrors).toEqual(['complaint from a', 'complaint from b']);
        // A parse complaint is not a fetch failure, so the result is still complete.
        expect(result.failedSources).toEqual([]);
    });
});
