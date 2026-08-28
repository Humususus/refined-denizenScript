"use strict";
// The `vscode` half of the missing-punctuation Quick Fixes: turning a `FixPlan` into a
// `CodeAction`. Every decision lives in ./quickFixPlans, which imports no `vscode` and is
// therefore unit-tested; this file is the wiring.
//
// CLIENT-SIDE ON PURPOSE, and that is worth more than it looks. Diagnostics carry the checker's
// warning key in `Diagnostic.code`, and BOTH engines emit the same keys -- the C# sets it at
// DiagnosticProvider.cs:101 and this port at server.ts:152. So keying the actions on those codes
// makes them work under `denizenscript.server.engine: csharp` too, without touching the C# server.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateQuickFixes = exports.MissingPunctuationFixes = exports.diagnosticCode = void 0;
const vscode = __importStar(require("vscode"));
const quickFixPlans_1 = require("./quickFixPlans");
/**
 * The `code` of a diagnostic as a plain string, whatever shape it arrived in.
 *
 * LSP allows a string, a number, or a `{ value, target }` object when the server attaches a
 * documentation link. This port sends a plain string today; handling the other two costs three
 * lines and means a future `codeDescription` does not silently switch every Quick Fix off.
 */
function diagnosticCode(diagnostic) {
    const code = diagnostic.code;
    if (typeof code === 'string') {
        return code;
    }
    if (typeof code === 'number') {
        return String(code);
    }
    if (typeof code === 'object' && code !== null && 'value' in code) {
        return String(code.value);
    }
    return null;
}
exports.diagnosticCode = diagnosticCode;
class MissingPunctuationFixes {
    provideCodeActions(document, _range, context) {
        const actions = [];
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
            for (const plan of (0, quickFixPlans_1.planFixes)(code, document.lineAt(lineNumber).text)) {
                const action = new vscode.CodeAction(plan.title, vscode.CodeActionKind.QuickFix);
                action.edit = new vscode.WorkspaceEdit();
                action.edit.insert(document.uri, new vscode.Position(lineNumber, plan.character), plan.insert);
                // Attaching the diagnostic is what makes VS Code strike it through while the action
                // is previewed, and what associates the two in the Problems panel.
                action.diagnostics = [diagnostic];
                actions.push(action);
            }
        }
        return actions;
    }
}
exports.MissingPunctuationFixes = MissingPunctuationFixes;
MissingPunctuationFixes.providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];
/** Registers the Quick Fix provider. Call from `activate`. */
function activateQuickFixes(context) {
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider('denizenscript', new MissingPunctuationFixes(), { providedCodeActionKinds: MissingPunctuationFixes.providedCodeActionKinds }));
}
exports.activateQuickFixes = activateQuickFixes;
//# sourceMappingURL=quickFixes.js.map