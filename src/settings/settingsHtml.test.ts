import { describe, it, expect } from 'vitest';
import { baseTagSpecialColors, HighlightOptions } from '../highlight/denizenHighlighter';
import { settingsHtml } from './settingsHtml';
import { COLOR_CARDS, OPTION_CARDS, PREVIEW_SCRIPT, cardSpans, isWritableSetting, optionSettingId, previewState } from './settingsModel';

const opts: HighlightOptions = { headerSymbols: '|+=_@/', doInlineColors: true, displayDarkColors: false, tagSpecialColors: baseTagSpecialColors, colorRef: {} };

describe('settingsHtml', () => {
    const html = settingsHtml({ nonce: 'N0nce', cspSource: 'vscode-resource:', scriptUri: 'vscode-resource:/s.js', styleUri: 'vscode-resource:/s.css' });

    // A script without the nonce is blocked by the CSP and the page is silently blank.
    it('has a CSP that only runs scripts carrying the nonce', () => {
        expect(html).toMatch(/<meta http-equiv="Content-Security-Policy" content="[^"]*default-src 'none'[^"]*script-src 'nonce-N0nce'/);
    });
    it('every script tag carries the nonce', () => {
        const scripts = html.match(/<script\b[^>]*>/g) ?? [];
        expect(scripts.length).toBeGreaterThan(0);
        for (const tag of scripts) {
            expect(tag).toContain('nonce="N0nce"');
        }
    });
    it('loads nothing from the network', () => {
        expect(html).not.toMatch(/https?:/);
    });
    it('links the stylesheet and the script it was given', () => {
        expect(html).toContain('href="vscode-resource:/s.css"');
        expect(html).toContain('src="vscode-resource:/s.js"');
    });
});

describe('isWritableSetting', () => {
    it('accepts the keys the page shows', () => {
        for (const card of COLOR_CARDS) {
            expect(isWritableSetting(`denizenscript.theme_colors.${card.type}`)).toBe(true);
        }
        for (const card of OPTION_CARDS) {
            expect(isWritableSetting(optionSettingId(card.key))).toBe(true);
        }
        expect(isWritableSetting('denizenscript.theme_colors.text_color_map')).toBe(true);
        expect(isWritableSetting('denizenscript.behaviors.use_custom_syntax_colors')).toBe(true);
    });
    // The webview is not trusted to write arbitrary settings.
    it('refuses everything else', () => {
        for (const key of ['editor.fontSize', 'denizenscript.theme_colors.bad_space', 'denizenscript.debug.performance',
            'denizenscript.server.extra_sources', 'denizenscript.theme_colors.', '__proto__']) {
            expect(isWritableSetting(key), key).toBe(false);
        }
    });
});

describe('preview and card spans', () => {
    it('the preview has one span list per script line, text intact', () => {
        const state = previewState(opts);
        const lines = PREVIEW_SCRIPT.split('\n');
        expect(state.preview.length).toBe(lines.length);
        state.preview.forEach((spans, i) => expect(spans.map(s => s.text).join('')).toBe(lines[i]));
    });
    // Hovering a card outlines what it colours in the preview, so every card's type must be there.
    it('the preview shows every card type', () => {
        const shown = new Set(previewState(opts).preview.flat().map(s => s.type));
        for (const card of COLOR_CARDS) {
            expect(shown.has(card.type), card.type).toBe(true);
        }
    });
    it('marks the ### lines for the band and colours <&6> inline', () => {
        const state = previewState(opts);
        const lines = PREVIEW_SCRIPT.split('\n');
        expect(state.criticalLines.length).toBeGreaterThan(0);
        for (const i of state.criticalLines) {
            expect(lines[i].startsWith('### ')).toBe(true);
        }
        expect(state.preview.flat().some(s => s.inline !== undefined)).toBe(true);
    });
    it('gives every card its sample as spans', () => {
        const cards = cardSpans(opts);
        for (const card of COLOR_CARDS) {
            expect(cards[card.type].map(s => s.text).join('')).toBe(card.sample);
        }
    });
});
