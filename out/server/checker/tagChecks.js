"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkSingleTag = exports.checkSingleDataLine = exports.checkSingleArgument = exports.containsObjectNotation = exports.ScriptCheckContext = void 0;
const tagHelper_1 = require("../providers/tagHelper");
const tagTracer_1 = require("../providers/tagTracer");
/**
 * ASCII-only lowercasing, matching FreneticUtilities' `ToLowerFast()`.
 *
 * NOT `toLowerCase()`, which is Unicode-aware. `parseTag` has already ASCII-lowered the whole
 * tag (tagHelper.ts:62), so the only characters a Unicode fold could still touch are non-ASCII
 * uppercase ones -- and those are exactly the ones the C# leaves alone. A definition written
 * `<[ИМЯ]>` is stored in `defNames` as ИМЯ (harvested through ToLowerFast), so folding it to
 * "имя" here would look it up under a name nothing ever stored and report a false
 * `def_of_nothing` on a correct script. Same helper and same reasoning as containerGather.ts.
 */
function toLowerFast(text) {
    return text.replace(/[A-Z]/g, (c) => c.toLowerCase());
}
/** FreneticUtilities' `string.Before(char)`: everything before the first occurrence, else all of it. */
function before(input, match) {
    const index = input.indexOf(match);
    return index < 0 ? input : input.slice(0, index);
}
/**
 * Context for checking a single script container. Ported from ScriptChecker.cs:772-785.
 *
 * The two "unknowable" flags are the reason this is a class rather than a pair of sets. A script
 * that injects something the checker cannot resolve has definitions it cannot possibly know
 * about; `CheckSingleTag` (:451, :463) reads these flags and suppresses `def_of_nothing` and
 * `entry_of_nothing` ENTIRELY rather than emitting a warning per tag. Without them, one
 * unresolvable inject would paint a whole script red.
 */
class ScriptCheckContext {
    constructor() {
        /** Known definition names. (ScriptChecker.cs:775) */
        this.definitions = new Set();
        /** Known save-entry names. (:778) */
        this.saveEntries = new Set();
        /** Injects or other issues make definition names unknowable. (:781) */
        this.hasUnknowableDefinitions = false;
        /** Injects or other issues make save-entry names unknowable. (:784) */
        this.hasUnknowableSaveEntries = false;
    }
}
exports.ScriptCheckContext = ScriptCheckContext;
/**
 * The last letter of every real ObjectTag prefix, i.e. the character that may legally sit
 * directly before the `@` of raw object notation. Ported from ScriptChecker.cs:1338
 * (`OBJECT_NOTATION_LAST_LETTER_MATCHER`), transcribed character by character.
 *
 * Lowercase only, and `AsciiMatcher` does not fold case, so `E@1` is NOT object notation.
 */
const OBJECT_NOTATION_LAST_LETTERS = 'mdlipqsebhounwr';
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
function containsObjectNotation(line) {
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
exports.containsObjectNotation = containsObjectNotation;
/** The characters that open or close a tag, for the range of `uneven_tags` (ScriptChecker.cs:568). */
const TAG_MARK_CHARS = ['<', '>'];
/** C#'s `string.IndexOfAny(char[])`: the lowest index at which any of `chars` occurs, else -1. */
function indexOfAny(text, chars) {
    for (let i = 0; i < text.length; i++) {
        if (chars.includes(text[i])) {
            return i;
        }
    }
    return -1;
}
/** C#'s `string.LastIndexOfAny(char[])`. */
function lastIndexOfAny(text, chars) {
    for (let i = text.length - 1; i >= 0; i--) {
        if (chars.includes(text[i])) {
            return i;
        }
    }
    return -1;
}
/** Counts occurrences of a single character. C#'s `string.CountCharacter` (FreneticUtilities). */
function countCharacter(text, ch) {
    let count = 0;
    for (const c of text) {
        if (c === ch) {
            count++;
        }
    }
    return count;
}
/**
 * Performs the necessary checks on a single argument. Ported from ScriptChecker.cs:576-624.
 *
 * @param isCommand whether this argument is a command line rather than one of its arguments;
 *   suppresses the object-notation check only (:578).
 * @param onTag what to do with each extracted tag. Defaults to Task 4's `checkSingleTag`.
 */
function checkSingleArgument(checker, line, startChar, argument, context, isCommand, onTag) {
    // ScriptChecker.cs:578-587
    if (argument.includes('@') && !isCommand) {
        const range = containsObjectNotation(argument);
        if (range !== null) {
            checker.warn(checker.warnings, line, 'raw_object_notation', 'This line appears to contain raw object notation. There is almost always a better way to write a line than using raw object notation. Consider the relevant object constructor tags.', startChar + range.start, startChar + range.end);
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
exports.checkSingleArgument = checkSingleArgument;
/**
 * Performs the necessary checks on a single data key line. Ported from ScriptChecker.cs:630-637.
 *
 * A data line is also an argument, so the argument checks run underneath (:636).
 */
function checkSingleDataLine(checker, line, startChar, argument, context, onTag) {
    // ScriptChecker.cs:632-635. NOTE the asymmetry -- `Contains('"')` but `StartsWith('\'')`.
    // A double quote anywhere is suspicious; a single quote only matters at the start, because
    // an apostrophe inside a word ("don't") is ordinary text.
    if (argument.includes('"') || argument.startsWith("'")) {
        checker.warn(checker.minorWarnings, line, 'invalid_data_line_quotes', "Data lines should not be quoted. You can use '<empty>' to make an empty line, or '<&dq>' to make a raw double-quote symbol, or '<&sq>' to make a raw single-quote.", startChar, startChar + argument.length);
    }
    // ScriptChecker.cs:636
    checkSingleArgument(checker, line, startChar, argument, context, false, onTag);
}
exports.checkSingleDataLine = checkSingleDataLine;
/**
 * Performs the necessary checks on a single tag. Ported from ScriptChecker.cs:426-525.
 *
 * Eight warning keys come out of this, plus the two the tag tracer raises through its callbacks
 * (restored in Phase 2C-4 Task 1). All go onto `warnings` except `deprecated_tag_part`, which is
 * a `minorWarning`.
 */
function checkSingleTag(checker, line, startChar, tag, context) {
    const meta = checker.meta;
    // NOT IN THE C#, which reads an ambient `MetaDocs.CurrentMeta` that is always present.
    // Diagnostics here run from the first keystroke, while meta is still downloading, and every
    // check below is a comparison AGAINST the meta -- with none loaded, `tagBases` is empty and
    // the bad_tag_base branch would fire for every tag in the file. Checking nothing is the only
    // honest answer until the docs arrive.
    if (meta === null) {
        return;
    }
    // ScriptChecker.cs:428-431. The parse error's range is the WHOLE tag: at parse-failure time
    // there are no reliable part offsets to point at.
    const parsed = (0, tagHelper_1.parseTag)(tag, (s) => {
        checker.warn(checker.warnings, line, 'tag_format_break', `Tag parse error: ${s}`, startChar, startChar + tag.length);
    });
    // ScriptChecker.cs:432-435
    const warnPart = (part, key, message) => {
        checker.warn(checker.warnings, line, key, message, startChar + part.startChar, startChar + part.endChar);
    };
    // The tag handler for the two recursive `checkSingleArgument` calls below. A closure rather
    // than a module-level function because `checkSingleArgument` takes the handler as a
    // parameter -- which is what let Task 3 test the extraction loop without tag resolution --
    // and the checker has to be bound in.
    const recurse = (l, s, t, c) => checkSingleTag(checker, l, s, t, c);
    // ScriptChecker.cs:436
    const tagName = toLowerFast(parsed.parts[0].text);
    // ScriptChecker.cs:437-444. NOTE the `else if`: a base that is not known at all gets
    // bad_tag_base and NOTHING else, even when its name ends in "tag".
    // The `tagName.length > 0` guard is what exempts `<[definition]>`, whose base is empty.
    if (!meta.tagBases.has(tagName) && tagName.length > 0) {
        warnPart(parsed.parts[0], 'bad_tag_base', `Invalid tag base \`${tagName.replaceAll('`', "'")}\` (check \`!tag ...\` to find valid tags).`);
    }
    else if (tagName.endsWith('tag')) {
        warnPart(parsed.parts[0], 'xtag_notation', "'XTag' notation is for documentation purposes, and is not to be used literally in a script. (replace the 'XTag' text with a valid real tagbase that returns a tag of that type).");
    }
    // ScriptChecker.cs:445-456: a definition tag, written either as `<[x]>` or `<definition[x]>`.
    if (tagName === '' || tagName === 'definition') {
        const param = parsed.parts[0].parameter;
        if (param !== null) {
            // `.Before('.')` -- `<[map.key]>` reads INTO a definition called `map`, so only the
            // part before the first dot is the name being looked up.
            const name = before(toLowerFast(param), '.');
            if (context !== null && !context.definitions.has(name) && !context.hasUnknowableDefinitions) {
                warnPart(parsed.parts[0], 'def_of_nothing', 'Definition tag points to non-existent definition (typo, or bad copypaste?).');
            }
        }
    }
    // ScriptChecker.cs:457-468: a save-entry tag.
    //
    // The `else` is the C#'s and is kept, but it decides nothing: `tagName` cannot be both
    // ''/'definition' and 'entry', and the branch above does not reassign it, so turning this
    // into a plain `if` is an equivalent mutant. Noted so the next audit does not chase it.
    else if (tagName === 'entry') {
        const param = parsed.parts[0].parameter;
        if (param !== null) {
            // NOTE: lowercased but NOT cut at '.', where the definition branch above IS cut.
            // An asymmetry in the C#, ported as-is.
            const name = toLowerFast(param);
            if (context !== null && !context.saveEntries.has(name) && !context.hasUnknowableSaveEntries) {
                warnPart(parsed.parts[0], 'entry_of_nothing', 'entry[...] tag points to non-existent save entry (typo, or bad copypaste?).');
            }
        }
    }
    // ScriptChecker.cs:469-483: every part after the base.
    for (let i = 1; i < parsed.parts.length; i++) {
        const part = parsed.parts[i];
        if (!meta.tagParts.has(part.text)) {
            // :474 -- the FIRST part after `entry` or `context` is exempt, and only the first.
            // A context key's name cannot be known from the meta, and `<context.whatever>` is
            // the commonest construct in a world script; without this every one would warn.
            // The SECOND part is not exempt, so a real typo after the first is still caught.
            if (i !== 1 || (tagName !== 'entry' && tagName !== 'context')) {
                warnPart(part, 'bad_tag_part', `Invalid tag part \`${part.text.replaceAll('`', "'")}\` (check \`!tag ...\` to find valid tags).`);
                // NESTED inside the bad-part branch: a documented part ending in "tag" is fine,
                // an undocumented one draws BOTH warnings.
                if (part.text.endsWith('tag')) {
                    warnPart(part, 'xtag_notation', "'XTag' notation is for documentation purposes, and is not to be used literally in a script. (replace the 'XTag' text with a valid real tagbase that returns a tag of that type).");
                }
            }
        }
    }
    // ScriptChecker.cs:484-490: a tag parameter is an argument in its own right, so tags nested
    // inside it get checked too. The offset skips the part text and its opening '['.
    for (const part of parsed.parts) {
        if (part.parameter !== null) {
            checkSingleArgument(checker, line, startChar + part.startChar + part.text.length + 1, part.parameter, context, false, recurse);
        }
    }
    // ScriptChecker.cs:491-494: so is a fallback. The `+ 2` steps over the `||`.
    if (parsed.fallback !== null) {
        checkSingleArgument(checker, line, startChar + parsed.endChar + 2, parsed.fallback, context, false, recurse);
    }
    // ScriptChecker.cs:495-502. The tracer's two diagnostics; its callbacks were restored in
    // Phase 2C-4 Task 1 specifically for this.
    (0, tagTracer_1.traceTag)(meta, parsed, {
        error: (s) => {
            checker.warn(checker.warnings, line, 'tag_trace_failure', `Tag tracer: ${s}`, startChar, startChar + tag.length);
        },
        // NOTE the list: minorWarnings, unlike every other key in this function. A deprecated
        // tag still works; it is a nudge, not a problem.
        deprecation: (s, part) => {
            checker.warn(checker.minorWarnings, line, 'deprecated_tag_part', s, startChar + part.startChar, startChar + part.startChar + part.text.length);
        }
    });
    // ScriptChecker.cs:503-524 is gated on `SurroundingWorkspace is not null`, which stays null
    // until Phase 2D -- so `CheckTagParam` (:531-567) is unreachable and is NOT ported here.
    // Porting 37 lines that nothing can run would be 37 lines of untested guesswork; it lands
    // with the workspace scanning that makes it reachable.
}
exports.checkSingleTag = checkSingleTag;
//# sourceMappingURL=tagChecks.js.map