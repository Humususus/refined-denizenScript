// The `definitions:` key of a script container: parsing it, attaching it to the right container,
// and deciding when `- run <script>` should offer to fill its `def.` arguments in.
//
// Split out of definitionIndex.test.ts, which covers go-to-definition, because this is a separate
// feature over the same walk. Every test names the mutant it kills.

import { describe, it, expect } from 'vitest';
import {
    indexDefinitions, parseDefinitionsKey, containerBoundsAt, runDefinitionContextAt,
    runScriptNameContextAt
} from './definitionIndex';

describe('parseDefinitionsKey', () => {
    it('splits a plain pipe-separated list', () => {
        expect(parseDefinitionsKey('__player|hook')).toEqual([
            { name: '__player', description: null },
            { name: 'hook', description: null }
        ]);
    });

    it('reads [square brackets] as documentation, not a default value', () => {
        // The meta's task-script-container page: "You can optionally document a definition with
        // [square brackets]". This line is from the user's own scripts.
        // MUTANT: treating the bracket content as a default, which would make the hover claim a
        // value the script does not have.
        expect(parseDefinitionsKey('id[Aidi]|target[the entity, which speaks]|text')).toEqual([
            { name: 'id', description: 'Aidi' },
            { name: 'target', description: 'the entity, which speaks' },
            { name: 'text', description: null }
        ]);
    });

    it('does not split on a pipe inside a description', () => {
        // MUTANT: splitting on every '|' the way the checker's port does. That invents a second,
        // nameless entry here; the checker only gets away with it because it cuts at '[' and
        // discards the description entirely.
        expect(parseDefinitionsKey('mode[fast|slow]|other')).toEqual([
            { name: 'mode', description: 'fast|slow' },
            { name: 'other', description: null }
        ]);
    });

    it('ignores empty entries and a trailing pipe', () => {
        expect(parseDefinitionsKey('a||b|').map(d => d.name)).toEqual(['a', 'b']);
    });

    it('returns nothing for an empty key', () => {
        expect(parseDefinitionsKey('')).toEqual([]);
        expect(parseDefinitionsKey('   ')).toEqual([]);
    });

    it('drops an entry that is only a description', () => {
        expect(parseDefinitionsKey('[orphan]|real')).toEqual([{ name: 'real', description: null }]);
    });

    it('treats an empty bracket pair as no description', () => {
        expect(parseDefinitionsKey('a[]')).toEqual([{ name: 'a', description: null }]);
    });
});

describe('indexDefinitions: the definitions: key', () => {
    it('attaches the key to its own container', () => {
        const text = 'ribalka:\n    type: task\n    definitions: __player|hook\n    script:\n    - narrate hi\n';
        expect(indexDefinitions(text).containers[0].definitions!.map(d => d.name))
            .toEqual(['__player', 'hook']);
    });

    it('gives each container its own key and leaves the others empty', () => {
        // MUTANT: not re-pointing the open container, which hangs the second key off the first.
        const text = [
            'first:', '    type: task', '    definitions: a|b', '    script:', '    - narrate x',
            'second:', '    type: task', '    script:', '    - narrate y',
            'third:', '    type: task', '    definitions: c'
        ].join('\n');
        expect(indexDefinitions(text).containers.map(c => [c.name, c.definitions!.map(d => d.name)]))
            .toEqual([['first', ['a', 'b']], ['second', []], ['third', ['c']]]);
    });

    it('accepts any indent, not just four spaces', () => {
        // The user's own sfx.dsc writes its container keys at two spaces.
        // MUTANT: hardcoding a four-space indent in the key pattern.
        expect(indexDefinitions('sfx:\n  type: task\n  definitions: sound\n')
            .containers[0].definitions!.map(d => d.name)).toEqual(['sound']);
    });

    it('takes the FIRST definitions: key and ignores a deeper one', () => {
        // A line-based walk cannot tell a container key from one nested under `data:`, so it
        // under-matches rather than guessing -- the rule the whole module is written to.
        const text = 'x:\n    type: task\n    definitions: real\n    data:\n        definitions: nested\n';
        expect(indexDefinitions(text).containers[0].definitions!.map(d => d.name)).toEqual(['real']);
    });

    it('ignores a column-0 definitions: line, which is a container of its own', () => {
        const indexed = indexDefinitions('definitions:\n    type: task\n');
        expect(indexed.containers.map(c => c.name)).toEqual(['definitions']);
        expect(indexed.containers[0].definitions).toEqual([]);
    });

    it('leaves definitions empty when the container declares none', () => {
        expect(indexDefinitions('x:\n    type: task\n').containers[0].definitions).toEqual([]);
    });

    it('does not read a commented-out definitions: key', () => {
        const text = 'x:\n    type: task\n    #definitions: ghost\n    definitions: real\n';
        expect(indexDefinitions(text).containers[0].definitions!.map(d => d.name)).toEqual(['real']);
    });
});

describe('indexDefinitions: the type: key', () => {
    it('records the container type, folded', () => {
        expect(indexDefinitions('x:\n    type: TASK\n').containers[0].containerType).toBe('task');
    });

    it('gives each container its own type', () => {
        // MUTANT: not re-pointing the open container, which hangs the second type off the first.
        const text = 'a:\n    type: task\nb:\n    type: world\nc:\n    type: item\n';
        expect(indexDefinitions(text).containers.map(c => c.containerType))
            .toEqual(['task', 'world', 'item']);
    });

    it('takes the FIRST type: key, so a nested one does not win', () => {
        // An item container's `mechanisms:` block can carry a `type:` of its own.
        const text = 'x:\n    type: item\n    mechanisms:\n        type: something_else\n';
        expect(indexDefinitions(text).containers[0].containerType).toBe('item');
    });

    it('is null when the container declares no type', () => {
        // Null means "the walk could not see it", which is why such containers are still offered.
        expect(indexDefinitions('x:\n    script:\n    - narrate hi\n').containers[0].containerType).toBeNull();
    });

    it('ignores a type: key written at column 0, which is a container of its own', () => {
        expect(indexDefinitions('type:\n    foo: bar\n').containers.map(c => c.name)).toEqual(['type']);
    });

    it('does not take a type: line with trailing content beyond one word', () => {
        // `type: task extra` is not a valid type; matching it would invent one.
        expect(indexDefinitions('x:\n    type: task extra\n').containers[0].containerType).toBeNull();
    });
});

describe('runScriptNameContextAt', () => {
    /** The context with the cursor at the very end of `line`. */
    function ctx(line: string) {
        return runScriptNameContextAt(line, line.length);
    }

    it('fires on the empty slot right after the command', () => {
        expect(ctx('    - run ')).toEqual({ typed: '' });
    });

    it('carries what has been typed of the name', () => {
        expect(ctx('    - run riba')).toEqual({ typed: 'riba' });
    });

    it('fires for inject, which names a script but takes no def arguments', () => {
        // The mirror of runDefinitionContextAt, which excludes inject for exactly that reason.
        expect(ctx('    - inject riba')).toEqual({ typed: 'riba' });
    });

    it('fires for every run-like command and accepts the sigils', () => {
        for (const command of ['run', 'runlater', 'inject', 'clickable', 'bungeerun']) {
            expect(ctx('    - ' + command + ' x')).not.toBeNull();
        }
        expect(ctx('    - ~run x')).not.toBeNull();
        expect(ctx('    - ^run x')).not.toBeNull();
    });

    it('stops firing once the caret moves past the name', () => {
        // MUTANT: dropping the argEnd bound, which would offer script names in the argument area
        // where runDefinitionContextAt is meant to answer instead.
        expect(ctx('    - run ribalka ')).toBeNull();
        expect(ctx('    - run ribalka def.')).toBeNull();
    });

    it('still fires with the caret mid-name when more follows', () => {
        const line = '    - run ribalka def.hook:1';
        expect(runScriptNameContextAt(line, line.indexOf('ribalka') + 4)).toEqual({ typed: 'riba' });
    });

    it('refuses a tag or a prefixed argument in the name slot', () => {
        expect(ctx('    - run <[task]')).toBeNull();
        expect(ctx('    - run path:talk')).toBeNull();
    });

    it('does not fire for an unrelated command', () => {
        expect(ctx('    - narrate riba')).toBeNull();
    });

    it('does not fire before the command name is finished', () => {
        expect(ctx('    - ru')).toBeNull();
    });

    it('ignores a line that is not a command at all', () => {
        expect(ctx('    run riba')).toBeNull();
    });
});

describe('containerBoundsAt', () => {
    const lines = [
        'first:', '    type: task', '    - define hook a',
        'second:', '    type: task', '    - define hook b',
        'third:', '    type: task'
    ];

    it('bounds a line to its own container', () => {
        expect(containerBoundsAt(lines, 4)).toEqual({ start: 3, end: 6 });
    });

    it('bounds the first container from the top of the file', () => {
        expect(containerBoundsAt(lines, 1)).toEqual({ start: 0, end: 3 });
    });

    it('runs the last container to the end of the file', () => {
        expect(containerBoundsAt(lines, 7)).toEqual({ start: 6, end: 8 });
    });

    it('treats the container key line itself as inside its own container', () => {
        expect(containerBoundsAt(lines, 3)).toEqual({ start: 3, end: 6 });
    });

    it('returns the whole file when no container key sits above the line', () => {
        expect(containerBoundsAt(['# a comment', '- narrate hi'], 1)).toEqual({ start: 0, end: 2 });
    });
});

describe('runDefinitionContextAt', () => {
    /** The context with the cursor at the very end of `line`. */
    function ctx(line: string) {
        return runDefinitionContextAt(line, line.length);
    }

    it('fires after the script name on a run line', () => {
        const found = ctx('    - run ribalka ')!;
        expect(found.scriptName).toBe('ribalka');
        expect(found.typed).toBe('');
    });

    it('carries the partially-typed argument', () => {
        expect(ctx('    - run ribalka def.')!.typed).toBe('def.');
    });

    it('does NOT fire while the script name is still being typed', () => {
        // MUTANT: dropping the `character <= nameEnd` guard, which would offer definitions for a
        // half-typed name and fight the script-name completion for the same keystrokes.
        expect(ctx('    - run ribalka')).toBeNull();
    });

    it('collects def. arguments already on the line', () => {
        const found = ctx('    - run ribalka def.__player:<player> def.hook:x ')!;
        expect([...found.present].sort()).toEqual(['__player', 'hook']);
    });

    it('folds case when collecting what is present', () => {
        expect([...ctx('    - run x DEF.Hook:1 ')!.present]).toEqual(['hook']);
    });

    it('accepts the waitable and instant sigils', () => {
        expect(ctx('    - ~run ribalka ')!.scriptName).toBe('ribalka');
        expect(ctx('    - ^run ribalka ')!.scriptName).toBe('ribalka');
    });

    it('fires for every def-passing command', () => {
        for (const command of ['run', 'runlater', 'clickable', 'bungeerun']) {
            expect(ctx('    - ' + command + ' ribalka ')).not.toBeNull();
        }
    });

    it('does NOT fire for inject, which passes no definitions', () => {
        // MUTANT: reusing RUN_LIKE_COMMANDS wholesale. `inject` runs in the CURRENT queue and
        // shares its definitions, so it documents no `def` argument at all.
        expect(ctx('    - inject ribalka ')).toBeNull();
    });

    it('does not fire for an unrelated command', () => {
        expect(ctx('    - narrate ribalka ')).toBeNull();
    });

    it('refuses a script name written as a tag or a prefixed argument', () => {
        expect(ctx('    - run <[task]> ')).toBeNull();
        expect(ctx('    - run path:talk ')).toBeNull();
    });

    it('stays silent inside an unclosed tag, where the caret is writing a value', () => {
        // MUTANT: dropping the '<' check, which would offer `def.` items mid-tag.
        expect(ctx('    - run ribalka def.hook:<player.')).toBeNull();
    });

    it('ignores a line that is not a command at all', () => {
        expect(ctx('    run ribalka ')).toBeNull();
    });
});
