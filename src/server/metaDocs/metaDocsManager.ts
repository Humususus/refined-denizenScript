/**
 * Orchestrates meta loading: downloads all source archives, extracts and
 * parses their doc blocks into a MetaDocs, applies MetaExtension merges,
 * and caches the extracted blocks to disk with a TTL. Ported from
 * SharpDenizenTools/MetaHandlers/MetaDocsLoader.cs's DownloadAll and
 * MetaExtension.cs's PostCheck merge logic; caching follows the pattern
 * used by ExtraData.Load's file-based TTL cache.
 */

import * as fs from 'fs';
import * as path from 'path';
import { downloadBinary, extractJavaCommentLines, extractMetaBlocks, MetaBlock } from './metaLoader';
import { linkTypeGraph } from './metaLinker';
import { loadInObject } from './metaObjectFactory';
import { MetaDocs, createEmptyMetaDocs } from './metaTypes';

export const DEFAULT_META_SOURCES: string[] = [
    'https://github.com/DenizenScript/Denizen/archive/dev.zip',
    'https://github.com/DenizenScript/Denizen-Core/archive/master.zip',
    'https://github.com/DenizenScript/Depenizen/archive/master.zip',
    'https://github.com/DenizenScript/dDiscordBot/archive/master.zip'
];

/** Downloads every source in parallel and extracts their raw meta blocks. A failure downloading one source is recorded as a load error and does not prevent the others from succeeding. */
export async function downloadAllBlocks(sources: string[]): Promise<{ blocks: MetaBlock[]; loadErrors: string[]; failedSources: string[] }> {
    const loadErrors: string[] = [];
    const allBlocks: MetaBlock[] = [];
    // Which sources could not be FETCHED, as distinct from those that fetched and then produced a
    // parse complaint. `loadErrors` mixes both, and only the first kind means the result is
    // incomplete -- see the caching note in `loadMetaDocs`.
    const failedSources: string[] = [];
    await Promise.all(sources.map(async src => {
        try {
            const data = await downloadBinary(src);
            const lines = extractJavaCommentLines(data);
            const blocks = extractMetaBlocks(src, lines, loadErrors);
            allBlocks.push(...blocks);
        }
        catch (ex) {
            failedSources.push(src);
            loadErrors.push(`Source download error for ${src}: ${ex instanceof Error ? ex.message : String(ex)}`);
        }
    }));
    return { blocks: allBlocks, loadErrors, failedSources };
}

/** Constructs a fresh MetaDocs by parsing and registering every block. Does not apply extensions — call applyExtensions() afterward if extension merging is needed. */
export function buildMetaDocs(blocks: MetaBlock[]): MetaDocs {
    const docs = createEmptyMetaDocs();
    for (const block of blocks) {
        const obj = loadInObject(block.objectType, block.url, block.data, docs.loadErrors);
        if (obj) {
            obj.addTo(docs);
        }
    }
    return docs;
}

/** Looks up a MetaObject by (type name, clean name) across every registry in docs. Returns undefined if the type name or the object name is unknown. */
function findTarget(docs: MetaDocs, extendType: string, extendName: string) {
    const type = extendType.toLowerCase();
    const name = extendName.toLowerCase();
    switch (type) {
        case 'command': return docs.commands.get(name);
        case 'mechanism': return docs.mechanisms.get(name);
        case 'tag': return docs.tags.get(name);
        case 'objecttype': return docs.objectTypes.get(name);
        case 'property': return docs.properties.get(name);
        case 'event': return docs.events.get(name);
        case 'action': return docs.actions.get(name);
        case 'language': return docs.languages.get(name);
        case 'guidepage': return docs.guidePages.get(name);
        default: return undefined;
    }
}

const KNOWN_EXTEND_TYPES = new Set(['command', 'mechanism', 'tag', 'objecttype', 'property', 'event', 'action', 'language', 'guidepage']);

/** Merges every registered MetaExtension's raw key/value pairs onto its target object, matching MetaExtension.cs's PostCheck. Must run after buildMetaDocs() has registered all non-extension objects. */
export function applyExtensions(docs: MetaDocs): void {
    for (const ext of docs.extensions.values()) {
        if (!ext.extendType || !ext.extendName || !ext.extensionName) {
            docs.loadErrors.push(`Extension is missing a required target_type, target_name, or name value.`);
            continue;
        }
        if (!KNOWN_EXTEND_TYPES.has(ext.extendType.toLowerCase())) {
            docs.loadErrors.push(`Extension '${ext.extensionName}' has invalid target meta type to extend: ${ext.extendType}.`);
            continue;
        }
        const target = findTarget(docs, ext.extendType, ext.extendName);
        if (!target) {
            docs.loadErrors.push(`Extension '${ext.extensionName}' has invalid target meta name to extend: ${ext.extendName}.`);
            continue;
        }
        const skipKeys = new Set(['target_type', 'target_name', 'name', 'include_existing']);
        for (const [key, values] of ext.rawValues) {
            if (skipKeys.has(key)) {
                continue;
            }
            const currentValues = ext.includeExisting ? target.rawValues.get(key) : undefined;
            const currentValue = currentValues && currentValues.length > 0 ? currentValues[currentValues.length - 1] : null;
            for (const value of values) {
                const newValue = currentValue !== null ? currentValue + '\n\n' + value : value;
                if (!target.applyValue(key, newValue)) {
                    docs.loadErrors.push(`Extension '${ext.extensionName}' could not extend ${ext.extendType} meta '${ext.extendName}', key/value pair '${key}' -> '${value}' is invalid.`);
                }
                else {
                    const existing = target.rawValues.get(key) ?? [];
                    existing.push(newValue);
                    target.rawValues.set(key, existing);
                }
            }
        }
    }
}

export interface LoadMetaDocsOptions {
    cacheFile: string;
    ttlMs: number;
    forceRefresh?: boolean;
    sources?: string[];
    /**
     * Injectable for testing; defaults to the real network `downloadAllBlocks()`.
     *
     * `failedSources` is optional so a fake can omit it, which reads as "every source was
     * fetched" -- the right default for a stub that is not simulating a network failure.
     */
    downloadFn?: (sources: string[]) => Promise<{ blocks: MetaBlock[]; loadErrors: string[]; failedSources?: string[] }>;
}

/**
 * Whether a cached source list is the same list, in the same order, as the one being asked for.
 *
 * Order is treated as significant because it is: `downloadAllBlocks` merges the archives in the
 * order given, and later blocks can override earlier ones, so two orderings of the same URLs can
 * legitimately produce different docs.
 */
function sameSources(cached: unknown, wanted: string[]): boolean {
    return Array.isArray(cached)
        && cached.length === wanted.length
        && cached.every((s, i) => s === wanted[i]);
}

/** Loads MetaDocs, using a disk-cached copy of the extracted blocks when it exists, is within ttlMs, and was built from the same source list; otherwise re-downloading and refreshing the cache. */
export async function loadMetaDocs(options: LoadMetaDocsOptions): Promise<MetaDocs> {
    const sources = options.sources ?? DEFAULT_META_SOURCES;
    const download = options.downloadFn ?? downloadAllBlocks;
    let blocks: MetaBlock[] | null = null;
    /**
     * The cached blocks when the file exists and matches the source list but is too OLD to use
     * outright. Kept as a FALLBACK for a download that fails, because a stale complete meta beats
     * no meta by a wide margin -- see where it is used below.
     */
    let staleBlocks: MetaBlock[] | null = null;
    if (!options.forceRefresh && fs.existsSync(options.cacheFile)) {
        const age = Date.now() - fs.statSync(options.cacheFile).mtimeMs;
        // Read regardless of age: an expired cache is still the fallback for a failed download.
        try {
            const cached = JSON.parse(fs.readFileSync(options.cacheFile, 'utf-8'));
            // The cache is keyed by the SOURCE LIST as well as by age. Without this the cache was
            // identified by file path alone, so adding or removing an entry in
            // `denizenscript.server.extra_sources` changed nothing until the 12-hour TTL happened
            // to lapse -- which is exactly how the setting came to look broken.
            //
            // A bare array is the pre-2026-08-27 format. It needs no special case: it has no
            // `sources` property, so `sameSources` sees undefined and rejects it, and the file is
            // re-downloaded once on upgrade. An explicit `!Array.isArray` guard here was measured
            // to be an equivalent mutant and removed rather than left as dead belt-and-braces.
            if (sameSources(cached?.sources, sources)) {
                // Fresh enough to use as-is; otherwise held only as a fallback.
                //
                // `<` vs `<=` at this boundary is a known equivalent mutant: it can only differ
                // when the age is exactly ttlMs to the millisecond, which a wall-clock delta does
                // not hit. `<` is used to match the sibling cache in extraData.ts:130.
                if (age < options.ttlMs) {
                    blocks = cached.blocks;
                }
                else {
                    staleBlocks = cached.blocks;
                }
            }
        }
        catch {
            // A corrupt or unreadable cache simply means "no cache", and both variables are still
            // null here: the only statements above that can throw are the read and the parse, and
            // both run before either is assigned. Resetting them was measured to be dead code
            // (mutation audit 2026-08-31, mutants M10/M12 survived every test) and removed rather
            // than left as belt-and-braces, the same call made for the Array.isArray guard above.
        }
    }
    let loadErrors: string[] = [];
    if (blocks === null) {
        const result = await download(sources);
        blocks = result.blocks;
        loadErrors = result.loadErrors;
        // DO NOT CACHE A PARTIAL DOWNLOAD. `blocks.length > 0` alone is far too weak a gate: the
        // sources are fetched in parallel and one failing still leaves the others' blocks, so a
        // flaky network produced a cache holding a FRACTION of the meta -- and then served it for
        // the next twelve hours. Observed 2026-08-28: caches written during a network wobble held
        // 536 tags instead of 2493, and every downstream check quietly degraded. Completion went
        // near-empty and the checker reported 87% of real command lines as unknown commands.
        //
        // `failedSources`, not `loadErrors`: the latter also collects PARSE complaints from
        // sources that downloaded perfectly well, so gating on it would mean never caching at all
        // the moment upstream meta contains one malformed block.
        const failed = result.failedSources ?? [];
        if (blocks.length > 0 && failed.length === 0) {
            fs.mkdirSync(path.dirname(options.cacheFile), { recursive: true });
            fs.writeFileSync(options.cacheFile, JSON.stringify({ sources, blocks }));
        }
        else if (staleBlocks !== null) {
            // FALL BACK TO THE EXPIRED CACHE. This is what turns a network outage from a
            // catastrophe into an inconvenience: the TTL lapsing does not make the cached meta
            // WRONG, only old, and old-but-complete beats a fraction of the meta or none of it.
            //
            // Without this, an expired cache plus an unreachable github.com left the server with
            // no commands at all -- so every line in every script was reported as an unknown
            // command and completion offered nothing. Observed 2026-08-28 while the CDN was
            // dropping TLS connections; the user's report was "everything is broken".
            //
            // The cache file is deliberately NOT re-stamped: its mtime is what will make the next
            // start try the network again, and touching it here would hide the staleness for
            // another full TTL.
            loadErrors.push(`Using cached meta from an earlier download: ${failed.length} of ${sources.length} source(s) could not be fetched.`);
            blocks = staleBlocks;
        }
    }
    const docs = buildMetaDocs(blocks);
    docs.loadErrors.push(...loadErrors);
    applyExtensions(docs);
    // linkTypeGraph must run after applyExtensions, not before: extensions
    // can rewrite a type's @base or a tag's @returns, and linking earlier
    // would resolve the object-type graph against the pre-extension values.
    linkTypeGraph(docs);
    return docs;
}
