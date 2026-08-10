import { describe, it, expect } from 'vitest';
import { parseCursorContext, parseCommandLine } from './cursorContext';

describe('parseCommandLine', () => {
    it('reports a name still being typed', () => {
        const ctx = parseCommandLine('- narr', 2)!;
        expect(ctx.name).toBe('narr');
        expect(ctx.typingName).toBe(true);
        expect(ctx.nameStart).toBe(4);
        expect(ctx.nameEnd).toBe(8);
    });

    it('reports a completed name and an empty argument after a trailing space', () => {
        const ctx = parseCommandLine('- narrate ', 2)!;
        expect(ctx.name).toBe('narrate');
        expect(ctx.typingName).toBe(false);
        expect(ctx.argThusFar).toBe('');
        expect(ctx.argPrefix).toBe('');
        expect(ctx.argValue).toBe('');
    });

    it('splits a prefixed argument on the first colon', () => {
        const ctx = parseCommandLine('- playsound sound:block.stone.st', 2)!;
        expect(ctx.name).toBe('playsound');
        expect(ctx.argThusFar).toBe('sound:block.stone.st');
        expect(ctx.argPrefix).toBe('sound');
        expect(ctx.argValue).toBe('block.stone.st');
    });

    it('treats an argument without a colon as a bare value', () => {
        const ctx = parseCommandLine('- narrate hello wor', 2)!;
        expect(ctx.argThusFar).toBe('wor');
        expect(ctx.argPrefix).toBe('');
        expect(ctx.argValue).toBe('wor');
    });

    it('splits on the FIRST colon only, so values may contain colons', () => {
        const ctx = parseCommandLine('- run mytask def:a:b', 2)!;
        expect(ctx.argPrefix).toBe('def');
        expect(ctx.argValue).toBe('a:b');
    });

    it('skips a leading tilde and shifts the name range accordingly', () => {
        const ctx = parseCommandLine('- ~waituntil x', 2)!;
        expect(ctx.name).toBe('waituntil');
        expect(ctx.nameStart).toBe(5);
        expect(ctx.nameEnd).toBe(14);
    });

    it('returns null for a line that is not a command line', () => {
        expect(parseCommandLine('type: task', 2)).toBeNull();
        expect(parseCommandLine('', 0)).toBeNull();
        expect(parseCommandLine('-', 0)).toBeNull();
    });

    it('accounts for indentation in the name range', () => {
        const ctx = parseCommandLine('- narrate hi', 6)!;
        expect(ctx.nameStart).toBe(8);
        expect(ctx.nameEnd).toBe(15);
    });
});

describe('parseCursorContext', () => {
    it('parses the command line the cursor sits on', () => {
        const text = 'my_task:\n  type: task\n  script:\n  - playsound sound:amb';
        const ctx = parseCursorContext(text, text.length)!;
        expect(ctx.name).toBe('playsound');
        expect(ctx.argPrefix).toBe('sound');
        expect(ctx.argValue).toBe('amb');
    });

    it('returns null when the cursor is not on a command line', () => {
        const text = 'my_task:\n  type: task';
        expect(parseCursorContext(text, text.length)).toBeNull();
    });

    it('returns null for an out-of-range offset', () => {
        expect(parseCursorContext('  - narrate', 999)).toBeNull();
    });
});
