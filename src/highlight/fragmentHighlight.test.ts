import { describe, it, expect } from 'vitest';
import { highlightFragment, highlightLines, HighlightOptions, HighlightToken, baseTagSpecialColors, COLOR_TYPES } from './denizenHighlighter';
import { flattenTokens } from './semanticEncoding';
import { formatTag } from '../tagFormatter';

// R8, spec 7. Reported: `<list[air|air|air|<[ent].equipment_map.get[helmet].if_null[air]>]>` was
// red in the expanded view. The view's document is a FRAGMENT -- one tag spread over several lines
// -- and the highlighter read each line as a script line, found neither a command nor a key nor a
// comment, and painted the whole line `bad_space` (denizenHighlighter.ts decorateLine's fallback).

const opts: HighlightOptions = { headerSymbols: '|+=_@/', doInlineColors: true, displayDarkColors: false, tagSpecialColors: baseTagSpecialColors, colorRef: {} };
const TOKEN_TYPES = COLOR_TYPES.filter(t => t !== 'bad_space');

/** The winning colour of every character, line by line, the way the editor paints it. */
function cellTypes(lines: string[], tokens: HighlightToken[]): (string | null)[][] {
    const cells = lines.map(l => new Array<string | null>(l.length).fill(null));
    for (const t of flattenTokens(tokens, lines.map(l => l.length))) {
        for (let c = t.start; c < t.start + t.length; c++) {
            cells[t.line][c] = TOKEN_TYPES[t.typeIndex];
        }
    }
    return cells;
}

/** Non-space characters of the expanded view paired with their colour, in reading order. */
function fragmentColours(tag: string): string[] {
    const lines = formatTag(tag)!.split('\n');
    const cells = cellTypes(lines, highlightFragment(lines, opts));
    return lines.flatMap((line, i) => [...line].map((ch, c) => ch.trim() === '' ? null : `${ch}:${cells[i][c]}`)).filter((x): x is string => x !== null);
}

/** The same, for the tag written on one line as a command argument -- what a script shows. */
function oneLineColours(tag: string): string[] {
    const line = `- narrate ${tag}`;
    const cells = cellTypes([line], highlightLines([line], opts))[0];
    const from = '- narrate '.length;
    return [...tag].map((ch, c) => ch.trim() === '' ? null : `${ch}:${cells[from + c]}`).filter((x): x is string => x !== null);
}

const CASES = {
    reported: '<list[air|air|air|<[ent].equipment_map.get[helmet].if_null[air]>]>',
    'nested tag first': '<list[<[ent].equipment_map.get[helmet]>|air|air]>',
    'nested tag last': '<list[air|air|<player.item_in_hand>]>',
    // A one-element list has no expanded view at all (formatTag returns null), so "only nested
    // tags" stands in for the spec's "nested tag as the only element".
    'only nested tags': '<list[<player.location.add[1,0,0]>|<[ent].if_null[<[b]>]>]>',
    'if_null with a tag inside': '<list[air|<[a].if_null[<[b]>]>]>',
    map: '<map[a=1;b=<[x].if_null[2]>;c=<list[x|y]>]>',
};

describe('highlightFragment (the expanded tag view)', () => {
    for (const [name, tag] of Object.entries(CASES)) {
        it(`${name}: nothing is marked as an error`, () => {
            const lines = formatTag(tag)!.split('\n');
            expect(highlightFragment(lines, opts).filter(t => t.type === 'bad_space')).toEqual([]);
        });
        it(`${name}: every character is coloured as on one line`, () => {
            expect(fragmentColours(tag)).toEqual(oneLineColours(tag));
        });
    }

    it('a one-element list is not expanded, so it has no fragment to colour', () => {
        expect(formatTag('<list[<player.location.add[1,0,0]>]>')).toBeNull();
    });

    it('handles CRLF line ends and an empty document', () => {
        const lines = formatTag(CASES.reported)!.split('\n').map(l => l + '\r');
        expect(highlightFragment(lines, opts).filter(t => t.type === 'bad_space')).toEqual([]);
        expect(highlightFragment([''], opts)).toEqual([]);
    });
});
