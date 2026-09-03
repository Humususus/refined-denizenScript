/**
 * Cursor-position line arithmetic shared by the completion and hover providers.
 * Ported from the offset handling at the top of
 * DenizenLangServer/Services/TextDocumentService.cs (Hover, GetCompletionsFor).
 */

/** The portion of the cursor's line that precedes the cursor. */
export interface LineContext {
    /** Raw text from line start up to (not including) the cursor. */
    linePrefix: string;
    /** `linePrefix` with leading whitespace removed and lowercased. */
    trimmed: string;
    /** How many leading whitespace characters were removed to produce `trimmed`. */
    indent: number;
}

/** A whole line plus where it begins in the document. */
export interface FullLine {
    /** The line text, excluding any line terminator. */
    line: string;
    /** Absolute offset of the line's first character. */
    startOfLine: number;
}

function isInRange(text: string, offset: number): boolean {
    return offset >= 0 && offset <= text.length;
}

/**
 * Offset of the first character of the line containing `offset`.
 * `offset === 0` is special-cased: `lastIndexOf` clamps a negative `fromIndex`
 * to 0 rather than treating it as "no match", so `lastIndexOf('\n', -1)` would
 * wrongly report a hit on a document whose very first character is a newline.
 */
function findStartOfLine(text: string, offset: number): number {
    if (offset === 0) {
        return 0;
    }
    return text.lastIndexOf('\n', offset - 1) + 1;
}

/** Extracts the text preceding the cursor on its own line. Returns null if the offset is out of range. */
export function getLineContext(text: string, offset: number): LineContext | null {
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

/** Extracts the entire line the cursor sits on. Returns null if the offset is out of range. */
export function getFullLine(text: string, offset: number): FullLine | null {
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
