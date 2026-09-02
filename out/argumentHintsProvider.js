"use strict";
// The `vscode` half of the inline argument hints: grey text at the end of the line the caret is
// on, listing the arguments the command still takes. Every decision lives in ./argumentHints,
// which imports no `vscode` and is unit-tested; this file is the wiring.
//
// INLAY HINTS RATHER THAN GHOST TEXT, chosen deliberately. Both render grey text in the line, but
// ghost text (`registerInlineCompletionItemProvider`) is ACCEPTED WITH TAB -- it competes with
// Copilot for the same key and it turns a reminder into something the user has to dismiss. Inlay
// hints are inert: they cannot be accepted, cannot be typed over, and cannot fight the user.
// This extension already has one key-hijacking feature in the separator helper; a second would be
// one too many.
//
// ONLY THE CARET'S LINE IS HINTED. An inlay hints provider is asked for a whole visible range, and
// answering for every command line in view would put grey text on thirty lines at once -- the
// noise problem that makes people turn a feature off. The question being answered is "what does
// THIS line still take", which is only ever about where the user is typing.
//
// WHERE THE SYNTAX COMES FROM. The client holds no meta, so it asks whichever language server is
// running through `vscode.executeSignatureHelpProvider` -- a built-in command, so this needs no
// new LSP request and no `vscode-languageclient` upgrade (that package is pinned at 7, which has
// no inlay-hint feature at all, which is why this cannot be server-side).
//
// ON THE C# ENGINE THERE ARE NO HINTS, and that is not a bug to fix here: its signature-help
// handler is an empty stub (TextDocumentService.cs:213-217), so the request returns nothing and
// this quietly renders nothing. The TypeScript engine implements it.
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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateArgumentHints = exports.ArgumentHintsProvider = void 0;
const vscode = __importStar(require("vscode"));
const argumentHints_1 = require("./argumentHints");
/** Reads the parameter texts out of a signature help response. */
function parametersOf(help) {
    var _a, _b, _c;
    const signature = (_a = help === null || help === void 0 ? void 0 : help.signatures) === null || _a === void 0 ? void 0 : _a[(_b = help.activeSignature) !== null && _b !== void 0 ? _b : 0];
    if (signature === undefined) {
        return [];
    }
    const label = signature.label;
    const texts = [];
    for (const parameter of (_c = signature.parameters) !== null && _c !== void 0 ? _c : []) {
        // LSP allows either the literal text or an offset pair into the signature label. The
        // TypeScript server sends offsets (signatureHelpProvider.ts), but a client-side converter
        // is free to hand back either, so both are read.
        texts.push(typeof parameter.label === 'string'
            ? parameter.label
            : label.substring(parameter.label[0], parameter.label[1]));
    }
    return texts.map(argumentHints_1.parseSyntaxParameter);
}
class ArgumentHintsProvider {
    constructor() {
        this.changed = new vscode.EventEmitter();
        this.onDidChangeInlayHints = this.changed.event;
    }
    /** Re-asks VS Code for hints. Called when the caret moves, since the hinted line moves with it. */
    refresh() {
        this.changed.fire();
    }
    provideInlayHints(document, range) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!vscode.workspace.getConfiguration('denizenscript').get('inlineArgumentHints', true)) {
                return [];
            }
            const editor = vscode.window.activeTextEditor;
            if (editor === undefined || editor.document.uri.toString() !== document.uri.toString()) {
                return [];
            }
            // Multi-cursor has no single "the line I am typing on", so it is left alone.
            if (editor.selections.length !== 1) {
                return [];
            }
            const position = editor.selection.active;
            if (position.line < range.start.line || position.line > range.end.line) {
                return [];
            }
            const lineText = document.lineAt(position.line).text;
            // Only a command line has documented arguments. Bail before the signature request rather
            // than after it, so an ordinary key line costs nothing.
            if (!/^\s*-\s+\S/.test(lineText)) {
                return [];
            }
            const help = yield vscode.commands.executeCommand('vscode.executeSignatureHelpProvider', document.uri, new vscode.Position(position.line, lineText.length));
            const parameters = parametersOf(help);
            if (parameters.length === 0) {
                return [];
            }
            const text = (0, argumentHints_1.hintTextFor)(parameters, lineText.slice(0, position.character));
            if (text === null) {
                return [];
            }
            // Anchored at the end of the LINE, not at the caret: a hint that sits mid-line pushes the
            // text the user is reading sideways as they type.
            const hint = new vscode.InlayHint(new vscode.Position(position.line, lineText.length), ` ${text}`);
            hint.paddingLeft = true;
            hint.tooltip = new vscode.MarkdownString('Arguments this command still accepts.\n\nTurn off with `denizenscript.inlineArgumentHints`.');
            return [hint];
        });
    }
}
exports.ArgumentHintsProvider = ArgumentHintsProvider;
function activateArgumentHints(context) {
    const provider = new ArgumentHintsProvider();
    context.subscriptions.push(vscode.languages.registerInlayHintsProvider({ language: 'denizenscript' }, provider));
    // The hinted line is wherever the caret is, so it has to be re-asked when the caret moves.
    // Debounced: cursor events fire on every arrow key, and each refresh costs a signature request.
    let pending;
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(event => {
        if (event.textEditor.document.languageId !== 'denizenscript') {
            return;
        }
        if (pending !== undefined) {
            clearTimeout(pending);
        }
        pending = setTimeout(() => provider.refresh(), 120);
    }));
}
exports.activateArgumentHints = activateArgumentHints;
//# sourceMappingURL=argumentHintsProvider.js.map