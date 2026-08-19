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

export interface MutePosition {
    line: number;
    character: number;
}

export interface MuteRange {
    start: MutePosition;
    end: MutePosition;
}

/**
 * Compares two positions by line first, then by character. Returns a
 * negative number if `a` is before `b`, a positive number if `a` is after
 * `b`, and zero if they are equal.
 */
function comparePositions(a: MutePosition, b: MutePosition): number {
    if (a.line !== b.line) {
        return a.line - b.line;
    }
    return a.character - b.character;
}

export class MutedRegions {
    private readonly rangesByKey = new Map<string, MuteRange[]>();

    mute(key: string, range: MuteRange): void {
        const ranges = this.rangesByKey.get(key);
        if (ranges) {
            ranges.push(range);
        } else {
            this.rangesByKey.set(key, [range]);
        }
    }

    unmuteAll(key: string): void {
        this.rangesByKey.delete(key);
    }

    unmuteAt(key: string, position: MutePosition): boolean {
        const ranges = this.rangesByKey.get(key);
        if (!ranges) {
            return false;
        }
        const index = ranges.findIndex(r =>
            comparePositions(position, r.start) >= 0 && comparePositions(position, r.end) <= 0
        );
        if (index === -1) {
            return false;
        }
        ranges.splice(index, 1);
        return true;
    }

    covers(key: string, range: MuteRange): boolean {
        const ranges = this.rangesByKey.get(key);
        if (!ranges) {
            return false;
        }
        return ranges.some(r =>
            comparePositions(range.start, r.end) <= 0 && comparePositions(range.end, r.start) >= 0
        );
    }

    rangesFor(key: string): MuteRange[] {
        return this.rangesByKey.get(key) ?? [];
    }

    forget(key: string): void {
        this.rangesByKey.delete(key);
    }

    applyEdit(key: string, changed: MuteRange, newLineCount: number): void {
        const ranges = this.rangesByKey.get(key);
        if (!ranges) {
            return;
        }
        const delta = newLineCount - (changed.end.line - changed.start.line);
        const survivors: MuteRange[] = [];
        for (const r of ranges) {
            if (comparePositions(changed.end, r.start) <= 0) {
                // Edit is entirely before (or touches the start of) the range: shift it.
                survivors.push({
                    start: { line: r.start.line + delta, character: r.start.character },
                    end: { line: r.end.line + delta, character: r.end.character },
                });
            } else if (comparePositions(changed.start, r.end) > 0) {
                // Edit is entirely after the range: leave it alone.
                survivors.push(r);
            } else if (comparePositions(changed.start, r.start) >= 0 && comparePositions(changed.end, r.end) <= 0) {
                // Edit is wholly inside the range: extend only the end.
                survivors.push({
                    start: r.start,
                    end: { line: r.end.line + delta, character: r.end.character },
                });
            } else if (comparePositions(changed.start, r.start) <= 0 && comparePositions(changed.end, r.end) < 0) {
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
            // Otherwise the edit's end is at or past the range's end, so it
            // spans the whole range (or more) and nothing survives: drop it.
        }
        this.rangesByKey.set(key, survivors);
    }
}
