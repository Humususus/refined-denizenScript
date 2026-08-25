"use strict";
// The editable expanded view of a `<map[...]>` / `<list[...]>` tag, shown as a peek under the
// line. All the VS Code plumbing lives here; the parsing and rendering live in ./tagFormatter,
// which stays pure and unit-tested.
//
// HOW IT WORKS, and why it is built this way:
//
//   - Denizen's parser only accepts a tag on ONE line, so the script file never holds the
//     expanded form. It exists only in a virtual document.
//   - That document is backed by a FileSystemProvider rather than a TextDocumentContentProvider,
//     because the latter is READ-ONLY and the whole point is to type in it.
//   - Every edit is collapsed back to a single line and written into the real file immediately,
//     but ONLY when the brackets balance (`isCollapsible`). Partway through typing a nested tag
//     they do not, and writing then would put a broken tag into the script; the last good
//     version stays until the edit settles.
//   - The source range is re-anchored after every write, because collapsing changes its length.
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
exports.activateMapTagPeek = void 0;
const vscode = __importStar(require("vscode"));
const tagFormatter_1 = require("./tagFormatter");
/** The URI scheme the expanded views live under. */
const SCHEME = 'denizen-maptag';
/**
 * A minimal in-memory file system, just enough for VS Code to open an editable document.
 *
 * Only the members VS Code actually calls for this use are meaningful; the rest satisfy the
 * interface and throw, because reaching them would mean something is using this scheme for
 * something it was not built for, and failing loudly beats corrupting state quietly.
 */
class MapTagFileSystem {
    constructor() {
        this.contents = new Map();
        this.emitter = new vscode.EventEmitter();
        this.onDidChangeFile = this.emitter.event;
    }
    watch() {
        return new vscode.Disposable(() => { });
    }
    stat(uri) {
        const data = this.contents.get(uri.toString());
        if (data === undefined) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return { type: vscode.FileType.File, ctime: 0, mtime: Date.now(), size: data.length };
    }
    readFile(uri) {
        const data = this.contents.get(uri.toString());
        if (data === undefined) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return data;
    }
    writeFile(uri, content) {
        const existed = this.contents.has(uri.toString());
        this.contents.set(uri.toString(), content);
        this.emitter.fire([{ type: existed ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created, uri }]);
    }
    delete(uri) {
        this.contents.delete(uri.toString());
        this.emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
    }
    readDirectory() { return []; }
    createDirectory() { }
    rename() { throw vscode.FileSystemError.NoPermissions('Expanded tag views cannot be renamed.'); }
}
const fileSystem = new MapTagFileSystem();
/** Open expansions, keyed by the virtual document's URI string. */
const expansions = new Map();
let counter = 0;
/**
 * Opens the expanded, editable view of the map or list tag under the cursor.
 *
 * Does nothing when the cursor is not inside one, or when the tag has a single entry -- expanding
 * that would add ceremony and no information.
 */
function expandTagAtCursor() {
    return __awaiter(this, void 0, void 0, function* () {
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined) {
            return;
        }
        const position = editor.selection.active;
        const lineText = editor.document.lineAt(position.line).text;
        const found = (0, tagFormatter_1.findTagAt)(lineText, position.character);
        if (found === null) {
            vscode.window.showInformationMessage('Put the cursor inside a <map[...]> or <list[...]> tag to expand it.');
            return;
        }
        const pretty = (0, tagFormatter_1.formatTag)(found.text);
        if (pretty === null) {
            vscode.window.showInformationMessage('That tag has nothing to expand - only <map[...]> and <list[...]> with more than one entry can be.');
            return;
        }
        const uri = vscode.Uri.parse(`${SCHEME}:/tag-${++counter}.dsc`);
        fileSystem.writeFile(uri, Buffer.from(pretty, 'utf8'));
        const range = new vscode.Range(position.line, found.start, position.line, found.end);
        expansions.set(uri.toString(), { sourceUri: editor.document.uri, range, lastWritten: found.text });
        // The peek widget renders the target document inline, below the current line, and Escape
        // closes it. `editor.action.peekLocations` is a built-in command; the alternative
        // (createWebviewTextEditorInset) is still a proposed API and cannot ship.
        yield vscode.commands.executeCommand('editor.action.peekLocations', editor.document.uri, position, [new vscode.Location(uri, new vscode.Position(0, 0))], 'peek');
    });
}
/**
 * Writes an edited expansion back into the source file as a single line.
 *
 * Declines silently when the edit does not balance -- see the module header.
 */
function syncBack(document) {
    return __awaiter(this, void 0, void 0, function* () {
        const expansion = expansions.get(document.uri.toString());
        if (expansion === undefined) {
            return;
        }
        const pretty = document.getText();
        if (!(0, tagFormatter_1.isCollapsible)(pretty)) {
            // Mid-keystroke. Leave the last good version in the file.
            return;
        }
        const collapsed = (0, tagFormatter_1.collapseTag)(pretty);
        if (collapsed === null || collapsed === expansion.lastWritten) {
            return;
        }
        const source = vscode.workspace.textDocuments.find(d => d.uri.toString() === expansion.sourceUri.toString());
        if (source === undefined) {
            return;
        }
        // Re-read the range before replacing: an edit that shortened the tag moved everything after
        // it, and the stored range is only correct until the first write.
        const currentText = source.getText(expansion.range);
        if (currentText !== expansion.lastWritten) {
            // The source changed underneath us -- someone edited the line directly. Re-find the tag
            // rather than overwriting whatever is there now.
            const line = source.lineAt(expansion.range.start.line).text;
            const refound = (0, tagFormatter_1.findTagAt)(line, expansion.range.start.character);
            if (refound === null || refound.text !== expansion.lastWritten) {
                return;
            }
            expansion.range = new vscode.Range(expansion.range.start.line, refound.start, expansion.range.start.line, refound.end);
        }
        const edit = new vscode.WorkspaceEdit();
        edit.replace(expansion.sourceUri, expansion.range, collapsed);
        if (yield vscode.workspace.applyEdit(edit)) {
            expansion.lastWritten = collapsed;
            expansion.range = new vscode.Range(expansion.range.start.line, expansion.range.start.character, expansion.range.start.line, expansion.range.start.character + collapsed.length);
        }
    });
}
/**
 * A clickable affordance above every line holding an expandable tag.
 *
 * Only offered where `formatTag` would actually produce something, so ordinary tags and
 * single-entry maps get no lens and the file does not fill up with noise.
 */
class ExpandTagLensProvider {
    provideCodeLenses(document) {
        if (!vscode.workspace.getConfiguration().get('refinedDenizenscript.mapTag.showExpandLens', true)) {
            return [];
        }
        const lenses = [];
        for (let i = 0; i < document.lineCount; i++) {
            const text = document.lineAt(i).text;
            let searchFrom = 0;
            for (;;) {
                const open = text.indexOf('<', searchFrom);
                if (open === -1) {
                    break;
                }
                const found = (0, tagFormatter_1.findTagAt)(text, open);
                if (found !== null && (0, tagFormatter_1.formatTag)(found.text) !== null) {
                    lenses.push(new vscode.CodeLens(new vscode.Range(i, found.start, i, found.end), {
                        title: '$(list-tree) Expand tag',
                        command: 'refinedDenizenscript.expandMapTag',
                        arguments: []
                    }));
                    break;
                }
                searchFrom = open + 1;
            }
        }
        return lenses;
    }
}
/** Wires up the expanded-tag view. Call from `activate`. */
function activateMapTagPeek(context) {
    context.subscriptions.push(vscode.workspace.registerFileSystemProvider(SCHEME, fileSystem, { isCaseSensitive: true }));
    context.subscriptions.push(vscode.commands.registerCommand('refinedDenizenscript.expandMapTag', expandTagAtCursor));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.uri.scheme === SCHEME) {
            void syncBack(event.document);
        }
    }));
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => {
        if (document.uri.scheme === SCHEME) {
            expansions.delete(document.uri.toString());
            fileSystem.delete(document.uri);
        }
    }));
    context.subscriptions.push(vscode.languages.registerCodeLensProvider('denizenscript', new ExpandTagLensProvider()));
}
exports.activateMapTagPeek = activateMapTagPeek;
//# sourceMappingURL=mapTagPeek.js.map