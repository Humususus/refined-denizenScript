// The `vscode` half of the missing-punctuation Quick Fixes: turning a `FixPlan` into a
// `CodeAction`. Every decision lives in ./quickFixPlans, which imports no `vscode` and is
// therefore unit-tested; this file is the wiring.
//
// CLIENT-SIDE ON PURPOSE, and that is worth more than it looks. Diagnostics carry the checker's
// warning key in `Diagnostic.code`, and BOTH engines emit the same keys -- the C# sets it at
// DiagnosticProvider.cs:101 and this port at server.ts:152. So keying the actions on those codes
// makes them work under `denizenscript.server.engine: csharp` too, without touching the C# server.

import * as vscode from 'vscode';
import { planFixes } from './quickFixPlans';

/**
 * The `code` of a diagnostic as a plain string, whatever shape it arrived in.
 *
 * LSP allows a string, a number, or a `{ value, target }` object when the server attaches a
 * documentation link. This port sends a plain string today; handling the other two costs three
 * lines and means a future `codeDescription` does not silently switch every Quick Fix off.
 */
export function diagnosticCode(diagnostic: vscode.Diagnostic): string | null {
    const code = diagnostic.code;
    if (typeof code === 'string') {
        return code;
    }
    if (typeof code === 'number') {
        return String(code);
    }
    if (typeof code === 'object' && code !== null && 'value' in code) {
        return String((code as { value: string | number }).value);
    }
    return null;
}

export class MissingPunctuationFixes implements vscode.CodeActionProvider {
    static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

    provideCodeActions(document: vscode.TextDocument, _range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];
        for (const diagnostic of context.diagnostics) {
            const code = diagnosticCode(diagnostic);
            if (code === null) {
                continue;
            }
            const lineNumber = diagnostic.range.start.line;
            // A diagnostic can outlive the edit that shortened the file, so this is a real guard
            // rather than a defensive one: `lineAt` past the end throws.
            if (lineNumber < 0 || lineNumber >= document.lineCount) {
                continue;
            }
            // The message and columns are passed for the codes that need more than the line --
            // today only `deprecated_tag_part`, whose message names the replacement and whose range
            // is exactly the tag part to rewrite. A multi-line diagnostic would make `endCharacter`
            // meaningless, so those are skipped rather than mis-measured.
            const context_ = diagnostic.range.start.line === diagnostic.range.end.line
                ? { message: diagnostic.message, startCharacter: diagnostic.range.start.character, endCharacter: diagnostic.range.end.character }
                : undefined;
            for (const plan of planFixes(code, document.lineAt(lineNumber).text, context_)) {
                const action = new vscode.CodeAction(plan.title, vscode.CodeActionKind.QuickFix);
                action.edit = new vscode.WorkspaceEdit();
                const at = new vscode.Position(lineNumber, plan.character);
                if (plan.replace > 0) {
                    action.edit.replace(document.uri, new vscode.Range(at, new vscode.Position(lineNumber, plan.character + plan.replace)), plan.insert);
                }
                else {
                    action.edit.insert(document.uri, at, plan.insert);
                }
                // Attaching the diagnostic is what makes VS Code strike it through while the action
                // is previewed, and what associates the two in the Problems panel.
                action.diagnostics = [diagnostic];
                actions.push(action);
            }
        }
        return actions;
    }
}

/** Registers the Quick Fix provider. Call from `activate`. */
export function activateQuickFixes(context: vscode.ExtensionContext): void {
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider(
        'denizenscript',
        new MissingPunctuationFixes(),
        { providedCodeActionKinds: MissingPunctuationFixes.providedCodeActionKinds }
    ));
}
