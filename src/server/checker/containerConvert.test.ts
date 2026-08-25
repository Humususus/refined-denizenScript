import { describe, it, expect } from 'vitest';
import { ScriptChecker } from './scriptChecker';
import { ScriptingWorkspaceData, ScriptContainerData, convertContainers } from './containerConvert';
import { LineTrackedString } from './scriptWarnings';
import type { ScriptWarning } from './scriptWarnings';
import type { SectionValue } from './containerGather';

/**
 * Every expectation in this file was hand-derived by reading
 * SharpDenizenTools/ScriptAnalysis/ScriptChecker.cs:1689-1760 (`ConvertContainers`),
 * ScriptContainerData.cs and ScriptingWorkspaceData.cs.
 *
 * These fixtures go through the FULL `run()` rather than calling `convertContainers` directly,
 * because the conversion consumes the gather's output and building that by hand would be
 * building a second, unverified parser. The cost is that line-level warnings appear too, so the
 * assertions below filter `errors` by key rather than asserting on the whole list -- except
 * where the point IS the whole list.
 */

/** Compact shape for asserting on a warning. */
function shape(w: ScriptWarning): { line: number; key: string; start: number; end: number } {
    return { line: w.line, key: w.warningUniqueKey, start: w.startChar, end: w.endChar };
}

function run(script: string): ScriptChecker {
    const checker = new ScriptChecker(script);
    checker.run();
    return checker;
}

function errorsOfKind(checker: ScriptChecker, key: string) {
    return checker.errors.filter(w => w.warningUniqueKey === key).map(shape);
}

/**
 * The definition names `procAsScript` adds to EVERY task container regardless of its contents
 * (ScriptChecker.cs:1881-1891): the `shoot` command workaround and the ten default `run`
 * arguments. Listed here so the tests below can subtract them and still assert exactly, rather
 * than relaxing to `toContain`.
 */
const TASK_BASELINE_DEFS = ['shot_entities', 'last_entity', 'location', 'hit_entities',
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

/** A container's own definition names, with the unconditional task baseline removed. */
function ownDefs(checker: ScriptChecker, name: string): string[] {
    const defs = checker.generatedWorkspace.scripts.get(name)!.defNames;
    return Array.from(defs.exactKnown).filter(d => !TASK_BASELINE_DEFS.includes(d)).sort();
}

describe('convertContainers: a well-formed container', () => {
    it('produces a ScriptContainerData with name, line, type and knownType', () => {
        // ScriptChecker.cs:1711-1718. The name is trimmed AND lowercased (:1713), which is what
        // makes `generatedWorkspace.scripts` case-insensitively addressable.
        // MUTANT CAUGHT: storing under the raw title text -- 'MyTask' would then not be found
        // by the lowercase lookup every consumer uses.
        //
        // The container deliberately does NOT start on line 0: `lineNumber` is asserted as 2,
        // and an earlier draft that put it on line 0 could not tell the assignment from the
        // field's default. Confirmed by mutation -- deleting the assignment survived.
        const checker = run('# a comment\n\nMyTask:\n  type: task\n  script:\n  - narrate hi');
        expect(Array.from(checker.generatedWorkspace.scripts.keys())).toEqual(['mytask']);
        const container = checker.generatedWorkspace.scripts.get('mytask')!;
        expect(container.name).toBe('mytask');
        expect(container.lineNumber).toBe(2);
        expect(container.type).toBe('task');
        expect(container.knownType!.scriptKeys).toEqual(['script']);
        expect(checker.errors).toEqual([]);
    });

    it('keeps the gathered section as the container\'s keys', () => {
        // ScriptChecker.cs:1715 -- `Keys = map`, the SAME object the gather built, not a copy.
        // Phase 2C-4 walks it to reach each command.
        // MUTANT CAUGHT: leaving `keys` at its empty default.
        const checker = run('my_task:\n  type: task\n  script:\n  - narrate hi');
        const container = checker.generatedWorkspace.scripts.get('my_task')!;
        expect(Array.from(container.keys.keys())).toEqual(['type', 'script']);
        expect(container.keys).toBe((checker.containers!.get('my_task')!).value);
    });

    it('lowercases the type before looking it up', () => {
        // ScriptChecker.cs:1705 -- `type.ToString().Trim().ToLowerFast()`. Denizen authors write
        // `type: Task` freely, and the table is keyed lowercase.
        // MUTANT CAUGHT: looking up the raw text, which would make every capitalised type a
        // `wrong_type` error on a perfectly valid script.
        const checker = run('my_task:\n  type: Task');
        expect(checker.generatedWorkspace.scripts.get('my_task')!.type).toBe('task');
        expect(errorsOfKind(checker, 'wrong_type')).toEqual([]);
    });

    it('converts every container in a multi-container file', () => {
        // ScriptChecker.cs:1691's loop. Three containers of three types.
        const checker = run(
            'a_task:\n  type: task\n  script:\n  - narrate hi\n' +
            'a_world:\n  type: world\n  events:\n    on player joins:\n    - narrate hi\n' +
            'a_data:\n  type: data\n  stuff: 1'
        );
        expect(Array.from(checker.generatedWorkspace.scripts.keys())).toEqual(['a_task', 'a_world', 'a_data']);
        expect(Array.from(checker.generatedWorkspace.scripts.values()).map(c => c.type)).toEqual(['task', 'world', 'data']);
        expect(checker.errors).toEqual([]);
    });
});

describe('convertContainers: the three error keys', () => {
    it('reports invalid_container "missing content?" when the value is not a section', () => {
        // ScriptChecker.cs:1695-1699. `my_task: hello` gathers as a SCALAR at the root, so there
        // are no keys to convert. Range is (0, Lines[title.Line].Length) -- 'my_task: hello' is
        // 14 characters.
        const checker = run('my_task: hello');
        expect(errorsOfKind(checker, 'invalid_container')).toEqual([{ line: 0, key: 'invalid_container', start: 0, end: 14 }]);
        expect(checker.errors[0].customMessageForm).toBe('Script `my_task` is invalid - missing content?');
        expect(checker.generatedWorkspace.scripts.size).toBe(0);
    });

    it('reports invalid_container "missing \'type\' key" when there is no type', () => {
        // ScriptChecker.cs:1700-1704. 'my_task:' is 8 characters.
        // MUTANT CAUGHT: emitting the "missing content?" message here -- both sites share a key,
        // so only the message distinguishes them.
        const checker = run('my_task:\n  script:\n  - narrate hi');
        expect(errorsOfKind(checker, 'invalid_container')).toEqual([{ line: 0, key: 'invalid_container', start: 0, end: 8 }]);
        expect(checker.errors[0].customMessageForm).toBe("Script `my_task` is invalid - missing 'type' key");
        expect(checker.generatedWorkspace.scripts.size).toBe(0);
    });

    it('reports "missing \'type\' key" even when a type key EXISTS but holds a section', () => {
        // The second half of ScriptChecker.cs:1700's condition -- `type is not LineTrackedString`.
        // The key is present, so the message is misleading, and it is the C#'s message.
        // MUTANT CAUGHT: checking only `TryGetValue`, which would then crash or mis-read when
        // reaching for `.text` on a Map.
        const checker = run('my_task:\n  type:\n    nested: 1');
        expect(errorsOfKind(checker, 'invalid_container').length).toBe(1);
        expect(checker.errors.find(w => w.warningUniqueKey === 'invalid_container')!.customMessageForm)
            .toBe("Script `my_task` is invalid - missing 'type' key");
    });

    it('reports wrong_type for an unrecognised type, and stores nothing', () => {
        // ScriptChecker.cs:1706-1710.
        const checker = run('my_task:\n  type: tsak\n  script:\n  - narrate hi');
        expect(errorsOfKind(checker, 'wrong_type').length).toBe(1);
        expect(checker.errors.find(w => w.warningUniqueKey === 'wrong_type')!.customMessageForm)
            .toBe('Unknown script type (possibly a typo?)!');
        expect(checker.generatedWorkspace.scripts.size).toBe(0);
    });

    it('sizes wrong_type from the TYPE line while reporting on the TITLE line (C# QUIRK)', () => {
        // ScriptChecker.cs:1708 passes `title.Line` as the line but `Lines[typeString.Line].Length`
        // as the range end. Here the title line 'x:' is 2 characters and the type line
        // '  type: nonsense_type_name' is 26, so the range is (0, 26) on a 2-character line --
        // 24 characters past its end. buildDiagnostics clamps it, so the user sees the whole
        // title line rather than the word.
        //
        // Same defect family as the four ranges already corrected by user ruling. REPORTED, NOT
        // FIXED: the user ruled DEFER on the last one of these (see PHASE-2C-BACKLOG.md), so
        // this one waits for its own ruling too.
        // MUTANT CAUGHT: "tidying" this to Lines[title.Line].Length, which would be a silent
        // deviation -- and one that happens to look more correct, which is exactly why it needs
        // pinning rather than trusting.
        const checker = run('x:\n  type: nonsense_type_name');
        expect(errorsOfKind(checker, 'wrong_type')).toEqual([{ line: 0, key: 'wrong_type', start: 0, end: 26 }]);
        expect('  type: nonsense_type_name'.length).toBe(26);
        expect('x:'.length).toBe(2);
    });

    it('keeps converting after a bad container -- ALL THREE guards continue, none returns', () => {
        // ScriptChecker.cs:1698, :1703 and :1709 each `continue` rather than returning. One
        // broken container in a file must not cost the user diagnostics on the rest of it.
        //
        // All three bad shapes appear here, BEFORE the good one, because each guard has its own
        // `continue` and a test covering only one of them proves only that one. An earlier draft
        // used the wrong_type shape alone; turning :1698's `continue` into a `return` survived
        // it, because execution never reached :1698 at all. Confirmed by mutation.
        //
        // MUTANT CAUGHT: returning instead of continuing, at ANY of the three guards.
        const checker = run(
            'a_scalar: hello\n' +                       // :1698  -- value is not a section
            'no_type:\n  script:\n  - narrate hi\n' +    // :1703  -- no type key
            'bad_type:\n  type: nope\n' +                // :1709  -- unknown type
            'fine:\n  type: task\n  script:\n  - narrate hi'
        );
        expect(errorsOfKind(checker, 'invalid_container').length).toBe(2);
        expect(errorsOfKind(checker, 'wrong_type').length).toBe(1);
        expect(Array.from(checker.generatedWorkspace.scripts.keys())).toEqual(['fine']);
    });
});

describe('convertContainers: the definitions key', () => {
    it('reads a pipe-separated scalar into defNames', () => {
        // ScriptChecker.cs:1719-1724, the `defs.ToString().SplitFast('|')` arm.
        const checker = run('my_task:\n  type: task\n  definitions: target|message\n  script:\n  - narrate hi');
        expect(ownDefs(checker, 'my_task')).toEqual(['message', 'target']);
    });

    it('reads a LIST of definitions too', () => {
        // The `defs is List<object> defList` arm of the same line. Both spellings are legal
        // Denizen and a port that handled only one would silently lose the other's names --
        // which becomes a false "undefined definition" in 2C-4.
        // MUTANT CAUGHT: handling only the scalar arm.
        const checker = run('my_task:\n  type: task\n  definitions:\n  - target\n  - message\n  script:\n  - narrate hi');
        expect(ownDefs(checker, 'my_task')).toEqual(['message', 'target']);
    });

    it('lowercases, then cuts at "[", then trims -- in that order', () => {
        // ScriptChecker.cs:1722 -- `d.ToLowerFast().Before('[').Trim()`. Denizen documents
        // optional definitions as `Name[Default]`, so the bracket half must go, and the trim
        // must come AFTER the cut to clear the space that separated them.
        // MUTANT CAUGHT: trimming before cutting, which leaves 'target ' with a trailing space
        // and then never matches a real `<[target]>`.
        const checker = run('my_task:\n  type: task\n  definitions: Target [Optional]|MESSAGE\n  script:\n  - narrate hi');
        expect(ownDefs(checker, 'my_task')).toEqual(['message', 'target']);
    });

    it('adds NOTHING of its own when there is no definitions key', () => {
        // Only the unconditional task baseline from :1881-1891 survives the subtraction -- the
        // `definitions:` branch at :1719-1724 contributes nothing.
        const checker = run('my_task:\n  type: task\n  script:\n  - narrate hi');
        expect(ownDefs(checker, 'my_task')).toEqual([]);
    });
});

describe('convertContainers: the per-container try/catch', () => {
    it('reports exception_internal_container and converts the REST of the file', () => {
        // ScriptChecker.cs:1693 and :1728-1732. The C# wraps each container individually and
        // keeps going, so one container that blows up costs the user that container's
        // diagnostics and nothing else.
        //
        // NO REAL SCRIPT REACHES THIS. Every value the gather can produce is handled by one of
        // the three guards above, and a 4,000-file fuzz over mis-indented input during Phase
        // 2C-2 produced no throw. So this test calls `convertContainers` directly with a
        // HAND-BUILT structure -- a title whose text is not a string, which the gather cannot
        // emit -- because the alternative is leaving a specified error path with no coverage at
        // all. Crafted input, not a monkey-patched implementation.
        //
        // MUTANT CAUGHT: deleting the try/catch. The bad container then throws out of `run()`
        // and the good one below is never converted -- and on the real server that surfaces as
        // the whole file losing its diagnostics.
        const checker = new ScriptChecker('first_line:\nsecond_line:');
        const good = new ScriptContainerData();
        const structure = new Map<string, { key: LineTrackedString; value: SectionValue }>();
        // A title whose `text` is null. Its body must be otherwise VALID -- a real `type: task`
        // -- so that the three guards above all pass and execution reaches :1713's
        // `title.Text.Trim().ToLowerFast()`, which is what throws. An empty body would stop at
        // the missing-type guard and produce `invalid_container` instead, proving nothing.
        // The catch's own `checker.lines[title.line]` is a valid index, so the handler survives.
        const badTitle = new LineTrackedString(0, null as unknown as string, 0);
        const badBody = new Map([['type', { key: new LineTrackedString(0, 'type', 2), value: new LineTrackedString(0, 'task', 8) }]]);
        structure.set('bad', { key: badTitle, value: badBody as SectionValue });
        const goodTitle = new LineTrackedString(1, 'good_task', 0);
        const goodBody = new Map([['type', { key: new LineTrackedString(1, 'type', 2), value: new LineTrackedString(1, 'task', 8) }]]);
        structure.set('good_task', { key: goodTitle, value: goodBody as SectionValue });
        void good;

        convertContainers(checker, structure as never);

        expect(errorsOfKind(checker, 'exception_internal_container')).toEqual([
            { line: 0, key: 'exception_internal_container', start: 0, end: 'first_line:'.length }
        ]);
        // The container after the throwing one still converted -- the whole point of :1693.
        expect(Array.from(checker.generatedWorkspace.scripts.keys())).toEqual(['good_task']);
    });
});

describe('ScriptingWorkspaceData', () => {
    it('starts empty on a fresh checker, before run()', () => {
        const checker = new ScriptChecker('my_task:\n  type: task');
        expect(checker.generatedWorkspace.scripts.size).toBe(0);
        expect(checker.surroundingWorkspace).toBe(null);
    });

    it('mergeIn unions the scripts and both flag sets', () => {
        // ScriptingWorkspaceData.cs:22-30. Phase 2D's cross-file path is the real caller; this
        // pins the semantics now so that phase inherits something tested.
        // MUTANT CAUGHT: replacing `scripts` wholesale rather than merging entry by entry.
        const a = new ScriptingWorkspaceData();
        const one = new ScriptContainerData();
        one.name = 'one';
        a.scripts.set('one', one);
        a.allKnownServerFlagNames.add('alpha');
        const b = new ScriptingWorkspaceData();
        const two = new ScriptContainerData();
        two.name = 'two';
        b.scripts.set('two', two);
        b.allKnownServerFlagNames.add('beta');
        b.allKnownObjectFlagNames.add('gamma');
        a.mergeIn(b);
        expect(Array.from(a.scripts.keys()).sort()).toEqual(['one', 'two']);
        expect(Array.from(a.allKnownServerFlagNames.exactKnown).sort()).toEqual(['alpha', 'beta']);
        expect(Array.from(a.allKnownObjectFlagNames.exactKnown)).toEqual(['gamma']);
    });
});

/**
 * Phase 2C-3 Task 5: `preprocContainer` (ScriptChecker.cs:1763-1955).
 *
 * These are the assertions Phase 2C-4 will lean on. A branch that silently fails to collect a
 * name looks exactly like success from here -- nothing warns -- until 2C-4 reports that name as
 * undefined on a script that is correct. Hence one test per branch, not one per behaviour.
 */
describe('preprocContainer: definitions from commands', () => {
    it('harvests a - define name, cut at ":" and at "."', () => {
        // ScriptChecker.cs:1794-1800. `define` and `definemap` share the arm.
        // MUTANT CAUGHT: dropping either `.Before(':')` or `.Before('.')` -- `- define a.b:c 1`
        // would record `a.b:c`, which no `<[a]>` could ever match.
        const checker = run('t:\n  type: task\n  script:\n  - define greeting hello\n  - define a.b:c 1\n  - definemap m.x val');
        expect(ownDefs(checker, 't')).toEqual(['a', 'greeting', 'm']);
    });

    it('harvests the loop variables of foreach, repeat and while', () => {
        // ScriptChecker.cs:1810-1833. `foreach` adds `loop_index` and then FALLS THROUGH to the
        // while arm (`goto case "while"` at :1818), so it also gets the loop-variable name.
        // Without `as:`, that name defaults to `value`.
        // MUTANT CAUGHT: not falling through -- `foreach` would lose `value`/its `as:` name.
        const checker = run('t:\n  type: task\n  script:\n  - foreach <[list]>:\n    - narrate hi');
        expect(ownDefs(checker, 't')).toEqual(['loop_index', 'value']);
    });

    it('honours as: and key: on a foreach', () => {
        // ScriptChecker.cs:1813-1817 (`key:`) and :1823-1827 (`as:`), both cut at '.'.
        // MUTANT CAUGHT: reading before(':') instead of after(':') -- the names would come out
        // as `as` and `key`.
        const checker = run('t:\n  type: task\n  script:\n  - foreach <[map]> as:entry key:mykey:\n    - narrate hi');
        expect(ownDefs(checker, 't')).toEqual(['entry', 'loop_index', 'mykey']);
    });

    it('adds "value" for a bare while, and the as: name when given', () => {
        // ScriptChecker.cs:1820-1833, without the foreach-only additions.
        const bare = run('t:\n  type: task\n  script:\n  - while <[x]>:\n    - narrate hi');
        expect(ownDefs(bare, 't')).toEqual(['value']);
        const named = run('t:\n  type: task\n  script:\n  - repeat 5 as:i:\n    - narrate hi');
        expect(ownDefs(named, 't')).toEqual(['i']);
    });

    it('adds the unconditional task baseline, and economy gets "amount" instead', () => {
        // ScriptChecker.cs:1881-1891. These look like padding and are not: without them 2C-4
        // reports false "undefined definition" on ordinary scripts.
        // MUTANT CAUGHT: dropping the shoot workaround or the ten run-argument names.
        const task = run('t:\n  type: task\n  script:\n  - narrate hi');
        expect(Array.from(task.generatedWorkspace.scripts.get('t')!.defNames.exactKnown).sort())
            .toEqual(['1', '10', '2', '3', '4', '5', '6', '7', '8', '9', 'hit_entities', 'last_entity', 'location', 'shot_entities']);
        const eco = run('e:\n  type: economy\n  withdraw:\n  - narrate hi');
        const ecoDefs = Array.from(eco.generatedWorkspace.scripts.get('e')!.defNames.exactKnown);
        expect(ecoDefs).toContain('amount');
        expect(ecoDefs).not.toContain('shot_entities');
    });

    it('recurses into a command sub-list, but NOT into a definemap body', () => {
        // ScriptChecker.cs:1898-1906. A `- definemap x:` body is data, so its lines are not
        // commands and must not be harvested.
        // MUTANT CAUGHT: recursing unconditionally -- `- define inner 1` under the definemap
        // would be picked up as a real definition.
        const checker = run(
            't:\n  type: task\n  script:\n' +
            '  - if true:\n    - define nested 1\n' +
            '  - definemap dm:\n      key: value\n'
        );
        expect(ownDefs(checker, 't')).toEqual(['dm', 'nested']);
    });
});

describe('preprocContainer: flags, saves and injects', () => {
    it('separates server flags from object flags', () => {
        // ScriptChecker.cs:1834-1847. `cleanArgs[0] == "server"` is the ONLY thing that routes a
        // flag to the server set; anything else is an object flag. That separation is exactly
        // what the user asked for in prompt.md -- player and server flag completions must not
        // mix -- so it is load-bearing beyond the checker.
        // MUTANT CAUGHT: routing both to one set, or inverting the test.
        const checker = run(
            't:\n  type: task\n  script:\n' +
            '  - flag server serverflag:1\n' +
            '  - flag player playerflag:2\n' +
            '  - flag <player> objflag[expire=1m]:3\n'
        );
        const c = checker.generatedWorkspace.scripts.get('t')!;
        expect(Array.from(c.serverFlags.exactKnown).sort()).toEqual(['serverflag']);
        expect(Array.from(c.objectFlags.exactKnown).sort()).toEqual(['objflag', 'playerflag']);
    });

    it('cuts a flag name at ":", "." and "["', () => {
        // ScriptChecker.cs:1837 -- three cuts in that order, so `a.b[c]:d` records `a`.
        const checker = run('t:\n  type: task\n  script:\n  - flag server a.b[c]:d\n');
        expect(Array.from(checker.generatedWorkspace.scripts.get('t')!.serverFlags.exactKnown)).toEqual(['a']);
    });

    it('harvests the "flag=" special case out of the RAW command text', () => {
        // ScriptChecker.cs:1864-1872 -- data like 'stone[flag=x:y]'. It searches the whole
        // command string rather than the parsed arguments, and cuts at the first of ' ;]:.'
        // MUTANT CAUGHT: searching cleanArgs instead, which never sees the bracketed form.
        const checker = run('t:\n  type: task\n  script:\n  - give stone[flag=special:1]\n');
        expect(Array.from(checker.generatedWorkspace.scripts.get('t')!.objectFlags.exactKnown)).toEqual(['special']);
    });

    it('harvests an inventory flag, skipping the legacy argument aliases', () => {
        // ScriptChecker.cs:1848-1862. The alias list exists because `- inventory flag d:...`
        // would otherwise record `d` (a `destination` alias) as the flag name.
        // MUTANT CAUGHT: dropping the alias list, which records `d:...` -> `d`.
        const checker = run('t:\n  type: task\n  script:\n  - inventory flag d:<player.inventory> myflag:1\n');
        expect(Array.from(checker.generatedWorkspace.scripts.get('t')!.objectFlags.exactKnown)).toEqual(['myflag']);
    });

    it('harvests save: entry names from fullArgs, not cleanArgs', () => {
        // ScriptChecker.cs:1873-1877. `save:` is one of the three prefixes :1791 STRIPS from
        // cleanArgs, so looking there would find nothing at all.
        // MUTANT CAUGHT: reading cleanArgs -- saveEntryNames would come back empty.
        // This is also the index the `<entry[...]>` completion work needs (PHASE-2C-BACKLOG 4b).
        const checker = run('t:\n  type: task\n  script:\n  - spawn zombie save:myentry\n  - webget example.com save:req\n');
        expect(Array.from(checker.generatedWorkspace.scripts.get('t')!.saveEntryNames.exactKnown).sort()).toEqual(['myentry', 'req']);
    });

    it('harvests inject targets, skipping "instantly" and "path:"', () => {
        // ScriptChecker.cs:1801-1809 -- the first argument that is neither.
        const checker = run('t:\n  type: task\n  script:\n  - inject instantly othertask\n');
        expect(Array.from(checker.generatedWorkspace.scripts.get('t')!.injectedPaths.exactKnown)).toEqual(['othertask']);
    });

    it('merges an injected script definitions into the injecting one', () => {
        // ScriptChecker.cs:1739-1759, running with surroundingWorkspace null -- the single-file
        // half. Without it, 2C-4 reports the injected script's definitions as undefined.
        // MUTANT CAUGHT: skipping resolveInjects, or merging in the wrong direction.
        const checker = run(
            'caller:\n  type: task\n  script:\n  - inject helper\n' +
            'helper:\n  type: task\n  script:\n  - define from_helper 1\n'
        );
        const caller = checker.generatedWorkspace.scripts.get('caller')!;
        expect(Array.from(caller.realInjects)).toEqual(['helper']);
        expect(ownDefs(checker, 'caller')).toEqual(['from_helper']);
        expect(ownDefs(checker, 'helper')).toEqual(['from_helper']);
    });

    it('terminates on a self-injecting script', () => {
        // The `RealInjects.Add` return value at ScriptChecker.cs:1749 is the cycle guard.
        // MUTANT CAUGHT: recursing without the guard -- this hangs or blows the stack.
        const checker = run(
            'a:\n  type: task\n  script:\n  - inject b\n' +
            'b:\n  type: task\n  script:\n  - inject a\n'
        );
        expect(Array.from(checker.generatedWorkspace.scripts.get('a')!.realInjects).sort()).toEqual(['a', 'b']);
    });
});

describe('preprocContainer: which keys count as script', () => {
    it('harvests NOTHING from a data container', () => {
        // ScriptChecker.cs:1765-1768 -- the early return. A data container's lists are data.
        // MUTANT CAUGHT: dropping the early return -- `- define x 1` inside a data blob would
        // be treated as a command.
        const checker = run('d:\n  type: data\n  script:\n  - define notacommand 1\n');
        const c = checker.generatedWorkspace.scripts.get('d')!;
        expect(c.defNames.any()).toBe(false);
        expect(c.objectFlags.any()).toBe(false);
    });

    it('harvests ONLY flags.* from an item container', () => {
        // ScriptChecker.cs:1769-1779 -- harvest, then early return.
        // MUTANT CAUGHT: returning before the flags harvest, or falling through to the general
        // loop and treating `lore:` as script.
        const checker = run('i:\n  type: item\n  material: stone\n  flags:\n    myflag.sub: 1\n  lore:\n  - define nope 1\n');
        const c = checker.generatedWorkspace.scripts.get('i')!;
        expect(Array.from(c.objectFlags.exactKnown)).toEqual(['myflag']);
        expect(c.defNames.any()).toBe(false);
    });

    it('skips the "data" and "description" keys on a normal container', () => {
        // ScriptChecker.cs:1783-1786.
        const checker = run('t:\n  type: task\n  data:\n  - define nope 1\n  description:\n  - define alsonope 1\n  script:\n  - define yes 1\n');
        expect(ownDefs(checker, 't')).toEqual(['yes']);
    });

    it('walks a world container events sub-map as script', () => {
        // ScriptChecker.cs:1928-1953, via world's `scriptKeys: ['events.*']` -- the sub-map arm
        // rather than the list arm, and the reason `keyText` is `keyName + '.*'`.
        // MUTANT CAUGHT: testing matchesSet instead of the raw `.includes(keyText)` at :1937.
        const checker = run('w:\n  type: world\n  events:\n    on player joins:\n    - define greeted 1\n');
        expect(ownDefs(checker, 'w')).toEqual(['greeted']);
    });

    it('does NOT walk a strict type declared list key as script', () => {
        // ScriptChecker.cs:1919-1922. `book` is strict and declares `text` as a list key, so its
        // contents are data no matter what they look like.
        // MUTANT CAUGHT: reordering the cascade so canHaveRandomScripts is consulted first.
        const checker = run('b:\n  type: book\n  title: t\n  author: a\n  text:\n  - define nope 1\n');
        expect(checker.generatedWorkspace.scripts.get('b')!.defNames.any()).toBe(false);
    });

    it('walks an unrecognised list key on a NON-strict type that allows random scripts', () => {
        // ScriptChecker.cs:1923-1926 -- the last arm of the cascade. `task` is non-strict with
        // canHaveRandomScripts true, so a made-up key holding a list is treated as script.
        // MUTANT CAUGHT: defaulting canHaveRandomScripts to false (the Task 2 mutant), which
        // would silently stop harvesting here.
        const checker = run('t:\n  type: task\n  script:\n  - narrate hi\n  my_subroutine:\n  - define fromsub 1\n');
        expect(ownDefs(checker, 't')).toEqual(['fromsub']);
    });
});

describe('mergeData', () => {
    it('collects every container flags into the workspace sets', () => {
        // ScriptChecker.cs:2011-2018, called from Run() at :2034.
        // MUTANT CAUGHT: not calling mergeData from run() -- both workspace sets stay empty,
        // which is what a consumer would see as "flags are not tracked at all".
        const checker = run(
            'a:\n  type: task\n  script:\n  - flag server sflag:1\n' +
            'b:\n  type: task\n  script:\n  - flag player oflag:1\n'
        );
        const ws = checker.generatedWorkspace;
        expect(Array.from(ws.allKnownServerFlagNames.exactKnown)).toEqual(['sflag']);
        expect(Array.from(ws.allKnownObjectFlagNames.exactKnown)).toEqual(['oflag']);
    });
});

/**
 * Four tests added after a mutation audit found the originals in this file did not discriminate
 * the branches they named. Each fixture below was chosen specifically to make one guard the
 * DECIDING one; the comments record what masked it before.
 */
describe('preprocContainer: branches the first draft of these tests could not see', () => {
    it('does not recurse into a "- definemap:" sub-section', () => {
        // ScriptChecker.cs:1902's `!onlyEntry.Key.Text.StartsWith("definemap")` guard.
        //
        // The first fixture used `- definemap dm:`, which never reaches this guard at all: the
        // GATHER has its own definemap branch (:1532-1547) that stores such a line whole and
        // swallows its body unparsed, so the list entry is a string, not a sub-map. The guard
        // only ever sees `- definemap:` -- no space, no arguments -- which :1532 does not match
        // (it tests `startsWith('definemap ')`, with the space) and which therefore becomes an
        // ordinary command sub-section.
        //
        // Verified by dumping the parsed structure before asserting: the entry really is a
        // sub-map whose single key is `definemap`, holding a list of one command. Nothing is
        // harvested from it -- `procSingleCommand('definemap')` has no arguments to read, and
        // the guard stops the body being walked.
        //
        // MUTANT CAUGHT: recursing unconditionally -- `inner` appears.
        const checker = run('t:\n  type: task\n  script:\n  - definemap:\n    - define inner 1\n');
        expect(ownDefs(checker, 't')).toEqual([]);
    });

    it('skips a "data" key holding a SECTION, which the cascade would otherwise walk', () => {
        // ScriptChecker.cs:1783-1786's early `continue`.
        //
        // The first fixture gave `data:` a LIST, and that is masked: :1911's
        // `MatchesSet(keyName, AlwaysDataKeys)` arm catches the same two key names one branch
        // later, so the list is ignored either way. The sub-map arm at :1928-1953 has NO
        // equivalent check -- for a non-strict type it falls through to
        // `(!Strict && !keyName.StartsWith("definemap"))` and walks the section as script.
        //
        // MUTANT CAUGHT: dropping the :1783 skip -- `nope` is harvested out of a data blob.
        const checker = run('t:\n  type: task\n  data:\n    inner:\n    - define nope 1\n  script:\n  - define yes 1\n');
        expect(ownDefs(checker, 't')).toEqual(['yes']);
    });

    it('lets Strict suppress an unrecognised list key on a type that allows random scripts', () => {
        // ScriptChecker.cs:1919-1922's `|| script.KnownType.Strict`.
        //
        // The first fixture used `book`, and that cannot show it twice over: `text` is in book's
        // ListKeys so the arm matches anyway, and book's CanHaveRandomScripts is false so the
        // next arm would ignore it regardless. Isolating Strict needs a type that is BOTH strict
        // AND random-capable, with a key in none of its lists -- `assignment`, `interact` or
        // `procedure`. Of those, procedure declares `*` in ScriptKeys so arm 2 swallows
        // everything; `assignment` is the clean case.
        //
        // MUTANT CAUGHT: dropping `|| Strict` -- the next arm's CanHaveRandomScripts (true for
        // assignment) then harvests `fromstrict`.
        const checker = run(
            'a:\n  type: assignment\n  actions:\n    on assignment:\n    - narrate hi\n' +
            '  mystery:\n  - define fromstrict 1\n'
        );
        expect(ownDefs(checker, 'a')).toEqual([]);
    });

    it('walks an unrecognised SUB-MAP key on world via the second disjunct, not the first', () => {
        // ScriptChecker.cs:1937 is `ScriptKeys.Contains(keyText) || (!ListKeys.Contains(keyText)
        // && CanHaveRandomScripts)` -- raw `.Contains`, not `MatchesSet`.
        //
        // The first fixture used world's `events:`, where both spellings agree: `events.*` is
        // literally in world's ScriptKeys, so the first disjunct fires either way. The two only
        // diverge on a key that is in NO list, where the real code still walks it through the
        // second disjunct and `MatchesSet` would not.
        //
        // MUTANT CAUGHT: substituting matchesSet for the whole condition -- `fromnested` is
        // never harvested.
        const checker = run(
            'w:\n  type: world\n  events:\n    on player joins:\n    - narrate hi\n' +
            '  extras:\n    nested:\n    - define fromnested 1\n'
        );
        expect(ownDefs(checker, 'w')).toEqual(['fromnested']);
    });
});

describe('preprocContainer: the item early return', () => {
    it('stops an item container with a stray "script:" key being walked as script', () => {
        // ScriptChecker.cs:1778's `return`, and the ONLY shape that can observe it.
        //
        // I first believed this return was unobservable -- item is Strict, declares no
        // ScriptKeys and has CanHaveRandomScripts false, so all three type-driven arms of the
        // cascade refuse. That reasoning was WRONG, and an exhaustive check over the type table
        // said so: arm 2 also tests `MatchesSet(keyName, AlwaysScriptKeys)`, which is
        // TYPE-INDEPENDENT. Any of `script`, `scripts`, `subscripts`, `subtasks`, `inject`,
        // `injects`, `injectables` or `subprocedures` reaches procAsScript on ANY type.
        //
        // A stray `script:` on an item is not contrived, either -- it is exactly the mistake
        // item's own `likelyBadKeys` list exists to flag.
        //
        // MUTANT CAUGHT: dropping the early return. `nope` is harvested, and the ten default
        // run-argument definitions are added to an item container.
        const checker = run('i:\n  type: item\n  material: stone\n  script:\n  - define nope 1\n');
        const c = checker.generatedWorkspace.scripts.get('i')!;
        expect(Array.from(c.defNames.exactKnown)).toEqual([]);
    });
});
