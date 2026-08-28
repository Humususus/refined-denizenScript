"use strict";
/**
 * TypeScript LSP server entry point. Connects, loads meta documentation, and
 * serves command completion, hover, signature help, and script-checker diagnostics.
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
exports.createServer = exports.uriToPath = exports.linkMatchersWhenReady = exports.buildDiagnostics = exports.buildCapabilities = exports.combineSources = void 0;
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const url = __importStar(require("url"));
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const metaDocsManager_1 = require("./metaDocs/metaDocsManager");
const metaLinker_1 = require("./metaDocs/metaLinker");
const workspaceTracker_1 = require("./workspaceTracker");
const extraData_1 = require("./metaDocs/extraData");
const completionProvider_1 = require("./providers/completionProvider");
const hoverProvider_1 = require("./providers/hoverProvider");
const signatureHelpProvider_1 = require("./providers/signatureHelpProvider");
const scriptChecker_1 = require("./checker/scriptChecker");
const META_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
/**
 * How long a document must sit still before it is re-checked.
 *
 * DELIBERATE DEVIATION FROM DiagnosticProvider.cs:45-70. The C# runs a background thread that
 * wakes every second, lints if a flag was set, and force-relints roughly every sixty wakeups
 * whether or not anything changed. That poll loop is a workaround for its own architecture
 * (a volatile flag plus two lock objects standing in for an event), not a design choice worth
 * reproducing: it costs a wakeup a second forever, adds up to a second of latency to every
 * edit, and re-lints untouched documents. `documents.onDidChangeContent` plus a per-document
 * debounce is the idiomatic LSP shape and is strictly better on all three counts. Please do
 * not "restore fidelity" here by adding a poll loop.
 */
const DIAGNOSTIC_DEBOUNCE_MS = 300;
/**
 * The `source` field stamped on every published diagnostic. Copied verbatim from
 * DiagnosticProvider.cs:101/105/109 -- users filter the Problems panel by it, and the two
 * engines are switchable at runtime, so it must read identically in both.
 */
const DIAGNOSTIC_SOURCE = 'Denizen Script Checker';
/** C# refreshes this document every 15 days (ExtraData.cs:51); match that. */
const EXTRA_DATA_TTL_MS = 15 * 24 * 60 * 60 * 1000;
/** The loaded meta documentation, or null until the initial load resolves. */
let loadedDocs = null;
/** Minecraft enum data. Starts empty so completion degrades gracefully while loading. */
let loadedExtra = (0, extraData_1.createEmptyExtraData)();
/**
 * The `denizenscript.server.tagTracing` setting: whether tag-part completion is narrowed
 * to the traced return type of the preceding part. Defaults to true, matching
 * package.json, so completion behaves correctly before the configuration read resolves
 * (and if it never does — an old client with no such setting yields undefined, which the
 * `!== false` read below treats as the default rather than as "off").
 */
let tagTracingEnabled = true;
function getMetaCacheFile() {
    var _a;
    const base = (_a = process.env.LOCALAPPDATA) !== null && _a !== void 0 ? _a : path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'DenizenVSCodeExtension', 'cache', 'meta-blocks-cache.json');
}
function getExtraDataCacheFile() {
    var _a;
    const base = (_a = process.env.LOCALAPPDATA) !== null && _a !== void 0 ? _a : path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'DenizenVSCodeExtension', 'cache', 'minecraft.fds');
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
            // The C# server advertises " .=<[;" (InitializationService.cs:34); '-' and ':'
            // are ours, for command names and key lines. The union matters because the two
            // engines are switchable at runtime: a character missing here is a completion
            // that fires in one engine and silently never fires in the other. '<' and '.'
            // in particular are what make tag completion appear as the tag is typed rather
            // than only after a word character. '=', '[' and ';' serve tag-parameter
            // completion, which is not ported yet — they request and get an empty list
            // today, and start returning results when that lands.
            triggerCharacters: ['-', ' ', ':', '<', '.', '=', '[', ';']
        },
        hoverProvider: true,
        signatureHelpProvider: {
            triggerCharacters: [' ', ':']
        },
    };
}
exports.buildCapabilities = buildCapabilities;
/**
 * Converts one `ScriptWarning` into an LSP `Diagnostic`.
 *
 * The range is single-line and the clamp is ported from `GetRange`
 * (DiagnosticProvider.cs:84-94). The C# gates its three `Math.Max(0, ...)` calls behind a
 * condition whose only other job is to log the anomaly to stderr; applying them
 * unconditionally is behaviourally identical, because when the condition is false all three
 * values are already non-negative and `Math.max(0, x)` is the identity on them.
 *
 * The clamp no longer has a live producer, and is retained deliberately rather than by
 * inertia. It used to have one: `useless_invalid_line` produced `startChar = -1` on any line
 * whose first non-space character was uppercase, because it passed
 * `lines[i].indexOf(cleanedLines[i][0])` while `cleanedLines` is lowercased and `lines` is
 * not. That was a user-visible defect -- the clamp silently moved the squiggle onto the
 * indent -- and it was fixed at source by user ruling (see the DELIBERATE DEVIATION note on
 * that branch in lineChecks.ts). The clamp stays because it is a faithful port of the C#'s
 * own defence (DiagnosticProvider.cs:86-92, which clamps AND logs the anomaly to stderr) and
 * because a negative character is not a legal LSP `Position`; it must not be read as
 * sanctioning a check that emits one. server.test.ts pins that no check does.
 *
 * NOT clamped: an `endChar` past the end of the line, which `color_code_misformat` produces
 * when the section symbol is the final character (`index + 2` vs. a length of `index + 1`,
 * lineChecks.ts:219). The C# does not clamp it either, and the LSP spec defines a character
 * past the line length as the line length, so it is benign. It is left alone deliberately
 * rather than for lack of a line length to hand: `checker.lines` is not a safe source for
 * one, because `clearCommentsFromLines` blanks every comment line to `''`
 * (scriptChecker.ts:134-135) *after* `todo_comment` has recorded an end of that line's
 * original length -- clamping against it would collapse every TODO diagnostic to a
 * zero-width range at column 0, trading a benign over-long end for a real regression.
 *
 * Unlike the C#, this does not write the clamped values back onto the warning
 * (DiagnosticProvider.cs:89-91 mutates `warning` in place); the warning lists stay as the
 * checker produced them.
 */
function toDiagnostic(warning, severity) {
    const line = Math.max(0, warning.line);
    return {
        severity,
        range: {
            start: { line, character: Math.max(0, warning.startChar) },
            end: { line, character: Math.max(0, warning.endChar) }
        },
        source: DIAGNOSTIC_SOURCE,
        code: warning.warningUniqueKey,
        message: warning.customMessageForm
    };
}
/**
 * Maps a run checker's warnings onto LSP diagnostics. Ported from `PublishCheckerResults`
 * (DiagnosticProvider.cs:96-110), minus the publishing itself.
 *
 * Three lists, in this fixed order, with these severities. `infos` is deliberately absent:
 * the C# never publishes it either -- it exists to feed `CollectStatisticInfos`, and putting
 * per-script statistics in the Problems panel would be noise.
 *
 * Extracted from the connection wiring below so it is unit-testable without a live
 * connection, for the same reason `combineSources` and `buildCapabilities` are.
 */
function buildDiagnostics(checker) {
    return [
        // DiagnosticProvider.cs:99-102
        ...checker.errors.map(w => toDiagnostic(w, node_1.DiagnosticSeverity.Error)),
        // DiagnosticProvider.cs:103-106
        ...checker.warnings.map(w => toDiagnostic(w, node_1.DiagnosticSeverity.Warning)),
        // DiagnosticProvider.cs:107-110 -- Information, NOT Warning.
        ...checker.minorWarnings.map(w => toDiagnostic(w, node_1.DiagnosticSeverity.Information))
    ];
}
exports.buildDiagnostics = buildDiagnostics;
/**
 * Compiles the event could-matchers once BOTH loads have landed, and reports what it built.
 *
 * The meta and the Minecraft enum data are two independent promises and either may finish first,
 * so this is called from both handlers and does nothing until it has the pair. `linkEventMatchers`
 * is idempotent, but a null here is not a "not yet" to paper over -- without the enum data every
 * `<block>`/`<item>`/`<entity>` fill-in would have no validator, and every such event would end up
 * with no matchers at all rather than with permissive ones.
 *
 * Exported for the same reason as `buildDiagnostics`: testable without a live connection.
 */
function linkMatchersWhenReady(docs, extra) {
    if (docs === null || extra === null) {
        return null;
    }
    (0, metaLinker_1.linkEventMatchers)(docs, extra);
    let total = 0;
    for (const event of docs.events.values()) {
        total += event.couldMatchers.length;
    }
    return total;
}
exports.linkMatchersWhenReady = linkMatchersWhenReady;
/**
 * Converts a `file://` URI to a filesystem path.
 *
 * The C# does this by hand in 24 lines (`WorkspaceTracker.FixPath`), including a heuristic OS check
 * on the first three characters to decide whether to strip Windows' leading slash. `fileURLToPath`
 * is the same job done by the platform, and gets the escaping right too.
 *
 * Exported for testing; a non-`file:` URI (an unsaved buffer, or the map-tag peek scheme) has no
 * path at all and yields null rather than a guess.
 */
function uriToPath(uri) {
    try {
        return url.fileURLToPath(uri);
    }
    catch (_a) {
        return null;
    }
}
exports.uriToPath = uriToPath;
function createServer() {
    const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
    const documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
    const tracker = new workspaceTracker_1.WorkspaceTracker();
    connection.onInitialize((params) => {
        var _a, _b, _c, _d;
        // The workspace root, taken from whichever of the two the client sent. `workspaceFolders`
        // is the modern form and may hold several; the C# tracks exactly one (`WorkspacePath`), so
        // the first is used and the rest ignored rather than silently merged into one namespace.
        const folder = (_d = (_c = (_b = (_a = params.workspaceFolders) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.uri) !== null && _c !== void 0 ? _c : params.rootUri) !== null && _d !== void 0 ? _d : null;
        tracker.root = folder === null ? null : uriToPath(folder);
        return { capabilities: buildCapabilities() };
    });
    /**
     * Runs the first-time workspace scan, once, when both loads have landed.
     *
     * WAITING FOR THE META IS THE POINT. The scan checks every file and publishes what it finds, so
     * running it early would publish a workspace full of diagnostics produced with no meta -- every
     * command unknown, every tag untraced -- and then never correct them, because the scan only
     * happens once. Both load handlers call this and it no-ops until it has the pair, the same
     * shape as `linkMatchersWhenReady`.
     *
     * Synchronous, and deliberately: it runs once at startup, and the alternative -- yielding
     * between files -- would mean the workspace data is half-built while diagnostics are already
     * being answered against it, which is worse than a pause nobody is typing through.
     */
    function scanWorkspace() {
        if (tracker.everScanned || loadedDocs === null || loadedExtra === null || tracker.root === null || !tracker.enabled) {
            return;
        }
        const started = Date.now();
        const results = tracker.firstScan({ meta: loadedDocs, extra: loadedExtra });
        for (const [filePath, checker] of results) {
            // Publish for every file, not only open ones -- that is what makes a fresh window show
            // problems in files the user has not touched (WorkspaceTracker.cs:131).
            connection.sendDiagnostics({ uri: url.pathToFileURL(filePath).toString(), diagnostics: buildDiagnostics(checker) });
        }
        const scripts = tracker.workspaceData === null ? 0 : tracker.workspaceData.scripts.size;
        connection.console.log(`Workspace scanned: ${results.size} file(s), ${scripts} script container(s), in ${Date.now() - started}ms.`);
    }
    connection.onInitialized(() => {
        connection.workspace.getConfiguration('denizenscript.behaviors.track_full_workspace')
            .then((track) => {
            tracker.enabled = track !== false;
            connection.console.log(`Workspace tracking (denizenscript.behaviors.track_full_workspace): ${tracker.enabled ? 'on' : 'off'}.`);
            scanWorkspace();
        })
            .catch(err => {
            var _a;
            connection.console.error(`Reading denizenscript.behaviors.track_full_workspace failed, leaving it on: ${err instanceof Error ? (_a = err.stack) !== null && _a !== void 0 ? _a : err.message : String(err)}`);
        });
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
            const matchers = linkMatchersWhenReady(loadedDocs, loadedExtra);
            if (matchers !== null) {
                connection.console.log(`Event could-matchers built: ${matchers}.`);
            }
            for (const err of docs.loadErrors.slice(0, 20)) {
                connection.console.warn(`Meta load error: ${err}`);
            }
            scanWorkspace();
        })
            .catch(err => {
            var _a;
            connection.console.error(`Denizen meta load failed: ${err instanceof Error ? (_a = err.stack) !== null && _a !== void 0 ? _a : err.message : String(err)}`);
        });
        connection.workspace.getConfiguration('denizenscript.server.tagTracing')
            .then((tagTracing) => {
            tagTracingEnabled = tagTracing !== false;
            connection.console.log(`Tag tracing (denizenscript.server.tagTracing): ${tagTracingEnabled ? 'on' : 'off'}.`);
        })
            .catch(err => {
            var _a;
            connection.console.error(`Reading denizenscript.server.tagTracing failed, leaving it on: ${err instanceof Error ? (_a = err.stack) !== null && _a !== void 0 ? _a : err.message : String(err)}`);
        });
        (0, extraData_1.loadExtraData)({ cacheFile: getExtraDataCacheFile(), ttlMs: EXTRA_DATA_TTL_MS })
            .then(extra => {
            loadedExtra = extra;
            connection.console.log(`Minecraft enum data loaded: ${extra.sounds.size} sounds, ${extra.materials.size} materials, ${extra.entities.size} entities. ${extra.loadErrors.length} load error(s).`);
            const matchers = linkMatchersWhenReady(loadedDocs, loadedExtra);
            if (matchers !== null) {
                connection.console.log(`Event could-matchers built: ${matchers}.`);
            }
            for (const err of extra.loadErrors.slice(0, 20)) {
                connection.console.warn(`Extra data load error: ${err}`);
            }
            scanWorkspace();
        })
            .catch(err => {
            var _a;
            connection.console.error(`Minecraft enum data load failed: ${err instanceof Error ? (_a = err.stack) !== null && _a !== void 0 ? _a : err.message : String(err)}`);
        });
    });
    connection.onCompletion((params) => {
        var _a;
        const doc = documents.get(params.textDocument.uri);
        if (doc === undefined || loadedDocs === null || !params.textDocument.uri.endsWith('.dsc')) {
            return [];
        }
        try {
            // The workspace lets `<script>`, `<procedure_script_name>`, `<format_script>`,
            // `<inventory>`, `<item>`, `<entity_type>` and `<enchantment>` offer the user's own
            // script containers alongside the Minecraft enums. Null before the first scan, which
            // those completers read as "offer no scripts" rather than "no scripts exist".
            return (0, completionProvider_1.provideCompletions)(loadedDocs, loadedExtra, doc.getText(), doc.offsetAt(params.position), params.position.line, tagTracingEnabled, tracker.dataFor());
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
    connection.onSignatureHelp((params) => {
        var _a;
        const doc = documents.get(params.textDocument.uri);
        if (doc === undefined || loadedDocs === null || !params.textDocument.uri.endsWith('.dsc')) {
            return null;
        }
        try {
            return (0, signatureHelpProvider_1.provideSignatureHelp)(loadedDocs, doc.getText(), doc.offsetAt(params.position));
        }
        catch (err) {
            connection.console.error(`Signature help failed: ${err instanceof Error ? (_a = err.stack) !== null && _a !== void 0 ? _a : err.message : String(err)}`);
            return null;
        }
    });
    /**
     * The pending re-check for each open document, keyed by URI. At most one timer per
     * document is ever outstanding: scheduling again cancels the previous one, so a burst of
     * keystrokes costs exactly one check.
     */
    const pendingDiagnostics = new Map();
    /**
     * Runs the checker over a document and publishes the result.
     *
     * Re-reads the document by URI rather than closing over the `TextDocument` handed to the
     * change event: `TextDocuments.update` may return a new instance and re-key the map
     * (textDocuments.js, `onDidChangeTextDocument`), and a document closed during the debounce
     * window drops out of the map entirely -- in which case bailing here is what stops a late
     * timer from resurrecting the diagnostics that `onDidClose` just cleared.
     */
    function runDiagnostics(uri) {
        var _a;
        try {
            const doc = documents.get(uri);
            if (doc === undefined || !uri.endsWith('.dsc')) {
                return;
            }
            const checker = new scriptChecker_1.ScriptChecker(doc.getText());
            // ScriptChecker.cs:2023 does this inside Run() by reading the ambient
            // `MetaDocs.CurrentMeta`. There is no such singleton here, so the docs are handed in.
            //
            // `loadedDocs` MAY BE NULL, and unlike onCompletion/onHover/onSignatureHelp above,
            // this handler deliberately does NOT bail on that. Diagnostics are expected to work
            // from the first keystroke, before the meta download finishes; the checks that need
            // meta skip themselves, and the line and container checks -- which need none -- keep
            // running. Bailing here would mean a freshly opened file shows no diagnostics at all
            // until the network came back.
            checker.meta = loadedDocs;
            // THIS WAS MISSING UNTIL PHASE 2D, and it made two checks dead in the shipped server:
            // `enumerated_script_name` (containerChecks.ts) and, once it existed, every arm of
            // `checkTagParam`. Both read `checker.extraData` and both degrade to checking nothing
            // when it is null -- so the effect was silence, not a crash, which is why it went
            // unnoticed. Null here is still a real cold-start state; this only makes the data
            // reach the checker once it has loaded.
            checker.extraData = loadedExtra;
            // The other files around this one. Null until the first workspace scan finishes, or
            // for good if the user turned tracking off -- both of which every consumer treats as
            // "no cross-file knowledge", never as "nothing exists".
            checker.surroundingWorkspace = tracker.dataFor();
            checker.run();
            connection.sendDiagnostics({ uri, diagnostics: buildDiagnostics(checker) });
            // Feed this file's own containers back in, so the NEXT file checked sees the edit.
            // The C# does the same at DiagnosticProvider.cs:134.
            const filePath = uriToPath(uri);
            if (filePath !== null) {
                tracker.replace(filePath, checker);
            }
        }
        catch (err) {
            // A malformed script is an ordinary thing for a user to be holding mid-edit; a dead
            // language server is not. Swallow and log, exactly as onCompletion above does.
            // (DiagnosticProvider.cs:74-81 and :136-139 both do the same, twice over.)
            //
            // The log is itself guarded, unlike the request handlers above: those run inside a
            // connection callback, so an exception has a caller to propagate to, whereas this
            // one runs from a bare `setTimeout`. If the connection is already disposed then
            // `sendDiagnostics` throws AND `console.error` throws, and that second throw escapes
            // the timer as an unhandled exception. `onExit` below clears the pending timers, so
            // this is the belt to that braces.
            try {
                connection.console.error(`Diagnostics failed: ${err instanceof Error ? (_a = err.stack) !== null && _a !== void 0 ? _a : err.message : String(err)}`);
            }
            catch (_b) {
                // Connection gone; there is nowhere left to report to.
            }
        }
    }
    function scheduleDiagnostics(uri) {
        if (!uri.endsWith('.dsc')) {
            return;
        }
        const existing = pendingDiagnostics.get(uri);
        if (existing !== undefined) {
            clearTimeout(existing);
        }
        pendingDiagnostics.set(uri, setTimeout(() => {
            pendingDiagnostics.delete(uri);
            runDiagnostics(uri);
        }, DIAGNOSTIC_DEBOUNCE_MS));
    }
    // This also covers publishing on open: TextDocuments fires onDidChangeContent from its
    // didOpen handler as well as its didChange one (textDocuments.js, `listen`), so a separate
    // onDidOpen registration would only schedule the same debounced run twice.
    documents.onDidChangeContent(change => {
        scheduleDiagnostics(change.document.uri);
    });
    documents.onDidClose(event => {
        const pending = pendingDiagnostics.get(event.document.uri);
        if (pending !== undefined) {
            clearTimeout(pending);
            pendingDiagnostics.delete(event.document.uri);
        }
        // An empty list is how LSP says "clear"; without it the Problems panel keeps showing
        // stale entries for a file that is no longer open. Unguarded by `.dsc` on purpose,
        // unlike the paths above: clearing a URI that was never published for is a no-op,
        // whereas failing to clear one that was leaves the user staring at dead diagnostics.
        connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
    });
    // Shutdown leaves any debounced re-check outstanding: `onDidClose` only fires for documents
    // the client actually closes, so a file still open when the client exits keeps its timer.
    // Dropping them here both stops the leak and stops a late timer from running `runDiagnostics`
    // against a disposed connection in the first place.
    connection.onExit(() => {
        for (const timer of pendingDiagnostics.values()) {
            clearTimeout(timer);
        }
        pendingDiagnostics.clear();
    });
    documents.listen(connection);
    return connection;
}
exports.createServer = createServer;
if (require.main === module) {
    createServer().listen();
}
//# sourceMappingURL=server.js.map