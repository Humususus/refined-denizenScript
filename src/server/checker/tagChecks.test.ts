import { describe, it, expect } from 'vitest';
import { ScriptChecker } from './scriptChecker';
import { containsObjectNotation, ScriptCheckContext, checkSingleArgument, checkSingleDataLine } from './tagChecks';
import type { ScriptWarning } from './scriptWarnings';

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

/**
 * Phase 2C-4 Task 3: `checkSingleArgument` (ScriptChecker.cs:576-624) and
 * `checkSingleDataLine` (:630-637).
 *
 * These fixtures use a checker with NO meta. `checkSingleTag` is Task 4 and is stubbed as a
 * collector here, so the tag EXTRACTION can be asserted -- offsets and all -- without dragging
 * in tag resolution. That separation is the point: the extraction loop at :595-623 is pure index
 * arithmetic and is where an off-by-one would hide.
 */
function argChecker(): ScriptChecker {
    return new ScriptChecker('- narrate placeholder');
}

/** Compact shape for asserting on a warning. */
function argShape(w: ScriptWarning): { line: number; key: string; start: number; end: number } {
    return { line: w.line, key: w.warningUniqueKey, start: w.startChar, end: w.endChar };
}

/** Runs checkSingleArgument with the tag handler replaced by a collector. */
function extractTags(line: number, startChar: number, argument: string, isCommand = false) {
    const checker = argChecker();
    const seen: { startChar: number; tag: string }[] = [];
    checkSingleArgument(checker, line, startChar, argument, null, isCommand, (l, s, t) => seen.push({ startChar: s, tag: t }));
    return { checker, seen };
}

describe('checkSingleArgument: raw object notation (ScriptChecker.cs:578-587)', () => {
    it('warns for object notation in a non-command argument', () => {
        // Range comes from containsObjectNotation, offset by startChar.
        const { checker } = extractTags(3, 10, 'e@1234');
        expect(checker.warnings.map(argShape)).toEqual([{ line: 3, key: 'raw_object_notation', start: 10, end: 11 }]);
    });

    it('does NOT warn when the argument IS a command', () => {
        // :578's `&& !isCommand`. A command's own name and arguments are checked elsewhere, and
        // flagging them here would double-report.
        // MUTANT CAUGHT: dropping the isCommand test.
        const { checker } = extractTags(0, 0, 'e@1234', true);
        expect(checker.warnings).toEqual([]);
    });

    it('does not even look when there is no "@" in the argument', () => {
        // :578's `argument.Contains('@')` short-circuit.
        const { checker } = extractTags(0, 0, 'plain text');
        expect(checker.warnings).toEqual([]);
    });
});

describe('checkSingleArgument: uneven tag marks (ScriptChecker.cs:588-594)', () => {
    it('warns when "<" and ">" counts differ, spanning the first to the last mark', () => {
        // Range is IndexOfAny/LastIndexOfAny over `argument` (:591-592), while the COUNT is over
        // `argNoArrows` (:589) -- two different strings, deliberately.
        // 'a <b c': '<' at 2, no '>' -> counts differ. First and last mark are both index 2.
        const { checker } = extractTags(1, 0, 'a <b c');
        expect(checker.warnings.map(argShape)).toEqual([{ line: 1, key: 'uneven_tags', start: 2, end: 2 }]);
    });

    it('does NOT warn for balanced marks', () => {
        const { checker } = extractTags(0, 0, 'a <player.name> b');
        expect(checker.warnings.filter(w => w.warningUniqueKey === 'uneven_tags')).toEqual([]);
    });

    it('takes its RANGE from the original argument even though it COUNTS on argNoArrows', () => {
        // :589-592 deliberately reads two different strings: the count is over `argNoArrows`
        // (so `<-` does not inflate it) but IndexOfAny/LastIndexOfAny are over `argument` (so
        // the squiggle lands on the text the user actually wrote).
        //
        // Isolating that needs an input where the two strings put their tag marks in DIFFERENT
        // PLACES, which only happens when a `<-` is present: '<- <a' is '<' at 0 and 3, but
        // 'al <a' has only the one at 3. Every earlier fixture had `argument === argNoArrows`,
        // so reading the range off the wrong string survived. Confirmed by mutation.
        //
        // MUTANT CAUGHT: taking the range from argNoArrows -- it becomes 3-3 instead of 0-3.
        const { checker } = extractTags(0, 0, '<- <a');
        expect(checker.warnings.map(argShape)).toEqual([{ line: 0, key: 'uneven_tags', start: 0, end: 3 }]);
    });

    it('is gated on length > 2, so a bare "<" is not reported', () => {
        // :589's `argument.Length > 2`. A two-character argument cannot hold a real tag.
        // MUTANT CAUGHT: dropping the length gate -- '<' alone would warn.
        expect(extractTags(0, 0, '<').checker.warnings).toEqual([]);
        expect(extractTags(0, 0, '<a').checker.warnings).toEqual([]);
    });

    it('treats "<-" as two ordinary characters, not an open tag mark', () => {
        // :588 rewrites `<-` to `al` BEFORE counting, because `<-` is a Denizen operator and
        // would otherwise read as an unclosed tag on every line that uses it.
        // MUTANT CAUGHT: dropping the `<-` substitution -- this warns.
        expect(extractTags(0, 0, 'foo <- bar').checker.warnings).toEqual([]);
    });

    it('treats ":->" the same way', () => {
        // :588's second substitution, `:->` to `arr`.
        // MUTANT CAUGHT: dropping it.
        expect(extractTags(0, 0, 'foo :-> bar').checker.warnings).toEqual([]);
    });

    it('keeps offsets correct because both substitutions are LENGTH-PRESERVING', () => {
        // `<-` (2 chars) becomes `al` (2), `:->` (3) becomes `arr` (3). Every index below :588
        // is into argNoArrows, so a substitution that changed the length would silently shift
        // every tag offset in the argument.
        // MUTANT CAUGHT: replacing `<-` with '' or with a single character -- the extracted tag
        // offset moves.
        const { seen } = extractTags(0, 0, 'a <- <player.name>');
        expect(seen).toEqual([{ startChar: 6, tag: 'player.name' }]);
    });
});

describe('checkSingleArgument: tag extraction (ScriptChecker.cs:595-623)', () => {
    it('extracts a single tag with the offset of its first character INSIDE the "<"', () => {
        // :621 passes `startChar + tagIndex + 1`, so the offset points at the tag TEXT, not at
        // the '<'. Every range checkSingleTag reports is relative to that.
        // MUTANT CAUGHT: passing tagIndex without the +1.
        expect(extractTags(0, 0, '<player.name>').seen).toEqual([{ startChar: 1, tag: 'player.name' }]);
    });

    it('adds the caller startChar to the tag offset', () => {
        expect(extractTags(0, 100, 'x <player.name>').seen).toEqual([{ startChar: 103, tag: 'player.name' }]);
    });

    it('extracts several tags from one argument', () => {
        // 'a<b>c<d>': '<' at 1 -> tag 'b' at 2; next '<' at 5 -> tag 'd' at 6.
        expect(extractTags(0, 0, 'a<b>c<d>').seen).toEqual([
            { startChar: 2, tag: 'b' },
            { startChar: 6, tag: 'd' }
        ]);
    });

    it('extracts the OUTER tag only for a nested tag, and the bracket counter is why', () => {
        // :598-615 counts '<' and '>' and stops at the one that returns the depth to zero. The
        // inner tag is part of the outer tag's text; checkSingleTag re-enters for the parameter.
        // MUTANT CAUGHT: stopping at the first '>' -- the extracted text would be truncated to
        // 'player.flag[<[x]' and the rest of the line re-scanned as garbage.
        expect(extractTags(0, 0, '<player.flag[<[x]>]>').seen).toEqual([
            { startChar: 1, tag: 'player.flag[<[x]>]' }
        ]);
    });

    it('stops the scan at an unclosed tag rather than looping', () => {
        // :616-619 breaks when no closing mark is found. The tag before it was already reported.
        // MUTANT CAUGHT: continuing the scan, which never terminates or misreports.
        expect(extractTags(0, 0, '<a> <b').seen).toEqual([{ startChar: 1, tag: 'a' }]);
    });

    it('finds nothing in an argument with no tags', () => {
        expect(extractTags(0, 0, 'just some words').seen).toEqual([]);
    });

    it('resumes the scan AFTER the closing mark, not one character on', () => {
        // :622's `IndexOf('<', endIndex)`. Starting from `tagIndex + 1` instead would re-enter
        // the tag just consumed and report its inner tag a second time.
        // MUTANT CAUGHT: resuming from tagIndex + 1.
        expect(extractTags(0, 0, '<a[<b>]> <c>').seen).toEqual([
            { startChar: 1, tag: 'a[<b>]' },
            { startChar: 10, tag: 'c' }
        ]);
    });
});

describe('checkSingleDataLine (ScriptChecker.cs:630-637)', () => {
    it('warns invalid_data_line_quotes as a MINOR warning for a double-quoted data line', () => {
        // :632-635. The list is MinorWarnings (Information severity), not Warnings.
        // MUTANT CAUGHT: routing it to `warnings` -- a style nit would get a yellow squiggle.
        const checker = argChecker();
        checkSingleDataLine(checker, 2, 5, 'some "quoted" text', null);
        expect(checker.minorWarnings.map(argShape)).toEqual([
            { line: 2, key: 'invalid_data_line_quotes', start: 5, end: 23 }
        ]);
        expect(checker.warnings).toEqual([]);
    });

    it('warns for a line STARTING with a single quote, but not one merely containing it', () => {
        // :632 is `Contains('"') || StartsWith('\'')` -- asymmetric, and deliberately so: an
        // apostrophe inside a word is ordinary text.
        // MUTANT CAUGHT: making both tests `Contains`, which flags every "don't".
        const starts = argChecker();
        checkSingleDataLine(starts, 0, 0, "'quoted'", null);
        expect(starts.minorWarnings.length).toBe(1);
        const inside = argChecker();
        checkSingleDataLine(inside, 0, 0, "don't", null);
        expect(inside.minorWarnings).toEqual([]);
    });

    it('still runs the argument checks underneath', () => {
        // :636 -- a data line is also an argument, and gets the same tag and notation checks.
        // MUTANT CAUGHT: returning early after the quote warning.
        const checker = argChecker();
        checkSingleDataLine(checker, 0, 0, 'e@1234', null);
        expect(checker.warnings.map(argShape)).toEqual([{ line: 0, key: 'raw_object_notation', start: 0, end: 1 }]);
    });
});
