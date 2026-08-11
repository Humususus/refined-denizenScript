/**
 * Context-free command completion. Ported from the command branch of
 * DenizenLangServer/Services/TextDocumentService.cs::GetCompletionsFor.
 *
 * Phase 2A scope: command names and their documented arguments only. Tag,
 * mechanism, event, and workspace-driven completions arrive in later phases.
 */

import { CompletionItem, CompletionItemKind, MarkupKind, Range, TextEdit } from 'vscode-languageserver';
import { MetaDocs, MetaCommand } from '../metaDocs/metaTypes';
import { describeCommand } from './describe';
import { parseCursorContext } from './cursorContext';
import { getLineContext } from './lineContext';
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

/**
 * Values of the enum backing this command argument, filtered by what has been typed.
 * `range` covers the entire typed argument value (not just the VS Code "current word"),
 * so accepting a dotted value like a sound name replaces all of `block.` rather than
 * leaving it in place and appending after it — see language-configuration.json's lack
 * of a wordPattern, which makes `.` and `:` break VS Code's default word boundaries.
 */
export function completeEnumValues(extra: ExtraData, commandName: string, argPrefix: string, argValue: string, range: Range): CompletionItem[] {
    const completer = findEnumCompleter(commandName, argPrefix);
    if (completer === null) {
        return [];
    }
    const results: CompletionItem[] = [];
    for (const value of completer.values(extra)) {
        if (value.startsWith(argValue)) {
            const textEdit: TextEdit = { range, newText: value };
            results.push({
                label: value,
                kind: CompletionItemKind.Enum,
                documentation: { kind: MarkupKind.Markdown, value: `**${completer.label}**: ${value}` },
                textEdit
            });
        }
    }
    return results;
}

/** Entry point: what should be offered at `offset` on `line` within `text`. */
export function provideCompletions(docs: MetaDocs, extra: ExtraData, text: string, offset: number, line: number): CompletionItem[] {
    const ctx = parseCursorContext(text, offset);
    if (ctx === null) {
        return [];
    }
    if (ctx.typingName) {
        return completeCommandNames(docs, ctx.name);
    }
    // C# merges both sources rather than choosing one (TextDocumentService.cs:362-367
    // appends the ByCommand completer's output onto the argument-name results), and the
    // order matters: argument names first, enum values after. Returning only the enum
    // results would hide a command's own arguments behind any bare-prefix enum — e.g.
    // `- give q` would list quartz items but swallow `quantity:`.
    const command = docs.commands.get(ctx.name);
    const argResults = command === undefined ? [] : completeCommandArguments(command, ctx.argThusFar);
    const lineCtx = getLineContext(text, offset);
    if (lineCtx === null) {
        // Unreachable in practice: parseCursorContext already succeeded above, and it
        // derives from the same getLineContext call over the same (text, offset).
        return argResults;
    }
    const cursorChar = lineCtx.linePrefix.length;
    const valueStart = cursorChar - ctx.argValue.length;
    const range: Range = { start: { line, character: valueStart }, end: { line, character: cursorChar } };
    return [...argResults, ...completeEnumValues(extra, ctx.name, ctx.argPrefix, ctx.argValue, range)];
}
