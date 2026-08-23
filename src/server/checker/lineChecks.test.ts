import { describe, it, expect } from 'vitest';
import { ScriptChecker } from './scriptChecker';
import {
    basicLineFormatCheck,
    checkForBraces,
    checkForOldDefs,
    checkForTabs,
    countPreSpaces
} from './lineChecks';
import { ScriptWarning } from './scriptWarnings';

/**
 * Every expectation in this file was hand-derived from
 * SharpDenizenTools/ScriptAnalysis/ScriptChecker.cs:
 *   - BasicLineFormatCheck  :313-362
 *   - CheckForTabs          :365-379
 *   - CheckForBraces        :381-400
 *   - CheckForOldDefs       :403-419
 *   - CountPreSpaces        :1395-1406
 *   - Run (call order)      :2021-2036
 * Character indices are counted by hand off the literal source strings, never read back out
 * of the implementation.
 */

/** Compact shape for asserting on a warning without repeating the long message strings. */
function shape(w: ScriptWarning): { line: number; key: string; start: number; end: number } {
    return { line: w.line, key: w.warningUniqueKey, start: w.startChar, end: w.endChar };
}

function shapes(list: ScriptWarning[]): { line: number; key: string; start: number; end: number }[] {
    return list.map(shape);
}

// ---------------------------------------------------------------------------
// CountPreSpaces (ScriptChecker.cs:1395-1406)
// ---------------------------------------------------------------------------
describe('countPreSpaces (ScriptChecker.cs:1395-1406)', () => {
    it('counts leading spaces up to the first non-space character', () => {
        expect(countPreSpaces('   x')).toBe(3);
        expect(countPreSpaces('x')).toBe(0);
    });

    it('does NOT treat a tab as a space (the C# compares against literal \' \')', () => {
        // Mutant caught: an implementation using /^\s*/ or a whitespace-class test would
        // return 2 here instead of 0, which would in turn change every continuation-skip
        // decision on tab-indented scripts.
        expect(countPreSpaces('\t x')).toBe(0);
    });

    it('returns the whole length for an all-space line (loop falls off the end)', () => {
        // Mutant caught: a `return -1 if never broke` style implementation.
        expect(countPreSpaces('    ')).toBe(4);
        expect(countPreSpaces('')).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// CheckForTabs (ScriptChecker.cs:365-379)
// ---------------------------------------------------------------------------
describe('checkForTabs (ScriptChecker.cs:365-379)', () => {
    it('warns on the warnings list from the first tab index to the last tab index of the line', () => {
        // lines[1] = "\ta\tb"  ->  indexOf('\t') = 0, lastIndexOf('\t') = 2   (:375)
        const checker = new ScriptChecker('- foo\n\ta\tb');
        checkForTabs(checker);
        // Mutant caught: using indexOf for BOTH ends (end would be 0), or scanning
        // cleanedLines instead of lines (trim() eats the leading tab -> start would be 1).
        expect(shapes(checker.warnings)).toEqual([{ line: 1, key: 'raw_tab_symbol', start: 0, end: 2 }]);
        // Mutant caught: routing this to errors/minorWarnings, which changes the squiggle colour.
        expect(checker.errors).toEqual([]);
        expect(checker.minorWarnings).toEqual([]);
        expect(checker.infos).toEqual([]);
    });

    it('reports at most one raw_tab_symbol per document even when many lines have tabs', () => {
        const checker = new ScriptChecker('\ta\n\tb\n\tc');
        checkForTabs(checker);
        // Mutant caught: removing the `break` at :376. A mere "a warning appears" assertion
        // would still pass under that mutant; the count is what discriminates.
        expect(checker.warnings.length).toBe(1);
        expect(checker.warnings[0].line).toBe(0);
    });

    it('produces nothing for a tab-free document', () => {
        const checker = new ScriptChecker('- foo\n- bar');
        checkForTabs(checker);
        expect(checker.warnings).toEqual([]);
    });

    it('short-circuits on fullOriginalScript, not on the line array (:367)', () => {
        const checker = new ScriptChecker('a\tb');
        // Force the guard's input to disagree with the lines: the whole-document guard must win.
        checker.fullOriginalScript = 'ab';
        checkForTabs(checker);
        // Mutant caught: deleting the guard entirely, or re-deriving it from `lines`. Either
        // would report a raw_tab_symbol here. The guard is what keeps the check cheap on the
        // (overwhelmingly common) clean document.
        expect(checker.warnings).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// CheckForBraces (ScriptChecker.cs:381-400)
// ---------------------------------------------------------------------------
describe('checkForBraces (ScriptChecker.cs:381-400)', () => {
    it('reports brace_syntax on the ERRORS list, spanning first brace to last brace', () => {
        // lines[1] = "  if x { }"
        //             0123456789   -> IndexOfAny = 7, LastIndexOfAny = 9   (:394-395)
        const checker = new ScriptChecker('- foo\n  if x { }');
        checkForBraces(checker);
        // Mutant caught: sending this to `warnings` instead of `errors` -- the user would see a
        // yellow squiggle where the C# shows a red one, and nothing else in the pipeline
        // would notice.
        expect(shapes(checker.errors)).toEqual([{ line: 1, key: 'brace_syntax', start: 7, end: 9 }]);
        expect(checker.warnings).toEqual([]);
        expect(checker.minorWarnings).toEqual([]);
        // Mutant caught: IndexOf('{') / LastIndexOf('{') instead of IndexOfAny/LastIndexOfAny
        // over both brace characters -- that would give end = 7, not 9.
        expect(checker.errors[0].endChar).toBe(9);
    });

    it('reports at most one brace_syntax per document', () => {
        const checker = new ScriptChecker('a {\nb {\nc {');
        checkForBraces(checker);
        // Mutant caught: removing the `break` at :397.
        expect(checker.errors.length).toBe(1);
        expect(checker.errors[0].line).toBe(0);
    });

    it('never checks a document that has no "{" at all, even if a line ends with "}" (:386)', () => {
        const checker = new ScriptChecker('foo }');
        checkForBraces(checker);
        // Mutant caught: "helpfully" widening the guard to Contains('{') || Contains('}').
        // The C# guard deliberately only tests '{', so a stray closing brace with no opener
        // is silently accepted. Ported as written.
        expect(checker.errors).toEqual([]);
    });

    it('ignores a brace that is not the final character of the line', () => {
        const checker = new ScriptChecker('- foo { bar');
        checkForBraces(checker);
        // Mutant caught: using Contains('{') instead of EndsWith on the per-line test (:392).
        expect(checker.errors).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// CheckForOldDefs (ScriptChecker.cs:403-419)
// ---------------------------------------------------------------------------
describe('checkForOldDefs (ScriptChecker.cs:403-419)', () => {
    it('reports old_defs on the warnings list, spanning first "<def[" to last "<def["', () => {
        // "- narrate <def[a]> <def[b]>"
        //  0123456789 -> '<' at 10; "<def[a]>" occupies 10..17; ' ' at 18; second '<' at 19.
        const checker = new ScriptChecker('- narrate <def[a]> <def[b]>');
        checkForOldDefs(checker);
        // Mutant caught: using indexOf for both ends (end would be 10), or measuring the end
        // of the tag rather than the start of the last occurrence.
        expect(shapes(checker.warnings)).toEqual([{ line: 0, key: 'old_defs', start: 10, end: 19 }]);
        // Mutant caught: routing to errors/minorWarnings.
        expect(checker.errors).toEqual([]);
        expect(checker.minorWarnings).toEqual([]);
    });

    it('reports at most one old_defs per document', () => {
        const checker = new ScriptChecker('- a <def[x]>\n- b <def[y]>\n- c <def[z]>');
        checkForOldDefs(checker);
        // Mutant caught: removing the `break` at :416.
        expect(checker.warnings.length).toBe(1);
        expect(checker.warnings[0].line).toBe(0);
    });

    it('leaves modern <[defname]> syntax alone', () => {
        const checker = new ScriptChecker('- narrate <[a]>');
        checkForOldDefs(checker);
        expect(checker.warnings).toEqual([]);
    });

    it('short-circuits on fullOriginalScript, not on the line array (:405)', () => {
        const checker = new ScriptChecker('- narrate <def[a]>');
        checker.fullOriginalScript = '- narrate';
        checkForOldDefs(checker);
        // Mutant caught: deleting the whole-document guard.
        expect(checker.warnings).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// BasicLineFormatCheck -- stray_space_eol (ScriptChecker.cs:318-330)
// ---------------------------------------------------------------------------
describe('basicLineFormatCheck: stray_space_eol (ScriptChecker.cs:318-330)', () => {
    it('starts at the LAST NON-SPACE character, not at the first trailing space', () => {
        // "- foo  " has length 7: indices 0'-' 1' ' 2'f' 3'o' 4'o' 5' ' 6' '.
        // :321-327 walks down from 6 and breaks at 4 ('o'). endChar = Max(0, 4) = 4.
        // end = Max(4, 7 - 1) = 6.
        const checker = new ScriptChecker('- foo  ');
        basicLineFormatCheck(checker);
        // Mutant caught: starting the range at the first trailing space (would be 5), which is
        // the intuitive-but-wrong reading of "stray space after end of line".
        expect(shapes(checker.minorWarnings)).toEqual([
            { line: 0, key: 'stray_space_eol', start: 4, end: 6 }
        ]);
        // Mutant caught: routing to warnings instead of minorWarnings.
        expect(checker.warnings).toEqual([]);
        expect(checker.errors).toEqual([]);
    });

    it('clamps the start to 0 on an all-space line', () => {
        // "   " length 3: the scan runs off the front to -1, then Max(0, -1) = 0 (:328).
        // end = Max(0, 3 - 1) = 2.
        const checker = new ScriptChecker('   ');
        basicLineFormatCheck(checker);
        // Mutant caught: dropping the Math.Max(0, endChar) clamp -- start would be -1, which
        // would later produce an invalid LSP Position.
        expect(shapes(checker.minorWarnings)).toEqual([
            { line: 0, key: 'stray_space_eol', start: 0, end: 2 }
        ]);
    });

    it('is reported per line, unlike the three break-after-first checks', () => {
        const checker = new ScriptChecker('a \nb \nc ');
        basicLineFormatCheck(checker);
        // Mutant caught: adding a `break` here by analogy with CheckForTabs/Braces/OldDefs.
        // BasicLineFormatCheck has no break -- it walks the whole document.
        expect(checker.minorWarnings.length).toBe(3);
        expect(checker.minorWarnings.map((w) => w.line)).toEqual([0, 1, 2]);
    });

    it('pre-empts the dash-continuation branch, so the continuation line is NOT skipped', () => {
        // "- foo  " ends with a space, so :318 wins and the :331 continuation branch is never
        // entered. i is therefore not advanced, and line 1 is judged on its own merits.
        // "    bar": cleaned = "bar", no ':' -> useless_invalid_line.
        //   start = "    bar".indexOf('b') = 4; end = 7 - 1 = 6.
        const checker = new ScriptChecker('- foo  \n    bar');
        basicLineFormatCheck(checker);
        // Mutant caught: turning the if/else-if chain at :318/:331/:352 into independent ifs.
        // Under that mutant line 0 would ALSO take the continuation branch and swallow line 1,
        // dropping the useless_invalid_line.
        expect(shapes(checker.minorWarnings)).toEqual([
            { line: 0, key: 'stray_space_eol', start: 4, end: 6 }
        ]);
        expect(shapes(checker.warnings)).toEqual([
            { line: 1, key: 'useless_invalid_line', start: 4, end: 6 }
        ]);
    });
});

// ---------------------------------------------------------------------------
// BasicLineFormatCheck -- color_code_misformat (ScriptChecker.cs:356-360)
// ---------------------------------------------------------------------------
describe('basicLineFormatCheck: color_code_misformat (ScriptChecker.cs:356-360)', () => {
    it('reports at the section symbol index with a two-character span', () => {
        // "- narrate §c": 0'-' 1' ' 2'n' 3'a' 4'r' 5'r' 6'a' 7't' 8'e' 9' ' 10'§' 11'c'.
        // :359 -> start = 10, end = 10 + 2 = 12 (which is past the end of the 12-char line;
        // that is what the C# writes, and clamping is the publisher's job, not this check's).
        const checker = new ScriptChecker('- narrate §c');
        basicLineFormatCheck(checker);
        // Mutant caught: end = sectionSymbol + 1 (a "one character wide" reading).
        expect(shapes(checker.minorWarnings)).toEqual([
            { line: 0, key: 'color_code_misformat', start: 10, end: 12 }
        ]);
        expect(checker.warnings).toEqual([]);
    });

    it('runs outside the if/else-if chain, so it fires alongside stray_space_eol on one line', () => {
        // "§x " length 3: ends with ' ' -> stray_space_eol, scan from 2(' ') to 1('x'),
        //   start = 1, end = Max(1, 2) = 2.
        // Then, unconditionally, the section-symbol check: start = 0, end = 2.
        const checker = new ScriptChecker('§x ');
        basicLineFormatCheck(checker);
        // Mutant caught: folding the section-symbol check into the else-if chain (:356 sits
        // AFTER the chain closes, at the same nesting level as the `if`). Under that mutant
        // only stray_space_eol would survive.
        expect(shapes(checker.minorWarnings)).toEqual([
            { line: 0, key: 'stray_space_eol', start: 1, end: 2 },
            { line: 0, key: 'color_code_misformat', start: 0, end: 2 }
        ]);
    });

    it('reports at the POST-skip line index while reading the PRE-skip line text (C# quirk)', () => {
        // ScriptChecker.cs:317 binds `line` once at the top of the loop body, but :356-359
        // runs after the continuation `while` at :334-350 has already advanced `i`. So the
        // character index comes from the dash line while the reported line number is the last
        // continuation line. Ported as written.
        //   lines[0] = "- narrate §c"  -> '§' at 10
        //   lines[1] = "    extra"          -> 4 pre-spaces > 0, not "- " -> i becomes 1
        const checker = new ScriptChecker('- narrate §c\n    extra');
        basicLineFormatCheck(checker);
        // Mutant caught (a): failing to advance the shared loop index -- the warning would land
        //   on line 0 AND line 1 would additionally raise useless_invalid_line.
        // Mutant caught (b): re-reading lines[i] for the section check instead of the captured
        //   `line` -- lines[1] has no section symbol, so nothing at all would be reported.
        expect(shapes(checker.minorWarnings)).toEqual([
            { line: 1, key: 'color_code_misformat', start: 10, end: 12 }
        ]);
        expect(checker.warnings).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// BasicLineFormatCheck -- useless_invalid_line (ScriptChecker.cs:352-355)
// ---------------------------------------------------------------------------
describe('basicLineFormatCheck: useless_invalid_line (ScriptChecker.cs:352-355)', () => {
    it('spans the first cleaned character\'s index in the raw line to length - 1', () => {
        // "  foo": cleaned = "foo"; Lines[0].IndexOf('f') = 2; end = 5 - 1 = 4.
        const checker = new ScriptChecker('  foo');
        basicLineFormatCheck(checker);
        // Mutant caught: end = line.length (off-by-one), or start = 0.
        expect(shapes(checker.warnings)).toEqual([
            { line: 0, key: 'useless_invalid_line', start: 2, end: 4 }
        ]);
        // Mutant caught: routing to minorWarnings -- the C# puts this on Warnings (:354).
        expect(checker.minorWarnings).toEqual([]);
        expect(checker.errors).toEqual([]);
    });

    it('yields start = -1 when the raw line starts uppercase, because the C# searches the raw '
        + 'line for the LOWERCASED first cleaned character (:354)', () => {
        // CleanedLines is lowercased (:145), so CleanedLines[0][0] = 'f' while Lines[0] holds
        // 'F'. C# IndexOf(char) is ordinal, so the search misses and returns -1.
        const checker = new ScriptChecker('  Foo');
        basicLineFormatCheck(checker);
        // Mutant caught: any "fix" that finds the first non-whitespace index (2) or does a
        // case-insensitive search. This is a real C# wart; it is ported, not repaired, so that
        // the TS and C# checkers stay diffable.
        expect(shapes(checker.warnings)).toEqual([
            { line: 0, key: 'useless_invalid_line', start: -1, end: 4 }
        ]);
    });

    it('stays quiet for a line containing a colon and for a blank line', () => {
        const checker = new ScriptChecker('foo: bar\n\n   \t   ');
        // Note: line 2 is whitespace-only, so cleanedLines[2] is '' -> the length guard at :352
        // rejects it. (It does end with a space, so it raises stray_space_eol instead.)
        basicLineFormatCheck(checker);
        // Mutant caught: dropping the `CleanedLines[i].Length > 0` guard or the Contains(':')
        // guard at :352.
        expect(checker.warnings).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// BasicLineFormatCheck -- the index-mutating continuation skip (ScriptChecker.cs:331-351)
// ---------------------------------------------------------------------------
describe('basicLineFormatCheck: continuation skipping (ScriptChecker.cs:331-351)', () => {
    it('does not flag a more-indented non-dash line that follows a "- " line', () => {
        const checker = new ScriptChecker('- narrate hi\n    more text');
        basicLineFormatCheck(checker);
        // Mutant caught: implementing the outer walk with forEach/for...of, which cannot
        // advance the shared index -- line 1 would then be judged on its own and raise
        // useless_invalid_line.
        expect(checker.warnings).toEqual([]);
        expect(checker.minorWarnings).toEqual([]);
    });

    it('skips a whole RUN of continuation lines, not just one', () => {
        const checker = new ScriptChecker('- foo\n  a\n  b\n  c');
        basicLineFormatCheck(checker);
        // Mutant caught: replacing the `while` at :334 with a single `if` -- lines 2 and 3
        // would then raise useless_invalid_line.
        expect(checker.warnings).toEqual([]);
    });

    it('stops skipping at the first line that is not more indented than the dash line', () => {
        // "- foo" -> spaces = 0. "  a" (2 > 0) is consumed, i -> 1. "b" has 0 pre-spaces,
        // 0 > 0 is false -> break. The outer loop then lands on line 2:
        //   "b" -> start = "b".indexOf('b') = 0, end = 1 - 1 = 0.
        const checker = new ScriptChecker('- foo\n  a\nb');
        basicLineFormatCheck(checker);
        // Mutant caught: a `while` that consumes every following non-dash line regardless of
        // indentation (dropping the CountPreSpaces comparison at :338).
        expect(shapes(checker.warnings)).toEqual([
            { line: 2, key: 'useless_invalid_line', start: 0, end: 0 }
        ]);
    });

    it('stops skipping at a line that is MORE indented but itself starts with "- "', () => {
        //   lines = ["- foo", "    - bar", "  zap"]
        // Correct: i=0 sees "    - bar" (4 > 0) but cleaned2 starts with "- ", so :338 fails and
        //   the while breaks WITHOUT consuming it. The outer loop then handles line 1 as a dash
        //   line in its own right, with spaces = 4; "  zap" has 2 pre-spaces and 2 > 4 is false,
        //   so it is not consumed either. Line 2 therefore reaches :352:
        //   start = "  zap".indexOf('z') = 2; end = 5 - 1 = 4.
        const checker = new ScriptChecker('- foo\n    - bar\n  zap');
        basicLineFormatCheck(checker);
        // Mutant caught: dropping the `!cleaned2.StartsWith("- ")` half of :338. Line 1 would
        // then be swallowed by line 0's run (4 > 0), and line 2 would be swallowed too, because
        // the run is still measuring against line 0's `spaces` of 0 rather than line 1's 4
        // (2 > 0 holds). The mutant produces NO warning at all.
        expect(shapes(checker.warnings)).toEqual([
            { line: 2, key: 'useless_invalid_line', start: 2, end: 4 }
        ]);
    });

    it('breaks out of the skip run right after a continuation line that ends with ":"', () => {
        // :341-344 -- once a consumed continuation line ends with ':', the while breaks, so the
        // NEXT line is handed back to the outer loop rather than being swallowed too.
        //   lines = ["- foo", "    bar:", "    baz"]
        //   i=0: consume line 1 (4 > 0, not dash) -> i = 1; "bar:" ends with ':' -> break.
        //   outer i++ -> 2: "    baz" cleaned "baz", no ':' -> useless_invalid_line.
        //   start = "    baz".indexOf('b') = 4; end = 7 - 1 = 6.
        const checker = new ScriptChecker('- foo\n    bar:\n    baz');
        basicLineFormatCheck(checker);
        // Mutant caught: removing the EndsWith(':') break at :341-344 -- line 2 would be
        // consumed as a further continuation and no warning would be produced at all.
        expect(shapes(checker.warnings)).toEqual([
            { line: 2, key: 'useless_invalid_line', start: 4, end: 6 }
        ]);
    });

    it('does not start a skip run from a "- " line that ends with ":"', () => {
        // cleaned[0] = "- if <[x]>:" ends with ':' so :331 fails; :352 then also fails because
        // the line contains ':'. Line 1 is therefore judged on its own.
        //   "    foo" -> start = 4, end = 7 - 1 = 6.
        const checker = new ScriptChecker('- if <[x]>:\n    foo');
        basicLineFormatCheck(checker);
        // Mutant caught: dropping the `!CleanedLines[i].EndsWith(':')` half of :331 -- line 1
        // would be swallowed and nothing reported.
        expect(shapes(checker.warnings)).toEqual([
            { line: 1, key: 'useless_invalid_line', start: 4, end: 6 }
        ]);
    });

    it('expands tabs to four spaces when measuring the NEXT line (:336)', () => {
        // lines[1] = "\tbar" -> Replace("\t", "    ") -> "    bar" -> 4 pre-spaces > 0, so it
        // is consumed as a continuation.
        const checker = new ScriptChecker('- foo\n\tbar');
        basicLineFormatCheck(checker);
        // Mutant caught: omitting the tab->4-spaces replacement -- CountPreSpaces("\tbar") is 0,
        // 0 > 0 is false, the while breaks, and line 1 raises useless_invalid_line.
        expect(checker.warnings).toEqual([]);
    });

    it('does NOT expand tabs when measuring the CURRENT dash line (the :333/:336 asymmetry)', () => {
        // :333 calls CountPreSpaces(line) on the RAW current line, while :336 replaces tabs on
        // the next line first. So "\t- foo" measures as 0 pre-spaces, not 4.
        //   lines[1] = "  bar" -> 2 pre-spaces > 0 -> consumed.
        const checker = new ScriptChecker('\t- foo\n  bar');
        basicLineFormatCheck(checker);
        // Mutant caught: "tidying up" the asymmetry by replacing tabs on the current line too --
        // spaces would become 4, 2 > 4 is false, the while breaks, and line 1 raises
        // useless_invalid_line. The asymmetry looks like a C# bug but is ported verbatim.
        expect(checker.warnings).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// ScriptChecker.run() wiring (ScriptChecker.cs:2021-2036)
// ---------------------------------------------------------------------------
describe('ScriptChecker.run() wiring (ScriptChecker.cs:2021-2036)', () => {
    it('clears comments BEFORE running the line checks', () => {
        // The comment on line 0 contains a tab. ClearCommentsFromLines (:2024) blanks Lines[0],
        // so CheckForTabs (:2028) can no longer see it and reports line 1 instead.
        //   lines[1] = "- foo\tbar" -> indexOf('\t') = 5, lastIndexOf('\t') = 5.
        const checker = new ScriptChecker('#\tcomment\n- foo\tbar');
        checker.run();
        // Mutant caught: calling the line checks before clearCommentsFromLines -- the tab
        // warning would land on line 0, inside a comment the user cannot act on.
        const tabWarnings = checker.warnings.filter((w) => w.warningUniqueKey === 'raw_tab_symbol');
        expect(shapes(tabWarnings)).toEqual([{ line: 1, key: 'raw_tab_symbol', start: 5, end: 5 }]);
    });

    it('runs all four checks, in the C# order', () => {
        // lines[0] = "- narrate <def[a]> "  (19 chars, trailing space)
        //   :318 stray_space_eol -> scan from 18(' ') breaks at 17('>'); start 17, end Max(17,18)=18.
        //   "<def[" first/last occurrence both at 10.
        // lines[1] = "on foo: {"  -> 0'o'1'n'2' '3'f'4'o'5'o'6':'7' '8'{'; brace start/end = 8.
        // lines[2] = "\tbar" -> cleaned "bar", no ':' -> useless_invalid_line,
        //   start = "\tbar".indexOf('b') = 1, end = 4 - 1 = 3; tab at index 0 (first and last).
        const checker = new ScriptChecker('- narrate <def[a]> \non foo: {\n\tbar');
        checker.run();
        // Mutant caught: reordering the four calls at :2027-2030. The `warnings` list preserves
        // insertion order, so BasicLineFormatCheck's useless_invalid_line must precede
        // CheckForTabs' raw_tab_symbol, which must precede CheckForOldDefs' old_defs.
        expect(shapes(checker.warnings)).toEqual([
            { line: 2, key: 'useless_invalid_line', start: 1, end: 3 },
            { line: 2, key: 'raw_tab_symbol', start: 0, end: 0 },
            { line: 0, key: 'old_defs', start: 10, end: 10 }
        ]);
        // Mutant caught: dropping any one of the four calls from run().
        expect(shapes(checker.errors)).toEqual([{ line: 1, key: 'brace_syntax', start: 8, end: 8 }]);
        expect(shapes(checker.minorWarnings)).toEqual([
            { line: 0, key: 'stray_space_eol', start: 17, end: 18 }
        ]);
    });

    it('honours ##ignorewarning for a line check, since comments are cleared first', () => {
        const checker = new ScriptChecker('##ignorewarning raw_tab_symbol\n- foo\tbar');
        checker.run();
        // Mutant caught: bypassing WarningCollector.warn (e.g. pushing straight onto the list)
        // in any of the four checks -- the ignore directive would stop working.
        expect(checker.warnings.filter((w) => w.warningUniqueKey === 'raw_tab_symbol')).toEqual([]);
        expect(checker.ignoredWarnings).toBe(1);
    });
});
