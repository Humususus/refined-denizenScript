import { describe, it, expect } from 'vitest';
import { commentFoldRanges } from './commentFolds';

const H = '|+=_@/';
const folds = (...lines: string[]) => commentFoldRanges(lines, H);

describe('commentFoldRanges', () => {
    it('folds a run of same-level comments', () => {
        expect(folds('# a', '# b')).toEqual([{ start: 0, end: 1 }]);
        expect(folds('## a', '## b', '## c')).toEqual([{ start: 0, end: 2 }]);
    });

    it('a change of level starts a new run', () => {
        expect(folds('# a', '# b', '## c', '## d')).toEqual([{ start: 0, end: 1 }, { start: 2, end: 3 }]);
    });

    it('a single comment line has nothing to fold', () => {
        expect(folds('### only')).toEqual([]);
        expect(folds('key:', '    # one', '    - narrate x')).toEqual([]);
    });

    it('a blank line or a different indent ends a run', () => {
        expect(folds('# a', '', '# b')).toEqual([]);
        expect(folds('    # a', '# b')).toEqual([]);
    });

    it('a run at the end of a container ends on its last comment line, not past it', () => {
        expect(folds('task:', '    script:', '    - narrate x', '    # a', '    # b', 'other:')).toEqual([{ start: 3, end: 4 }]);
    });

    it('directives fold together like any plain comments', () => {
        expect(folds('##ignorewarning a', '##ignorewarning b')).toEqual([{ start: 0, end: 1 }]);
    });

    it('ignores a trailing carriage return', () => {
        expect(folds('# a\r', '# b\r')).toEqual([{ start: 0, end: 1 }]);
    });
});
