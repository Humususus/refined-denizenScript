import { describe, it, expect } from 'vitest';
import { ScriptChecker } from './scriptChecker';
import { buildArgs } from './buildArgs';
import type { ScriptWarning } from './scriptWarnings';

/**
 * Every expectation in this file was hand-derived by reading
 * SharpDenizenTools/ScriptAnalysis/ScriptChecker.cs:658-769 (`BuildArgs`) and :650
 * (`VALID_TAG_FIRST_CHAR`). Character indices are counted by hand off the literal fixture
 * strings, never read back out of the implementation.
 *
 * `buildArgs` has TWO callers with opposite needs, and both are exercised here:
 *   - `PreprocContainer` (ScriptChecker.cs:1790) passes a NULL checker. It wants the tokens and
 *     nothing else; the warning path must stay silent.
 *   - `CheckSingleCommand` (Phase 2C-4) will pass a real checker, and then the two warnings
 *     (`bad_quotes`, `missing_quotes`) are the point.
 */

/** Compact shape for asserting on an argument. */
function shape(args: { startChar: number; text: string }[]): [string, number][] {
    return args.map(a => [a.text, a.startChar]);
}

/** Compact shape for asserting on a warning. */
function warnShape(w: ScriptWarning): { line: number; key: string; start: number; end: number } {
    return { line: w.line, key: w.warningUniqueKey, start: w.startChar, end: w.endChar };
}

/** A checker over an arbitrary one-line script, used only to collect warnings. */
function collector(): ScriptChecker {
    return new ScriptChecker('- narrate placeholder');
}

describe('buildArgs: splitting', () => {
    it('splits on spaces and reports each argument its own start offset', () => {
        // ScriptChecker.cs:671-678. The offsets are the whole reason this returns objects rather
        // than strings -- every consumer reports diagnostics against them.
        // MUTANT CAUGHT: emitting `start` instead of `startChar + start`.
        expect(shape(buildArgs(0, 0, 'a bb ccc', null))).toEqual([['a', 0], ['bb', 2], ['ccc', 5]]);
    });

    it('adds the caller\'s startChar to every offset', () => {
        // ScriptChecker.cs:675 -- `StartChar = startChar + start`. PreprocContainer passes 0,
        // but CheckSingleCommand will pass the column the arguments begin at.
        // MUTANT CAUGHT: applying startChar only to the first argument, or only in the tail path
        // at :766.
        expect(shape(buildArgs(3, 10, 'a bb', null))).toEqual([['a', 10], ['bb', 12]]);
    });

    it('collapses runs of spaces instead of emitting empty arguments', () => {
        // ScriptChecker.cs:673 -- the `i > start` guard. On the second space of a run, `start`
        // already equals `i`, so nothing is added.
        // MUTANT CAUGHT: dropping the guard, which yields empty-string arguments between spaces.
        expect(shape(buildArgs(0, 0, 'a  b', null))).toEqual([['a', 0], ['b', 3]]);
    });

    it('returns nothing at all for empty or whitespace-only input', () => {
        // ScriptChecker.cs:660 trims first, so both reduce to a zero-length string: the loop
        // never runs and the tail `start < len` at :764 is false.
        expect(buildArgs(0, 0, '', null)).toEqual([]);
        expect(buildArgs(0, 0, '     ', null)).toEqual([]);
    });

    it('turns CR and LF into spaces ONE FOR ONE, so a CRLF becomes two spaces', () => {
        // ScriptChecker.cs:660 -- `.Replace('\r', ' ').Replace('\n', ' ')`, applied AFTER Trim.
        // Both are single-character replacements, so "a\nb\r\nc" becomes "a b  c" and 'c' lands
        // at 5, not 4. Offsets into the ORIGINAL text are therefore preserved, which is the
        // point of replacing rather than stripping.
        // MUTANT CAUGHT: collapsing "\r\n" to a single space, which would shift every offset
        // after a line break; and leaving newlines alone, which yields one argument.
        expect(shape(buildArgs(0, 0, 'a\nb\r\nc', null))).toEqual([['a', 0], ['b', 2], ['c', 5]]);
    });

    it('TRIMS FIRST, so leading whitespace shifts every reported offset (C# QUIRK)', () => {
        // ScriptChecker.cs:660 trims BEFORE any index is taken, and every StartChar is then an
        // index into the TRIMMED string. So when the caller's `stringArgs` had leading spaces,
        // the offsets are short by exactly that many characters relative to the real line.
        // Harmless for PreprocContainer, which passes startChar 0 and never publishes; a trap
        // for Phase 2C-4, which will.
        // MUTANT CAUGHT: "fixing" this by compensating for the trim -- that would be a silent
        // deviation, and the ranges are not currently published anywhere to justify it.
        expect(shape(buildArgs(0, 0, '    a b', null))).toEqual([['a', 0], ['b', 2]]);
    });
});

describe('buildArgs: quotes', () => {
    it('keeps a quoted argument whole and strips the quotes', () => {
        // ScriptChecker.cs:706-757. The space at :671 is gated on `currentQuote == '\0'`, so a
        // space inside quotes cannot split; :727 then slices BETWEEN the quotes.
        // MUTANT CAUGHT: returning the argument with its quotes attached -- every downstream
        // string comparison in PreprocContainer (`cleanArgs[0] == 'server'`) would then miss.
        expect(shape(buildArgs(0, 0, 'narrate "hello world"', null))).toEqual([['narrate', 0], ['hello world', 9]]);
    });

    it('opens a quote only at the start of an argument', () => {
        // ScriptChecker.cs:714 -- `i == 0 || stringArgs[i - 1] == ' '`. An apostrophe inside a
        // word is data, not a quote, which is what keeps `don't` from swallowing the rest.
        // MUTANT CAUGHT: dropping the preceding-character test.
        expect(shape(buildArgs(0, 0, "a don't b", null))).toEqual([['a', 0], ["don't", 2], ['b', 8]]);
    });

    it('closes a quote at the end of an argument, and offsets INSIDE the quotes', () => {
        // ScriptChecker.cs:722 -- `i + 1 >= len || stringArgs[i + 1] == ' '` is satisfied, so the
        // quote closes, :727 slices between the quotes, and :754's `i++` steps over the space.
        //
        // The offset is 1, not 0: :717 sets `start = i + 1` when the quote OPENS, so a quoted
        // argument is anchored at its first inner character rather than at its quote. That is
        // consistent with `bad_quotes`' range at :750, which spans the inner text.
        expect(shape(buildArgs(0, 0, '"ab" cd', null))).toEqual([['ab', 1], ['cd', 5]]);
    });

    it('steps over the space after a closing quote (:754\'s index mutation)', () => {
        // ScriptChecker.cs:754 does `i++` right after closing a quote, so the following space is
        // never seen by the loop. Almost everywhere this is invisible: when the space IS seen,
        // :673's `i > start` guard finds them equal and pushes nothing, then sets the same
        // `start` the `i++` would have. The two paths converge.
        //
        // They diverge in exactly one shape, found by exhaustive search rather than by argument
        // (2.4M inputs; 344 differ, all of this form): an EMPTY quoted argument inside an open
        // tag. The empty quotes make `start` land ON the space, and the open tag suppresses the
        // space branch that would otherwise absorb it -- so without the `i++` the space is
        // swallowed into the NEXT argument's text and offset.
        //
        // MUTANT CAUGHT: deleting the `i++`. Gives [['', 4], [' x', 5]] -- note the leading
        // space in the text and the offset one to the left.
        expect(shape(buildArgs(0, 0, '<a "" x', null))).toEqual([['', 4], ['x', 6]]);
    });

    it('does NOT close on a quote followed by more word characters -- and then swallows the line', () => {
        // The other side of ScriptChecker.cs:722, and it is worth its own test because the
        // consequence is much larger than "this one quote did not close": `currentQuote` stays
        // set, so the space test at :671 is dead for the REST OF THE LINE and everything from
        // the opening quote onwards becomes a single argument.
        //
        // Note the offset: 1, not 0. The opening quote consumed index 0 by setting `start = 1`
        // (:717), and the tail push at :766 slices from there -- so the argument text has lost
        // its leading quote but kept the inner one.
        //
        // Hand-traced against the C# after the first draft of this test guessed
        // [['"ab"cd', 0], ['ef', 7]], which assumed the unclosed quote was somehow forgotten.
        // MUTANT CAUGHT: closing on any matching quote character regardless of what follows.
        expect(shape(buildArgs(0, 0, '"ab"cd ef', null))).toEqual([['ab"cd ef', 1]]);
        // And with a checker attached, that is exactly the shape `missing_quotes` exists for.
        const checker = collector();
        buildArgs(0, 0, '"ab"cd ef', checker);
        expect(checker.warnings.map(warnShape)).toEqual([{ line: 0, key: 'missing_quotes', start: 0, end: 9 }]);
    });

    it('does not treat the other quote character as a closer, even at an argument boundary', () => {
        // ScriptChecker.cs:720 -- `currentQuote == c`. A single quote inside double quotes is
        // ordinary text.
        //
        // The `'` here is deliberately followed by a SPACE. With the apostrophe mid-word
        // (`x "it's here" y`) the mutant is masked: :722's "is this the end of an argument?"
        // test rejects the closer anyway, so `currentQuote == c` is never the reason. Confirmed
        // by mutation -- that fixture survived.
        //
        // MUTANT CAUGHT: closing on any open quote regardless of which character opened it. The
        // `'` would end the argument early, giving [['a b', 1], ['c"', 6]].
        expect(shape(buildArgs(0, 0, `"a b' c"`, null))).toEqual([[`a b' c`, 1]]);
    });

    it('ignores a quote inside tag parameters even when a space precedes it', () => {
        // ScriptChecker.cs:708 -- the `inTagParams == 0` gate. Inside a tag's `[...]`, a quote is
        // data.
        //
        // THE SPACE BEFORE THE QUOTE IS THE WHOLE POINT OF THIS FIXTURE. The first draft used
        // `<player.flag[a'b]>`, which passes with the gate DELETED -- the quote there follows a
        // letter, so :714's `stringArgs[i - 1] == ' '` test rejects it anyway and the gate is
        // never the reason. Confirmed by running the mutant: all 24 tests passed. Only a quote
        // that :714 would otherwise accept can isolate :708.
        //
        // MUTANT CAUGHT: dropping the `inTagParams == 0` gate. The quote then opens mid-tag,
        // never closes, and the whole remainder collapses to one argument -- [["c]> d", 6]].
        expect(shape(buildArgs(0, 0, `<a[b 'c]> d`, null))).toEqual([[`<a[b 'c]>`, 0], ['d', 10]]);
    });
});

describe('buildArgs: tags', () => {
    it('does not split on spaces inside a tag', () => {
        // ScriptChecker.cs:671's `inTags == 0`, with :679-685 opening the tag and :686-693
        // closing it. `<player.flag[a b]>` is ONE argument.
        // MUTANT CAUGHT: not tracking inTags at all -- a naive space split gives three.
        expect(shape(buildArgs(0, 0, '<player.flag[a b]> x', null))).toEqual([['<player.flag[a b]>', 0], ['x', 19]]);
    });

    it('requires a valid tag-first character after "<"', () => {
        // ScriptChecker.cs:681 with VALID_TAG_FIRST_CHAR at :650 (ASCII letters, digits, &, _, [).
        // A bare `<` followed by a space is a less-than sign, not a tag.
        // MUTANT CAUGHT: incrementing inTags on every '<', which would swallow the remainder of
        // any line containing a comparison.
        expect(shape(buildArgs(0, 0, 'a < b', null))).toEqual([['a', 0], ['<', 2], ['b', 4]]);
    });

    it('is ASCII-only in that test, matching AsciiMatcher', () => {
        // ScriptChecker.cs:650 builds VALID_TAG_FIRST_CHAR from an explicit ASCII set, and
        // AsciiMatcher rejects everything above 0x7F. A Cyrillic letter after '<' therefore does
        // NOT open a tag -- and the user's scripts are full of Cyrillic narrate text.
        // MUTANT CAUGHT: using a Unicode-aware /\w/ or toLowerCase-based test.
        expect(shape(buildArgs(0, 0, 'a <б b', null))).toEqual([['a', 0], ['<б', 2], ['b', 5]]);
    });

    it('tracks nested tags, closing only on the outermost ">"', () => {
        // ScriptChecker.cs:683 and :688 -- inTags is a COUNTER, not a flag.
        // MUTANT CAUGHT: a boolean inTags, which would end the tag at the inner '>' and split
        // the rest of the argument.
        expect(shape(buildArgs(0, 0, '<a[<b.c> d]> e', null))).toEqual([['<a[<b.c> d]>', 0], ['e', 13]]);
    });

    it('only counts "[" as tag params while inside a tag, so an UNCLOSED bracket is harmless', () => {
        // ScriptChecker.cs:694 -- `c == '[' && inTags > 0`. A bare bracket outside a tag is
        // ordinary text and must not leave inTagParams stuck above zero, which would disable
        // quote handling for the rest of the line.
        //
        // The bracket is deliberately left UNCLOSED. A balanced `[x]` passes with the guard
        // deleted too -- the `]` decrements straight back to zero, so the guard is never the
        // reason. Confirmed by mutation: the balanced fixture this test first used survived.
        //
        // MUTANT CAUGHT: dropping the `inTags > 0` guard. inTagParams then sticks at 1, :708's
        // gate is never satisfied again, the quote never opens, and the line splits on its raw
        // spaces instead -- [['[x', 0], ['"a', 3], ['b"', 6]].
        expect(shape(buildArgs(0, 0, '[x "a b"', null))).toEqual([['[x', 0], ['a b', 4]]);
    });
});

describe('buildArgs: the warning path (a real checker)', () => {
    it('warns bad_quotes, as a MINOR warning, when quotes wrap something with no spaces', () => {
        // ScriptChecker.cs:729-752. Note the list: MinorWarnings (Information severity), not
        // Warnings. Range is (startChar + start, startChar + i) -- the text BETWEEN the quotes.
        // MUTANT CAUGHT: routing this to `warnings`, which would paint a yellow squiggle on a
        // purely stylistic nit.
        const checker = collector();
        expect(shape(buildArgs(4, 0, 'narrate "hello"', checker))).toEqual([['narrate', 0], ['hello', 9]]);
        expect(checker.minorWarnings.map(warnShape)).toEqual([{ line: 4, key: 'bad_quotes', start: 9, end: 14 }]);
        expect(checker.warnings).toEqual([]);
        expect(checker.errors).toEqual([]);
    });

    it('does NOT warn bad_quotes when the quoted text contains a space outside tags', () => {
        // ScriptChecker.cs:743-748 -- `hasSpace` is only set for a space at tagMarks == 0.
        const checker = collector();
        buildArgs(0, 0, 'narrate "a b"', checker);
        expect(checker.minorWarnings).toEqual([]);
    });

    it('does NOT warn bad_quotes when the only space is INSIDE a tag but the tag is unbalanced', () => {
        // ScriptChecker.cs:748's second disjunct, `tagMarks != 0 && matched.Contains(' ')`. A
        // quoted fragment whose tag markers do not balance, and which has a space anywhere, is
        // left alone -- the C# declines to guess.
        // MUTANT CAUGHT: keeping only the `hasSpace` test and dropping the tagMarks disjunct.
        const checker = collector();
        buildArgs(0, 0, 'narrate "<a b"', checker);
        expect(checker.minorWarnings).toEqual([]);
    });

    it('does NOT warn bad_quotes when the quoted text ends with ":"', () => {
        // ScriptChecker.cs:748 -- `!matched.EndsWith(":")`. A quoted prefix argument is a
        // deliberate construction, not a mistake.
        const checker = collector();
        buildArgs(0, 0, 'narrate "abc:"', checker);
        expect(checker.minorWarnings).toEqual([]);
    });

    it('warns missing_quotes, as a full warning, when a quote is never closed', () => {
        // ScriptChecker.cs:760-763, and note the list is Warnings this time, not MinorWarnings.
        // Range is (startChar + firstQuote, startChar + len).
        // MUTANT CAUGHT: routing this to minorWarnings -- an unbalanced quote genuinely changes
        // what Denizen executes, which is why the C# grades the two differently.
        const checker = collector();
        expect(shape(buildArgs(2, 0, 'a "b', checker))).toEqual([['a', 0], ['b', 3]]);
        expect(checker.warnings.map(warnShape)).toEqual([{ line: 2, key: 'missing_quotes', start: 2, end: 4 }]);
        expect(checker.minorWarnings).toEqual([]);
    });

    it('anchors missing_quotes at the FIRST quote in the line, not the unclosed one (C# QUIRK)', () => {
        // ScriptChecker.cs:710-713 uses `firstQuote == 0` as its "unset" sentinel, so firstQuote
        // is written once and never updated again. In `a "b" "c` the unclosed quote is at 6, but
        // the reported range starts at 2 -- the first quote, which is correctly closed.
        // Ported verbatim. MUTANT CAUGHT: tracking the position of the actually-unclosed quote,
        // which is what the message implies and is NOT what the C# does.
        const checker = collector();
        expect(shape(buildArgs(0, 0, 'a "b" "c', checker))).toEqual([['a', 0], ['b', 3], ['c', 7]]);
        expect(checker.warnings.map(warnShape)).toEqual([{ line: 0, key: 'missing_quotes', start: 2, end: 8 }]);
    });

    it('emits NOTHING when the checker is null -- the PreprocContainer call shape', () => {
        // ScriptChecker.cs:729 and :760 both gate on `checker is not null`. PreprocContainer
        // (:1790) relies on this: it tokenises every command of every script in the file, and a
        // warning from there would fire once per command with no line context worth reporting.
        // MUTANT CAUGHT: dropping either null guard -- this would throw rather than warn, so the
        // assertion is that it returns normally AND produces the right tokens.
        expect(shape(buildArgs(0, 0, 'narrate "hello"', null))).toEqual([['narrate', 0], ['hello', 9]]);
        expect(shape(buildArgs(0, 0, 'a "b', null))).toEqual([['a', 0], ['b', 3]]);
    });
});
