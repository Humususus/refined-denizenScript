// Which meta sources to load (R6). No `vscode` import: the language server and the settings page
// read the settings through the same functions, so they cannot disagree about what is enabled.
//
// Storage: the built-in add-ons are switched by id in `denizenscript.server.enabled_addons`; the
// user's own sources stay in `denizenscript.server.extra_sources`, whose items may be the legacy
// string form or `{ name, url, enabled }`. Nothing rewrites the settings on upgrade -- a legacy
// string reads as enabled, and one that names an add-on's archive reads as that add-on switched on.

import * as path from 'path';

/**
 * The per-source meta cache directory. The language server writes it and the Reinstall command
 * deletes it, both through this function, so the two cannot point at different places.
 */
export function metaCacheDir(env: { LOCALAPPDATA?: string }, homedir: string): string {
    const base = env.LOCALAPPDATA ?? path.join(homedir, 'AppData', 'Local');
    return path.join(base, 'DenizenVSCodeExtension', 'cache', 'meta-sources');
}

/** What the server reports after each meta load (`denizen/metaStatus`), for the settings page. */
export interface MetaStatus {
    loadedAt: number;
    sources: { url: string; state: 'downloaded' | 'unchanged' | 'cached-offline' | 'failed'; blocks: number }[];
    commands: number;
    tags: number;
    events: number;
    mechanisms: number;
}

export interface SourceInfo {
    name: string;
    url: string;
}

export interface AddonSource extends SourceInfo {
    id: string;
    author: string;
}

/** Always loaded, unless replaced (`replace_default_sources`). */
export const OFFICIAL_SOURCES: readonly SourceInfo[] = [
    { name: 'Denizen', url: 'https://github.com/DenizenScript/Denizen/archive/dev.zip' },
    { name: 'Denizen-Core', url: 'https://github.com/DenizenScript/Denizen-Core/archive/master.zip' },
    { name: 'Depenizen', url: 'https://github.com/DenizenScript/Depenizen/archive/master.zip' },
    { name: 'dDiscordBot', url: 'https://github.com/DenizenScript/dDiscordBot/archive/master.zip' },
];

/** Built-in add-ons, off by default; links from the user, 2026-10-27. */
export const ADDON_SOURCES: readonly AddonSource[] = [
    { id: 'denizenm', name: 'DenizenM', author: 'EnergoBro', url: 'https://github.com/Energobro/DenizenM-Tjtoxshpilivili1/archive/refs/heads/master.zip' },
    { id: 'denizenm-core', name: 'DenizenM-Core', author: 'EnergoBro', url: 'https://github.com/Energobro/DenizenM-Core/archive/refs/heads/main.zip' },
    { id: 'denizen-utilities', name: 'denizen-utilities', author: 'isnsest', url: 'https://github.com/isnsest/denizen-utilities/archive/refs/heads/main.zip' },
    { id: 'denizen-reflect', name: 'denizen-reflect', author: 'isnsest', url: 'https://github.com/isnsest/denizen-reflect/archive/refs/heads/main.zip' },
];

export interface CustomSource extends SourceInfo {
    enabled: boolean;
}

export interface SourceSettings {
    addons: (AddonSource & { enabled: boolean })[];
    custom: CustomSource[];
    replaceDefaults: boolean;
}

/** `…/<owner>/<repo>/archive/…` → `<repo>`; otherwise the last path segment without `.zip`. */
export function sourceName(url: string): string {
    const github = /github\.com\/[^/]+\/([^/]+)\/archive\//i.exec(url);
    if (github) {
        return github[1];
    }
    const last = url.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() ?? url;
    return last.replace(/\.zip$/i, '') || url;
}

export function readSourceSettings(extraSources: unknown, enabledAddons: unknown, replaceDefaults: unknown): SourceSettings {
    const enabled = new Set(Array.isArray(enabledAddons) ? enabledAddons.filter((id): id is string => typeof id === 'string') : []);
    const custom: CustomSource[] = [];
    for (const item of Array.isArray(extraSources) ? extraSources : []) {
        const entry = readEntry(item);
        if (entry === null) {
            continue;
        }
        const addon = ADDON_SOURCES.find(a => a.url === entry.url);
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
        addons: ADDON_SOURCES.map(a => ({ ...a, enabled: enabled.has(a.id) })),
        custom,
        replaceDefaults: replaceDefaults === true,
    };
}

function readEntry(item: unknown): CustomSource | null {
    if (typeof item === 'string') {
        const url = item.trim();
        return url.length > 0 ? { name: sourceName(url), url, enabled: true } : null;
    }
    if (item !== null && typeof item === 'object') {
        const { name, url, enabled } = item as { name?: unknown; url?: unknown; enabled?: unknown };
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
export function effectiveSources(s: SourceSettings): string[] {
    const extra = [...s.addons.filter(a => a.enabled).map(a => a.url), ...s.custom.filter(c => c.enabled).map(c => c.url)];
    const official = OFFICIAL_SOURCES.map(o => o.url);
    if (extra.length === 0) {
        return official;
    }
    return s.replaceDefaults ? extra : [...official, ...extra];
}

/** What the settings page writes back: every own source kept, in the new form. */
export function writeSourceSettings(s: SourceSettings): { extra_sources: CustomSource[]; enabled_addons: string[] } {
    return {
        extra_sources: s.custom.map(c => ({ name: c.name, url: c.url, enabled: c.enabled })),
        enabled_addons: s.addons.filter(a => a.enabled).map(a => a.id),
    };
}

/**
 * A source from what the user pasted: a direct `https://…zip` link, or a GitHub repository, which
 * becomes its default branch's archive (`/archive/HEAD.zip`, checked 2026-10-27). Null for anything
 * else, and for a source that is already listed.
 */
export function sourceFromInput(input: string, existing: SourceSettings): CustomSource | null {
    const text = input.trim();
    let url: string | null = null;
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
    const listed = [...OFFICIAL_SOURCES, ...existing.addons, ...existing.custom].some(s => s.url === url);
    return listed ? null : { name: sourceName(url), url, enabled: true };
}

/**
 * The checker's codes for a name the meta does not know -- the ones a switched-off source could
 * explain (R7, spec 6). Shared by the server, which adds the hint, and the client, whose quick fix
 * opens Meta sources.
 */
export const UNKNOWN_NAME_CODES: ReadonlySet<string> = new Set(['unknown_command', 'bad_tag_base', 'tag_trace_failure', 'bad_adjust_unknown_mech', 'event_missing']);

/** How the hint starts, so the client can tell a diagnostic carries it. */
export const DISABLED_SOURCES_HINT = ' — may come from a meta source that is switched off';

/**
 * The sentence appended to an unknown-name diagnostic, or null when every source is on. Nothing is
 * downloaded to check (user ruling), so it names what is off and leaves the choice to the user. The
 * official sources do not count when replaced: that is the user's own setting, not a missing add-on.
 */
export function disabledSourcesHint(s: SourceSettings): string | null {
    const off = [...s.addons.filter(a => !a.enabled), ...s.custom.filter(c => !c.enabled)].map(x => x.name);
    if (off.length === 0) {
        return null;
    }
    const names = off.length > 5 ? `${off.slice(0, 5).join(', ')} and ${off.length - 5} more` : off.join(', ');
    return `${DISABLED_SOURCES_HINT}: ${names}. Enable it in Denizen: Settings → Meta sources.`;
}
