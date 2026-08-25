let adjustFixtureMeta: () => MetaDocs;
import { describe, it, expect, beforeEach } from 'vitest';
import { ScriptChecker } from './scriptChecker';
import { ScriptCheckContext } from './tagChecks';
import {
    CommandCheckDetails, COMMAND_CHECKERS, register, argHasPrefix, BAD_EXECUTE_COMMANDS
} from './commandSpecifics';
import type { CommandChecker } from './commandSpecifics';
import { buildArgs } from './buildArgs';
import type { MetaDocs } from '../metaDocs/metaTypes';
import { buildMetaDocs } from '../metaDocs/metaDocsManager';
import { linkTypeGraph } from '../metaDocs/metaLinker';

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

/**
 * Phase 2C-5 Task 3: the twelve command checkers
 * (ScriptCheckerCommandSpecifics.cs:114-308).
 */

/** Runs the registered checker for a command line, with arguments built the way the real caller does. */
function runChecker(commandText: string, opts: { meta?: MetaDocs; context?: ScriptCheckContext } = {}) {
    const checker = new ScriptChecker('- narrate placeholder');
    checker.meta = opts.meta ?? null;
    const space = commandText.indexOf(' ');
    const commandName = toLower(space < 0 ? commandText : commandText.substring(0, space));
    const argText = space < 0 ? '' : commandText.substring(space + 1);
    const args = buildArgs(0, commandName.length + 1, argText, null);
    const details = new CommandCheckDetails();
    details.checker = checker;
    details.commandName = commandName;
    details.commandText = commandText;
    details.arguments = args;
    details.argCount = args.filter(a => !a.text.startsWith('save:') && !a.text.startsWith('if:')
        && !a.text.startsWith('player:') && !a.text.startsWith('npc:')).length;
    details.line = 0;
    details.startChar = 0;
    details.context = opts.context ?? new ScriptCheckContext();
    details.script = null;
    const fn = COMMAND_CHECKERS.get(commandName);
    if (fn !== undefined) {
        fn(details);
    }
    return {
        checker,
        details,
        keys: [...checker.errors, ...checker.warnings, ...checker.minorWarnings].map(w => w.warningUniqueKey),
        defs: Array.from(details.context.definitions).sort()
    };
}

function toLower(s: string): string { return s.replace(/[A-Z]/g, c => c.toLowerCase()); }

describe('the if/waituntil/while checker (:114-128)', () => {
    it('reports "== true" as truly_true, over just the offending fragment', () => {
        const r = runChecker('if <[x]> == true:');
        expect(r.keys).toContain('truly_true');
        const w = r.checker.errors.find(e => e.warningUniqueKey === 'truly_true')!;
        expect({ start: w.startChar, end: w.endChar })
            .toEqual({ start: 'if <[x]>'.length, end: 'if <[x]>'.length + ' == true'.length });
    });

    it('reports "== false" too, and with ITS length', () => {
        // :120-121 -- the second probe resets borkLen, so the range is nine characters not eight.
        // MUTANT CAUGHT: keeping ' == true'.length for the false case.
        const r = runChecker('if <[x]> == false:');
        const w = r.checker.errors.find(e => e.warningUniqueKey === 'truly_true')!;
        expect(w.endChar - w.startChar).toBe(' == false'.length);
    });

    it('says nothing about an ordinary comparison', () => {
        expect(runChecker('if <[x]> == 5:').keys).toEqual([]);
    });

    it('is registered for waituntil and while as well', () => {
        expect(runChecker('waituntil <[x]> == true:').keys).toContain('truly_true');
        expect(runChecker('while <[x]> == true:').keys).toContain('truly_true');
    });
});

describe('the execute checker (:187-198)', () => {
    it('warns for a vanilla command', () => {
        expect(runChecker('execute as_server "gamemode creative"').keys).toContain('bad_execute');
    });

    it('reads the SECOND argument past an as_ prefix', () => {
        // :191. Without that shift, the check would test `as_server` itself and never fire.
        // MUTANT CAUGHT: always reading arguments[0].
        expect(runChecker('execute as_op "kick someone"').keys).toContain('bad_execute');
    });

    it('reads the FIRST argument when there is no as_ prefix', () => {
        expect(runChecker('execute "say hi" extra').keys).toContain('bad_execute');
    });

    it('warns for a namespaced vanilla command not in the list', () => {
        // :193's two startsWith tests catch `minecraft:`/`bukkit:` forms the name list misses.
        expect(runChecker('execute as_server "minecraft:somethingnew x"').keys).toContain('bad_execute');
        expect(runChecker('execute as_server "bukkit:whatever x"').keys).toContain('bad_execute');
    });

    it('says nothing for a genuine plugin command', () => {
        expect(runChecker('execute as_server "myplugin reload"').keys).toEqual([]);
    });

    it('needs at least two arguments before it looks at anything', () => {
        // :189's `ArgCount >= 2`, which is also what stops arguments[1] being read out of range.
        expect(runChecker('execute').keys).toEqual([]);
    });
});

describe('the inject checker (:199-208)', () => {
    it('marks BOTH definitions and save entries unknowable', () => {
        // The most consequential line in this file: an injected script brings names this file
        // cannot see, so 2C-4 must stop reporting them. Without it, one inject paints a whole
        // script red.
        // MUTANT CAUGHT: setting only one of the two flags.
        const r = runChecker('inject othertask');
        expect(r.details.context.hasUnknowableDefinitions).toBe(true);
        expect(r.details.context.hasUnknowableSaveEntries).toBe(true);
    });

    it('does not report an invalid script name while there is no surrounding workspace', () => {
        // contextValidatedIsValidScriptName returns TRUE when surroundingWorkspace is null,
        // which it is until Phase 2D -- so invalid_script_inject is dormant by construction.
        expect(runChecker('inject nosuchscript').keys).toEqual([]);
    });
});

describe('the run/runlater checker (:210-217)', () => {
    it('is dormant for the same reason, on both names', () => {
        expect(runChecker('run nosuchscript').keys).toEqual([]);
        expect(runChecker('runlater nosuchscript').keys).toEqual([]);
    });
});

describe('the queue checker (:218-224)', () => {
    it('reports the old "queue clear" and "queue stop" as MINOR warnings', () => {
        // :222 routes this to MinorWarnings -- it is a style migration, not a fault.
        // MUTANT CAUGHT: routing it to errors or warnings.
        for (const form of ['queue clear', 'queue stop']) {
            const r = runChecker(form);
            expect(r.keys, form).toEqual(['queue_clear']);
            expect(r.checker.minorWarnings.length, form).toBe(1);
        }
    });

    it('says nothing when there is more than one argument', () => {
        // :220's `ArgCount == 1`. `- queue <[id]> clear` is a different, legitimate form.
        expect(runChecker('queue <[id]> clear').keys).toEqual([]);
    });
});

describe('the define/definemap checker (:225-232)', () => {
    it('tracks the definition name, cut at ":" and then at "."', () => {
        expect(runChecker('define greeting hello').defs).toEqual(['greeting']);
        expect(runChecker('define mymap.key value').defs).toEqual(['mymap']);
        expect(runChecker('define name:value').defs).toEqual(['name']);
    });

    it('works for definemap too', () => {
        expect(runChecker('definemap thing:').defs).toEqual(['thing']);
    });

    it('reads arguments[0] even when argCount skipped it (C# QUIRK)', () => {
        // :227 gates on argCount but indexes `arguments`, and the two differ: argCount ignores
        // the four prefixed forms while `arguments` keeps them. So `- define save:x` tracks a
        // definition called `save`.
        // MUTANT CAUGHT: indexing a filtered list, which would be the sensible thing to write
        // and is not what the C# does.
        expect(runChecker('define save:x realname').defs).toEqual(['save']);
    });

    it('tracks nothing when there are no arguments', () => {
        expect(runChecker('define').defs).toEqual([]);
    });
});

describe('the loop checkers (:233-265)', () => {
    it('gives foreach loop_index, value and key by default', () => {
        // foreach is registered TWICE (:233 and :253), so it gets the `as:`/loop_index handling
        // AND the `key:` handling. All three names come from that combination.
        // MUTANT CAUGHT: dropping either registration.
        expect(runChecker('foreach <[list]>:').defs).toEqual(['key', 'loop_index', 'value']);
    });

    it('honours as: and key: on a foreach', () => {
        // NO trailing colon, because the command never arrives with one: `gatherActualContainers`
        // strips it when it turns `- foreach x:` into a sub-section (containerGather.ts, port of
        // ScriptChecker.cs:1550). An earlier draft of this test included it and expected `mykey`,
        // which is not what the C# produces for that input -- see the next test.
        expect(runChecker('foreach <[map]> as:entry key:mykey').defs).toEqual(['entry', 'loop_index', 'mykey']);
    });

    it('does NOT strip a trailing colon from an as:/key: value (C# QUIRK)', () => {
        // :244 and :262 slice off the `as:`/`key:` prefix and nothing else. If a trailing colon
        // ever did reach here the definition would be recorded WITH it, and `<[mykey]>` would
        // then read as undefined in 2C-4.
        //
        // Unreachable today, because the container parser removes the colon first -- pinned so
        // that if a future caller stops doing that, the consequence is visible here rather than
        // as a mystery false positive.
        // MUTANT CAUGHT: adding a trailing-colon strip the C# does not have.
        expect(runChecker('foreach <[map]> key:mykey:').defs).toContain('mykey:');
    });

    it('gives repeat value but NOT loop_index', () => {
        // :248's `CommandName != "repeat"` -- repeat has no loop_index.
        // MUTANT CAUGHT: dropping the repeat exclusion.
        expect(runChecker('repeat 5:').defs).toEqual(['value']);
    });

    it('gives while loop_index but NOT value', () => {
        // :235's `CommandName != "while"` -- while has no loop variable.
        expect(runChecker('while <[x]>:').defs).toEqual(['loop_index']);
    });

    it('still runs the truly_true check on while, because it is registered twice', () => {
        // `while` is in BOTH ['if','waituntil','while'] (:114) and ['foreach','repeat','while']
        // (:233). Both must run.
        // MUTANT CAUGHT: `register` overwriting instead of combining.
        const r = runChecker('while <[x]> == true:');
        expect(r.keys).toContain('truly_true');
        expect(r.defs).toEqual(['loop_index']);
    });
});

describe('the give checker (:266-287)', () => {
    it('warns when the linked player is named redundantly', () => {
        for (const form of ['give stone <player>', 'give stone <player.name>', 'give stone <npc>']) {
            expect(runChecker(form).keys, form).toContain('give_player');
        }
    });

    it('says nothing for an ordinary give', () => {
        expect(runChecker('give stone quantity:4').keys).toEqual([]);
    });

    it('NEVER reports give_invalid_item -- the C# check is dead (ported dead)', () => {
        // :272 passes the literal "quantity:" as StartsWithAny's INPUT and ignores the lambda's
        // own argument, making the predicate constantly false. `itemGive` is therefore always
        // null and the item validation below it is unreachable. Ported dead deliberately; this
        // test is what stops someone "fixing" it without a ruling.
        // MUTANT CAUGHT: implementing the check as intended.
        expect(runChecker('give nosuchitemname').keys).not.toContain('give_invalid_item');
        expect(runChecker('give definitely_not_a_real_item quantity:1').keys).not.toContain('give_invalid_item');
    });
});

describe('the take checker (:288-294)', () => {
    it('warns about a bare item argument', () => {
        expect(runChecker('take stone').keys).toEqual(['take_raw']);
    });

    it('accepts the prefixed form and the four bare words that are legal', () => {
        expect(runChecker('take item:stone').keys).toEqual([]);
        for (const word of ['money', 'xp', 'iteminhand', 'cursoritem']) {
            expect(runChecker('take ' + word).keys, word).toEqual([]);
        }
    });
});

describe('the case checker (:295-301)', () => {
    it('reports "- case default:" as a likely mistake', () => {
        // :297 strips colons before comparing, so both spellings are caught.
        expect(runChecker('case default').keys).toEqual(['case_default']);
        expect(runChecker('case default:').keys).toEqual(['case_default']);
    });

    it('says nothing for a real case value', () => {
        expect(runChecker('case 5').keys).toEqual([]);
    });
});

describe('the determine checker (:302-308)', () => {
    it('catches the one-L spelling of cancelled', () => {
        expect(runChecker('determine canceled').keys).toEqual(['typo_cancelled']);
    });

    it('accepts the two-L spelling', () => {
        expect(runChecker('determine cancelled').keys).toEqual([]);
    });
});

describe('the adjust checker (:129-186) -- the largest of the twelve', () => {
    /** Mechanisms: one unique, one deprecated, and one name shared by two object types. */
    function adjustMeta(): MetaDocs {
        const mech = (obj: string, name: string, extra: string[] = []) => ({
            objectType: 'mechanism', url: 'src#L1',
            data: ['@object ' + obj, '@name ' + name, '@input None', '@description x', ...extra, '@end_meta']
        });
        const d = buildMetaDocs([
            { objectType: 'objecttype', url: 'src#L1', data: ['@name ObjectTag', '@prefix none', '@base none', '@format x', '@description x', '@end_meta'] },
            { objectType: 'objecttype', url: 'src#L1', data: ['@name server', '@prefix server', '@base ObjectTag', '@format x', '@description x', '@exampleadjustobject server', '@end_meta'] },
            mech('PlayerTag', 'unique_mech'),
            mech('PlayerTag', 'old_mech', ['@deprecated Use something else.']),
            // PlayerTag's copy is deprecated and NPCTag's is not, so picking the WRONG one is
            // observable. With both undeprecated, 'always take possible[0]' survives.
            mech('PlayerTag', 'shared_mech', ['@deprecated Old shared.']),
            mech('NPCTag', 'shared_mech')
        ]);
        linkTypeGraph(d);
        return d;
    }
    const META = adjustMeta();
    adjustFixtureMeta = () => META;

    it('accepts a well-formed adjust with a known mechanism', () => {
        expect(runChecker('adjust <player> unique_mech:5', { meta: META }).keys).toEqual([]);
    });

    it('reports bad_adjust_no_mech when there is no mechanism argument at all', () => {
        // :134-140. Nothing prefixed, and the bare word is a raw-adjustable object.
        expect(runChecker('adjust server', { meta: META }).keys).toEqual(['bad_adjust_no_mech']);
    });

    it('allows a single tag as the second argument -- that is adjust-by-MapTag', () => {
        // :136's exemption, and the reason the corpus sweep does not light up: `- adjust <[ent]>
        // <map[...]>` is the commonest adjust form in the user's scripts.
        // MUTANT CAUGHT: dropping the exemption, which would report every map-form adjust.
        expect(runChecker('adjust server <map[a=1;b=2]>', { meta: META }).keys).toEqual([]);
    });

    it('reports bad_adjust_unknown_mech for a name no mechanism has', () => {
        const r = runChecker('adjust <player> nosuchmech:5', { meta: META });
        expect(r.keys).toEqual(['bad_adjust_unknown_mech']);
        // Range covers the mechanism NAME only, not its value.
        const w = r.checker.errors[0];
        expect(w.endChar - w.startChar).toBe('nosuchmech'.length);
    });

    it('reports bad_adjust_deprecated_mech, naming the mechanism and its reason', () => {
        const r = runChecker('adjust <player> old_mech:5', { meta: META });
        expect(r.keys).toEqual(['bad_adjust_deprecated_mech']);
        expect(r.checker.errors[0].customMessageForm).toBe("Mechanism 'PlayerTag.old_mech' is deprecated: Use something else.");
    });

    it('picks the mechanism matching the object being adjusted when the name is shared', () => {
        // :150-166. Two types define `shared_mech`; the bare object argument decides which.
        // MUTANT CAUGHT: always taking possible[0]. PlayerTag's copy of this name is
        // deprecated and NPCTag's is not, so choosing wrongly reports a deprecation that does
        // not apply. An earlier fixture had neither deprecated and the mutant survived it.
        expect(runChecker('adjust NPCTag shared_mech:5', { meta: META }).keys).toEqual([]);
        expect(runChecker('adjust PlayerTag shared_mech:5', { meta: META }).keys).toEqual(['bad_adjust_deprecated_mech']);
    });

    it('falls back to the FIRST candidate when the object does not match any (C# QUIRK)', () => {
        // :162-165. The C# does not give up -- it takes possible.First(). So a shared name with
        // an unrecognised object still resolves, to whichever type happened to load first.
        // MUTANT CAUGHT: reporting bad_adjust_unknown_mech instead. The fallback lands on
        // PlayerTag's deprecated copy, which is exactly the wrong-type report the C# accepts.
        expect(runChecker('adjust SomethingElse shared_mech:5', { meta: META }).keys).toEqual(['bad_adjust_deprecated_mech']);
    });

    it('reports bad_adjust_unknown_def for a def: naming nothing', () => {
        // :176-184.
        const r = runChecker('adjust <player> unique_mech:5 def:nosuchdef', { meta: META });
        expect(r.keys).toEqual(['bad_adjust_unknown_def']);
    });

    it('accepts a def: the context knows', () => {
        const context = new ScriptCheckContext();
        context.definitions.add('knowndef');
        expect(runChecker('adjust <player> unique_mech:5 def:knowndef', { meta: META, context }).keys).toEqual([]);
    });

    it('is silenced by hasUnknowableDefinitions', () => {
        const context = new ScriptCheckContext();
        context.hasUnknowableDefinitions = true;
        expect(runChecker('adjust <player> unique_mech:5 def:nosuchdef', { meta: META, context }).keys).toEqual([]);
    });

    it('never treats def: or if: as the mechanism', () => {
        // :131's argReserved. Without it, `def:` would be picked as the mechanism name -- it is
        // prefixed, so it wins the first search -- and every adjust with a def: would report
        // bad_adjust_unknown_mech.
        // MUTANT CAUGHT: dropping argReserved from either search.
        const context = new ScriptCheckContext();
        context.definitions.add('d');
        expect(runChecker('adjust <player> def:d unique_mech:5', { meta: META, context }).keys).toEqual([]);
    });

    it('matches a raw-adjustable object CASE-SENSITIVELY (C# QUIRK)', () => {
        // :133 is `!Meta.RawAdjustables.Contains(s.Text)` -- an ordinal set lookup against the
        // argument as written. RawAdjustables holds the type's `Name` verbatim, which on live
        // meta is lowercase (`server`, `system`), so `adjust Server` does NOT match and the
        // capitalised word is then read as a mechanism name that does not exist.
        //
        // Found while writing these tests: the fixture originally declared `@name Server` and
        // the no-mechanism cases failed, because `server` in the command no longer matched.
        // MUTANT CAUGHT: lowercasing either side of that comparison.
        expect(runChecker('adjust server', { meta: META }).keys).toEqual(['bad_adjust_no_mech']);
        expect(runChecker('adjust Server', { meta: META }).keys).toEqual(['bad_adjust_unknown_mech']);
    });

    it('does nothing at all when no meta is loaded', () => {
        // Cold start: every branch here compares against the meta, so with none there is nothing
        // to say. Guessing would mean reporting every adjust in the file for a few seconds.
        expect(runChecker('adjust <player> nosuchmech:5').keys).toEqual([]);
    });
});

/**
 * Four tests added after a mutation audit found the originals could not see these branches.
 * Each comment records what the earlier fixture failed to exercise.
 */
describe('gaps the first draft of these tests could not see', () => {
    it('adjust: lowercases the mechanism name before looking it up', () => {
        // :143's ToLowerFast. Every earlier fixture wrote the name in lowercase already, so
        // removing the fold changed nothing and the mutant survived.
        // MUTANT CAUGHT: dropping the lowercase, which makes `UNIQUE_MECH:` unrecognised.
        const meta = adjustFixtureMeta();
        expect(runChecker('adjust <player> UNIQUE_MECH:5', { meta }).keys).toEqual([]);
    });

    it('execute: needs TWO arguments, not one, before it inspects anything', () => {
        // :189's `ArgCount >= 2`. The earlier test used `execute` with NO arguments, where both
        // `>= 1` and `>= 2` refuse -- so loosening the gate survived. One argument separates
        // them: `execute "say hi"` is argCount 1 and must stay silent.
        // MUTANT CAUGHT: relaxing the gate to `>= 1`.
        expect(runChecker('execute "say hi"').keys).toEqual([]);
        // And two arguments still warn, so the gate is not simply off.
        expect(runChecker('execute "say hi" extra').keys).toEqual(['bad_execute']);
    });

    it('queue: needs EXACTLY one argument', () => {
        // :220's `ArgCount == 1`. The earlier test used `queue <[id]> clear`, whose FIRST
        // argument is not `clear`, so it stayed silent whether or not the count was checked.
        // Putting `clear` first separates them.
        // MUTANT CAUGHT: dropping the count check -- `queue clear extra` would warn.
        expect(runChecker('queue clear extra').keys).toEqual([]);
        expect(runChecker('queue clear').keys).toEqual(['queue_clear']);
    });

    it('define: the checker\'s own "." cut is redundant with trackDefinition\'s (EQUIVALENT)', () => {
        // :229 cuts the name at '.', and then `TrackDefinition` (:61) cuts at '.' again. Removing
        // the first cut therefore changes nothing -- a genuinely equivalent mutant in both the C#
        // and this port, not an untested branch. Recorded so the next audit does not chase it.
        //
        // The ':' cut is NOT redundant and has its own test above: trackDefinition does not do it.
        const viaChecker = runChecker('define mymap.key value').defs;
        const details = makeDetails('define x');
        details.trackDefinition('mymap.key');
        expect(viaChecker).toEqual(Array.from(details.context.definitions));
        expect(viaChecker).toEqual(['mymap']);
    });
});
