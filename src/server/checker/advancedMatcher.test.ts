import { describe, it, expect } from 'vitest';
import {
    isAdvancedMatchable,
    createMatcher,
    AlwaysMatchHelper,
    ExactMatchHelper,
    PrefixAsteriskMatchHelper,
    PostfixAsteriskMatchHelper,
    MultipleAsteriskMatchHelper,
    RegexMatchHelper,
    MultipleMatchesHelper,
    InverseMatchHelper
} from './advancedMatcher';

/**
 * Every expectation here was hand-derived by reading
 * SharpDenizenTools/ScriptAnalysis/AdvancedMatcher.cs (192 lines, ported in full).
 *
 * This is a replica of the matcher language Denizen accepts wherever a single name would do --
 * `stone|dirt`, `*_log`, `!armor_stand`, `regex:...`. Nothing above it can be trusted if the
 * dispatch in `createMatcher` picks the wrong shape, so the dispatch gets tested shape by shape
 * as well as behaviour by behaviour.
 */

describe('isAdvancedMatchable (AdvancedMatcher.cs:138-141)', () => {
    it('accepts each of the four markers on its own', () => {
        // The whole predicate is one four-way `||`. Each arm gets a case so that deleting any one
        // of them fails a test rather than merely narrowing behaviour somewhere downstream.
        // MUTANT CAUGHT: dropping any single arm of the disjunction.
        expect(isAdvancedMatchable('regex:abc')).toBe(true);
        expect(isAdvancedMatchable('stone|dirt')).toBe(true);
        expect(isAdvancedMatchable('*_log')).toBe(true);
        expect(isAdvancedMatchable('!stone')).toBe(true);
    });

    it('rejects a plain word', () => {
        // MUTANT CAUGHT: `return true` -- this predicate SILENCES checks when it says true, so a
        // matcher that always claims "advanced" would make every event validator answer "plausible"
        // for every word and quietly switch off event checking altogether.
        expect(isAdvancedMatchable('stone')).toBe(false);
    });

    it('requires "regex:" at the START, not merely present', () => {
        // C#: `input.StartsWith("regex:")`, not Contains.
        // MUTANT CAUGHT: startsWith -> includes.
        expect(isAdvancedMatchable('myregex:abc')).toBe(false);
    });

    it('requires "!" at the START, but "|" and "*" anywhere', () => {
        // The asymmetry is real in the C#: StartsWithFast('!') vs Contains('|') / Contains('*').
        // MUTANT CAUGHT: making `!` a Contains, or `|`/`*` a StartsWith.
        expect(isAdvancedMatchable('stone!')).toBe(false);
        expect(isAdvancedMatchable('a|b')).toBe(true);
        expect(isAdvancedMatchable('a*b')).toBe(true);
    });
});

describe('createMatcher dispatch (AdvancedMatcher.cs:144-190)', () => {
    it('picks exact for a plain word', () => {
        expect(createMatcher('stone')).toBeInstanceOf(ExactMatchHelper);
    });

    it('picks always for a lone asterisk', () => {
        // AdvancedMatcher.cs:168-171. Reached only inside the "has an asterisk" branch, so the
        // `input.Length == 1` test can only ever be true for `*` itself.
        expect(createMatcher('*')).toBeInstanceOf(AlwaysMatchHelper);
    });

    it('picks prefix-asterisk for a single leading asterisk', () => {
        expect(createMatcher('*_log')).toBeInstanceOf(PrefixAsteriskMatchHelper);
    });

    it('picks postfix-asterisk for a single trailing asterisk', () => {
        expect(createMatcher('oak_*')).toBeInstanceOf(PostfixAsteriskMatchHelper);
    });

    it('picks multiple-asterisk for asterisks at BOTH ends', () => {
        // The ordering trap: `*a*` satisfies "starts with an asterisk", but not "and no other
        // asterisk", so it falls through the prefix case; it is not caught by the postfix case
        // either, since the FIRST asterisk is at index 0, not at the end.
        // MUTANT CAUGHT: dropping the `input.IndexOf('*', 1) == -1` half of the prefix condition,
        // which would make `*a*` a prefix matcher for `a*`.
        expect(createMatcher('*log*')).toBeInstanceOf(MultipleAsteriskMatchHelper);
    });

    it('picks multiple-asterisk for an asterisk in the middle', () => {
        expect(createMatcher('a*c')).toBeInstanceOf(MultipleAsteriskMatchHelper);
    });

    it('picks alternation for a pipe', () => {
        expect(createMatcher('stone|dirt')).toBeInstanceOf(MultipleMatchesHelper);
    });

    it('picks regex for a "regex:" prefix', () => {
        expect(createMatcher('regex:st.ne')).toBeInstanceOf(RegexMatchHelper);
    });

    it('picks inverse for a leading "!"', () => {
        expect(createMatcher('!stone')).toBeInstanceOf(InverseMatchHelper);
    });

    it('strips "!" BEFORE splitting on "|", so !a|b is not-(a or b)', () => {
        // Branch order is the specification. If `|` were tested first, `!a|b` would parse as
        // "(not a) or b" -- which matches `b`, the exact opposite of the intent.
        // MUTANT CAUGHT: moving the `|` branch above the `!` branch.
        const matcher = createMatcher('!stone|dirt');
        expect(matcher).toBeInstanceOf(InverseMatchHelper);
        expect(matcher.doesMatch('dirt')).toBe(false);
        expect(matcher.doesMatch('stone')).toBe(false);
        expect(matcher.doesMatch('sand')).toBe(true);
    });

    it('treats "regex:" as outranking "|" and "*" inside the pattern', () => {
        // A regex almost always contains an alternation or a quantifier; splitting it on those
        // would shred it. MUTANT CAUGHT: moving the `|` or `*` branch above the regex branch.
        const matcher = createMatcher('regex:stone|dirt');
        expect(matcher).toBeInstanceOf(RegexMatchHelper);
        expect(matcher.doesMatch('dirt')).toBe(true);
    });
});

describe('MatchHelper behaviour', () => {
    it('exact matches case-insensitively, both sides', () => {
        // C# folds the stored text at construction AND the input at test time.
        // MUTANT CAUGHT: dropping either ToLowerFast.
        const matcher = createMatcher('Stone');
        expect(matcher.doesMatch('STONE')).toBe(true);
        expect(matcher.doesMatch('stone')).toBe(true);
        expect(matcher.doesMatch('stonex')).toBe(false);
    });

    it('folds ASCII only, leaving other scripts alone', () => {
        // toLowerFast, not toLowerCase -- see ./frenetic. A Unicode fold here would make two
        // distinct Cyrillic names compare equal.
        // MUTANT CAUGHT: toLowerFast -> toLowerCase.
        expect(createMatcher('КАМЕНЬ').doesMatch('камень')).toBe(false);
        expect(createMatcher('КАМЕНЬ').doesMatch('КАМЕНЬ')).toBe(true);
    });

    it('prefix-asterisk `*_log` matches by SUFFIX', () => {
        // The name reads backwards; the behaviour is what matters. `*_log` matches `oak_log`.
        // MUTANT CAUGHT: endsWith <-> startsWith swapped in either asterisk helper.
        const matcher = createMatcher('*_log');
        expect(matcher.doesMatch('oak_log')).toBe(true);
        expect(matcher.doesMatch('log_oak')).toBe(false);
    });

    it('postfix-asterisk `oak_*` matches by PREFIX', () => {
        const matcher = createMatcher('oak_*');
        expect(matcher.doesMatch('oak_log')).toBe(true);
        expect(matcher.doesMatch('log_oak')).toBe(false);
    });

    it('always-matcher accepts anything, including the empty string', () => {
        expect(createMatcher('*').doesMatch('')).toBe(true);
        expect(createMatcher('*').doesMatch('anything at all')).toBe(true);
    });

    it('multiple-asterisk requires the segments IN ORDER', () => {
        // AdvancedMatcher.cs:83-88: each `IndexOf` resumes from where the last segment ended.
        // MUTANT CAUGHT: `input.indexOf(text, index)` -> `input.indexOf(text)`, which would accept
        // out-of-order segments.
        //
        // FOUR segments, not three, and that is the point. With three the anchors alone reject the
        // out-of-order case -- `a_c_b` does not end in `c` -- so a three-segment test passes even
        // with the resumption removed. The middle pair has to be scrambled while both ENDS stay
        // correct for the scan to be the thing under test. (The audit found exactly this hole.)
        const matcher = createMatcher('a*b*c*d');
        expect(matcher.doesMatch('a_b_c_d')).toBe(true);
        expect(matcher.doesMatch('a_c_b_d')).toBe(false);
    });

    it('multiple-asterisk anchors BOTH ends', () => {
        // AdvancedMatcher.cs:73-76 checks the ends before the scan, and it has to: the ordered scan
        // alone would happily accept extra text on either side.
        // MUTANT CAUGHT: dropping either half of the startsWith/endsWith guard.
        const matcher = createMatcher('a*c');
        expect(matcher.doesMatch('abc')).toBe(true);
        expect(matcher.doesMatch('xabc')).toBe(false);
        expect(matcher.doesMatch('abcx')).toBe(false);
    });

    it('handles empty segments from asterisks at both ends', () => {
        // `*a*` splits to ['', 'a', ''].
        //
        // NO MUTANT CAUGHT, and deliberately so: removing the `continue` guard is an equivalent
        // mutant, measured over 73,660 (pattern, input) pairs -- see the note on
        // MultipleAsteriskMatchHelper. This test is here for the BEHAVIOUR, which is worth pinning
        // regardless of which line implements it.
        const matcher = createMatcher('*a*');
        expect(matcher.doesMatch('xax')).toBe(true);
        expect(matcher.doesMatch('xxx')).toBe(false);
    });

    it('folds an uppercase multiple-asterisk pattern at construction', () => {
        // AdvancedMatcher.cs:182: `CreateMatcher` hands the helper `input.ToLowerFast().SplitFast('*')`.
        // The helper folds only the INPUT, never its own texts, so if createMatcher skipped the fold
        // an uppercase pattern would match nothing at all.
        // MUTANT CAUGHT: dropping the toLowerFast in the multiple-asterisk branch of createMatcher.
        expect(createMatcher('A*C').doesMatch('abc')).toBe(true);
        expect(createMatcher('A*C').doesMatch('ABC')).toBe(true);
    });

    it('regex is unanchored and case-insensitive, like .NET Regex.IsMatch', () => {
        // MUTANT CAUGHT: anchoring the pattern with ^...$, or dropping the 'i' flag.
        const matcher = createMatcher('regex:log');
        expect(matcher.doesMatch('oak_log')).toBe(true);
        expect(matcher.doesMatch('OAK_LOG')).toBe(true);
        expect(matcher.doesMatch('oak_plank')).toBe(false);
    });

    it('alternation matches if ANY arm does', () => {
        const matcher = createMatcher('stone|dirt|sand');
        expect(matcher.doesMatch('dirt')).toBe(true);
        expect(matcher.doesMatch('sand')).toBe(true);
        expect(matcher.doesMatch('gravel')).toBe(false);
    });

    it('alternation arms are themselves parsed, not compared literally', () => {
        // C#: `matchers[i] = CreateMatcher(split[i])`, recursively.
        // MUTANT CAUGHT: building ExactMatchHelper for each arm instead of recursing.
        const matcher = createMatcher('*_log|dirt');
        expect(matcher.doesMatch('oak_log')).toBe(true);
        expect(matcher.doesMatch('dirt')).toBe(true);
        expect(matcher.doesMatch('gravel')).toBe(false);
    });

    it('inverse flips whatever it wraps, including a wildcard', () => {
        expect(createMatcher('!stone').doesMatch('stone')).toBe(false);
        expect(createMatcher('!stone').doesMatch('dirt')).toBe(true);
        expect(createMatcher('!*').doesMatch('anything')).toBe(false);
    });

    it('constructs the helpers directly, matching the C# constructor contracts', () => {
        // MultipleAsteriskMatchHelper is the one helper that does NOT fold its own texts -- it is
        // handed pre-folded segments by createMatcher (AdvancedMatcher.cs:182). Constructing it
        // directly with unfolded text therefore fails to match, and that is correct.
        // MUTANT CAUGHT: adding a toLowerFast to its constructor "for consistency".
        expect(new MultipleAsteriskMatchHelper(['A', 'C']).doesMatch('abc')).toBe(false);
        expect(new MultipleAsteriskMatchHelper(['a', 'c']).doesMatch('ABC')).toBe(true);
        // The other three DO fold, and their tests above prove it through createMatcher; these
        // pin it at the constructor so the two paths cannot drift apart.
        expect(new ExactMatchHelper('Stone').text).toBe('stone');
        expect(new PrefixAsteriskMatchHelper('_LOG').text).toBe('_log');
        expect(new PostfixAsteriskMatchHelper('OAK_').text).toBe('oak_');
    });
});
