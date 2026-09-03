import { describe, it, expect } from 'vitest';
import { indexDefinitions, nameCandidates, referenceAt, sameName } from './definitionIndex';

/**
 * Go-to-definition for flags and script containers. No C# counterpart -- the C# server never
 * implemented this -- so every expectation is derived from Denizen's own syntax.
 *
 * The governing rule, and the reason so many of these assert null: a jump that is occasionally
 * missing is a minor annoyance, one that lands on the wrong line is worse than none. Every rule
 * under-matches on purpose.
 */

/** The reference at the cursor placed at the END of `prefix`, with `rest` following it. */
function at(prefix: string, rest: string = '') {
    return referenceAt(prefix + rest, prefix.length);
}

describe('indexDefinitions: script containers', () => {
    it('finds a top-level container key', () => {
        const { containers } = indexDefinitions('my_task:\n    type: task\n');
        expect(containers).toEqual([{ name: 'my_task', line: 0, startChar: 0, endChar: 7 }]);
    });

    it('finds several, with their real line numbers', () => {
        const text = 'first:\n    type: task\n\nsecond:\n    type: world\n';
        expect(indexDefinitions(text).containers.map(c => [c.name, c.line]))
            .toEqual([['first', 0], ['second', 3]]);
    });

    it('ignores INDENTED keys, which are container contents rather than containers', () => {
        // `script:`, `events:`, `on player joins:` are all keys, and none of them is a container.
        // MUTANT CAUGHT: dropping the column-0 anchor.
        const text = 'my_world:\n    type: world\n    events:\n        on player joins:\n        - narrate hi\n';
        expect(indexDefinitions(text).containers.map(c => c.name)).toEqual(['my_world']);
    });

    it('ignores a commented-out container', () => {
        // Jumping into a comment would be actively misleading.
        // MUTANT CAUGHT: removing the comment skip.
        expect(indexDefinitions('# my_task:\n').containers).toEqual([]);
    });

    it('ignores a key that carries a value, and a list entry', () => {
        expect(indexDefinitions('type: task\n').containers.map(c => c.name)).toEqual([]);
        expect(indexDefinitions('- run something:\n').containers).toEqual([]);
    });

    it('accepts the dots and dashes real container names use', () => {
        expect(indexDefinitions('mf.first-menu:\n').containers.map(c => c.name)).toEqual(['mf.first-menu']);
    });
});

describe('indexDefinitions: flags', () => {
    it('finds a player flag write, and points at the NAME not the line start', () => {
        const [flag] = indexDefinitions('    - flag player money:5\n').flags;
        expect(flag.name).toBe('money');
        expect(flag.line).toBe(0);
        expect('    - flag player money:5'.slice(flag.startChar, flag.endChar)).toBe('money');
    });

    it('finds a flag on any target, not just player and server', () => {
        // The target may be a tag; which target it is does not change WHERE the flag is written.
        // MUTANT CAUGHT: restricting the target to player|server, as the completion index does.
        const text = '- flag server maf.players:x\n- flag <[ent]> owner:y\n- flag npc job:z\n';
        expect(indexDefinitions(text).flags.map(f => f.name)).toEqual(['maf.players', 'owner', 'job']);
    });

    it('finds a flag written by a waitable or instant form', () => {
        expect(indexDefinitions('- ~flag player a:1\n- ^flag player b:2\n').flags.map(f => f.name))
            .toEqual(['a', 'b']);
    });

    it('does not treat "expire" as a flag name', () => {
        // `- flag player money expire:1d` -- expire is an argument.
        // MUTANT CAUGHT: dropping the expire exclusion.
        expect(indexDefinitions('- flag player expire:1d\n').flags).toEqual([]);
    });

    it('ignores a commented-out flag write', () => {
        expect(indexDefinitions('  # - flag player money:5\n').flags).toEqual([]);
    });

    it('handles a flag with no value', () => {
        expect(indexDefinitions('- flag player greeted\n').flags.map(f => f.name)).toEqual(['greeted']);
    });

    describe('the flag MECHANISM, which is not the flag command', () => {
        // Found on the user's real scripts 2026-09-02: `pages` and `arrow` are never written by
        // `- flag` at all, only by `with[...;flag=name:value]` on an item. Without this, jumping
        // from `<context.item.flag[pages]>` found nothing.
        it('indexes a flag set inside a with[...] mechanism', () => {
            const line = '- define bg <item[red_dye].with[display=<&c>Back;flag=pages:prev]>';
            const [flag] = indexDefinitions(line + '\n').flags;
            expect(flag.name).toBe('pages');
            expect(line.slice(flag.startChar, flag.endChar)).toBe('pages');
        });

        it('indexes every one on a line, not just the first', () => {
            // MUTANT CAUGHT: using exec instead of matchAll.
            expect(indexDefinitions('- give <item[a].with[flag=one:1]> <item[b].with[flag=two:2]>\n')
                .flags.map(f => f.name)).toEqual(['one', 'two']);
        });

        it('does not confuse it with the flag command on the same line', () => {
            // The command branch takes the line and stops, so a `- flag` line is counted once.
            expect(indexDefinitions('- flag player money:5\n').flags.map(f => f.name)).toEqual(['money']);
        });
    });
});

describe('nameCandidates', () => {
    it('falls back from a dotted script name to its container', () => {
        // `- run mafiaLobbyWaiting.wait_text` runs a task INSIDE the container; only the container
        // has a top-level definition. Real line from the user's scripts.
        // MUTANT CAUGHT: dropping the fallback, or splitting on the LAST dot.
        expect(nameCandidates('container', 'mafiaLobbyWaiting.wait_text'))
            .toEqual(['mafiaLobbyWaiting.wait_text', 'mafiaLobbyWaiting']);
        expect(nameCandidates('container', 'a.b.c')).toEqual(['a.b.c', 'a']);
    });

    it('does not fall back for a plain script name', () => {
        expect(nameCandidates('container', 'mytask')).toEqual(['mytask']);
    });

    it('never falls back for a flag', () => {
        // `maf.players` is ONE flag whose name contains a dot, not a `players` key of `maf`.
        // MUTANT CAUGHT: applying the container fallback to flags, which would jump from
        // `<server.flag[maf.players]>` to any unrelated flag called `maf`.
        expect(nameCandidates('flag', 'maf.players')).toEqual(['maf.players']);
    });
});

describe('referenceAt: flags', () => {
    it('resolves a flag name inside flag[...]', () => {
        // `- narrate ` is 10 characters, `<` is 10, `player.flag` runs 11-21, `[` is 22, so the
        // name occupies 23-27 -- and the range must cover exactly it, so the editor underlines the
        // flag name rather than the whole tag.
        const line = '- narrate <player.flag[money]>';
        expect(referenceAt(line, 25))
            .toEqual({ kind: 'flag', name: 'money', startChar: 23, endChar: 28 });
        expect(line.slice(23, 28)).toBe('money');
    });

    it('resolves all four flag tag parts', () => {
        for (const part of ['flag', 'has_flag', 'flag_expiration', 'flag_map']) {
            const line = `- narrate <player.${part}[money]>`;
            const ref = referenceAt(line, line.indexOf('money') + 2);
            expect(ref?.name, part).toBe('money');
            expect(ref?.kind, part).toBe('flag');
        }
    });

    it('resolves on a server flag and on a definition-held object', () => {
        expect(at('- narrate <server.flag[maf.play', 'ers]>')?.name).toBe('maf.players');
        expect(at('- narrate <[ent].flag_map[own', 'er]>')?.name).toBe('owner');
    });

    it('offers nothing for a parameter that is not a flag part', () => {
        // MUTANT CAUGHT: matching any `[...]` regardless of the tag part before it.
        expect(at('- narrate <player.gamemode_at[loc', ']>')).toBeNull();
        expect(at('- narrate <list[a', '|b]>')).toBeNull();
    });

    it('offers nothing when the flag name is itself a tag', () => {
        // `<player.flag[<[name]>]>` cannot be resolved statically.
        expect(at('- narrate <player.flag[<[na', 'me]>]>')).toBeNull();
    });

    it('offers nothing outside the bracket', () => {
        const line = '- narrate <player.flag[money]>';
        expect(referenceAt(line, 3)).toBeNull();
        expect(referenceAt(line, line.length - 1)).toBeNull();
    });

    it('offers nothing for an empty parameter', () => {
        expect(at('- narrate <player.flag[', ']>')).toBeNull();
    });
});

describe('referenceAt: script containers', () => {
    it('resolves the first argument of every run-like command', () => {
        for (const cmd of ['run', 'runlater', 'inject', 'clickable', 'bungeerun']) {
            const line = `    - ${cmd} mytask`;
            const ref = referenceAt(line, line.length - 2);
            expect(ref?.name, cmd).toBe('mytask');
            expect(ref?.kind, cmd).toBe('container');
        }
    });

    it('resolves through the waitable sigil', () => {
        expect(at('    - ~run myt', 'ask')?.name).toBe('mytask');
    });

    it('reports the range of the NAME, so only it is underlined', () => {
        const line = '    - run mytask def:<player>';
        const ref = referenceAt(line, 12);
        expect(line.slice(ref!.startChar, ref!.endChar)).toBe('mytask');
    });

    it('ignores arguments after the first', () => {
        // `def:<player>` is data. Offering a jump from it would be noise on every run line.
        // MUTANT CAUGHT: scanning every whitespace-separated word.
        const line = '    - run mytask def:something';
        expect(referenceAt(line, line.length - 3)).toBeNull();
    });

    it('offers nothing for commands that do not take a script name', () => {
        // MUTANT CAUGHT: dropping the RUN_LIKE_COMMANDS gate.
        expect(at('    - narrate hel', 'lo')).toBeNull();
        expect(at('    - define x myt', 'ask')).toBeNull();
    });

    it('offers nothing when the name is a tag or a prefixed argument', () => {
        expect(at('    - run <[scrip', 't]>')).toBeNull();
        expect(at('    - run def:som', 'ething')).toBeNull();
    });

    it('offers nothing on the command name itself', () => {
        expect(referenceAt('    - run mytask', 7)).toBeNull();
    });
});

describe('sameName', () => {
    it('folds ASCII case, as Denizen does', () => {
        expect(sameName('MyTask', 'mytask')).toBe(true);
        expect(sameName('maf.Players', 'maf.players')).toBe(true);
    });

    it('does not fold non-ASCII, matching toLowerFast', () => {
        // The checker's ToLowerFast port is ASCII-only; folding wider here would make two names
        // match in the editor that Denizen treats as different.
        expect(sameName('ИМЯ', 'имя')).toBe(false);
    });

    it('does not match different names', () => {
        expect(sameName('mytask', 'mytask2')).toBe(false);
    });
});
