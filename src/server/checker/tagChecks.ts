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
