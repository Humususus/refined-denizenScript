import { describe, it, expect } from 'vitest';
import { KNOWN_SCRIPT_TYPES, ALWAYS_SCRIPT_KEYS, ALWAYS_DATA_KEYS, matchesSet } from './scriptTypes';

/**
 * Every expectation in this file was hand-derived by reading
 * SharpDenizenTools/ScriptAnalysis/ScriptChecker.cs:22-48, :885-907 and :913-916.
 *
 * These tests are a SECOND line of defence, not the primary one. A unit test cannot really prove
 * a 16-row transcription: spot-checking four rows leaves twelve unchecked, and asserting all
 * sixteen just restates the implementation in a second file that can drift with it. The primary
 * proof is the throwaway extractor run in Task 2 step 4, which parses the C# source text and
 * diffs it field by field against the compiled table -- 181 key strings across 16 types, plus 10
 * standalone, zero differences.
 *
 * What these tests DO catch, and what the extractor cannot: the shape contract the rest of the
 * phase relies on (no undefined arrays, correct defaults, Map-not-object lookup) and the
 * behaviour of `matchesSet`.
 */

describe('KNOWN_SCRIPT_TYPES: shape', () => {
    it('has exactly 16 entries, in the C# declaration order', () => {
        // Counted mechanically off ScriptChecker.cs:22-42, not by eye -- the first draft of the
        // plan said 17. Five Denizen Core, eleven Denizen-Bukkit.
        // MUTANT CAUGHT: dropping or reordering an entry. Order matters here only as a proxy for
        // "transcribed from the source in one pass" -- nothing reads the map in order.
        expect(Array.from(KNOWN_SCRIPT_TYPES.keys())).toEqual([
            'custom', 'procedure', 'task', 'world', 'data',
            'assignment', 'book', 'command', 'economy', 'entity', 'format',
            'interact', 'inventory', 'item', 'map', 'enchantment'
        ]);
    });

    it('gives every entry all five key arrays, never undefined', () => {
        // ScriptChecker.cs:888-900: the C# field initialisers make these empty arrays, and
        // PreprocContainer calls .Contains on them unguarded (:1937, :1948). An `undefined` here
        // would be a TypeError at the first container of that type, not a wrong answer.
        // MUTANT CAUGHT: spreading the partial directly instead of going through knownType().
        for (const [name, type] of KNOWN_SCRIPT_TYPES) {
            for (const field of ['requiredKeys', 'likelyBadKeys', 'valueKeys', 'listKeys', 'scriptKeys'] as const) {
                expect(Array.isArray(type[field]), `${name}.${field}`).toBe(true);
            }
        }
    });

    it('applies the C# defaults: strict false, canHaveRandomScripts TRUE', () => {
        // The asymmetry at ScriptChecker.cs:903-906 and the easiest thing in the phase to get
        // backwards. Six of the sixteen entries omit CanHaveRandomScripts and rely on true:
        // procedure, task, world, assignment, command, interact. `task` is one of them, and it
        // is the type most scripts actually use.
        // MUTANT CAUGHT: defaulting canHaveRandomScripts to false, which would stop
        // PreprocContainer harvesting definitions from any non-standard key on a task -- and
        // that becomes a false "undefined definition" warning in 2C-4.
        expect(KNOWN_SCRIPT_TYPES.get('task')!.canHaveRandomScripts).toBe(true);
        expect(KNOWN_SCRIPT_TYPES.get('task')!.strict).toBe(false);
        expect(Array.from(KNOWN_SCRIPT_TYPES).filter(([, t]) => t.canHaveRandomScripts).map(([n]) => n))
            .toEqual(['procedure', 'task', 'world', 'assignment', 'command', 'interact']);
        // Eleven of the sixteen are strict; `task` and `world`, the two commonest, are not.
        expect(Array.from(KNOWN_SCRIPT_TYPES.values()).filter(t => t.strict).length).toBe(11);
    });

    it('is a Map, so a hostile type name cannot reach Object.prototype', () => {
        // ConvertContainers (ScriptChecker.cs:1706) looks this up with a string taken straight
        // from the user's `type:` key. On a plain object, `types['constructor']` returns a
        // function and the "unknown script type" branch would never fire for it.
        // MUTANT CAUGHT: exporting a Record<string, KnownScriptType> instead.
        expect(KNOWN_SCRIPT_TYPES.get('constructor')).toBeUndefined();
        expect(KNOWN_SCRIPT_TYPES.get('toString')).toBeUndefined();
        expect(KNOWN_SCRIPT_TYPES.get('__proto__')).toBeUndefined();
    });
});

describe('KNOWN_SCRIPT_TYPES: spot checks across the flag combinations', () => {
    it('procedure -- strict, with the default true canHaveRandomScripts and a "*" script key', () => {
        // ScriptChecker.cs:26.
        expect(KNOWN_SCRIPT_TYPES.get('procedure')).toEqual({
            requiredKeys: ['script'],
            likelyBadKeys: ['events', 'actions', 'steps'],
            valueKeys: ['definitions'],
            listKeys: [],
            scriptKeys: ['script', '*'],
            strict: true,
            canHaveRandomScripts: true
        });
    });

    it('data -- the type whose value and list keys are both a bare "*"', () => {
        // ScriptChecker.cs:29. The `*` is what makes matchesSet accept ANY key on a data
        // container, and PreprocContainer returns early for this type anyway (:1765).
        expect(KNOWN_SCRIPT_TYPES.get('data')).toEqual({
            requiredKeys: [],
            likelyBadKeys: ['script', 'actions', 'steps', 'events'],
            valueKeys: ['*'],
            listKeys: ['*'],
            scriptKeys: [],
            strict: false,
            canHaveRandomScripts: false
        });
    });

    it('custom -- a "*" mixed in with a real key, and dotted script keys', () => {
        // ScriptChecker.cs:25. `valueKeys` holding both 'inherit' and '*' is not redundant in
        // the C#'s own terms: CheckAllContainers (2C-4) reports on named keys separately.
        expect(KNOWN_SCRIPT_TYPES.get('custom')).toEqual({
            requiredKeys: [],
            likelyBadKeys: ['script', 'actions', 'events', 'steps'],
            valueKeys: ['inherit', '*'],
            listKeys: [],
            scriptKeys: ['tags.*', 'mechanisms.*'],
            strict: false,
            canHaveRandomScripts: false
        });
    });

    it('world -- the ".*" script key that makes an events block get walked as script', () => {
        // ScriptChecker.cs:28. `scriptKeys: ['events.*']` is exactly what PreprocContainer's
        // :1937 sub-map test looks for, via `keyName + '.*'`.
        expect(KNOWN_SCRIPT_TYPES.get('world')).toEqual({
            requiredKeys: ['events'],
            likelyBadKeys: ['script', 'actions', 'steps'],
            valueKeys: ['enabled'],
            listKeys: [],
            scriptKeys: ['events.*'],
            strict: false,
            canHaveRandomScripts: true
        });
    });
});

describe('ALWAYS_SCRIPT_KEYS / ALWAYS_DATA_KEYS', () => {
    it('are the C#\'s two standalone arrays, verbatim', () => {
        // ScriptChecker.cs:45 and :48.
        // MUTANT CAUGHT: dropping one of the six aliases for "script" -- a container using
        // `subtasks:` would stop having its definitions harvested.
        expect(ALWAYS_SCRIPT_KEYS).toEqual(['script', 'scripts', 'subscripts', 'subtasks', 'inject', 'injects', 'injectables', 'subprocedures']);
        expect(ALWAYS_DATA_KEYS).toEqual(['data', 'description']);
    });
});

describe('matchesSet', () => {
    it('matches the key itself', () => {
        // ScriptChecker.cs:915, first disjunct.
        expect(matchesSet('script', ['script', 'other'])).toBe(true);
        expect(matchesSet('script', ['other'])).toBe(false);
    });

    it('matches a key whose ".*" form is in the set', () => {
        // ScriptChecker.cs:915, second disjunct: `events` matches a set declaring `events.*`.
        // This is how a world container's events BLOCK is recognised from the bare key name.
        // MUTANT CAUGHT: testing `key.endsWith('.*')` or stripping the suffix from the set
        // instead of appending it to the key -- both look plausible and neither is this.
        expect(matchesSet('events', ['events.*'])).toBe(true);
        expect(matchesSet('events.*', ['events'])).toBe(false);
    });

    it('matches ANYTHING when the set contains a bare "*"', () => {
        // ScriptChecker.cs:915, third disjunct. Asserted separately because the first two
        // disjuncts pass their own tests without it, so a mutant that dropped this would only
        // show up here -- and dropping it would change every `data` and `custom` container.
        expect(matchesSet('literally_anything', ['*'])).toBe(true);
        expect(matchesSet('', ['*'])).toBe(true);
    });

    it('returns false on an empty set', () => {
        expect(matchesSet('script', [])).toBe(false);
    });
});
