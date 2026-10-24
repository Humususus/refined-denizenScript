// Turns the highlighter's tokens into LSP semantic tokens for the Denizen palette. No `vscode`
// import, so the overlap and line-splitting rules are unit-tested.
//
// THE OVERLAP RULE IS THE ONE 2.4.1 RENDERED. Highlight tokens overlap (a `tag` inside an
// argument's `normal`, a `tag_dot` inside a `tag`); semantic tokens may not. As decorations, the
// winner was whichever decoration type VS Code painted last, and the types were created in
// COLOR_TYPES order -- so for every character, the token whose type is later in COLOR_TYPES wins.
// Emit order does not matter, which is what makes this a rule rather than an accident.

import { COLOR_TYPES, HighlightOptions, HighlightToken, highlightLines } from './denizenHighlighter';

/** Palette types that become semantic tokens. `bad_space` stays a decoration: it is a background. */
const TOKEN_COLOR_TYPES = COLOR_TYPES.filter(t => t !== 'bad_space');

/** The semantic token legend, in index order: `denizen_<colorType>`. */
export const SEMANTIC_TYPES: readonly string[] = TOKEN_COLOR_TYPES.map(t => 'denizen_' + t);

/** Legend index for a palette type, or -1 if it is not a semantic token type. */
export function semanticIndex(colorType: string): number {
    return TOKEN_COLOR_TYPES.indexOf(colorType);
}

export interface FlatToken {
    line: number;
    start: number;
    length: number;
    typeIndex: number;
}

/**
 * Resolves overlaps (later COLOR_TYPES type wins), splits multi-line tokens per line, drops inline
 * colours / bad_space / empty runs, and merges adjacent same-type runs. Output is sorted and
 * non-overlapping. `lineLengths[i]` is line i's length without its line break.
 */
export function flattenTokens(tokens: HighlightToken[], lineLengths: number[]): FlatToken[] {
    // Per line, the winning COLOR_TYPES index for each character (-1 = uncoloured).
    const cells = new Map<number, Int16Array>();
    const paint = (line: number, from: number, to: number, precedence: number) => {
        const length = lineLengths[line] ?? 0;
        from = Math.max(0, from);
        to = Math.min(to, length);
        if (to <= from) {
            return;
        }
        let row = cells.get(line);
        if (row === undefined) {
            row = new Int16Array(length).fill(-1);
            cells.set(line, row);
        }
        for (let c = from; c < to; c++) {
            if (precedence > row[c]) {
                row[c] = precedence;
            }
        }
    };
    for (const t of tokens) {
        if (semanticIndex(t.type) < 0) {
            continue;
        }
        const precedence = COLOR_TYPES.indexOf(t.type);
        for (let line = t.line; line <= t.endLine; line++) {
            const from = line === t.line ? t.start : 0;
            const to = line === t.endLine ? t.end : (lineLengths[line] ?? 0);
            paint(line, from, to, precedence);
        }
    }
    const out: FlatToken[] = [];
    for (const line of [...cells.keys()].sort((a, b) => a - b)) {
        const row = cells.get(line)!;
        let c = 0;
        while (c < row.length) {
            const precedence = row[c];
            let end = c + 1;
            while (end < row.length && row[end] === precedence) {
                end++;
            }
            if (precedence >= 0) {
                out.push({ line, start: c, length: end - c, typeIndex: semanticIndex(COLOR_TYPES[precedence]) });
            }
            c = end;
        }
    }
    return out;
}

/** The whole pipeline for one document, split on '\n' as the highlighter expects. */
export function buildSemanticTokens(splitText: string[], opts: HighlightOptions): Uint32Array {
    const lineLengths = splitText.map(line => line.endsWith('\r') ? line.length - 1 : line.length);
    return encodeSemanticTokens(flattenTokens(highlightLines(splitText, opts), lineLengths));
}

/** Standard LSP relative encoding: deltaLine, deltaStart, length, tokenType, modifiers (none). */
export function encodeSemanticTokens(flat: FlatToken[]): Uint32Array {
    const data = new Uint32Array(flat.length * 5);
    let prevLine = 0;
    let prevStart = 0;
    flat.forEach((t, i) => {
        const deltaLine = t.line - prevLine;
        data[i * 5] = deltaLine;
        data[i * 5 + 1] = deltaLine === 0 ? t.start - prevStart : t.start;
        data[i * 5 + 2] = t.length;
        data[i * 5 + 3] = t.typeIndex;
        data[i * 5 + 4] = 0;
        prevLine = t.line;
        prevStart = t.start;
    });
    return data;
}
