"use strict";
// The five line-level checks: four ported from SharpDenizenTools' ScriptChecker.cs:313-419,
// plus `checkForColorCodes`, which has no C# counterpart of its own (see below).
// This module must stay dependency-free: no `vscode-languageserver` import, no I/O.
//
// Each check takes the `ScriptChecker` as its first argument rather than living on the class,
// so that the class stays a data carrier and each check can be unit-tested in isolation. The
// C# call order is reproduced by `ScriptChecker.run()` (ScriptChecker.cs:2027-2030).
//
// Porting rule for this file: the C# is the specification, warts included. Several behaviours
// below look like bugs (see the NOTE comments). They are ported verbatim so the TS and C#
// checkers stay diffable and produce identical diagnostics; "fixing" one here would silently
// diverge the two implementations.
//
// There is exactly ONE intentional exception to that rule: `checkForColorCodes`, which is a
// fifth function with no C# counterpart, split out of `BasicLineFormatCheck` to repair two
// defects in the section-symbol check. It is labelled DELIBERATE DEVIATION at its definition
// and is the only place where this port knowingly disagrees with the C#. Anything else that
// differs is a bug in this file.
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkForOldDefs = exports.checkForBraces = exports.checkForTabs = exports.checkForColorCodes = exports.basicLineFormatCheck = exports.countPreSpaces = void 0;
/** The section symbol (U+00A7), misused for Minecraft color codes. (ScriptChecker.cs:356) */
const SECTION_SYMBOL = '§';
/** ScriptChecker.cs:381 (`BracesChars`). */
const BRACE_CHARS = ['{', '}'];
/**
 * Counts the number of spaces in front of a line.
 * Ported from ScriptChecker.cs:1395-1406.
 *
 * NOTE: only the literal space character counts. A tab is a non-space and terminates the
 * count immediately, which is why callers that care about tab-indented scripts pre-expand
 * tabs themselves (see `basicLineFormatCheck`).
 */
function countPreSpaces(line) {
    // ScriptChecker.cs:1397-1405
    let spaces;
    for (spaces = 0; spaces < line.length; spaces++) {
        if (line[spaces] !== ' ') {
            break;
        }
    }
    return spaces;
}
exports.countPreSpaces = countPreSpaces;
/** C#'s `string.IndexOfAny(char[])`: the lowest index at which any of `chars` occurs, else -1. */
function indexOfAny(line, chars) {
    for (let i = 0; i < line.length; i++) {
        if (chars.includes(line[i])) {
            return i;
        }
    }
    return -1;
}
/** C#'s `string.LastIndexOfAny(char[])`: the highest index at which any of `chars` occurs, else -1. */
function lastIndexOfAny(line, chars) {
    for (let i = line.length - 1; i >= 0; i--) {
        if (chars.includes(line[i])) {
            return i;
        }
    }
    return -1;
}
/**
 * Checks the basic format of every line of the script, to locate stray text or useless lines.
 * Ported from ScriptChecker.cs:312-362, EXCEPT the section-symbol check at :356-360, which now
 * lives in `checkForColorCodes` (see the DELIBERATE DEVIATION note there).
 *
 * Unlike the tabs/braces/old-defs checks in this file, this one has no `break`: it walks the
 * whole document and can report many times. (`checkForColorCodes`, the fifth check, is the
 * other one with no `break` -- it was split out of this very loop.)
 *
 * The loop deliberately uses a `for` with an inner `while` over a SHARED index `i`
 * (ScriptChecker.cs:334-350). The inner loop advances `i` past continuation lines so the outer
 * loop never sees them. A `for...of`/`forEach` cannot express that, and would emit a spurious
 * `useless_invalid_line` for every continuation line in every script.
 */
function basicLineFormatCheck(checker) {
    const lines = checker.lines;
    const cleanedLines = checker.cleanedLines;
    // ScriptChecker.cs:315
    for (let i = 0; i < lines.length; i++) {
        // ScriptChecker.cs:317. `line` is bound ONCE here, before the continuation `while` below
        // may advance `i`, so after a skip run `line` and `lines[i]` refer to different lines.
        // That is harmless for the three branches below (they all run before the skip), but it
        // is what broke the section-symbol check; see the DELIBERATE DEVIATION note on
        // `checkForColorCodes`.
        const line = lines[i];
        if (line.endsWith(' ')) {
            // ScriptChecker.cs:318-330. NOTE the range: the warning STARTS at the last
            // non-space character, not at the first stray space.
            let endChar;
            // ScriptChecker.cs:321-327
            for (endChar = line.length - 1; endChar >= 0; endChar--) {
                if (line[endChar] !== ' ') {
                    break;
                }
            }
            // ScriptChecker.cs:328: an all-space line runs the scan off the front to -1; clamp
            // it so the range never starts before the line does.
            endChar = Math.max(0, endChar);
            checker.warn(checker.minorWarnings, i, 'stray_space_eol', 'Stray space after end of line (possible copy/paste mixup. Enable View->Render Whitespace in VS Code).', endChar, Math.max(endChar, line.length - 1));
        }
        else if (cleanedLines[i].startsWith('- ') && !cleanedLines[i].endsWith(':')) {
            // ScriptChecker.cs:331-351: a command line. Everything indented further than it,
            // and not itself a command, is a continuation of it (a command's argument block)
            // rather than a line of its own, so consume those lines here.
            //
            // NOTE the tab asymmetry between :333 and :336: the CURRENT line is measured raw,
            // so a tab-indented command counts as 0 pre-spaces, while the NEXT line has its
            // tabs expanded to four spaces before being measured. It looks like a bug -- the
            // two sides of the `>` comparison are measured in different units -- but it is
            // what the C# does, so it is what the TS does.
            const spaces = countPreSpaces(line); // ScriptChecker.cs:333
            while (i + 1 < lines.length) {
                // ScriptChecker.cs:336
                const line2 = lines[i + 1].replaceAll('\t', '    ');
                // ScriptChecker.cs:337
                const cleaned2 = cleanedLines[i + 1];
                if (countPreSpaces(line2) > spaces && !cleaned2.startsWith('- ')) {
                    // ScriptChecker.cs:340: THIS is the index mutation. Advancing the outer
                    // loop's `i` is the whole point of this branch -- it is what stops the
                    // consumed line from being judged as a standalone line further down.
                    i++;
                    // ScriptChecker.cs:341-344: a consumed line that ends with ':' opens a
                    // sub-block, so stop the run here and hand the following line back to the
                    // outer loop.
                    if (cleaned2.endsWith(':')) {
                        break;
                    }
                }
                else {
                    // ScriptChecker.cs:346-349
                    break;
                }
            }
        }
        else if (cleanedLines[i].length > 0 && !cleanedLines[i].includes(':')) {
            // ScriptChecker.cs:352-355.
            // NOTE the start index: `Lines[i].IndexOf(CleanedLines[i][0])`. `cleanedLines` is
            // lowercased (ScriptChecker.cs:145) while `lines` is not, and C#'s IndexOf(char) is
            // ordinal, so a raw line whose first non-space character is uppercase searches for
            // its own lowercase form, misses, and yields -1. Ported as written.
            checker.warn(checker.warnings, i, 'useless_invalid_line', 'Useless/invalid line (possibly missing a `-` or a `:`, or just accidentally hit enter or paste).', lines[i].indexOf(cleanedLines[i][0]), lines[i].length - 1);
        }
        // The section-symbol check that ScriptChecker.cs runs here (:356-360) has been moved out
        // of this loop into `checkForColorCodes` below. See the DELIBERATE DEVIATION note there.
    }
}
exports.basicLineFormatCheck = basicLineFormatCheck;
/**
 * Checks for the section symbol being misused for color codes, and warns.
 *
 * ---------------------------------------------------------------------------
 * DELIBERATE DEVIATION FROM ScriptChecker.cs -- NOT a porting mistake.
 * ---------------------------------------------------------------------------
 * In the C#, this check is not a function at all: it is the tail of the
 * `BasicLineFormatCheck` loop body (ScriptChecker.cs:356-360). It reads `line`, which is bound
 * once at the top of that body (:317), but reports against `i`, which the continuation-skip
 * `while` (:334-350) may have advanced in between. That mismatch causes two distinct defects:
 *
 *   1. WRONG LINE. A command line containing the symbol that is followed by continuation lines
 *      is reported at the LAST continuation line's number, with the character index taken from
 *      the command line. For `"- narrate §c"` + `"    extra"`, the C# reports line 1 col 10 --
 *      but line 1 is `"    extra"`, which is 9 characters long and contains no section symbol.
 *   2. NEVER REPORTED. A symbol on a line that the skip run CONSUMES is missed entirely,
 *      because `line` is never rebound to it. For `"- narrate hi"` + `"    §c"`, the C# reports
 *      nothing at all. This is the more serious of the two: a real misuse goes undiagnosed.
 *
 * Both were verified against the faithful port before this change. Fixing them was a USER
 * RULING during review of Phase 2C-1 Task 3, taken knowingly in preference to bug-for-bug
 * fidelity, on the grounds that a diagnostic pointing at the wrong line is worse than no
 * diagnostic, and a missed one defeats the check's purpose.
 *
 * Hoisting the scan into its own pass over `lines` fixes both halves at once -- each line is
 * scanned as itself, so the line number and the column always agree -- and is easier to reason
 * about than threading a captured line number through the skip loop. The whole-document guard
 * keeps the keystroke cost where it was.
 *
 * Everything OBSERVABLE about an individual warning is unchanged from the C#: same key, same
 * `minorWarnings` list, same message, same `(index, index + 2)` range. Only the line it is
 * attached to differs, and only in the two cases above.
 */
function checkForColorCodes(checker) {
    // Cheap whole-document guard, in the style of the three checks below (e.g. :367, :386,
    // :405). The C# has no equivalent because this scan was inline in a loop that runs anyway;
    // adding one keeps a clean document as cheap as it was before the hoist.
    if (!checker.fullOriginalScript.includes(SECTION_SYMBOL)) {
        return;
    }
    // No `break`: like the rest of BasicLineFormatCheck, and unlike the tabs/braces/old-defs
    // checks, this reports once per offending line rather than once per document.
    for (let i = 0; i < checker.lines.length; i++) {
        // ScriptChecker.cs:356 -- but reading lines[i], the line actually being reported on.
        const sectionSymbol = checker.lines[i].indexOf(SECTION_SYMBOL);
        if (sectionSymbol !== -1) {
            // ScriptChecker.cs:357-360, range unchanged.
            checker.warn(checker.minorWarnings, i, 'color_code_misformat', "Don't use the section symbol for color codes, instead use tags: like <&c>, <red> or <&color[red]>.", sectionSymbol, sectionSymbol + 2);
        }
    }
}
exports.checkForColorCodes = checkForColorCodes;
/**
 * Checks if "\t" tabs are used (instead of spaces). If so, warning.
 * Ported from ScriptChecker.cs:364-379.
 *
 * Reports ONCE per document (`break` at :376), on the warnings list.
 */
function checkForTabs(checker) {
    // ScriptChecker.cs:367-370: cheap whole-document guard, tested against the ORIGINAL script
    // text. This is what keeps the check free on a clean document -- i.e. on every keystroke in
    // a healthy file -- so it must not be replaced by a scan of `lines`.
    if (!checker.fullOriginalScript.includes('\t')) {
        return;
    }
    // ScriptChecker.cs:371-378
    for (let i = 0; i < checker.lines.length; i++) {
        if (checker.lines[i].includes('\t')) {
            checker.warn(checker.warnings, i, 'raw_tab_symbol', 'This script uses the raw tab symbol. Please switch these out for 2 or 4 spaces.', checker.lines[i].indexOf('\t'), checker.lines[i].lastIndexOf('\t'));
            break;
        }
    }
}
exports.checkForTabs = checkForTabs;
/**
 * Checks if { braces } are used (instead of modern "colon:" syntax). If so, error.
 * Ported from ScriptChecker.cs:383-400.
 *
 * Reports ONCE per document (`break` at :397), and onto the ERRORS list -- not `warnings` --
 * because braced syntax is a hard incompatibility, not a style nit.
 */
function checkForBraces(checker) {
    // ScriptChecker.cs:386-389. NOTE: the guard tests only for '{', while the per-line test
    // below accepts either brace. A document whose only brace is a stray '}' is therefore never
    // checked at all. Ported as written.
    if (!checker.fullOriginalScript.includes('{')) {
        return;
    }
    // ScriptChecker.cs:390-399
    for (let i = 0; i < checker.lines.length; i++) {
        if (checker.lines[i].endsWith('{') || checker.lines[i].endsWith('}')) {
            // ScriptChecker.cs:394-395: the range spans the first brace of EITHER kind to the
            // last brace of either kind, not just the trailing one.
            const start = indexOfAny(checker.lines[i], BRACE_CHARS);
            const end = lastIndexOfAny(checker.lines[i], BRACE_CHARS);
            checker.warn(checker.errors, i, 'brace_syntax', "This script uses outdated { braced } syntax. Please update to modern 'colon:' syntax. Refer to <https://guide.denizenscript.com/guides/troubleshooting/updates-since-videos.html#colon-syntax> for more info.", start, end);
            break;
        }
    }
}
exports.checkForBraces = checkForBraces;
/**
 * Checks if &lt;def[oldDefs]&gt; are used (instead of modern "&lt;[defname]&gt;" syntax).
 * If so, warning. Ported from ScriptChecker.cs:402-419.
 *
 * Reports ONCE per document (`break` at :416), on the warnings list.
 */
function checkForOldDefs(checker) {
    // ScriptChecker.cs:405-408: whole-document guard against the original script text.
    if (!checker.fullOriginalScript.includes('<def[')) {
        return;
    }
    // ScriptChecker.cs:409-418
    for (let i = 0; i < checker.lines.length; i++) {
        if (checker.lines[i].includes('<def[')) {
            // ScriptChecker.cs:413-414: both ends are the START index of an occurrence -- the
            // end is where the LAST `<def[` begins, not where it finishes.
            const start = checker.lines[i].indexOf('<def[');
            const end = checker.lines[i].lastIndexOf('<def[');
            checker.warn(checker.warnings, i, 'old_defs', "This script uses <def[old-defs]>. Please update to modern '<[defname]>' syntax. Refer to <https://guide.denizenscript.com/guides/troubleshooting/updates-since-videos.html#definition-syntax> for more info.", start, end);
            break;
        }
    }
}
exports.checkForOldDefs = checkForOldDefs;
//# sourceMappingURL=lineChecks.js.map