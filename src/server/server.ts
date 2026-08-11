/**
 * TypeScript LSP server entry point. Connects, loads meta documentation, and
 * serves command completion and hover. Diagnostics remain future work.
 */

import * as os from 'os';
import * as path from 'path';
import {
    createConnection, ProposedFeatures, TextDocuments, TextDocumentSyncKind,
    InitializeParams, InitializeResult, Connection, ServerCapabilities,
    CompletionItem, Hover, TextDocumentPositionParams
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { loadMetaDocs, DEFAULT_META_SOURCES } from './metaDocs/metaDocsManager';
import { MetaDocs } from './metaDocs/metaTypes';
import { ExtraData, createEmptyExtraData, loadExtraData } from './metaDocs/extraData';
import { provideCompletions } from './providers/completionProvider';
import { provideHover } from './providers/hoverProvider';

const META_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/** C# refreshes this document every 15 days (ExtraData.cs:51); match that. */
const EXTRA_DATA_TTL_MS = 15 * 24 * 60 * 60 * 1000;

/** The loaded meta documentation, or null until the initial load resolves. */
let loadedDocs: MetaDocs | null = null;

/** Minecraft enum data. Starts empty so completion degrades gracefully while loading. */
let loadedExtra: ExtraData = createEmptyExtraData();

function getMetaCacheFile(): string {
    const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'DenizenVSCodeExtension', 'cache', 'meta-blocks-cache.json');
}

function getExtraDataCacheFile(): string {
    const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'DenizenVSCodeExtension', 'cache', 'minecraft.fds');
}

/** Merges the default meta sources with any user-configured extra sources, filtering out blank entries. Extracted as its own function so it's independently unit-testable without a live LSP connection. */
export function combineSources(defaults: string[], extra: string[] | undefined | null): string[] {
    if (!extra || extra.length === 0) {
        return defaults;
    }
    return [...defaults, ...extra.map(s => s.trim()).filter(s => s.length > 0)];
}

/** The capabilities this server advertises. Extracted so it is testable without a live connection. */
export function buildCapabilities(): ServerCapabilities {
    return {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: {
            resolveProvider: false,
            triggerCharacters: ['-', ' ', ':']
        },
        hoverProvider: true
    };
}

export function createServer(): Connection {
    const connection = createConnection(ProposedFeatures.all);
    const documents = new TextDocuments(TextDocument);

    connection.onInitialize((_params: InitializeParams): InitializeResult => {
        return { capabilities: buildCapabilities() };
    });

    connection.onInitialized(() => {
        connection.workspace.getConfiguration('denizenscript.server.extra_sources')
            .then((extraSources: string[] | undefined) => {
                const sources = combineSources(DEFAULT_META_SOURCES, extraSources);
                return loadMetaDocs({ cacheFile: getMetaCacheFile(), ttlMs: META_CACHE_TTL_MS, sources });
            })
            .then(docs => {
                loadedDocs = docs;
                connection.console.log(
                    `Denizen meta loaded: ${docs.commands.size} commands, ${docs.tags.size} tags, ` +
                    `${docs.events.size} events, ${docs.mechanisms.size} mechanisms, ${docs.properties.size} properties, ` +
                    `${docs.actions.size} actions, ${docs.languages.size} languages, ${docs.objectTypes.size} object types. ` +
                    `${docs.loadErrors.length} load error(s).`
                );
                for (const err of docs.loadErrors.slice(0, 20)) {
                    connection.console.warn(`Meta load error: ${err}`);
                }
            })
            .catch(err => {
                connection.console.error(`Denizen meta load failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
            });

        loadExtraData({ cacheFile: getExtraDataCacheFile(), ttlMs: EXTRA_DATA_TTL_MS })
            .then(extra => {
                loadedExtra = extra;
                connection.console.log(`Minecraft enum data loaded: ${extra.sounds.size} sounds, ${extra.materials.size} materials, ${extra.entities.size} entities. ${extra.loadErrors.length} load error(s).`);
                for (const err of extra.loadErrors.slice(0, 20)) {
                    connection.console.warn(`Extra data load error: ${err}`);
                }
            })
            .catch(err => {
                connection.console.error(`Minecraft enum data load failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
            });
    });

    connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
        const doc = documents.get(params.textDocument.uri);
        if (doc === undefined || loadedDocs === null || !params.textDocument.uri.endsWith('.dsc')) {
            return [];
        }
        try {
            return provideCompletions(loadedDocs, loadedExtra, doc.getText(), doc.offsetAt(params.position), params.position.line);
        }
        catch (err) {
            connection.console.error(`Completion failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
            return [];
        }
    });

    connection.onHover((params: TextDocumentPositionParams): Hover | null => {
        const doc = documents.get(params.textDocument.uri);
        if (doc === undefined || loadedDocs === null || !params.textDocument.uri.endsWith('.dsc')) {
            return null;
        }
        try {
            return provideHover(loadedDocs, doc.getText(), doc.offsetAt(params.position),
                params.position.line);
        }
        catch (err) {
            connection.console.error(`Hover failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
            return null;
        }
    });

    documents.listen(connection);
    return connection;
}

if (require.main === module) {
    createServer().listen();
}
