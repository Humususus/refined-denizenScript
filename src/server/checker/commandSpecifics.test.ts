import { describe, it, expect, beforeEach } from 'vitest';
import { ScriptChecker } from './scriptChecker';
import { ScriptCheckContext } from './tagChecks';
import {
    CommandCheckDetails, COMMAND_CHECKERS, register, argHasPrefix, BAD_EXECUTE_COMMANDS
} from './commandSpecifics';
import type { CommandChecker } from './commandSpecifics';

/**
 * Every expectation was hand-derived from
 * SharpDenizenTools/ScriptAnalysis/ScriptCheckerCommandSpecifics.cs.
 */

/** Builds details over a command line, with the pieces CheckSingleCommand would fill in. */
function makeDetails(commandText: string, context?: ScriptCheckContext): CommandCheckDetails {
    const details = new CommandCheckDetails();
    details.checker = new ScriptChecker('- narrate placeholder');
    details.commandName = commandText.split(' ')[0].toLowerCase();
    details.commandText = commandText;
    details.arguments = [];
    details.argCount = 0;
    details.line = 0;
    details.startChar = 0;
    details.context = context ?? new ScriptCheckContext();
    details.script = null;
    return details;
}

describe('CommandCheckDetails.warn', () => {
    it('spans the whole command line when no range is given', () => {
        // The C# has two overloads (:47-56); the defaulted form is the one most checkers use.
        const details = makeDetails('narrate hello');
        details.startChar = 7;
        details.warn(details.checker.warnings, 'k', 'm');
        expect({ start: details.checker.warnings[0].startChar, end: details.checker.warnings[0].endChar })
            .toEqual({ start: 7, end: 7 + 'narrate hello'.length });
    });

    it('uses an explicit range when given one', () => {
        const details = makeDetails('narrate hello');
        details.warn(details.checker.warnings, 'k', 'm', 3, 5);
        expect({ start: details.checker.warnings[0].startChar, end: details.checker.warnings[0].endChar })
            .toEqual({ start: 3, end: 5 });
    });
});

describe('CommandCheckDetails.trackDefinition', () => {
    it('stores the name truncated at the first dot', () => {
        const details = makeDetails('define x');
        details.trackDefinition('mymap.key');
        expect(Array.from(details.context.definitions)).toEqual(['mymap']);
    });

    it('tests for "<" on the UNTRUNCATED input (C# QUIRK)', () => {
        // :61-65 truncates before storing but checks `def.Contains('<')` on the original. So a
        // name whose tag sits AFTER the dot still marks definitions unknowable, even though the
        // stored fragment has no '<' in it.
        // MUTANT CAUGHT: testing the truncated string, which would leave the flag false and let
        // 2C-4's def_of_nothing fire on a script whose names cannot be known.
        const details = makeDetails('define x');
        details.trackDefinition('mymap.<[key]>');
        expect(Array.from(details.context.definitions)).toEqual(['mymap']);
        expect(details.context.hasUnknowableDefinitions).toBe(true);
    });

    it('leaves the flag alone for a plain name', () => {
        const details = makeDetails('define x');
        details.trackDefinition('plain');
        expect(details.context.hasUnknowableDefinitions).toBe(false);
    });
});

describe('register', () => {
    // The real registry is module state shared with the checkers; these tests use their own
    // names so they cannot collide with it.
    const NAME_A = '__test_a';
    const NAME_B = '__test_b';
    beforeEach(() => {
        COMMAND_CHECKERS.delete(NAME_A);
        COMMAND_CHECKERS.delete(NAME_B);
    });

    function recorder(label: string, into: string[]): CommandChecker {
        return () => { into.push(label); };
    }

    it('registers one checker under every name given', () => {
        const calls: string[] = [];
        register([NAME_A, NAME_B], recorder('first', calls));
        COMMAND_CHECKERS.get(NAME_A)!(makeDetails('x'));
        COMMAND_CHECKERS.get(NAME_B)!(makeDetails('x'));
        expect(calls).toEqual(['first', 'first']);
    });

    it('runs the NEWLY registered checker FIRST when a name is registered twice', () => {
        // C#'s `method += action` appends the EXISTING delegate to the new one, so the newer
        // check runs first. That decides the order warnings appear in for `while` (registered at
        // :114 then :233) and `foreach` (:233 then :253) -- the only two names registered twice.
        // MUTANT CAUGHT: combining as `existing then new`, which silently reorders those
        // commands' diagnostics.
        const calls: string[] = [];
        register([NAME_A], recorder('older', calls));
        register([NAME_A], recorder('newer', calls));
        COMMAND_CHECKERS.get(NAME_A)!(makeDetails('x'));
        expect(calls).toEqual(['newer', 'older']);
    });

    it('carries a combination forward to LATER names in the same array (C# QUIRK)', () => {
        // :73-84 reassigns `method` INSIDE the loop, so once one name has combined with an
        // existing checker, every later name in the same call inherits that combination.
        //
        // A latent bug in the C#, and it stays harmless only because the one array that hits it,
        // ["foreach", "repeat", "while"], lists the already-registered `while` LAST. Reordering
        // that array would change behaviour -- there and here.
        // MUTANT CAUGHT: resetting the accumulator per name, which is what a reader would
        // "obviously" write and which silently diverges from the C#.
        const calls: string[] = [];
        register([NAME_A], recorder('pre-existing', calls));
        register([NAME_A, NAME_B], recorder('bulk', calls));
        calls.length = 0;
        COMMAND_CHECKERS.get(NAME_B)!(makeDetails('x'));
        expect(calls).toEqual(['bulk', 'pre-existing']);
    });
});

describe('argHasPrefix (ScriptCheckerCommandSpecifics.cs:105-109)', () => {
    it('accepts an ordinary prefixed argument', () => {
        expect(argHasPrefix('save:x')).toBe(true);
        expect(argHasPrefix('to:<player>')).toBe(true);
    });

    it('rejects an argument with no prefix at all', () => {
        expect(argHasPrefix('stone')).toBe(false);
        expect(argHasPrefix('')).toBe(false);
    });

    it('rejects when a forbidden symbol comes BEFORE the colon', () => {
        // The rule is "the FIRST forbidden symbol must be the colon", not "a colon exists".
        // MUTANT CAUGHT: testing `arg.includes(':')`, which would read `a.b:c` and `<tag>:x` as
        // prefixed -- and the adjust checker uses this to decide what a mechanism name is.
        expect(argHasPrefix('a.b:c')).toBe(false);
        expect(argHasPrefix('<tag>:x')).toBe(false);
        expect(argHasPrefix('a b:c')).toBe(false);
        expect(argHasPrefix('a!b:c')).toBe(false);
    });
});

describe('BAD_EXECUTE_COMMANDS', () => {
    it('holds the C#\'s 76 names', () => {
        // Extracted from the C# source mechanically rather than retyped, and verified the same
        // way -- a 76-name list is exactly where a transcription error hides silently.
        expect(BAD_EXECUTE_COMMANDS.size).toBe(76);
    });

    it('covers all three groups the C# comments call out', () => {
        expect(BAD_EXECUTE_COMMANDS.has('gamemode')).toBe(true);   // vanilla
        expect(BAD_EXECUTE_COMMANDS.has('give')).toBe(true);       // seen misuses
        expect(BAD_EXECUTE_COMMANDS.has('denizen')).toBe(true);    // never run these
        expect(BAD_EXECUTE_COMMANDS.has('narrate')).toBe(false);
    });
});
