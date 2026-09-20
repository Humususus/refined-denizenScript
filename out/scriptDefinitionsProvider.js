"use strict";
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
exports.activateScriptDefinitions = exports.ScriptNameCompletionProvider = exports.ScriptDefinitionsCompletionProvider = exports.ScriptDefinitionsHoverProvider = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const definitionIndex_1 = require("./definitionIndex");
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
function renderDefinitions(scriptName, definitions) {
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
class ScriptDefinitionsHoverProvider {
    constructor(index) {
        this.index = index;
    }
    provideHover(document, position) {
        return __awaiter(this, void 0, void 0, function* () {
            const reference = (0, definitionIndex_1.referenceAt)(document.lineAt(position.line).text, position.character);
            // Flags are a different provider's business, and a container reference is the only thing
            // that names a script whose `definitions:` key could be read.
            if (reference === null || reference.kind !== 'container') {
                return undefined;
            }
            yield this.index.refresh();
            const definitions = this.index.definitionsFor(reference.name);
            // A script with no `definitions:` key gets no hover rather than an empty one: most
            // containers have none, and "takes 0 definitions" on every `- run` would be noise.
            if (definitions === null) {
                return undefined;
            }
            const range = new vscode.Range(position.line, reference.startChar, position.line, reference.endChar);
            return new vscode.Hover(renderDefinitions(reference.name, definitions), range);
        });
    }
}
exports.ScriptDefinitionsHoverProvider = ScriptDefinitionsHoverProvider;
class ScriptDefinitionsCompletionProvider {
    constructor(index) {
        this.index = index;
        this.lastRefresh = 0;
    }
    provideCompletionItems(document, position) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            const context = (0, definitionIndex_1.runDefinitionContextAt)(document.lineAt(position.line).text, position.character);
            if (context === null) {
                return [];
            }
            const now = Date.now();
            if (now - this.lastRefresh > COMPLETION_REFRESH_MS) {
                yield this.index.refresh();
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
            const range = new vscode.Range(position.line, position.character - context.typed.length, position.line, position.character);
            const items = [];
            // THE WHOLE LINE AT ONCE, which is what was asked for. A snippet rather than plain text, so
            // accepting it drops the caret into the first value with the rest on tab stops.
            if (missing.length > 1 || definitions.length > 1) {
                const fillAll = new vscode.CompletionItem(missing.map(d => `def.${d.name}:`).join(' '), vscode.CompletionItemKind.Snippet);
                fillAll.insertText = new vscode.SnippetString(missing.map((d, i) => `def.${d.name}:\${${i + 1}}`).join(' '));
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
                item.detail = (_a = definition.description) !== null && _a !== void 0 ? _a : `Definition of ${context.scriptName}`;
                item.range = range;
                item.sortText = `1${String(i).padStart(3, '0')}`;
                items.push(item);
            }
            return items;
        });
    }
}
exports.ScriptDefinitionsCompletionProvider = ScriptDefinitionsCompletionProvider;
/**
 * Container types a run-like command can actually execute.
 *
 * `task` is what the C# server offers -- CommandTabCompletions.cs registers
 * `SuggestScriptByType("task", ...)` for run/runlater/clickable/inject. `procedure` and `command`
 * are added because both carry a `script:` key that `- run ... path:` reaches, and leaving them out
 * would hide scripts the author can legitimately run. The types NOT here -- item, inventory,
 * entity, world, data, assignment -- have nothing to run at all, and on the user's own corpus they
 * are 48 of 72 containers, which is the noise this filter exists to keep out.
 */
const RUNNABLE_CONTAINER_TYPES = new Set(['task', 'procedure', 'command']);
class ScriptNameCompletionProvider {
    constructor(index) {
        this.index = index;
        this.lastRefresh = 0;
    }
    provideCompletionItems(document, position) {
        return __awaiter(this, void 0, void 0, function* () {
            const context = (0, definitionIndex_1.runScriptNameContextAt)(document.lineAt(position.line).text, position.character);
            if (context === null) {
                return [];
            }
            const now = Date.now();
            if (now - this.lastRefresh > COMPLETION_REFRESH_MS) {
                yield this.index.refresh();
                this.lastRefresh = now;
            }
            const range = new vscode.Range(position.line, position.character - context.typed.length, position.line, position.character);
            return this.index.containersOfType(RUNNABLE_CONTAINER_TYPES).map(container => {
                var _a;
                const item = new vscode.CompletionItem(container.name, vscode.CompletionItemKind.Class);
                // The file, because a workspace routinely holds scripts whose names alone do not say
                // which one is meant. The type, because this list is deliberately wider than `task`.
                item.detail = `${(_a = container.type) !== null && _a !== void 0 ? _a : 'script'} — ${path.basename(container.file)}`;
                item.range = range;
                return item;
            });
        });
    }
}
exports.ScriptNameCompletionProvider = ScriptNameCompletionProvider;
function activateScriptDefinitions(context, index, usingTypeScriptServer) {
    context.subscriptions.push(vscode.languages.registerHoverProvider({ language: 'denizenscript' }, new ScriptDefinitionsHoverProvider(index)));
    // '.' so `def.` re-queries, ' ' so the list appears as soon as the script name is finished.
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider({ language: 'denizenscript' }, new ScriptDefinitionsCompletionProvider(index), '.', ' '));
    // GATED ON THE ENGINE, unlike everything else in this file. The C# server already answers this
    // one (CommandTabCompletions.cs's SuggestScriptByType), and VS Code merges providers rather
    // than deduplicating them -- registering unconditionally would show every script name twice to
    // anyone on `csharp`. The TypeScript port has no equivalent, which is the gap this fills.
    if (usingTypeScriptServer) {
        context.subscriptions.push(vscode.languages.registerCompletionItemProvider({ language: 'denizenscript' }, new ScriptNameCompletionProvider(index), ' '));
    }
}
exports.activateScriptDefinitions = activateScriptDefinitions;
//# sourceMappingURL=scriptDefinitionsProvider.js.map