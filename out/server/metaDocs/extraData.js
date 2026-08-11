"use strict";
/**
 * Minecraft enum data (sounds, materials, entities, …) used to complete command
 * argument values. Ported from SharpDenizenTools/MetaHandlers/ExtraData.cs.
 *
 * The C# reads the document with a general FDS parser. The published document is
 * entirely flat — every line is either a top-level `key:` or a `- value` entry,
 * with no nesting anywhere — so a purpose-built reader is used here instead.
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
exports.loadExtraData = exports.buildExtraData = exports.parseFlatFds = exports.createEmptyExtraData = exports.EXTRA_DATA_SOURCE = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const metaLoader_1 = require("./metaLoader");
exports.EXTRA_DATA_SOURCE = 'https://meta.denizenscript.com/data/minecraft.fds';
function createEmptyExtraData() {
    return {
        blocks: new Set(), items: new Set(), particles: new Set(), effects: new Set(),
        sounds: new Set(), entities: new Set(), enchantments: new Set(), biomes: new Set(),
        attributes: new Set(), gamerules: new Set(), potionEffects: new Set(), potions: new Set(),
        statistics: new Set(), materials: new Set(), all: new Set(), loadErrors: []
    };
}
exports.createEmptyExtraData = createEmptyExtraData;
/** Reads the flat `key:` / `- value` document into section name -> raw values. */
function parseFlatFds(content) {
    const sections = new Map();
    let current = null;
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
exports.parseFlatFds = parseFlatFds;
function setOf(sections, key, all) {
    var _a;
    const result = new Set();
    for (const value of (_a = sections.get(key)) !== null && _a !== void 0 ? _a : []) {
        if (value.length > 0) {
            const lowered = value.toLowerCase();
            result.add(lowered);
            all.add(lowered);
        }
    }
    return result;
}
function buildExtraData(sections) {
    const all = new Set();
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
exports.buildExtraData = buildExtraData;
function describeError(err) {
    var _a;
    return err instanceof Error ? (_a = err.stack) !== null && _a !== void 0 ? _a : err.message : String(err);
}
/**
 * Loads the enum data, preferring a cache file younger than `ttlMs`.
 * Never throws: on any failure it returns whatever it has, falling back to empty
 * sets, because argument-value completion degrading to nothing is far better
 * than the whole language server failing to start. The reason for any failure
 * is recorded on the returned ExtraData's `loadErrors` rather than being
 * silently swallowed.
 */
function loadExtraData(options) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
        const source = (_a = options.source) !== null && _a !== void 0 ? _a : exports.EXTRA_DATA_SOURCE;
        const download = (_b = options.downloadFn) !== null && _b !== void 0 ? _b : metaLoader_1.downloadBinary;
        const loadErrors = [];
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
            const content = (yield download(source)).toString('utf8');
            const data = buildExtraData(parseFlatFds(content));
            data.loadErrors.push(...loadErrors);
            // The write is its own try/catch, separate from the download+parse above:
            // a read-only cache directory, a full disk, or antivirus locking the file
            // must not discard a perfectly good freshly-parsed result. Record the
            // failure and return the data anyway rather than falling through to the
            // outer catch's empty sets.
            try {
                if (data.all.size > 0) {
                    fs.mkdirSync(path.dirname(options.cacheFile), { recursive: true });
                    fs.writeFileSync(options.cacheFile, content);
                }
            }
            catch (writeErr) {
                data.loadErrors.push(`Extra data cache write failed: ${describeError(writeErr)}`);
            }
            return data;
        }
        catch (err) {
            loadErrors.push(`Extra data loading failed: ${describeError(err)}`);
            const data = createEmptyExtraData();
            data.loadErrors.push(...loadErrors);
            return data;
        }
    });
}
exports.loadExtraData = loadExtraData;
//# sourceMappingURL=extraData.js.map