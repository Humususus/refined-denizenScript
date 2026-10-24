import { describe, it, expect } from 'vitest';
import { flattenTokens, encodeSemanticTokens, buildSemanticTokens, SEMANTIC_TYPES, semanticIndex } from './semanticEncoding';
import { HighlightToken } from './denizenHighlighter';

const tok = (type: string, line: number, start: number, end: number, endLine = line): HighlightToken => ({ type, line, start, end, endLine });
const named = (flat: ReturnType<typeof flattenTokens>) => flat.map(f => `${SEMANTIC_TYPES[f.typeIndex]} ${f.line}:${f.start}+${f.length}`);

describe('semantic token encoding', () => {
    it('names every palette type except bad_space', () => {
        expect(SEMANTIC_TYPES).toContain('denizen_key');
        expect(SEMANTIC_TYPES).not.toContain('denizen_bad_space');
    });

    it('an inner token of a later type splits the outer one into three runs', () => {
        expect(named(flattenTokens([tok('tag', 0, 0, 20), tok('tag_dot', 0, 5, 6)], [20])))
            .toEqual(['denizen_tag 0:0+5', 'denizen_tag_dot 0:5+1', 'denizen_tag 0:6+14']);
    });

    it('an earlier type under a later one loses the overlapped part', () => {
        // The shape of the define-name bug fixed in 2.5.0 (a `normal` run over a name's last letter):
        // the highlighter no longer emits it, but the rule still decides any overlap that appears.
        expect(named(flattenTokens([tok('def_name', 0, 10, 12), tok('normal', 0, 11, 12)], [20])))
            .toEqual(['denizen_def_name 0:10+1', 'denizen_normal 0:11+1']);
    });

    it('overlaps resolve by COLOR_TYPES order, later wins -- regardless of emit order', () => {
        // tag_dot comes after tag in COLOR_TYPES, so it wins even when emitted first.
        expect(named(flattenTokens([tok('tag_dot', 0, 4, 5), tok('tag', 0, 0, 10)], [10])))
            .toEqual(['denizen_tag 0:0+4', 'denizen_tag_dot 0:4+1', 'denizen_tag 0:5+5']);
    });

    it('splits a multi-line token per line', () => {
        expect(named(flattenTokens([tok('normal', 0, 8, 3, 2)], [12, 6, 9])))
            .toEqual(['denizen_normal 0:8+4', 'denizen_normal 1:0+6', 'denizen_normal 2:0+3']);
    });

    it('drops inline colours, bad_space and empty tokens', () => {
        expect(flattenTokens([tok('auto:#FFAA00', 0, 0, 4), tok('bad_space', 0, 4, 6), tok('normal', 0, 2, 2)], [6])).toEqual([]);
    });

    it('merges adjacent runs of the same type', () => {
        expect(named(flattenTokens([tok('key', 0, 0, 3), tok('key', 0, 3, 6)], [6]))).toEqual(['denizen_key 0:0+6']);
    });

    it('clamps a token that runs past the end of its line', () => {
        expect(named(flattenTokens([tok('normal', 0, 2, 50)], [5]))).toEqual(['denizen_normal 0:2+3']);
    });

    it('builds the encoded tokens for a document, ignoring a trailing \\r on each line', () => {
        const opts = { headerSymbols: '|+=#_@/', doInlineColors: true, displayDarkColors: false, tagSpecialColors: {}, colorRef: {} };
        expect(Array.from(buildSemanticTokens(['my_task:\r', '    type: task'], opts))).toEqual([
            0, 0, 7, semanticIndex('key'), 0,
            0, 7, 1, semanticIndex('colons'), 0,
            1, 4, 4, semanticIndex('key_inline'), 0,
            0, 4, 1, semanticIndex('colons'), 0,
            0, 1, 1, semanticIndex('space'), 0,
            0, 1, 4, semanticIndex('normal'), 0,
        ]);
    });

    it('delta-encodes line, start, length and type', () => {
        const k = semanticIndex('key'), c = semanticIndex('colons'), n = semanticIndex('normal');
        const encoded = encodeSemanticTokens([
            { line: 0, start: 0, length: 3, typeIndex: k },
            { line: 0, start: 4, length: 2, typeIndex: c },
            { line: 2, start: 1, length: 5, typeIndex: n },
        ]);
        expect(Array.from(encoded)).toEqual([0, 0, 3, k, 0, 0, 4, 2, c, 0, 2, 1, 5, n, 0]);
    });
});
