import { describe, it, expect } from 'vitest';
import { combineSources } from './server';

describe('combineSources', () => {
    it('returns just the defaults when extra is undefined, null, or empty', () => {
        const defaults = ['https://example.com/a.zip', 'https://example.com/b.zip'];
        expect(combineSources(defaults, undefined)).toEqual(defaults);
        expect(combineSources(defaults, null)).toEqual(defaults);
        expect(combineSources(defaults, [])).toEqual(defaults);
    });

    it('appends extra sources after the defaults', () => {
        const defaults = ['https://example.com/a.zip'];
        const extra = ['https://example.com/custom1.zip', 'https://example.com/custom2.zip'];
        expect(combineSources(defaults, extra)).toEqual([
            'https://example.com/a.zip',
            'https://example.com/custom1.zip',
            'https://example.com/custom2.zip'
        ]);
    });

    it('trims whitespace and drops blank entries', () => {
        const defaults = ['https://example.com/a.zip'];
        const extra = ['  https://example.com/custom.zip  ', '', '   '];
        expect(combineSources(defaults, extra)).toEqual([
            'https://example.com/a.zip',
            'https://example.com/custom.zip'
        ]);
    });
});
