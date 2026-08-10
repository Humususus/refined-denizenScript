"use strict";
/**
 * Context-free command completion. Ported from the command branch of
 * DenizenLangServer/Services/TextDocumentService.cs::GetCompletionsFor.
 *
 * Phase 2A scope: command names and their documented arguments only. Tag,
 * mechanism, event, and workspace-driven completions arrive in later phases.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.provideCompletions = exports.completeCommandArguments = exports.completeCommandNames = void 0;
const vscode_languageserver_1 = require("vscode-languageserver");
const describe_1 = require("./describe");
const lineContext_1 = require("./lineContext");
/** Every command whose name starts with `partial`, as completion items carrying full docs. */
function completeCommandNames(docs, partial) {
    const results = [];
    for (const [key, command] of docs.commands) {
        if (key.startsWith(partial)) {
            results.push({
                label: key,
                kind: vscode_languageserver_1.CompletionItemKind.Method,
                detail: command.short,
                documentation: (0, describe_1.describeCommand)(command)
            });
        }
    }
    return results;
}
exports.completeCommandNames = completeCommandNames;
/** The command's documented arguments that start with `argSoFar`. Prefixed arguments gain a trailing colon. */
function completeCommandArguments(command, argSoFar) {
    const results = [];
    for (const arg of command.flatArguments) {
        if (arg.clean.startsWith(argSoFar)) {
            results.push({ label: arg.clean, kind: vscode_languageserver_1.CompletionItemKind.Field, detail: arg.raw });
        }
    }
    for (const arg of command.argPrefixes) {
        if (arg.clean.startsWith(argSoFar)) {
            results.push({ label: `${arg.clean}:`, kind: vscode_languageserver_1.CompletionItemKind.Field, detail: arg.raw });
        }
    }
    return results;
}
exports.completeCommandArguments = completeCommandArguments;
/** Entry point: what should be offered at `offset` within `text`. */
function provideCompletions(docs, text, offset) {
    const ctx = (0, lineContext_1.getLineContext)(text, offset);
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
exports.provideCompletions = provideCompletions;
//# sourceMappingURL=completionProvider.js.map