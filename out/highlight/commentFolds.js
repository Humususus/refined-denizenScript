"use strict";
// Folding for runs of comments (2.6.0): several `#` lines in a row collapse to one, as do several
// `##` or `###` lines. No `vscode` import; the folding provider in extension.ts adds these to the
// block folds it already computes.
Object.defineProperty(exports, "__esModule", { value: true });
exports.commentFoldRanges = void 0;
const commentKind_1 = require("./commentKind");
/**
 * Maximal runs of at least two consecutive lines with the same comment kind and the same
 * indentation. A blank line, a non-comment line, another kind or another indent ends a run -- so a
 * run never reaches past the block it sits in.
 */
function commentFoldRanges(lines, headerSymbols) {
    const ranges = [];
    let runStart = -1;
    let runKind = null;
    let runIndent = -1;
    const close = (end) => {
        if (runStart !== -1 && end > runStart) {
            ranges.push({ start: runStart, end });
        }
        runStart = -1;
        runKind = null;
    };
    lines.forEach((line, i) => {
        const kind = (0, commentKind_1.commentKind)(line, headerSymbols);
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
exports.commentFoldRanges = commentFoldRanges;
//# sourceMappingURL=commentFolds.js.map