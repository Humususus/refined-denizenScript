/**
 * Parses the command context under the cursor, shared by the completion and hover
 * providers. Consolidates the line-walking that C# performs separately in
 * TextDocumentService.GetCompletionsFor (the `- ` branch) and GetHoverAt.
 */

import { getLineContext } from './lineContext';

/** One top-level argument of a command line, with its bounds inside the scanned text. */
export interface ArgumentSpan { start: number; end: number; }

/**
 * ASCII characters that may legally begin a Denizen tag immediately after `<`. Mirrors
 * `VALID_TAG_FIRST_CHAR` in SharpDenizenTools/ScriptAnalysis/ScriptChecker.cs:650 (ASCII
 * letters, digits, `&`, `_`, `[`) exactly, including its ASCII-only scope — deliberately
 * not Unicode-aware, so behaviour matches C# bit for bit.
 */
export function isValidTagFirstChar(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch === '&' || ch === '_' || ch === '[';
}

/**
 * Splits command-line text into top-level arguments: a space separates arguments only
 * when it is outside quotes and outside tag brackets. Mirrors how DenizenCore itself
 * builds arguments (see SharpDenizenTools ScriptChecker.BuildArgs), which a naive
 * split cannot: `narrate "hello world"` is ONE argument, and so is `<player.flag[a b]>`.
 */
export function splitTopLevelArguments(text: string): ArgumentSpan[] {
    const spans: ArgumentSpan[] = [];
    let quote: string | null = null;
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

/**
 * What the cursor is looking at on a `- command args...` line.
 *
 * WARNING: `argIndex` is derived from the quote/tag-aware `splitTopLevelArguments`,
 * but `argThusFar`/`argStart`/`argEnd`/`argPrefix`/`argValue` are still derived from a
 * plain `rest.lastIndexOf(' ')`. They can therefore disagree about which argument is
 * "current": `parseCommandLine('- narrate "hello world', 2)` gives `argIndex` `0`
 * (correct — the cursor is inside the single open-quoted argument) but `argThusFar`
 * `'world'` (truncated at the last plain space, inside the quotes — it loses the
 * open quote and the `hello ` before it). Do not assume a
 * consumer can naively combine `argIndex` with the `arg*` fields to mean the same
 * span of text. This is a known gap, deliberately left unfixed here — fixing it moves
 * completion filtering behaviour, which is deferred to a later phase.
 */
export interface CommandCursorContext {
    /** The command name, lowercased. May be a partial word while being typed. */
    name: string;
    /** True while the name itself is being typed — no space follows it yet. */
    typingName: boolean;
    /** Column on the line where the command name starts. */
    nameStart: number;
    /** Column one past the last character of the command name. */
    nameEnd: number;
    /** The whitespace-delimited argument the cursor sits in. Empty after a trailing space. */
    argThusFar: string;
    /** Text before the first `:` of `argThusFar`, or `''` when it has no colon. */
    argPrefix: string;
    /** Text after the first `:` of `argThusFar`, or all of it when it has no colon. */
    argValue: string;
    /** Column on the line where `argThusFar` begins. */
    argStart: number;
    /** Column on the line where `argThusFar` ends — the cursor column. */
    argEnd: number;
    /** 0-based index of the argument the cursor sits in, counting after the command name. -1 while the name itself is being typed. */
    argIndex: number;
}

/**
 * Parses an already-trimmed, already-lowercased command line.
 * `indent` is how many characters were trimmed from its left, so the returned
 * columns are relative to the full line.
 */
export function parseCommandLine(trimmed: string, indent: number): CommandCursorContext | null {
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

/** Parses the command context at `offset` within `text`, or null if the cursor is not on a command line. */
export function parseCursorContext(text: string, offset: number): CommandCursorContext | null {
    const line = getLineContext(text, offset);
    if (line === null) {
        return null;
    }
    return parseCommandLine(line.trimmed, line.indent);
}
