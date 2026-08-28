"use strict";
/**
 * Orchestrates meta loading: downloads all source archives, extracts and
 * parses their doc blocks into a MetaDocs, applies MetaExtension merges,
 * and caches the extracted blocks to disk with a TTL. Ported from
 * SharpDenizenTools/MetaHandlers/MetaDocsLoader.cs's DownloadAll and
 * MetaExtension.cs's PostCheck merge logic; caching follows the pattern
 * used by ExtraData.Load's file-based TTL cache.
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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadMetaDocs = exports.applyExtensions = exports.buildMetaDocs = exports.downloadAllBlocks = exports.DEFAULT_META_SOURCES = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const metaLoader_1 = require("./metaLoader");
const metaLinker_1 = require("./metaLinker");
const metaObjectFactory_1 = require("./metaObjectFactory");
const metaTypes_1 = require("./metaTypes");
exports.DEFAULT_META_SOURCES = [
    'https://github.com/DenizenScript/Denizen/archive/dev.zip',
    'https://github.com/DenizenScript/Denizen-Core/archive/master.zip',
    'https://github.com/DenizenScript/Depenizen/archive/master.zip',
    'https://github.com/DenizenScript/dDiscordBot/archive/master.zip'
];
/** Downloads every source in parallel and extracts their raw meta blocks. A failure downloading one source is recorded as a load error and does not prevent the others from succeeding. */
function downloadAllBlocks(sources) {
    return __awaiter(this, void 0, void 0, function* () {
        const loadErrors = [];
        const allBlocks = [];
        // Which sources could not be FETCHED, as distinct from those that fetched and then produced a
        // parse complaint. `loadErrors` mixes both, and only the first kind means the result is
        // incomplete -- see the caching note in `loadMetaDocs`.
        const failedSources = [];
        yield Promise.all(sources.map((src) => __awaiter(this, void 0, void 0, function* () {
            try {
                const data = yield (0, metaLoader_1.downloadBinary)(src);
                const lines = (0, metaLoader_1.extractJavaCommentLines)(data);
                const blocks = (0, metaLoader_1.extractMetaBlocks)(src, lines, loadErrors);
                allBlocks.push(...blocks);
            }
            catch (ex) {
                failedSources.push(src);
                loadErrors.push(`Source download error for ${src}: ${ex instanceof Error ? ex.message : String(ex)}`);
            }
        })));
        return { blocks: allBlocks, loadErrors, failedSources };
    });
}
exports.downloadAllBlocks = downloadAllBlocks;
/** Constructs a fresh MetaDocs by parsing and registering every block. Does not apply extensions — call applyExtensions() afterward if extension merging is needed. */
function buildMetaDocs(blocks) {
    const docs = (0, metaTypes_1.createEmptyMetaDocs)();
    for (const block of blocks) {
        const obj = (0, metaObjectFactory_1.loadInObject)(block.objectType, block.url, block.data, docs.loadErrors);
        if (obj) {
            obj.addTo(docs);
        }
    }
    return docs;
}
exports.buildMetaDocs = buildMetaDocs;
/** Looks up a MetaObject by (type name, clean name) across every registry in docs. Returns undefined if the type name or the object name is unknown. */
function findTarget(docs, extendType, extendName) {
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
function applyExtensions(docs) {
    var _a;
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
                    const existing = (_a = target.rawValues.get(key)) !== null && _a !== void 0 ? _a : [];
                    existing.push(newValue);
                    target.rawValues.set(key, existing);
                }
            }
        }
    }
}
exports.applyExtensions = applyExtensions;
/**
 * Whether a cached source list is the same list, in the same order, as the one being asked for.
 *
 * Order is treated as significant because it is: `downloadAllBlocks` merges the archives in the
 * order given, and later blocks can override earlier ones, so two orderings of the same URLs can
 * legitimately produce different docs.
 */
function sameSources(cached, wanted) {
    return Array.isArray(cached)
        && cached.length === wanted.length
        && cached.every((s, i) => s === wanted[i]);
}
/** Loads MetaDocs, using a disk-cached copy of the extracted blocks when it exists, is within ttlMs, and was built from the same source list; otherwise re-downloading and refreshing the cache. */
function loadMetaDocs(options) {
    var _a, _b, _c;
    return __awaiter(this, void 0, void 0, function* () {
        const sources = (_a = options.sources) !== null && _a !== void 0 ? _a : exports.DEFAULT_META_SOURCES;
        const download = (_b = options.downloadFn) !== null && _b !== void 0 ? _b : downloadAllBlocks;
        let blocks = null;
        if (!options.forceRefresh && fs.existsSync(options.cacheFile)) {
            const age = Date.now() - fs.statSync(options.cacheFile).mtimeMs;
            if (age < options.ttlMs) {
                try {
                    const cached = JSON.parse(fs.readFileSync(options.cacheFile, 'utf-8'));
                    // The cache is keyed by the SOURCE LIST as well as by age. Without this the
                    // cache was identified by file path alone, so adding or removing an entry in
                    // `denizenscript.server.extra_sources` changed nothing until the 12-hour TTL
                    // happened to lapse -- which is exactly how the setting came to look broken.
                    //
                    // A bare array is the pre-2026-08-27 format. It needs no special case: it has no
                    // `sources` property, so `sameSources` sees undefined and rejects it, and the
                    // file is re-downloaded once on upgrade. An explicit `!Array.isArray` guard here
                    // was measured to be an equivalent mutant and removed rather than left as dead
                    // belt-and-braces.
                    if (sameSources(cached === null || cached === void 0 ? void 0 : cached.sources, sources)) {
                        blocks = cached.blocks;
                    }
                }
                catch (_d) {
                    blocks = null;
                }
            }
        }
        let loadErrors = [];
        if (blocks === null) {
            const result = yield download(sources);
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
            if (blocks.length > 0 && ((_c = result.failedSources) !== null && _c !== void 0 ? _c : []).length === 0) {
                fs.mkdirSync(path.dirname(options.cacheFile), { recursive: true });
                fs.writeFileSync(options.cacheFile, JSON.stringify({ sources, blocks }));
            }
        }
        const docs = buildMetaDocs(blocks);
        docs.loadErrors.push(...loadErrors);
        applyExtensions(docs);
        // linkTypeGraph must run after applyExtensions, not before: extensions
        // can rewrite a type's @base or a tag's @returns, and linking earlier
        // would resolve the object-type graph against the pre-extension values.
        (0, metaLinker_1.linkTypeGraph)(docs);
        return docs;
    });
}
exports.loadMetaDocs = loadMetaDocs;
//# sourceMappingURL=metaDocsManager.js.map