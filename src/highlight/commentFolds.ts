// Folding for runs of comments (2.6.0): several `#` lines in a row collapse to one, as do several
// `##` or `###` lines. No `vscode` import; the folding provider in extension.ts adds these to the
// block folds it already computes.

import { commentKind, CommentKind } from './commentKind';

/**
 * Maximal runs of at least two consecutive lines with the same comment kind and the same
 * indentation. A blank line, a non-comment line, another kind or another indent ends a run -- so a
 * run never reaches past the block it sits in.
 */
export function commentFoldRanges(lines: string[], headerSymbols: string): { start: number; end: number }[] {
    const ranges: { start: number; end: number }[] = [];
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
        if (kind !== null && kind === runKind && indent === runIndent) {
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
