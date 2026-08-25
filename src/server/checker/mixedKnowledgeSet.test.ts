import { describe, it, expect } from 'vitest';
import { MixedKnowledgeSet } from './mixedKnowledgeSet';

/**
 * Every expectation in this file was hand-derived by reading
 * SharpDenizenTools/ScriptAnalysis/MixedKnowledgeSet.cs (106 lines, ported in full).
 *
 * The type exists because Denizen scripts name things with tags. `- define <[prefix]>_count 1`
 * declares a definition whose name is not knowable at check time, and a checker that treated
 * that as "no definition named X" would warn about correct scripts. So the set keeps two
 * halves: names it knows exactly, and prefixes it knows a name starts with.
 */

/** Sorted contents of a Set, for order-independent comparison. */
function sorted(set: Set<string>): string[] {
    return Array.from(set).sort();
}

describe('MixedKnowledgeSet.add', () => {
    it('files a tag-free string under exactKnown, verbatim', () => {
        // MixedKnowledgeSet.cs:38-46 -- the `str.Contains('<')` test is false, so the whole
        // string goes to ExactKnown untouched.
        // MUTANT CAUGHT: trimming or lowercasing here -- the C# does neither, and its callers
        // (ScriptChecker.cs:1798, :1837) lowercase BEFORE calling, not after.
        const set = new MixedKnowledgeSet();
        set.add('greeting');
        expect(sorted(set.exactKnown)).toEqual(['greeting']);
        expect(sorted(set.partialKnown)).toEqual([]);
    });

    it('truncates a string containing "<" at the "<" and files it under partialKnown', () => {
        // MixedKnowledgeSet.cs:38-42: `str = str.Before('<')` FIRST, then Add to PartialKnown.
        // Both halves matter -- storing the untruncated string would make the StartsWith test
        // in `contains` compare against text the caller can never produce.
        // MUTANT CAUGHT: storing the original string, or filing it under exactKnown.
        const set = new MixedKnowledgeSet();
        set.add('prefix_<[x]>_suffix');
        expect(sorted(set.exactKnown)).toEqual([]);
        expect(sorted(set.partialKnown)).toEqual(['prefix_']);
    });

    it('files a string that STARTS with "<" as the empty prefix', () => {
        // The degenerate case, and the most consequential one: `Before('<')` of "<[x]>" is "".
        // MUTANT CAUGHT: guarding against the empty string -- see the `contains` test below for
        // why that guard would be wrong.
        const set = new MixedKnowledgeSet();
        set.add('<[x]>');
        expect(sorted(set.partialKnown)).toEqual(['']);
    });

    it('leaves minLength at 0 no matter what is added (C# QUIRK, ported dead)', () => {
        // MixedKnowledgeSet.cs:21 initialises MinLength to 0 and :47 updates it with
        // `Math.Min(MinLength, str.Length)`. No string has negative length, so it can only ever
        // stay 0, and the `option.Length < MinLength` guard at :69-72 is unreachable.
        // Ported dead ON PURPOSE. This test exists so that "fixing" it fails loudly rather than
        // silently: a real minimum would start REJECTING short names the C# accepts.
        // MUTANT CAUGHT: initialising minLength to Infinity, or tracking a true minimum.
        const set = new MixedKnowledgeSet();
        set.addAll('alpha', 'be', 'gammagamma');
        expect(set.minLength).toBe(0);
    });

    it('grows maxLength to the longest string added, measured BEFORE truncation', () => {
        // MixedKnowledgeSet.cs:47-48 runs after the reassignment at :40, so a truncated partial
        // updates the length with its TRUNCATED length, not the original's.
        // MUTANT CAUGHT: measuring the pre-truncation length -- 'ab_<[x]>' would give 8, not 3.
        const set = new MixedKnowledgeSet();
        set.addAll('alpha', 'ab_<[x]>');
        expect(set.maxLength).toBe(5);
    });
});

describe('MixedKnowledgeSet.contains', () => {
    it('matches an exactly-known string and rejects an unknown one', () => {
        // MixedKnowledgeSet.cs:73-76.
        const set = new MixedKnowledgeSet();
        set.addAll('greeting', 'target');
        expect(set.contains('greeting')).toBe(true);
        expect(set.contains('nonsense')).toBe(false);
    });

    it('matches a partially-known string by PREFIX, not by equality', () => {
        // MixedKnowledgeSet.cs:77-84 -- the loop that makes the type worth having.
        // MUTANT CAUGHT: checking PartialKnown with .has() only (the :73 fast path), which
        // would match 'prefix_' itself but not 'prefix_anything'.
        const set = new MixedKnowledgeSet();
        set.add('prefix_<[x]>');
        expect(set.contains('prefix_count')).toBe(true);
        expect(set.contains('prefix_')).toBe(true);
        expect(set.contains('other_count')).toBe(false);
    });

    it('matches a LONGER string than anything added, via the partial loop', () => {
        // The :73 fast path is gated on `option.Length <= MaxLength`, so a long option can only
        // be matched by the :77-84 loop. maxLength here is 7 ('prefix_') and the query is 12.
        // MUTANT CAUGHT: applying the `<= maxLength` guard to the partial loop as well, which
        // would silently stop matching exactly the long names this type exists to allow.
        const set = new MixedKnowledgeSet();
        set.add('prefix_<[x]>');
        expect(set.maxLength).toBe(7);
        expect(set.contains('prefix_count')).toBe(true);
    });

    it('matches EVERYTHING once an empty prefix is present', () => {
        // The consequence of `add('<[x]>')`: '' is a prefix of every string, so :79's StartsWith
        // is true for all input. This is not a bug to guard -- it is how a script whose
        // definition names are entirely tag-built ends up exempt from "undefined definition"
        // warnings in 2C-4 instead of drowning in them.
        // MUTANT CAUGHT: skipping empty partials in either `add` or `contains`.
        const set = new MixedKnowledgeSet();
        set.add('<[x]>');
        expect(set.contains('anything_at_all')).toBe(true);
        expect(set.contains('')).toBe(true);
    });

    it('returns false on an empty set', () => {
        // Guards the degenerate path: maxLength is 0, so the :73 fast path is dead, and the
        // partial loop has nothing to iterate.
        const set = new MixedKnowledgeSet();
        expect(set.contains('anything')).toBe(false);
        expect(set.contains('')).toBe(false);
    });
});

describe('MixedKnowledgeSet: the rest of the surface', () => {
    it('any() is false when empty and true after either kind of add', () => {
        // MixedKnowledgeSet.cs:61-64. ConvertContainers gates the whole inject-merge loop on
        // this (ScriptChecker.cs:1741), so an `any()` that ignored partialKnown would skip
        // injects declared through tags.
        // MUTANT CAUGHT: checking only exactKnown.
        const empty = new MixedKnowledgeSet();
        expect(empty.any()).toBe(false);
        const exact = new MixedKnowledgeSet();
        exact.add('x');
        expect(exact.any()).toBe(true);
        const partial = new MixedKnowledgeSet();
        partial.add('<[x]>');
        expect(partial.any()).toBe(true);
    });

    it('mergeIn unions both halves and takes the min/max of the lengths', () => {
        // MixedKnowledgeSet.cs:27-33. Note minLength stays 0 on both sides, so Math.min is a
        // no-op -- asserted anyway, because that is the quirk's observable footprint here.
        // MUTANT CAUGHT: merging exactKnown only, or overwriting rather than unioning.
        const a = new MixedKnowledgeSet();
        a.addAll('alpha', 'pre_<[x]>');
        const b = new MixedKnowledgeSet();
        b.addAll('beta', 'other_<[y]>');
        a.mergeIn(b);
        expect(sorted(a.exactKnown)).toEqual(['alpha', 'beta']);
        expect(sorted(a.partialKnown)).toEqual(['other_', 'pre_']);
        expect(a.minLength).toBe(0);
        expect(a.maxLength).toBe(6);
    });

    it('mergeIn does not alias the other set -- a later add on the source does not leak', () => {
        // C#'s UnionWith copies members. A TypeScript port that assigned the Set reference
        // would share mutable state between two containers, and ConvertContainers merges an
        // injected script's names into every script that injects it (ScriptChecker.cs:1752).
        // MUTANT CAUGHT: `this.exactKnown = other.exactKnown`.
        const a = new MixedKnowledgeSet();
        const b = new MixedKnowledgeSet();
        b.add('beta');
        a.mergeIn(b);
        b.add('gamma');
        expect(sorted(a.exactKnown)).toEqual(['beta']);
    });

    it('getAllMatchesIn filters the input by contains, preserving input order', () => {
        // MixedKnowledgeSet.cs:88-91. ConvertContainers walks its result at :1747 to resolve
        // inject targets against the workspace's script names.
        // MUTANT CAUGHT: returning the SET's contents rather than the matching OPTIONS -- for
        // a partial entry those are different strings entirely.
        const set = new MixedKnowledgeSet();
        set.addAll('exact_one', 'pre_<[x]>');
        expect(set.getAllMatchesIn(['zzz', 'pre_two', 'exact_one', 'nope'])).toEqual(['pre_two', 'exact_one']);
    });

    it('enumerateAll yields exact entries first, then partial ones', () => {
        // MixedKnowledgeSet.cs:94-104 -- two sequential loops, exact before partial.
        // MUTANT CAUGHT: yielding only exactKnown.
        const set = new MixedKnowledgeSet();
        set.addAll('b_exact', 'a_partial_<[x]>');
        expect(Array.from(set.enumerateAll())).toEqual(['b_exact', 'a_partial_']);
    });
});
