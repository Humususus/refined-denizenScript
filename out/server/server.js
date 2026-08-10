"use strict";
/**
 * TypeScript LSP server entry point. Connects, loads meta documentation, and
 * serves command completion and hover. Diagnostics remain future work.
 */
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServer = exports.buildCapabilities = exports.combineSources = void 0;
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const metaDocsManager_1 = require("./metaDocs/metaDocsManager");
const completionProvider_1 = require("./providers/completionProvider");
const hoverProvider_1 = require("./providers/hoverProvider");
const META_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
/** The loaded meta documentation, or null until the initial load resolves. */
let loadedDocs = null;
function getMetaCacheFile() {
    var _a;
    const base = (_a = process.env.LOCALAPPDATA) !== null && _a !== void 0 ? _a : path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'DenizenVSCodeExtension', 'cache', 'meta-blocks-cache.json');
}
/** Merges the default meta sources with any user-configured extra sources, filtering out blank entries. Extracted as its own function so it's independently unit-testable without a live LSP connection. */
function combineSources(defaults, extra) {
    if (!extra || extra.length === 0) {
        return defaults;
    }
    return [...defaults, ...extra.map(s => s.trim()).filter(s => s.length > 0)];
}
exports.combineSources = combineSources;
/** The capabilities this server advertises. Extracted so it is testable without a live connection. */
function buildCapabilities() {
    return {
        textDocumentSync: node_1.TextDocumentSyncKind.Incremental,
        completionProvider: {
            resolveProvider: false,
            triggerCharacters: ['-', ' ', ':']
        },
        hoverProvider: true
    };
}
exports.buildCapabilities = buildCapabilities;
function createServer() {
    const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
    const documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
    connection.onInitialize((_params) => {
        return { capabilities: buildCapabilities() };
    });
    connection.onInitialized(() => {
        connection.workspace.getConfiguration('denizenscript.server.extra_sources')
            .then((extraSources) => {
            const sources = combineSources(metaDocsManager_1.DEFAULT_META_SOURCES, extraSources);
            return (0, metaDocsManager_1.loadMetaDocs)({ cacheFile: getMetaCacheFile(), ttlMs: META_CACHE_TTL_MS, sources });
        })
            .then(docs => {
            loadedDocs = docs;
            connection.console.log(`Denizen meta loaded: ${docs.commands.size} commands, ${docs.tags.size} tags, ` +
                `${docs.events.size} events, ${docs.mechanisms.size} mechanisms, ${docs.properties.size} properties, ` +
                `${docs.actions.size} actions, ${docs.languages.size} languages, ${docs.objectTypes.size} object types. ` +
                `${docs.loadErrors.length} load error(s).`);
            for (const err of docs.loadErrors.slice(0, 20)) {
                connection.console.warn(`Meta load error: ${err}`);
            }
        })
            .catch(err => {
            var _a;
            connection.console.error(`Denizen meta load failed: ${err instanceof Error ? (_a = err.stack) !== null && _a !== void 0 ? _a : err.message : String(err)}`);
        });
    });
    connection.onCompletion((params) => {
        var _a;
        const doc = documents.get(params.textDocument.uri);
        if (doc === undefined || loadedDocs === null || !params.textDocument.uri.endsWith('.dsc')) {
            return [];
        }
        try {
            return (0, completionProvider_1.provideCompletions)(loadedDocs, doc.getText(), doc.offsetAt(params.position));
        }
        catch (err) {
            connection.console.error(`Completion failed: ${err instanceof Error ? (_a = err.stack) !== null && _a !== void 0 ? _a : err.message : String(err)}`);
            return [];
        }
    });
    connection.onHover((params) => {
        var _a;
        const doc = documents.get(params.textDocument.uri);
        if (doc === undefined || loadedDocs === null || !params.textDocument.uri.endsWith('.dsc')) {
            return null;
        }
        try {
            return (0, hoverProvider_1.provideHover)(loadedDocs, doc.getText(), doc.offsetAt(params.position), params.position.line);
        }
        catch (err) {
            connection.console.error(`Hover failed: ${err instanceof Error ? (_a = err.stack) !== null && _a !== void 0 ? _a : err.message : String(err)}`);
            return null;
        }
    });
    documents.listen(connection);
    return connection;
}
exports.createServer = createServer;
if (require.main === module) {
    createServer().listen();
}
//# sourceMappingURL=server.js.map