// The Denizen palette (`denizenscript.theme_colors.*`) as `editor.semanticTokenColorCustomizations`
// rules. No `vscode` import; extension.ts does the reading and writing of settings.
//
// THE SETTING BELONGS TO THE USER. The extension writes into their global settings, so it only ever
// touches rule keys that start with `denizen_` -- `enabled`, per-theme `[Theme Name]` blocks and
// every other rule are carried through untouched.

import { semanticIndex } from './semanticEncoding';

export interface PaletteColor {
    foreground: string;
    bold: boolean;
    italic: boolean;
}

export interface TokenRule {
    foreground: string;
    bold?: boolean;
    italic?: boolean;
}

/** Reads the palette's `#RRGGBB|weight=bold|style=italic` format. `background=` cannot be a token colour and is ignored. */
export function parsePaletteColor(value: string): PaletteColor | null {
    const parts = value.split('|');
    if (!/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(parts[0])) {
        return null;
    }
    const result: PaletteColor = { foreground: parts[0], bold: false, italic: false };
    for (const part of parts.slice(1)) {
        const [setting, setValue] = part.split('=', 2);
        if (setting === 'weight') {
            result.bold = setValue === 'bold';
        }
        else if (setting === 'style') {
            result.italic = setValue === 'italic';
        }
    }
    return result;
}

const OUR_PREFIX = 'denizen_';

/**
 * A setting's USER-level value (global, else default), from `WorkspaceConfiguration.inspect`.
 * Workspace and folder overrides are ignored on purpose: the rules this feeds are written to user
 * settings, shared by every open window, so they must be computed the same way in all of them --
 * otherwise two windows with different workspace palettes rewrite each other's settings forever.
 */
export function userLevel<T>(inspected: { globalValue?: T; defaultValue?: T; workspaceValue?: T; workspaceFolderValue?: T } | undefined): T | undefined {
    return inspected === undefined ? undefined : (inspected.globalValue ?? inspected.defaultValue);
}

/** One rule per palette type that is a semantic token type, keyed `denizen_<type>:denizenscript`. */
export function paletteRules(colors: Record<string, string>): Record<string, TokenRule> {
    const rules: Record<string, TokenRule> = {};
    for (const [type, value] of Object.entries(colors)) {
        const parsed = semanticIndex(type) < 0 ? null : parsePaletteColor(value);
        if (parsed === null) {
            continue;
        }
        const rule: TokenRule = { foreground: parsed.foreground };
        if (parsed.bold) {
            rule.bold = true;
        }
        if (parsed.italic) {
            rule.italic = true;
        }
        rules[OUR_PREFIX + type + ':denizenscript'] = rule;
    }
    return rules;
}

/**
 * The new value of `editor.semanticTokenColorCustomizations`: the user's value with our rules
 * replaced by `ours` (or removed, for null). Returns `existing` itself when nothing would change, so
 * the caller can skip a write -- which matters, because the write fires a configuration change that
 * calls back into the code that called this.
 */
export function mergeRules(existing: unknown, ours: Record<string, TokenRule> | null): unknown {
    const base = (existing !== null && typeof existing === 'object' ? existing : {}) as Record<string, unknown>;
    const oldRules = (base.rules !== null && typeof base.rules === 'object' ? base.rules : {}) as Record<string, unknown>;
    const rules: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(oldRules)) {
        if (!key.startsWith(OUR_PREFIX)) {
            rules[key] = value;
        }
    }
    Object.assign(rules, ours ?? {});
    if (JSON.stringify(sortKeys(rules)) === JSON.stringify(sortKeys(oldRules))) {
        return existing;
    }
    const result: Record<string, unknown> = { ...base, rules };
    if (Object.keys(rules).length === 0) {
        delete result.rules;
    }
    return result;
}

function sortKeys(value: Record<string, unknown>): [string, unknown][] {
    return Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
}
