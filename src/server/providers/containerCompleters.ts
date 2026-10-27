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
