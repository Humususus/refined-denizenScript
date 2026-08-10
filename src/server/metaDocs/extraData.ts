/**
 * Minecraft enum data (sounds, materials, entities, …) used to complete command
 * argument values. Ported from SharpDenizenTools/MetaHandlers/ExtraData.cs.
 *
 * The C# reads the document with a general FDS parser. The published document is
 * entirely flat — every line is either a top-level `key:` or a `- value` entry,
 * with no nesting anywhere — so a purpose-built reader is used here instead.
 */

import * as fs from 'fs';
import * as path from 'path';
import { downloadBinary } from './metaLoader';

export const EXTRA_DATA_SOURCE = 'https://meta.denizenscript.com/data/minecraft.fds';

export interface ExtraData {
    blocks: Set<string>;
    items: Set<string>;
    particles: Set<string>;
    effects: Set<string>;
    sounds: Set<string>;
    entities: Set<string>;
    enchantments: Set<string>;
    biomes: Set<string>;
    attributes: Set<string>;
    gamerules: Set<string>;
    potionEffects: Set<string>;
    potions: Set<string>;
    statistics: Set<string>;
    /** Union of blocks and items. Not a document section — derived, as in C#. */
    materials: Set<string>;
    /** Every value from every section, for the script checker's keyword collision test. */
    all: Set<string>;
    /** Human-readable reasons the enum data failed to load; empty on success. */
    loadErrors: string[];
}

export function createEmptyExtraData(): ExtraData {
    return {
        blocks: new Set(), items: new Set(), particles: new Set(), effects: new Set(),
        sounds: new Set(), entities: new Set(), enchantments: new Set(), biomes: new Set(),
        attributes: new Set(), gamerules: new Set(), potionEffects: new Set(), potions: new Set(),
        statistics: new Set(), materials: new Set(), all: new Set(), loadErrors: []
    };
}

/** Reads the flat `key:` / `- value` document into section name -> raw values. */
export function parseFlatFds(content: string): Map<string, string[]> {
    const sections = new Map<string, string[]>();
    let current: string[] | null = null;
    for (const rawLine of content.split('\n')) {
        const line = rawLine.endsWith('\r') ? rawLine.substring(0, rawLine.length - 1) : rawLine;
        if (line.startsWith('- ')) {
            if (current !== null) {
                current.push(line.substring(2).trim());
            }
            continue;
        }
        if (line.endsWith(':') && line.length > 1 && !line.startsWith(' ')) {
            current = [];
            sections.set(line.substring(0, line.length - 1).toLowerCase(), current);
        }
    }
    return sections;
}

function setOf(sections: Map<string, string[]>, key: string, all: Set<string>): Set<string> {
    const result = new Set<string>();
    for (const value of sections.get(key) ?? []) {
        if (value.length > 0) {
            const lowered = value.toLowerCase();
            result.add(lowered);
            all.add(lowered);
        }
    }
    return result;
}

export function buildExtraData(sections: Map<string, string[]>): ExtraData {
    const all = new Set<string>();
    const blocks = setOf(sections, 'blocks', all);
    const items = setOf(sections, 'items', all);
    return {
        blocks,
        items,
        particles: setOf(sections, 'particles', all),
        effects: setOf(sections, 'effects', all),
        sounds: setOf(sections, 'sounds', all),
        entities: setOf(sections, 'entities', all),
        enchantments: setOf(sections, 'enchantments', all),
        biomes: setOf(sections, 'biomes', all),
        attributes: setOf(sections, 'attributes', all),
        gamerules: setOf(sections, 'gamerules', all),
        potionEffects: setOf(sections, 'potion_effects', all),
        potions: setOf(sections, 'potions', all),
        statistics: setOf(sections, 'statistics', all),
        materials: new Set([...blocks, ...items]),
        all,
        loadErrors: []
    };
}

function describeError(err: unknown): string {
    return err instanceof Error ? err.stack ?? err.message : String(err);
}

export interface LoadExtraDataOptions {
    cacheFile: string;
    ttlMs: number;
    source?: string;
    /** Injectable for testing; defaults to the real network downloadBinary(). */
    downloadFn?: (url: string) => Promise<Buffer>;
}

/**
 * Loads the enum data, preferring a cache file younger than `ttlMs`.
 * Never throws: on any failure it returns whatever it has, falling back to empty
 * sets, because argument-value completion degrading to nothing is far better
 * than the whole language server failing to start. The reason for any failure
 * is recorded on the returned ExtraData's `loadErrors` rather than being
 * silently swallowed.
 */
export async function loadExtraData(options: LoadExtraDataOptions): Promise<ExtraData> {
    const source = options.source ?? EXTRA_DATA_SOURCE;
    const download = options.downloadFn ?? downloadBinary;
    const loadErrors: string[] = [];
    try {
        if (fs.existsSync(options.cacheFile)) {
            const age = Date.now() - fs.statSync(options.cacheFile).mtimeMs;
            if (age < options.ttlMs) {
                return buildExtraData(parseFlatFds(fs.readFileSync(options.cacheFile, 'utf8')));
            }
        }
    }
    catch (err) {
        loadErrors.push(`Extra data cache read failed: ${describeError(err)}`);
        // fall through to a fresh download
    }
    try {
        const content = (await download(source)).toString('utf8');
        const data = buildExtraData(parseFlatFds(content));
        data.loadErrors.push(...loadErrors);
        if (data.all.size > 0) {
            fs.mkdirSync(path.dirname(options.cacheFile), { recursive: true });
            fs.writeFileSync(options.cacheFile, content);
        }
        return data;
    }
    catch (err) {
        loadErrors.push(`Extra data loading failed: ${describeError(err)}`);
        const data = createEmptyExtraData();
        data.loadErrors.push(...loadErrors);
        return data;
    }
}
