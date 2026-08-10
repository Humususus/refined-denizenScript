/**
 * Context-free command completion. Ported from the command branch of
 * DenizenLangServer/Services/TextDocumentService.cs::GetCompletionsFor.
 *
 * Phase 2A scope: command names and their documented arguments only. Tag,
 * mechanism, event, and workspace-driven completions arrive in later phases.
 */

import { CompletionItem, CompletionItemKind, MarkupKind } from 'vscode-languageserver';
import { MetaDocs, MetaCommand } from '../metaDocs/metaTypes';
import { describeCommand } from './describe';
import { parseCursorContext } from './cursorContext';
import { ExtraData } from '../metaDocs/extraData';
import { findEnumCompleter } from './argumentCompleters';

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

/** Values of the enum backing this command argument, filtered by what has been typed. */
export function completeEnumValues(extra: ExtraData, commandName: string, argPrefix: string, argValue: string): CompletionItem[] {
    const completer = findEnumCompleter(commandName, argPrefix);
    if (completer === null) {
        return [];
    }
    const results: CompletionItem[] = [];
    for (const value of completer.values(extra)) {
        if (value.startsWith(argValue)) {
            results.push({
                label: value,
                kind: CompletionItemKind.Enum,
                documentation: { kind: MarkupKind.Markdown, value: `**${completer.label}**: ${value}` }
            });
        }
    }
    return results;
}

/** Entry point: what should be offered at `offset` within `text`. */
export function provideCompletions(docs: MetaDocs, extra: ExtraData, text: string, offset: number): CompletionItem[] {
    const ctx = parseCursorContext(text, offset);
    if (ctx === null) {
        return [];
    }
    if (ctx.typingName) {
        return completeCommandNames(docs, ctx.name);
    }
    const enumResults = completeEnumValues(extra, ctx.name, ctx.argPrefix, ctx.argValue);
    if (enumResults.length > 0) {
        return enumResults;
    }
    const command = docs.commands.get(ctx.name);
    if (command === undefined) {
        return [];
    }
    return completeCommandArguments(command, ctx.argThusFar);
}
