import { describe, it, expect } from 'vitest';
import { commentLines, iconSvg, criticalBackground } from './commentDecorations';

const H = '|+=_@/';

describe('commentLines', () => {
    it('finds ### lines and the TODO / code comments with the column of their #', () => {
        const lines = [
            'task:',
            '    ### danger',
            '    ### still danger',
            '    # TODO later',
            '        # - narrate old',
            '    # plain',
            '    ## careful',
        ];
        expect(commentLines(lines, H)).toEqual({
            critical: [1, 2],
            todo: [{ line: 3, column: 4 }],
            code: [{ line: 4, column: 8 }],
        });
    });

    it('ignores # that does not start a comment line', () => {
        expect(commentLines(['- narrate "### x"', '- narrate "<&color[#FF0000]>todo"', 'key: # - not code'], H))
            .toEqual({ critical: [], todo: [], code: [] });
    });
});

describe('iconSvg', () => {
    it('TODO is a filled square with a check mark', () => {
        const svg = iconSvg('todo', '#FFEE00');
        expect(svg).toContain('<svg');
        expect(svg).toContain('fill="#FFEE00"');
        expect(svg).toMatch(/<path[^>]*stroke=/);
    });
    it('code is a filled triangle', () => {
        const svg = iconSvg('code', '#DD6A10');
        expect(svg).toMatch(/<path[^>]*fill="#DD6A10"/);
    });
});

describe('criticalBackground', () => {
    it('is the critical colour at ~16% alpha', () => {
        expect(criticalBackground('#FF5555')).toBe('#FF555529');
        expect(criticalBackground('#ff5555|weight=bold')).toBe('#ff555529');
    });
    it('falls back for an unreadable colour', () => {
        expect(criticalBackground('nonsense')).toBe('#FF555529');
    });
});
