import { describe, it, expect } from 'vitest';
import { combineSources, buildCapabilities } from './server';

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

describe('buildCapabilities', () => {
    it('advertises completion and hover support', () => {
        const caps = buildCapabilities();
        expect(caps.completionProvider).toBeDefined();
        expect(caps.completionProvider!.resolveProvider).toBe(false);
        expect(caps.hoverProvider).toBe(true);
    });

    it('offers a dash as a completion trigger character', () => {
        expect(buildCapabilities().completionProvider!.triggerCharacters).toContain('-');
    });

    it('keeps incremental document sync', () => {
        expect(buildCapabilities().textDocumentSync).toBe(2);
    });
});

describe('signature help capability', () => {
    it('advertises signature help with the Denizen trigger characters', () => {
        const caps = buildCapabilities();
        expect(caps.signatureHelpProvider).toBeDefined();
        expect(caps.signatureHelpProvider!.triggerCharacters).toContain(' ');
    });
});
