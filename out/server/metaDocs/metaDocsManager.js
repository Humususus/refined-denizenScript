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
exports.loadMetaDocs = exports.cacheFileFor = exports.applyExtensions = exports.buildMetaDocs = exports.DEFAULT_META_SOURCES = void 0;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const metaLoader_1 = require("./metaLoader");
const metaLinker_1 = require("./metaLinker");
const metaObjectFactory_1 = require("./metaObjectFactory");
const metaTypes_1 = require("./metaTypes");
const metaSources_1 = require("./metaSources");
exports.DEFAULT_META_SOURCES = metaSources_1.OFFICIAL_SOURCES.map(s => s.url);
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
 * Bumped whenever a change makes previously cached BLOCKS wrong rather than merely old. 3 is the
 * per-source format (2.8.0); the 2.7.0 single file (`meta-blocks-cache.json`, version 2) lives
 * outside the cache directory and is neither read nor deleted.
 */
const CACHE_VERSION = 3;
/** The cache file for one source: named by a hash of its URL, and holding the URL to rule out a collision. */
function cacheFileFor(cacheDir, url) {
    return path.join(cacheDir, crypto.createHash('sha1').update(url).digest('hex') + '.json');
}
exports.cacheFileFor = cacheFileFor;
/** The cached copy of `url`, or null when there is none this code can trust (missing, corrupt, another version or URL). */
function readCache(file, url) {
    try {
        const cached = JSON.parse(fs.readFileSync(file, 'utf-8'));
        if ((cached === null || cached === void 0 ? void 0 : cached.version) === CACHE_VERSION && cached.url === url && Array.isArray(cached.blocks)) {
            return { etag: typeof cached.etag === 'string' ? cached.etag : null, blocks: cached.blocks };
        }
    }
    catch (_a) {
        // Missing or unreadable: no cache.
    }
    return null;
}
function loadSource(url, options, fetchFn) {
    return __awaiter(this, void 0, void 0, function* () {
        const file = cacheFileFor(options.cacheDir, url);
        const cached = readCache(file, url);
        const errors = [];
        try {
            const result = yield fetchFn(url, cached !== null && !options.forceRefresh ? cached.etag : null);
            if (result.status === 'not-modified') {
                if (cached === null) {
                    // Only possible from a server that ignores the missing If-None-Match; nothing to use.
                    throw new Error('the server answered "not modified" but nothing is cached');
                }
                return { blocks: cached.blocks, errors, status: { url, state: 'unchanged', blocks: cached.blocks.length } };
            }
            const blocks = (0, metaLoader_1.extractMetaBlocks)(url, (0, metaLoader_1.extractJavaCommentLines)(result.data), errors);
            // A parse complaint does not stop the source being cached: it downloaded completely, and
            // refusing would re-download it on every start for as long as upstream has one bad block.
            // Best-effort: a cache that cannot be written (read-only LOCALAPPDATA, a full disk) costs a
            // download next time, not the meta now -- final review, R6.
            try {
                fs.mkdirSync(options.cacheDir, { recursive: true });
                fs.writeFileSync(file, JSON.stringify({ version: CACHE_VERSION, url, etag: result.etag, blocks }));
            }
            catch (ex) {
                errors.push(`Could not cache meta for ${url}: ${ex instanceof Error ? ex.message : String(ex)}`);
            }
            return { blocks, errors, status: { url, state: 'downloaded', blocks: blocks.length } };
        }
        catch (ex) {
            const message = ex instanceof Error ? ex.message : String(ex);
            if (cached !== null) {
                // Old-but-complete beats none (2026-08-28: an unreachable CDN left the server with no
                // commands at all). The file is not re-stamped, so the next start tries the network again.
                errors.push(`Using cached meta for ${url}: ${message}`);
                return { blocks: cached.blocks, errors, status: { url, state: 'cached-offline', blocks: cached.blocks.length } };
            }
            // Nothing is written for a source that never arrived, so a failure cannot become a cache.
            errors.push(`Source download error for ${url}: ${message}`);
            return { blocks: [], errors, status: { url, state: 'failed', blocks: 0 } };
        }
    });
}
/**
 * Loads every source in `options.sources` -- and only those: a source that is switched off is
 * never fetched, even when its cache file is still on disk (spec 5b). Each is revalidated against
 * its cached ETag on every call, so an add-on its author updated is picked up on the next start;
 * the 2.7.0 cache instead reused one file for the whole list for 12 hours, which is why add-ons
 * "did not update after restarting VS Code".
 *
 * BLOCKS COME BACK IN SOURCE ORDER, NOT IN DOWNLOAD ORDER, and that is load-bearing: registration
 * is last-wins (`docs.commands.set(...)` in MetaObject.addTo), and the sources are listed official
 * first, then add-ons, then the user's own, so a fork overrides what it redefines. Fetches run in
 * parallel into per-source slots; the concatenation is the list's order (reported 2026-09-03,
 * when blocks landed in completion order and the network decided which source won).
 */
function loadMetaDocs(options) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const fetchFn = (_a = options.fetchFn) !== null && _a !== void 0 ? _a : metaLoader_1.fetchArchive;
        const results = yield Promise.all(options.sources.map(url => loadSource(url, options, fetchFn)));
        const docs = buildMetaDocs(results.flatMap(r => r.blocks));
        docs.loadErrors.push(...results.flatMap(r => r.errors));
        applyExtensions(docs);
        // linkTypeGraph must run after applyExtensions, not before: extensions
        // can rewrite a type's @base or a tag's @returns, and linking earlier
        // would resolve the object-type graph against the pre-extension values.
        (0, metaLinker_1.linkTypeGraph)(docs);
        return { docs, status: results.map(r => r.status) };
    });
}
exports.loadMetaDocs = loadMetaDocs;
//# sourceMappingURL=metaDocsManager.js.map