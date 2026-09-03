"use strict";
// The `vscode` half of go-to-definition: turning a `SymbolReference` into locations. Every
// decision lives in ./definitionIndex, which imports no `vscode` and is therefore unit-tested;
// this file is the wiring and the file walking.
//
// CLIENT-SIDE ON PURPOSE. The C# server has no definition provider at all, so putting this in the
// TypeScript server would make F12 stop working the moment `denizenscript.server.engine` was set
// back to `csharp`. Same call as the Quick Fixes and the map-tag peek.
//
// WHY IT KEEPS ITS OWN INDEX rather than reusing `DenizenWorkspaceIndex` in extension.ts: that one
// stores names only, as `Set<string>`, because completion needs nothing else. Definitions need a
// file and a line, and widening the completion index to carry positions would make every
// completion lookup pay for data it never reads.
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
exports.activateDefinitionProvider = exports.DenizenDefinitionProvider = exports.DenizenDefinitionIndex = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const definitionIndex_1 = require("./definitionIndex");
class DenizenDefinitionIndex {
    constructor() {
        this.byPath = new Map();
    }
    /**
     * Re-reads every `.dsc` in the workspace whose mtime has moved.
     *
     * Called on demand -- when a definition is actually requested -- rather than on every edit.
     * A definition jump is a deliberate user action a few times an hour, so paying the scan then
     * is cheaper overall than keeping a live index up to date, and it cannot go stale.
     */
    refresh() {
        return __awaiter(this, void 0, void 0, function* () {
            const files = yield vscode.workspace.findFiles('**/*.dsc', '**/{node_modules,.git}/**');
            const seen = new Set();
            for (const uri of files) {
                const key = uri.fsPath;
                seen.add(key);
                // An unsaved editor is the truth for its own file; the version on disk is not.
                const open = vscode.workspace.textDocuments.find(d => d.uri.fsPath === key && d.isDirty);
                if (open !== undefined) {
                    this.byPath.set(key, { symbols: (0, definitionIndex_1.indexDefinitions)(open.getText()), mtimeMs: -1 });
                    continue;
                }
                try {
                    const mtimeMs = fs.statSync(key).mtimeMs;
                    const cached = this.byPath.get(key);
                    if (cached !== undefined && cached.mtimeMs === mtimeMs) {
                        continue;
                    }
                    this.byPath.set(key, { symbols: (0, definitionIndex_1.indexDefinitions)(fs.readFileSync(key, 'utf-8')), mtimeMs });
                }
                catch (_a) {
                    // Deleted or unreadable between the find and the read.
                    this.byPath.delete(key);
                }
            }
            for (const key of [...this.byPath.keys()]) {
                if (!seen.has(key)) {
                    this.byPath.delete(key);
                }
            }
        });
    }
    /**
     * Every location defining `name`, of the given kind.
     *
     * Candidates are tried most-specific first and the search STOPS at the first that hits, so
     * `- run mytask.subkey` lands on `mytask.subkey` if such a container exists and only falls
     * back to `mytask` when it does not. Merging both would offer a jump to a container the user
     * did not name.
     */
    locationsFor(kind, name) {
        for (const candidate of (0, definitionIndex_1.nameCandidates)(kind, name)) {
            const results = [];
            for (const [key, indexed] of this.byPath) {
                const symbols = kind === 'container' ? indexed.symbols.containers : indexed.symbols.flags;
                for (const symbol of symbols) {
                    if ((0, definitionIndex_1.sameName)(symbol.name, candidate)) {
                        results.push(new vscode.Location(vscode.Uri.file(key), new vscode.Range(symbol.line, symbol.startChar, symbol.line, symbol.endChar)));
                    }
                }
            }
            if (results.length > 0) {
                return results;
            }
        }
        return [];
    }
}
exports.DenizenDefinitionIndex = DenizenDefinitionIndex;
class DenizenDefinitionProvider {
    constructor(index) {
        this.index = index;
    }
    provideDefinition(document, position) {
        return __awaiter(this, void 0, void 0, function* () {
            const reference = (0, definitionIndex_1.referenceAt)(document.lineAt(position.line).text, position.character);
            if (reference === null) {
                return [];
            }
            yield this.index.refresh();
            const targets = this.index.locationsFor(reference.kind, reference.name);
            // LocationLink rather than Location: it carries `originSelectionRange`, which is what makes
            // ctrl-hover underline just the flag or script name instead of the whole line.
            const origin = new vscode.Range(position.line, reference.startChar, position.line, reference.endChar);
            return targets.map(target => ({
                originSelectionRange: origin,
                targetUri: target.uri,
                targetRange: target.range,
                targetSelectionRange: target.range
            }));
        });
    }
}
exports.DenizenDefinitionProvider = DenizenDefinitionProvider;
function activateDefinitionProvider(context) {
    const index = new DenizenDefinitionIndex();
    context.subscriptions.push(vscode.languages.registerDefinitionProvider({ language: 'denizenscript' }, new DenizenDefinitionProvider(index)));
}
exports.activateDefinitionProvider = activateDefinitionProvider;
//# sourceMappingURL=definitionProvider.js.map