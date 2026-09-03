"use strict";
// Ported in full from SharpDenizenTools/ScriptAnalysis/ScriptEventCouldMatcher.cs (145 lines),
// plus the matcher-building half of EventTools.cs (:44-70).
//
// This module must stay dependency-free: no `vscode-languageserver` import, no I/O. It also,
// deliberately, does not import ../metaDocs/metaTypes -- see the note on `parseMatchers`.
//
// WHAT A COULD-MATCHER IS. Every documented event carries a format line like
//     on <player> breaks <block> (with <item>)
// and a could-matcher is that line compiled into one validator per word. Matching an event line
// from a script means running the script's words through those validators. The optional part in
// parens is why ONE event yields SEVERAL matchers: the paren expansion below produces one matcher
// for `on <player> breaks <block>` and another for `on <player> breaks <block> with <item>`, and
// the script line has to match one of them exactly.
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseMatchers = exports.ScriptEventCouldMatcher = void 0;
/**
 * Helper to generate automatic logic for ScriptEvent#couldMatch.
 * (ScriptEventCouldMatcher.cs:11-144)
 */
class ScriptEventCouldMatcher {
    /**
     * Constructs the could-matcher from the given reference format.
     * (ScriptEventCouldMatcher.cs:32-90)
     *
     * `error` is called for a malformed format and the offending word is then SKIPPED, leaving a
     * shorter validator list rather than aborting. That is the C#'s choice and it matters: a
     * single typo in one event's docs degrades that event's matching instead of throwing out the
     * whole meta load.
     */
    constructor(format, error, knownValidatorTypes) {
        this.format = format;
        this.parts = format.split(' ');
        const validatorList = [];
        const argOrderList = [];
        const secondaryArgList = [];
        let index = 0;
        for (const arg of this.parts) {
            // :44-48. NOTE `index` is NOT incremented here, nor on either error below -- it only
            // advances when a validator is actually pushed, so the indices stay aligned with
            // `validators` rather than with `parts`.
            if (arg.length === 0) {
                error(`Event matcher format error: '${this.format}' has a double space?`);
                continue;
            }
            if (arg.startsWith('<')) {
                if (!arg.endsWith('>')) {
                    error(`Event matcher format error: '${this.format}' has an unclosed fill-in part.`);
                    continue;
                }
                const toUse = arg.substring(1, arg.length - 1);
                if (toUse.startsWith("'") && toUse.endsWith("'")) {
                    // :57-62. A quoted fill-in like <'in'> is a LABEL, not a type: it documents
                    // what the word means without constraining it, so anything matches -- but at
                    // the weakest possible score, 1, so a matcher that actually recognises the
                    // word always wins the comparison in `isBetterMatchThan`.
                    validatorList.push(() => 1);
                    secondaryArgList.push(index++);
                }
                else {
                    const validator = knownValidatorTypes.get(toUse);
                    if (validator === undefined) {
                        error(`Event matcher format error: '${this.format}' has an unrecognized input type '${toUse}'`);
                        continue;
                    }
                    validatorList.push(validator);
                    secondaryArgList.push(index++);
                }
            }
            else if (arg.includes('|')) {
                // :74-79
                const rawValues = new Set(arg.split('|'));
                validatorList.push((word) => rawValues.has(word) ? 10 : 0);
                argOrderList.push(index++);
            }
            else {
                // :80-85
                const rawCopy = arg;
                validatorList.push((word) => rawCopy === word ? 10 : 0);
                argOrderList.push(index++);
            }
        }
        this.validators = validatorList;
        // :88-89: the secondary (type-matcher) indices go on the END.
        this.argOrder = argOrderList.concat(secondaryArgList);
    }
    /**
     * Returns 0 for no match, 1 for bare minimum match, up to 10 for best match.
     * (ScriptEventCouldMatcher.cs:96-123)
     *
     * @param pathBaseParts the words to match events against
     * @param allowPartial  false: the whole event must match. true: the first few words may.
     * @param precise       true: object matchers must be VALID. false: they need only look close.
     *
     * THE SCORE IS THE MAXIMUM, not the minimum or the sum. Any single zero returns 0 immediately,
     * so every word has already passed by the time the max is taken; what the max then reports is
     * the strongest evidence found. `on <player> breaks <block>` against `on player breaks stone`
     * scores 10 on the strength of the literal `breaks`, not 1 because `<player>` was permissive.
     * Because zero short-circuits and max is commutative, `argOrder` cannot change the result --
     * only how quickly a non-match is discovered.
     */
    tryMatch(pathBaseParts, allowPartial, precise) {
        // :98-104
        if (pathBaseParts.length !== this.validators.length) {
            if (!allowPartial || pathBaseParts.length > this.validators.length) {
                return 0;
            }
        }
        let max = 0;
        for (const i of this.argOrder) {
            // The `i < length` guard is what makes partial matching work: extra validators past
            // the end of a short input are simply not run.
            if (i < pathBaseParts.length) {
                const match = this.validators[i](pathBaseParts[i], precise);
                if (match === 0) {
                    return 0;
                }
                max = Math.max(max, match);
            }
        }
        // :118-121. A partial match is CAPPED at 3, so it can never outrank a complete one -- an
        // incomplete event line is a suggestion ("might be incomplete?"), not an answer.
        if (pathBaseParts.length !== this.validators.length) {
            return Math.min(max, 3);
        }
        return max;
    }
    /**
     * Returns true if this matcher matches better than the second matcher.
     * (ScriptEventCouldMatcher.cs:126-143)
     *
     * Longer wins outright: between two matchers that both accept the line, the one that explains
     * MORE of it is the better reading, which is how the optional-part expansion resolves.
     *
     * At equal length it is a vote, +1 per word this matcher scores higher on and -1 otherwise --
     * so a tie on a word counts AGAINST self. Ties overall (`>= 0`) still go to self, which makes
     * the result depend on which matcher the caller asked; the C# is careful to always ask the
     * incumbent's challenger.
     */
    isBetterMatchThan(pathBaseParts, precise, matcher2) {
        if (this.validators.length !== matcher2.validators.length) {
            return this.validators.length > matcher2.validators.length;
        }
        let betterMatches = 0;
        for (const i of this.argOrder) {
            if (i < pathBaseParts.length) {
                const match = this.validators[i](pathBaseParts[i], precise);
                const match2 = matcher2.validators[i](pathBaseParts[i], precise);
                betterMatches += (match > match2) ? 1 : -1;
            }
        }
        return betterMatches >= 0;
    }
}
exports.ScriptEventCouldMatcher = ScriptEventCouldMatcher;
/**
 * Parses an event format into a set of could-matchers. (EventTools.cs:44-49)
 *
 * LIVES HERE, NOT IN ./eventTools, AND THAT IS LOAD-BEARING. `MetaEvent.applyValue` calls this
 * while parsing the meta, so metaTypes.ts imports it; `separateSwitches`, the other half of
 * EventTools.cs, needs `isInDataValueSet` and therefore imports metaTypes.ts. Keeping the two in
 * one module the way the C# does would put metaTypes.ts in an import cycle with itself. The C#
 * has that cycle too and does not care; ES modules do, so the file is split along the seam.
 */
function parseMatchers(format, validatorTypes, error) {
    const matcherList = [];
    buildMainContent(matcherList, format, validatorTypes, (s) => error(`while parsing event '${format}': ${s}`));
    return matcherList;
}
exports.parseMatchers = parseMatchers;
/**
 * Expands the optional `(...)` parts of a format into one matcher per combination.
 * (EventTools.cs:51-70)
 *
 * Recursive, and it recurses TWICE per paren -- once with the optional part removed and once with
 * it kept -- so an event with three optional parts yields eight matchers. The spacing arithmetic
 * is the fiddly bit: `paren - 1` and `endParen + 2` step over the space that sits outside each
 * bracket, and the two ternaries then avoid reintroducing it when a side turned out empty. Note
 * they use DIFFERENT predicates -- `isNullOrEmpty(afterText)` against
 * `isNullOrWhiteSpace(baseText)` -- which is the C#'s asymmetry, not a slip here.
 */
function buildMainContent(output, format, validatorTypes, error) {
    const paren = format.indexOf('(');
    if (paren === -1) {
        output.push(new ScriptEventCouldMatcher(format, error, validatorTypes));
        return;
    }
    const endParen = format.indexOf(')', paren);
    if (endParen === -1) {
        error(`Invalid couldMatcher registration '${format}': inconsistent parens`);
        return;
    }
    const baseText = paren === 0 ? '' : format.substring(0, paren - 1);
    const afterText = endParen + 2 >= format.length ? '' : format.substring(endParen + 2);
    const optional = format.substring(paren + 1, endParen);
    // Without the optional part.
    buildMainContent(output, baseText + (afterText.length === 0 || baseText.trim().length === 0 ? afterText : (' ' + afterText)), validatorTypes, error);
    // With it.
    buildMainContent(output, (baseText.length === 0 ? '' : (baseText + ' ')) + optional + (afterText.length === 0 ? '' : (' ' + afterText)), validatorTypes, error);
}
//# sourceMappingURL=scriptEventCouldMatcher.js.map