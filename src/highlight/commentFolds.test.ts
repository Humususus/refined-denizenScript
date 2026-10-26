import { describe, it, expect } from 'vitest';
import { commentFoldRanges } from './commentFolds';

const H = '|+=_@/';
const folds = (...lines: string[]) => commentFoldRanges(lines, H);

describe('commentFoldRanges', () => {
    it('folds a run of same-level comments', () => {
        expect(folds('# a', '# b')).toEqual([{ start: 0, end: 1 }]);
        expect(folds('## a', '## b', '## c')).toEqual([{ start: 0, end: 2 }]);
    });

    // Reported 2026-10-27: a banner block -- `# ====` lines around plain notes and `#   - run …`
    // examples -- folded only in fragments, and not at all from its first line, because runs were
    // split wherever the comment kind changed. The whole block folds from its first line now.
    it('folds a block of mixed comments from its first line to its last', () => {
        const block = folds(
            '# ==========================',
            '# Twitch core for Denizen',
            '#',
            '# Public tasks:',
            '#   - run tw_link_user def.__player:<player>',
            '#       Link Twitch.',
            '#   - run tw_unbind_task def.__player:<player>',
            '#       Unlink Twitch.',
            '# ==========================',
            'tw_link_user:');
        expect(block[0]).toEqual({ start: 0, end: 8 });
        // Same-kind runs inside keep their own smaller folds, but never on the block's first line.
        expect(block.filter(r => r.start === 0)).toHaveLength(1);
        expect(block).toContainEqual({ start: 1, end: 3 });
    });

    it('a change of level folds as one block, with each level as its own fold inside', () => {
        expect(folds('# a', '# b', '## c', '## d')).toEqual([{ start: 0, end: 3 }, { start: 2, end: 3 }]);
    });

    it('a block of one kind is a single fold', () => {
        expect(folds('# a', '# b', '# c')).toEqual([{ start: 0, end: 2 }]);
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
