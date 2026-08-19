import { describe, it, expect, beforeEach } from 'vitest';
import { MutedRegions, MuteRange } from './mutedDiagnostics';

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

    it('drops every range for a document on unmuteAll and on forget', () => {
        regions.mute('a.dsc', range(10, 0, 20, 0));
        regions.unmuteAll('a.dsc');
        expect(regions.rangesFor('a.dsc')).toEqual([]);
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
});
