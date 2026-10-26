import { describe, it, expect } from 'vitest';
import { baseTagSpecialColors, HighlightOptions } from '../highlight/denizenHighlighter';
import { settingsHtml } from './settingsHtml';
import { COLOR_CARDS, OPTION_CARDS, PREVIEW_SCRIPT, cardSpans, isWritableSetting, metaStatusLine, optionSettingId, previewState, sourcesState, sourceWrites } from './settingsModel';
import { readSourceSettings } from '../server/metaDocs/metaSources';

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

describe('meta sources on the page', () => {
    // Sources are written only through writeSourceSettings, never by key from the webview.
    it('cannot be written by key', () => {
        for (const key of ['denizenscript.server.extra_sources', 'denizenscript.server.enabled_addons', 'denizenscript.server.replace_default_sources']) {
            expect(isWritableSetting(key), key).toBe(false);
        }
    });
    it('lists the official sources, the add-ons and the own sources', () => {
        const state = sourcesState(['https://github.com/isnsest/denizen-reflect/archive/refs/heads/main.zip', 'https://my.fork/x.zip'], [], false);
        expect(state.official.map(s => s.name)).toEqual(['Denizen', 'Denizen-Core', 'Depenizen', 'dDiscordBot']);
        expect(state.addons.filter(a => a.enabled).map(a => a.id)).toEqual(['denizen-reflect']);
        expect(state.custom).toEqual([{ name: 'x', url: 'https://my.fork/x.zip', enabled: true }]);
        expect(state.replaceDefaults).toBe(false);
    });
    // Final review C1: the writes were diffed derived-against-derived, so a legacy add-on string in
    // extra_sources made the switch impossible to turn off, and editing an own source turned it off.
    describe('sourceWrites (diffed against what is stored)', () => {
        const DM = 'https://github.com/Energobro/DenizenM-Tjtoxshpilivili1/archive/refs/heads/master.zip';
        const stored = { extra: [DM, 'https://x/fork.zip'], addons: [] as string[], replace: false };
        const read = () => readSourceSettings(stored.extra, stored.addons, stored.replace);
        it('editing an own source keeps the legacy add-on switched on', () => {
            const next = read();
            next.custom[0].enabled = false;
            const writes = Object.fromEntries(sourceWrites(stored.extra, stored.addons, stored.replace, next).map(w => [w.key, w.value]));
            const after = readSourceSettings(writes['denizenscript.server.extra_sources'] ?? stored.extra, writes['denizenscript.server.enabled_addons'] ?? stored.addons, false);
            expect(after.addons.find(a => a.id === 'denizenm')!.enabled).toBe(true);
            expect(after.custom).toEqual([{ name: 'fork', url: 'https://x/fork.zip', enabled: false }]);
        });
        it('a legacy add-on can be switched off', () => {
            const next = read();
            next.addons.find(a => a.id === 'denizenm')!.enabled = false;
            const writes = Object.fromEntries(sourceWrites(stored.extra, stored.addons, stored.replace, next).map(w => [w.key, w.value]));
            const after = readSourceSettings(writes['denizenscript.server.extra_sources'] ?? stored.extra, writes['denizenscript.server.enabled_addons'] ?? stored.addons, false);
            expect(after.addons.find(a => a.id === 'denizenm')!.enabled).toBe(false);
            expect(after.custom.map(c => c.url)).toEqual(['https://x/fork.zip']);
        });
        it('writes nothing when nothing changed in the new form', () => {
            const next = readSourceSettings([{ name: 'fork', url: 'https://x/fork.zip', enabled: true }], ['denizenm'], false);
            expect(sourceWrites([{ name: 'fork', url: 'https://x/fork.zip', enabled: true }], ['denizenm'], false, next)).toEqual([]);
        });
    });
    it('says when and what the meta loaded', () => {
        const now = 1_800_000_000_000;
        const status = {
            loadedAt: now - 2 * 3600 * 1000,
            sources: Array.from({ length: 6 }, (_, i) => ({ url: `u${i}`, state: 'unchanged' as const, blocks: 1 })),
            commands: 200, tags: 900, events: 114, mechanisms: 50
        };
        expect(metaStatusLine(status, now)).toBe('Meta loaded 2 h ago · 6 sources · 1,214 commands, tags and events');
        const failed = { ...status, sources: [...status.sources, { url: 'bad', state: 'failed' as const, blocks: 0 }] };
        expect(metaStatusLine(failed, now)).toBe('Meta loaded 2 h ago · 6 sources · 1,214 commands, tags and events · 1 failed');
        expect(metaStatusLine({ ...status, loadedAt: now - 30 * 1000 }, now)).toBe('Meta loaded just now · 6 sources · 1,214 commands, tags and events');
        expect(metaStatusLine({ ...status, loadedAt: now - 5 * 60 * 1000 }, now)).toBe('Meta loaded 5 min ago · 6 sources · 1,214 commands, tags and events');
        expect(metaStatusLine(null, now)).toBe('Meta not loaded yet');
        // The server's report of a load that threw has no sources.
        expect(metaStatusLine({ ...status, sources: [], commands: 0, tags: 0, events: 0 }, now)).toBe('Meta failed to load 2 h ago — see the Denizen language server output');
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
