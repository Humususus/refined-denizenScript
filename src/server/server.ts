/**
 * TypeScript LSP server entry point. Phase 1 scope: connect, load meta
 * documentation, and log a summary — no completion/hover/diagnostics yet
 * (those are later phases per LSP_REWRITE_PLAN.md).
 */

import * as os from 'os';
import * as path from 'path';
import {
    createConnection, ProposedFeatures, TextDocuments, TextDocumentSyncKind,
    InitializeParams, InitializeResult, Connection
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { loadMetaDocs, DEFAULT_META_SOURCES } from './metaDocs/metaDocsManager';

const META_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function getMetaCacheFile(): string {
    const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'DenizenVSCodeExtension', 'cache', 'meta-blocks-cache.json');
}

export function createServer(): Connection {
    const connection = createConnection(ProposedFeatures.all);
    const documents = new TextDocuments(TextDocument);

    connection.onInitialize((_params: InitializeParams): InitializeResult => {
        return {
            capabilities: {
                textDocumentSync: TextDocumentSyncKind.Incremental
            }
        };
    });

    connection.onInitialized(() => {
        loadMetaDocs({ cacheFile: getMetaCacheFile(), ttlMs: META_CACHE_TTL_MS, sources: DEFAULT_META_SOURCES })
            .then(docs => {
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
    });

    documents.listen(connection);
    return connection;
}

if (require.main === module) {
    createServer().listen();
}
