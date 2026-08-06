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
import { loadInObject } from './metaObjectFactory';
import { MetaDocs, createEmptyMetaDocs } from './metaTypes';

export const DEFAULT_META_SOURCES: string[] = [
    'https://github.com/DenizenScript/Denizen/archive/dev.zip',
    'https://github.com/DenizenScript/Denizen-Core/archive/master.zip',
    'https://github.com/DenizenScript/Depenizen/archive/master.zip',
    'https://github.com/DenizenScript/dDiscordBot/archive/master.zip'
];

/** Downloads every source in parallel and extracts their raw meta blocks. A failure downloading one source is recorded as a load error and does not prevent the others from succeeding. */
export async function downloadAllBlocks(sources: string[]): Promise<{ blocks: MetaBlock[]; loadErrors: string[] }> {
    const loadErrors: string[] = [];
    const allBlocks: MetaBlock[] = [];
    await Promise.all(sources.map(async src => {
        try {
            const data = await downloadBinary(src);
            const lines = extractJavaCommentLines(data);
            const blocks = extractMetaBlocks(src, lines, loadErrors);
            allBlocks.push(...blocks);
        }
        catch (ex) {
            loadErrors.push(`Source download error for ${src}: ${ex instanceof Error ? ex.message : String(ex)}`);
        }
    }));
    return { blocks: allBlocks, loadErrors };
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
    /** Injectable for testing; defaults to the real network downloadAllBlocks(). */
    downloadFn?: (sources: string[]) => Promise<{ blocks: MetaBlock[]; loadErrors: string[] }>;
}

/** Loads MetaDocs, using a disk-cached copy of the extracted blocks when it exists and is within ttlMs, otherwise re-downloading and refreshing the cache. */
export async function loadMetaDocs(options: LoadMetaDocsOptions): Promise<MetaDocs> {
    const sources = options.sources ?? DEFAULT_META_SOURCES;
    const download = options.downloadFn ?? downloadAllBlocks;
    let blocks: MetaBlock[] | null = null;
    if (!options.forceRefresh && fs.existsSync(options.cacheFile)) {
        const age = Date.now() - fs.statSync(options.cacheFile).mtimeMs;
        if (age < options.ttlMs) {
            try {
                blocks = JSON.parse(fs.readFileSync(options.cacheFile, 'utf-8'));
            }
            catch {
                blocks = null;
            }
        }
    }
    let loadErrors: string[] = [];
    if (blocks === null) {
        const result = await download(sources);
        blocks = result.blocks;
        loadErrors = result.loadErrors;
        fs.mkdirSync(path.dirname(options.cacheFile), { recursive: true });
        fs.writeFileSync(options.cacheFile, JSON.stringify(blocks));
    }
    const docs = buildMetaDocs(blocks);
    docs.loadErrors.push(...loadErrors);
    applyExtensions(docs);
    return docs;
}
