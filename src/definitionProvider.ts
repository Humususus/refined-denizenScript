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

import * as vscode from 'vscode';
import * as fs from 'fs';
import { FileSymbols, ScriptDefinition, indexDefinitions, nameCandidates, referenceAt, sameName } from './definitionIndex';

/** One indexed file: its symbols and the mtime the index was built from. */
interface IndexedFile {
    symbols: FileSymbols;
    /** Milliseconds. A file whose mtime is unchanged is not re-read. */
    mtimeMs: number;
}

export class DenizenDefinitionIndex {
    private byPath = new Map<string, IndexedFile>();

    /**
     * Re-reads every `.dsc` in the workspace whose mtime has moved.
     *
     * Called on demand -- when a definition is actually requested -- rather than on every edit.
     * A definition jump is a deliberate user action a few times an hour, so paying the scan then
     * is cheaper overall than keeping a live index up to date, and it cannot go stale.
     */
    async refresh(): Promise<void> {
        const files = await vscode.workspace.findFiles('**/*.dsc', '**/{node_modules,.git}/**');
        const seen = new Set<string>();
        for (const uri of files) {
            const key = uri.fsPath;
            seen.add(key);
            // An unsaved editor is the truth for its own file; the version on disk is not.
            const open = vscode.workspace.textDocuments.find(d => d.uri.fsPath === key && d.isDirty);
            if (open !== undefined) {
                this.byPath.set(key, { symbols: indexDefinitions(open.getText()), mtimeMs: -1 });
                continue;
            }
            try {
                const mtimeMs = fs.statSync(key).mtimeMs;
                const cached = this.byPath.get(key);
                if (cached !== undefined && cached.mtimeMs === mtimeMs) {
                    continue;
                }
                this.byPath.set(key, { symbols: indexDefinitions(fs.readFileSync(key, 'utf-8')), mtimeMs });
            }
            catch {
                // Deleted or unreadable between the find and the read.
                this.byPath.delete(key);
            }
        }
        for (const key of [...this.byPath.keys()]) {
            if (!seen.has(key)) {
                this.byPath.delete(key);
            }
        }
    }

    /**
     * Every location defining `name`, of the given kind.
     *
     * Candidates are tried most-specific first and the search STOPS at the first that hits, so
     * `- run mytask.subkey` lands on `mytask.subkey` if such a container exists and only falls
     * back to `mytask` when it does not. Merging both would offer a jump to a container the user
     * did not name.
     */
    locationsFor(kind: 'container' | 'flag', name: string): vscode.Location[] {
        for (const candidate of nameCandidates(kind, name)) {
            const results: vscode.Location[] = [];
            for (const [key, indexed] of this.byPath) {
                const symbols = kind === 'container' ? indexed.symbols.containers : indexed.symbols.flags;
                for (const symbol of symbols) {
                    if (sameName(symbol.name, candidate)) {
                        results.push(new vscode.Location(
                            vscode.Uri.file(key),
                            new vscode.Range(symbol.line, symbol.startChar, symbol.line, symbol.endChar)
                        ));
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
    definitionsFor(name: string): ScriptDefinition[] | null {
        for (const candidate of nameCandidates('container', name)) {
            for (const indexed of this.byPath.values()) {
                for (const symbol of indexed.symbols.containers) {
                    if (sameName(symbol.name, candidate) && (symbol.definitions ?? []).length > 0) {
                        return symbol.definitions!;
                    }
                }
            }
        }
        return null;
    }
}

export class DenizenDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private readonly index: DenizenDefinitionIndex) { }

    async provideDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Definition | vscode.LocationLink[]> {
        const reference = referenceAt(document.lineAt(position.line).text, position.character);
        if (reference === null) {
            return [];
        }
        await this.index.refresh();
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
    }
}

/**
 * Registers go-to-definition, and hands back the index it built.
 *
 * The index is returned rather than kept private because the script-definitions hover and
 * completion need exactly the same data -- every `.dsc` container, with a file and a line. Building
 * a second index of the same files for them would double the workspace scan to no purpose.
 */
export function activateDefinitionProvider(context: vscode.ExtensionContext): DenizenDefinitionIndex {
    const index = new DenizenDefinitionIndex();
    context.subscriptions.push(vscode.languages.registerDefinitionProvider(
        { language: 'denizenscript' },
        new DenizenDefinitionProvider(index)
    ));
    return index;
}
