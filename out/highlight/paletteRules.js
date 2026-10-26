"use strict";
// The Denizen palette (`denizenscript.theme_colors.*`) as `editor.semanticTokenColorCustomizations`
// rules. No `vscode` import; extension.ts does the reading and writing of settings.
//
// THE SETTING BELONGS TO THE USER. The extension writes into their global settings, so it only ever
// touches rule keys that start with `denizen_` -- `enabled`, per-theme `[Theme Name]` blocks and
// every other rule are carried through untouched.
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeTextMateRules = exports.textMateRules = exports.TEXTMATE_SCOPES = exports.mergeRules = exports.paletteRules = exports.userLevel = exports.parsePaletteColor = void 0;
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
/**
 * A setting's USER-level value (global, else default), from `WorkspaceConfiguration.inspect`.
 * Workspace and folder overrides are ignored on purpose: the rules this feeds are written to user
 * settings, shared by every open window, so they must be computed the same way in all of them --
 * otherwise two windows with different workspace palettes rewrite each other's settings forever.
 */
function userLevel(inspected) {
    var _a;
    return inspected === undefined ? undefined : ((_a = inspected.globalValue) !== null && _a !== void 0 ? _a : inspected.defaultValue);
}
exports.userLevel = userLevel;
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
// ---------------------------------------------------------------------------------------------
// The same palette for the TextMate grammar (`editor.tokenColorCustomizations.textMateRules`).
//
// WHY BOTH. Reported 2026-10-26: typed text first showed the THEME's colour and switched to the
// palette's with a visible delay. The grammar colours instantly; semantic tokens come only when
// VS Code asks for them, at least 300 ms after the last keystroke, and an extension cannot make it
// ask sooner. Giving the grammar's scopes the palette colours makes the instant layer already
// right; the tokens then only refine what the grammar draws more coarsely.
//
// Narrower scopes win over broader ones in TextMate, so `normal` can sit on the whole command and
// value scopes while `support.function` (the command name) inside them keeps its own colour.
// ---------------------------------------------------------------------------------------------
/** Grammar scopes per palette type. Every scope ends in `.denizenscript`: nothing else is touched. */
exports.TEXTMATE_SCOPES = {
    comment_normal: ['comment.line.number-sign.denizenscript'],
    comment_warning: ['comment.line.warning.denizenscript'],
    comment_critical: ['comment.line.critical.denizenscript'],
    comment_code: ['comment.line.code.denizenscript'],
    comment_todo: ['comment.line.todo.denizenscript'],
    comment_header: ['comment.line.header.denizenscript'],
    key: ['entity.name.section.denizenscript'],
    key_inline: ['meta.mapping.key.denizenscript'],
    command: ['support.function.denizenscript'],
    quote_double: ['string.quoted.double.denizenscript'],
    quote_single: ['string.quoted.single.denizenscript'],
    def_name: ['variable.other.definition.denizenscript'],
    event_line: ['meta.event.denizenscript'],
    event_switch: ['meta.event.switch.denizenscript'],
    tag: ['meta.tag.denizenscript', 'entity.name.function.denizenscript'],
    tag_param: ['variable.parameter.denizenscript'],
    tag_dot: ['punctuation.separator.period.denizenscript'],
    tag_param_bracket: ['punctuation.definition.arguments.begin.denizenscript', 'punctuation.definition.arguments.end.denizenscript'],
    colons: ['punctuation.separator.key-value.denizenscript'],
    if_operators: ['keyword.operator.denizenscript'],
    normal: ['meta.command.denizenscript', 'meta.mapping.value.denizenscript'],
};
const OUR_RULE_NAME = 'denizen-palette:';
/** One rule per palette type with grammar scopes, named `denizen-palette:<type>` so it can be found again. */
function textMateRules(colors) {
    const rules = [];
    for (const [type, scope] of Object.entries(exports.TEXTMATE_SCOPES)) {
        const parsed = colors[type] === undefined ? null : parsePaletteColor(colors[type]);
        if (parsed === null) {
            continue;
        }
        // An explicit '' rather than leaving it out: a theme that italicises, say, strings must
        // not leak that into palette text the palette draws upright.
        const fontStyle = [parsed.bold ? 'bold' : '', parsed.italic ? 'italic' : ''].filter(s => s !== '').join(' ');
        rules.push({ name: OUR_RULE_NAME + type, scope, settings: { foreground: parsed.foreground, fontStyle } });
    }
    return rules;
}
exports.textMateRules = textMateRules;
/**
 * The new value of `editor.tokenColorCustomizations`: the user's value with our named rules replaced
 * by `ours` (or removed, for null). Every other key and rule is kept in place. Returns `existing`
 * itself when nothing would change, for the same write-loop reason as `mergeRules`.
 */
function mergeTextMateRules(existing, ours) {
    const base = (existing !== null && typeof existing === 'object' ? existing : {});
    const oldRules = Array.isArray(base.textMateRules) ? base.textMateRules : [];
    const isOurs = (rule) => typeof (rule === null || rule === void 0 ? void 0 : rule.name) === 'string'
        && (rule.name).startsWith(OUR_RULE_NAME);
    const rules = [...oldRules.filter(rule => !isOurs(rule)), ...(ours !== null && ours !== void 0 ? ours : [])];
    if (JSON.stringify(rules) === JSON.stringify(oldRules)) {
        return existing;
    }
    const result = Object.assign(Object.assign({}, base), { textMateRules: rules });
    if (rules.length === 0) {
        delete result.textMateRules;
    }
    return result;
}
exports.mergeTextMateRules = mergeTextMateRules;
//# sourceMappingURL=paletteRules.js.map