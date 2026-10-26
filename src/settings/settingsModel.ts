// What the settings page shows and how it reads and writes palette values. No `vscode` import, so
// the catalogue is checked against package.json and the value round trips are unit-tested.
//
// The page never colours text itself: the host runs the real tokenizer over every sample and the
// preview, and `lineSpans` turns the result into typed runs the webview paints by CSS variable.

import { COLOR_TYPES, HighlightToken } from '../highlight/denizenHighlighter';
import { FlatToken } from '../highlight/semanticEncoding';

export type ColorSection = 'Comments' | 'Keys and events' | 'Commands' | 'Tags' | 'Strings';

export interface ColorCard {
    type: string;
    label: string;
    /** One line of Denizen script; the card shows it tokenized, with `type` underlaid. */
    sample: string;
    section: ColorSection;
}

const EVENT = 'after player breaks diamond_ore with:*_pickaxe:';
const IF = '- if <[count]> >= 10:';
// Not the mockup's flag[rewards]: a flag name inside a tag is coloured as a definition name.
const TAG = '- narrate <player.location.add[1,0,0]>';
const FLAG = '- flag <player> rewards:+:1';

/** The mockup's cards, in its order. Every palette type but `bad_space` / `space` has one. */
export const COLOR_CARDS: readonly ColorCard[] = [
    { section: 'Comments', type: 'comment_normal', label: 'Default comments', sample: '# Default comments' },
    { section: 'Comments', type: 'comment_warning', label: 'Warning comments', sample: '## Warning comments' },
    { section: 'Comments', type: 'comment_critical', label: 'ASAP comments', sample: '### ASAP comments' },
    { section: 'Comments', type: 'comment_todo', label: 'TODO comments', sample: '# TODO: todo comments' },
    { section: 'Comments', type: 'comment_code', label: 'Commented-out code', sample: '# - narrate "old command"' },
    { section: 'Comments', type: 'comment_header', label: 'Headers', sample: '# | ===== Header ===== |' },
    { section: 'Keys and events', type: 'key', label: 'Key', sample: 'events:' },
    { section: 'Keys and events', type: 'key_inline', label: 'Inline key', sample: '    type: world' },
    { section: 'Keys and events', type: 'event_line', label: 'Event line', sample: EVENT },
    { section: 'Keys and events', type: 'event_switch', label: 'Event switch', sample: EVENT },
    { section: 'Keys and events', type: 'event_switch_value', label: 'Switch value', sample: EVENT },
    { section: 'Commands', type: 'command', label: 'Command name', sample: '- define count:++' },
    { section: 'Commands', type: 'def_name', label: 'Definition name', sample: '- define count:++' },
    { section: 'Commands', type: 'data_actions', label: 'Data actions', sample: FLAG },
    { section: 'Commands', type: 'if_operators', label: 'If operators', sample: IF },
    { section: 'Commands', type: 'colons', label: 'Colons', sample: IF },
    { section: 'Tags', type: 'tag', label: 'Tag', sample: TAG },
    { section: 'Tags', type: 'tag_dot', label: 'Dot', sample: TAG },
    { section: 'Tags', type: 'tag_param', label: 'Parameter', sample: TAG },
    { section: 'Tags', type: 'tag_param_bracket', label: 'Parameter brackets', sample: TAG },
    { section: 'Strings', type: 'quote_double', label: 'Double quotes', sample: '- narrate "Reward received"' },
    { section: 'Strings', type: 'quote_single', label: 'Single quotes', sample: "- run give_reward def.item:'diamond'" },
    { section: 'Strings', type: 'normal', label: 'Other text', sample: FLAG },
];

export type OptionSection = 'Suggestions' | 'Checks' | 'Text colors';

export interface OptionCard {
    /** Setting id; a bare key is under `denizenscript.` (see `optionSettingId`). */
    key: string;
    label: string;
    detail: string;
    kind: 'bool' | 'text';
    section: OptionSection;
}

export const OPTION_CARDS: readonly OptionCard[] = [
    { section: 'Suggestions', kind: 'bool', key: 'inlineArgumentHints', label: 'Inline argument names', detail: 'Grey labels after a command' },
    { section: 'Suggestions', kind: 'bool', key: 'evaluateMathTags', label: 'Evaluate math in tags', detail: '<element[2].add[3]> → 5' },
    { section: 'Suggestions', kind: 'bool', key: 'autoInsertTagSeparators', label: 'Auto-insert separators in <map[…]> and <list[…]>', detail: '' },
    { section: 'Suggestions', kind: 'bool', key: 'refinedDenizenscript.mapTag.showExpandLens', label: '"Expand" lens above long <map[…]>', detail: '' },
    { section: 'Suggestions', kind: 'bool', key: 'behaviors.show_scripts_view', label: 'Denizen Scripts panel', detail: "The workspace's .dsc files in the Explorer, grouped by file name" },
    { section: 'Checks', kind: 'bool', key: 'server.tagTracing', label: 'Tag tracing', detail: 'Check that every part of a tag exists' },
    { section: 'Checks', kind: 'bool', key: 'behaviors.track_full_workspace', label: 'Index the whole workspace', detail: 'Needed for definitions, flags and script names from other files' },
    { section: 'Text colors', kind: 'bool', key: 'behaviors.do_inline_colors', label: 'Color text by color tags', detail: '<&6>, <gold> etc.' },
    { section: 'Text colors', kind: 'bool', key: 'behaviors.display_dark_colors', label: 'Show dark colors as-is', detail: 'Otherwise very dark colors are not shown' },
    { section: 'Text colors', kind: 'text', key: 'header_symbols', label: 'Header symbols', detail: '# | Header |' },
];

export function optionSettingId(key: string): string {
    return key.startsWith('refinedDenizenscript.') ? key : 'denizenscript.' + key;
}

/** A palette value `#RRGGBB|weight=bold|style=italic|…`, split into what the page edits and the rest. */
export interface PaletteValue {
    /** The colour as `#RRGGBB`, or null when the value's colour part is not a hex colour. */
    color: string | null;
    /** The colour part as written; kept so an unreadable colour survives a B / I toggle. */
    text: string;
    bold: boolean;
    italic: boolean;
    /** Every `|part` the page does not own (`background=`, `strike=`, …), in original order. */
    rest: string[];
}

export function parsePaletteValue(value: string): PaletteValue {
    const [head, ...parts] = value.split('|');
    const result: PaletteValue = { color: /^#/.test(head) ? normalizeHex(head) : null, text: head, bold: false, italic: false, rest: [] };
    for (const part of parts) {
        const [setting, setValue] = part.split('=', 2);
        if (setting === 'weight') {
            result.bold = setValue === 'bold';
        }
        else if (setting === 'style') {
            result.italic = setValue === 'italic';
        }
        else {
            result.rest.push(part);
        }
    }
    return result;
}

/** The colour written is `text` (as found) unless the page set `color` to something else. */
export function formatPaletteValue(v: PaletteValue): string {
    const head = v.color !== null && normalizeHex(v.text) !== v.color ? v.color : v.text;
    return [head, ...(v.bold ? ['weight=bold'] : []), ...(v.italic ? ['style=italic'] : []), ...v.rest].join('|');
}

/** `#RRGGBB`, `RRGGBB` or `#RGB` → `#RRGGBB` upper-cased; anything else null. */
export function normalizeHex(input: string): string | null {
    const match = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(input.trim());
    if (match === null) {
        return null;
    }
    const digits = match[1].length === 3 ? [...match[1]].map(ch => ch + ch).join('') : match[1];
    return '#' + digits.toUpperCase();
}

export interface ColorMapEntry {
    name: string;
    color: string;
}

/** `text_color_map`: `base=#00AA00,emphasis=#55FFFF,…`. Entries without a name and a value are skipped. */
export function parseColorMap(value: string): ColorMapEntry[] {
    const out: ColorMapEntry[] = [];
    for (const entry of value.split(',')) {
        const eq = entry.indexOf('=');
        if (eq > 0 && eq < entry.length - 1) {
            out.push({ name: entry.substring(0, eq).trim(), color: entry.substring(eq + 1).trim() });
        }
    }
    return out;
}

export function formatColorMap(entries: ColorMapEntry[]): string {
    return entries.map(e => `${e.name}=${e.color}`).join(',');
}

export interface Span {
    text: string;
    /** The palette type that wins here in the editor, or null for uncoloured text. */
    type: string | null;
    /** The inline colour value (`#RRGGBB…`) a colour tag gives this text, drawn over `type`. */
    inline?: string;
}

/**
 * Splits line `flat[*].line` of a document into runs: the flattened palette type (what the editor
 * shows) and, on top, any inline `auto:` colour from `inline` -- the editor draws those as
 * decorations over the semantic colour. Only tokens on the line of the flat tokens are used, so
 * the caller passes one line's worth (or a whole document plus `lineNumber`).
 */
export function lineSpans(line: string, flat: FlatToken[], inline: HighlightToken[], lineNumber = 0): Span[] {
    const types: (string | null)[] = new Array(line.length).fill(null);
    const tokenTypes = COLOR_TYPES.filter(t => t !== 'bad_space');
    for (const t of flat) {
        if (t.line !== lineNumber) {
            continue;
        }
        for (let c = t.start; c < Math.min(t.start + t.length, line.length); c++) {
            types[c] = tokenTypes[t.typeIndex];
        }
    }
    const inlines: (string | undefined)[] = new Array(line.length).fill(undefined);
    for (const t of inline) {
        if (!t.type.startsWith('auto:') || t.line > lineNumber || t.endLine < lineNumber) {
            continue;
        }
        const from = t.line === lineNumber ? t.start : 0;
        const to = t.endLine === lineNumber ? t.end : line.length;
        for (let c = Math.max(0, from); c < Math.min(to, line.length); c++) {
            inlines[c] = t.type.substring('auto:'.length);
        }
    }
    const spans: Span[] = [];
    let c = 0;
    while (c < line.length) {
        let end = c + 1;
        while (end < line.length && types[end] === types[c] && inlines[end] === inlines[c]) {
            end++;
        }
        const span: Span = { text: line.substring(c, end), type: types[c] };
        if (inlines[c] !== undefined) {
            span.inline = inlines[c];
        }
        spans.push(span);
        c = end;
    }
    return spans;
}
