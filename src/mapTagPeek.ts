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

import * as vscode from 'vscode';
import { findTagAt, formatTag, collapseTag, isCollapsible } from './tagFormatter';

/** The URI scheme the expanded views live under. */
export const SCHEME = 'denizen-maptag';

/** One open expansion: which document and range it came from, and what the peek shows. */
interface Expansion {
    sourceUri: vscode.Uri;
    /** The range of the single-line tag in the source document. Re-anchored after every write. */
    range: vscode.Range;
    /** The last content successfully written back, to avoid redundant edits. */
    lastWritten: string;
    /**
     * Whether a write is in flight.
     *
     * SERIALISING IS NOT OPTIONAL. `onDidChangeTextDocument` fires once per keystroke and
     * `syncBack` awaits `applyEdit`, so typing `.round` produced six overlapping calls. Each read
     * `range` BEFORE the previous write had landed, then replaced that stale, now-wrong-length
     * range -- which ate the text after the tag. That was the reported corruption.
     */
    syncing: boolean;
    /** Whether another change arrived while a write was in flight, so one more pass is owed. */
    pending: boolean;
}

/**
 * A minimal in-memory file system, just enough for VS Code to open an editable document.
 *
 * Only the members VS Code actually calls for this use are meaningful; the rest satisfy the
 * interface and throw, because reaching them would mean something is using this scheme for
 * something it was not built for, and failing loudly beats corrupting state quietly.
 */
class MapTagFileSystem implements vscode.FileSystemProvider {
    private readonly contents = new Map<string, Uint8Array>();
    private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this.emitter.event;

    watch(): vscode.Disposable {
        return new vscode.Disposable(() => { /* nothing to unwatch: content is in memory */ });
    }

    stat(uri: vscode.Uri): vscode.FileStat {
        const data = this.contents.get(uri.toString());
        if (data === undefined) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return { type: vscode.FileType.File, ctime: 0, mtime: Date.now(), size: data.length };
    }

    readFile(uri: vscode.Uri): Uint8Array {
        const data = this.contents.get(uri.toString());
        if (data === undefined) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return data;
    }

    writeFile(uri: vscode.Uri, content: Uint8Array): void {
        const existed = this.contents.has(uri.toString());
        this.contents.set(uri.toString(), content);
        this.emitter.fire([{ type: existed ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created, uri }]);
    }

    delete(uri: vscode.Uri): void {
        this.contents.delete(uri.toString());
        this.emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
    }

    readDirectory(): [string, vscode.FileType][] { return []; }
    createDirectory(): void { /* no directories in this scheme */ }
    rename(): void { throw vscode.FileSystemError.NoPermissions('Expanded tag views cannot be renamed.'); }
}

const fileSystem = new MapTagFileSystem();
/** Open expansions, keyed by the virtual document's URI string. */
const expansions = new Map<string, Expansion>();
let counter = 0;

/** The first tag on the line that is actually worth expanding, or null. */
function firstExpandableTag(lineText: string): ReturnType<typeof findTagAt> {
    for (let i = 0; i < lineText.length; i++) {
        if (lineText[i] !== '<') {
            continue;
        }
        const candidate = findTagAt(lineText, i + 1);
        if (candidate !== null && formatTag(candidate.text) !== null) {
            return candidate;
        }
    }
    return null;
}

/** Where an expansion was asked for. Passed by the code lens; absent when invoked from a keybinding. */
interface ExpandTarget {
    line: number;
    character: number;
}

/**
 * Opens the expanded, editable view of a map or list tag.
 *
 * `target` is supplied by the code lens, which knows exactly which tag it sits above. Without it
 * -- the keybinding and command-palette paths -- the cursor decides.
 *
 * THE LENS MUST PASS ITS OWN POSITION. The first version did not, so clicking the lens ran the
 * command against wherever the caret happened to be, and did nothing unless the user had already
 * put it inside the tag. That defeated the point of having something clickable.
 */
async function expandTag(target?: ExpandTarget): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
        return;
    }
    const position = target !== undefined
        ? new vscode.Position(target.line, target.character)
        : editor.selection.active;
    const lineText = editor.document.lineAt(position.line).text;
    // From a keybinding the caret may be anywhere on the line -- before the tag, after it, in the
    // command name. Fall back to the first expandable tag on the line rather than refusing.
    const found = findTagAt(lineText, position.character) ?? firstExpandableTag(lineText);
    if (found === null) {
        vscode.window.showInformationMessage('No <map[...]> or <list[...]> tag with more than one entry on this line.');
        return;
    }
    const pretty = formatTag(found.text);
    if (pretty === null) {
        vscode.window.showInformationMessage('That tag has nothing to expand - only <map[...]> and <list[...]> with more than one entry can be.');
        return;
    }
    const uri = vscode.Uri.parse(`${SCHEME}:/tag-${++counter}.dsc`);
    fileSystem.writeFile(uri, Buffer.from(pretty, 'utf8'));
    const range = new vscode.Range(position.line, found.start, position.line, found.end);
    expansions.set(uri.toString(), { sourceUri: editor.document.uri, range, lastWritten: found.text, syncing: false, pending: false });
    // The peek widget renders the target document inline, below the current line, and Escape
    // closes it. `editor.action.peekLocations` is a built-in command; the alternative
    // (createWebviewTextEditorInset) is still a proposed API and cannot ship.
    await vscode.commands.executeCommand(
        'editor.action.peekLocations',
        editor.document.uri,
        position,
        [new vscode.Location(uri, new vscode.Position(0, 0))],
        'peek'
    );
}

/**
 * Writes an edited expansion back into the source file as a single line.
 *
 * Declines silently when the edit does not balance -- see the module header.
 */
async function syncBack(document: vscode.TextDocument): Promise<void> {
    const expansion = expansions.get(document.uri.toString());
    if (expansion === undefined) {
        return;
    }
    // Serialise. A change that arrives mid-write is remembered, not dropped: the run in flight
    // loops again afterwards and picks up the latest document text, so the final state is always
    // written even though the intermediate ones are coalesced.
    if (expansion.syncing) {
        expansion.pending = true;
        return;
    }
    expansion.syncing = true;
    try {
        do {
            expansion.pending = false;
            await syncOnce(document, expansion);
        } while (expansion.pending);
    }
    finally {
        expansion.syncing = false;
    }
}

/** One write-back pass. Only ever called from `syncBack`, which guarantees no overlap. */
async function syncOnce(document: vscode.TextDocument, expansion: Expansion): Promise<void> {
    const pretty = document.getText();
    if (!isCollapsible(pretty)) {
        // Mid-keystroke. Leave the last good version in the file.
        return;
    }
    const collapsed = collapseTag(pretty);
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
        const refound = findTagAt(line, expansion.range.start.character);
        if (refound === null || refound.text !== expansion.lastWritten) {
            return;
        }
        expansion.range = new vscode.Range(expansion.range.start.line, refound.start, expansion.range.start.line, refound.end);
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(expansion.sourceUri, expansion.range, collapsed);
    if (await vscode.workspace.applyEdit(edit)) {
        expansion.lastWritten = collapsed;
        expansion.range = new vscode.Range(
            expansion.range.start.line, expansion.range.start.character,
            expansion.range.start.line, expansion.range.start.character + collapsed.length
        );
    }
}

/**
 * A clickable affordance above every line holding an expandable tag.
 *
 * Only offered where `formatTag` would actually produce something, so ordinary tags and
 * single-entry maps get no lens and the file does not fill up with noise.
 */
class ExpandTagLensProvider implements vscode.CodeLensProvider {
    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        if (!vscode.workspace.getConfiguration().get<boolean>('refinedDenizenscript.mapTag.showExpandLens', true)) {
            return [];
        }
        // No expanding an expansion: this provider is registered by language, which matches every
        // scheme, so without this an expanded buffer containing a nested map would offer its own
        // "Expand tag" lens and open a second peek that writes back into the first.
        if (document.uri.scheme === SCHEME) {
            return [];
        }
        const lenses: vscode.CodeLens[] = [];
        for (let i = 0; i < document.lineCount; i++) {
            const text = document.lineAt(i).text;
            let searchFrom = 0;
            for (;;) {
                const open = text.indexOf('<', searchFrom);
                if (open === -1) {
                    break;
                }
                const found = findTagAt(text, open);
                if (found !== null && formatTag(found.text) !== null) {
                    lenses.push(new vscode.CodeLens(new vscode.Range(i, found.start, i, found.end), {
                        title: '$(list-tree) Expand tag',
                        command: 'refinedDenizenscript.expandMapTag',
                        // The lens knows exactly which tag it sits above; passing that is what
                        // makes clicking it work regardless of where the caret is.
                        arguments: [{ line: i, character: found.start + 1 }]
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
export function activateMapTagPeek(context: vscode.ExtensionContext): void {
    context.subscriptions.push(vscode.workspace.registerFileSystemProvider(SCHEME, fileSystem, { isCaseSensitive: true }));
    context.subscriptions.push(vscode.commands.registerCommand('refinedDenizenscript.expandMapTag', (target?: ExpandTarget) => expandTag(target)));
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
