import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { COLOR_TYPES, HighlightOptions, baseTagSpecialColors, highlightLines } from '../highlight/denizenHighlighter';
import { flattenTokens } from '../highlight/semanticEncoding';
import {
    COLOR_CARDS, OPTION_CARDS, formatColorMap, formatPaletteValue, lineSpans, normalizeHex,
    optionSettingId, parseColorMap, parsePaletteValue
} from './settingsModel';

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
const props: Record<string, unknown> = pkg.contributes.configuration.properties;

const opts: HighlightOptions = { headerSymbols: '|+=_@/', doInlineColors: true, displayDarkColors: false, tagSpecialColors: baseTagSpecialColors, colorRef: {} };

function spansOf(line: string) {
    const tokens = highlightLines([line], opts);
    return lineSpans(line, flattenTokens(tokens, [line.length]), tokens);
}

describe('COLOR_CARDS', () => {
    it('has exactly one card per palette type except the two with no visible effect', () => {
        const expected = COLOR_TYPES.filter(t => t !== 'bad_space' && t !== 'space');
        expect(COLOR_CARDS.map(c => c.type).sort()).toEqual([...expected].sort());
    });
    it('every card type has a palette setting', () => {
        for (const card of COLOR_CARDS) {
            expect(props).toHaveProperty([`denizenscript.theme_colors.${card.type}`]);
        }
    });
    // A card is a code line coloured by its type; a sample that never produces that type would show
    // nothing to edit.
    it('every sample actually contains its own type when tokenized', () => {
        for (const card of COLOR_CARDS) {
            expect(spansOf(card.sample).some(s => s.type === card.type), card.type).toBe(true);
        }
    });
});

describe('OPTION_CARDS', () => {
    it('every option names a real setting', () => {
        for (const card of OPTION_CARDS) {
            expect(props, card.key).toHaveProperty([optionSettingId(card.key)]);
        }
    });
    it('bool cards are boolean settings and text cards string settings', () => {
        for (const card of OPTION_CARDS) {
            const type = (props[optionSettingId(card.key)] as { type: string }).type;
            expect(type, card.key).toBe(card.kind === 'bool' ? 'boolean' : 'string');
        }
    });
    it('keeps a namespaced key as is and prefixes a bare one', () => {
        expect(optionSettingId('refinedDenizenscript.mapTag.showExpandLens')).toBe('refinedDenizenscript.mapTag.showExpandLens');
        expect(optionSettingId('evaluateMathTags')).toBe('denizenscript.evaluateMathTags');
    });
});

describe('palette values', () => {
    it('parses colour and style', () => {
        expect(parsePaletteValue('#1155FF|style=italic')).toMatchObject({ color: '#1155FF', bold: false, italic: true, rest: [] });
        expect(parsePaletteValue('#FFFF00|weight=bold')).toMatchObject({ color: '#FFFF00', bold: true, italic: false, rest: [] });
    });
    it('keeps parts it does not own when bold is toggled', () => {
        const v = parsePaletteValue('#FFFFFF|background=#440000');
        expect(formatPaletteValue({ ...v, bold: true })).toBe('#FFFFFF|weight=bold|background=#440000');
    });
    it('round-trips a value unchanged', () => {
        for (const value of ['#DD99FF|style=italic', '#FFF|weight=bold|background=#123456', '#AAAAAA']) {
            expect(formatPaletteValue(parsePaletteValue(value))).toBe(value);
        }
    });
    it('a colour it cannot read is null, and an empty value does not crash', () => {
        expect(parsePaletteValue('blue').color).toBeNull();
        expect(parsePaletteValue('')).toMatchObject({ color: null, bold: false, italic: false, rest: [] });
    });
    it('an unreadable colour survives a style toggle', () => {
        expect(formatPaletteValue({ ...parsePaletteValue('blue'), italic: true })).toBe('blue|style=italic');
    });
});

describe('normalizeHex', () => {
    it('accepts #RRGGBB, RRGGBB and #RGB, upper-cased', () => {
        expect(normalizeHex('#1155ff')).toBe('#1155FF');
        expect(normalizeHex('1155ff')).toBe('#1155FF');
        expect(normalizeHex('f55')).toBe('#FF5555');
        expect(normalizeHex(' #F55 ')).toBe('#FF5555');
    });
    it('rejects anything else', () => {
        for (const bad of ['#12345', '', 'blue', '#GGGGGG', '#1234567']) {
            expect(normalizeHex(bad), bad).toBeNull();
        }
    });
});

describe('text colour map', () => {
    it('round-trips', () => {
        const value = 'base=#00AA00,emphasis=#55FFFF,error=#FF5555';
        expect(parseColorMap(value)).toEqual([
            { name: 'base', color: '#00AA00' }, { name: 'emphasis', color: '#55FFFF' }, { name: 'error', color: '#FF5555' }
        ]);
        expect(formatColorMap(parseColorMap(value))).toBe(value);
    });
    it('skips malformed entries', () => {
        expect(parseColorMap('base=#00AA00,,junk')).toEqual([{ name: 'base', color: '#00AA00' }]);
    });
});

describe('lineSpans', () => {
    it('splits a line into runs by the flattened type', () => {
        const spans = spansOf('- define count:++');
        expect(spans.map(s => s.text).join('')).toBe('- define count:++');
        expect(spans).toEqual(expect.arrayContaining([
            { text: 'define', type: 'command' }, { text: 'count', type: 'def_name' }, { text: ':++', type: 'data_actions' }
        ]));
    });
    it('marks the text an inline colour tag colours', () => {
        const line = '- narrate "<&6>Reward"';
        const spans = spansOf(line);
        expect(spans.map(s => s.text).join('')).toBe(line);
        expect(spans.some(s => s.inline !== undefined && s.text.includes('Reward'))).toBe(true);
    });
    it('an uncoloured line is one null run', () => {
        expect(lineSpans('abc', [], [])).toEqual([{ text: 'abc', type: null }]);
    });
});
