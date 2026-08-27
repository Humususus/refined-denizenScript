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
exports.toLowerFast = void 0;
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
//# sourceMappingURL=frenetic.js.map