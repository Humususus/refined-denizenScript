"use strict";
// What the settings page shows and how it reads and writes palette values. No `vscode` import, so
// the catalogue is checked against package.json and the value round trips are unit-tested.
//
// The page never colours text itself: the host runs the real tokenizer over every sample and the
// preview, and `lineSpans` turns the result into typed runs the webview paints by CSS variable.
Object.defineProperty(exports, "__esModule", { value: true });
exports.cardSpans = exports.previewState = exports.documentSpans = exports.PREVIEW_SCRIPT = exports.isWritableSetting = exports.lineSpans = exports.formatColorMap = exports.parseColorMap = exports.normalizeHex = exports.formatPaletteValue = exports.parsePaletteValue = exports.optionSettingId = exports.OPTION_CARDS = exports.COLOR_CARDS = void 0;
const denizenHighlighter_1 = require("../highlight/denizenHighlighter");
const commentDecorations_1 = require("../highlight/commentDecorations");
const semanticEncoding_1 = require("../highlight/semanticEncoding");
const EVENT = 'after player breaks diamond_ore with:*_pickaxe:';
const IF = '- if <[count]> >= 10:';
// Not the mockup's flag[rewards]: a flag name inside a tag is coloured as a definition name.
const TAG = '- narrate <player.location.add[1,0,0]>';
const FLAG = '- flag <player> rewards:+:1';
/** The mockup's cards, in its order. Every palette type but `bad_space` / `space` has one. */
exports.COLOR_CARDS = [
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
exports.OPTION_CARDS = [
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
function optionSettingId(key) {
    return key.startsWith('refinedDenizenscript.') ? key : 'denizenscript.' + key;
}
exports.optionSettingId = optionSettingId;
function parsePaletteValue(value) {
    const [head, ...parts] = value.split('|');
    const result = { color: readColor(head), text: head, bold: false, italic: false, rest: [] };
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
exports.parsePaletteValue = parsePaletteValue;
/**
 * `#RRGGBB` (any `#RGB` expanded) or `#RRGGBBAA` -- the forms the editor's palette rules read
 * (paletteRules.parsePaletteColor); anything else null.
 */
function readColor(head) {
    if (!head.startsWith('#')) {
        return null;
    }
    return /^#[0-9a-fA-F]{8}$/.test(head) ? head.toUpperCase() : normalizeHex(head);
}
/**
 * A readable colour is written in the editor's form, so a `#RGB` comes back as `#RRGGBB`; an
 * unreadable one is kept as written, so a B / I toggle does not destroy what the user typed.
 */
function formatPaletteValue(v) {
    var _a;
    const head = (_a = v.color) !== null && _a !== void 0 ? _a : v.text;
    return [head, ...(v.bold ? ['weight=bold'] : []), ...(v.italic ? ['style=italic'] : []), ...v.rest].join('|');
}
exports.formatPaletteValue = formatPaletteValue;
/** `#RRGGBB`, `RRGGBB` or `#RGB` → `#RRGGBB` upper-cased; anything else null. */
function normalizeHex(input) {
    const match = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(input.trim());
    if (match === null) {
        return null;
    }
    const digits = match[1].length === 3 ? [...match[1]].map(ch => ch + ch).join('') : match[1];
    return '#' + digits.toUpperCase();
}
exports.normalizeHex = normalizeHex;
/** `text_color_map`: `base=#00AA00,emphasis=#55FFFF,…`. Entries without a name and a value are skipped. */
function parseColorMap(value) {
    const out = [];
    for (const entry of value.split(',')) {
        const eq = entry.indexOf('=');
        if (eq > 0 && eq < entry.length - 1) {
            out.push({ name: entry.substring(0, eq).trim(), color: entry.substring(eq + 1).trim() });
        }
    }
    return out;
}
exports.parseColorMap = parseColorMap;
function formatColorMap(entries) {
    return entries.map(e => `${e.name}=${e.color}`).join(',');
}
exports.formatColorMap = formatColorMap;
/**
 * Splits line `flat[*].line` of a document into runs: the flattened palette type (what the editor
 * shows) and, on top, any inline `auto:` colour from `inline` -- the editor draws those as
 * decorations over the semantic colour. Only tokens on the line of the flat tokens are used, so
 * the caller passes one line's worth (or a whole document plus `lineNumber`).
 */
function lineSpans(line, flat, inline, lineNumber = 0) {
    const types = new Array(line.length).fill(null);
    const tokenTypes = denizenHighlighter_1.COLOR_TYPES.filter(t => t !== 'bad_space');
    for (const t of flat) {
        if (t.line !== lineNumber) {
            continue;
        }
        for (let c = t.start; c < Math.min(t.start + t.length, line.length); c++) {
            types[c] = tokenTypes[t.typeIndex];
        }
    }
    const inlines = new Array(line.length).fill(undefined);
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
    const spans = [];
    let c = 0;
    while (c < line.length) {
        let end = c + 1;
        while (end < line.length && types[end] === types[c] && inlines[end] === inlines[c]) {
            end++;
        }
        const span = { text: line.substring(c, end), type: types[c] };
        if (inlines[c] !== undefined) {
            span.inline = inlines[c];
        }
        spans.push(span);
        c = end;
    }
    return spans;
}
exports.lineSpans = lineSpans;
const WRITABLE = new Set([
    ...exports.COLOR_CARDS.map(c => `denizenscript.theme_colors.${c.type}`),
    'denizenscript.theme_colors.text_color_map',
    'denizenscript.behaviors.use_custom_syntax_colors',
    ...exports.OPTION_CARDS.map(c => optionSettingId(c.key)),
]);
/** The page writes only the settings it shows; the webview is not trusted to write anything else. */
function isWritableSetting(key) {
    return WRITABLE.has(key);
}
exports.isWritableSetting = isWritableSetting;
/** The preview script, the mockup's `test_script.dsc` plus one line for a tag parameter. */
exports.PREVIEW_SCRIPT = [
    '# | ======= Header ====== |',
    '## Warning: comments',
    '### ASAP COMMENTS',
    '### ASAP Comments',
    '# TODO: Todo comments',
    '# - narrate "Older commands"',
    '# regular comment',
    'reward_world:',
    '    type: world',
    '    events:',
    '        after player breaks diamond_ore with:*_pickaxe:',
    '        - define count:++',
    '        - if <[count]> >= 10:',
    '            - flag <player> rewards:+:1',
    '            - narrate "<&6>Reward: <player.flag[rewards]>"',
    '            - run give_reward def.item:\'diamond\'',
    '            - teleport <player> <player.location.add[0,1,0]>',
].join('\n');
/** Every line of `text` as spans, exactly as the editor colours it (same tokenizer, same overlap rule). */
function documentSpans(lines, opts) {
    const tokens = (0, denizenHighlighter_1.highlightLines)(lines, opts);
    const flat = (0, semanticEncoding_1.flattenTokens)(tokens, lines.map(l => l.length));
    return lines.map((line, i) => lineSpans(line, flat, tokens, i));
}
exports.documentSpans = documentSpans;
function previewState(opts) {
    const lines = exports.PREVIEW_SCRIPT.split('\n');
    return { preview: documentSpans(lines, opts), criticalLines: (0, commentDecorations_1.criticalLines)(lines, opts.headerSymbols) };
}
exports.previewState = previewState;
/** Each card's sample as spans, keyed by the card's type. */
function cardSpans(opts) {
    const out = {};
    for (const card of exports.COLOR_CARDS) {
        out[card.type] = documentSpans([card.sample], opts)[0];
    }
    return out;
}
exports.cardSpans = cardSpans;
//# sourceMappingURL=settingsModel.js.map