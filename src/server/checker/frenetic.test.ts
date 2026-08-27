import { describe, it, expect } from 'vitest';
import { toLowerFast, before, after, beforeAndAfter } from './frenetic';

/**
 * These four helpers are the FreneticUtilities string extensions that SharpDenizenTools leans on
 * everywhere. Verified against FreneticExtensions/StringExtensions.cs upstream, since the package
 * is a NuGet reference rather than vendored source.
 *
 * Every one of them had multiple copies in this port before consolidation, and two of those copies
 * disagreed with the original. The tests below are aimed squarely at the cases where a plausible
 * reimplementation goes wrong: the fold's alphabet, and what the splitters do when the separator
 * is not there at all.
 */

describe('toLowerFast', () => {
    it('lowercases A-Z', () => {
        expect(toLowerFast('ABC_def')).toBe('abc_def');
    });

    it('leaves every non-ASCII letter exactly as it was', () => {
        // The entire reason this is not toLowerCase(). Denizen's own comparisons are ASCII folds,
        // so a Unicode fold here would silently rewrite non-English identifiers.
        // MUTANT CAUGHT: /[A-Z]/g -> a Unicode-aware fold.
        expect(toLowerFast('МойТаск')).toBe('МойТаск');
        expect(toLowerFast('ΟΝΟΜΑ')).toBe('ΟΝΟΜΑ');
    });

    it('folds the ASCII half of a mixed-script string and only that half', () => {
        expect(toLowerFast('МойTASK')).toBe('Мойtask');
    });

    it('leaves the Turkish dotted I as plain ASCII I', () => {
        // toLocaleLowerCase('tr') would give 'ı' here. MUTANT CAUGHT: any locale-aware fold.
        expect(toLowerFast('TASKI')).toBe('taski');
    });
});

describe('before / after / beforeAndAfter (StringExtensions.cs)', () => {
    it('splits on the FIRST occurrence, not the last', () => {
        // MUTANT CAUGHT: indexOf -> lastIndexOf (i.e. porting BeforeLast/AfterLast by mistake).
        expect(before('a:b:c', ':')).toBe('a');
        expect(after('a:b:c', ':')).toBe('b:c');
        expect(beforeAndAfter('a:b:c', ':')).toEqual(['a', 'b:c']);
    });

    it('drops the separator itself from both halves', () => {
        expect(beforeAndAfter('key:value', ':')).toEqual(['key', 'value']);
    });

    it('handles a multi-character separator by its full length', () => {
        // MUTANT CAUGHT: `index + 1` instead of `index + match.length`, which is the difference
        // between the char and string overloads in the C#.
        expect(after('a<->b', '<->')).toBe('b');
        expect(beforeAndAfter('a<->b', '<->')).toEqual(['a', 'b']);
    });

    it('returns the WHOLE INPUT from before() when the separator is absent', () => {
        expect(before('novalue', ':')).toBe('novalue');
    });

    it('returns the WHOLE INPUT from after() when the separator is absent', () => {
        // THE ONE THAT WAS WRONG. Two of the five copies this replaced returned '' here. Upstream:
        //     int index = input.IndexOf(match, StringComparison.Ordinal);
        //     if (index < 0) { return input; }
        // It never bit, because all five call sites in this port guard with a startsWith that
        // guarantees the separator is present -- but the next caller is the one that would not.
        // MUTANT CAUGHT: `index < 0 ? '' : ...`.
        expect(after('novalue', ':')).toBe('novalue');
    });

    it('returns [input, ""] from beforeAndAfter() when the separator is absent', () => {
        // The deliberate asymmetry with after(): upstream assigns `after = ""` in this branch and
        // returns `input`. So beforeAndAfter's second half is NOT the same as calling after().
        // MUTANT CAUGHT: making the two agree "for consistency", either direction.
        expect(beforeAndAfter('novalue', ':')).toEqual(['novalue', '']);
        expect(after('novalue', ':')).not.toBe(beforeAndAfter('novalue', ':')[1]);
    });

    it('treats a separator at position 0 as a real split, not as absent', () => {
        // `index < 0` is the not-found test, NOT `!index` or `index <= 0`.
        // MUTANT CAUGHT: `index < 0` -> `index <= 0` or a falsy check.
        expect(before(':value', ':')).toBe('');
        expect(after(':value', ':')).toBe('value');
        expect(beforeAndAfter(':value', ':')).toEqual(['', 'value']);
    });

    it('treats a separator at the end as a real split with an empty tail', () => {
        expect(before('key:', ':')).toBe('key');
        expect(after('key:', ':')).toBe('');
        expect(beforeAndAfter('key:', ':')).toEqual(['key', '']);
    });
});
