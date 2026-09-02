import { describe, it, expect } from 'vitest';
import { parseSyntaxParameter, splitWrittenArguments, remainingArguments, hintTextFor } from './argumentHints';

/**
 * Inline argument hints, backlog item 5. No C# counterpart -- the C# server's signature-help
 * handler is an empty stub -- so every expectation is derived from Denizen's own `@Syntax` lines.
 *
 * The syntax strings below are copied from the live meta, verified 2026-09-02.
 */

/** Builds a parameter list the way the provider does, from tokenised syntax text. */
const params = (...tokens: string[]) => tokens.map(parseSyntaxParameter);

describe('parseSyntaxParameter', () => {
    it('reads a required prefixed argument', () => {
        expect(parseSyntaxParameter('[sound:<name>]')).toEqual({
            text: '[sound:<name>]', prefix: 'sound', required: true
        });
    });

    it('reads an optional prefixed argument', () => {
        expect(parseSyntaxParameter('(volume:<#.#>)')).toEqual({
            text: '(volume:<#.#>)', prefix: 'volume', required: false
        });
    });

    it('reads a bare argument as having no prefix', () => {
        expect(parseSyntaxParameter('[<text>]')).toEqual({
            text: '[<text>]', prefix: null, required: true
        });
        expect(parseSyntaxParameter('[<location>|...]').prefix).toBeNull();
    });

    it('does not mistake a colon INSIDE the value for a prefix', () => {
        // The prefix must be plain word characters at the very start. A colon that belongs to the
        // value names nothing.
        // MUTANT CAUGHT: taking everything before the first colon.
        expect(parseSyntaxParameter('[<player>:<value>]').prefix).toBeNull();
        expect(parseSyntaxParameter('(<mechanism>:<value>)').prefix).toBeNull();
    });

    it('lowercases the prefix, since Denizen matches it case-insensitively', () => {
        expect(parseSyntaxParameter('[Targets:<player>]').prefix).toBe('targets');
    });
});

describe('splitWrittenArguments', () => {
    it('drops the dash and the command name', () => {
        expect(splitWrittenArguments('- narrate hello there')).toEqual(['hello', 'there']);
    });

    it('keeps a quoted argument whole', () => {
        // MUTANT CAUGHT: a plain space split, which would make "hello there" two arguments and
        // then over-count the bare arguments supplied.
        expect(splitWrittenArguments('- narrate "hello there" targets:<player>'))
            .toEqual(['"hello there"', 'targets:<player>']);
    });

    it('keeps a tag whole however deeply it nests', () => {
        expect(splitWrittenArguments('- narrate <map[a=1;b=<list[x|y]>]> more'))
            .toEqual(['<map[a=1;b=<list[x|y]>]>', 'more']);
    });

    it('survives the indent and the waitable sigil', () => {
        expect(splitWrittenArguments('        - ~run mytask def:1')).toEqual(['mytask', 'def:1']);
    });

    it('returns nothing for a command with no arguments', () => {
        expect(splitWrittenArguments('- stop')).toEqual([]);
    });
});

describe('remainingArguments', () => {
    // `narrate [<text>] (targets:<player>|...) (format:<script>) (per_player)`
    const NARRATE = params('[<text>]', '(targets:<player>|...)', '(format:<script>)', '(per_player)');

    it('offers everything when only the command name is typed', () => {
        expect(remainingArguments(NARRATE, '- narrate ').map(p => p.text))
            .toEqual(['[<text>]', '(targets:<player>|...)', '(format:<script>)', '(per_player)']);
    });

    it('drops a prefixed argument once its prefix appears, in any order', () => {
        // Denizen does not care about argument order, so neither can this.
        // MUTANT CAUGHT: matching prefixes positionally.
        expect(remainingArguments(NARRATE, '- narrate format:myformat hello ').map(p => p.prefix))
            .toEqual(['targets', null]);
    });

    it('consumes bare parameters in order', () => {
        expect(remainingArguments(NARRATE, '- narrate hello ').map(p => p.text))
            .toEqual(['(targets:<player>|...)', '(format:<script>)', '(per_player)']);
    });

    it('does NOT count the argument still being typed', () => {
        // Half-typed `targ` must not remove `(targets:...)` from the hint -- that is exactly when
        // the hint is wanted. The trailing-space case is the opposite: a fresh empty argument.
        // MUTANT CAUGHT: counting every written token regardless of the caret.
        expect(remainingArguments(NARRATE, '- narrate hello targ').map(p => p.prefix))
            .toContain('targets');
        expect(remainingArguments(NARRATE, '- narrate hello targets:<player> ').map(p => p.prefix))
            .not.toContain('targets');
    });

    it('treats a tag argument as bare rather than as a prefix', () => {
        // `<player.flag[x]>` has no top-level colon, and a value that merely contains one must not
        // be read as naming a prefix.
        // MUTANT CAUGHT: splitting on the first colon anywhere in the argument.
        const remaining = remainingArguments(NARRATE, '- narrate <player.flag[a]> ');
        expect(remaining.map(p => p.text)).not.toContain('[<text>]');
    });

    it('returns nothing when every argument is supplied', () => {
        expect(remainingArguments(params('[<text>]'), '- narrate hello ')).toEqual([]);
    });
});

describe('hintTextFor', () => {
    const PLAYSOUND = params('[<location>|...]', '[sound:<name>]', '(volume:<#.#>)', '(pitch:<#.#>)');

    it('shows what the command still takes', () => {
        expect(hintTextFor(PLAYSOUND, '- playsound <player.location> '))
            .toBe('[sound:<name>] (volume:<#.#>) (pitch:<#.#>)');
    });

    it('puts REQUIRED arguments first, whatever the syntax order', () => {
        // A line missing a required argument is the case worth telling the user about; an optional
        // reminder that pushed it off the end would be worse than useless.
        // MUTANT CAUGHT: emitting them in plain syntax order.
        const mixed = params('(first:<a>)', '(second:<b>)', '[third:<c>]');
        expect(hintTextFor(mixed, '- x ')).toBe('[third:<c>] (first:<a>) (second:<b>)');
    });

    it('says nothing once everything is supplied', () => {
        // MUTANT CAUGHT: returning an empty string, which renders as a stray grey blob.
        expect(hintTextFor(params('[<text>]'), '- narrate hello ')).toBeNull();
    });

    it('caps a long syntax rather than filling the screen', () => {
        const long = params('[<a-very-long-argument-name-here>]', '[<another-long-one-here>]',
            '[<and-a-third-that-will-not-fit>]');
        const hint = hintTextFor(long, '- x ')!;
        expect(hint.endsWith('…')).toBe(true);
        expect(hint.length).toBeLessThan(80);
    });

    it('keeps at least one argument even when it alone is over the cap', () => {
        // Truncating to nothing would silently hide the only thing there was to say.
        const huge = params('[<' + 'x'.repeat(100) + '>]');
        expect(hintTextFor(huge, '- x ')).toBe('…');
    });
});
