// The `vscode` half of "what definitions does this script take": hover over the script name in
// `- run <script>`, and completion of the `def.<name>:` arguments that feed it. User request
// 2026-09-14. Every decision lives in ./definitionIndex, which imports no `vscode` and is
// unit-tested; this file is the wiring, the same split ./definitionValueHoverProvider uses.
//
// CLIENT-SIDE, so it works on both engines, and reusing the index ./definitionProvider already
// builds for F12 rather than a second scan of the same files.
//
// The data is the container's `definitions:` key, whose square brackets hold DOCUMENTATION rather
// than a default value -- see ScriptDefinition in definitionIndex.ts.

import * as vscode from 'vscode';
import { DenizenDefinitionIndex } from './definitionProvider';
import { ScriptDefinition, referenceAt, runDefinitionContextAt } from './definitionIndex';

/**
 * How long a workspace re-scan is reused for on the COMPLETION path.
 *
 * Hover and F12 are deliberate actions a few times an hour and refresh every time. Completion is
 * not: VS Code re-queries providers as the user keeps typing, and `refresh()` stats every `.dsc` in
 * the workspace. A stale window this short cannot be noticed by a human, and the alternative --
 * statting the workspace on every keystroke inside a `- run` line -- is exactly the kind of
 * per-keystroke work that made large files stutter.
 */
const COMPLETION_REFRESH_MS = 2000;

function renderDefinitions(scriptName: string, definitions: ScriptDefinition[]): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    const count = definitions.length;
    md.appendMarkdown(`**${scriptName}** takes ${count} definition${count === 1 ? '' : 's'}:\n`);
    for (const definition of definitions) {
        md.appendMarkdown(`\n- \`${definition.name}\``
            + (definition.description === null ? '' : ` — ${definition.description}`));
    }
    md.appendMarkdown('\n');
    md.appendCodeblock(definitions.map(d => `def.${d.name}:<value>`).join(' '), 'denizenscript');
    return md;
}

export class ScriptDefinitionsHoverProvider implements vscode.HoverProvider {
    constructor(private readonly index: DenizenDefinitionIndex) { }

    async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
        const reference = referenceAt(document.lineAt(position.line).text, position.character);
        // Flags are a different provider's business, and a container reference is the only thing
        // that names a script whose `definitions:` key could be read.
        if (reference === null || reference.kind !== 'container') {
            return undefined;
        }
        await this.index.refresh();
        const definitions = this.index.definitionsFor(reference.name);
        // A script with no `definitions:` key gets no hover rather than an empty one: most
        // containers have none, and "takes 0 definitions" on every `- run` would be noise.
        if (definitions === null) {
            return undefined;
        }
        const range = new vscode.Range(position.line, reference.startChar, position.line, reference.endChar);
        return new vscode.Hover(renderDefinitions(reference.name, definitions), range);
    }
}

export class ScriptDefinitionsCompletionProvider implements vscode.CompletionItemProvider {
    private lastRefresh = 0;

    constructor(private readonly index: DenizenDefinitionIndex) { }

    async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[]> {
        const context = runDefinitionContextAt(document.lineAt(position.line).text, position.character);
        if (context === null) {
            return [];
        }
        const now = Date.now();
        if (now - this.lastRefresh > COMPLETION_REFRESH_MS) {
            await this.index.refresh();
            this.lastRefresh = now;
        }
        const definitions = this.index.definitionsFor(context.scriptName);
        if (definitions === null) {
            return [];
        }
        // Already written on the line, so offering them again would duplicate an argument Denizen
        // would then see twice.
        const missing = definitions.filter(d => !context.present.has(d.name.toLowerCase()));
        if (missing.length === 0) {
            return [];
        }
        const range = new vscode.Range(
            position.line, position.character - context.typed.length, position.line, position.character);
        const items: vscode.CompletionItem[] = [];
        // THE WHOLE LINE AT ONCE, which is what was asked for. A snippet rather than plain text, so
        // accepting it drops the caret into the first value with the rest on tab stops.
        if (missing.length > 1 || definitions.length > 1) {
            const fillAll = new vscode.CompletionItem(
                missing.map(d => `def.${d.name}:`).join(' '), vscode.CompletionItemKind.Snippet);
            fillAll.insertText = new vscode.SnippetString(
                missing.map((d, i) => `def.${d.name}:\${${i + 1}}`).join(' '));
            fillAll.detail = `All ${missing.length} definitions of ${context.scriptName}`;
            fillAll.documentation = renderDefinitions(context.scriptName, definitions);
            fillAll.range = range;
            // Sorts above the per-name items below, which share the `def.` prefix VS Code filters on.
            fillAll.sortText = '0';
            fillAll.filterText = 'def.';
            items.push(fillAll);
        }
        for (const [i, definition] of missing.entries()) {
            const item = new vscode.CompletionItem(`def.${definition.name}:`, vscode.CompletionItemKind.Property);
            item.insertText = new vscode.SnippetString(`def.${definition.name}:\${1}`);
            item.detail = definition.description ?? `Definition of ${context.scriptName}`;
            item.range = range;
            item.sortText = `1${String(i).padStart(3, '0')}`;
            items.push(item);
        }
        return items;
    }
}

export function activateScriptDefinitions(context: vscode.ExtensionContext, index: DenizenDefinitionIndex): void {
    context.subscriptions.push(vscode.languages.registerHoverProvider(
        { language: 'denizenscript' }, new ScriptDefinitionsHoverProvider(index)));
    // '.' so `def.` re-queries, ' ' so the list appears as soon as the script name is finished.
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(
        { language: 'denizenscript' }, new ScriptDefinitionsCompletionProvider(index), '.', ' '));
}
