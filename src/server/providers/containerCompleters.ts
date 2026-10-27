// Completions that read the container around the cursor, or the meta's prose (R9, spec items 8-10).
// No `vscode` import: every function takes the text and returns LSP items, so each is unit-tested.
// Every list comes from the meta -- the user's standing rule is "no hardcoded lists".

import { CompletionItem, CompletionItemKind, MarkupKind, Range } from 'vscode-languageserver';
import { MetaDocs } from '../metaDocs/metaTypes';
import { CommandCursorContext } from './cursorContext';

export interface DataAction {
    /** `++`, `->`, `|`, … */
    symbol: string;
    /** `Increment`, `List insert`, … */
    name: string;
    description: string;
    example: string | null;
    /** Whether a `:<value>` follows the action. */
    takesValue: boolean;
}

/**
 * The data actions, read from the meta's `data actions` language: its lines read
 * `Increment: '++': raises the value numerically up by 1. Example: - define x:++`, grouped under
 * "Actions that take no input value" and "Actions that take an input value". Empty when the meta
 * has no such block, so a meta without it offers nothing rather than a stale copy.
 */
export function parseDataActions(docs: MetaDocs): DataAction[] {
    const language = docs.languages.get('data actions');
    if (language === undefined || typeof language.description !== 'string') {
        return [];
    }
    const actions: DataAction[] = [];
    let takesValue: boolean | null = null;
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
            actions.push({ name: match[1], symbol: match[2], description: match[3].trim(), example: match[4]?.trim() ?? null, takesValue });
        }
    }
    return actions;
}

/** A key, optionally indexed (`list[3]`), then `:` and only action characters typed so far. */
const ACTION_ARGUMENT = /^([^\s:<>[\]]+(?:\[[^\]]*\])?):([-+*/<>|!]*)$/;

/**
 * Data actions after `- define name:` (argument 0) and `- flag <object> name:` (argument 1 or
 * later, not `expire:`). The meta's syntax lines confirm both: `define [<id>](:<action>)[:<value>]`
 * and `flag [<object>|...] [<name>([<#>])](:<action>)[:<value>]`. Null when this is not such a
 * place, so the caller's other branches run.
 */
export function completeDataAction(docs: MetaDocs, ctx: CommandCursorContext, line: number): CompletionItem[] | null {
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
    const from = ctx.argStart + match[1].length + 1;
    const range: Range = { start: { line, character: from }, end: { line, character: ctx.argEnd } };
    const actions = parseDataActions(docs);
    const items: CompletionItem[] = [];
    actions.forEach((action, index) => {
        const label = action.takesValue ? `${action.symbol}:` : action.symbol;
        if (!label.startsWith(typed)) {
            return;
        }
        items.push({
            label,
            kind: CompletionItemKind.Operator,
            detail: action.name,
            documentation: { kind: MarkupKind.Markdown, value: `**${action.name}**: ${action.description}${action.example ? `\n\nExample: \`${action.example}\`` : ''}` },
            sortText: String(index).padStart(2, '0'),
            textEdit: { range, newText: label },
        });
    });
    return items.length > 0 ? items : null;
}

/** Where a line sits: its container and that container's `type:`, and the key it is directly under. */
export interface ContainerPlace {
    /** The container's name, lowercased (its column-0 key). */
    name: string;
    /** The container's `type:` value, lowercased, or null if none is written. */
    type: string | null;
    /** The key line the cursor line is directly under, lowercased without its colon, or null. */
    parentKey: string | null;
    /** Whether that parent is the container line itself. */
    parentIsContainer: boolean;
}

function indentOf(line: string): number {
    return line.length - line.trimStart().length;
}

function isContent(line: string): boolean {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith('#');
}

/** Walks up from `line` (whose indentation is `indent`) to its parent key and its container. */
export function containerAt(lines: string[], line: number, indent: number): ContainerPlace | null {
    if (indent === 0) {
        return null;
    }
    let parentKey: string | null = null;
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
    let type: string | null = null;
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

/**
 * Container types for a container's own `type:` line (spec 9): every `<x>` the meta documents as
 * an `<x> script containers` language, with its first paragraph, plus the checker's known types
 * (KNOWN_SCRIPT_TYPES has `dialog`, which the meta does not document).
 */
export function completeScriptType(docs: MetaDocs, knownTypes: Iterable<string>, typed: string, range: Range): CompletionItem[] {
    const described = new Map<string, string>();
    for (const [key, language] of docs.languages) {
        const match = /^(.+) script containers$/.exec(key);
        if (match !== null && typeof language.description === 'string') {
            described.set(match[1], language.description.split(/\n\s*\n/)[0].replace(/\s*\n\s*/g, ' ').trim());
        }
    }
    const types = new Set<string>([...described.keys(), ...knownTypes]);
    return [...types].sort().filter(t => t.startsWith(typed)).map(t => {
        const doc = described.get(t);
        const item: CompletionItem = { label: t, kind: CompletionItemKind.Class, textEdit: { range, newText: t } };
        if (doc !== undefined) {
            item.documentation = { kind: MarkupKind.Markdown, value: doc };
        }
        return item;
    });
}

/** Entity scripts from the workspace for `entity_type:` (spec 10), minus the container being written. */
export function completeEntityScripts(scripts: Iterable<{ name: string; type: string }>, ownName: string, typed: string, range: Range): CompletionItem[] {
    const names = [...scripts].filter(s => s.type === 'entity' && s.name !== ownName && s.name.startsWith(typed)).map(s => s.name).sort();
    return names.map(name => ({ label: name, kind: CompletionItemKind.Reference, detail: 'Entity script', textEdit: { range, newText: name } }));
}

/**
 * EntityTag mechanisms as keys under an entity container's `mechanisms:` (spec 10). Properties
 * are included: they register as mechanisms too. Not narrowed by `entity_type` -- the meta does not
 * say which entity types a mechanism applies to.
 */
export function completeEntityMechanisms(docs: MetaDocs, typed: string, range: Range): CompletionItem[] {
    const seen = new Map<string, CompletionItem>();
    for (const mech of docs.mechanisms.values()) {
        const name = mech.mechName?.toLowerCase();
        if (mech.mechObject?.toLowerCase() !== 'entitytag' || !name || !name.startsWith(typed) || seen.has(name)) {
            continue;
        }
        const input = mech.input ? `Input: \`${mech.input}\`\n\n` : '';
        seen.set(name, {
            label: name,
            kind: CompletionItemKind.Property,
            detail: 'EntityTag mechanism',
            documentation: { kind: MarkupKind.Markdown, value: `${input}${mech.description ?? ''}` },
            textEdit: { range, newText: `${name}: ` },
        });
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}
