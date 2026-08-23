"use strict";
/**
 * Locates the Denizen tag (if any) the cursor sits inside, within one already-extracted
 * command argument. Position-only logic ported from the tag-completion branch of
 * `DenizenVSCode/DenizenLangServer/Services/TextDocumentService.cs:421-521`:
 *   - the backward scan for the innermost unclosed `<` (TextDocumentService.cs:453-470)
 *   - the forward top-level-dot count (TextDocumentService.cs:474-501)
 *
 * This module does not re-derive argument boundaries: `argThusFar`/`argStart` are
 * expected to come from `parseCommandLine` in ./cursorContext, whose
 * `splitTopLevelArguments` is the project's only line/argument scanner. This module only
 * scans *within* that already-extracted argument for tag structure.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.findTagParamAtCursor = exports.findTagAtCursor = void 0;
/**
 * Backward scan for the innermost still-open '<' around the cursor, within `argThusFar`
 * alone. Shared by `findTagAtCursor` and `findTagParamAtCursor` — both need to know
 * which tag (if any) the cursor is inside before asking a more specific question about
 * it. Mirrors TextDocumentService.cs:453-470 (`tagBits` there plays the same role as
 * `unclosedGreaterThans` here). Bracket characters are not tracked in this pass, matching
 * the C#: nesting is decided purely by '<'/'>'.
 *
 * Returns null when there is no '<' at all in `argThusFar`, or the nearest one is already
 * closed by a '>' before the cursor.
 */
function findInnermostUnclosedTag(argThusFar, argStart) {
    let unclosedGreaterThans = 0;
    let relevantTagStart = -1;
    for (let i = argThusFar.length - 1; i >= 0; i--) {
        const ch = argThusFar[i];
        if (ch === '>') {
            unclosedGreaterThans++;
        }
        else if (ch === '<') {
            if (unclosedGreaterThans === 0) {
                relevantTagStart = i + 1;
                break;
            }
            unclosedGreaterThans--;
        }
    }
    if (relevantTagStart === -1) {
        return null;
    }
    return {
        tagSoFar: argThusFar.substring(relevantTagStart),
        tagStart: argStart + relevantTagStart,
    };
}
/**
 * Forward scan over a tag's text (from just after its opening '<' up to the cursor),
 * counting top-level dots and tracking top-level `[...]` bracket groups. Shared by
 * `findTagAtCursor` (which only needs `componentCount`/`lastDot`) and
 * `findTagParamAtCursor` (which additionally needs to know which bracket, if any, is
 * still open at the cursor). Mirrors the forward walk at TextDocumentService.cs:474-501.
 * That C# range also lowercases the tag text before scanning it; this port does not,
 * since counting dot/bracket/angle positions does not depend on case.
 *
 * `openBracketIndices` holds the tagSoFar-relative index of each top-level '[' that has
 * not yet been closed by a matching ']', outermost first — empty if the cursor is not
 * inside any bracket. `firstBracketAfterLastDot` is the index of the first top-level '['
 * seen since `lastDot` (or -1 if none), used to strip a parameter's brackets back to a
 * clean tag name even when a later bracket group is the one still open (e.g.
 * "player[a][b": the clean name is "player", using the first bracket, while the still-open
 * bracket used for the parameter itself is the second).
 *
 * THAT LAST CASE IS A DELIBERATE DIVERGENCE FROM THE C#, and the better behaviour.
 * TextDocumentService.cs:512 bails out of the whole base-form branch — `return new
 * CompletionList([])` — the moment the tag text contains ANY ']', which it checks before
 * splitting the base off at :516. So C# offers nothing at all for "<player[a][b", purely
 * because an earlier bracket group happens to have closed. Tracking the bracket groups
 * properly costs nothing here (the forward scan already has to balance them to count
 * top-level dots) and answers the question the user is actually asking, so this port
 * serves the still-open bracket instead of discarding the input.
 *
 * Recorded as a divergence rather than a bug on either side: "<player[a][b" is not valid
 * Denizen — a tag base takes at most one parameter — so no correct script reaches it, and
 * C#'s early bail is a reasonable way to spend nothing on malformed input. The extra
 * candidates offered here are harmless (they are exactly what the second bracket's
 * documented parameter allows), and no behaviour that matters depends on which side is
 * copied. Measured in this phase's review: 159 items where C# gives 0.
 */
function scanTagComponents(tagSoFar) {
    let componentCount = 0;
    let subTags = 0;
    let squareBrackets = 0;
    let lastDot = 0;
    let firstBracketAfterLastDot = -1;
    const openBracketIndices = [];
    for (let i = 0; i < tagSoFar.length; i++) {
        const ch = tagSoFar[i];
        if (ch === '<') {
            subTags++;
        }
        else if (ch === '>') {
            subTags--;
        }
        else if (ch === '[' && subTags === 0) {
            squareBrackets++;
            if (firstBracketAfterLastDot === -1) {
                firstBracketAfterLastDot = i;
            }
            openBracketIndices.push(i);
        }
        else if (ch === ']' && subTags === 0) {
            squareBrackets--;
            openBracketIndices.pop();
        }
        else if (ch === '.' && subTags === 0 && squareBrackets === 0) {
            componentCount++;
            lastDot = i + 1;
            firstBracketAfterLastDot = -1;
        }
    }
    return { componentCount, lastDot, openBracketIndices, firstBracketAfterLastDot };
}
/**
 * Finds the innermost unclosed tag around the cursor, if any, within `argThusFar` (an
 * argument's text up to the cursor). `argStart` is the column where `argThusFar` begins
 * on the line, so the returned columns are relative to the full line, not to
 * `argThusFar`.
 *
 * Two passes, both scoped to `argThusFar` alone: `findInnermostUnclosedTag` locates the
 * tag itself (TextDocumentService.cs:453-470), then `scanTagComponents` counts top-level
 * dots within it (TextDocumentService.cs:474-501).
 *
 * Returns null when the cursor is not inside an unclosed tag — no '<' at all in
 * `argThusFar`, or the nearest one is already closed by a '>' before the cursor.
 */
function findTagAtCursor(argThusFar, argStart) {
    const tag = findInnermostUnclosedTag(argThusFar, argStart);
    if (tag === null) {
        return null;
    }
    const { tagSoFar, tagStart } = tag;
    const { componentCount, lastDot } = scanTagComponents(tagSoFar);
    const lastComponent = tagSoFar.substring(lastDot);
    const lastComponentStart = tagStart + lastDot;
    return { tagSoFar, tagStart, componentCount, lastComponent, lastComponentStart };
}
exports.findTagAtCursor = findTagAtCursor;
/**
 * Finds the tag parameter (the text inside a tag's `[...]`) the cursor sits inside, if
 * any, within `argThusFar`. Ports the base-form branch at TextDocumentService.cs:504-521
 * (`<player[...`, no dot before the bracket) and the part-form branch at :538-554
 * (`<player.gamemode_at[...`, one or more dots before the bracket) — both branches there
 * are reached only after `components` top-level dots and a still-open `[` have already
 * been established by the shared scan at :474-501, which is exactly what
 * `findInnermostUnclosedTag` + `scanTagComponents` compute here.
 *
 * Reuses `findInnermostUnclosedTag` first, so a nested unclosed tag inside the brackets
 * (e.g. "player.gamemode_at[<player.location") is found as the innermost construct —
 * its own text has no bracket of its own, so this correctly returns null instead of
 * mistaking the *outer* tag's bracket (which a naive `lastIndexOf('[')` over the whole
 * string would find) for the parameter the cursor is in.
 *
 * Returns null when the cursor is not inside any unclosed `[...]` of a tag: no tag at
 * all, a tag with no bracket yet, a bracket already closed before the cursor, or the
 * innermost unclosed construct being a nested tag rather than this tag's own bracket.
 */
function findTagParamAtCursor(argThusFar, argStart) {
    const tag = findInnermostUnclosedTag(argThusFar, argStart);
    if (tag === null) {
        return null;
    }
    const { tagSoFar, tagStart } = tag;
    const { componentCount, openBracketIndices, firstBracketAfterLastDot } = scanTagComponents(tagSoFar);
    if (openBracketIndices.length === 0) {
        return null;
    }
    const openIndex = openBracketIndices[openBracketIndices.length - 1];
    // firstBracketAfterLastDot cannot be -1 here in practice: a bracket can only stay
    // open across the end of the scan if it opened after the last top-level dot (dots are
    // only counted while no bracket is open), and any bracket opening resets/sets it. The
    // fallback to openIndex is defensive only.
    const nameEnd = firstBracketAfterLastDot === -1 ? openIndex : firstBracketAfterLastDot;
    const tagName = tagSoFar.substring(0, nameEnd).trim();
    const paramSoFar = tagSoFar.substring(openIndex + 1);
    const paramStart = tagStart + openIndex + 1;
    return { tagName, partIndex: componentCount, paramSoFar, paramStart };
}
exports.findTagParamAtCursor = findTagParamAtCursor;
//# sourceMappingURL=tagContext.js.map