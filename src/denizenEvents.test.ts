import { describe, it, expect } from 'vitest';
import { DENIZEN_EVENTS, isInWorldEvents, eventSnippet, parseEventLinePrefix } from './denizenEvents';

/**
 * Reported by the user: typing under a world container's `events:` key offered nothing.
 * Confirmed on both engines -- CompletionItemService.cs has no event handling at all, and the
 * TypeScript server's completion covers commands, arguments and tags but not events.
 */

describe('the generated event table', () => {
    it('holds every documented event, with alternatives expanded', () => {
        // 399 documented events; the pipe alternatives Denizen writes inline
        // (`discord application|slash|message|user command`) expand to 527 concrete lines.
        expect(DENIZEN_EVENTS.length).toBe(527);
    });

    it('includes the common ones a world script actually uses', () => {
        // Names checked against the table rather than guessed: the block-break event is
        // `player breaks <material>`, not `<block>` -- an earlier draft assumed the latter and
        // failed, which is the reason to look these up instead of writing them from memory.
        const names = new Set(DENIZEN_EVENTS.map(e => e.name));
        expect(names.has('player joins')).toBe(true);
        expect(names.has('player breaks block')).toBe(true);
        expect(names.has('player breaks <material>')).toBe(true);
    });

    it('carries a trigger description for each', () => {
        expect(DENIZEN_EVENTS.every(e => typeof e.trigger === 'string')).toBe(true);
        expect(DENIZEN_EVENTS.find(e => e.name === 'player joins')!.trigger.length).toBeGreaterThan(0);
    });
});

describe('eventSnippet', () => {
    it('turns placeholders into tabstops', () => {
        // The point of making these snippets rather than plain text: `<block>` is meta notation
        // for "put a block here", so the author should be able to tab into it.
        // MUTANT CAUGHT: inserting the pattern literally, which leaves `<block>` in the script.
        expect(eventSnippet('player breaks <block>')).toBe('player breaks ${1:block}');
    });

    it('numbers multiple placeholders in order', () => {
        expect(eventSnippet('<block> cooks <item>')).toBe('${1:block} cooks ${2:item}');
    });

    it('drops optional groups, leaving the minimal valid form', () => {
        // `(into <item>)` is optional by definition, so the shortest correct line omits it --
        // and a reader can always type it back. Keeping it would make every inserted event line
        // wrong until edited.
        // MUTANT CAUGHT: keeping the parentheses, which are not valid event syntax.
        expect(eventSnippet('<block> cooks <item> (into <item>)')).toBe('${1:block} cooks ${2:item}');
        expect(eventSnippet("<'structure/plant'> grows (naturally)")).toBe('${1:structure/plant} grows');
    });

    it('strips the quotes from a quoted placeholder', () => {
        // `<'command_name'>` quotes the name in the docs; the quotes are notation, not text.
        expect(eventSnippet("<'command_name'> command")).toBe('${1:command_name} command');
    });

    it('leaves an event with no placeholders alone', () => {
        expect(eventSnippet('player joins')).toBe('player joins');
    });

    it('tidies the spacing an optional group leaves behind', () => {
        // MUTANT CAUGHT: dropping the group without collapsing the double space, which produces
        // an event line that never matches.
        expect(eventSnippet('player <a> (maybe) does thing')).toBe('player ${1:a} does thing');
    });
});

describe('isInWorldEvents', () => {
    const WORLD = ['my_world:', '    type: world', '    events:', '        on player joins:', '        - narrate hi', '        '];

    it('is true on a new line directly under events:', () => {
        expect(isInWorldEvents(WORLD, 5)).toBe(true);
    });

    it('is true on the very first line under events:', () => {
        expect(isInWorldEvents(['my_world:', '    type: world', '    events:', '        '], 3)).toBe(true);
    });

    it('is FALSE inside an event\'s command list', () => {
        // The immediate parent there is the event line, and what belongs is commands. Requiring
        // the IMMEDIATE parent to be `events:` -- rather than "some ancestor is" -- is what
        // draws that line.
        // MUTANT CAUGHT: accepting any ancestor, which would offer 527 event lines in the middle
        // of writing commands.
        expect(isInWorldEvents(['my_world:', '    type: world', '    events:', '        on player joins:', '            '], 4)).toBe(false);
    });

    it('is false in a task\'s script', () => {
        expect(isInWorldEvents(['my_task:', '    type: task', '    script:', '        '], 3)).toBe(false);
    });

    it('is false under a different key of the same world container', () => {
        expect(isInWorldEvents(['my_world:', '    type: world', '    events:', '        on x:', '    other:', '        '], 5)).toBe(false);
    });

    it('is false when the container is not a world', () => {
        // A `data` container may well have a key called `events`; its contents are data.
        // MUTANT CAUGHT: dropping the type check.
        expect(isInWorldEvents(['my_data:', '    type: data', '    events:', '        '], 3)).toBe(false);
    });

    it('finds type: even when it is declared AFTER events:', () => {
        // Key order in a container is the author's choice. An earlier version scanned upward for
        // the type and so missed it here -- and, worse, treated the `type:` line as closing the
        // events block because it sits at the SAME indent as `events:`.
        // MUTANT CAUGHT: looking for the type only above the events key.
        expect(isInWorldEvents(['my_world:', '    events:', '        ', '    type: world'], 2)).toBe(true);
    });

    it('ignores blank lines and comments while walking up', () => {
        expect(isInWorldEvents(['my_world:', '    type: world', '    events:', '', '        # a note', '        '], 5)).toBe(true);
    });

    it('is false at the top of a file with no container at all', () => {
        expect(isInWorldEvents(['        '], 0)).toBe(false);
    });
});

describe('parseEventLinePrefix', () => {
    it('separates the on/after prefix from the event name being typed', () => {
        // The reported bug: typing `on` -- which is how EVERY event line starts -- matched
        // nothing, because the meta documents `player joins`, not `on player joins`. Matching the
        // whole typed text could never find it.
        // MUTANT CAUGHT: matching the whole line prefix, which finds no event once `on ` is typed.
        expect(parseEventLinePrefix('        on player jo')).toEqual({ hasPrefix: true, typed: 'player jo' });
        expect(parseEventLinePrefix('        after player br')).toEqual({ hasPrefix: true, typed: 'player br' });
    });

    it('reports no prefix when none is written yet', () => {
        expect(parseEventLinePrefix('        player jo')).toEqual({ hasPrefix: false, typed: 'player jo' });
        expect(parseEventLinePrefix('        ')).toEqual({ hasPrefix: false, typed: '' });
    });

    it('treats a bare on/after with nothing after it as a prefix already written', () => {
        // `on ` with the cursor right after it is the commonest moment to ask for a suggestion.
        expect(parseEventLinePrefix('        on ')).toEqual({ hasPrefix: true, typed: '' });
    });

    it('is case-insensitive about the prefix', () => {
        expect(parseEventLinePrefix('        ON player')).toEqual({ hasPrefix: true, typed: 'player' });
    });

    it('does NOT treat a word merely starting with "on" as the prefix', () => {
        // `once` is not `on`. The `\s+` after the alternation is what draws that line.
        // MUTANT CAUGHT: matching `(on|after)` without requiring whitespace after it.
        expect(parseEventLinePrefix('        once upon')).toEqual({ hasPrefix: false, typed: 'once upon' });
    });

    it('refuses a command line', () => {
        // A `- ` line is a command, never an event.
        expect(parseEventLinePrefix('        - narrate hi')).toBeNull();
    });

    it('refuses text containing characters no event name holds', () => {
        expect(parseEventLinePrefix('        player joins: extra=1')).toBeNull();
    });
});
