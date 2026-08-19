import { describe, it, expect, beforeEach } from 'vitest';
import { MutedRegions, MuteRange, countNewLines, wholeLineMuteBounds } from './mutedDiagnostics';

function range(sl: number, sc: number, el: number, ec: number): MuteRange {
    return { start: { line: sl, character: sc }, end: { line: el, character: ec } };
}

describe('MutedRegions', () => {
    let regions: MutedRegions;
    beforeEach(() => { regions = new MutedRegions(); });

    it('reports nothing muted in a fresh store', () => {
        expect(regions.covers('a.dsc', range(1, 0, 1, 5))).toBe(false);
        expect(regions.rangesFor('a.dsc')).toEqual([]);
    });

    it('covers a diagnostic wholly inside a muted range', () => {
        regions.mute('a.dsc', range(10, 0, 20, 0));
        expect(regions.covers('a.dsc', range(12, 4, 12, 9))).toBe(true);
    });

    it('covers a diagnostic that merely overlaps the muted range', () => {
        // A squiggle straddling the edge of the selection should still go quiet;
        // half a squiggle is worse than none.
        regions.mute('a.dsc', range(10, 0, 20, 0));
        expect(regions.covers('a.dsc', range(19, 0, 25, 0))).toBe(true);
    });

    it('does not cover a diagnostic outside the muted range', () => {
        regions.mute('a.dsc', range(10, 0, 20, 0));
        expect(regions.covers('a.dsc', range(21, 0, 21, 5))).toBe(false);
    });

    it('keeps each document separate', () => {
        regions.mute('a.dsc', range(10, 0, 20, 0));
        expect(regions.covers('b.dsc', range(12, 0, 12, 5))).toBe(false);
    });

    it('unmutes only the range under the given position, and says whether it hit', () => {
        regions.mute('a.dsc', range(10, 0, 20, 0));
        regions.mute('a.dsc', range(30, 0, 40, 0));
        expect(regions.unmuteAt('a.dsc', { line: 15, character: 0 })).toBe(true);
        expect(regions.covers('a.dsc', range(15, 0, 15, 1))).toBe(false);
        expect(regions.covers('a.dsc', range(35, 0, 35, 1))).toBe(true);
        expect(regions.unmuteAt('a.dsc', { line: 99, character: 0 })).toBe(false);
    });

    it('unmutes every overlapping range at the position, not just the first match', () => {
        // Mute 5-10, then mute 8-15: they overlap at line 9. Unmuting at line 9
        // must clear both, or the diagnostics there stay silenced even though
        // the command reported success.
        regions.mute('a.dsc', range(5, 0, 10, 0));
        regions.mute('a.dsc', range(8, 0, 15, 0));
        expect(regions.unmuteAt('a.dsc', { line: 9, character: 0 })).toBe(true);
        expect(regions.covers('a.dsc', range(9, 0, 9, 1))).toBe(false);
        expect(regions.rangesFor('a.dsc')).toEqual([]);
    });

    it('unmutes every duplicate range at the position when the same selection was muted twice', () => {
        // A repeated keybinding or double click can mute the identical range
        // twice; a single unmuteAt must clear both copies, not leave one behind.
        regions.mute('a.dsc', range(10, 0, 20, 0));
        regions.mute('a.dsc', range(10, 0, 20, 0));
        expect(regions.unmuteAt('a.dsc', { line: 15, character: 0 })).toBe(true);
        expect(regions.covers('a.dsc', range(15, 0, 15, 1))).toBe(false);
        expect(regions.rangesFor('a.dsc')).toEqual([]);
    });

    it('drops every range for a document on unmuteAll', () => {
        regions.mute('a.dsc', range(10, 0, 20, 0));
        regions.unmuteAll('a.dsc');
        expect(regions.rangesFor('a.dsc')).toEqual([]);
    });

    it('drops every range for a document on forget', () => {
        regions.mute('a.dsc', range(10, 0, 20, 0));
        regions.mute('b.dsc', range(1, 0, 2, 0));
        regions.forget('a.dsc');
        expect(regions.rangesFor('a.dsc')).toEqual([]);
        // forget must only clear the given key, not every document.
        expect(regions.rangesFor('b.dsc')).toEqual([range(1, 0, 2, 0)]);
    });

    it('shifts a muted range down when lines are inserted above it', () => {
        // Insert 3 lines at line 2: a mute on 10-20 must become 13-23, or it
        // drifts off the code the user pointed at.
        regions.mute('a.dsc', range(10, 0, 20, 0));
        regions.applyEdit('a.dsc', range(2, 0, 2, 0), 3);
        expect(regions.rangesFor('a.dsc')[0]).toEqual(range(13, 0, 23, 0));
    });

    it('shifts a muted range up when lines are deleted above it', () => {
        regions.mute('a.dsc', range(10, 0, 20, 0));
        regions.applyEdit('a.dsc', range(2, 0, 5, 0), 0);
        expect(regions.rangesFor('a.dsc')[0]).toEqual(range(7, 0, 17, 0));
    });

    it('leaves a muted range alone when the edit is entirely below it', () => {
        regions.mute('a.dsc', range(10, 0, 20, 0));
        regions.applyEdit('a.dsc', range(30, 0, 30, 0), 5);
        expect(regions.rangesFor('a.dsc')[0]).toEqual(range(10, 0, 20, 0));
    });

    it('grows a muted range when lines are inserted inside it', () => {
        regions.mute('a.dsc', range(10, 0, 20, 0));
        regions.applyEdit('a.dsc', range(15, 0, 15, 0), 2);
        expect(regions.rangesFor('a.dsc')[0]).toEqual(range(10, 0, 22, 0));
    });

    it('drops a muted range whose lines were all deleted', () => {
        regions.mute('a.dsc', range(10, 0, 20, 0));
        regions.applyEdit('a.dsc', range(5, 0, 25, 0), 0);
        expect(regions.rangesFor('a.dsc')).toEqual([]);
    });

    it('keeps the surviving tail when an edit overlaps the front of a muted range', () => {
        // Mute 10-20; select 5-15 and delete it. The edit's end (15) lands
        // strictly inside the range, so old lines 15-20 survive the edit and
        // land at 5-10 (delta = 0 - (15-5) = -10). The mute must follow that
        // surviving tail, not vanish, or code the user deliberately silenced
        // would light back up.
        regions.mute('a.dsc', range(10, 0, 20, 0));
        regions.applyEdit('a.dsc', range(5, 0, 15, 0), 0);
        expect(regions.rangesFor('a.dsc')[0]).toEqual(range(5, 0, 10, 0));
    });

    it('still drops a muted range when a front-overlapping edit reaches its end', () => {
        // Same front overlap, but this time the edit's end lands exactly on
        // the range's end: nothing of the muted region survives, so it drops.
        regions.mute('a.dsc', range(10, 0, 20, 0));
        regions.applyEdit('a.dsc', range(5, 0, 20, 0), 0);
        expect(regions.rangesFor('a.dsc')).toEqual([]);
    });

    it('keeps the surviving head when an edit overlaps the back of a muted range', () => {
        // Mute 10-20; select 15-25 and delete it. The edit starts strictly
        // inside the range and its end reaches past the range's end, so old
        // lines 10-14 (before the edit) survive untouched — the mute must
        // truncate to follow them, not vanish.
        regions.mute('a.dsc', range(10, 0, 20, 0));
        regions.applyEdit('a.dsc', range(15, 0, 25, 0), 0);
        expect(regions.rangesFor('a.dsc')[0]).toEqual(range(10, 0, 15, 0));
    });

    it('still drops a muted range when a back-overlapping edit starts exactly at its start', () => {
        // The edit starts exactly at the range's start and reaches past its
        // end: nothing of the muted region survives, so it drops.
        regions.mute('a.dsc', range(10, 0, 20, 0));
        regions.applyEdit('a.dsc', range(10, 0, 25, 0), 0);
        expect(regions.rangesFor('a.dsc')).toEqual([]);
    });

    it('uses the wholly-inside branch (not the back-overlap branch) when an edit ends exactly at the range end', () => {
        // Mute 10-20; edit the range 15-20 (replaced with newLineCount 3). The
        // edit's end lands exactly on the range's end, so it satisfies both the
        // "wholly inside" test (changed.end <= r.end) and the "back-overlap"
        // test (changed.end >= r.end). Whichever branch runs first wins:
        // - wholly-inside (correct): end = r.end.line + delta, where
        //   delta = newLineCount - (changed.end.line - changed.start.line)
        //         = 3 - (20 - 15) = -2, so end = 20 + (-2) = 18.
        // - back-overlap (wrong, if it ran first): end = changed.start.line = 15,
        //   which silently discards newLineCount entirely.
        // This pins the branch order so a future reordering fails loudly
        // instead of only failing in a comment nobody reads.
        regions.mute('a.dsc', range(10, 0, 20, 0));
        regions.applyEdit('a.dsc', range(15, 0, 20, 0), 3);
        expect(regions.rangesFor('a.dsc')[0]).toEqual(range(10, 0, 18, 0));
    });

    it('returns a defensive copy from rangesFor, so mutating it does not affect the store', () => {
        regions.mute('a.dsc', range(10, 0, 20, 0));
        const returned = regions.rangesFor('a.dsc');
        returned.push(range(99, 0, 99, 5));
        expect(regions.rangesFor('a.dsc')).toEqual([range(10, 0, 20, 0)]);
    });
});

describe('countNewLines', () => {
    it('counts no newlines in text that stays on one line', () => {
        expect(countNewLines('')).toBe(0);
        expect(countNewLines('- narrate "hi"')).toBe(0);
    });

    it('counts one newline for a single line break', () => {
        expect(countNewLines('\n')).toBe(1);
        expect(countNewLines('a\nb')).toBe(1);
    });

    it('counts CRLF breaks once each', () => {
        expect(countNewLines('a\r\nb\r\nc')).toBe(2);
    });

    it('feeds applyEdit so that pressing Enter above a mute shifts it exactly one line', () => {
        // The off-by-one guard: this is the exact call shape extension.ts uses,
        // so if countNewLines ever returns "lines spanned" instead of "newlines",
        // this expectation moves to 11-21 and fails.
        const regions = new MutedRegions();
        regions.mute('a.dsc', range(10, 0, 20, 0));
        regions.applyEdit('a.dsc', range(5, 0, 5, 0), countNewLines('\n'));
        expect(regions.rangesFor('a.dsc')[0]).toEqual(range(11, 0, 21, 0));
    });

    it('feeds applyEdit so that a same-line edit does not move a mute at all', () => {
        const regions = new MutedRegions();
        regions.mute('a.dsc', range(10, 0, 20, 0));
        regions.applyEdit('a.dsc', range(5, 4, 5, 4), countNewLines('x'));
        expect(regions.rangesFor('a.dsc')[0]).toEqual(range(10, 0, 20, 0));
    });
});

describe('wholeLineMuteBounds', () => {
    it('keeps an empty selection on its own single line', () => {
        expect(wholeLineMuteBounds(7, 7, 0)).toEqual({ startLine: 7, endLine: 7 });
        expect(wholeLineMuteBounds(7, 7, 12)).toEqual({ startLine: 7, endLine: 7 });
    });

    it('keeps both lines when the selection ends part-way into the last line', () => {
        expect(wholeLineMuteBounds(3, 6, 4)).toEqual({ startLine: 3, endLine: 6 });
    });

    it('drops a trailing line the selection only touches at character 0', () => {
        // What shift+down produces: lines 3 and 4 are selected as 3:0-5:0, but
        // line 5 has no selected text and must not be muted.
        expect(wholeLineMuteBounds(3, 5, 0)).toEqual({ startLine: 3, endLine: 4 });
    });

    it('never collapses a single fully-selected line to nothing', () => {
        expect(wholeLineMuteBounds(3, 4, 0)).toEqual({ startLine: 3, endLine: 3 });
    });
});
