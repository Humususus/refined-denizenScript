"use strict";
// The Denizen palette (`denizenscript.theme_colors.*`) as `editor.semanticTokenColorCustomizations`
// rules. No `vscode` import; extension.ts does the reading and writing of settings.
//
// THE SETTING BELONGS TO THE USER. The extension writes into their global settings, so it only ever
// touches rule keys that start with `denizen_` -- `enabled`, per-theme `[Theme Name]` blocks and
// every other rule are carried through untouched.
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeRules = exports.paletteRules = exports.parsePaletteColor = void 0;
const semanticEncoding_1 = require("./semanticEncoding");
/** Reads the palette's `#RRGGBB|weight=bold|style=italic` format. `background=` cannot be a token colour and is ignored. */
function parsePaletteColor(value) {
    const parts = value.split('|');
    if (!/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(parts[0])) {
        return null;
    }
    const result = { foreground: parts[0], bold: false, italic: false };
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
exports.parsePaletteColor = parsePaletteColor;
const OUR_PREFIX = 'denizen_';
/** One rule per palette type that is a semantic token type, keyed `denizen_<type>:denizenscript`. */
function paletteRules(colors) {
    const rules = {};
    for (const [type, value] of Object.entries(colors)) {
        const parsed = (0, semanticEncoding_1.semanticIndex)(type) < 0 ? null : parsePaletteColor(value);
        if (parsed === null) {
            continue;
        }
        const rule = { foreground: parsed.foreground };
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
exports.paletteRules = paletteRules;
/**
 * The new value of `editor.semanticTokenColorCustomizations`: the user's value with our rules
 * replaced by `ours` (or removed, for null). Returns `existing` itself when nothing would change, so
 * the caller can skip a write -- which matters, because the write fires a configuration change that
 * calls back into the code that called this.
 */
function mergeRules(existing, ours) {
    const base = (existing !== null && typeof existing === 'object' ? existing : {});
    const oldRules = (base.rules !== null && typeof base.rules === 'object' ? base.rules : {});
    const rules = {};
    for (const [key, value] of Object.entries(oldRules)) {
        if (!key.startsWith(OUR_PREFIX)) {
            rules[key] = value;
        }
    }
    Object.assign(rules, ours !== null && ours !== void 0 ? ours : {});
    if (JSON.stringify(sortKeys(rules)) === JSON.stringify(sortKeys(oldRules))) {
        return existing;
    }
    const result = Object.assign(Object.assign({}, base), { rules });
    if (Object.keys(rules).length === 0) {
        delete result.rules;
    }
    return result;
}
exports.mergeRules = mergeRules;
function sortKeys(value) {
    return Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
}
//# sourceMappingURL=paletteRules.js.map