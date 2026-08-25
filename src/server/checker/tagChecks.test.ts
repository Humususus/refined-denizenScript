import { describe, it, expect } from 'vitest';
import { containsObjectNotation, ScriptCheckContext } from './tagChecks';

/**
 * Every expectation in this file was hand-derived by reading
 * SharpDenizenTools/ScriptAnalysis/ScriptChecker.cs. Character indices are counted by hand off
 * the literal fixture strings, never read back out of the implementation.
 */

describe('containsObjectNotation (ScriptChecker.cs:1343-1362)', () => {
    it('finds a simple object notation and returns the letter..@ range', () => {
        // :1350-1354. `first` is the index of the LETTER, `last` the index of the '@'.
        // MUTANT CAUGHT: returning the '@' index as the start -- the squiggle would miss the
        // type letter, which is the whole thing being complained about.
        expect(containsObjectNotation('e@1234')).toEqual({ start: 0, end: 1 });
        expect(containsObjectNotation('p@bob')).toEqual({ start: 0, end: 1 });
    });

    it('returns null when there is no "@" at all', () => {
        expect(containsObjectNotation('narrate hello')).toBeNull();
    });

    it('ignores an "@" at index 0 -- there is no letter before it', () => {
        // :1350's `atIndex > 0` guard.
        // MUTANT CAUGHT: dropping the guard, which reads line[-1] (undefined in JS, an
        // IndexOutOfRange in C#) and so behaves differently in the two languages.
        expect(containsObjectNotation('@nothing')).toBeNull();
    });

    it('only accepts the fifteen letters that actually start an object type', () => {
        // OBJECT_NOTATION_LAST_LETTER_MATCHER is the literal string "mdlipqsebhounwr"
        // (:1338) -- the last letter of every real ObjectTag prefix. Transcribed character by
        // character, not from memory.
        // MUTANT CAUGHT: accepting any letter, which would flag every email address and every
        // `@` in a piece of prose.
        for (const ch of 'mdlipqsebhounwr') {
            expect(containsObjectNotation(`${ch}@x`), ch).toEqual({ start: 0, end: 1 });
        }
        for (const ch of 'acfgjktvxyz') {
            expect(containsObjectNotation(`${ch}@x`), ch).toBeNull();
        }
    });

    it('is CASE SENSITIVE, so an uppercase letter does not match', () => {
        // The C# matcher is built from a lowercase-only string and AsciiMatcher does not fold
        // case. `E@1` is therefore not flagged.
        // MUTANT CAUGHT: lowercasing the input, or using a case-insensitive test.
        expect(containsObjectNotation('E@1')).toBeNull();
        expect(containsObjectNotation('M@1')).toBeNull();
    });

    it('spans from the FIRST match to the LAST across several notations', () => {
        // :1352-1353 are Math.Min/Math.Max across every '@' in the line, so the range covers
        // everything between the first and last, including whatever sits in the middle.
        // 'e@1 l@2': e0 @1 space2 l3 @4... let me count -- e=0, @=1, 1=2, ' '=3, l=4, @=5.
        // MUTANT CAUGHT: returning the range of the LAST match only, or of the first only.
        expect(containsObjectNotation('e@1 l@2')).toEqual({ start: 0, end: 5 });
    });

    it('takes the widest range even when the later match is not the widest', () => {
        // Guards the Math.Min specifically: a qualifying '@' early and another later must widen
        // in both directions independently.
        expect(containsObjectNotation('zzz m@a d@b')).toEqual({ start: 4, end: 9 });
    });

    it('ignores non-qualifying "@"s while still reporting the qualifying ones', () => {
        // 'a@1 e@2': a=0 @=1 (a is not in the set, skipped), ' '=3, e=4, @=5.
        // MUTANT CAUGHT: letting a non-qualifying '@' widen `last`, which it must not.
        expect(containsObjectNotation('a@1 e@2')).toEqual({ start: 4, end: 5 });
    });

    it('flags an ordinary email address (C# QUIRK, ported verbatim)', () => {
        // 'someone@example.com': the character before '@' is 'e', which IS in the set, so this
        // reads as object notation. The C# has the same behaviour, and `CheckSingleArgument`
        // only consults it when `!isCommand` (:578), which limits the blast radius rather than
        // removing it.
        // Pinned so the quirk is a known, deliberate state rather than a surprise later.
        expect(containsObjectNotation('someone@example.com')).toEqual({ start: 6, end: 7 });
    });
});

describe('ScriptCheckContext (ScriptChecker.cs:772-785)', () => {
    it('starts with two empty sets and both unknowable flags false', () => {
        // The flags default false; `CheckAllContainers` sets them when the script has injects
        // it cannot resolve, and `CheckSingleTag` (:451, :463) reads them to suppress
        // def_of_nothing / entry_of_nothing entirely rather than emit a screen of false
        // positives.
        // MUTANT CAUGHT: defaulting either flag to true, which silences the checks the whole
        // phase exists to enable.
        const context = new ScriptCheckContext();
        expect(context.definitions.size).toBe(0);
        expect(context.saveEntries.size).toBe(0);
        expect(context.hasUnknowableDefinitions).toBe(false);
        expect(context.hasUnknowableSaveEntries).toBe(false);
    });

    it('gives each instance its own sets, not shared ones', () => {
        // A class field initialised to a shared literal would leak one container's definitions
        // into the next -- and CheckAllContainers builds one context per script key.
        // MUTANT CAUGHT: hoisting the sets to module scope or a prototype property.
        const a = new ScriptCheckContext();
        const b = new ScriptCheckContext();
        a.definitions.add('mine');
        expect(b.definitions.size).toBe(0);
    });
});
