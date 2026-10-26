import { describe, it, expect } from 'vitest';
import { parsePaletteColor, paletteRules, mergeRules, userLevel, textMateRules, mergeTextMateRules, TEXTMATE_SCOPES } from './paletteRules';
import * as fs from 'fs';
import * as path from 'path';

// Reported 2026-10-26: while typing, new text first showed the theme's colour and switched to the
// palette's only when VS Code got round to asking for semantic tokens (>= 300 ms after the last
// keystroke). The grammar colours instantly, so the palette is given to the grammar's scopes too.
describe('textMateRules', () => {
    it('one named rule per palette type that has grammar scopes, with the palette font style', () => {
        const rules = textMateRules({ command: '#DD99FF|style=italic', colons: '#66CCFF|weight=bold', normal: '#E8E8E8' });
        expect(rules).toContainEqual({ name: 'denizen-palette:command', scope: TEXTMATE_SCOPES.command, settings: { foreground: '#DD99FF', fontStyle: 'italic' } });
        expect(rules).toContainEqual({ name: 'denizen-palette:colons', scope: TEXTMATE_SCOPES.colons, settings: { foreground: '#66CCFF', fontStyle: 'bold' } });
        // An explicit empty fontStyle, so a theme's italic does not leak into plain palette text.
        expect(rules).toContainEqual({ name: 'denizen-palette:normal', scope: TEXTMATE_SCOPES.normal, settings: { foreground: '#E8E8E8', fontStyle: '' } });
    });

    it('only touches Denizen scopes', () => {
        for (const scopes of Object.values(TEXTMATE_SCOPES)) {
            for (const scope of scopes) {
                expect(scope.endsWith('.denizenscript')).toBe(true);
            }
        }
    });

    it('every mapped scope exists in the grammar', () => {
        const grammar = fs.readFileSync(path.join(__dirname, '..', '..', 'syntaxes', 'denizenscript.tmLanguage.json'), 'utf8');
        for (const scopes of Object.values(TEXTMATE_SCOPES)) {
            for (const scope of scopes) {
                expect(grammar).toContain(scope);
            }
        }
    });
});

describe('mergeTextMateRules', () => {
    const ours = [{ name: 'denizen-palette:command', scope: ['support.function.denizenscript'], settings: { foreground: '#DD99FF', fontStyle: 'italic' } }];

    it('keeps the user\'s own rules and other keys, replacing only ours', () => {
        const userRule = { scope: 'comment', settings: { foreground: '#00FF00' } };
        const stale = { name: 'denizen-palette:tag', scope: ['meta.tag.denizenscript'], settings: { foreground: '#000000' } };
        const existing = { comments: '#888888', textMateRules: [userRule, stale] };
        expect(mergeTextMateRules(existing, ours)).toEqual({ comments: '#888888', textMateRules: [userRule, ...ours] });
    });

    it('null removes only ours', () => {
        const userRule = { scope: 'comment', settings: { foreground: '#00FF00' } };
        expect(mergeTextMateRules({ textMateRules: [userRule, ...ours] }, null)).toEqual({ textMateRules: [userRule] });
    });

    it('returns the same object when nothing changes', () => {
        const existing = { textMateRules: [...ours] };
        expect(mergeTextMateRules(existing, ours)).toBe(existing);
        expect(mergeTextMateRules(undefined, null)).toBeUndefined();
    });
});

// The rules live in USER settings, shared by every window. If each window built them from its own
// effective value (workspace overrides included), two windows with different palettes would keep
// rewriting each other's settings.json. Built from user-level values, every window agrees.
describe('userLevel', () => {
    it('prefers the user (global) value', () => {
        expect(userLevel({ globalValue: '#111111', workspaceValue: '#222222', defaultValue: '#333333' })).toBe('#111111');
    });
    it('ignores workspace and folder overrides, falling back to the default', () => {
        expect(userLevel({ workspaceValue: '#222222', workspaceFolderValue: '#444444', defaultValue: '#333333' })).toBe('#333333');
        expect(userLevel({ workspaceValue: false, defaultValue: true })).toBe(true);
    });
    it('is undefined when nothing is known', () => {
        expect(userLevel(undefined)).toBeUndefined();
    });
});

describe('parsePaletteColor', () => {
    it('reads colour, weight and style', () => {
        expect(parsePaletteColor('#FFFF00|weight=bold')).toEqual({ foreground: '#FFFF00', bold: true, italic: false });
        expect(parsePaletteColor('#1155FF|style=italic')).toEqual({ foreground: '#1155FF', bold: false, italic: true });
        expect(parsePaletteColor('#AAAAAA')).toEqual({ foreground: '#AAAAAA', bold: false, italic: false });
    });
    it('ignores a background it cannot express', () => {
        expect(parsePaletteColor('#FFFFFF|background=#440000')).toEqual({ foreground: '#FFFFFF', bold: false, italic: false });
    });
    it('rejects junk', () => {
        expect(parsePaletteColor('')).toBeNull();
        expect(parsePaletteColor('blue')).toBeNull();
    });
});

describe('paletteRules', () => {
    it('keys rules by denizen token type, scoped to the denizenscript language', () => {
        expect(paletteRules({ key: '#1155FF', command: '#DD99FF|style=italic', bad_space: '#FFFFFF|background=#440000' })).toEqual({
            'denizen_key:denizenscript': { foreground: '#1155FF' },
            'denizen_command:denizenscript': { foreground: '#DD99FF', italic: true },
        });
    });
});

describe('mergeRules', () => {
    const ours = { 'denizen_key:denizenscript': { foreground: '#1155FF' } };

    it('adds our rules and keeps everything the user wrote', () => {
        const existing = { enabled: true, '[Monokai]': { rules: { '*': '#fff' } }, rules: { variable: '#ffffff' } };
        expect(mergeRules(existing, ours)).toEqual({
            enabled: true,
            '[Monokai]': { rules: { '*': '#fff' } },
            rules: { variable: '#ffffff', 'denizen_key:denizenscript': { foreground: '#1155FF' } },
        });
    });

    it('starts from nothing', () => {
        expect(mergeRules(undefined, ours)).toEqual({ rules: ours });
    });

    it('null removes only our rules', () => {
        const existing = { rules: { variable: '#ffffff', 'denizen_key:denizenscript': { foreground: '#1155FF' } } };
        expect(mergeRules(existing, null)).toEqual({ rules: { variable: '#ffffff' } });
    });

    it('replaces a stale rule of ours', () => {
        const existing = { rules: { 'denizen_key:denizenscript': { foreground: '#000000' }, 'denizen_tag:denizenscript': { foreground: '#111111' } } };
        expect(mergeRules(existing, ours)).toEqual({ rules: ours });
    });

    it('returns the same object when nothing changes, so the caller can skip the write', () => {
        const existing = { rules: { variable: '#ffffff', 'denizen_key:denizenscript': { foreground: '#1155FF' } } };
        expect(mergeRules(existing, ours)).toBe(existing);
        const clean = { rules: { variable: '#ffffff' } };
        expect(mergeRules(clean, null)).toBe(clean);
        expect(mergeRules(undefined, null)).toBeUndefined();
    });
});
