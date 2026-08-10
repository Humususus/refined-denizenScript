"use strict";
/**
 * Cursor-position line arithmetic shared by the completion and hover providers.
 * Ported from the offset handling at the top of
 * DenizenLangServer/Services/TextDocumentService.cs (Hover, GetCompletionsFor).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFullLine = exports.getLineContext = void 0;
function isInRange(text, offset) {
    return offset >= 0 && offset <= text.length;
}
/**
 * Offset of the first character of the line containing `offset`.
 * `offset === 0` is special-cased: `lastIndexOf` clamps a negative `fromIndex`
 * to 0 rather than treating it as "no match", so `lastIndexOf('\n', -1)` would
 * wrongly report a hit on a document whose very first character is a newline.
 */
function findStartOfLine(text, offset) {
    if (offset === 0) {
        return 0;
    }
    return text.lastIndexOf('\n', offset - 1) + 1;
}
/** Extracts the text preceding the cursor on its own line. Returns null if the offset is out of range. */
function getLineContext(text, offset) {
    if (!isInRange(text, offset)) {
        return null;
    }
    const startOfLine = findStartOfLine(text, offset);
    let linePrefix = text.substring(startOfLine, offset);
    if (linePrefix.endsWith('\r')) {
        linePrefix = linePrefix.substring(0, linePrefix.length - 1);
    }
    const trimmedRaw = linePrefix.trimStart();
    return {
        linePrefix,
        trimmed: trimmedRaw.toLowerCase(),
        indent: linePrefix.length - trimmedRaw.length
    };
}
exports.getLineContext = getLineContext;
/** Extracts the entire line the cursor sits on. Returns null if the offset is out of range. */
function getFullLine(text, offset) {
    if (!isInRange(text, offset)) {
        return null;
    }
    const startOfLine = findStartOfLine(text, offset);
    let endOfLine = text.indexOf('\n', startOfLine);
    if (endOfLine === -1) {
        endOfLine = text.length;
    }
    let line = text.substring(startOfLine, endOfLine);
    if (line.endsWith('\r')) {
        line = line.substring(0, line.length - 1);
    }
    return { line, startOfLine };
}
exports.getFullLine = getFullLine;
//# sourceMappingURL=lineContext.js.map