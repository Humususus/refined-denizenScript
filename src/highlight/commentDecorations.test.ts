import { describe, it, expect } from 'vitest';
import { criticalLines, criticalBackground } from './commentDecorations';

const H = '|+=_@/';

describe('criticalLines', () => {
    it('finds the ### lines only', () => {
        const lines = [
            'task:',
            '    ### danger',
            '    ### still danger',
            '    # TODO later',
            '        # - narrate old',
            '    # plain',
            '    ## careful',
        ];
        expect(criticalLines(lines, H)).toEqual([1, 2]);
    });

    it('ignores # that does not start a comment line', () => {
        expect(criticalLines(['- narrate "### x"', 'key: ### not a comment'], H)).toEqual([]);
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
