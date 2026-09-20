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
    /**
     * The `definitions:` entries of the container named `name`, or null when there is no such
     * container or it declares none.
     *
     * Follows `locationsFor`'s candidate order, so `- run mytask.subkey` reads the sub-container's
     * key when one exists and falls back to `mytask` otherwise. Stops at the FIRST container that
     * declares any: two containers sharing a name is already reported as `duplicate_script` by the
     * checker, and merging their keys here would invent a definition list neither one has.
     */
    /**
     * Every indexed container of one of `types`, with the file it lives in.
     *
     * A container whose `type:` the walk could not see is INCLUDED: the index is line-based, and
     * hiding a script because its type was written somewhere this could not read would be the one
     * failure the author cannot work around. Offering a few extra names costs a scroll.
     *
     * Deduplicated by folded name, first occurrence winning, so a script defined twice across the
     * workspace is offered once rather than filling the list with copies of itself.
     */
    containersOfType(types) {
        var _a;
        const results = [];
        const seen = new Set();
        for (const [key, indexed] of this.byPath) {
            for (const symbol of indexed.symbols.containers) {
                const type = (_a = symbol.containerType) !== null && _a !== void 0 ? _a : null;
                if (type !== null && !types.has(type)) {
                    continue;
                }
                const folded = symbol.name.toLowerCase();
                if (seen.has(folded)) {
                    continue;
                }
                seen.add(folded);
                results.push({ name: symbol.name, type, file: key });
            }
        }
        return results;
    }
    definitionsFor(name) {
        var _a;
        for (const candidate of (0, definitionIndex_1.nameCandidates)('container', name)) {
            for (const indexed of this.byPath.values()) {
                for (const symbol of indexed.symbols.containers) {
                    if ((0, definitionIndex_1.sameName)(symbol.name, candidate) && ((_a = symbol.definitions) !== null && _a !== void 0 ? _a : []).length > 0) {
                        return symbol.definitions;
                    }
                }
            }
        }
        return null;
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
/**
 * Registers go-to-definition, and hands back the index it built.
 *
 * The index is returned rather than kept private because the script-definitions hover and
 * completion need exactly the same data -- every `.dsc` container, with a file and a line. Building
 * a second index of the same files for them would double the workspace scan to no purpose.
 */
function activateDefinitionProvider(context) {
    const index = new DenizenDefinitionIndex();
    context.subscriptions.push(vscode.languages.registerDefinitionProvider({ language: 'denizenscript' }, new DenizenDefinitionProvider(index)));
    return index;
}
exports.activateDefinitionProvider = activateDefinitionProvider;
//# sourceMappingURL=definitionProvider.js.map