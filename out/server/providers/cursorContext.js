"use strict";
/**
 * Parses the command context under the cursor, shared by the completion and hover
 * providers. Consolidates the line-walking that C# performs separately in
 * TextDocumentService.GetCompletionsFor (the `- ` branch) and GetHoverAt.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCursorContext = exports.parseCommandLine = exports.splitTopLevelArguments = exports.isValidTagFirstChar = void 0;
const lineContext_1 = require("./lineContext");
/**
 * ASCII characters that may legally begin a Denizen tag immediately after `<`. Mirrors
 * `VALID_TAG_FIRST_CHAR` in SharpDenizenTools/ScriptAnalysis/ScriptChecker.cs:650 (ASCII
 * letters, digits, `&`, `_`, `[`) exactly, including its ASCII-only scope — deliberately
 * not Unicode-aware, so behaviour matches C# bit for bit.
 */
function isValidTagFirstChar(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch === '&' || ch === '_' || ch === '[';
}
exports.isValidTagFirstChar = isValidTagFirstChar;
/**
 * Splits command-line text into top-level arguments: a space separates arguments only
 * when it is outside quotes and outside tag brackets. Mirrors how DenizenCore itself
 * builds arguments (see SharpDenizenTools ScriptChecker.BuildArgs), which a naive
 * split cannot: `narrate "hello world"` is ONE argument, and so is `<player.flag[a b]>`.
 */
function splitTopLevelArguments(text) {
    const spans = [];
    let quote = null;
    let depth = 0;
    let tokenStart = -1;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        // A space is a separator only outside quotes and outside tag brackets. This is
        // decided once, up front, from the state carried in from previous characters —
        // every other branch below only toggles that state, never decides separator-ness.
        const isSeparator = ch === ' ' && quote === null && depth === 0;
        if (isSeparator) {
            if (tokenStart !== -1) {
                spans.push({ start: tokenStart, end: i });
                tokenStart = -1;
            }
            continue;
        }
        // Any non-separator character opens a token if one is not already open. This is
        // the single place that decision is made, so no branch below can skip it — that
        // was the bug: `>` used to close depth without ever opening a token itself.
        if (tokenStart === -1) {
            tokenStart = i;
        }
        if (quote !== null) {
            if (ch === quote) {
                quote = null;
            }
            continue;
        }
        if (ch === '"' || ch === '\'') {
            quote = ch;
            continue;
        }
        if (ch === '<') {
            // C# only opens a tag scope when the next character could actually begin a
            // tag (ScriptChecker.cs:681's lookahead) — otherwise a bare `<` used as a
            // comparator, e.g. `a < b`, would swallow the rest of the line.
            if (i + 1 < text.length && isValidTagFirstChar(text[i + 1])) {
                depth++;
            }
            continue;
        }
        if (ch === '>') {
            if (depth > 0) {
                depth--;
            }
            continue;
        }
    }
    if (tokenStart !== -1) {
        spans.push({ start: tokenStart, end: text.length });
    }
    return spans;
}
exports.splitTopLevelArguments = splitTopLevelArguments;
/**
 * Parses an already-trimmed, already-lowercased command line.
 * `indent` is how many characters were trimmed from its left, so the returned
 * columns are relative to the full line.
 */
function parseCommandLine(trimmed, indent) {
    if (!trimmed.startsWith('- ')) {
        return null;
    }
    let nameStart = indent + 2;
    let rest = trimmed.substring(2);
    if (rest.startsWith('~')) {
        rest = rest.substring(1);
        nameStart++;
    }
    const firstSpace = rest.indexOf(' ');
    const name = firstSpace === -1 ? rest : rest.substring(0, firstSpace);
    const typingName = firstSpace === -1;
    // Offset of argThusFar within `rest`: the empty string right after `rest`
    // itself while the name is still being typed (there is no argument yet), or
    // the text following the last space otherwise.
    const argOffsetInRest = typingName ? rest.length : rest.lastIndexOf(' ') + 1;
    const argThusFar = typingName ? '' : rest.substring(argOffsetInRest);
    const colon = argThusFar.indexOf(':');
    const spans = splitTopLevelArguments(rest);
    const endsWithSeparator = rest.length > 0 && rest.endsWith(' ') && spans.length > 0 && spans[spans.length - 1].end < rest.length;
    // spans.length - 2 can go below -1 (e.g. a line that is just `- ` followed only by
    // more spaces: spans is empty and endsWithSeparator is false, giving -2). Clamp so
    // the documented contract below ("0-based index, or -1 while typing the name") holds
    // even for that degenerate input, rather than leaking a garbage negative value.
    const argIndex = typingName ? -1 : Math.max(endsWithSeparator ? spans.length - 1 : spans.length - 2, -1);
    return {
        name,
        typingName,
        nameStart,
        nameEnd: nameStart + name.length,
        argThusFar,
        argPrefix: colon === -1 ? '' : argThusFar.substring(0, colon),
        argValue: colon === -1 ? argThusFar : argThusFar.substring(colon + 1),
        argStart: nameStart + argOffsetInRest,
        argEnd: indent + trimmed.length,
        argIndex
    };
}
exports.parseCommandLine = parseCommandLine;
/** Parses the command context at `offset` within `text`, or null if the cursor is not on a command line. */
function parseCursorContext(text, offset) {
    const line = (0, lineContext_1.getLineContext)(text, offset);
    if (line === null) {
        return null;
    }
    return parseCommandLine(line.trimmed, line.indent);
}
exports.parseCursorContext = parseCursorContext;
//# sourceMappingURL=cursorContext.js.map