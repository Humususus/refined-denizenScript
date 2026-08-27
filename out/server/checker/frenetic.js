"use strict";
// Ports of the FreneticUtilities string helpers that SharpDenizenTools leans on everywhere.
// This module must stay dependency-free: no `vscode-languageserver` import, no I/O.
//
// WHY THIS FILE EXISTS. `toLowerFast` had grown five copies across the checker. Four were
// identical; the fifth, in `scriptChecker.ts`, was a plain `toLowerCase()` -- and that single
// divergence is not a style problem, it is a behaviour change on every non-ASCII script. The
// same slip in `tagChecks.ts` once turned `- define ИМЯ` into a false `def_of_nothing`, because
// the definition was stored as written while the tag reading it was folded to `имя`.
//
// One definition, imported everywhere, is what stops that recurring.
Object.defineProperty(exports, "__esModule", { value: true });
exports.beforeAndAfter = exports.after = exports.before = exports.toLowerFast = void 0;
/**
 * FreneticUtilities' `string.ToLowerFast()`.
 *
 * ASCII-ONLY, and that is the entire point: it lowercases A-Z and leaves every other codepoint
 * exactly as it was. JavaScript's `toLowerCase()` also folds Cyrillic, Greek, Turkish dotted I
 * and the rest, so substituting it silently changes how every identifier in a non-English script
 * is matched. Denizen's own comparisons are ASCII folds, so the C# behaviour is the correct one
 * here, not merely the faithful one.
 */
function toLowerFast(text) {
    return text.replace(/[A-Z]/g, (c) => c.toLowerCase());
}
exports.toLowerFast = toLowerFast;
// THE NOT-FOUND CASE IS THE WHOLE DESIGN of the three below, and it is easy to get backwards.
// Frenetic's rule is uniform: `Before` and `After` both return the INPUT UNCHANGED when the
// separator is absent, so that `x.Before(':')` on a value with no colon is the value itself
// rather than nothing. `BeforeAndAfter` is the one exception, and only in its second half --
// verbatim from FreneticExtensions/StringExtensions.cs:
//
//     if (index < 0) { after = ""; return input; }
//
// so it returns (input, "") rather than (input, input).
//
// Two of the five copies these replaced had `After` returning '' instead of the input. It never
// bit: all five call sites in the port guard with a `startsWith('as:')`-style test that
// guarantees the separator is there, and a corpus sweep before and after this consolidation gave
// identical findings. That is exactly why it is worth having one correct copy -- the next caller
// is the one that would not have guarded.
/** FreneticUtilities' `string.Before(...)`: everything before the first occurrence, else the input. */
function before(input, match) {
    const index = input.indexOf(match);
    return index < 0 ? input : input.slice(0, index);
}
exports.before = before;
/** FreneticUtilities' `string.After(...)`: everything after the first occurrence, else the input. */
function after(input, match) {
    const index = input.indexOf(match);
    return index < 0 ? input : input.slice(index + match.length);
}
exports.after = after;
/**
 * FreneticUtilities' `string.BeforeAndAfter(...)`, as a tuple rather than an `out` parameter.
 *
 * Returns `[input, '']` when the separator is absent -- NOT `[input, input]`. See the note above:
 * this asymmetry with the standalone `after` is in the C#, not an accident of the port.
 */
function beforeAndAfter(input, match) {
    const index = input.indexOf(match);
    if (index < 0) {
        return [input, ''];
    }
    return [input.slice(0, index), input.slice(index + match.length)];
}
exports.beforeAndAfter = beforeAndAfter;
//# sourceMappingURL=frenetic.js.map