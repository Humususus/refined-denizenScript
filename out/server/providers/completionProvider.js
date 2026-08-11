"use strict";
/**
 * Context-free command completion. Ported from the command branch of
 * DenizenLangServer/Services/TextDocumentService.cs::GetCompletionsFor.
 *
 * Phase 2A scope: command names and their documented arguments only. Tag,
 * mechanism, event, and workspace-driven completions arrive in later phases.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.provideCompletions = exports.completeEnumValues = exports.completeCommandArguments = exports.completeCommandNames = void 0;
const vscode_languageserver_1 = require("vscode-languageserver");
const describe_1 = require("./describe");
const cursorContext_1 = require("./cursorContext");
const argumentCompleters_1 = require("./argumentCompleters");
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
/**
 * Values of the enum backing this command argument, filtered by what has been typed.
 * `range` covers the entire typed argument value (not just the VS Code "current word"),
 * so accepting a dotted value like a sound name replaces all of `block.` rather than
 * leaving it in place and appending after it — see language-configuration.json's lack
 * of a wordPattern, which makes `.` and `:` break VS Code's default word boundaries.
 */
function completeEnumValues(extra, commandName, argPrefix, argValue, range) {
    const completers = (0, argumentCompleters_1.findEnumCompleters)(commandName, argPrefix);
    const results = [];
    for (const completer of completers) {
        for (const value of completer.values(extra)) {
            if (value.startsWith(argValue)) {
                const textEdit = { range, newText: value };
                const item = {
                    label: value,
                    kind: vscode_languageserver_1.CompletionItemKind.Enum,
                    textEdit
                };
                // Some registrations (e.g. `determine`) intentionally carry no enum
                // label, meaning no documentation should be attached — see
                // CommandTabCompletions.cs's `key == null ? null : ...` in CompleteEnum.
                if (completer.label !== null) {
                    item.documentation = { kind: vscode_languageserver_1.MarkupKind.Markdown, value: `**${completer.label}**: ${value}` };
                }
                results.push(item);
            }
        }
    }
    return results;
}
exports.completeEnumValues = completeEnumValues;
/** Entry point: what should be offered at `offset` on `line` within `text`. */
function provideCompletions(docs, extra, text, offset, line) {
    const ctx = (0, cursorContext_1.parseCursorContext)(text, offset);
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
    // Start of the value within argThusFar: argThusFar may still carry a `prefix:`
    // that argValue does not, so the difference in their lengths is exactly how far
    // into argThusFar (from ctx.argStart) the value itself begins.
    const valueStart = ctx.argStart + (ctx.argThusFar.length - ctx.argValue.length);
    const range = { start: { line, character: valueStart }, end: { line, character: ctx.argEnd } };
    return [...argResults, ...completeEnumValues(extra, ctx.name, ctx.argPrefix, ctx.argValue, range)];
}
exports.provideCompletions = provideCompletions;
//# sourceMappingURL=completionProvider.js.map