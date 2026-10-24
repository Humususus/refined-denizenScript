import { describe, it, expect } from 'vitest';
import { commentKind } from './commentKind';

const H = '|+=_@/';

describe('commentKind', () => {
    it('levels by number of #', () => {
        expect(commentKind('# plain', H)).toBe('comment_normal');
        expect(commentKind('    ## careful', H)).toBe('comment_warning');
        expect(commentKind('##', H)).toBe('comment_warning');
        expect(commentKind('### danger', H)).toBe('comment_critical');
        expect(commentKind('#### x', H)).toBe('comment_critical');
        expect(commentKind('###', H)).toBe('comment_critical');
    });

    // `##ignorewarning x` is how the checker is silenced; a yellow directive would read as a warning.
    it('a ## directive is a normal comment, not a level', () => {
        expect(commentKind('##ignorewarning async_unsafe_tag', H)).toBe('comment_normal');
        expect(commentKind('##ignorewarning', H)).toBe('comment_normal');
    });

    it('keeps the existing kinds', () => {
        expect(commentKind('# | Title |', H)).toBe('comment_header');
        expect(commentKind('# - narrate x', H)).toBe('comment_code');
        expect(commentKind('# TODO fix', H)).toBe('comment_todo');
        expect(commentKind('# todo', H)).toBe('comment_todo');
    });

    it('a level wins over the code marker', () => {
        expect(commentKind('## - narrate x', H)).toBe('comment_warning');
    });

    it('is null for anything that is not a comment line', () => {
        expect(commentKind('- narrate "### x"', H)).toBeNull();
        expect(commentKind('key: # not a comment', H)).toBeNull();
        expect(commentKind('', H)).toBeNull();
    });

    it('ignores a trailing carriage return', () => {
        expect(commentKind('## careful\r', H)).toBe('comment_warning');
        expect(commentKind('##\r', H)).toBe('comment_warning');
    });
});
