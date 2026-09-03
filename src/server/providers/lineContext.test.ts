import { describe, it, expect } from 'vitest';
import { getLineContext, getFullLine } from './lineContext';

describe('getLineContext', () => {
    it('returns the text before the cursor on the cursor line', () => {
        const text = 'first:\n  - narrate hello\nlast:';
        const offset = text.indexOf('hello');
        const ctx = getLineContext(text, offset)!;
        expect(ctx.linePrefix).toBe('  - narrate ');
        expect(ctx.trimmed).toBe('- narrate ');
        expect(ctx.indent).toBe(2);
    });

    it('lowercases the trimmed form but not the raw prefix', () => {
        const text = '  - NARRATE Hi';
        const ctx = getLineContext(text, text.length)!;
        expect(ctx.linePrefix).toBe('  - NARRATE Hi');
        expect(ctx.trimmed).toBe('- narrate hi');
    });

    it('handles the very first line of a document', () => {
        const ctx = getLineContext('- narrate', 9)!;
        expect(ctx.trimmed).toBe('- narrate');
        expect(ctx.indent).toBe(0);
    });

    it('returns an empty prefix when the cursor sits at the start of a line', () => {
        const text = 'a:\n  - narrate';
        const ctx = getLineContext(text, 3)!;
        expect(ctx.linePrefix).toBe('');
        expect(ctx.trimmed).toBe('');
    });

    it('strips a trailing carriage return from CRLF documents', () => {
        const text = '  - narrate\r\nnext:';
        const ctx = getLineContext(text, text.indexOf('\r') + 1)!;
        expect(ctx.trimmed).toBe('- narrate');
    });

    it('returns null for an out-of-range offset', () => {
        expect(getLineContext('abc', -1)).toBeNull();
        expect(getLineContext('abc', 4)).toBeNull();
    });

    it('handles offset 0 on a document whose first character is a newline', () => {
        const ctx = getLineContext('\nabc', 0)!;
        expect(ctx.linePrefix).toBe('');
        expect(ctx.trimmed).toBe('');
        expect(ctx.indent).toBe(0);
    });

    it('handles offset 0 on a document with no leading newline', () => {
        const ctx = getLineContext('abc', 0)!;
        expect(ctx.linePrefix).toBe('');
        expect(ctx.indent).toBe(0);
    });

    it('counts each tab as one character of indent', () => {
        const ctx = getLineContext('\t\t- narrate', 10)!;
        expect(ctx.linePrefix).toBe('\t\t- narrat');
        expect(ctx.trimmed).toBe('- narrat');
        expect(ctx.indent).toBe(2);
    });
});

describe('getFullLine', () => {
    it('returns the whole line the cursor sits on, not just the prefix', () => {
        const text = 'a:\n  - narrate hello there\nb:';
        const found = getFullLine(text, text.indexOf('narrate'))!;
        expect(found.line).toBe('  - narrate hello there');
        expect(found.startOfLine).toBe(3);
    });

    it('returns the final line when there is no trailing newline', () => {
        const text = 'a:\n  - stop';
        const found = getFullLine(text, text.length)!;
        expect(found.line).toBe('  - stop');
    });

    it('excludes the carriage return on CRLF documents', () => {
        const text = '  - stop\r\nnext:';
        const found = getFullLine(text, 3)!;
        expect(found.line).toBe('  - stop');
    });

    it('returns null for an out-of-range offset', () => {
        expect(getFullLine('abc', 99)).toBeNull();
    });

    it('handles offset 0 on a document whose first character is a newline', () => {
        const found = getFullLine('\nabc', 0)!;
        expect(found.line).toBe('');
        expect(found.startOfLine).toBe(0);
    });

    it('excludes the carriage return when the cursor sits immediately before it', () => {
        const text = '  - stop\r\nnext:';
        const found = getFullLine(text, text.indexOf('\r'))!;
        expect(found.line).toBe('  - stop');
    });
});
