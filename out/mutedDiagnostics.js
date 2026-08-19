"use strict";
/**
 * In-memory store of "muted" script ranges, keyed by document key (e.g. a
 * file URI or path string). Mutes exist only for the lifetime of the process:
 * no comment markers are written into script files and nothing persists
 * across restarts.
 *
 * Ranges are deliberately line-oriented, not character-oriented: a mute
 * describes a region of script the user selected, so edits shift and grow
 * ranges by whole lines (see `applyEdit`) and column drift within a line is
 * intentionally ignored. Do not "fix" this into character-precise tracking.
 *
 * Kept free of any `vscode` import (unlike extension.ts) so it can be
 * unit-tested with vitest outside the Extension Host. It uses its own plain
 * `MutePosition`/`MuteRange` shapes instead of `vscode.Position`/`vscode.Range`
 * for the same reason.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MutedRegions = exports.wholeLineMuteBounds = exports.countNewLines = void 0;
/**
 * Compares two positions by line first, then by character. Returns a
 * negative number if `a` is before `b`, a positive number if `a` is after
 * `b`, and zero if they are equal.
 */
function comparePositions(a, b) {
    if (a.line !== b.line) {
        return a.line - b.line;
    }
    return a.character - b.character;
}
/**
 * Counts the newlines in a piece of replacement text, which is exactly the
 * value `applyEdit` wants for its `newLineCount` parameter.
 *
 * Beware the tempting off-by-one: `applyEdit`'s delta is
 * `newLineCount - (changed.end.line - changed.start.line)`, and both halves of
 * that subtraction are *line spans*, not line counts. Replacing the zero-span
 * range `5:0-5:0` with the text `"\n"` adds exactly one line, so the delta must
 * be `1 - 0 = 1`, which means `newLineCount` is the number of newline
 * characters (1) and not the number of lines the text occupies (2). Passing the
 * latter would silently shift every mute one line too far on every edit.
 *
 * Splitting on '\n' also handles CRLF text correctly, since each "\r\n" still
 * contributes exactly one '\n'.
 */
function countNewLines(text) {
    return text.split('\n').length - 1;
}
exports.countNewLines = countNewLines;
/**
 * Widens a selection to the whole lines it touches, because mutes are
 * line-oriented: muting half a line would be a lie about what got silenced.
 *
 * A selection that ends at character 0 of a line does not actually touch that
 * line's text (this is what a shift+down selection looks like), so the last
 * line is dropped — unless doing so would leave nothing, i.e. the selection is
 * empty or sits entirely on one line, in which case that single line is muted.
 */
function wholeLineMuteBounds(startLine, endLine, endCharacter) {
    if (endLine > startLine && endCharacter === 0) {
        return { startLine: startLine, endLine: endLine - 1 };
    }
    return { startLine: startLine, endLine: endLine };
}
exports.wholeLineMuteBounds = wholeLineMuteBounds;
class MutedRegions {
    constructor() {
        this.rangesByKey = new Map();
    }
    mute(key, range) {
        const ranges = this.rangesByKey.get(key);
        if (ranges) {
            ranges.push(range);
        }
        else {
            this.rangesByKey.set(key, [range]);
        }
    }
    unmuteAll(key) {
        this.rangesByKey.delete(key);
    }
    unmuteAt(key, position) {
        const ranges = this.rangesByKey.get(key);
        if (!ranges) {
            return false;
        }
        // Every range covering the position is removed, not just the first
        // match: "unmute at my cursor" means the cursor's line goes back to
        // reporting diagnostics, and that is only true once none of the
        // (possibly overlapping, possibly duplicate) muted ranges still cover
        // it.
        const survivors = ranges.filter(r => !(comparePositions(position, r.start) >= 0 && comparePositions(position, r.end) <= 0));
        if (survivors.length === ranges.length) {
            return false;
        }
        this.rangesByKey.set(key, survivors);
        return true;
    }
    covers(key, range) {
        const ranges = this.rangesByKey.get(key);
        if (!ranges) {
            return false;
        }
        return ranges.some(r => comparePositions(range.start, r.end) <= 0 && comparePositions(range.end, r.start) >= 0);
    }
    rangesFor(key) {
        // Defensive copy, but only a shallow one: the returned array is a new
        // array, so callers can freely push/splice/sort it without touching
        // our internal state, but its MuteRange elements are the very same
        // objects we hold internally. Callers must treat those elements as
        // read-only (no mutating start/end in place) or they will corrupt
        // this store.
        const ranges = this.rangesByKey.get(key);
        return ranges ? ranges.slice() : [];
    }
    forget(key) {
        this.rangesByKey.delete(key);
    }
    applyEdit(key, changed, newLineCount) {
        const ranges = this.rangesByKey.get(key);
        if (!ranges) {
            return;
        }
        const delta = newLineCount - (changed.end.line - changed.start.line);
        const survivors = [];
        for (const r of ranges) {
            if (comparePositions(changed.end, r.start) <= 0) {
                // Edit is entirely before (or touches the start of) the range: shift it.
                survivors.push({
                    start: { line: r.start.line + delta, character: r.start.character },
                    end: { line: r.end.line + delta, character: r.end.character },
                });
            }
            else if (comparePositions(changed.start, r.end) > 0) {
                // Edit is entirely after the range: leave it alone.
                survivors.push(r);
            }
            else if (comparePositions(changed.start, r.start) >= 0 && comparePositions(changed.end, r.end) <= 0) {
                // Edit is wholly inside the range: extend only the end.
                survivors.push({
                    start: r.start,
                    end: { line: r.end.line + delta, character: r.end.character },
                });
            }
            else if (comparePositions(changed.start, r.start) <= 0 && comparePositions(changed.end, r.end) < 0) {
                // Edit overlaps the front of the range but its end lands
                // strictly inside it: a tail survives (e.g. mute 10-20, then
                // delete 5-15 — old lines 15-20 survive and become 5-10). The
                // range's old start no longer exists, so it follows the
                // edit's start; the end shifts by delta like any other case.
                survivors.push({
                    start: { line: changed.start.line, character: changed.start.character },
                    end: { line: r.end.line + delta, character: r.end.character },
                });
            }
            else if (comparePositions(changed.start, r.start) > 0 && comparePositions(changed.end, r.end) >= 0) {
                // Mirror of the front-overlap case: the edit starts strictly
                // inside the range but reaches its end or beyond (e.g. mute
                // 10-20, then delete 15-25 — old lines 10-14 survive
                // untouched, since they're entirely before the edit). The
                // range's old end no longer exists, so it truncates to where
                // the edit began; the start is untouched (nothing before the
                // edit's start shifts).
                survivors.push({
                    start: r.start,
                    end: { line: changed.start.line, character: changed.start.character },
                });
            }
            // Otherwise the edit starts at or before the range's start and
            // ends at or after the range's end, so it spans the whole range
            // (or more) and nothing survives: drop it.
        }
        this.rangesByKey.set(key, survivors);
    }
}
exports.MutedRegions = MutedRegions;
//# sourceMappingURL=mutedDiagnostics.js.map