"use strict";
// Pretty-printing for long Denizen tags -- `<map[...]>` and `<list[...]>` in particular.
//
// WHY THIS IS DISPLAY-ONLY. Denizen's parser accepts a tag only on a single line, so the
// formatted form can never be written to the file. Everything here produces a STRING for a
// hover, a peek or a panel to render; nothing here edits a document.
//
// No `vscode` import on purpose: this stays a pure function of its inputs so it can be unit
// tested, same as ./mutedDiagnostics and ./entryTags.
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCollapsible = exports.collapseTag = exports.formatTag = exports.splitTagEntries = exports.findTagAt = void 0;
/**
 * Walks `text` from `from`, tracking tag and bracket depth, and returns the index of the first
 * character at depth zero that `predicate` accepts, or -1.
 *
 * Depth is the whole reason this exists: a `;` inside a nested tag separates nothing, and a
 * naive `split(';')` on the user's own example would tear
 * `<[start].left[<element[<[lefted].mul[<[new_t]>]>]>]>` into pieces. Same counting rule as
 * `buildArgs` in the checker, kept separate because this module is client-side and must not
 * depend on the server.
 */
function findAtDepthZero(text, from, predicate) {
    let tagDepth = 0;
    let bracketDepth = 0;
    for (let i = from; i < text.length; i++) {
        const ch = text[i];
        if (ch === '<') {
            tagDepth++;
        }
        else if (ch === '>' && tagDepth > 0) {
            tagDepth--;
        }
        else if (ch === '[') {
            bracketDepth++;
        }
        else if (ch === ']' && bracketDepth > 0) {
            bracketDepth--;
        }
        else if (tagDepth === 0 && bracketDepth === 0 && predicate(ch)) {
            return i;
        }
    }
    return -1;
}
/** Splits `text` on every `separator` that sits at depth zero. */
function splitAtDepthZero(text, separator) {
    const parts = [];
    let start = 0;
    for (;;) {
        const index = findAtDepthZero(text, start, ch => ch === separator);
        if (index === -1) {
            parts.push(text.substring(start));
            return parts;
        }
        parts.push(text.substring(start, index));
        start = index + 1;
    }
}
/**
 * Finds the tag surrounding `character` in `line`, if any.
 *
 * Scans back to the nearest `<` at or before the cursor whose matching `>` is at or after it, so
 * putting the cursor anywhere inside a nested tag finds the OUTERMOST one -- which is the one
 * worth formatting.
 */
function findTagAt(line, character) {
    for (let start = 0; start <= Math.min(character, line.length - 1); start++) {
        if (line[start] !== '<') {
            continue;
        }
        let depth = 0;
        for (let i = start; i < line.length; i++) {
            if (line[i] === '<') {
                depth++;
            }
            else if (line[i] === '>') {
                depth--;
                if (depth === 0) {
                    if (i >= character) {
                        return { start, end: i + 1, text: line.substring(start, i + 1) };
                    }
                    break;
                }
            }
        }
    }
    return null;
}
exports.findTagAt = findTagAt;
/**
 * The tag names this module knows how to break apart, and their separators.
 *
 * `with` joined on 2026-09-01, reported by the user: `<item.with[display_name=hi;quantity=2]>` is
 * a `;`-separated set exactly as a map is -- the meta documents its parameter as
 * `<mechanism>=<value>;...` -- and it is where long mechanism sets are actually written, so it was
 * the most conspicuous omission. `with_single` takes one mechanism and no separator, so it is
 * deliberately absent.
 *
 * KEYED BY TAG NAME, NOT BY A `<map[` PREFIX, and that is what the `with` support needed. `map`
 * and `list` are BASE tags, so a prefix test worked for them; `with` is only ever a SUB-tag
 * (`<item.with[...]>`, `<player.item_in_hand.with[...]>`), and no fixed prefix can match it.
 */
const FORMATTABLE = new Map([
    ['map', { separator: ';', keyed: true }],
    ['with', { separator: ';', keyed: true }],
    ['list', { separator: '|', keyed: false }]
]);
/**
 * Index of the `[` that opens the tag's FINAL parameter group, given text ending in `]>`, or -1.
 *
 * Walks back from the closing `]` counting depth, so a nested `<list[1|2]>` inside the parameters
 * does not misdirect it. Taking the final group rather than the first is what makes
 * `<map[a=1;b=2].get[x]>` correctly UNformattable: the group under consideration belongs to `get`.
 */
function paramBracketStart(tagText) {
    let depth = 0;
    for (let i = tagText.length - 2; i >= 0; i--) {
        const ch = tagText[i];
        if (ch === ']') {
            depth++;
        }
        else if (ch === '[') {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
}
/**
 * The tag-name component immediately before the `[` at `bracketIndex`, lowercased.
 *
 * `<map[` gives "map", `<item.with[` gives "with", `<item[stone].with[` gives "with". The cut is
 * at the last `.`, which is correct even when an earlier parameter contains one, since that `.`
 * comes earlier in the string than the one before the name.
 */
function nameBeforeBracket(tagText, bracketIndex) {
    const head = tagText.substring(0, bracketIndex);
    const dot = head.lastIndexOf('.');
    return (dot === -1 ? head.replace(/^</, '') : head.substring(dot + 1)).toLowerCase();
}
/** The kind and opening text (`<` through `[`) for a formattable tag, or null. */
function describeFormattable(tagText) {
    if (!tagText.endsWith(']>')) {
        return null;
    }
    const bracket = paramBracketStart(tagText);
    if (bracket === -1) {
        return null;
    }
    const kind = FORMATTABLE.get(nameBeforeBracket(tagText, bracket));
    if (kind === undefined) {
        return null;
    }
    return { kind, opening: tagText.substring(0, bracket + 1) };
}
/**
 * Splits a `<map[...]>`, `<list[...]>` or `<....with[...]>` tag into its entries, or null when the
 * tag is not one of those or holds only a single entry (where formatting would add noise and no
 * information).
 */
function splitTagEntries(tagText) {
    const described = describeFormattable(tagText);
    if (described === null) {
        return null;
    }
    const kind = described.kind;
    const inner = tagText.substring(described.opening.length, tagText.length - ']>'.length);
    const rawEntries = splitAtDepthZero(inner, kind.separator);
    if (rawEntries.length < 2) {
        return null;
    }
    return rawEntries.map(raw => {
        if (!kind.keyed) {
            return { key: '', value: raw };
        }
        const eq = findAtDepthZero(raw, 0, ch => ch === '=');
        if (eq === -1) {
            return { key: '', value: raw };
        }
        return { key: raw.substring(0, eq), value: raw.substring(eq + 1) };
    });
}
exports.splitTagEntries = splitTagEntries;
/**
 * Renders a long map or list tag across several indented lines, for display only.
 *
 * Returns null when there is nothing worth showing -- a tag that is not a map or list, or one
 * with a single entry. Callers should treat null as "offer nothing", not as an error.
 */
function formatTag(tagText, indent = '    ') {
    const entries = splitTagEntries(tagText);
    if (entries === null) {
        return null;
    }
    const { kind, opening } = describeFormattable(tagText);
    const lines = [opening];
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        // The separator is kept on the line it belongs to, so the rendering can be read back as
        // the real single-line tag without guessing where the `;` went.
        const tail = i < entries.length - 1 ? kind.separator : '';
        if (entry.key.length > 0) {
            // NO COLUMN ALIGNMENT. An earlier version padded the keys so the `=` lined up, which
            // turns a short key next to a long one into a corridor of spaces -- and the user
            // rejected it on sight. A single space reads fine and keeps the line close to what is
            // actually in the file.
            lines.push(`${indent}${entry.key} = ${entry.value}${tail}`);
        }
        else {
            lines.push(`${indent}${entry.value}${tail}`);
        }
    }
    lines.push(']>');
    return lines.join('\n');
}
exports.formatTag = formatTag;
/**
 * The inverse of `formatTag`: takes an edited multi-line view and produces the single-line tag
 * to write back into the script.
 *
 * THIS IS WHAT MAKES THE EXPANDED VIEW EDITABLE. The file only ever holds the single-line form,
 * because that is all Denizen's parser accepts; the multi-line form exists only in the editor
 * that the user is typing into, and this function is what turns their edit back into something
 * the parser will take.
 *
 * ENTRIES ARE DELIMITED BY LINES, NOT BY SEPARATORS. One entry per line, and a trailing `;` or
 * `|` is stripped if present. That means the user does NOT have to type separators at all: they
 * can add a line, and it becomes an entry. Typing the separator anyway is harmless, which
 * matters because the formatted view shows them and copying that habit is natural.
 *
 * Returns null when the input is not a recognisable expanded tag, so a caller can decline to
 * write anything rather than corrupting the script.
 */
function collapseTag(pretty) {
    const rawLines = pretty.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (rawLines.length < 3) {
        return null;
    }
    const opening = rawLines[0];
    // The opening line is the tag's text up to and including its `[`, so it is recognised the same
    // way `describeFormattable` recognises a whole tag: by the name in front of that bracket. An
    // exact-prefix test worked while only `<map[` and `<list[` were formattable, but `with` opens
    // as `<item.with[` or `<player.item_in_hand.with[` -- text this function cannot enumerate.
    const kind = opening.startsWith('<') && opening.endsWith('[')
        ? FORMATTABLE.get(nameBeforeBracket(opening, opening.length - 1))
        : undefined;
    if (kind === undefined || rawLines[rawLines.length - 1] !== ']>') {
        return null;
    }
    const bodyLines = rawLines.slice(1, rawLines.length - 1);
    const entries = [];
    for (const line of bodyLines) {
        // Strip ONE trailing separator, if the user left the one the formatted view showed.
        let entry = line.endsWith(kind.separator) ? line.substring(0, line.length - 1).trim() : line;
        if (entry.length === 0) {
            continue;
        }
        if (kind.keyed) {
            // `key = value` renders with spaces around the '=' for alignment; the real tag has
            // none. Split on the first '=' at depth zero so a nested `flag=x` in the value is
            // left alone.
            const eq = findAtDepthZero(entry, 0, ch => ch === '=');
            if (eq !== -1) {
                entry = `${entry.substring(0, eq).trim()}=${entry.substring(eq + 1).trim()}`;
            }
        }
        entries.push(entry);
    }
    if (entries.length === 0) {
        return null;
    }
    return `${opening}${entries.join(kind.separator)}]>`;
}
exports.collapseTag = collapseTag;
/**
 * Whether `pretty` is structurally sound enough to write back.
 *
 * Used to hold off applying an edit mid-keystroke: while the user is halfway through typing a
 * nested tag the brackets do not balance, and collapsing then would put a broken tag into the
 * script. Better to leave the last good version in the file until the edit settles.
 */
function isCollapsible(pretty) {
    const collapsed = collapseTag(pretty);
    if (collapsed === null) {
        return false;
    }
    let tagDepth = 0;
    let bracketDepth = 0;
    for (const ch of collapsed) {
        if (ch === '<') {
            tagDepth++;
        }
        else if (ch === '>') {
            tagDepth--;
        }
        else if (ch === '[') {
            bracketDepth++;
        }
        else if (ch === ']') {
            bracketDepth--;
        }
        if (tagDepth < 0 || bracketDepth < 0) {
            return false;
        }
    }
    return tagDepth === 0 && bracketDepth === 0;
}
exports.isCollapsible = isCollapsible;
//# sourceMappingURL=tagFormatter.js.map