import { describe, it, expect } from 'vitest';
import { ScriptChecker } from './scriptChecker';
import {
    basicLineFormatCheck,
    checkForBraces,
    checkForColorCodes,
    checkForOldDefs,
    checkForTabs,
    countPreSpaces
} from './lineChecks';
// `import type`: ScriptWarning is an interface, used only in type position by the helpers
// below, and matches the type-only import lineChecks.ts uses for ScriptChecker.
import type { ScriptWarning } from './scriptWarnings';

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
 *
 * TWO describe blocks assert behaviour that deliberately DIFFERS from the C#, by user ruling:
 *   - `checkForColorCodes` (the section-symbol line/column mismatch);
 *   - `basicLineFormatCheck: useless_invalid_line` (the range's start and end).
 * Both are labelled as such, with their defects spelled out. Every other expectation in this
 * file is the C#'s behaviour, warts included.
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
        // Mutant caught: a count that does not stop at the first non-space (returns 4 for
        // "   x"), or an off-by-one that returns the INDEX of the first non-space rather than
        // the count of spaces before it -- the "x" case pins that, since 0 spaces and index 0
        // only agree when the answer is 0.
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
        // Mutant caught: a per-line test that matches whitespace generally (/\s/, or trimming
        // and comparing lengths) rather than the literal tab character -- these two lines both
        // contain spaces, so such a mutant would warn on line 0.
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
        // Mutant caught: loosening the needle from the literal "<def[" to something that also
        // matches modern definition tags -- e.g. testing for "<[" or for "def" alone. This is
        // the false-positive direction, and it would fire on correct, modern script.
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
        //   start = first non-whitespace of "    bar" = 4; end = length = 7 (see the
        //   DELIBERATE DEVIATION describe block below for why the end is the full length).
        const checker = new ScriptChecker('- foo  \n    bar');
        basicLineFormatCheck(checker);
        // Mutant caught: turning the if/else-if chain at :318/:331/:352 into independent ifs.
        // Under that mutant line 0 would ALSO take the continuation branch and swallow line 1,
        // dropping the useless_invalid_line.
        expect(shapes(checker.minorWarnings)).toEqual([
            { line: 0, key: 'stray_space_eol', start: 4, end: 6 }
        ]);
        expect(shapes(checker.warnings)).toEqual([
            { line: 1, key: 'useless_invalid_line', start: 4, end: 7 }
        ]);
    });
});

// ---------------------------------------------------------------------------
// checkForColorCodes -- DELIBERATE DEVIATION from ScriptChecker.cs:356-360.
//
// In the C# this scan is the tail of the BasicLineFormatCheck loop body: it reads `line`
// (bound once at :317) but reports against `i` (which the skip `while` at :334-350 may have
// advanced). That produced two defects, both confirmed against the faithful port before this
// change and both fixed here by a user ruling during review:
//   1. a symbol on a command line followed by continuations was reported on the WRONG line;
//   2. a symbol on a CONSUMED continuation line was never reported at all.
// The warning itself -- key, list, message, (index, index + 2) range -- is unchanged.
// ---------------------------------------------------------------------------
describe('checkForColorCodes (deviation from ScriptChecker.cs:356-360)', () => {
    it('reports at the section symbol index with a two-character span', () => {
        // "- narrate §c": 0'-' 1' ' 2'n' 3'a' 4'r' 5'r' 6'a' 7't' 8'e' 9' ' 10'§' 11'c'.
        // start = 10, end = 10 + 2 = 12 (past the end of the 12-char line; that is what the C#
        // writes, and clamping is the publisher's job, not this check's).
        const checker = new ScriptChecker('- narrate §c');
        checkForColorCodes(checker);
        // Mutant caught: end = sectionSymbol + 1 (a "one character wide" reading).
        expect(shapes(checker.minorWarnings)).toEqual([
            { line: 0, key: 'color_code_misformat', start: 10, end: 12 }
        ]);
        expect(checker.warnings).toEqual([]);
        expect(checker.errors).toEqual([]);
    });

    it('reports the symbol on ITS OWN line and column when the line is a command line '
        + 'followed by continuations (defect 1: was reported on the wrong line)', () => {
        //   lines[0] = "- narrate §c" -> '§' at 10
        //   lines[1] = "    extra"    -> consumed by basicLineFormatCheck's skip run
        // Corrected expectation: line 0, start 10. The pre-fix code reported line 1 col 10,
        // where line 1 is "    extra" -- 9 characters, no section symbol anywhere in it.
        const checker = new ScriptChecker('- narrate §c\n    extra');
        checkForColorCodes(checker);
        // Mutant caught: reverting to the C# shape, i.e. folding this scan back into
        // basicLineFormatCheck's loop so it reads a `line` captured before the skip run --
        // the warning would move to line 1.
        expect(shapes(checker.minorWarnings)).toEqual([
            { line: 0, key: 'color_code_misformat', start: 10, end: 12 }
        ]);
    });

    it('reports a symbol on a CONSUMED continuation line (defect 2: was never reported)', () => {
        //   lines[0] = "- narrate hi" -> no symbol
        //   lines[1] = "    §c": 0' ' 1' ' 2' ' 3' ' 4'§' 5'c' -> '§' at 4, so start = 4, end = 6.
        // Line 1 is swallowed by the skip run (4 pre-spaces > 0, not a dash), so the pre-fix
        // code never rebound `line` to it and reported NOTHING. Verified empirically against
        // the faithful port: minorWarnings was [].
        const checker = new ScriptChecker('- narrate hi\n    §c');
        checkForColorCodes(checker);
        // Mutant caught: any implementation that scans only the lines the outer
        // basicLineFormatCheck loop visits (i.e. that skips consumed continuation lines) --
        // this is the exact defect the deviation exists to fix, so it is the one that must not
        // silently come back.
        expect(shapes(checker.minorWarnings)).toEqual([
            { line: 1, key: 'color_code_misformat', start: 4, end: 6 }
        ]);
    });

    it('reports once per offending line, with no break after the first', () => {
        //   lines[0] = "§a" -> 0; lines[1] = "b"; lines[2] = " §c" -> 1.
        const checker = new ScriptChecker('§a\nb\n §c');
        checkForColorCodes(checker);
        // Mutant caught: adding a `break` by false analogy with checkForTabs/Braces/OldDefs,
        // which DO report once per document. This check does not -- it inherited
        // BasicLineFormatCheck's per-line behaviour.
        expect(shapes(checker.minorWarnings)).toEqual([
            { line: 0, key: 'color_code_misformat', start: 0, end: 2 },
            { line: 2, key: 'color_code_misformat', start: 1, end: 3 }
        ]);
    });

    it('reports only the FIRST symbol on a line (dedup is per (line, key))', () => {
        //   "§a§b": symbols at 0 and 2; indexOf finds 0, and WarningCollector.warn dedups the
        //   second on (line, key) even if a mutant tried to emit it.
        const checker = new ScriptChecker('§a§b');
        checkForColorCodes(checker);
        // Mutant caught: using lastIndexOf instead of indexOf -- start would be 2, not 0.
        expect(shapes(checker.minorWarnings)).toEqual([
            { line: 0, key: 'color_code_misformat', start: 0, end: 2 }
        ]);
    });

    it('short-circuits on fullOriginalScript, not on the line array', () => {
        const checker = new ScriptChecker('- narrate §c');
        checker.fullOriginalScript = '- narrate c';
        checkForColorCodes(checker);
        // Mutant caught: dropping the whole-document guard. The guard is why hoisting this into
        // its own pass did not add a per-keystroke full-document scan to clean files.
        expect(checker.minorWarnings).toEqual([]);
    });

    it('is NOT emitted by basicLineFormatCheck any more (the scan was hoisted out)', () => {
        const checker = new ScriptChecker('- narrate §c');
        basicLineFormatCheck(checker);
        // Mutant caught: leaving the original inline scan in place while ALSO adding the new
        // pass -- run() would then emit the warning twice, once on the right line and once on
        // the wrong one. Per-list dedup on (line, key) would not merge them, because the whole
        // point of defect 1 is that the two land on DIFFERENT lines.
        expect(checker.minorWarnings).toEqual([]);
        expect(checker.warnings).toEqual([]);
    });

    it('fires alongside stray_space_eol on one line, in that order, via run()', () => {
        // "§x " length 3: basicLineFormatCheck sees it end with ' ' -> stray_space_eol, scan
        //   from 2(' ') to 1('x'): start = 1, end = Max(1, 2) = 2.
        // checkForColorCodes then adds the symbol warning: start = 0, end = 2.
        const checker = new ScriptChecker('§x ');
        checker.run();
        // Mutant caught: ordering checkForColorCodes BEFORE basicLineFormatCheck in run(), which
        // would swap these two entries. Both land on minorWarnings at the same line with
        // different keys, so insertion order is the only thing that distinguishes them.
        expect(shapes(checker.minorWarnings)).toEqual([
            { line: 0, key: 'stray_space_eol', start: 1, end: 2 },
            { line: 0, key: 'color_code_misformat', start: 0, end: 2 }
        ]);
    });
});

// ---------------------------------------------------------------------------
// BasicLineFormatCheck -- useless_invalid_line: DELIBERATE DEVIATION from
// ScriptChecker.cs:352-355.
//
// The C# computes the range as (Lines[i].IndexOf(CleanedLines[i][0]), Lines[i].Length - 1).
// Both ends are wrong, and both were reproduced against the faithful port before this change:
//   1. START. CleanedLines is trimmed AND lowercased (:145) while Lines is raw, so on a line
//      whose first non-space character is uppercase the ordinal IndexOf searches for a
//      lowercase letter that is not there and returns -1. DiagnosticProvider.cs:86-92 clamps
//      that to 0 -- and logs it to stderr as an anomaly -- so the squiggle lands on column 0,
//      i.e. on the INDENT, instead of on the offending text. Measured: "    Narrate <[x]>"
//      published as 0-16.
//   2. END. LSP ranges are end-exclusive, so `Length - 1` never covers the line's LAST
//      character. Measured on every instance, not just uppercase ones:
//      "    <player.as_decimal123.zsszxfdfs>" (36 chars) published as 4-35, dropping the '>'.
// Fixing both was a USER RULING. Corrected: start = the index of the first non-whitespace
// character of the RAW line; end = the full line length. Everything else about the warning --
// key, `warnings` list, message, and WHETHER it fires at all -- is unchanged from the C#.
// ---------------------------------------------------------------------------
describe('basicLineFormatCheck: useless_invalid_line (deviation from ScriptChecker.cs:352-355)', () => {
    it('spans the first non-whitespace character to the full line length', () => {
        // "  foo": first non-whitespace at 2; end = length = 5.
        const checker = new ScriptChecker('  foo');
        basicLineFormatCheck(checker);
        // Mutant caught: reverting the end to `line.length - 1` (the C# shape), which would
        // give 4 and leave the final 'o' outside the squiggle; or start = 0 (the indent).
        expect(shapes(checker.warnings)).toEqual([
            { line: 0, key: 'useless_invalid_line', start: 2, end: 5 }
        ]);
        // Mutant caught: routing to minorWarnings -- the C# puts this on Warnings (:354).
        expect(checker.minorWarnings).toEqual([]);
        expect(checker.errors).toEqual([]);
    });

    it('starts at the first non-whitespace character when that character is UPPERCASE '
        + '(defect 1: start was -1, published as column 0 -- the indent)', () => {
        // This is the shape the user actually reported. "    Narrate <[x]>" is 17 characters:
        // 0-3 spaces, 4 'N', ... 16 '>'. Corrected: start = 4, end = 17.
        // Pre-fix the C# port computed "    Narrate <[x]>".indexOf('n') -- 'Narrate' holds no
        // LOWERCASE 'n' -- which is -1, clamped by buildDiagnostics to 0.
        const checker = new ScriptChecker('    Narrate <[x]>');
        basicLineFormatCheck(checker);
        // Mutant caught: reverting to `lines[i].indexOf(cleanedLines[i][0])`, which yields -1
        // here. This is THE defect the deviation exists to fix, so it is the one that must not
        // silently come back. A case-insensitive indexOf would also pass this line but is
        // pinned separately by the tab case below.
        expect(shapes(checker.warnings)).toEqual([
            { line: 0, key: 'useless_invalid_line', start: 4, end: 17 }
        ]);
    });

    it('measures a TAB indent as whitespace too, so the squiggle clears it', () => {
        // "\tNarrate <[x]>" is 14 characters: 0 '\t', 1 'N', ... 13 '>'. The first
        // non-whitespace character is at 1, so start = 1, end = 14.
        const checker = new ScriptChecker('\tNarrate <[x]>');
        basicLineFormatCheck(checker);
        // Mutant caught: measuring the indent with `countPreSpaces` (the file's port of
        // ScriptChecker.cs:1395) instead of a first-non-whitespace search. countPreSpaces
        // counts LITERAL spaces only and a tab terminates its count, so it returns 0 here --
        // putting the squiggle back on the indent, which is the exact defect being fixed, just
        // for tab-indented scripts. Also caught: a case-insensitive indexOf "fix" for defect 1,
        // which would find 'N' at 1 here but 0 on a line indented with spaces before an
        // uppercase word only by coincidence -- it never looks at whitespace at all.
        expect(shapes(checker.warnings)).toEqual([
            { line: 0, key: 'useless_invalid_line', start: 1, end: 14 }
        ]);
    });

    it('still FIRES on a bare tag line -- only the range moved, never the trigger', () => {
        // "    <[x]>" is 9 characters; cleaned = "<[x]>", non-empty and colon-free, so :352
        // holds. A bare tag on its own line genuinely is an invalid Denizen line.
        const checker = new ScriptChecker('    <[x]>');
        basicLineFormatCheck(checker);
        // Mutant caught: "fixing" the range by narrowing the :352 guard (e.g. skipping lines
        // that are entirely a tag), which would silence a correct diagnostic.
        expect(shapes(checker.warnings)).toEqual([
            { line: 0, key: 'useless_invalid_line', start: 4, end: 9 }
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
        //   "b" -> start = first non-whitespace = 0, end = length = 1.
        const checker = new ScriptChecker('- foo\n  a\nb');
        basicLineFormatCheck(checker);
        // Mutant caught: a `while` that consumes every following non-dash line regardless of
        // indentation (dropping the CountPreSpaces comparison at :338).
        expect(shapes(checker.warnings)).toEqual([
            { line: 2, key: 'useless_invalid_line', start: 0, end: 1 }
        ]);
    });

    it('stops skipping at a line that is MORE indented but itself starts with "- "', () => {
        //   lines = ["- foo", "    - bar", "  zap"]
        // Correct: i=0 sees "    - bar" (4 > 0) but cleaned2 starts with "- ", so :338 fails and
        //   the while breaks WITHOUT consuming it. The outer loop then handles line 1 as a dash
        //   line in its own right, with spaces = 4; "  zap" has 2 pre-spaces and 2 > 4 is false,
        //   so it is not consumed either. Line 2 therefore reaches :352:
        //   start = first non-whitespace of "  zap" = 2; end = length = 5.
        const checker = new ScriptChecker('- foo\n    - bar\n  zap');
        basicLineFormatCheck(checker);
        // Mutant caught: dropping the `!cleaned2.StartsWith("- ")` half of :338. Line 1 would
        // then be swallowed by line 0's run (4 > 0), and line 2 would be swallowed too, because
        // the run is still measuring against line 0's `spaces` of 0 rather than line 1's 4
        // (2 > 0 holds). The mutant produces NO warning at all.
        expect(shapes(checker.warnings)).toEqual([
            { line: 2, key: 'useless_invalid_line', start: 2, end: 5 }
        ]);
    });

    it('breaks out of the skip run right after a continuation line that ends with ":"', () => {
        // :341-344 -- once a consumed continuation line ends with ':', the while breaks, so the
        // NEXT line is handed back to the outer loop rather than being swallowed too.
        //   lines = ["- foo", "    bar:", "    baz"]
        //   i=0: consume line 1 (4 > 0, not dash) -> i = 1; "bar:" ends with ':' -> break.
        //   outer i++ -> 2: "    baz" cleaned "baz", no ':' -> useless_invalid_line.
        //   start = first non-whitespace of "    baz" = 4; end = length = 7.
        const checker = new ScriptChecker('- foo\n    bar:\n    baz');
        basicLineFormatCheck(checker);
        // Mutant caught: removing the EndsWith(':') break at :341-344 -- line 2 would be
        // consumed as a further continuation and no warning would be produced at all.
        expect(shapes(checker.warnings)).toEqual([
            { line: 2, key: 'useless_invalid_line', start: 4, end: 7 }
        ]);
    });

    it('does not start a skip run from a "- " line that ends with ":"', () => {
        // cleaned[0] = "- if <[x]>:" ends with ':' so :331 fails; :352 then also fails because
        // the line contains ':'. Line 1 is therefore judged on its own.
        //   "    foo" -> start = 4, end = length = 7.
        const checker = new ScriptChecker('- if <[x]>:\n    foo');
        basicLineFormatCheck(checker);
        // Mutant caught: dropping the `!CleanedLines[i].EndsWith(':')` half of :331 -- line 1
        // would be swallowed and nothing reported.
        expect(shapes(checker.warnings)).toEqual([
            { line: 1, key: 'useless_invalid_line', start: 4, end: 7 }
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

    it('runs all five checks, in the C# order', () => {
        // lines[0] = "- narrate <def[a]> "  (19 chars, trailing space)
        //   :318 stray_space_eol -> scan from 18(' ') breaks at 17('>'); start 17, end Max(17,18)=18.
        //   "<def[" first/last occurrence both at 10.
        // lines[1] = "on foo: {"  -> 0'o'1'n'2' '3'f'4'o'5'o'6':'7' '8'{'; brace start/end = 8.
        // lines[2] = "\tbar" -> cleaned "bar", no ':' -> useless_invalid_line,
        //   start = first non-whitespace of "\tbar" = 1, end = length = 4; tab at index 0
        //   (first and last).
        const checker = new ScriptChecker('- narrate <def[a]> \non foo: {\n\tbar');
        checker.run();
        // Mutant caught: reordering the calls at :2027-2030. The `warnings` list preserves
        // insertion order, so BasicLineFormatCheck's useless_invalid_line must precede
        // CheckForTabs' raw_tab_symbol, which must precede CheckForOldDefs' old_defs.
        //
        // LIMITATION, stated rather than papered over: this assertion CANNOT order
        // checkForBraces against its neighbours, because brace_syntax is the only key that
        // lands on `errors` -- swapping checkForBraces with checkForTabs or checkForOldDefs
        // leaves every list below byte-identical. The relative order of the four C# checks has
        // no observable effect anyway (they touch disjoint keys and never dedup against each
        // other); the order that DOES matter is theirs against clearCommentsFromLines, which
        // the two neighbouring tests pin for tabs and for braces respectively.
        //
        // The last two entries arrived with Phase 2C-2 Task 2, which wired
        // `gatherActualContainers` into `run()` (ScriptChecker.cs:2031 -- it runs AFTER the four
        // line checks, hence its warnings sort last). This fixture is deliberately malformed, so
        // the container parser has plenty to say about it; both entries are hand-derived from
        // ScriptChecker.cs and are what the C# `Run()` produces for this same input:
        //   line 0, "- narrate <def[a]> " -- a list entry with no list open (secwaiting and
        //     clist both null) -> weird_line_growth (:1500-1505). The C# range is
        //     (0, line.IndexOf('-')), which for this column-0 line is (0, 0): a ZERO-WIDTH
        //     squiggle showing the user nothing. Corrected by user ruling to span the text,
        //     (0, 19) -- this fixture is exactly the invisible case that motivated the change.
        //   line 2, "\tbar" -- tab-expanded to "    bar" at :1422, so 7 chars; it is not "- ",
        //     does not end ':' and has no ": " -> identifier_missing_line (:1575-1579), range
        //     (0, line.Length) = (0, 7).
        // This assertion is therefore STRICTER than before, not weaker: it now pins five
        // warnings and the position of the gather step within run(), where it pinned three.
        expect(shapes(checker.warnings)).toEqual([
            { line: 2, key: 'useless_invalid_line', start: 1, end: 4 },
            { line: 2, key: 'raw_tab_symbol', start: 0, end: 0 },
            { line: 0, key: 'old_defs', start: 10, end: 10 },
            { line: 0, key: 'weird_line_growth', start: 0, end: 19 },
            { line: 2, key: 'identifier_missing_line', start: 0, end: 7 }
        ]);
        // Mutant caught: dropping any one of the five calls from run().
        //
        // The second entry arrived with Phase 2C-3 Task 4, which wired `convertContainers` into
        // `run()` (ScriptChecker.cs:2032 -- immediately after the gather, hence it sorts after
        // brace_syntax). Hand-derived from the C# BEFORE running it: the gather leaves the root
        // section holding exactly one key, `on foo` (line 1 has ": " so :1570-1574 splits it into
        // key `on foo` and value `{`), and that value is a LineTrackedString rather than a map --
        // so :1695-1699 fires `invalid_container` "missing content?" at the title's line, with
        // range (0, Lines[1].Length) = (0, 9) for the 9-character `on foo: {`.
        // Stricter than before, not weaker: it now also pins the position of the conversion step
        // within run().
        expect(shapes(checker.errors)).toEqual([
            { line: 1, key: 'brace_syntax', start: 8, end: 8 },
            { line: 1, key: 'invalid_container', start: 0, end: 9 }
        ]);
        expect(shapes(checker.minorWarnings)).toEqual([
            { line: 0, key: 'stray_space_eol', start: 17, end: 18 }
        ]);
    });

    it('clears comments before checkForBraces, so a comment ending in "{" is not an error', () => {
        // This is the ordering assertion the "all five checks" test above cannot make: it pins
        // checkForBraces against clearCommentsFromLines, which is the only ordering constraint
        // on it that has an observable effect.
        //   lines[0] = "# a comment {" -> blanked by clearCommentsFromLines, so no line ends
        //   with a brace by the time checkForBraces runs. The whole-document guard still passes,
        //   because fullOriginalScript is never blanked.
        const checker = new ScriptChecker('# a comment {\n- foo');
        checker.run();
        // Mutant caught: hoisting checkForBraces above clearCommentsFromLines in run() -- line 0
        // would raise brace_syntax at start 12, end 12, a red error on a comment.
        expect(checker.errors).toEqual([]);
    });

    it('honours ##ignorewarning for a line check, since comments are cleared first', () => {
        const checker = new ScriptChecker('##ignorewarning raw_tab_symbol\n- foo\tbar');
        checker.run();
        // Mutant caught: bypassing WarningCollector.warn (e.g. pushing straight onto the list)
        // in any of the five checks -- the ignore directive would stop working.
        expect(checker.warnings.filter((w) => w.warningUniqueKey === 'raw_tab_symbol')).toEqual([]);
        expect(checker.ignoredWarnings).toBe(1);
    });
});
