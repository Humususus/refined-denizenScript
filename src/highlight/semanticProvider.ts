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

import * as vscode from 'vscode';
import { HighlightOptions } from './denizenHighlighter';
import { SEMANTIC_TYPES, buildSemanticTokens } from './semanticEncoding';
import { perf } from '../perfStats';
import { SCHEME as MAP_TAG_SCHEME } from '../mapTagPeek';

export const SEMANTIC_LEGEND = new vscode.SemanticTokensLegend([...SEMANTIC_TYPES]);

export class DenizenSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
    private enabled = false;
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChangeSemanticTokens = this.changed.event;

    constructor(private readonly options: () => HighlightOptions) {}

    /** Palette on or off. Re-asks VS Code for tokens so open editors recolour without a reload. */
    setEnabled(on: boolean): void {
        if (on !== this.enabled) {
            this.enabled = on;
            this.changed.fire();
        }
    }

    /** The palette colours changed while it stayed on: tokens are the same, but re-ask anyway. */
    refresh(): void {
        this.changed.fire();
    }

    provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.SemanticTokens {
        if (!this.enabled) {
            return new vscode.SemanticTokens(new Uint32Array(0));
        }
        return perf.time('semantic.provide', () => new vscode.SemanticTokens(buildSemanticTokens(document.getText().split('\n'), this.options(), document.uri.scheme === MAP_TAG_SCHEME)));
    }
}
