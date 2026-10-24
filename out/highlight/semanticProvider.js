"use strict";
// The Denizen palette as semantic tokens -- the `vscode` half; every decision lives in
// ./semanticEncoding and ./denizenHighlighter.
//
// WHY THIS REPLACED THE PALETTE DECORATIONS (R3). As decorations, a 3371-line file carried ~50 800
// coloured ranges and every keystroke re-sent all of them to the renderer; scrolling and typing
// stuttered (perf-baseline.md, run B). Semantic tokens are a compact integer array that VS Code
// diffs and renders only for the visible part of the file.
//
// THEME MODE PROVIDES NOTHING. With the palette off, the TextMate grammar colours by the active
// theme exactly as it always has; tokens would only override that.
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
exports.DenizenSemanticTokensProvider = exports.SEMANTIC_LEGEND = void 0;
const vscode = __importStar(require("vscode"));
const semanticEncoding_1 = require("./semanticEncoding");
const perfStats_1 = require("../perfStats");
exports.SEMANTIC_LEGEND = new vscode.SemanticTokensLegend([...semanticEncoding_1.SEMANTIC_TYPES]);
class DenizenSemanticTokensProvider {
    constructor(options) {
        this.options = options;
        this.enabled = false;
        this.changed = new vscode.EventEmitter();
        this.onDidChangeSemanticTokens = this.changed.event;
    }
    /** Palette on or off. Re-asks VS Code for tokens so open editors recolour without a reload. */
    setEnabled(on) {
        if (on !== this.enabled) {
            this.enabled = on;
            this.changed.fire();
        }
    }
    /** The palette colours changed while it stayed on: tokens are the same, but re-ask anyway. */
    refresh() {
        this.changed.fire();
    }
    provideDocumentSemanticTokens(document) {
        if (!this.enabled) {
            return new vscode.SemanticTokens(new Uint32Array(0));
        }
        return perfStats_1.perf.time('semantic.provide', () => new vscode.SemanticTokens((0, semanticEncoding_1.buildSemanticTokens)(document.getText().split('\n'), this.options())));
    }
}
exports.DenizenSemanticTokensProvider = DenizenSemanticTokensProvider;
//# sourceMappingURL=semanticProvider.js.map