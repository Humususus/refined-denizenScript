/**
 * Context-free command completion. Ported from the command branch of
 * DenizenLangServer/Services/TextDocumentService.cs::GetCompletionsFor.
 *
 * Phase 2A scope: command names and their documented arguments only. Tag,
 * mechanism, event, and workspace-driven completions arrive in later phases.
 */

import { CompletionItem, CompletionItemKind } from 'vscode-languageserver';
import { MetaDocs, MetaCommand } from '../metaDocs/metaTypes';
import { describeCommand } from './describe';
import { getLineContext } from './lineContext';

/** Every command whose name starts with `partial`, as completion items carrying full docs. */
export function completeCommandNames(docs: MetaDocs, partial: string): CompletionItem[] {
    const results: CompletionItem[] = [];
    for (const [key, command] of docs.commands) {
        if (key.startsWith(partial)) {
            results.push({
                label: key,
                kind: CompletionItemKind.Method,
                detail: command.short,
                documentation: describeCommand(command)
            });
        }
    }
    return results;
}

/** The command's documented arguments that start with `argSoFar`. Prefixed arguments gain a trailing colon. */
export function completeCommandArguments(command: MetaCommand, argSoFar: string): CompletionItem[] {
    const results: CompletionItem[] = [];
    for (const arg of command.flatArguments) {
        if (arg.clean.startsWith(argSoFar)) {
            results.push({ label: arg.clean, kind: CompletionItemKind.Field, detail: arg.raw });
        }
    }
    for (const arg of command.argPrefixes) {
        if (arg.clean.startsWith(argSoFar)) {
            results.push({ label: `${arg.clean}:`, kind: CompletionItemKind.Field, detail: arg.raw });
        }
    }
    return results;
}

/** Entry point: what should be offered at `offset` within `text`. */
export function provideCompletions(docs: MetaDocs, text: string, offset: number): CompletionItem[] {
    const ctx = getLineContext(text, offset);
    if (ctx === null || !ctx.trimmed.startsWith('- ')) {
        return [];
    }
    let afterDash = ctx.trimmed.substring(2);
    if (afterDash.startsWith('~')) {
        afterDash = afterDash.substring(1);
    }
    const firstSpace = afterDash.indexOf(' ');
    if (firstSpace === -1) {
        return completeCommandNames(docs, afterDash);
    }
    const command = docs.commands.get(afterDash.substring(0, firstSpace));
    if (command === undefined) {
        return [];
    }
    return completeCommandArguments(command, afterDash.substring(afterDash.lastIndexOf(' ') + 1));
}
