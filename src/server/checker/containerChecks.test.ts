// Tests for containerChecks.ts (ScriptChecker.cs:919-1145, `CheckAllContainers` Part A).
//
// Every test names the mutant it is there to kill. A test that would still pass with its named
// mutant applied is not a test, and the audit at the bottom of this phase proves each one.
//
// These run WITHOUT meta (checker.meta stays null), so the tag and command layers below skip
// themselves and what is measured here is purely Part A's own dispatch. The meta-dependent
// behaviour is covered by scripts/verify-phase2c6.js against live docs.

import { describe, expect, it } from 'vitest';
import { ScriptChecker } from './scriptChecker';
import type { ScriptWarning } from './scriptWarnings';

/** Runs the checker over a script and returns it. */
function run(script: string): ScriptChecker {
    const checker = new ScriptChecker(script);
    checker.run();
    return checker;
}

/**
 * Every DIAGNOSTIC key produced.
 *
 * `infos` excluded since Phase 2D: `collectStatisticInfos` puts four or five `stat_*` entries on
 * every file, and `server.ts` never publishes infos as diagnostics -- per-file line counts in the
 * Problems panel would be noise. The "produces nothing at all" assertions below mean nothing the
 * user would see, so counting statistics as findings would make them permanently red.
 */
function keys(checker: ScriptChecker): string[] {
    return [...checker.errors, ...checker.warnings, ...checker.minorWarnings]
        .map((w) => w.warningUniqueKey);
}

/** The one warning with the given key, or undefined. */
function find(checker: ScriptChecker, key: string): ScriptWarning | undefined {
    return [...checker.errors, ...checker.warnings, ...checker.minorWarnings, ...checker.infos]
        .find((w) => w.warningUniqueKey === key);
}

/** A `task` container with the given script body lines (already dash-prefixed). */
function task(...lines: string[]): string {
    return ['my_long_task_name:', '    type: task', '    script:', ...lines.map((l) => '    ' + l)].join('\n');
}

describe('script title checks (ScriptChecker.cs:930-949)', () => {
    it('reports spaced_script_name for a title containing a space', () => {
        // MUTANT: delete the `script.name.includes(' ')` branch.
        const checker = run('my task name:\n    type: task\n    script:\n    - narrate hi');
        expect(keys(checker)).toContain('spaced_script_name');
    });

    it('reports non_alphanumeric_script_name for a title with symbols but no space', () => {
        // MUTANT: delete the `isOnlyTitleCharacters` branch.
        const checker = run('my-task-name:\n    type: task\n    script:\n    - narrate hi');
        expect(keys(checker)).toContain('non_alphanumeric_script_name');
    });

    it('reports ONLY spaced_script_name for a title that is both spaced and symbolic', () => {
        // MUTANT: `else if` -> `if` at :934. A space is itself not an allowed title character, so
        // every spaced title is also non-alphanumeric; splitting the chain makes BOTH fire. This
        // is the test that distinguishes the two forms -- the two above pass either way.
        const checker = run('my task name:\n    type: task\n    script:\n    - narrate hi');
        expect(keys(checker)).toContain('spaced_script_name');
        expect(keys(checker)).not.toContain('non_alphanumeric_script_name');
    });

    it('accepts digits and underscores in a title without warning', () => {
        // MUTANT: drop '0123456789' or '_' from SCRIPT_TITLE_CHARACTERS_ALLOWED.
        const checker = run('my_task_9:\n    type: task\n    script:\n    - narrate hi');
        expect(keys(checker)).not.toContain('non_alphanumeric_script_name');
    });

    it('accepts an ASCII-uppercase title silently, because the title was already folded', () => {
        // NOT a defect, and the A-Z half of SCRIPT_TITLE_CHARACTERS_ALLOWED's absence is
        // UNREACHABLE. Container titles come from CleanedLines, which ScriptChecker.cs:145
        // builds as `Lines.Select(s => s.Trim().ToLowerFast())` -- so `script.name` is ASCII-
        // lowercase before this check ever sees it, in the C# as much as here. Measured: the
        // title below is stored as `mytaskname`. Any mutant that adds A-Z to the allowed set is
        // therefore EQUIVALENT and its survival is expected.
        const checker = run('MyTaskName:\n    type: task\n    script:\n    - narrate hi');
        expect(keys(checker)).toEqual([]);
    });

    it('flags a non-ASCII title, because ToLowerFast cannot fold it', () => {
        // MUTANT: use Unicode `toLowerCase()` upstream instead of `ToLowerFast()`. The same
        // ASCII-only folding that makes the test above vacuous makes this one bite: a Cyrillic
        // title keeps its case and is not in the allowed set either way, so it is flagged. This
        // pins the observable difference between the two folding rules.
        const checker = run('мойтаск:\n    type: task\n    script:\n    - narrate hi');
        expect(keys(checker)).toContain('non_alphanumeric_script_name');
    });

    it('reports short_script_name at length 3 but not at length 4', () => {
        // MUTANT: `< 4` -> `< 3` (kills the first half) or `<= 4` (kills the second).
        expect(keys(run('abc:\n    type: task\n    script:\n    - narrate hi'))).toContain('short_script_name');
        expect(keys(run('abcd:\n    type: task\n    script:\n    - narrate hi'))).not.toContain('short_script_name');
    });

    it('files the title-style checks as minor but the short-title check as a full warning', () => {
        // MUTANT: swap `checker.minorWarnings` and `checker.warnings` at :931/:936/:940. Severity
        // is what decides whether the user sees blue or yellow, and no key-only test catches it.
        const spaced = run('a b:\n    type: task\n    script:\n    - narrate hi');
        expect(spaced.minorWarnings.map((w) => w.warningUniqueKey)).toContain('spaced_script_name');
        expect(spaced.warnings.map((w) => w.warningUniqueKey)).toContain('short_script_name');
    });

    it('flags a title that collides with a known script type name', () => {
        // MUTANT: drop the `KNOWN_SCRIPT_TYPES.has(script.name)` disjunct at :946. Runs without
        // meta, so the `meta.commands` disjunct cannot be what makes this pass.
        const checker = run('inventory:\n    type: task\n    script:\n    - narrate hi');
        expect(keys(checker)).toContain('enumerated_script_name');
    });

    it('does not flag an ordinary title as enumerated when no meta or extra data is loaded', () => {
        // MUTANT: make the meta/extraData guards unconditional (e.g. `?.` chains that treat null
        // as "matched"). A null meta must mean "cannot know", not "everything collides".
        const checker = run(task('- narrate hi'));
        expect(keys(checker)).not.toContain('enumerated_script_name');
    });

    it('flags a title present in extraData when extraData is loaded', () => {
        // MUTANT: delete the extraData branch at :942, or read the wrong set off it.
        const checker = new ScriptChecker('my_long_task_name:\n    type: task\n    script:\n    - narrate hi');
        checker.extraData = { all: new Set(['my_long_task_name']) } as never;
        checker.run();
        expect(keys(checker)).toContain('enumerated_script_name');
    });

    it('prefixes every container warning with the script name and spans the whole line', () => {
        // MUTANT: drop the `In script \`name\`:` prefix, or narrow the range from
        // `0 .. line.length` to the key's own extent. Both are invisible to key-only assertions.
        const checker = run('abc:\n    type: task\n    script:\n    - narrate hi');
        const warning = find(checker, 'short_script_name')!;
        expect(warning.customMessageForm).toMatch(/^In script `abc`: /);
        expect(warning.startChar).toBe(0);
        expect(warning.endChar).toBe('abc:'.length);
    });
});

describe('required and likely-bad keys (ScriptChecker.cs:957-970)', () => {
    it('reports each missing required key under a type-suffixed code', () => {
        // MUTANT: use a constant code instead of `'missing_key_' + typeString.text`, or report
        // only the first missing key instead of looping.
        const checker = run('my_long_command:\n    type: command\n    name: foo');
        const missing = [...checker.warnings].filter((w) => w.warningUniqueKey === 'missing_key_command');
        expect(missing.length).toBeGreaterThan(0);
        expect(missing.map((w) => w.customMessageForm).join(' ')).toContain('description');
    });

    it('does not report a required key that is present', () => {
        // MUTANT: invert the `!scriptSection.has(...)` test at :959.
        const checker = run('my_long_task_name:\n    type: task\n    script:\n    - narrate hi');
        expect(keys(checker).filter((k) => k.startsWith('missing_key_'))).toEqual([]);
    });

    it('anchors missing-key warnings to the type line, not the title line', () => {
        // MUTANT: `typeString.line` -> `script.lineNumber` at :960. Both are plausible; only a
        // positional assertion tells them apart.
        const checker = run('my_long_command:\n    type: command\n    name: foo');
        expect(find(checker, 'missing_key_command')!.line).toBe(1);
    });
});

describe('the per-key dispatch (ScriptChecker.cs:971-1064)', () => {
    it('skips the debug, speed and type keys entirely', () => {
        // MUTANT: delete the `continue` at :975. `type` is a value key on no script type, so
        // without the skip a strict type would report `unknown_key_` on its own `type:` line.
        const checker = run('my_long_item:\n    type: item\n    material: stone\n    debug: false\n    speed: 0');
        expect(keys(checker).filter((k) => k.startsWith('unknown_key_'))).toEqual([]);
    });

    it('reports list_should_be_value when a value key holds a list', () => {
        // MUTANT: delete the valueKeys arm at :1050, letting it fall through to `unknown_key_`.
        const checker = run([
            'my_long_command:', '    type: command', '    name:', '    - a', '    - b',
            '    description: d', '    usage: u', '    script:', '    - narrate hi'
        ].join('\n'));
        expect(keys(checker)).toContain('list_should_be_value');
    });

    it('reports script_should_be_list when a list key holds a script', () => {
        // MUTANT: pass `false` for canBeScript in the listKeys arm at :1047.
        const checker = run([
            'my_long_item:', '    type: item', '    material: stone',
            '    lore:', '    - if <player.name> == bob:', '      - narrate hi'
        ].join('\n'));
        expect(keys(checker)).toContain('script_should_be_list');
    });

    it('does NOT report script_should_be_list for an always-data key holding a script shape', () => {
        // MUTANT: pass `true` for canBeScript in the ALWAYS_DATA_KEYS arm at :1039. This is the
        // arm that keeps `data:` blocks quiet, and inverting it is a false-positive generator.
        const checker = run([
            'my_long_task_name:', '    type: task',
            '    data:', '    - some_key:', '      - nested value',
            '    script:', '    - narrate hi'
        ].join('\n'));
        expect(keys(checker)).not.toContain('script_should_be_list');
    });

    it('treats every list under a data-type container as plain data', () => {
        // MUTANT: drop the `|| typeString.text === 'data'` disjunct at :1038.
        const checker = run([
            'my_long_data:', '    type: data',
            '    anything:', '    - if <player.name> == bob:', '      - narrate hi'
        ].join('\n'));
        expect(keys(checker)).not.toContain('script_should_be_list');
    });

    it('reports unknown_key_ for an unrecognized list key on a strict type', () => {
        // MUTANT: drop the `knownType.strict` arm at :1055, or invert the flag.
        const checker = run([
            'my_long_item:', '    type: item', '    material: stone',
            '    bogus_list:', '    - a', '    - b'
        ].join('\n'));
        expect(keys(checker)).toContain('unknown_key_item');
    });

    it('does not report unknown_key_ for an unrecognized key on a non-strict type', () => {
        // MUTANT: make the strict arm unconditional. `task` is non-strict, so this would turn
        // every custom key on the user's tasks into a warning -- the loudest possible regression.
        const checker = run([
            'my_long_task_name:', '    type: task',
            '    bogus_list:', '    - a', '    - b',
            '    script:', '    - narrate hi'
        ].join('\n'));
        expect(keys(checker).filter((k) => k.startsWith('unknown_key_'))).toEqual([]);
    });
});

describe('checkAsScript (ScriptChecker.cs:976-1018)', () => {
    // Two behaviours here are deliberately NOT unit-tested, each for its own proven reason:
    //
    // 1. The seeding of `context.definitions` (:982-995) is only observable through
    //    `def_of_nothing`, which needs loaded meta -- `checkSingleCommand` returns early without
    //    it. Covered by check 4 of scripts/verify-phase2c6.js, which was confirmed to kill the
    //    "definitions not cut at bracket" mutant.
    // 2. The definemap guard at :1013 is UNREACHABLE in both languages; see the equivalent-mutant
    //    note at that line in containerChecks.ts. No test anywhere can kill that mutant.

    it('leaves an empty sub-map list entry alone', () => {
        // EQUIVALENT MUTANT, deliberately kept: dropping the `onlyEntry === undefined` guard
        // changes nothing, because an empty Map can never occupy a list position. The only site
        // that pushes a Map into a list is containerGather.ts:380-382, which inserts the key
        // BEFORE pushing (`setEntry(subSection, ...)` then `clist.push(subSection)`). Measured:
        // zero empty list-entry maps across six hand-built dangling-key probes and all 24 files
        // of the real corpus. The guard stays because the C#'s `.First()` would throw, and this
        // test stays as the reachability regression -- not as a mutation test.
        const checker = run(task('- if <player.name> == bob:'));
        expect(keys(checker)).not.toContain('exception_internal');
    });
});

describe('the value-key branch (ScriptChecker.cs:1065-1102)', () => {
    it('reports bad_key_ when a list-or-script key holds a direct value', () => {
        // MUTANT: delete the arm at :1091, letting it fall through to checkSingleDataLine.
        const checker = run('my_long_task_name:\n    type: task\n    script: not a list');
        expect(keys(checker)).toContain('bad_key_task');
    });

    it('reports unknown_key_ for an unrecognized value key on a strict type', () => {
        // MUTANT: drop the strict arm at :1095.
        const checker = run('my_long_item:\n    type: item\n    material: stone\n    bogus_value: x');
        expect(keys(checker)).toContain('unknown_key_item');
    });

    it('exempts the literal key `data` from the strict value-key check', () => {
        // MUTANT: drop the `&& keyName !== 'data'` conjunct at :1095. `data:` is how users hang
        // arbitrary payloads off a strict container, and flagging it is a false positive.
        const checker = run('my_long_item:\n    type: item\n    material: stone\n    data: anything');
        expect(keys(checker)).not.toContain('unknown_key_item');
    });

    it('does not report a recognized value key', () => {
        // MUTANT: invert the `matchesSet(keyName, knownType.valueKeys)` test at :1086.
        const checker = run('my_long_item:\n    type: item\n    material: stone\n    display name: Sword');
        expect(keys(checker).filter((k) => k.startsWith('unknown_key_'))).toEqual([]);
    });

    it('treats `description` as a value key on every type', () => {
        // MUTANT: drop the `|| keyName === 'description'` disjunct at :1086. On a strict type
        // whose valueKeys lack `description`, dropping it produces `unknown_key_`.
        const checker = run('my_long_item:\n    type: item\n    material: stone\n    description: some text');
        expect(keys(checker).filter((k) => k.startsWith('unknown_key_'))).toEqual([]);
    });
});

describe('the sub-map branch (ScriptChecker.cs:1103-1144)', () => {
    it('reports unknown_key_ for an unrecognized sub-map key on a strict type', () => {
        // MUTANT: give this gate preprocContainer's extra `(!strict && !definemap)` disjunct
        // (:1948-1949). The two gates DIFFER, and copying one onto the other silences this.
        const checker = run([
            'my_long_item:', '    type: item', '    material: stone',
            '    bogus_map:', '      inner: value'
        ].join('\n'));
        expect(keys(checker)).toContain('unknown_key_item');
    });

    it('walks a sub-map whose key is a recognized wildcard key', () => {
        // MUTANT: drop the `knownType.*Keys.includes(keyText)` disjuncts at :1131. `mechanisms.*`
        // is a real item key, and failing to recognize it produces a false `unknown_key_item`.
        const checker = run([
            'my_long_item:', '    type: item', '    material: stone',
            '    mechanisms:', '      color: red'
        ].join('\n'));
        expect(keys(checker)).not.toContain('unknown_key_item');
    });

    it('recurses through nested sub-maps rather than stopping at the first level', () => {
        // MUTANT: delete the `subValue instanceof Map` recursion at :1125. Without it, deeply
        // nested data is silently unchecked. The malformed tag three levels down is the probe:
        // `uneven_tags` is raised by checkSingleDataLine and needs NO meta, so it reaches this
        // test only if the recursion actually walks down to it.
        const checker = run([
            'my_long_task_name:', '    type: task',
            '    custom:', '      a:', '        b:', '          c: <broken',
            '    script:', '    - narrate hi'
        ].join('\n'));
        expect(keys(checker)).toContain('uneven_tags');
    });

    it('treats a definemap sub-map as DATA in the fallback arm, not as a script', () => {
        // MUTANT: drop the `!keyName.startsWith('definemap')` conjunct at :1142 -- note the
        // FALLBACK arm has it and the recognized arm at :1134 does not.
        //
        // The discriminator is again `uneven_tags`, which only the DATA path raises without
        // meta: canBeScript=false sends the inner list to checkBasicList -> checkSingleDataLine
        // and the malformed tag is reported, while canBeScript=true sends it to checkAsScript ->
        // checkSingleCommand, which returns early with no meta and reports nothing. Measured
        // both ways: `definemap_thing` yields uneven_tags, an identical `ordinary_thing` yields
        // nothing.
        const checker = run([
            'my_long_task_name:', '    type: task',
            '    definemap_thing:', '      a:', '      - <broken',
            '    script:', '    - narrate hi'
        ].join('\n'));
        expect(keys(checker)).toContain('uneven_tags');
    });
});

describe('robustness (ScriptChecker.cs:928, :1321-1325)', () => {
    it('keeps checking later containers after an earlier one is fully checked', () => {
        // MUTANT: `return` instead of `continue`-equivalent inside the per-script loop, or hoist
        // the try/catch outside it. Two bad containers must both be reported.
        const checker = run([
            'abc:', '    type: task', '    script:', '    - narrate hi',
            'xyz:', '    type: task', '    script:', '    - narrate hi'
        ].join('\n'));
        const short = [...checker.warnings].filter((w) => w.warningUniqueKey === 'short_script_name');
        expect(short.length).toBe(2);
        expect(short.map((w) => w.line)).toEqual([0, 4]);
    });

    it('produces no diagnostics at all for a clean, ordinary container', () => {
        // MUTANT: any check that fires unconditionally. This is the false-positive canary: the
        // whole phase is worthless if an ordinary script lights up.
        const checker = run([
            'my_greeting_task:', '    type: task', '    definitions: greeting',
            '    script:', '    - narrate <[greeting]>'
        ].join('\n'));
        expect(keys(checker)).toEqual([]);
    });
});
