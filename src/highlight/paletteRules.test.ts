import { describe, it, expect } from 'vitest';
import { parsePaletteColor, paletteRules, mergeRules, userLevel } from './paletteRules';

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
