// Folding for comments (2.6.0, reworked 2.8.0). No `vscode` import; the folding provider in
// extension.ts adds these to the block folds it already computes.
//
// Two levels. A BLOCK is every comment line in a row at one indentation, whatever its kind, and
// folds from its first line: a banner (`# ====`, notes, `#   - run …` examples, `# ====`) collapses
// to its top line. Reported 2026-10-27 -- the 2.6.0 rule folded only same-kind runs, so such a
// block fell apart into fragments and its first line had no fold at all. Inside a block, each run
// of one kind (`#`, `##`, `###`, …) keeps its own smaller fold.

import { commentKind, CommentKind } from './commentKind';

type Range = { start: number; end: number };

/**
 * Maximal runs of at least two consecutive comment lines with the same indentation, for which
 * `same(kind of the run's first line, kind of this line)` holds. A blank line, a non-comment line
 * or another indent ends a run -- so a run never reaches past the block it sits in.
 */
function runs(lines: string[], headerSymbols: string, same: (a: CommentKind, b: CommentKind) => boolean): Range[] {
    const ranges: Range[] = [];
    let runStart = -1;
    let runKind: CommentKind | null = null;
    let runIndent = -1;
    const close = (end: number) => {
        if (runStart !== -1 && end > runStart) {
            ranges.push({ start: runStart, end });
        }
        runStart = -1;
        runKind = null;
    };
    lines.forEach((line, i) => {
        const kind = commentKind(line, headerSymbols);
        const indent = line.length - line.trimStart().length;
        if (kind !== null && runKind !== null && same(runKind, kind) && indent === runIndent) {
            return;
        }
        close(i - 1);
        if (kind !== null) {
            runStart = i;
            runKind = kind;
            runIndent = indent;
        }
    });
    close(lines.length - 1);
    return ranges;
}

/** Comment blocks, then the same-kind runs inside them that do not start where their block does. */
export function commentFoldRanges(lines: string[], headerSymbols: string): Range[] {
    const blocks = runs(lines, headerSymbols, () => true);
    const blockStarts = new Set(blocks.map(b => b.start));
    // Two folds on one line cannot both be offered; the block's is the one that line should fold.
    const inner = runs(lines, headerSymbols, (a, b) => a === b).filter(r => !blockStarts.has(r.start));
    return [...blocks, ...inner];
}
