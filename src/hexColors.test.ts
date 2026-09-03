import { describe, it, expect } from 'vitest';
import { findHexColors, formatHexColor } from './hexColors';

/**
 * FEATURE-IDEAS.md idea 10, user request 2026-09-03. The note's stated risk is the one tested
 * hardest here: a DocumentColorProvider is asked for the whole document on every change, so the
 * scan must not fire inside comments or on stray `#`.
 */

describe('findHexColors', () => {
    it('finds the colour in the real corpus line', () => {
        // The only hex colour in the user's 25 script files, nested two tags deep.
        const line = '    - define id <element[<&color[#2596be]>123].custom_color[npc]>';
        const found = findHexColors(line);
        expect(found.length).toBe(1);
        expect(line.slice(found[0].start, found[0].end)).toBe('#2596be');
        expect(found[0]).toMatchObject({ red: 0x25, green: 0x96, blue: 0xbe, alpha: 255, hasAlpha: false });
    });

    it('reads the 8-digit RGBA form the ColorTag meta documents', () => {
        // ColorTag: "or RGBA hex codes like '#FF00FF80'".
        const found = findHexColors('- narrate <&color[#FF00FF80]>hi');
        expect(found.length).toBe(1);
        expect(found[0]).toMatchObject({ red: 255, green: 0, blue: 255, alpha: 0x80, hasAlpha: true });
    });

    it('finds both colours of a gradient', () => {
        const found = findHexColors('- narrate "<&gradient[from=#000000;to=#ffffff]>text"');
        expect(found.map(f => f.red)).toEqual([0, 255]);
    });

    it('ignores a comment line even when it holds a well-formed tag', () => {
        // MUTANT CAUGHT: dropping the comment guard. Commented-out script is ordinary here, and a
        // swatch on a line the parser ignores invites an edit that does nothing.
        expect(findHexColors('    # - narrate <&color[#2596be]>hi')).toEqual([]);
        expect(findHexColors('# ффффff and <&color[#112233]>')).toEqual([]);
    });

    it('ignores a hex outside any tag', () => {
        // MUTANT CAUGHT: dropping the depth requirement. Denizen only accepts a hex colour where a
        // ColorTag is constructed, and that is always inside <...>.
        expect(findHexColors('- narrate #2596be')).toEqual([]);
        expect(findHexColors('    key: #2596be')).toEqual([]);
    });

    it('does not half-match a longer run of hex digits', () => {
        // MUTANT CAUGHT: matching 6 digits and ignoring what follows.
        expect(findHexColors('- narrate <element[#2596bed]>')).toEqual([]);
        expect(findHexColors('- narrate <element[#123456789]>')).toEqual([]);
    });

    it('ignores a short or malformed literal', () => {
        expect(findHexColors('- narrate <&color[#25be]>')).toEqual([]);
        expect(findHexColors('- narrate <&color[#zzzzzz]>')).toEqual([]);
    });

    it('survives a stray closing angle bracket', () => {
        // `<[a]> > 5` leaves the depth counter unbalanced; clamping at zero keeps the rest of the
        // line readable instead of silencing it.
        // MUTANT CAUGHT: letting depth go negative.
        const found = findHexColors('- if <[a]> > 5 && <&color[#2596be]>');
        expect(found.length).toBe(1);
    });

    it('finds several colours on one line', () => {
        const found = findHexColors('- narrate <&color[#111111]><&color[#222222]>');
        expect(found.length).toBe(2);
        expect(found[0].start).toBeLessThan(found[1].start);
    });
});

describe('formatHexColor', () => {
    it('keeps six digits when the literal never had alpha and still is opaque', () => {
        // Opening the picker and closing it again must not rewrite the file.
        // MUTANT CAUGHT: always writing the alpha byte.
        expect(formatHexColor(0x25, 0x96, 0xbe, 255, false)).toBe('#2596be');
    });

    it('writes the alpha byte when the colour is transparent', () => {
        expect(formatHexColor(255, 0, 255, 0x80, false)).toBe('#ff00ff80');
    });

    it('keeps the alpha byte the author already wrote, even at full opacity', () => {
        expect(formatHexColor(255, 0, 255, 255, true)).toBe('#ff00ffff');
    });

    it('clamps and rounds what the picker returns', () => {
        expect(formatHexColor(-5, 300, 127.6, 255, false)).toBe('#00ff80');
    });
});
