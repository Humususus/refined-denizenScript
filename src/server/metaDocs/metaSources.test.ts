import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
    ADDON_SOURCES, DISABLED_SOURCES_HINT, OFFICIAL_SOURCES, disabledSourcesHint, effectiveSources, metaCacheDir, readSourceSettings,
    sourceFromInput, sourceName,
    writeSourceSettings
} from './metaSources';
import { DEFAULT_META_SOURCES } from './metaDocsManager';

const DM = 'https://github.com/Energobro/DenizenM-Tjtoxshpilivili1/archive/refs/heads/master.zip';
const DM_CORE = 'https://github.com/Energobro/DenizenM-Core/archive/refs/heads/main.zip';
const UTIL = 'https://github.com/isnsest/denizen-utilities/archive/refs/heads/main.zip';
const REFLECT = 'https://github.com/isnsest/denizen-reflect/archive/refs/heads/main.zip';

describe('catalogue', () => {
    // The user's links, 2026-10-27.
    it('lists the four add-ons in order with the user\'s links', () => {
        expect(ADDON_SOURCES.map(a => [a.id, a.url])).toEqual([
            ['denizenm', DM], ['denizenm-core', DM_CORE], ['denizen-utilities', UTIL], ['denizen-reflect', REFLECT]
        ]);
    });
    it('the official sources are the defaults', () => {
        expect(OFFICIAL_SOURCES.map(s => s.url)).toEqual(DEFAULT_META_SOURCES);
        expect(OFFICIAL_SOURCES.map(s => s.name)).toEqual(['Denizen', 'Denizen-Core', 'Depenizen', 'dDiscordBot']);
    });
});

describe('readSourceSettings', () => {
    it('a fresh install has every add-on off and loads only the official meta', () => {
        const s = readSourceSettings(undefined, undefined, undefined);
        expect(s.addons.map(a => a.enabled)).toEqual([false, false, false, false]);
        expect(s.custom).toEqual([]);
        expect(effectiveSources(s)).toEqual(DEFAULT_META_SOURCES);
    });
    // Spec 5b anti-goal: the user must not lose their extra_sources on upgrade.
    it('reads legacy strings as enabled, and an add-on\'s URL as that add-on switched on', () => {
        const s = readSourceSettings([DM_CORE, 'https://my.fork/x.zip'], [], false);
        expect(s.addons.find(a => a.id === 'denizenm-core')!.enabled).toBe(true);
        expect(s.custom).toEqual([{ name: 'x', url: 'https://my.fork/x.zip', enabled: true }]);
    });
    it('reads objects, keeping their switch', () => {
        const s = readSourceSettings([{ name: 'Mine', url: 'https://my.fork/x.zip', enabled: false }], ['denizen-reflect'], false);
        expect(s.custom).toEqual([{ name: 'Mine', url: 'https://my.fork/x.zip', enabled: false }]);
        expect(s.addons.find(a => a.id === 'denizen-reflect')!.enabled).toBe(true);
    });
    it('skips junk instead of throwing', () => {
        expect(readSourceSettings([null, 3, {}, { url: '' }, '  ', { url: 7 }], 'nope', 'yes').custom).toEqual([]);
        expect(readSourceSettings('not an array', [42, 'unknown-id'], false).addons.every(a => !a.enabled)).toBe(true);
    });
    it('drops a duplicate own source', () => {
        expect(readSourceSettings(['https://a/x.zip', { url: 'https://a/x.zip', enabled: false }], [], false).custom.length).toBe(1);
    });
});

describe('effectiveSources', () => {
    // Spec 5b: a disabled source is never downloaded.
    it('leaves disabled add-ons and own sources out', () => {
        const s = readSourceSettings([{ url: 'https://a/off.zip', enabled: false }, 'https://a/on.zip'], ['denizen-reflect'], false);
        expect(effectiveSources(s)).toEqual([...DEFAULT_META_SOURCES, REFLECT, 'https://a/on.zip']);
    });
    it('loads official, then add-ons in catalogue order, then own sources in list order', () => {
        const s = readSourceSettings(['https://a/2.zip', 'https://a/1.zip'], ['denizen-reflect', 'denizenm'], false);
        expect(effectiveSources(s)).toEqual([...DEFAULT_META_SOURCES, DM, REFLECT, 'https://a/2.zip', 'https://a/1.zip']);
    });
    it('replace swaps the official sources for the enabled ones', () => {
        expect(effectiveSources(readSourceSettings(['https://a/f.zip'], ['denizenm'], true))).toEqual([DM, 'https://a/f.zip']);
    });
    // An empty list must never mean "no meta at all".
    it('replace with nothing enabled still loads the official meta', () => {
        expect(effectiveSources(readSourceSettings([{ url: 'https://a/f.zip', enabled: false }], [], true))).toEqual(DEFAULT_META_SOURCES);
    });
});

describe('writeSourceSettings', () => {
    it('round-trips through readSourceSettings', () => {
        const first = readSourceSettings([DM, 'https://a/x.zip', { name: 'Off', url: 'https://a/y.zip', enabled: false }], ['denizen-utilities'], true);
        const written = writeSourceSettings(first);
        expect(written.enabled_addons).toEqual(['denizenm', 'denizen-utilities']);
        expect(readSourceSettings(written.extra_sources, written.enabled_addons, true)).toEqual(first);
    });
});

describe('sourceFromInput', () => {
    const none = readSourceSettings([], [], false);
    it('turns a GitHub repository into its default-branch archive', () => {
        const expected = { name: 'denizen-reflect', url: 'https://github.com/isnsest/denizen-reflect/archive/HEAD.zip', enabled: true };
        expect(sourceFromInput('github.com/isnsest/denizen-reflect', none)).toEqual(expected);
        expect(sourceFromInput('https://github.com/isnsest/denizen-reflect.git/', none)).toEqual(expected);
        expect(sourceFromInput('  https://github.com/isnsest/denizen-reflect  ', none)).toEqual(expected);
    });
    it('keeps a direct zip link', () => {
        expect(sourceFromInput('https://example.com/a/b/meta.zip', none)).toEqual({ name: 'meta', url: 'https://example.com/a/b/meta.zip', enabled: true });
    });
    it('rejects what is not a source, or a source already listed', () => {
        for (const bad of ['github.com/owner', 'ftp://x/y.zip', '', 'https://example.com/page', REFLECT, DEFAULT_META_SOURCES[0]]) {
            expect(sourceFromInput(bad, none), bad).toBeNull();
        }
        expect(sourceFromInput('https://a/x.zip', readSourceSettings(['https://a/x.zip'], [], false))).toBeNull();
    });
});

// R7, spec 6: an unknown name may live in a source that is switched off; nothing is downloaded to check.
describe('disabledSourcesHint', () => {
    it('names the switched-off add-ons on a fresh install', () => {
        expect(disabledSourcesHint(readSourceSettings(undefined, undefined, undefined))).toBe(
            `${DISABLED_SOURCES_HINT}: DenizenM, DenizenM-Core, denizen-utilities and 1 more. Enable it in Denizen: Settings → Meta sources.`);
    });
    it('gives nothing when every source is on', () => {
        const all = ADDON_SOURCES.map(a => a.id);
        expect(disabledSourcesHint(readSourceSettings(['https://a/on.zip'], all, false))).toBeNull();
    });
    it('counts an own source that is off, not one that is on', () => {
        const all = ADDON_SOURCES.map(a => a.id);
        const s = readSourceSettings([{ name: 'MyFork', url: 'https://a/f.zip', enabled: false }, 'https://a/on.zip'], all, false);
        expect(disabledSourcesHint(s)).toBe(`${DISABLED_SOURCES_HINT}: MyFork. Enable it in Denizen: Settings → Meta sources.`);
    });
    it('lists up to three names', () => {
        const s = readSourceSettings([], ['denizenm'], false);
        expect(disabledSourcesHint(s)).toContain(': DenizenM-Core, denizen-utilities, denizen-reflect.');
    });
});

// The server writes this directory and the Reinstall command deletes it: one function, so the
// two cannot drift apart.
describe('metaCacheDir', () => {
    it('lives under LOCALAPPDATA, else under the home directory', () => {
        expect(metaCacheDir({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'C:\\Users\\u'))
            .toBe(path.join('C:\\Users\\u\\AppData\\Local', 'DenizenVSCodeExtension', 'cache', 'meta-sources'));
        expect(metaCacheDir({}, '/home/u')).toBe(path.join('/home/u', 'AppData', 'Local', 'DenizenVSCodeExtension', 'cache', 'meta-sources'));
    });
});

describe('sourceName', () => {
    it('names a GitHub archive by its repository, anything else by its file', () => {
        expect(sourceName(DM)).toBe('DenizenM-Tjtoxshpilivili1');
        expect(sourceName('https://example.com/dl/meta.zip')).toBe('meta');
    });
});
