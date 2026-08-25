/**
 * TypeScript LSP server entry point. Connects, loads meta documentation, and
 * serves command completion, hover, signature help, and script-checker diagnostics.
 */

import * as os from 'os';
import * as path from 'path';
import {
    createConnection, ProposedFeatures, TextDocuments, TextDocumentSyncKind,
    InitializeParams, InitializeResult, Connection, ServerCapabilities,
    CompletionItem, Hover, SignatureHelp, TextDocumentPositionParams,
    Diagnostic, DiagnosticSeverity
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { loadMetaDocs, DEFAULT_META_SOURCES } from './metaDocs/metaDocsManager';
import { MetaDocs } from './metaDocs/metaTypes';
import { ExtraData, createEmptyExtraData, loadExtraData } from './metaDocs/extraData';
import { provideCompletions } from './providers/completionProvider';
import { provideHover } from './providers/hoverProvider';
import { provideSignatureHelp } from './providers/signatureHelpProvider';
import { ScriptChecker } from './checker/scriptChecker';
import { ScriptWarning } from './checker/scriptWarnings';

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
let loadedDocs: MetaDocs | null = null;

/** Minecraft enum data. Starts empty so completion degrades gracefully while loading. */
let loadedExtra: ExtraData = createEmptyExtraData();

/**
 * The `denizenscript.server.tagTracing` setting: whether tag-part completion is narrowed
 * to the traced return type of the preceding part. Defaults to true, matching
 * package.json, so completion behaves correctly before the configuration read resolves
 * (and if it never does — an old client with no such setting yields undefined, which the
 * `!== false` read below treats as the default rather than as "off").
 */
let tagTracingEnabled = true;

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
function toDiagnostic(warning: ScriptWarning, severity: DiagnosticSeverity): Diagnostic {
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
export function buildDiagnostics(checker: ScriptChecker): Diagnostic[] {
    return [
        // DiagnosticProvider.cs:99-102
        ...checker.errors.map(w => toDiagnostic(w, DiagnosticSeverity.Error)),
        // DiagnosticProvider.cs:103-106
        ...checker.warnings.map(w => toDiagnostic(w, DiagnosticSeverity.Warning)),
        // DiagnosticProvider.cs:107-110 -- Information, NOT Warning.
        ...checker.minorWarnings.map(w => toDiagnostic(w, DiagnosticSeverity.Information))
    ];
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

        connection.workspace.getConfiguration('denizenscript.server.tagTracing')
            .then((tagTracing: boolean | undefined) => {
                tagTracingEnabled = tagTracing !== false;
                connection.console.log(`Tag tracing (denizenscript.server.tagTracing): ${tagTracingEnabled ? 'on' : 'off'}.`);
            })
            .catch(err => {
                connection.console.error(`Reading denizenscript.server.tagTracing failed, leaving it on: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
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
            return provideCompletions(loadedDocs, loadedExtra, doc.getText(), doc.offsetAt(params.position), params.position.line, tagTracingEnabled);
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

    connection.onSignatureHelp((params: TextDocumentPositionParams): SignatureHelp | null => {
        const doc = documents.get(params.textDocument.uri);
        if (doc === undefined || loadedDocs === null || !params.textDocument.uri.endsWith('.dsc')) {
            return null;
        }
        try {
            return provideSignatureHelp(loadedDocs, doc.getText(), doc.offsetAt(params.position));
        }
        catch (err) {
            connection.console.error(`Signature help failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
            return null;
        }
    });

    /**
     * The pending re-check for each open document, keyed by URI. At most one timer per
     * document is ever outstanding: scheduling again cancels the previous one, so a burst of
     * keystrokes costs exactly one check.
     */
    const pendingDiagnostics = new Map<string, ReturnType<typeof setTimeout>>();

    /**
     * Runs the checker over a document and publishes the result.
     *
     * Re-reads the document by URI rather than closing over the `TextDocument` handed to the
     * change event: `TextDocuments.update` may return a new instance and re-key the map
     * (textDocuments.js, `onDidChangeTextDocument`), and a document closed during the debounce
     * window drops out of the map entirely -- in which case bailing here is what stops a late
     * timer from resurrecting the diagnostics that `onDidClose` just cleared.
     */
    function runDiagnostics(uri: string): void {
        try {
            const doc = documents.get(uri);
            if (doc === undefined || !uri.endsWith('.dsc')) {
                return;
            }
            const checker = new ScriptChecker(doc.getText());
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
            checker.run();
            connection.sendDiagnostics({ uri, diagnostics: buildDiagnostics(checker) });
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
                connection.console.error(`Diagnostics failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
            }
            catch {
                // Connection gone; there is nowhere left to report to.
            }
        }
    }

    function scheduleDiagnostics(uri: string): void {
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

if (require.main === module) {
    createServer().listen();
}
