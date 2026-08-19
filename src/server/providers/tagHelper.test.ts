import { describe, it, expect } from 'vitest';
import { parseTag } from './tagHelper';

/** Collects trackError callback invocations for assertions. */
function collectErrors(): { errors: string[]; trackError: (message: string) => void } {
    const errors: string[] = [];
    return { errors, trackError: (message: string) => errors.push(message) };
}

describe('parseTag', () => {
    it('splits a simple dotted tag into parts with no parameters', () => {
        const { errors, trackError } = collectErrors();
        const result = parseTag('player.name', trackError);
        expect(result.parts).toHaveLength(2);
        expect(result.parts[0]).toEqual({ text: 'player', parameter: null, startChar: 0, endChar: 5 });
        expect(result.parts[1]).toEqual({ text: 'name', parameter: null, startChar: 7, endChar: 10 });
        expect(result.fallback).toBeNull();
        expect(result.endChar).toBe(11);
        expect(errors).toEqual([]);
    });

    it('captures a bracketed parameter on the part it follows', () => {
        const { errors, trackError } = collectErrors();
        const result = parseTag('player.flag[my_flag]', trackError);
        expect(result.parts).toHaveLength(2);
        expect(result.parts[0]).toEqual({ text: 'player', parameter: null, startChar: 0, endChar: 5 });
        expect(result.parts[1]).toEqual({ text: 'flag', parameter: 'my_flag', startChar: 7, endChar: 19 });
        expect(result.fallback).toBeNull();
        expect(result.endChar).toBe(20);
        expect(errors).toEqual([]);
    });

    it('captures a bracketed parameter containing a nested tag whole, and continues parsing after it', () => {
        const { errors, trackError } = collectErrors();
        const result = parseTag('player.flag[<[def]>].expiration', trackError);
        expect(result.parts).toHaveLength(3);
        expect(result.parts[0]).toEqual({ text: 'player', parameter: null, startChar: 0, endChar: 5 });
        expect(result.parts[1]).toEqual({ text: 'flag', parameter: '<[def]>', startChar: 7, endChar: 19 });
        expect(result.parts[2]).toEqual({ text: 'expiration', parameter: null, startChar: 21, endChar: 30 });
        expect(result.fallback).toBeNull();
        expect(result.endChar).toBe(31);
        expect(errors).toEqual([]);
    });

    it('splits off a fallback after || and does not parse it into parts', () => {
        const { errors, trackError } = collectErrors();
        const result = parseTag('player.name||fallback text', trackError);
        expect(result.parts).toHaveLength(2);
        expect(result.parts[0]).toEqual({ text: 'player', parameter: null, startChar: 0, endChar: 5 });
        expect(result.parts[1]).toEqual({ text: 'name', parameter: null, startChar: 7, endChar: 10 });
        expect(result.fallback).toBe('fallback text');
        expect(result.endChar).toBe(11);
        expect(errors).toEqual([]);
    });

    it('captures nested brackets as one whole parameter', () => {
        const { errors, trackError } = collectErrors();
        const result = parseTag('a[b[c]]', trackError);
        expect(result.parts).toHaveLength(1);
        expect(result.parts[0]).toEqual({ text: 'a', parameter: 'b[c]', startChar: 0, endChar: 6 });
        expect(result.fallback).toBeNull();
        expect(result.endChar).toBe(7);
        expect(errors).toEqual([]);
    });

    it('lowercases the input before parsing', () => {
        const { trackError } = collectErrors();
        const result = parseTag('Player.Name', trackError);
        expect(result.parts.map(p => p.text)).toEqual(['player', 'name']);
    });

    describe('error reporting', () => {
        it('reports too many ] for an unmatched closing bracket', () => {
            // Hand-trace of "a]]": at i=1 brackets becomes -1 -> "too many ']'" fires.
            // At i=2 brackets becomes -2 (not exactly -1, so no second ']' error).
            // At end of loop brackets(-2) != 0, so the C# port's unconditional
            // "brackets != 0" check ALSO fires "too many '['" even though the
            // excess symbol was ']', not '['. This is an inherent quirk of the
            // ported algorithm (TagHelper.cs:79-82), not a bug in this port.
            const { errors, trackError } = collectErrors();
            parseTag('a]]', trackError);
            expect(errors).toHaveLength(2);
            expect(errors[0]).toMatch(/too many.*\]/i);
            expect(errors[1]).toMatch(/too many.*\[/i);
        });

        it('reports too many [ for an unclosed opening bracket', () => {
            const { errors, trackError } = collectErrors();
            parseTag('a[[', trackError);
            expect(errors).toHaveLength(1);
            expect(errors[0]).toMatch(/too many.*\[/i);
        });

        it('reports text after a closing ] before the next .', () => {
            const { errors, trackError } = collectErrors();
            parseTag('a[b]c.d', trackError);
            expect(errors).toHaveLength(1);
            expect(errors[0]).toMatch(/text after/i);
            expect(errors[0]).toMatch(/\]/);
        });
    });
});

describe('parseTag deferred coverage', () => {
    it('trims whitespace off a part\'s text while leaving its offsets alone', () => {
        const tag = parseTag('player. name', () => { /* ignore */ });
        expect(tag.parts.map(p => p.text)).toEqual(['player', 'name']);
        // startChar still points at the space — the trim changes text, not position.
        expect(tag.parts[1].startChar).toBe(7);
    });

    it('still returns the parts it read when the input is malformed', () => {
        const errors: string[] = [];
        const tag = parseTag('a[b]c.d', (m) => errors.push(m));
        expect(errors.length).toBeGreaterThan(0);
        expect(tag.parts.map(p => p.text)).toContain('d');
    });
});
