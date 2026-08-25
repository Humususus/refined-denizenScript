import { describe, it, expect } from 'vitest';
import { findSaveEntries, entryTagsFor, ENTRY_TAGS_BY_COMMAND, ALL_ENTRY_TAG_NAMES } from './entryTags';

/**
 * The user reported twice that `<entry[123].spawned_entity>` was never offered. The cause was
 * not a bug: entry sub-tags are documented PER COMMAND inside each command's meta, so there are
 * zero tags in the index whose base is `entry`, and the editor fell back to the general
 * tag-part list -- 1871 names, none of them an entry tag.
 */

describe('the generated entry tag table', () => {
    it('covers the commands that actually document entry tags', () => {
        // Generated from live meta: 32 commands, 46 distinct names. Spot-checked against the
        // meta rather than invented.
        expect(ENTRY_TAGS_BY_COMMAND.size).toBe(32);
        expect(ALL_ENTRY_TAG_NAMES.length).toBe(46);
    });

    it("knows spawn's entry tags -- the user's reported case", () => {
        expect(ENTRY_TAGS_BY_COMMAND.get('spawn')).toEqual(['spawned_entities', 'spawned_entity']);
    });

    it('knows the other commonly-saved commands', () => {
        expect(ENTRY_TAGS_BY_COMMAND.get('webget')).toContain('status');
        expect(ENTRY_TAGS_BY_COMMAND.get('shoot')).toContain('shot_entity');
        expect(ENTRY_TAGS_BY_COMMAND.get('run')).toEqual(['created_queue']);
        expect(ENTRY_TAGS_BY_COMMAND.get('random')).toEqual(['possibilities', 'selected']);
    });

    it('is a Map, so a command name cannot reach Object.prototype', () => {
        expect(ENTRY_TAGS_BY_COMMAND.get('constructor')).toBeUndefined();
    });
});

describe('findSaveEntries', () => {
    const SCRIPT = [
        'my_task:',
        '    type: task',
        '    script:',
        '    - spawn zombie save:mob',
        '    - webget https://example.com save:page',
        '    - narrate <entry[mob].spawned_entity>'
    ];

    it('finds each save: name and the command that wrote it', () => {
        // MUTANT CAUGHT: returning names without their command -- the narrowing below is the
        // whole point, and a name alone cannot narrow anything.
        expect(findSaveEntries(SCRIPT, 5)).toEqual([
            { name: 'page', command: 'webget' },
            { name: 'mob', command: 'spawn' }
        ]);
    });

    it('only looks ABOVE the cursor', () => {
        // A save on a later line has not run yet at the cursor.
        expect(findSaveEntries(SCRIPT, 3)).toEqual([{ name: 'mob', command: 'spawn' }]);
    });

    it('stops at the enclosing container, so another script\'s entries are not offered', () => {
        // An entry saved in a different container is not in scope; offering it would be worse
        // than offering nothing. Same reasoning as getContainerDefines' scan.
        // MUTANT CAUGHT: scanning the whole file -- `other` leaks into my_task's suggestions.
        const twoScripts = [
            'other_task:',
            '    script:',
            '    - spawn pig save:other',
            'my_task:',
            '    script:',
            '    - spawn zombie save:mine',
            '    - narrate x'
        ];
        expect(findSaveEntries(twoScripts, 6)).toEqual([{ name: 'mine', command: 'spawn' }]);
    });

    it('skips a save name built from a tag, which is not a literal anyone can type', () => {
        // `save:<[name]>` has no knowable literal name; offering the raw text would suggest
        // something that never matches.
        // MUTANT CAUGHT: offering `<[name]>` verbatim as a completion.
        expect(findSaveEntries(['t:', '    - spawn pig save:<[dynamic]>', '    - narrate x'], 2)).toEqual([]);
    });

    it('lowercases names and strips a leading ~ or ^ from the command', () => {
        // `~webget` (waitable) and `^inject` (instant) are the same commands.
        expect(findSaveEntries(['t:', '    - ~webget url save:PAGE', '    - narrate x'], 2))
            .toEqual([{ name: 'page', command: 'webget' }]);
    });

    it('does not treat a save: inside another word as a save argument', () => {
        // The `(?:^|\s)` anchor. `nosave:x` is not a save argument.
        // MUTANT CAUGHT: dropping the anchor.
        expect(findSaveEntries(['t:', '    - narrate nosave:x', '    - narrate y'], 2)).toEqual([]);
    });

    it('reports the first of a duplicated name once', () => {
        const dup = ['t:', '    - spawn pig save:x', '    - webget url save:x', '    - narrate y'];
        expect(findSaveEntries(dup, 3)).toEqual([{ name: 'x', command: 'webget' }]);
    });
});

describe('entryTagsFor', () => {
    it('narrows to the saving command when the entry is known', () => {
        // The point of the feature: after `- spawn zombie save:123`, `<entry[123].` offers two
        // names, not forty-six.
        expect(entryTagsFor('123', [{ name: '123', command: 'spawn' }]))
            .toEqual(['spawned_entities', 'spawned_entity']);
    });

    it('matches the entry name case-insensitively', () => {
        expect(entryTagsFor('MOB', [{ name: 'mob', command: 'spawn' }])).toEqual(['spawned_entities', 'spawned_entity']);
    });

    it('falls back to every entry tag when the entry cannot be traced', () => {
        // 46 names beats the 1871 general tag parts that contain none of the right answers.
        // MUTANT CAUGHT: returning [] when the entry is unknown, which restores the old
        // behaviour of falling through to the general list.
        expect(entryTagsFor('unknown', [])).toBe(ALL_ENTRY_TAG_NAMES);
    });

    it('falls back when the saving command documents no entry tags', () => {
        // `narrate` saves nothing, so a `save:` on it has no documented sub-tags.
        expect(entryTagsFor('x', [{ name: 'x', command: 'narrate' }])).toBe(ALL_ENTRY_TAG_NAMES);
    });
});
