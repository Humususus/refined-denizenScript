// Tag and argument checking, ported from SharpDenizenTools' ScriptChecker.cs:
//   ScriptCheckContext      :772-785
//   ContainsObjectNotation  :1343-1362
//   CheckSingleArgument     :576-624   (Task 3)
//   CheckSingleDataLine     :630-637   (Task 3)
//   CheckSingleTag          :426-525   (Task 4)
//
// THE "checker/ IMPORTS NOTHING" RULE ENDS WITH THIS MODULE, deliberately. It held while the
// checker was pure line-level string processing. Tag checking genuinely needs the meta --
// `Meta.TagBases` and `Meta.TagParts` (ScriptChecker.cs:437, :472), `TagHelper.Parse` (:428) and
// `TagTracer` (:495) -- so this file imports from ../metaDocs and ../providers.
//
// The invariant that still holds, and the one that actually matters, is unchanged: NO
// `vscode-languageserver`, NO `/node`, NO `vscode`, NO I/O. Everything here stays a pure
// function of its inputs, so it remains unit-testable without a language server.
//
// NOTHING CALLS THIS YET. In the C# these functions are driven by `CheckAllContainers`' nested
// `checkAsScript` (:975 onwards), which is Phase 2C-6. Until then this module is complete,
// tested, and unreachable from `run()`.

// `import type` (not a plain import): scriptChecker.ts will import this module for real once
// Phase 2C-6 wires it in, so a value import here would close a require() cycle at runtime. Same
// pattern as lineChecks.ts, containerGather.ts and containerConvert.ts.
import type { ScriptChecker } from './scriptChecker';

/**
 * Context for checking a single script container. Ported from ScriptChecker.cs:772-785.
 *
 * The two "unknowable" flags are the reason this is a class rather than a pair of sets. A script
 * that injects something the checker cannot resolve has definitions it cannot possibly know
 * about; `CheckSingleTag` (:451, :463) reads these flags and suppresses `def_of_nothing` and
 * `entry_of_nothing` ENTIRELY rather than emitting a warning per tag. Without them, one
 * unresolvable inject would paint a whole script red.
 */
export class ScriptCheckContext {
    /** Known definition names. (ScriptChecker.cs:775) */
    definitions: Set<string> = new Set<string>();
    /** Known save-entry names. (:778) */
    saveEntries: Set<string> = new Set<string>();
    /** Injects or other issues make definition names unknowable. (:781) */
    hasUnknowableDefinitions = false;
    /** Injects or other issues make save-entry names unknowable. (:784) */
    hasUnknowableSaveEntries = false;
}

/**
 * The last letter of every real ObjectTag prefix, i.e. the character that may legally sit
 * directly before the `@` of raw object notation. Ported from ScriptChecker.cs:1338
 * (`OBJECT_NOTATION_LAST_LETTER_MATCHER`), transcribed character by character.
 *
 * Lowercase only, and `AsciiMatcher` does not fold case, so `E@1` is NOT object notation.
 */
const OBJECT_NOTATION_LAST_LETTERS = 'mdlipqsebhounwr';

/** A half-open character range, matching what C#'s `Range` gives its consumer at :583-584. */
export interface CharRange {
    /** Index of the first qualifying letter. */
    start: number;
    /** Index of the LAST qualifying `@`. */
    end: number;
}

/**
 * Whether a line contains raw object notation, and where.
 * Ported from ScriptChecker.cs:1343-1362.
 *
 * Returns the widest span between the first qualifying letter and the last qualifying `@` in the
 * line -- `Math.Min`/`Math.Max` across every match, not one range per match, so a line with two
 * notations reports a single range covering everything between them.
 *
 * NOTE `end` is the index OF the '@', not one past it. LSP ranges are end-exclusive, so the
 * published squiggle stops just before the '@' and covers only the type letter. That is what the
 * C# does; it is not corrected here, because no user has reported it and the last three range
 * corrections in this port were each taken as an explicit ruling.
 */
export function containsObjectNotation(line: string): CharRange | null {
    // ScriptChecker.cs:1345-1347
    let first = line.length;
    let last = -1;
    let atIndex = -1;
    // ScriptChecker.cs:1348-1356
    while ((atIndex = line.indexOf('@', atIndex + 1)) !== -1) {
        // The `atIndex > 0` guard is LOAD-BEARING IN C# AND INERT HERE, and is kept for
        // fidelity. C#'s `line[-1]` throws IndexOutOfRange; JS's is `undefined`, and
        // `'mdlipqsebhounwr'.includes(undefined)` coerces to a search for the substring
        // "undefined" and is therefore always false. Deleting the guard is an equivalent mutant
        // in TypeScript -- verified over 55,986 inputs rather than argued -- so no test can
        // cover it, and it stays because relying on that coercion would be a trap for whoever
        // ports the next line.
        if (atIndex > 0 && OBJECT_NOTATION_LAST_LETTERS.includes(line[atIndex - 1])) {
            first = Math.min(first, atIndex - 1);
            last = Math.max(last, atIndex);
        }
    }
    // ScriptChecker.cs:1357-1361. `last` is the sentinel the C# chose; `first` would do just as
    // well, since the two are only ever assigned together inside the `if` above -- swapping them
    // is a second equivalent mutant, verified the same way. Following the C#.
    if (last !== -1) {
        return { start: first, end: last };
    }
    return null;
}

/** The characters that open or close a tag, for the range of `uneven_tags` (ScriptChecker.cs:568). */
const TAG_MARK_CHARS = ['<', '>'];

/** C#'s `string.IndexOfAny(char[])`: the lowest index at which any of `chars` occurs, else -1. */
function indexOfAny(text: string, chars: string[]): number {
    for (let i = 0; i < text.length; i++) {
        if (chars.includes(text[i])) {
            return i;
        }
    }
    return -1;
}

/** C#'s `string.LastIndexOfAny(char[])`. */
function lastIndexOfAny(text: string, chars: string[]): number {
    for (let i = text.length - 1; i >= 0; i--) {
        if (chars.includes(text[i])) {
            return i;
        }
    }
    return -1;
}

/** Counts occurrences of a single character. C#'s `string.CountCharacter` (FreneticUtilities). */
function countCharacter(text: string, ch: string): number {
    let count = 0;
    for (const c of text) {
        if (c === ch) {
            count++;
        }
    }
    return count;
}

/**
 * Called for each tag found inside an argument. Task 4's `checkSingleTag` is the real one; the
 * parameter exists so the extraction loop can be tested on its own, and so this module has no
 * forward reference to a function defined below it.
 */
export type TagHandler = (line: number, startChar: number, tag: string, context: ScriptCheckContext | null) => void;

/**
 * Performs the necessary checks on a single argument. Ported from ScriptChecker.cs:576-624.
 *
 * @param isCommand whether this argument is a command line rather than one of its arguments;
 *   suppresses the object-notation check only (:578).
 * @param onTag what to do with each extracted tag. Defaults to Task 4's `checkSingleTag`.
 */
export function checkSingleArgument(
    checker: ScriptChecker,
    line: number,
    startChar: number,
    argument: string,
    context: ScriptCheckContext | null,
    isCommand: boolean,
    onTag: TagHandler
): void {
    // ScriptChecker.cs:578-587
    if (argument.includes('@') && !isCommand) {
        const range = containsObjectNotation(argument);
        if (range !== null) {
            checker.warn(
                checker.warnings,
                line,
                'raw_object_notation',
                'This line appears to contain raw object notation. There is almost always a better way to write a line than using raw object notation. Consider the relevant object constructor tags.',
                startChar + range.start,
                startChar + range.end
            );
        }
    }
    // ScriptChecker.cs:588. `<-` and `:->` are Denizen operators, not tag marks, and without
    // this every line using one would report uneven tags.
    //
    // BOTH SUBSTITUTIONS ARE LENGTH-PRESERVING ON PURPOSE -- `<-` (2) becomes `al` (2), `:->`
    // (3) becomes `arr` (3) -- because every index taken below is into `argNoArrows` while the
    // offsets handed out are into the caller's original text. Shorten either replacement and
    // every tag offset in the argument silently shifts.
    const argNoArrows = argument.replaceAll('<-', 'al').replaceAll(':->', 'arr');
    // ScriptChecker.cs:589-594. NOTE the asymmetry: the COUNT is taken on `argNoArrows`, the
    // RANGE on the original `argument`.
    if (argument.length > 2 && countCharacter(argNoArrows, '<') !== countCharacter(argNoArrows, '>')) {
        const start = startChar + indexOfAny(argument, TAG_MARK_CHARS);
        const end = startChar + lastIndexOfAny(argument, TAG_MARK_CHARS);
        checker.warn(checker.warnings, line, 'uneven_tags', 'Uneven number of tag marks (forgot to close a tag?).', start, end);
    }
    // ScriptChecker.cs:595-623: walk every top-level tag in the argument.
    let tagIndex = argNoArrows.indexOf('<');
    while (tagIndex !== -1) {
        // ScriptChecker.cs:598-615. A COUNTER, not a flag, so a nested tag does not end the
        // outer one early -- `<player.flag[<[x]>]>` is one tag, and its inner tag is reached by
        // checkSingleTag recursing through the parameter.
        let bracks = 0;
        let endIndex = -1;
        for (let i = tagIndex; i < argNoArrows.length; i++) {
            if (argNoArrows[i] === '<') {
                bracks++;
            }
            if (argNoArrows[i] === '>') {
                bracks--;
                if (bracks === 0) {
                    endIndex = i;
                    break;
                }
            }
        }
        // ScriptChecker.cs:616-619: an unclosed tag ends the scan. Anything already found was
        // reported; the remainder is not guessed at.
        if (endIndex === -1) {
            break;
        }
        // ScriptChecker.cs:620-621. The offset is `tagIndex + 1`, i.e. the first character
        // INSIDE the '<', because every range checkSingleTag reports is relative to the tag text.
        const tag = argNoArrows.substring(tagIndex + 1, endIndex);
        onTag(line, startChar + tagIndex + 1, tag, context);
        // ScriptChecker.cs:622: resume AFTER the closing mark. Resuming from `tagIndex + 1`
        // would re-enter the tag just consumed and report its inner tags a second time.
        tagIndex = argNoArrows.indexOf('<', endIndex);
    }
}

/**
 * Performs the necessary checks on a single data key line. Ported from ScriptChecker.cs:630-637.
 *
 * A data line is also an argument, so the argument checks run underneath (:636).
 */
export function checkSingleDataLine(
    checker: ScriptChecker,
    line: number,
    startChar: number,
    argument: string,
    context: ScriptCheckContext | null,
    onTag: TagHandler
): void {
    // ScriptChecker.cs:632-635. NOTE the asymmetry -- `Contains('"')` but `StartsWith('\'')`.
    // A double quote anywhere is suspicious; a single quote only matters at the start, because
    // an apostrophe inside a word ("don't") is ordinary text.
    if (argument.includes('"') || argument.startsWith("'")) {
        checker.warn(
            checker.minorWarnings,
            line,
            'invalid_data_line_quotes',
            "Data lines should not be quoted. You can use '<empty>' to make an empty line, or '<&dq>' to make a raw double-quote symbol, or '<&sq>' to make a raw single-quote.",
            startChar,
            startChar + argument.length
        );
    }
    // ScriptChecker.cs:636
    checkSingleArgument(checker, line, startChar, argument, context, false, onTag);
}
