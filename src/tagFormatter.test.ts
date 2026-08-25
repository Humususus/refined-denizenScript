import { describe, it, expect } from 'vitest';
import { findTagAt, splitTagEntries, formatTag, collapseTag, isCollapsible } from './tagFormatter';

/**
 * The user's own unreadable line, which is what this module exists for.
 */
const REAL = '<map[translation=<[start].left[<element[<[lefted].mul[<[new_t]>]>]>]>;interpolation_start=0;interpolation_duration=2t]>';

describe('findTagAt', () => {
    it('finds the tag surrounding the cursor', () => {
        const line = '- narrate <map[a=1;b=2]> after';
        expect(findTagAt(line, 12)).toEqual({ start: 10, end: 24, text: '<map[a=1;b=2]>' });
    });

    it('finds the OUTERMOST tag when the cursor is inside a nested one', () => {
        // Putting the cursor in the middle of `<[new_t]>` must still offer to format the whole
        // map, not the innermost fragment -- the map is the thing that is unreadable.
        // MUTANT CAUGHT: scanning back to the NEAREST '<' instead of the first enclosing one.
        const inner = REAL.indexOf('new_t');
        const found = findTagAt(REAL, inner);
        expect(found).not.toBeNull();
        expect(found!.start).toBe(0);
        expect(found!.text).toBe(REAL);
    });

    it('returns null when the cursor is outside any tag', () => {
        expect(findTagAt('- narrate hello', 5)).toBeNull();
        expect(findTagAt('- narrate <map[a=1;b=2]> after', 27)).toBeNull();
    });

    it('returns null for an unclosed tag', () => {
        // No matching '>', so there is nothing to format. Must not run off the end.
        expect(findTagAt('- narrate <map[a=1', 12)).toBeNull();
    });
});

describe('splitTagEntries', () => {
    it('splits a map on ";" and each entry on its first "="', () => {
        expect(splitTagEntries('<map[a=1;b=2]>')).toEqual([
            { key: 'a', value: '1' },
            { key: 'b', value: '2' }
        ]);
    });

    it('does NOT split on a ";" nested inside a tag', () => {
        // The whole reason this counts depth. A naive split(';') tears the user's real line apart.
        // MUTANT CAUGHT: splitting without depth tracking.
        const entries = splitTagEntries('<map[a=<x[p;q]>;b=2]>');
        expect(entries).toEqual([
            { key: 'a', value: '<x[p;q]>' },
            { key: 'b', value: '2' }
        ]);
    });

    it('keeps a nested tag containing "=" whole', () => {
        // Splits on the FIRST '=' at depth zero only, so a nested `flag=x` stays in the value.
        expect(splitTagEntries('<map[item=stone[flag=a];n=2]>')).toEqual([
            { key: 'item', value: 'stone[flag=a]' },
            { key: 'n', value: '2' }
        ]);
    });

    it('splits a list on "|" with no keys', () => {
        expect(splitTagEntries('<list[a|b|c]>')).toEqual([
            { key: '', value: 'a' },
            { key: '', value: 'b' },
            { key: '', value: 'c' }
        ]);
    });

    it('returns null for a single-entry tag -- formatting would add noise, not information', () => {
        expect(splitTagEntries('<map[only=1]>')).toBeNull();
        expect(splitTagEntries('<list[alone]>')).toBeNull();
    });

    it('returns null for a tag that is neither a map nor a list', () => {
        expect(splitTagEntries('<player.name>')).toBeNull();
        expect(splitTagEntries('<player.flag[a;b]>')).toBeNull();
    });

    it('is case-insensitive about the base name', () => {
        expect(splitTagEntries('<MAP[a=1;b=2]>')).not.toBeNull();
    });

    it('handles the user\'s real line without tearing the nested tag', () => {
        // The value here is four tags deep. If depth counting is wrong anywhere, this shreds.
        const entries = splitTagEntries(REAL)!;
        expect(entries.map(e => e.key)).toEqual(['translation', 'interpolation_start', 'interpolation_duration']);
        expect(entries[0].value).toBe('<[start].left[<element[<[lefted].mul[<[new_t]>]>]>]>');
        expect(entries[2].value).toBe('2t');
    });
});

describe('formatTag', () => {
    it('renders the user\'s real line readably', () => {
        expect(formatTag(REAL)).toBe([
            '<map[',
            '    translation            = <[start].left[<element[<[lefted].mul[<[new_t]>]>]>]>;',
            '    interpolation_start    = 0;',
            '    interpolation_duration = 2t',
            ']>'
        ].join('\n'));
    });

    it('keeps the separator on the line it belongs to, so the original is readable back', () => {
        // A reader must be able to see where the ';' went; dropping them would make the pretty
        // form ambiguous about what the real single-line tag is.
        // MUTANT CAUGHT: omitting the trailing separator, or putting one after the last entry.
        const out = formatTag('<map[a=1;b=2;c=3]>')!.split('\n');
        expect(out[1].endsWith(';')).toBe(true);
        expect(out[2].endsWith(';')).toBe(true);
        expect(out[3].endsWith(';')).toBe(false);
    });

    it('aligns the "=" across entries', () => {
        const out = formatTag('<map[a=1;longer=2]>')!.split('\n');
        expect(out[1]).toBe('    a      = 1;');
        expect(out[2]).toBe('    longer = 2');
    });

    it('renders a list without keys', () => {
        expect(formatTag('<list[a|b]>')).toBe(['<list[', '    a|', '    b', ']>'].join('\n'));
    });

    it('returns null when there is nothing worth showing', () => {
        // Callers treat null as "offer nothing", so this is the contract that stops a hover
        // appearing over every plain tag in the file.
        expect(formatTag('<player.name>')).toBeNull();
        expect(formatTag('<map[only=1]>')).toBeNull();
    });

    it('honours a custom indent', () => {
        expect(formatTag('<map[a=1;b=2]>', '  ')!.split('\n')[1]).toBe('  a = 1;');
    });
});

describe('collapseTag: the edit round-trip', () => {
    it('round-trips an untouched tag back to exactly the original', () => {
        // The safety property the whole feature rests on: opening the expanded view and closing
        // it without typing must not change a single character of the script.
        // MUTANT CAUGHT: any normalisation that "tidies" the tag on the way back.
        expect(collapseTag(formatTag(REAL)!)).toBe(REAL);
        expect(collapseTag(formatTag('<list[a|b|c]>')!)).toBe('<list[a|b|c]>');
    });

    it('accepts a new entry typed WITHOUT a separator', () => {
        // Entries are delimited by LINES, not by separators, so the user can add a line and it
        // becomes an entry -- the separator is inserted for them.
        // MUTANT CAUGHT: splitting the body on ';' instead of on newlines, which would silently
        // merge the new line into the previous entry.
        const lines = formatTag(REAL)!.split('\n');
        lines.splice(lines.length - 1, 0, '    scale = 1.5');
        const collapsed = collapseTag(lines.join('\n'))!;
        expect(collapsed).toContain(';scale=1.5]>');
        expect(collapsed).toContain('interpolation_duration=2t;');
        // And the nested tag that made the line unreadable in the first place is untouched.
        expect(collapsed).toContain('<[start].left[<element[<[lefted].mul[<[new_t]>]>]>]>');
    });

    it('accepts a new entry typed WITH a separator', () => {
        // The formatted view shows separators, so copying that habit is natural and must work.
        const lines = formatTag('<map[a=1;b=2]>')!.split('\n');
        lines.splice(lines.length - 1, 0, '    c = 3;');
        expect(collapseTag(lines.join('\n'))).toBe('<map[a=1;b=2;c=3]>');
    });

    it('strips only ONE trailing separator, so a value ending in ";" survives', () => {
        expect(collapseTag('<map[\n  a = x;;\n  b = 2\n]>')).toBe('<map[a=x;;b=2]>');
    });

    it('drops a removed entry', () => {
        expect(collapseTag('<map[\n  a = 1;\n]>')).toBe('<map[a=1]>');
    });

    it('ignores blank lines the user leaves behind', () => {
        expect(collapseTag('<map[\n\n  a = 1;\n\n  b = 2\n\n]>')).toBe('<map[a=1;b=2]>');
    });

    it('normalises the spaces the formatter added around "="', () => {
        // The alignment padding is presentation. The real tag has no spaces there.
        // MUTANT CAUGHT: writing the padded form back, which changes the map's key names.
        expect(collapseTag('<map[\n  key      = value\n  b = 2\n]>')).toBe('<map[key=value;b=2]>');
    });

    it('leaves a nested "=" inside a value alone', () => {
        expect(collapseTag('<map[\n  item = stone[flag=a];\n  n = 2\n]>')).toBe('<map[item=stone[flag=a];n=2]>');
    });

    it('returns null rather than writing something broken', () => {
        // The caller declines to touch the file when this is null, which is what stops a
        // half-typed view from corrupting the script.
        expect(collapseTag('not a tag')).toBeNull();
        expect(collapseTag('<map[\n]>')).toBeNull();
        expect(collapseTag('<map[\n  a = 1\nmissing close')).toBeNull();
        expect(collapseTag('<player.name>')).toBeNull();
    });
});

describe('isCollapsible', () => {
    it('accepts a balanced edit', () => {
        expect(isCollapsible('<map[\n  a = <player.name>;\n  b = 2\n]>')).toBe(true);
    });

    it('REJECTS a half-typed nested tag', () => {
        // The guard that stops an edit being written mid-keystroke. While the user is partway
        // through `<element[1].mul[` the brackets do not balance, and collapsing then would put
        // a broken tag into the script; holding the last good version is the right answer.
        // MUTANT CAUGHT: writing back on every keystroke without checking balance.
        expect(isCollapsible('<map[\n  a = 1;\n  scale = <element[1].mul[\n]>')).toBe(false);
    });

    it('rejects input that is not an expanded tag at all', () => {
        expect(isCollapsible('hello')).toBe(false);
    });
});
