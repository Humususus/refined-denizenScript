import { describe, it, expect } from 'vitest';
import { separatorForSpace } from './tagSeparators';

/**
 * FEATURE-IDEAS.md idea 5, user ruling 2026-09-01. There is no C# counterpart and no meta
 * involved: every expectation is derived from Denizen's tag syntax and from the feature note's
 * one hard rule -- "when in doubt, type a space".
 */

/** The separator for a cursor placed at the END of `prefix`. */
function at(prefix: string): string | null {
    return separatorForSpace(prefix, prefix.length);
}

describe('separatorForSpace: the two tags it acts on', () => {
    it('types ";" inside a map tag', () => {
        expect(at('- narrate <map[a=1')).toBe(';');
    });

    it('types "|" inside a list tag', () => {
        expect(at('- narrate <list[a')).toBe('|');
    });

    it('is case-insensitive on the tag name', () => {
        expect(at('- narrate <MAP[a=1')).toBe(';');
        expect(at('- narrate <List[a')).toBe('|');
    });
});

describe('separatorForSpace: where it must stay out of the way', () => {
    it('types a plain space outside any tag', () => {
        expect(at('- narrate hello')).toBeNull();
        expect(at('')).toBeNull();
        expect(at('    ')).toBeNull();
    });

    it('types a plain space inside a tag but OUTSIDE its parameters', () => {
        // MUTANT CAUGHT: ignoring `inParams` and matching on the name alone.
        expect(at('- narrate <map')).toBeNull();
        expect(at('- narrate <list')).toBeNull();
    });

    it('types a plain space once the parameters have closed', () => {
        // MUTANT CAUGHT: never clearing `inParams` on the matching `]`.
        expect(at('- narrate <map[a=1;b=2]')).toBeNull();
        expect(at('- narrate <list[a|b]>')).toBeNull();
        expect(at('- narrate <list[a|b]> and more text')).toBeNull();
    });

    it('types a plain space in an unrelated tag that merely HAS parameters', () => {
        // The commonest tag shape in real scripts. If this fired, the feature would corrupt
        // ordinary lines constantly.
        // MUTANT CAUGHT: matching the whole dotted name instead of its last component.
        expect(at('- narrate <player.flag[home')).toBeNull();
        expect(at('- narrate <server.flag[maf.players')).toBeNull();
        expect(at('- narrate <[def].get[1')).toBeNull();
    });

    it('does not let an EARLIER map component excuse a later one', () => {
        // `<map[a=1].get[b` -- the `[` under the cursor belongs to `get`, not to `map`.
        // MUTANT CAUGHT: taking the first name component, or the accumulated name, rather than
        // the one the open bracket belongs to.
        expect(at('- narrate <map[a=1].get[b')).toBeNull();
    });
});

describe('separatorForSpace: the "nothing to separate yet" guards', () => {
    it('types a plain space immediately after the opening bracket', () => {
        // Would otherwise produce `<map[;`.
        expect(at('- narrate <map[')).toBeNull();
        expect(at('- narrate <list[')).toBeNull();
    });

    it('types a plain space immediately after a separator', () => {
        // Would otherwise produce `;;`.
        expect(at('- narrate <map[a=1;')).toBeNull();
        expect(at('- narrate <list[a|')).toBeNull();
    });

    it('types a plain space immediately after another space', () => {
        // Would otherwise produce `a ;`, a separator the user cannot see is attached to nothing.
        expect(at('- narrate <map[a=1 ')).toBeNull();
    });

    it('types a plain space immediately after "=", where a VALUE is starting', () => {
        // `<map[greeting= ` -- the user is beginning the value, not ending the entry.
        // MUTANT CAUGHT: dropping the `=` guard.
        expect(at('- narrate <map[greeting=')).toBeNull();
    });
});

describe('separatorForSpace: quoting', () => {
    it('still fires when the whole TAG sits inside a quoted argument', () => {
        // This is the decisive case. A map tag is nearly always written inside quotes, so a
        // line-wide quote scanner would kill the feature outright.
        // MUTANT CAUGHT: tracking quotes for the whole line rather than per tag frame.
        expect(at('- narrate "<map[a=1')).toBe(';');
        expect(at("- narrate '<list[a")).toBe('|');
    });

    it('types a plain space inside a quoted VALUE within the parameters', () => {
        // The feature note's "not inside a quoted string": the user is writing prose here.
        // MUTANT CAUGHT: not tracking quotes inside the parameters at all.
        expect(at('- narrate <map[msg="hello there')).toBeNull();
        expect(at("- narrate <map[msg='hello there")).toBeNull();
    });

    it('resumes once the quoted value is closed', () => {
        expect(at('- narrate <map[msg="hello there"')).toBe(';');
    });

    it('does not let a quote of the OTHER kind close the value', () => {
        expect(at('- narrate <map[msg="it\'s here')).toBeNull();
    });

    it('treats brackets and angles inside a quoted value as plain text', () => {
        // MUTANT CAUGHT: letting the structural branches run while a quote is open, which would
        // close the parameters on the `]` inside the string.
        expect(at('- narrate <map[msg="a]b')).toBeNull();
        expect(at('- narrate <map[msg="a]b"')).toBe(';');
    });
});

describe('separatorForSpace: nesting', () => {
    it('uses the INNERMOST tag, not the outer one', () => {
        // MUTANT CAUGHT: reading the bottom of the stack instead of the top.
        expect(at('- narrate <map[a=<list[x')).toBe('|');
        expect(at('- narrate <list[<map[a=1')).toBe(';');
    });

    it('returns to the outer tag when the inner one closes', () => {
        expect(at('- narrate <map[a=<list[x|y]>')).toBe(';');
    });

    it('handles a raw bracket pair inside the parameters', () => {
        // The params must not close on the inner `]`.
        // MUTANT CAUGHT: clearing `inParams` on any `]` instead of on bracketDepth reaching 0.
        expect(at('- narrate <list[a[b]c')).toBe('|');
    });

    it('does not underflow on a stray ">"', () => {
        expect(at('- narrate a > b')).toBeNull();
        expect(at('- narrate a > b <map[x=1')).toBe(';');
    });
});

describe('separatorForSpace: the cursor position is respected', () => {
    it('reads only the text BEFORE the cursor', () => {
        // Same line, three cursor columns, three answers. If the whole line were scanned, the
        // trailing `]>` would close the parameters and every answer would be null.
        const line = '- narrate <map[a=1]>';
        expect(separatorForSpace(line, '- narrate <map[a=1'.length)).toBe(';');
        expect(separatorForSpace(line, line.length)).toBeNull();
        expect(separatorForSpace(line, 0)).toBeNull();
    });

    it('clamps a negative column rather than slicing from the end', () => {
        // `String.slice(0, -1)` would silently drop the last character and answer about the wrong
        // text. This is defensive against a caller, not against a user.
        expect(separatorForSpace('- narrate <map[a=1', -5)).toBeNull();
    });
});
