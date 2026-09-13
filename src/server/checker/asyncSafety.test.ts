// Tests for asyncSafety.ts and its wiring into the checker.
//
// The data itself is transcribed from DenizenM's CommonRegistries markings; the tests below pin
// the LOOKUP RULES and the block-context plumbing, not every name in the lists. Each names the
// mutant it kills.

import { describe, it, expect } from 'vitest';
import {
    ASYNC_SAFE_COMMANDS, ASYNC_DEFERRABLE_COMMANDS, ASYNC_SAFE_TYPE_TAGS,
    ASYNC_SAFE_EVERYTHING_TYPES, ASYNC_MAIN_THREAD_ONLY_BASES, ASYNC_BARE_SAFE_BASES,
    asyncBlockCommandName, isAsyncSafeCommand, isAsyncSafeTypeTag
} from './asyncSafety';
import { ScriptChecker } from './scriptChecker';
import { buildMetaDocs } from '../metaDocs/metaDocsManager';
import { linkTypeGraph } from '../metaDocs/metaLinker';
import type { MetaDocs } from '../metaDocs/metaTypes';
import type { MetaBlock } from '../metaDocs/metaLoader';

function command(name: string, required = 0, maximum = 10) {
    return {
        objectType: 'command', url: 'src#L1',
        data: [`@name ${name}`, `@syntax ${name} [<x>]`, '@short x', '@group x', '@description x',
            `@required ${required}`, `@maximum ${maximum}`, '@end_meta']
    };
}

/** Meta knowing the async command plus a safe, an unsafe, and a deferrable command. */
function metaWithAsync(): MetaDocs {
    return buildMetaDocs([
        command('async'), command('narrate'), command('teleport'), command('compass'),
        command('foreach'), command('define'), command('heal')
    ]);
}

/** The same set MINUS async -- i.e. a user running core Denizen without the DenizenM fork. */
function metaWithoutAsync(): MetaDocs {
    return buildMetaDocs([
        command('narrate'), command('teleport'), command('compass'), command('foreach'),
        command('define'), command('heal')
    ]);
}

/** Runs a full check over a task container built from the given body lines. */
function run(body: string[], meta: MetaDocs | null = metaWithAsync()): ScriptChecker {
    const script = ['my_task:', '    type: task', '    script:', ...body.map(l => '    ' + l)].join('\n');
    const checker = new ScriptChecker(script);
    checker.meta = meta;
    checker.run();
    return checker;
}

function asyncWarnings(checker: ScriptChecker): string[] {
    return [...checker.errors, ...checker.warnings, ...checker.minorWarnings]
        .filter(w => w.warningUniqueKey === 'async_unsafe_command')
        .map(w => w.customMessageForm);
}

describe('asyncBlockCommandName', () => {
    it('recognises a bare async block opener', () => {
        expect(asyncBlockCommandName('async')).toBe('async');
    });

    it('recognises the waitable and instant sigil forms', () => {
        // MUTANT: drop the sigil strip. checkSingleCommand strips `~`/`^`; this must agree.
        expect(asyncBlockCommandName('~async')).toBe('async');
        expect(asyncBlockCommandName('^async')).toBe('async');
    });

    it('matches on the first word only, not a substring', () => {
        // MUTANT: `.includes('async')` instead of a first-word compare. `- async-while:` is a
        // DIFFERENT command -- extension.ts:288 records it being eaten once already by a loose
        // match, so this is a repeat of a real bug, not a hypothetical.
        expect(asyncBlockCommandName('async-while <[x]>')).toBeNull();
        expect(asyncBlockCommandName('runasync')).toBeNull();
    });

    it('ignores arguments after the command name', () => {
        expect(asyncBlockCommandName('async something')).toBe('async');
    });

    it('folds case', () => {
        expect(asyncBlockCommandName('ASYNC')).toBe('async');
    });
});

describe('isAsyncSafeCommand', () => {
    it('accepts a command on the runsAsync list', () => {
        expect(isAsyncSafeCommand('narrate')).toBe(true);
        expect(isAsyncSafeCommand('foreach')).toBe(true);
    });

    it('accepts a deferrable command that is NOT on the runsAsync list', () => {
        // MUTANT: drop the deferrable arm. `compass` and `fakeequip` appear only there, so
        // losing it would squiggle two commands that are perfectly fine inside async.
        expect(ASYNC_SAFE_COMMANDS.has('compass')).toBe(false);
        expect(ASYNC_DEFERRABLE_COMMANDS.has('compass')).toBe(true);
        expect(isAsyncSafeCommand('compass')).toBe(true);
    });

    it('rejects an ordinary main-thread command', () => {
        expect(isAsyncSafeCommand('teleport')).toBe(false);
        expect(isAsyncSafeCommand('heal')).toBe(false);
    });

    it('treats the conditionally-deferrable forms as deferrable in every form', () => {
        // The source marks `actionbar(per_player)` / `narrate(per_player)` / `sidebar(per_player)`
        // / `runlater(id)`. Modelling the condition would risk false positives; see the module note.
        expect(isAsyncSafeCommand('runlater')).toBe(true);
    });
});

describe('isAsyncSafeTypeTag', () => {
    it('accepts anything on an (everything) type', () => {
        expect(ASYNC_SAFE_EVERYTHING_TYPES.has('elementtag')).toBe(true);
        expect(isAsyncSafeTypeTag('ElementTag', 'anything_at_all')).toBe(true);
    });

    it('accepts a listed sub-tag and rejects an unlisted one', () => {
        expect(isAsyncSafeTypeTag('EntityTag', 'uuid')).toBe(true);
        expect(isAsyncSafeTypeTag('EntityTag', 'location')).toBe(false);
    });

    it('rejects everything on a type marked (none)', () => {
        // MUTANT: treating an EMPTY set the same as an ABSENT one. InventoryTag and NPCTag are
        // marked `(none)` -- nothing is safe -- which is the opposite of "not audited".
        expect(ASYNC_SAFE_TYPE_TAGS.get('inventorytag')!.size).toBe(0);
        expect(isAsyncSafeTypeTag('InventoryTag', 'list_contents')).toBe(false);
        expect(isAsyncSafeTypeTag('NPCTag', 'name')).toBe(false);
    });

    it('accepts any tag on a type the source never marked', () => {
        // MUTANT: defaulting unknown types to unsafe, which would squiggle every tag on every
        // object type DenizenM did not audit.
        expect(ASYNC_SAFE_TYPE_TAGS.has('sometag')).toBe(false);
        expect(isAsyncSafeTypeTag('SomeTag', 'whatever')).toBe(true);
    });

    it('folds case on both the type and the sub-tag', () => {
        expect(isAsyncSafeTypeTag('playertag', 'UUID')).toBe(true);
    });
});

describe('base markings transcribed from @asyncbase', () => {
    it('keeps mainThreadOnly and bareSafe as separate axes', () => {
        // player and npc are on BOTH: main-thread-only for sub-tags, safe to mention bare.
        expect(ASYNC_MAIN_THREAD_ONLY_BASES.has('player')).toBe(true);
        expect(ASYNC_BARE_SAFE_BASES.has('player')).toBe(true);
        expect(ASYNC_BARE_SAFE_BASES.has('server')).toBe(false);
    });

    it('leaves location and material unmarked', () => {
        // `@asyncbase notMarked` -- absence here is load-bearing, not an oversight.
        expect(ASYNC_MAIN_THREAD_ONLY_BASES.has('location')).toBe(false);
        expect(ASYNC_MAIN_THREAD_ONLY_BASES.has('material')).toBe(false);
    });
});

describe('async_unsafe_command diagnostic', () => {
    it('reports an unsafe command inside an async block', () => {
        const checker = run(['- async:', '    - teleport <player> <[loc]>']);
        expect(asyncWarnings(checker)).toHaveLength(1);
        expect(asyncWarnings(checker)[0]).toContain('teleport');
    });

    it('stays silent for a safe command inside an async block', () => {
        expect(asyncWarnings(run(['- async:', '    - narrate hi']))).toEqual([]);
    });

    it('stays silent for a deferrable command inside an async block', () => {
        expect(asyncWarnings(run(['- async:', '    - compass <[loc]>']))).toEqual([]);
    });

    it('does NOT report the same command outside an async block', () => {
        // MUTANT: checking the command list unconditionally, ignoring block context.
        expect(asyncWarnings(run(['- teleport <player> <[loc]>']))).toEqual([]);
    });

    it('does not leak the flag onto siblings AFTER the async block', () => {
        // THE SAVE/RESTORE TEST. ScriptCheckContext is shared across a whole container, so
        // setting insideAsyncBlock without restoring it makes every later command at the parent
        // indent report too. MUTANT: drop the `ctx.insideAsyncBlock = wasInsideAsync` restore.
        const checker = run([
            '- async:',
            '    - narrate safe',
            '- teleport <player> <[loc]>',
            '- heal <player>'
        ]);
        expect(asyncWarnings(checker)).toEqual([]);
    });

    it('still reports inside a nested block within async', () => {
        // MUTANT: setting the flag only for the immediate child list. `foreach` is itself
        // async-safe, so the flag has to survive one more level of recursion.
        const checker = run([
            '- async:',
            '    - foreach <[list]>:',
            '        - teleport <player> <[loc]>'
        ]);
        expect(asyncWarnings(checker)).toHaveLength(1);
    });

    it('reports each unsafe command in the block separately', () => {
        const checker = run(['- async:', '    - teleport <player> <[loc]>', '    - heal <player>']);
        expect(asyncWarnings(checker)).toHaveLength(2);
    });

    it('does not report the async command itself', () => {
        // `async` is on the runsAsync list, and it is checked before the recursion sets the flag.
        expect(asyncWarnings(run(['- async:', '    - narrate hi']))).toEqual([]);
    });

    it('says nothing when the loaded meta has no async command', () => {
        // A user on core Denizen without the DenizenM fork already gets `unknown_command` for the
        // `- async:` line; piling async advice on top would be noise about a command they lack.
        // MUTANT: drop the `meta.commands.has('async')` gate.
        const checker = run(['- async:', '    - teleport <player> <[loc]>'], metaWithoutAsync());
        expect(asyncWarnings(checker)).toEqual([]);
    });

    it('says nothing at all before the meta has loaded', () => {
        // MUTANT: reading `checker.meta` without the null guard -- a crash on every cold start.
        const checker = run(['- async:', '    - teleport <player> <[loc]>'], null);
        expect(asyncWarnings(checker)).toEqual([]);
    });

    it('is silenced by ##ignorewarning', () => {
        const script = [
            '##ignorewarning async_unsafe_command',
            'my_task:', '    type: task', '    script:',
            '    - async:', '        - teleport <player> <[loc]>'
        ].join('\n');
        const checker = new ScriptChecker(script);
        checker.meta = metaWithAsync();
        checker.run();
        expect(asyncWarnings(checker)).toEqual([]);
    });

    it('ranges the squiggle over the command name only', () => {
        const checker = run(['- async:', '    - teleport <player> <[loc]>']);
        const warning = [...checker.warnings].find(w => w.warningUniqueKey === 'async_unsafe_command')!;
        expect(warning.endChar - warning.startChar).toBe('teleport'.length);
    });
});

function objectType(name: string, base: string): MetaBlock {
    return {
        objectType: 'objecttype', url: 'src#L1',
        data: ['@name ' + name, '@prefix ' + name.toLowerCase(), '@base ' + base, '@format x',
            '@description x', '@end_meta']
    };
}

function tag(attribute: string, returns: string): MetaBlock {
    return {
        objectType: 'tag', url: 'src#L1',
        data: [`@attribute <${attribute}>`, `@returns ${returns}`, '@description x', '@end_meta']
    };
}

/**
 * Meta with a traceable type graph, so possibleTags resolves to exactly one candidate.
 *
 * `name` and `uuid` are on the async-safe lists for their types; `health` and `location` are not.
 * `shared_thing` is deliberately on TWO types, to exercise the ambiguity rule.
 */
function metaWithTags(): MetaDocs {
    const docs = buildMetaDocs([
        command('async'), command('narrate'), command('define'),
        objectType('ObjectTag', 'none'),
        objectType('ElementTag', 'ObjectTag'),
        objectType('EntityTag', 'ObjectTag'),
        objectType('PlayerTag', 'EntityTag'),
        objectType('MaterialTag', 'ObjectTag'),
        tag('player', 'PlayerTag'),
        tag('definition[<name>]', 'ObjectTag'),
        tag('PlayerTag.name', 'ElementTag'),
        tag('PlayerTag.health', 'ElementTag'),
        tag('EntityTag.uuid', 'ElementTag'),
        tag('EntityTag.location', 'ElementTag'),
        tag('MaterialTag.anything_at_all', 'ElementTag'),
        tag('EntityTag.shared_thing', 'ElementTag'),
        tag('PlayerTag.shared_thing', 'ElementTag')
    ]);
    linkTypeGraph(docs);
    return docs;
}

function tagWarnings(checker: ScriptChecker): string[] {
    return [...checker.errors, ...checker.warnings, ...checker.minorWarnings]
        .filter(w => w.warningUniqueKey === 'async_unsafe_tag')
        .map(w => w.customMessageForm);
}

describe('async_unsafe_tag diagnostic', () => {
    function runTags(body: string[]): ScriptChecker {
        return run(body, metaWithTags());
    }

    it('reports a main-thread-only tag inside an async block', () => {
        const checker = runTags(['- async:', '    - narrate <player.health>']);
        expect(tagWarnings(checker)).toHaveLength(1);
        expect(tagWarnings(checker)[0]).toContain('health');
    });

    it('stays silent for a tag on its type\'s async-safe list', () => {
        // `<player.name>` is THE most common tag there is. The base `player` is marked
        // mainThreadOnly, but its allow-list contains `name`, so this must not warn.
        expect(tagWarnings(runTags(['- async:', '    - narrate <player.name>']))).toEqual([]);
    });

    it('stays silent for an (everything) type', () => {
        // MUTANT: drop the ASYNC_SAFE_EVERYTHING_TYPES arm.
        expect(tagWarnings(runTags(['- async:', '    - narrate <material[stone].anything_at_all>']))).toEqual([]);
    });

    it('resolves an inherited tag against the type that declares it', () => {
        // `<player.uuid>` resolves to EntityTag.uuid; `uuid` is on EntityTag's list.
        expect(tagWarnings(runTags(['- async:', '    - narrate <player.uuid>']))).toEqual([]);
    });

    it('reports an inherited tag that is unsafe on the declaring type', () => {
        const checker = runTags(['- async:', '    - narrate <player.location>']);
        expect(tagWarnings(checker)).toHaveLength(1);
        expect(tagWarnings(checker)[0]).toContain('location');
    });

    it('does NOT report the same tag outside an async block', () => {
        expect(tagWarnings(runTags(['- narrate <player.health>']))).toEqual([]);
    });

    it('stays silent when the tag part is ambiguous across types', () => {
        // THE FALSE-POSITIVE GUARD. A definition's runtime type is exactly what cannot be known,
        // so `shared_thing` matching two types must produce silence, not a guess.
        // MUTANT: drop the `possible.length !== 1` check.
        const checker = runTags([
            '- define thing <player>',
            '- async:',
            '    - narrate <[thing].shared_thing>'
        ]);
        expect(tagWarnings(checker)).toEqual([]);
    });

    it('reports once per line even with several unsafe tags', () => {
        // checker.warn dedups on (line, key); this pins that the tag loop relies on it.
        const checker = runTags(['- async:', '    - narrate <player.health> <player.location>']);
        expect(tagWarnings(checker)).toHaveLength(1);
    });

    it('ranges the squiggle over the offending tag part', () => {
        const checker = runTags(['- async:', '    - narrate <player.health>']);
        const warning = [...checker.warnings].find(w => w.warningUniqueKey === 'async_unsafe_tag')!;
        expect(warning.endChar - warning.startChar).toBe('health'.length);
    });

    it('is silenced by ##ignorewarning', () => {
        const script = [
            '##ignorewarning async_unsafe_tag',
            'my_task:', '    type: task', '    script:',
            '    - async:', '        - narrate <player.health>'
        ].join('\n');
        const checker = new ScriptChecker(script);
        checker.meta = metaWithTags();
        checker.run();
        expect(tagWarnings(checker)).toEqual([]);
    });

    it('says nothing before the meta has loaded', () => {
        expect(tagWarnings(run(['- async:', '    - narrate <player.health>'], null))).toEqual([]);
    });
});
