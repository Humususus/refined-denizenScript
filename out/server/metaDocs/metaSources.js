"use strict";
// Which meta sources to load (R6). No `vscode` import: the language server and the settings page
// read the settings through the same functions, so they cannot disagree about what is enabled.
//
// Storage: the built-in add-ons are switched by id in `denizenscript.server.enabled_addons`; the
// user's own sources stay in `denizenscript.server.extra_sources`, whose items may be the legacy
// string form or `{ name, url, enabled }`. Nothing rewrites the settings on upgrade -- a legacy
// string reads as enabled, and one that names an add-on's archive reads as that add-on switched on.
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
exports.sourceFromInput = exports.writeSourceSettings = exports.effectiveSources = exports.readSourceSettings = exports.sourceName = exports.ADDON_SOURCES = exports.OFFICIAL_SOURCES = exports.metaCacheDir = void 0;
const path = __importStar(require("path"));
/**
 * The per-source meta cache directory. The language server writes it and the Reinstall command
 * deletes it, both through this function, so the two cannot point at different places.
 */
function metaCacheDir(env, homedir) {
    var _a;
    const base = (_a = env.LOCALAPPDATA) !== null && _a !== void 0 ? _a : path.join(homedir, 'AppData', 'Local');
    return path.join(base, 'DenizenVSCodeExtension', 'cache', 'meta-sources');
}
exports.metaCacheDir = metaCacheDir;
/** Always loaded, unless replaced (`replace_default_sources`). */
exports.OFFICIAL_SOURCES = [
    { name: 'Denizen', url: 'https://github.com/DenizenScript/Denizen/archive/dev.zip' },
    { name: 'Denizen-Core', url: 'https://github.com/DenizenScript/Denizen-Core/archive/master.zip' },
    { name: 'Depenizen', url: 'https://github.com/DenizenScript/Depenizen/archive/master.zip' },
    { name: 'dDiscordBot', url: 'https://github.com/DenizenScript/dDiscordBot/archive/master.zip' },
];
/** Built-in add-ons, off by default; links from the user, 2026-10-27. */
exports.ADDON_SOURCES = [
    { id: 'denizenm', name: 'DenizenM', author: 'EnergoBro', url: 'https://github.com/Energobro/DenizenM-Tjtoxshpilivili1/archive/refs/heads/master.zip' },
    { id: 'denizenm-core', name: 'DenizenM-Core', author: 'EnergoBro', url: 'https://github.com/Energobro/DenizenM-Core/archive/refs/heads/main.zip' },
    { id: 'denizen-utilities', name: 'denizen-utilities', author: 'isnsest', url: 'https://github.com/isnsest/denizen-utilities/archive/refs/heads/main.zip' },
    { id: 'denizen-reflect', name: 'denizen-reflect', author: 'isnsest', url: 'https://github.com/isnsest/denizen-reflect/archive/refs/heads/main.zip' },
];
/** `…/<owner>/<repo>/archive/…` → `<repo>`; otherwise the last path segment without `.zip`. */
function sourceName(url) {
    var _a;
    const github = /github\.com\/[^/]+\/([^/]+)\/archive\//i.exec(url);
    if (github) {
        return github[1];
    }
    const last = (_a = url.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop()) !== null && _a !== void 0 ? _a : url;
    return last.replace(/\.zip$/i, '') || url;
}
exports.sourceName = sourceName;
function readSourceSettings(extraSources, enabledAddons, replaceDefaults) {
    const enabled = new Set(Array.isArray(enabledAddons) ? enabledAddons.filter((id) => typeof id === 'string') : []);
    const custom = [];
    for (const item of Array.isArray(extraSources) ? extraSources : []) {
        const entry = readEntry(item);
        if (entry === null) {
            continue;
        }
        const addon = exports.ADDON_SOURCES.find(a => a.url === entry.url);
        if (addon) {
            if (entry.enabled) {
                enabled.add(addon.id);
            }
        }
        else if (!custom.some(c => c.url === entry.url)) {
            custom.push(entry);
        }
    }
    return {
        addons: exports.ADDON_SOURCES.map(a => (Object.assign(Object.assign({}, a), { enabled: enabled.has(a.id) }))),
        custom,
        replaceDefaults: replaceDefaults === true,
    };
}
exports.readSourceSettings = readSourceSettings;
function readEntry(item) {
    if (typeof item === 'string') {
        const url = item.trim();
        return url.length > 0 ? { name: sourceName(url), url, enabled: true } : null;
    }
    if (item !== null && typeof item === 'object') {
        const { name, url, enabled } = item;
        if (typeof url !== 'string' || url.trim().length === 0) {
            return null;
        }
        const cleanUrl = url.trim();
        return { name: typeof name === 'string' && name.trim().length > 0 ? name.trim() : sourceName(cleanUrl), url: cleanUrl, enabled: enabled !== false };
    }
    return null;
}
/**
 * The URLs to load, in load order: official, enabled add-ons in catalogue order, enabled own
 * sources in list order. Later blocks win, so the user's fork overrides an add-on, which overrides
 * the official meta. With `replaceDefaults` the enabled ones replace the official sources -- unless
 * none is enabled: an empty list never means "no meta at all".
 */
function effectiveSources(s) {
    const extra = [...s.addons.filter(a => a.enabled).map(a => a.url), ...s.custom.filter(c => c.enabled).map(c => c.url)];
    const official = exports.OFFICIAL_SOURCES.map(o => o.url);
    if (extra.length === 0) {
        return official;
    }
    return s.replaceDefaults ? extra : [...official, ...extra];
}
exports.effectiveSources = effectiveSources;
/** What the settings page writes back: every own source kept, in the new form. */
function writeSourceSettings(s) {
    return {
        extra_sources: s.custom.map(c => ({ name: c.name, url: c.url, enabled: c.enabled })),
        enabled_addons: s.addons.filter(a => a.enabled).map(a => a.id),
    };
}
exports.writeSourceSettings = writeSourceSettings;
/**
 * A source from what the user pasted: a direct `https://…zip` link, or a GitHub repository, which
 * becomes its default branch's archive (`/archive/HEAD.zip`, checked 2026-10-27). Null for anything
 * else, and for a source that is already listed.
 */
function sourceFromInput(input, existing) {
    const text = input.trim();
    let url = null;
    const repo = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(text);
    if (repo) {
        url = `https://github.com/${repo[1]}/${repo[2]}/archive/HEAD.zip`;
    }
    else if (/^https:\/\/[^\s/]+\/\S*\.zip$/i.test(text)) {
        url = text;
    }
    if (url === null) {
        return null;
    }
    const listed = [...exports.OFFICIAL_SOURCES, ...existing.addons, ...existing.custom].some(s => s.url === url);
    return listed ? null : { name: sourceName(url), url, enabled: true };
}
exports.sourceFromInput = sourceFromInput;
//# sourceMappingURL=metaSources.js.map