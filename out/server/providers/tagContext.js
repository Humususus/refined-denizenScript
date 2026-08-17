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
exports.findTagAtCursor = void 0;
/**
 * Finds the innermost unclosed tag around the cursor, if any, within `argThusFar` (an
 * argument's text up to the cursor). `argStart` is the column where `argThusFar` begins
 * on the line, so the returned columns are relative to the full line, not to
 * `argThusFar`.
 *
 * Two passes, both scoped to `argThusFar` alone:
 *
 *  1. Scan backward from the end for the innermost still-open '<'. A '>' seen first
 *     closes one level of nesting, so an already-closed tag is skipped rather than
 *     matched — mirrors the backward walk at TextDocumentService.cs:453-470 (there,
 *     `tagBits` plays the same role as `unclosedGreaterThans` here). Bracket characters
 *     are not tracked in this pass, matching the C#: nesting is decided purely by '<'/'>'.
 *
 *  2. Scan forward from just after that '<', counting only top-level dots — a dot inside
 *     a `[...]` parameter, or inside a nested `<...>`, does not count. Mirrors the
 *     forward walk at TextDocumentService.cs:474-501. That C# range also lowercases the
 *     tag text before scanning it; this port does not, since counting dot/bracket/angle
 *     positions does not depend on case.
 *
 * Returns null when the cursor is not inside an unclosed tag — no '<' at all in
 * `argThusFar`, or the nearest one is already closed by a '>' before the cursor.
 */
function findTagAtCursor(argThusFar, argStart) {
    // Pass 1: TextDocumentService.cs:453-470.
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
    const tagSoFar = argThusFar.substring(relevantTagStart);
    const tagStart = argStart + relevantTagStart;
    // Pass 2: TextDocumentService.cs:474-501.
    let componentCount = 0;
    let subTags = 0;
    let squareBrackets = 0;
    let lastDot = 0;
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
        }
        else if (ch === ']' && subTags === 0) {
            squareBrackets--;
        }
        else if (ch === '.' && subTags === 0 && squareBrackets === 0) {
            componentCount++;
            lastDot = i + 1;
        }
    }
    const lastComponent = tagSoFar.substring(lastDot);
    const lastComponentStart = tagStart + lastDot;
    return { tagSoFar, tagStart, componentCount, lastComponent, lastComponentStart };
}
exports.findTagAtCursor = findTagAtCursor;
//# sourceMappingURL=tagContext.js.map