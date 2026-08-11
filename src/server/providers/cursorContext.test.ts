import { describe, it, expect } from 'vitest';
import { parseCursorContext, parseCommandLine, splitTopLevelArguments } from './cursorContext';

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

describe('argIndex', () => {
    it('is -1 while the command name is still being typed', () => {
        expect(parseCommandLine('- narr', 2)!.argIndex).toBe(-1);
    });

    it('is 0 on the first argument', () => {
        expect(parseCommandLine('- narrate hel', 2)!.argIndex).toBe(0);
    });

    it('is 0 immediately after the command name and a space', () => {
        expect(parseCommandLine('- narrate ', 2)!.argIndex).toBe(0);
    });

    it('counts each further argument', () => {
        expect(parseCommandLine('- narrate hello format:x', 2)!.argIndex).toBe(1);
        expect(parseCommandLine('- narrate hello format:x targets:y', 2)!.argIndex).toBe(2);
    });

    it('counts a trailing space as starting the next argument', () => {
        expect(parseCommandLine('- narrate hello ', 2)!.argIndex).toBe(1);
    });

    it('clamps to -1 rather than going negative on a dash followed only by spaces', () => {
        // rest is all spaces here: spans is empty and endsWithSeparator is false, so the
        // raw computation (spans.length - 2) would be -2 without the clamp.
        expect(parseCommandLine('-   ', 0)!.argIndex).toBe(-1);
    });
});

describe('argIndex through parseCursorContext', () => {
    it('carries the index through from a real document', () => {
        const text = 'my_task:\n  type: task\n  script:\n  - narrate hello for';
        expect(parseCursorContext(text, text.length)!.argIndex).toBe(1);
    });
});

describe('splitTopLevelArguments', () => {
    it('keeps a quoted value with a space as one argument', () => {
        const text = 'narrate "hello world" fo';
        const spans = splitTopLevelArguments(text);
        expect(spans.length).toBe(3);
        expect(text.substring(spans[0].start, spans[0].end)).toBe('narrate');
        expect(text.substring(spans[1].start, spans[1].end)).toBe('"hello world"');
        expect(text.substring(spans[2].start, spans[2].end)).toBe('fo');
    });

    it('keeps a tag containing a space as one argument', () => {
        const text = 'narrate <player.flag[a b]> fo';
        const spans = splitTopLevelArguments(text);
        expect(spans.length).toBe(3);
        expect(text.substring(spans[0].start, spans[0].end)).toBe('narrate');
        expect(text.substring(spans[1].start, spans[1].end)).toBe('<player.flag[a b]>');
        expect(text.substring(spans[2].start, spans[2].end)).toBe('fo');
    });

    it('collapses consecutive spaces without emitting an empty token', () => {
        const text = 'narrate  hello';
        const spans = splitTopLevelArguments(text);
        expect(spans.length).toBe(2);
        expect(text.substring(spans[0].start, spans[0].end)).toBe('narrate');
        expect(text.substring(spans[1].start, spans[1].end)).toBe('hello');
    });

    it('treats an unterminated quote as running to the end of the text', () => {
        const text = 'narrate "hello wo';
        const spans = splitTopLevelArguments(text);
        expect(spans.length).toBe(2);
        expect(text.substring(spans[1].start, spans[1].end)).toBe('"hello wo');
    });

    it('treats an unterminated tag as running to the end of the text', () => {
        const text = 'narrate <player.flag[a b';
        const spans = splitTopLevelArguments(text);
        expect(spans.length).toBe(2);
        expect(text.substring(spans[1].start, spans[1].end)).toBe('<player.flag[a b');
    });
});

describe('argIndex with quotes, tags, and consecutive spaces', () => {
    it('does not inflate on a double space between plain arguments', () => {
        expect(parseCommandLine('- narrate a  b', 2)!.argIndex).toBe(1);
    });

    it('does not inflate on a double space right after the command name', () => {
        expect(parseCommandLine('- narrate  hello', 2)!.argIndex).toBe(0);
    });

    it('does not split a quoted value containing a space', () => {
        expect(parseCommandLine('- narrate "hello world" fo', 2)!.argIndex).toBe(1);
    });

    it('does not split a tag containing a space', () => {
        expect(parseCommandLine('- narrate <player.flag[a b]> fo', 2)!.argIndex).toBe(1);
    });
});

describe('splitTopLevelArguments with a bare comparison operator', () => {
    it('keeps a standalone ">" as its own argument', () => {
        const text = 'narrate > a';
        const spans = splitTopLevelArguments(text);
        expect(spans.length).toBe(3);
        expect(text.substring(spans[0].start, spans[0].end)).toBe('narrate');
        expect(text.substring(spans[1].start, spans[1].end)).toBe('>');
        expect(text.substring(spans[2].start, spans[2].end)).toBe('a');
    });

    it('keeps ">" as an argument in the middle of a comparison', () => {
        const text = 'if a > b';
        const spans = splitTopLevelArguments(text);
        expect(spans.length).toBe(4);
        expect(text.substring(spans[0].start, spans[0].end)).toBe('if');
        expect(text.substring(spans[1].start, spans[1].end)).toBe('a');
        expect(text.substring(spans[2].start, spans[2].end)).toBe('>');
        expect(text.substring(spans[3].start, spans[3].end)).toBe('b');
    });

    it('includes a leading ">" in the token it starts, since nothing separates them', () => {
        const text = '>a b';
        const spans = splitTopLevelArguments(text);
        expect(spans.length).toBe(2);
        expect(spans[0].start).toBe(0);
        expect(text.substring(spans[0].start, spans[0].end)).toBe('>a');
        expect(text.substring(spans[1].start, spans[1].end)).toBe('b');
    });

    it('keeps adjacent ">" characters together as one token', () => {
        const text = 'a >> b';
        const spans = splitTopLevelArguments(text);
        expect(spans.length).toBe(3);
        expect(text.substring(spans[0].start, spans[0].end)).toBe('a');
        expect(text.substring(spans[1].start, spans[1].end)).toBe('>>');
        expect(text.substring(spans[2].start, spans[2].end)).toBe('b');
    });

    it('does not let a bare ">" corrupt a tag that follows it', () => {
        const text = 'a > <b c> d';
        const spans = splitTopLevelArguments(text);
        expect(spans.length).toBe(4);
        expect(text.substring(spans[0].start, spans[0].end)).toBe('a');
        expect(text.substring(spans[1].start, spans[1].end)).toBe('>');
        expect(text.substring(spans[2].start, spans[2].end)).toBe('<b c>');
        expect(text.substring(spans[3].start, spans[3].end)).toBe('d');
    });

    it('counts the comparator as its own argument in argIndex', () => {
        expect(parseCommandLine('- if a > b', 2)!.argIndex).toBe(2);
    });
});

describe('splitTopLevelArguments with a bare "<" comparison operator', () => {
    it('keeps a standalone "<" as its own argument when followed by a space', () => {
        const text = 'a < b';
        const spans = splitTopLevelArguments(text);
        expect(spans.length).toBe(3);
        expect(text.substring(spans[0].start, spans[0].end)).toBe('a');
        expect(text.substring(spans[1].start, spans[1].end)).toBe('<');
        expect(text.substring(spans[2].start, spans[2].end)).toBe('b');
    });

    it('keeps "<=" together as one argument, since "=" cannot start a tag', () => {
        const text = 'a <= b';
        const spans = splitTopLevelArguments(text);
        expect(spans.length).toBe(3);
        expect(text.substring(spans[0].start, spans[0].end)).toBe('a');
        expect(text.substring(spans[1].start, spans[1].end)).toBe('<=');
        expect(text.substring(spans[2].start, spans[2].end)).toBe('b');
    });

    it('does not swallow the rest of the line after a bare "<"', () => {
        const text = 'a < b c d';
        const spans = splitTopLevelArguments(text);
        expect(spans.length).toBe(5);
        expect(text.substring(spans[0].start, spans[0].end)).toBe('a');
        expect(text.substring(spans[1].start, spans[1].end)).toBe('<');
        expect(text.substring(spans[2].start, spans[2].end)).toBe('b');
        expect(text.substring(spans[3].start, spans[3].end)).toBe('c');
        expect(text.substring(spans[4].start, spans[4].end)).toBe('d');
    });

    it('splits a bare "<" from real tags on either side of it', () => {
        const text = '- if <[a]> < <[b]>';
        const spans = splitTopLevelArguments(text);
        expect(spans.length).toBe(5);
        expect(text.substring(spans[0].start, spans[0].end)).toBe('-');
        expect(text.substring(spans[1].start, spans[1].end)).toBe('if');
        expect(text.substring(spans[2].start, spans[2].end)).toBe('<[a]>');
        expect(text.substring(spans[3].start, spans[3].end)).toBe('<');
        expect(text.substring(spans[4].start, spans[4].end)).toBe('<[b]>');
    });

    it('counts the comparator as its own argument in argIndex', () => {
        expect(parseCommandLine('- if a < b', 2)!.argIndex).toBe(2);
    });

    it('does not over-correct: a real tag starting with a letter still stays one argument', () => {
        const text = 'narrate <player.name> x';
        const spans = splitTopLevelArguments(text);
        expect(spans.length).toBe(3);
        expect(text.substring(spans[0].start, spans[0].end)).toBe('narrate');
        expect(text.substring(spans[1].start, spans[1].end)).toBe('<player.name>');
        expect(text.substring(spans[2].start, spans[2].end)).toBe('x');
    });

    it('does not over-correct: a real tag starting with "[" still stays one argument', () => {
        const text = '<[def]> y';
        const spans = splitTopLevelArguments(text);
        expect(spans.length).toBe(2);
        expect(text.substring(spans[0].start, spans[0].end)).toBe('<[def]>');
        expect(text.substring(spans[1].start, spans[1].end)).toBe('y');
    });
});

describe('argument fields agree with argIndex', () => {
    it('keeps a quoted argument whole instead of truncating at the last raw space', () => {
        const ctx = parseCommandLine('- narrate "hello world', 2)!;
        expect(ctx.argIndex).toBe(0);
        expect(ctx.argThusFar).toBe('"hello world');
    });

    it('keeps a tag containing a space whole', () => {
        const ctx = parseCommandLine('- narrate <player.flag[a b]', 2)!;
        expect(ctx.argIndex).toBe(0);
        expect(ctx.argThusFar).toBe('<player.flag[a b]');
    });

    it('still reports the plain last token when nothing is quoted', () => {
        const ctx = parseCommandLine('- narrate hello wor', 2)!;
        expect(ctx.argIndex).toBe(1);
        expect(ctx.argThusFar).toBe('wor');
    });

    it('reports an empty argument after a trailing separator space', () => {
        const ctx = parseCommandLine('- narrate hello ', 2)!;
        expect(ctx.argIndex).toBe(1);
        expect(ctx.argThusFar).toBe('');
        expect(ctx.argStart).toBe(ctx.argEnd);
    });

    it('places argStart at the argument, not at the last raw space', () => {
        const ctx = parseCommandLine('- narrate "hello world', 2)!;
        expect(ctx.argStart).toBe(12);
        expect(ctx.argEnd).toBe(24);
    });

    it('splits prefix and value on the first colon of the whole argument', () => {
        const ctx = parseCommandLine('- playsound sound:block.stone', 2)!;
        expect(ctx.argPrefix).toBe('sound');
        expect(ctx.argValue).toBe('block.stone');
    });

    it('accounts for a leading tilde when locating a quoted argument', () => {
        // nameStart for '- ~waituntil ...' at indent 2 is 5 (indent 2 + '- ' (2) + '~' (1)),
        // per the existing 'skips a leading tilde' test. rest (after stripping '- ' and '~')
        // is 'waituntil "hello world': the quoted span starts at rest offset 10, so argStart
        // is nameStart(5) + 10 = 15. The full trimmed line '- ~waituntil "hello world' is 25
        // characters, so argEnd (the cursor column) is indent(2) + 25 = 27.
        const ctx = parseCommandLine('- ~waituntil "hello world', 2)!;
        expect(ctx.argThusFar).toBe('"hello world');
        expect(ctx.argStart).toBe(15);
        expect(ctx.argEnd).toBe(27);
    });
});
