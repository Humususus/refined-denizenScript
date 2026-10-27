"use strict";
// Completions that read the container around the cursor, or the meta's prose (R9, spec items 8-10).
// No `vscode` import: every function takes the text and returns LSP items, so each is unit-tested.
// Every list comes from the meta -- the user's standing rule is "no hardcoded lists".
Object.defineProperty(exports, "__esModule", { value: true });
exports.completeEntityMechanisms = exports.completeEntityScripts = exports.completeScriptType = exports.containerAt = exports.completeDataAction = exports.parseDataActions = void 0;
const vscode_languageserver_1 = require("vscode-languageserver");
/**
 * The data actions, read from the meta's `data actions` language: its lines read
 * `Increment: '++': raises the value numerically up by 1. Example: - define x:++`, grouped under
 * "Actions that take no input value" and "Actions that take an input value". Empty when the meta
 * has no such block, so a meta without it offers nothing rather than a stale copy.
 */
function parseDataActions(docs) {
    var _a, _b;
    const language = docs.languages.get('data actions');
    if (language === undefined || typeof language.description !== 'string') {
        return [];
    }
    const actions = [];
    let takesValue = null;
    for (const raw of language.description.split('\n')) {
        const line = raw.trim();
        if (/^actions that take no input value/i.test(line)) {
            takesValue = false;
            continue;
        }
        if (/^actions that take an input value/i.test(line)) {
            takesValue = true;
            continue;
        }
        if (/^special cases/i.test(line)) {
            takesValue = null;
            continue;
        }
        const match = /^([A-Za-z][A-Za-z ]*): '([^']+)': (.+?)(?: Example: (.+))?$/.exec(line);
        if (takesValue !== null && match !== null) {
            actions.push({ name: match[1], symbol: match[2], description: match[3].trim(), example: (_b = (_a = match[4]) === null || _a === void 0 ? void 0 : _a.trim()) !== null && _b !== void 0 ? _b : null, takesValue });
        }
    }
    return actions;
}
exports.parseDataActions = parseDataActions;
/** A key, optionally indexed (`list[3]`), then `:` and only action characters typed so far. */
const ACTION_ARGUMENT = /^([^\s:<>[\]]+(?:\[[^\]]*\])?):([-+*/<>|!]*)$/;
/**
 * Data actions after `- define name:` (argument 0) and `- flag <object> name:` (argument 1 or
 * later, not `expire:`). The meta's syntax lines confirm both: `define [<id>](:<action>)[:<value>]`
 * and `flag [<object>|...] [<name>([<#>])](:<action>)[:<value>]`. Null when this is not such a
 * place, so the caller's other branches run.
 */
function completeDataAction(docs, ctx, line) {
    const isDefine = ctx.name === 'define' && ctx.argIndex === 0;
    const isFlag = ctx.name === 'flag' && ctx.argIndex >= 1 && ctx.argPrefix !== 'expire';
    if (!isDefine && !isFlag) {
        return null;
    }
    const match = ACTION_ARGUMENT.exec(ctx.argThusFar);
    if (match === null) {
        return null;
    }
    const typed = match[2];
    // A lone `<` opens a tag far more often than it starts `<-:` -- and `<` is a trigger character,
    // so answering it here hid tag completion on `- define x:<` (final review, R9). `<-` still
    // offers `<-:`, since `-` is a trigger character too.
    if (typed === '<') {
        return null;
    }
    const from = ctx.argStart + match[1].length + 1;
    const range = { start: { line, character: from }, end: { line, character: ctx.argEnd } };
    const actions = parseDataActions(docs);
    const items = [];
    actions.forEach((action, index) => {
        const label = action.takesValue ? `${action.symbol}:` : action.symbol;
        if (!label.startsWith(typed)) {
            return;
        }
        items.push({
            label,
            kind: vscode_languageserver_1.CompletionItemKind.Operator,
            detail: action.name,
            documentation: { kind: vscode_languageserver_1.MarkupKind.Markdown, value: `**${action.name}**: ${action.description}${action.example ? `\n\nExample: \`${action.example}\`` : ''}` },
            sortText: String(index).padStart(2, '0'),
            textEdit: { range, newText: label },
        });
    });
    return items.length > 0 ? items : null;
}
exports.completeDataAction = completeDataAction;
function indentOf(line) {
    return line.length - line.trimStart().length;
}
function isContent(line) {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith('#');
}
/** Walks up from `line` (whose indentation is `indent`) to its parent key and its container. */
function containerAt(lines, line, indent) {
    if (indent === 0) {
        return null;
    }
    let parentKey = null;
    let parentIsContainer = false;
    let parentFound = false;
    let containerLine = -1;
    for (let i = line - 1; i >= 0; i--) {
        const text = lines[i].replace(/\r$/, '');
        if (!isContent(text)) {
            continue;
        }
        const ind = indentOf(text);
        if (!parentFound && ind < indent) {
            parentFound = true;
            const trimmed = text.trim();
            parentKey = trimmed.endsWith(':') ? trimmed.slice(0, -1).toLowerCase() : null;
            parentIsContainer = ind === 0;
        }
        if (ind === 0) {
            containerLine = i;
            break;
        }
    }
    if (containerLine === -1 || !lines[containerLine].trim().endsWith(':')) {
        return null;
    }
    const name = lines[containerLine].trim().slice(0, -1).toLowerCase();
    let type = null;
    let childIndent = -1;
    for (let i = containerLine + 1; i < lines.length; i++) {
        const text = lines[i].replace(/\r$/, '');
        if (!isContent(text)) {
            continue;
        }
        const ind = indentOf(text);
        if (ind === 0) {
            break;
        }
        if (childIndent === -1) {
            childIndent = ind;
        }
        const match = /^type:\s*(\S+)\s*$/i.exec(text.trim());
        if (ind === childIndent && match !== null && i !== line) {
            type = match[1].toLowerCase();
            break;
        }
    }
    return { name, type, parentKey, parentIsContainer };
}
exports.containerAt = containerAt;
/**
 * Container types for a container's own `type:` line (spec 9): every `<x>` the meta documents as
 * an `<x> script containers` language, with its first paragraph, plus the checker's known types
 * (KNOWN_SCRIPT_TYPES has `dialog`, which the meta does not document).
 */
function completeScriptType(docs, knownTypes, typed, range) {
    const described = new Map();
    for (const [key, language] of docs.languages) {
        const match = /^(.+) script containers$/.exec(key);
        if (match !== null && typeof language.description === 'string') {
            described.set(match[1], language.description.split(/\n\s*\n/)[0].replace(/\s*\n\s*/g, ' ').trim());
        }
    }
    const types = new Set([...described.keys(), ...knownTypes]);
    return [...types].sort().filter(t => t.startsWith(typed)).map(t => {
        const doc = described.get(t);
        const item = { label: t, kind: vscode_languageserver_1.CompletionItemKind.Class, textEdit: { range, newText: t } };
        if (doc !== undefined) {
            item.documentation = { kind: vscode_languageserver_1.MarkupKind.Markdown, value: doc };
        }
        return item;
    });
}
exports.completeScriptType = completeScriptType;
/** Entity scripts from the workspace for `entity_type:` (spec 10), minus the container being written. */
function completeEntityScripts(scripts, ownName, typed, range) {
    const names = [...scripts].filter(s => s.type === 'entity' && s.name !== ownName && s.name.startsWith(typed)).map(s => s.name).sort();
    return names.map(name => ({ label: name, kind: vscode_languageserver_1.CompletionItemKind.Reference, detail: 'Entity script', textEdit: { range, newText: name } }));
}
exports.completeEntityScripts = completeEntityScripts;
/**
 * EntityTag mechanisms as keys under an entity container's `mechanisms:` (spec 10). Properties
 * are included: they register as mechanisms too. Not narrowed by `entity_type` -- the meta does not
 * say which entity types a mechanism applies to.
 */
function completeEntityMechanisms(docs, typed, range) {
    var _a, _b, _c;
    const seen = new Map();
    for (const mech of docs.mechanisms.values()) {
        const name = (_a = mech.mechName) === null || _a === void 0 ? void 0 : _a.toLowerCase();
        if (((_b = mech.mechObject) === null || _b === void 0 ? void 0 : _b.toLowerCase()) !== 'entitytag' || !name || !name.startsWith(typed) || seen.has(name)) {
            continue;
        }
        const input = mech.input ? `Input: \`${mech.input}\`\n\n` : '';
        seen.set(name, {
            label: name,
            kind: vscode_languageserver_1.CompletionItemKind.Property,
            detail: 'EntityTag mechanism',
            documentation: { kind: vscode_languageserver_1.MarkupKind.Markdown, value: `${input}${(_c = mech.description) !== null && _c !== void 0 ? _c : ''}` },
            textEdit: { range, newText: `${name}: ` },
        });
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}
exports.completeEntityMechanisms = completeEntityMechanisms;
//# sourceMappingURL=containerCompleters.js.map