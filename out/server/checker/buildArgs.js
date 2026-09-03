"use strict";
// The command-argument tokenizer, ported from SharpDenizenTools' ScriptChecker.cs:640-769
// (`CommandArgument`, `VALID_TAG_FIRST_CHAR` and `BuildArgs`), which the C# itself copied from
// Denizen Core's ArgumentHelper. This module must stay dependency-free.
//
// Splitting a Denizen command line is not `text.split(' ')`. Three things suppress a split:
// quotes, tag brackets, and tag parameters -- and they interact, because a quote inside a tag's
// `[...]` is data rather than a delimiter. Getting this wrong does not produce a visibly broken
// argument list; it produces a subtly wrong one, and `preprocContainer` then reads
// `cleanArgs[0]` off it to decide whether a flag is a server flag or an object flag.
//
// TWO CALLERS, OPPOSITE NEEDS. `PreprocContainer` (ScriptChecker.cs:1790) passes a NULL checker
// and wants tokens only. `CheckSingleCommand` (Phase 2C-4) passes a real one and wants the two
// warnings. Both paths are ported and both are tested.
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildArgs = void 0;
/**
 * Whether `ch` may legally begin a Denizen tag immediately after `<`.
 * Mirrors `VALID_TAG_FIRST_CHAR` (ScriptChecker.cs:650): ASCII letters, digits, `&`, `_`, `[`.
 *
 * ASCII-ONLY ON PURPOSE, because `AsciiMatcher` is. A `<` followed by a non-ASCII letter does
 * NOT open a tag, and that matters here rather than being a technicality: the scripts this
 * checker runs on are full of Cyrillic narrate text.
 *
 * DELIBERATELY DUPLICATED from `providers/cursorContext.ts`'s `isValidTagFirstChar`, which is
 * character-for-character the same. The rule for `src/server/checker/` is that it depends on
 * nothing outside itself, and a six-character predicate is a cheaper thing to repeat than that
 * rule is to break. If one of the two changes, the other is wrong.
 */
function isValidTagFirstChar(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch === '&' || ch === '_' || ch === '[';
}
/**
 * Splits a command's argument text into arguments. Ported from ScriptChecker.cs:658-769.
 *
 * @param line the line number, used only for warnings.
 * @param startChar the column at which `stringArgs` begins, added to every returned offset.
 * @param stringArgs the raw argument text.
 * @param checker a checker to warn through, or `null` to tokenise silently.
 */
function buildArgs(line, startChar, stringArgs, checker) {
    // ScriptChecker.cs:660.
    // C# QUIRK: the trim happens BEFORE any index is taken, and every `startChar` below is an
    // index into the TRIMMED string. So if the caller's text had leading whitespace, every
    // reported offset is short by that many characters. Harmless for `preprocContainer`, which
    // passes startChar 0 and publishes nothing; a trap for whoever wires up Phase 2C-4.
    stringArgs = stringArgs.trim().replaceAll('\r', ' ').replaceAll('\n', ' ');
    const matchList = [];
    // ScriptChecker.cs:662-667
    let start = 0;
    const len = stringArgs.length;
    let currentQuote = '\0';
    let firstQuote = 0;
    let inTags = 0;
    let inTagParams = 0;
    let currentTagHasFallback = false;
    // ScriptChecker.cs:668
    for (let i = 0; i < len; i++) {
        const c = stringArgs[i];
        if (c === ' ' && currentQuote === '\0' && inTags === 0 && !currentTagHasFallback) {
            // ScriptChecker.cs:671-678. The `i > start` guard is what stops a run of spaces
            // producing empty arguments.
            if (i > start) {
                matchList.push({ startChar: startChar + start, text: stringArgs.slice(start, i) });
            }
            start = i + 1;
        }
        else if (c === '<') {
            // ScriptChecker.cs:679-685
            if (i + 1 < len && isValidTagFirstChar(stringArgs[i + 1])) {
                inTags++;
            }
        }
        else if (c === '>' && inTags > 0) {
            // ScriptChecker.cs:686-693. A COUNTER, so nested tags close in the right order.
            inTags--;
            if (inTags === 0) {
                currentTagHasFallback = false;
            }
        }
        else if (c === '[' && inTags > 0) {
            // ScriptChecker.cs:694-697
            inTagParams++;
        }
        else if (c === ']' && inTagParams > 0) {
            // ScriptChecker.cs:698-701
            inTagParams--;
        }
        else if (c === '|' && i > 0 && stringArgs[i - 1] === '|' && inTags === 1) {
            // ScriptChecker.cs:702-705: a `||` fallback inside a top-level tag.
            //
            // C# QUIRK: THIS FLAG CANNOT CHANGE THE OUTPUT, and is ported anyway. It is only
            // ever set while `inTags === 1`, and it is cleared at exactly the moment `inTags`
            // returns to 0 (:691). So every state in which it is true also has `inTags > 0`,
            // which already suppresses the space split at :671 on its own -- the
            // `!currentTagHasFallback` conjunct there is never the deciding one. Verified
            // exhaustively rather than by argument: see the Task 3 report.
            currentTagHasFallback = true;
        }
        else if (c === '"' || c === "'") {
            if (currentQuote === '\0' && inTagParams === 0) {
                // ScriptChecker.cs:708-719.
                // C# QUIRK: `firstQuote === 0` doubles as the "not yet set" sentinel, so
                // `firstQuote` is written once and never revised. When a line has a closed quote
                // followed by an unclosed one, `missing_quotes` below is anchored at the CLOSED
                // one. Ported verbatim; pinned by test.
                if (firstQuote === 0) {
                    firstQuote = i;
                }
                // A quote only OPENS at the start of an argument, which is what keeps the
                // apostrophe in `don't` from swallowing the rest of the line.
                if (i === 0 || stringArgs[i - 1] === ' ') {
                    currentQuote = c;
                    start = i + 1;
                }
            }
            else if (currentQuote === c) {
                // ScriptChecker.cs:720-757. A quote only CLOSES at the end of an argument.
                if (i + 1 >= len || stringArgs[i + 1] === ' ') {
                    currentQuote = '\0';
                    if (i >= start) {
                        const matched = stringArgs.slice(start, i);
                        matchList.push({ startChar: startChar + start, text: matched });
                        // ScriptChecker.cs:729-752
                        if (checker !== null) {
                            // Counts tag depth so that a space INSIDE a tag does not count as
                            // "this argument needed its quotes".
                            let tagMarks = 0;
                            let hasSpace = false;
                            for (const subC of matched) {
                                if (subC === '<') {
                                    tagMarks++;
                                }
                                else if (subC === '>') {
                                    tagMarks--;
                                }
                                else if (subC === ' ' && tagMarks === 0) {
                                    hasSpace = true;
                                }
                            }
                            // ScriptChecker.cs:748. The second disjunct is the C# declining to
                            // guess about a fragment whose tag markers do not balance.
                            if (!(hasSpace || (tagMarks !== 0 && matched.includes(' '))) && !matched.endsWith(':')) {
                                checker.warn(checker.minorWarnings, line, 'bad_quotes', 'Pointless quotes (arguments quoted but do not contain spaces).', startChar + start, startChar + i);
                            }
                        }
                    }
                    // ScriptChecker.cs:754-755: the loop MUTATES ITS OWN INDEX to step over the
                    // space that must follow the closing quote. Same shape as
                    // basicLineFormatCheck and gatherActualContainers; a for...of cannot express it.
                    i++;
                    start = i + 1;
                }
            }
        }
    }
    // ScriptChecker.cs:760-763. NOTE the list: `warnings`, where bad_quotes above went to
    // `minorWarnings`. An unbalanced quote changes what Denizen actually executes; pointless
    // quotes are a style nit. The C# grades them differently on purpose.
    if (currentQuote !== '\0' && checker !== null) {
        checker.warn(checker.warnings, line, 'missing_quotes', 'Uneven quotes (forgot to close a quote?).', startChar + firstQuote, startChar + len);
    }
    // ScriptChecker.cs:764-767: whatever is left after the last delimiter.
    if (start < len) {
        matchList.push({ startChar: startChar + start, text: stringArgs.slice(start) });
    }
    return matchList;
}
exports.buildArgs = buildArgs;
//# sourceMappingURL=buildArgs.js.map