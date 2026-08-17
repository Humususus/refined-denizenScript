import { describe, it, expect } from 'vitest';
import { findTagAtCursor } from './tagContext';

describe('findTagAtCursor', () => {
    // The most common real keystroke in this feature: the user has just typed '<' and
    // nothing else. Derived by hand from tagContext.ts: pass 1 sees '<' at index 0 with
    // unclosedGreaterThans still 0, so relevantTagStart = 0 + 1 = 1; tagSoFar =
    // argThusFar.substring(1) = '' and tagStart = argStart + 1 = 1. Pass 2 never enters
    // its loop (tagSoFar is empty), leaving componentCount 0 and lastDot 0, so
    // lastComponent = ''.substring(0) = '' and lastComponentStart = tagStart + 0 = 1.
    // A null here (or a tagStart of 0) would mean typing '<' offers nothing at all.
    it('returns an empty base component for a bare "<" with nothing typed after it', () => {
        const ctx = findTagAtCursor('<', 0)!;
        expect(ctx).not.toBeNull();
        expect(ctx.tagSoFar).toBe('');
        expect(ctx.tagStart).toBe(1);
        expect(ctx.componentCount).toBe(0);
        expect(ctx.lastComponent).toBe('');
        expect(ctx.lastComponentStart).toBe(1);
    });

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

    it('has a [...] parameter with no dot inside it, alongside the two real top-level dots', () => {
        // "<player.flag[a].ex": "[a]" happens to contain no '.', so this case alone does
        // not exercise the squareBrackets guard on the dot condition — see the next test
        // for that. It still pins that the two dots outside any brackets (after "player"
        // and after "flag[a]") are the only ones counted.
        const ctx = findTagAtCursor('<player.flag[a].ex', 0)!;
        expect(ctx.tagSoFar).toBe('player.flag[a].ex');
        expect(ctx.tagStart).toBe(1);
        expect(ctx.componentCount).toBe(2);
        expect(ctx.lastComponent).toBe('ex');
        expect(ctx.lastComponentStart).toBe(16);
    });

    it('does not count a dot inside a [...] parameter as a top-level dot', () => {
        // "<player.flag[a.b].ex": the '.' inside "[a.b]" (tagSoFar index 13) must not
        // count; only the two dots outside brackets, after "player" (tagSoFar index 6)
        // and after "flag[a.b]" (tagSoFar index 16, giving lastDot 17), do.
        const ctx = findTagAtCursor('<player.flag[a.b].ex', 0)!;
        expect(ctx.tagSoFar).toBe('player.flag[a.b].ex');
        expect(ctx.tagStart).toBe(1);
        expect(ctx.componentCount).toBe(2);
        expect(ctx.lastComponent).toBe('ex');
        expect(ctx.lastComponentStart).toBe(18);
    });

    it('has a nested tag with no dot inside it, alongside the two real top-level dots', () => {
        // "<player.flag[<[d]>].ex": the nested "<[d]>" happens to contain no '.', so this
        // case alone does not exercise the subTags guard on the dot condition — see the
        // next test for that.
        const ctx = findTagAtCursor('<player.flag[<[d]>].ex', 0)!;
        expect(ctx.tagSoFar).toBe('player.flag[<[d]>].ex');
        expect(ctx.tagStart).toBe(1);
        expect(ctx.componentCount).toBe(2);
        expect(ctx.lastComponent).toBe('ex');
        expect(ctx.lastComponentStart).toBe(20);
    });

    it('does not count a dot inside a nested tag as a top-level dot', () => {
        // "<player.flag[<player.name>].ex": the '.' inside the nested "<player.name>"
        // (tagSoFar index 19) must not count; only the two dots outside any nesting,
        // after "player" (tagSoFar index 6) and after "flag[<player.name>]" (tagSoFar
        // index 26, giving lastDot 27), do.
        //
        // NOTE: because this nested tag also happens to sit inside "[...]", this case
        // alone cannot distinguish the subTags guard from the squareBrackets guard —
        // squareBrackets stays nonzero for that entire span regardless of subTags, so it
        // alone would still suppress the dot at index 19 even if subTags tracking were
        // deleted. Confirmed by mutation testing (see task-3-report.md's fix section):
        // deleting the subTags increment/decrement does NOT make this test fail. The
        // next test exists specifically to isolate the subTags guard.
        const ctx = findTagAtCursor('<player.flag[<player.name>].ex', 0)!;
        expect(ctx.tagSoFar).toBe('player.flag[<player.name>].ex');
        expect(ctx.tagStart).toBe(1);
        expect(ctx.componentCount).toBe(2);
        expect(ctx.lastComponent).toBe('ex');
        expect(ctx.lastComponentStart).toBe(28);
    });

    it('does not count a dot inside a nested tag that is not itself bracket-wrapped', () => {
        // "<player.<a.b>.x": unlike the previous case, this nested "<a.b>" is NOT
        // inside "[...]", so squareBrackets is 0 for its whole span — only the subTags
        // guard suppresses the '.' inside it (tagSoFar index 9). This isolates the
        // subTags guard from squareBrackets: with subTags tracking removed, this dot
        // would wrongly count (componentCount 3 instead of 2). Two dots are genuinely
        // top-level: after "player" (tagSoFar index 6) and after "<a.b>" (tagSoFar
        // index 12, giving lastDot 13).
        const ctx = findTagAtCursor('<player.<a.b>.x', 0)!;
        expect(ctx.tagSoFar).toBe('player.<a.b>.x');
        expect(ctx.tagStart).toBe(1);
        expect(ctx.componentCount).toBe(2);
        expect(ctx.lastComponent).toBe('x');
        expect(ctx.lastComponentStart).toBe(14);
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
