import { describe, it, expect } from 'vitest';
import { findTagAtCursor } from './tagContext';

describe('findTagAtCursor', () => {
    it('finds a bare partial tag right after the opening <', () => {
        // "<pla": '<' at 0, tag text "pla" starts at column 1.
        const ctx = findTagAtCursor('<pla', 0)!;
        expect(ctx.tagSoFar).toBe('pla');
        expect(ctx.tagStart).toBe(1);
        expect(ctx.componentCount).toBe(0);
        expect(ctx.lastComponent).toBe('pla');
        expect(ctx.lastComponentStart).toBe(1);
    });

    it('counts a trailing dot as one component with an empty last component', () => {
        // "<player.": dot at column 7 (0-based), lastComponent starts right after it, at 8.
        const ctx = findTagAtCursor('<player.', 0)!;
        expect(ctx.tagSoFar).toBe('player.');
        expect(ctx.tagStart).toBe(1);
        expect(ctx.componentCount).toBe(1);
        expect(ctx.lastComponent).toBe('');
        expect(ctx.lastComponentStart).toBe(8);
    });

    it('reports the partial text typed after the dot, honoring a nonzero argStart', () => {
        // "<player.na" with argStart=5: tag starts at column 5+1=6, "na" starts at 6+7=13.
        const ctx = findTagAtCursor('<player.na', 5)!;
        expect(ctx.tagSoFar).toBe('player.na');
        expect(ctx.tagStart).toBe(6);
        expect(ctx.componentCount).toBe(1);
        expect(ctx.lastComponent).toBe('na');
        expect(ctx.lastComponentStart).toBe(13);
    });

    it('does not count a dot inside a [...] parameter as a top-level dot', () => {
        // "<player.flag[a].ex": the '.' inside "[a]" must not count; only the two dots
        // outside brackets (after "player" and after "flag[a]") do.
        const ctx = findTagAtCursor('<player.flag[a].ex', 0)!;
        expect(ctx.tagSoFar).toBe('player.flag[a].ex');
        expect(ctx.tagStart).toBe(1);
        expect(ctx.componentCount).toBe(2);
        expect(ctx.lastComponent).toBe('ex');
        expect(ctx.lastComponentStart).toBe(16);
    });

    it('does not let a nested tag inside a parameter affect the dot count', () => {
        // "<player.flag[<[d]>].ex": the nested "<[d]>" (and the '.' it could contain,
        // though this one has none) must not perturb component counting.
        const ctx = findTagAtCursor('<player.flag[<[d]>].ex', 0)!;
        expect(ctx.tagSoFar).toBe('player.flag[<[d]>].ex');
        expect(ctx.tagStart).toBe(1);
        expect(ctx.componentCount).toBe(2);
        expect(ctx.lastComponent).toBe('ex');
        expect(ctx.lastComponentStart).toBe(20);
    });

    it('accounts for text preceding the tag when computing tagStart', () => {
        // "narrate <player.na": the '<' sits at column 8, so tag text starts at 9,
        // and "na" (after the dot) starts at 9+7=16.
        const ctx = findTagAtCursor('narrate <player.na', 0)!;
        expect(ctx.tagSoFar).toBe('player.na');
        expect(ctx.tagStart).toBe(9);
        expect(ctx.componentCount).toBe(1);
        expect(ctx.lastComponent).toBe('na');
        expect(ctx.lastComponentStart).toBe(16);
    });

    it('returns null when the tag is already closed before the cursor', () => {
        expect(findTagAtCursor('<player.name>', 0)).toBeNull();
    });

    it('returns null when there is no tag at all', () => {
        expect(findTagAtCursor('plain', 0)).toBeNull();
    });

    it('resolves to the innermost unclosed tag when tags are nested', () => {
        // "<player.flag[<serv": the outer '<' at 0 is still open, but the inner '<' at
        // 13 is nearer the cursor and also unclosed, so it wins.
        const ctx = findTagAtCursor('<player.flag[<serv', 0)!;
        expect(ctx.tagSoFar).toBe('serv');
        expect(ctx.tagStart).toBe(14);
        expect(ctx.componentCount).toBe(0);
        expect(ctx.lastComponent).toBe('serv');
        expect(ctx.lastComponentStart).toBe(14);
    });
});
