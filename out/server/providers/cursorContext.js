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
 * when it is outside quotes and outside tag brackets. Mirrors the tag/argument walk in
 * DenizenLangServer/Services/TextDocumentService.cs:427-448, which a naive split cannot:
 * `narrate "hello world"` is ONE argument, and so is `<player.flag[a b]>`.
 *
 * This is a related but different algorithm from SharpDenizenTools/ScriptAnalysis/
 * ScriptChecker.cs's `BuildArgs` — that method additionally strips quotes from the
 * argument text it returns, tracks `[`/`]` nesting inside tags, and carries a fallback
 * flag, none of which this scanner does. The one piece it DOES take from `BuildArgs` is
 * the quote-open gate below (see that branch for the citation).
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
        // A quote opens only at the very start of the text or immediately after a
        // space — never mid-word — so an apostrophe in ordinary text (bob's, it's)
        // stays part of the current token instead of opening an unterminated quote
        // that swallows the rest of the line. Ported from the gate in
        // SharpDenizenTools/ScriptAnalysis/ScriptChecker.cs:706-716's `BuildArgs`:
        //     if (currentQuote == '\0' && inTagParams == 0)
        //     {
        //         if (i == 0 || stringArgs[i - 1] == ' ')
        //         {
        //             currentQuote = c;
        // Only the `i == 0 || stringArgs[i - 1] == ' '` gate is ported here — the
        // `inTagParams` condition is not, since this scanner has no separate
        // tag-parameter depth (that is out of scope; see the file-level doc comment).
        if ((ch === '"' || ch === '\'') && (i === 0 || text[i - 1] === ' ')) {
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
    const spans = splitTopLevelArguments(rest);
    const endsWithSeparator = rest.length > 0 && rest.endsWith(' ') && spans.length > 0 && spans[spans.length - 1].end < rest.length;
    // spans.length - 2 can go below -1 (e.g. a line that is just `- ` followed only by
    // more spaces: spans is empty and endsWithSeparator is false, giving -2). Clamp so
    // the documented contract below ("0-based index, or -1 while typing the name") holds
    // even for that degenerate input, rather than leaking a garbage negative value.
    const argIndex = typingName ? -1 : Math.max(endsWithSeparator ? spans.length - 1 : spans.length - 2, -1);
    // The cursor's column on the full line — also `argEnd` in every case below, since
    // the cursor always sits at the end of whatever the caller passed in.
    const cursorColumn = indent + trimmed.length;
    let argThusFar;
    let argStart;
    const argEnd = cursorColumn;
    if (typingName) {
        // No argument exists yet while the command name itself is still being typed —
        // leave this exactly as it was before spans existed.
        argThusFar = '';
        argStart = nameStart + rest.length;
    }
    else {
        const lastSpan = spans.length > 0 ? spans[spans.length - 1] : undefined;
        if (endsWithSeparator || !lastSpan) {
            // A trailing separator space (or an all-whitespace `rest`, e.g. `-   `, where
            // no span ever opens) means the cursor is starting a new, still-empty argument.
            argThusFar = '';
            argStart = cursorColumn;
        }
        else {
            // The cursor sits inside the same top-level argument span argIndex was derived
            // from, so the two can no longer disagree about which argument is "current" the
            // way the old `rest.lastIndexOf(' ')` derivation could.
            argThusFar = rest.substring(lastSpan.start, lastSpan.end);
            argStart = nameStart + lastSpan.start;
        }
    }
    const colon = argThusFar.indexOf(':');
    return {
        name,
        typingName,
        nameStart,
        nameEnd: nameStart + name.length,
        argThusFar,
        argPrefix: colon === -1 ? '' : argThusFar.substring(0, colon),
        argValue: colon === -1 ? argThusFar : argThusFar.substring(colon + 1),
        argStart,
        argEnd,
        argIndex
    };
}
exports.parseCommandLine = parseCommandLine;
/**
 * Parses the context at `offset` within `text`. Returns a `'command'` context on a
 * `- command` line, a `'line'` context otherwise (mirrors TextDocumentService.cs's
 * `LinePrefixCompleters` branch at :408-420, which runs on any non-command line),
 * and `null` only when `offset` is out of range.
 */
function parseCursorContext(text, offset) {
    const line = (0, lineContext_1.getLineContext)(text, offset);
    if (line === null) {
        return null;
    }
    const command = parseCommandLine(line.trimmed, line.indent);
    if (command !== null) {
        return Object.assign({ kind: 'command' }, command);
    }
    return { kind: 'line', linePrefix: line.linePrefix, trimmed: line.trimmed, indent: line.indent };
}
exports.parseCursorContext = parseCursorContext;
//# sourceMappingURL=cursorContext.js.map