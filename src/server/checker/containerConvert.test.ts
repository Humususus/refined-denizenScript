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
        const defs = checker.generatedWorkspace.scripts.get('my_task')!.defNames;
        expect(Array.from(defs.exactKnown).sort()).toEqual(['message', 'target']);
    });

    it('reads a LIST of definitions too', () => {
        // The `defs is List<object> defList` arm of the same line. Both spellings are legal
        // Denizen and a port that handled only one would silently lose the other's names --
        // which becomes a false "undefined definition" in 2C-4.
        // MUTANT CAUGHT: handling only the scalar arm.
        const checker = run('my_task:\n  type: task\n  definitions:\n  - target\n  - message\n  script:\n  - narrate hi');
        const defs = checker.generatedWorkspace.scripts.get('my_task')!.defNames;
        expect(Array.from(defs.exactKnown).sort()).toEqual(['message', 'target']);
    });

    it('lowercases, then cuts at "[", then trims -- in that order', () => {
        // ScriptChecker.cs:1722 -- `d.ToLowerFast().Before('[').Trim()`. Denizen documents
        // optional definitions as `Name[Default]`, so the bracket half must go, and the trim
        // must come AFTER the cut to clear the space that separated them.
        // MUTANT CAUGHT: trimming before cutting, which leaves 'target ' with a trailing space
        // and then never matches a real `<[target]>`.
        const checker = run('my_task:\n  type: task\n  definitions: Target [Optional]|MESSAGE\n  script:\n  - narrate hi');
        const defs = checker.generatedWorkspace.scripts.get('my_task')!.defNames;
        expect(Array.from(defs.exactKnown).sort()).toEqual(['message', 'target']);
    });

    it('leaves defNames empty when there is no definitions key', () => {
        const checker = run('my_task:\n  type: task\n  script:\n  - narrate hi');
        expect(checker.generatedWorkspace.scripts.get('my_task')!.defNames.any()).toBe(false);
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
