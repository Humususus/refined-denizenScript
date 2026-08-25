import { describe, it, expect } from 'vitest';
import { ScriptChecker } from './scriptChecker';
import { LineTrackedString } from './scriptWarnings';
import { gatherActualContainers } from './containerGather';
import type { ScriptWarning } from './scriptWarnings';

/**
 * Every expectation in this file was hand-derived by reading
 * SharpDenizenTools/ScriptAnalysis/ScriptChecker.cs:
 *   - GatherActualContainers          :1409-1638
 *   - CanWarnAboutCommandMissingDash  :1641-1673
 *   - LineTrackedString               :1363-1392
 *   - CountPreSpaces                  :1395-1406
 * Character indices and line numbers are counted by hand off the literal fixture strings,
 * never read back out of the implementation.
 *
 * The fixtures deliberately do NOT go through `run()` (except the one integration test at the
 * bottom): `gatherActualContainers` is the unit under test and the five line checks would add
 * unrelated warnings. No fixture contains a comment, so `clearCommentsFromLines` is a no-op
 * for all of them.
 */

/** Compact shape for asserting on a warning without repeating the long message strings. */
function shape(w: ScriptWarning): { line: number; key: string; start: number; end: number } {
    return { line: w.line, key: w.warningUniqueKey, start: w.startChar, end: w.endChar };
}

function shapes(list: ScriptWarning[]): { line: number; key: string; start: number; end: number }[] {
    return list.map(shape);
}

/** Builds a checker over `script` and runs only the container gather over it. */
function gather(script: string) {
    const checker = new ScriptChecker(script);
    const root = gatherActualContainers(checker);
    return { checker, root };
}

/** The `SectionEntry.value` of `key` in `section`, or `undefined` if absent. */
function valueOf(section: any, key: string): any {
    const entry = section.get(key);
    return entry === undefined ? undefined : entry.value;
}

/** The `SectionEntry.key` (the position-carrying LineTrackedString) of `key` in `section`. */
function keyOf(section: any, key: string): any {
    return section.get(key).key;
}

// ---------------------------------------------------------------------------------------------
// Structure building
// ---------------------------------------------------------------------------------------------

describe('gatherActualContainers: structure', () => {
    it('builds one root key for a well-formed task container, holding type and script', () => {
        // 0 "my_task:"            -> secwaiting = LTS(0, "my_task", 0)                     :1629
        // 1 "    type: task"      -> spaces 4 > pspaces 0, so the section is committed     :1602-1621
        //                           and "type" -> "task" is stored as a scalar             :1633
        // 2 "    script:"         -> secwaiting = LTS(2, "script", 4)                      :1629
        // 3 "    - narrate hello" -> clist created and committed under "script"            :1471-1478
        const { checker, root } = gather('my_task:\n    type: task\n    script:\n    - narrate hello');
        expect(root.size).toBe(1);
        expect(Array.from(root.keys())).toEqual(['my_task']);
        // MUTANT CAUGHT: keying the map on the LineTrackedString instance instead of on
        // `textKey` (scriptWarnings.ts's whole reason for existing) -- `root.get('my_task')`
        // would then be undefined and every lookup below would throw.
        expect(keyOf(root, 'my_task')).toEqual(new LineTrackedString(0, 'my_task', 0));
        const container = valueOf(root, 'my_task');
        expect(container instanceof Map).toBe(true);
        // Insertion order is load-bearing: :1590 reads `sec.Keys.Last()`.
        expect(Array.from(container.keys())).toEqual(['type', 'script']);
        // MUTANT CAUGHT: adding `": ".length` to `endIndex` at :1573 (which is what the value's
        // real column would be, 10). The C# adds only `startofline.Length`, so it lands on the
        // ':' at 8 -- a real off-by-two that is being ported verbatim, not corrected.
        expect(valueOf(container, 'type')).toEqual(new LineTrackedString(1, 'task', 8));
        expect(keyOf(container, 'type')).toEqual(new LineTrackedString(1, 'type', 4));
        expect(valueOf(container, 'script')).toEqual([new LineTrackedString(3, 'narrate hello', 6)]);
        expect(shapes(checker.warnings)).toEqual([]);
        expect(shapes(checker.errors)).toEqual([]);
    });

    it('stores each list entry as the RAW text after "- ", preserving case', () => {
        // :1506 reads `Lines[i]` (raw), not `CleanedLines[i]`, so case survives.
        // MUTANT CAUGHT: building textRaw from `cleaned` instead of `Lines[i].Trim()` -- the
        // entries would come back lowercased.
        const { checker, root } = gather(
            'my_task:\n    type: task\n    script:\n    - narrate "Hello World"\n    - Wait 1s'
        );
        const script = valueOf(valueOf(root, 'my_task'), 'script');
        expect(script).toEqual([
            new LineTrackedString(3, 'narrate "Hello World"', 6),
            new LineTrackedString(4, 'Wait 1s', 6)
        ]);
        expect(shapes(checker.warnings)).toEqual([]);
        expect(shapes(checker.errors)).toEqual([]);
    });

    it('builds a sub-list for a command that ends in ":" (buildingSubList)', () => {
        // 3 "    - if <player.is_op>:" -> textLow ends ':' so secwaiting is set and
        //                                buildingSubList = true                            :1550-1551
        // 4 "        - narrate op"     -> the :1480-1492 branch fires: a single-key map is
        //                                appended to the parent list and clist moves into it
        // 5 "    - narrate done"       -> shrink at :1432 restores clist from spacedlists[4]
        const { checker, root } = gather(
            'my_task:\n' +
                '    type: task\n' +
                '    script:\n' +
                '    - if <player.is_op>:\n' +
                '        - narrate op\n' +
                '    - narrate done'
        );
        const script = valueOf(valueOf(root, 'my_task'), 'script');
        // MUTANT CAUGHT: appending the `- if ...:` line to the list as a plain entry (i.e.
        // skipping the secwaiting/buildingSubList path) would give three flat entries here.
        expect(script.length).toBe(2);
        expect(script[0] instanceof Map).toBe(true);
        expect(Array.from(script[0].keys())).toEqual(['if <player.is_op>']);
        // startChar = cleanStartCut(4) + 2 = 6; the trailing ':' is stripped by :1550.
        expect(keyOf(script[0], 'if <player.is_op>')).toEqual(
            new LineTrackedString(3, 'if <player.is_op>', 6)
        );
        expect(valueOf(script[0], 'if <player.is_op>')).toEqual([
            new LineTrackedString(4, 'narrate op', 10)
        ]);
        // MUTANT CAUGHT: not restoring `clist` from `spacedlists` on dedent (:1432-1435) --
        // "narrate done" would land in the if's sub-list instead of back on the script list.
        expect(script[1]).toEqual(new LineTrackedString(5, 'narrate done', 6));
        expect(shapes(checker.warnings)).toEqual([]);
        expect(shapes(checker.errors)).toEqual([]);
    });

    it('expands tabs before counting indentation (:1422)', () => {
        // Raw line 1 is "\ttype: task": CountPreSpaces of the RAW line is 0 (a tab is not a
        // space, lineChecks.ts:38-40), so without the :1422 expansion `spaces > pspaces` is
        // false, the section is never created, and "type" is written straight onto the root.
        // MUTANT CAUGHT: dropping `.replaceAll('\t', '    ')` -- root would hold "type"
        // instead of "my_task".
        const { root } = gather('my_task:\n\ttype: task');
        expect(Array.from(root.keys())).toEqual(['my_task']);
        const container = valueOf(root, 'my_task');
        expect(container instanceof Map).toBe(true);
        // `spaces` is measured on the EXPANDED line -- that is an indent WIDTH, and 4 is what
        // makes the section open at all. `cleanStartCut` is measured on the RAW line, because it
        // is a COLUMN and LSP counts a tab as one character. Part of the :1424 deviation.
        // MUTANT CAUGHT: taking cleanStartCut from the expanded `line` would give 4 and 8, i.e.
        // a squiggle starting three characters past the end of a tab-indented key.
        expect(keyOf(container, 'type')).toEqual(new LineTrackedString(1, 'type', 1));
        expect(valueOf(container, 'type')).toEqual(new LineTrackedString(1, 'task', 5));
    });

    it('lowercases the key but keeps the value verbatim, and anchors a CAPITALISED key on its text', () => {
        // DELIBERATE DEVIATION (ScriptChecker.cs:1424). The C# computes cleanStartCut as
        // `line.IndexOf(cleaned[0])` with `cleaned` lowercased and `line` raw, so for
        // "    Type: Task" it searches for 't' in "    Type: Task" and finds none: cleanStartCut
        // is -1 and endIndex is -1 + 4 = 3. The port scans for the first non-whitespace instead.
        // MUTANT CAUGHT: reverting to the C#'s IndexOf(cleaned[0]) would give -1 and 3 -- the
        // key recorded before the start of the line, and the value's column inside the indent.
        const { root } = gather('my_task:\n    Type: Task');
        const container = valueOf(root, 'my_task');
        expect(keyOf(container, 'type')).toEqual(new LineTrackedString(1, 'type', 4));
        // endIndex is still cleanStartCut + startofline.length, NOT + ": ".length -- that is a
        // separate C# QUIRK (:1573) which this deviation deliberately leaves in place, so the
        // value's column lands on the ':' rather than on 'T'.
        expect(valueOf(container, 'type')).toEqual(new LineTrackedString(1, 'Task', 8));
    });

    it('anchors a capitalised key whose lowercase letter DOES occur later in the line', () => {
        // The nastier half of the same defect, and the reason the deviation could not be
        // narrowed to "guard against -1": for "    Test: 1" the C# searches raw "    Test: 1"
        // for 't' and FINDS one -- the final 't' of "Test", at index 7. That is a positive,
        // plausible-looking index that no clamp and no stderr note ever flags, so the squiggle
        // would start three characters into the word.
        // MUTANT CAUGHT: reverting to IndexOf(cleaned[0]) would give 7 here, not 4, and would
        // still look correct in the -1 test above if that were "fixed" with `Math.max(0, ...)`.
        const { root } = gather('my_data:\n    Test: 1');
        const container = valueOf(root, 'my_data');
        expect(keyOf(container, 'test')).toEqual(new LineTrackedString(1, 'test', 4));
    });

    it('anchors an ERROR-severity diagnostic on a capitalised duplicate key (:1629 -> warnAt)', () => {
        // The user-visible half of the deviation. :1629 is where the LineTrackedString that all
        // four Errors-severity diagnostics anchor to is built, and `warnAt` derives the range as
        // startChar .. startChar + text.length. Under the C#, "Nested" makes that -1 .. 5, which
        // DiagnosticProvider clamps to 0-5: a red squiggle over the indentation.
        // MUTANT CAUGHT: reverting cleanStartCut -- start would be -1 (published as 0), not 4.
        const { checker } = gather(
            'my_data:\n' + '    type: data\n' + '    Nested:\n' + '        a: 1\n' + '    Nested:\n' + '        b: 2'
        );
        expect(shapes(checker.errors)).toEqual([{ line: 4, key: 'duplicate_key', start: 4, end: 10 }]);
        expect(shapes(checker.warnings)).toEqual([]);
    });

    it('absorbs continuation lines after a non-":" command into that command (:1510-1528)', () => {
        // 3 "    - narrate \"hello"  cleaned does not end ':' -> the while at :1510 runs
        // 4 "      world\""          6 spaces > 4 and not "- " -> absorbed, i advanced to 4
        // 5 "    - narrate done"     4 spaces not > 4 -> the while breaks
        // MUTANT CAUGHT: dropping the `i++` at :1518. Line 4 would then be judged on its own
        // pass: it is not "- ", does not end ':' and has no ": ", so it would raise
        // `identifier_missing_line` -- and the absorbed entry's `line` would be 3, not 4.
        const { checker, root } = gather(
            'my_task:\n' +
                '    type: task\n' +
                '    script:\n' +
                '    - narrate "hello\n' +
                '      world"\n' +
                '    - narrate done'
        );
        const script = valueOf(valueOf(root, 'my_task'), 'script');
        expect(script.length).toBe(2);
        // :1516 appends the whole tab-expanded line2, indentation included; :1534/:1556 then
        // anchor the entry at the LAST consumed line (i has moved), while startChar still
        // comes from the FIRST line's cleanStartCut.
        expect(script[0]).toEqual(new LineTrackedString(4, 'narrate "hello\n      world"', 6));
        expect(script[1]).toEqual(new LineTrackedString(5, 'narrate done', 6));
        expect(shapes(checker.warnings)).toEqual([]);
        expect(shapes(checker.errors)).toEqual([]);
    });

    it('stops absorbing at the first continuation line that ends in ":" (:1519-1522)', () => {
        // 3 "    - narrate a"  -> absorbs line 4 then breaks because "sub:" ends ':'
        //   textLow = "narrate a\nsub:" ends ':' -> secwaiting = LTS(4, "narrate a\n      sub", 6)
        // 5 "      more stuff" -> reached by the OUTER loop, is not "- ", has no ':' at all
        //                        -> identifier_missing_line (:1577), 16 = "      more stuff".length
        // MUTANT CAUGHT: removing the `break` at :1521. Line 5 would then be absorbed too,
        // textLow would end in "more stuff" (not ':'), the entry would be appended as a plain
        // list entry at :1556, and no warning would be raised at all.
        const { checker, root } = gather(
            'my_task:\n' + '    type: task\n' + '    script:\n' + '    - narrate a\n' + '      sub:\n' + '      more stuff'
        );
        const script = valueOf(valueOf(root, 'my_task'), 'script');
        expect(script).toEqual([]);
        expect(shapes(checker.warnings)).toEqual([{ line: 5, key: 'identifier_missing_line', start: 0, end: 16 }]);
    });

    it('appends a definemap entry whole and skips its indented body (:1532-1546)', () => {
        // 3 "    - definemap mymap:" -> textLow starts "definemap " and ends ':' so the entry
        //                              is appended WITH its trailing ':' (:1534), then the
        //                              while at :1535 swallows lines 4 and 5.
        // MUTANT CAUGHT: dropping the skip loop -- line 4 ("        key: value", 8 spaces >
        // pspaces 4 with secwaiting null) would raise `spacing_grew_weird` (:1598).
        const { checker, root } = gather(
            'my_task:\n' +
                '    type: task\n' +
                '    script:\n' +
                '    - definemap mymap:\n' +
                '        key: value\n' +
                '        other: thing\n' +
                '    - narrate <[mymap]>'
        );
        const script = valueOf(valueOf(root, 'my_task'), 'script');
        expect(script).toEqual([
            new LineTrackedString(3, 'definemap mymap:', 6),
            new LineTrackedString(6, 'narrate <[mymap]>', 6)
        ]);
        expect(shapes(checker.warnings)).toEqual([]);
        expect(shapes(checker.errors)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------------------------
// The four ERRORS
// ---------------------------------------------------------------------------------------------

describe('gatherActualContainers: errors', () => {
    it('reports duplicate_key from the list-creating site (:1473-1476) onto errors', () => {
        // 2 "    script:"     -> secwaiting = "script"; 3 commits it as a list
        // 4 "    script:"     -> secwaiting = "script" again (clist reset to null at :1561)
        // 5 "    - narrate b" -> :1469 clist is null again, so the :1473 scan runs and hits
        // Range comes from warnAt: startChar 4, end 4 + "script".length = 10.
        const { checker, root } = gather(
            'my_task:\n' + '    type: task\n' + '    script:\n' + '    - narrate a\n' + '    script:\n' + '    - narrate b'
        );
        // MUTANT CAUGHT: routing this to `warnings` instead of `errors` (:1475 says Errors).
        expect(shapes(checker.errors)).toEqual([{ line: 4, key: 'duplicate_key', start: 4, end: 10 }]);
        expect(checker.errors[0].customMessageForm).toBe(
            'Duplicate key - a key of the same name already exists in this script section.'
        );
        expect(shapes(checker.warnings)).toEqual([]);
        const container = valueOf(root, 'my_task');
        expect(Array.from(container.keys())).toEqual(['type', 'script']);
        // MUTANT CAUGHT: `map.set(textKey, {key, value})` on an existing key. C#'s
        // `dict[key] = value` REPLACES THE VALUE AND KEEPS THE ORIGINAL KEY OBJECT, so the
        // stored key stays anchored at line 2 while the value is the line-5 list.
        expect(keyOf(container, 'script')).toEqual(new LineTrackedString(2, 'script', 4));
        expect(valueOf(container, 'script')).toEqual([new LineTrackedString(5, 'narrate b', 6)]);
    });

    it('reports duplicate_key from the sub-section site (:1607-1616) onto errors', () => {
        // 2 "    nested:"    -> secwaiting; 3 "        a: 1" commits it as a section
        // 4 "    nested:"    -> dedent restores currentSection from spacedsections[4] (:1436)
        // 5 "        b: 2"   -> spaces > pspaces, currentSection already has "nested" and is
        //                      NOT the root section -> duplicate_key, not duplicate_script.
        const { checker, root } = gather(
            'my_data:\n' + '    type: data\n' + '    nested:\n' + '        a: 1\n' + '    nested:\n' + '        b: 2'
        );
        expect(shapes(checker.errors)).toEqual([{ line: 4, key: 'duplicate_key', start: 4, end: 10 }]);
        expect(shapes(checker.warnings)).toEqual([]);
        const container = valueOf(root, 'my_data');
        // MUTANT CAUGHT: emitting `duplicate_script` here (i.e. dropping the
        // `currentSection == rootScriptSection` discriminator at :1609).
        expect(keyOf(container, 'nested')).toEqual(new LineTrackedString(2, 'nested', 4));
        const nested = valueOf(container, 'nested');
        expect(Array.from(nested.keys())).toEqual(['b']);
    });

    it('reports duplicate_script when the duplicate is at root level (:1611) onto errors', () => {
        // 2 "my_task:" dedents to 0, so currentSection is restored to rootScriptSection
        //   (:1436-1439); at 3 the `spaces > pspaces` branch sees the root section already
        //   holds "my_task".
        const { checker, root } = gather('my_task:\n' + '    type: task\n' + 'my_task:\n' + '    type: task');
        expect(shapes(checker.errors)).toEqual([{ line: 2, key: 'duplicate_script', start: 0, end: 7 }]);
        expect(checker.errors[0].customMessageForm).toBe(
            'Duplicate script - a script container of the same name already exists in this script file.'
        );
        expect(shapes(checker.warnings)).toEqual([]);
        // MUTANT CAUGHT: inserting a second entry rather than overwriting -- C#'s dictionary
        // assignment keeps ONE entry, with the line-0 key and the line-3 section as its value.
        expect(root.size).toBe(1);
        expect(keyOf(root, 'my_task')).toEqual(new LineTrackedString(0, 'my_task', 0));
        expect(valueOf(valueOf(root, 'my_task'), 'type')).toEqual(new LineTrackedString(3, 'task', 8));
    });

    it('reports empty_command_section when a "- x:" section gets no deeper line (:1484) onto errors', () => {
        // 3 "    - if x:"       -> secwaiting = LTS(3, "if x", 6), buildingSubList = true
        // 4 "    - narrate done"-> buildingSubList branch with spaces(4) <= pspaces(4)
        // Range from warnAt: 6 .. 6 + "if x".length = 10.
        const { checker, root } = gather(
            'my_task:\n' + '    type: task\n' + '    script:\n' + '    - if x:\n' + '    - narrate done'
        );
        expect(shapes(checker.errors)).toEqual([{ line: 3, key: 'empty_command_section', start: 6, end: 10 }]);
        expect(checker.errors[0].customMessageForm).toBe(
            'Script section within command is empty (add contents, or remove the section).'
        );
        expect(shapes(checker.warnings)).toEqual([]);
        // MUTANT CAUGHT: `continue`-ing after the warning. The C# does NOT bail: it still
        // builds the sub-list, so "narrate done" ends up INSIDE the empty `if`.
        const script = valueOf(valueOf(root, 'my_task'), 'script');
        expect(script.length).toBe(1);
        expect(valueOf(script[0], 'if x')).toEqual([new LineTrackedString(4, 'narrate done', 6)]);
    });

    it('reports empty_section when a key line is followed by a non-deeper key line (:1627) onto errors', () => {
        // 0 "my_task:"    -> secwaiting = LTS(0, "my_task", 0)
        // 1 "other_task:"  -> endofline empty and spaces(0) <= pspaces(0) with secwaiting set
        const { checker, root } = gather('my_task:\nother_task:');
        expect(shapes(checker.errors)).toEqual([{ line: 0, key: 'empty_section', start: 0, end: 7 }]);
        expect(checker.errors[0].customMessageForm).toBe(
            'Script section is empty (add contents, or remove the section).'
        );
        expect(shapes(checker.warnings)).toEqual([]);
        // MUTANT CAUGHT: committing secwaiting to the section on this path -- nothing is ever
        // committed here, so the root map stays empty.
        expect(root.size).toBe(0);
    });
});

// ---------------------------------------------------------------------------------------------
// The nine WARNINGS
// ---------------------------------------------------------------------------------------------

describe('gatherActualContainers: warnings', () => {
    it('reports shrunk_spacing for a dedent to a level that was never opened, without throwing', () => {
        // 4 "  - narrate b": spaces 2 < pspaces 4, and 2 is in neither spacedlists {4} nor
        // spacedsections {0, 4}. The message enumerates spacedsections.Keys in insertion order.
        const run = () =>
            gather('my_task:\n' + '    type: task\n' + '    script:\n' + '    - narrate a\n' + '  - narrate b');
        // MUTANT CAUGHT: indexing the maps without the TryGetValue guard (:1432/:1436) and
        // dereferencing the undefined result -- this branch exists precisely so a dedent to an
        // unopened level is a warning rather than a crash.
        expect(run).not.toThrow();
        const { checker } = run();
        expect(shapes(checker.warnings)).toEqual([{ line: 4, key: 'shrunk_spacing', start: 0, end: 2 }]);
        expect(checker.warnings[0].customMessageForm).toBe(
            'Simple spacing error - shrunk unexpectedly to new space count, from 4 down to 2, while expecting any of: 0, 4.'
        );
        expect(shapes(checker.errors)).toEqual([]);
    });

    it('reports growing_spaces_in_script when a list entry indents for no reason (:1465)', () => {
        // 4 "        - narrate b": spaces 8 > pspaces 4, clist is live, buildingSubList false.
        // Range is (0, spaces) = (0, 8).
        const { checker, root } = gather(
            'my_task:\n' + '    type: task\n' + '    script:\n' + '    - narrate a\n' + '        - narrate b'
        );
        expect(shapes(checker.warnings)).toEqual([{ line: 4, key: 'growing_spaces_in_script', start: 0, end: 8 }]);
        expect(checker.warnings[0].customMessageForm).toBe(
            "Spacing grew for no reason (missing a ':' on a command, or accidental over-spacing?)."
        );
        expect(shapes(checker.errors)).toEqual([]);
        // MUTANT CAUGHT: `continue`-ing after this warning. The C# warns and carries on, so the
        // over-indented entry still joins the SAME list.
        expect(valueOf(valueOf(root, 'my_task'), 'script')).toEqual([
            new LineTrackedString(3, 'narrate a', 6),
            new LineTrackedString(4, 'narrate b', 10)
        ]);
    });

    it('reports growing_spacing_impossible when a pending key meets a restored list (:1495)', () => {
        // The only reachable shape for this branch (secwaiting set, clist live,
        // buildingSubList false):
        //   3 "    - if x:"           list at spaces 4; secwaiting; buildingSubList = true
        //   4 "        - narrate a"   :1486 branch -> spacedlists[8], buildingSubList = false
        //   5 "        key:"          key line at spaces 8 == pspaces 8: clist = null (:1561),
        //                             spacedlists.Remove(8) (:1562) leaves spacedlists {4},
        //                             secwaiting = LTS(5, "key", 8)
        //   6 "    - narrate b"       dedent to 4 restores clist from spacedlists[4] (:1434)
        const { checker } = gather(
            'my_task:\n' +
                '    type: task\n' +
                '    script:\n' +
                '    - if x:\n' +
                '        - narrate a\n' +
                '        key:\n' +
                '    - narrate b'
        );
        expect(shapes(checker.warnings)).toEqual([{ line: 6, key: 'growing_spacing_impossible', start: 0, end: 4 }]);
        expect(checker.warnings[0].customMessageForm).toBe("Line grew when that isn't possible (spacing error?).");
        // MUTANT CAUGHT: pruning `spacedlists` on the key line at :1562 with `clear()` instead
        // of removing only the current `spaces` -- spacedlists[4] would be gone, the dedent
        // would fall through to spacedsections, and this branch would never be reached.
        expect(shapes(checker.errors)).toEqual([]);
    });

    it('reports weird_line_growth for a list entry with no list to join (:1502)', () => {
        // 2 "    - narrate a": secwaiting was consumed at line 1 and clist is still null.
        // Range is (0, line.IndexOf('-')) = (0, 4) -- the END is the dash's column, not `spaces`
        // (identical here, but the C# genuinely uses a different expression than :1465 does).
        const { checker } = gather('my_task:\n    type: task\n    - narrate a');
        expect(shapes(checker.warnings)).toEqual([{ line: 2, key: 'weird_line_growth', start: 0, end: 4 }]);
        expect(checker.warnings[0].customMessageForm).toBe(
            'Line purpose unknown, attempted list entry when not building a list (likely line format error, perhaps missing or misplaced a `:` on lines above, or incorrect tabulation?).'
        );
        expect(shapes(checker.errors)).toEqual([]);
    });

    it('reports identifier_missing_line for a line with neither "-" nor ":" (:1577)', () => {
        // Range is (0, line.Length) on the TAB-EXPANDED line: "    hello world" is 15 chars.
        const { checker, root } = gather('my_task:\n    hello world');
        expect(shapes(checker.warnings)).toEqual([{ line: 1, key: 'identifier_missing_line', start: 0, end: 15 }]);
        expect(checker.warnings[0].customMessageForm).toBe(
            'Line purpose unknown, no identifier (missing a `:` or a `-`?).'
        );
        // MUTANT CAUGHT: not `continue`-ing -- the line would fall through to :1629 and replace
        // the pending "my_task", so nothing at all would ever be committed to the root.
        expect(root.size).toBe(0);
        expect(shapes(checker.errors)).toEqual([]);
    });

    it('reports key_line_no_content for a bare ":" line (:1582)', () => {
        // cleaned is ":", so `startofline = cleaned[0..^1]` is empty. Range (0, 5).
        const { checker } = gather('my_task:\n    :');
        expect(shapes(checker.warnings)).toEqual([{ line: 1, key: 'key_line_no_content', start: 0, end: 5 }]);
        expect(checker.warnings[0].customMessageForm).toBe('key line missing contents (misplaced a `:`)?');
        expect(shapes(checker.errors)).toEqual([]);
    });

    it('reports tag_in_key for a key containing "<" and keeps going (:1585-1588)', () => {
        // "    <player.name>:" is 18 chars; the range is (0, line.Length).
        const { checker, root } = gather(
            'my_task:\n' + '    type: task\n' + '    <player.name>:\n' + '    - narrate a'
        );
        expect(shapes(checker.warnings)).toEqual([{ line: 2, key: 'tag_in_key', start: 0, end: 18 }]);
        expect(checker.warnings[0].customMessageForm).toBe('Keys cannot contain tags.');
        expect(shapes(checker.errors)).toEqual([]);
        // MUTANT CAUGHT: `continue`-ing after this warning. Unlike the other eight, :1587 does
        // NOT bail, so the tag-bearing key is still committed.
        const container = valueOf(root, 'my_task');
        expect(Array.from(container.keys())).toEqual(['type', '<player.name>']);
    });

    it('reports key_line_looks_like_command for a colon-command key line (:1590-1593)', () => {
        // 4 "    if x:": inputArgs = ["if", "x"], length > 1, so the AND-ARGUMENTS set applies
        // and contains "if". currentRootSection's "type" is "task", so :1660-1671 all miss and
        // CanWarnAboutCommandMissingDash returns true. Range (0, line.Length) = (0, 9).
        const { checker } = gather(
            'my_task:\n' + '    type: task\n' + '    script:\n' + '    - narrate a\n' + '    if x:'
        );
        expect(shapes(checker.warnings)).toEqual([{ line: 4, key: 'key_line_looks_like_command', start: 0, end: 9 }]);
        expect(checker.warnings[0].customMessageForm).toBe(
            "Line appears to be intended as command, but forgot a '-'?"
        );
        expect(shapes(checker.errors)).toEqual([]);
    });

    it('suppresses key_line_looks_like_command inside a data container (:1660-1663)', () => {
        // Same fixture, `type: data`. MUTANT CAUGHT: ignoring `currentRootSection`'s "type"
        // (i.e. returning true as soon as the command-name set matches).
        const { checker } = gather(
            'my_data:\n' + '    type: data\n' + '    script:\n' + '    - narrate a\n' + '    if x:'
        );
        expect(shapes(checker.warnings)).toEqual([]);
        expect(shapes(checker.errors)).toEqual([]);
    });

    it('suppresses key_line_looks_like_command for a one-word key not in the no-args set', () => {
        // "    else x:" has two args, so the AND-ARGUMENTS set applies -> "else" is in it.
        // "    default:" has one arg, so the NO-ARGUMENTS set applies -> "default" is in it.
        // "    while:" has one arg, and "while" is NOT in the NO-ARGUMENTS set -> no warning.
        // MUTANT CAUGHT: swapping the two sets at :1644.
        const { checker } = gather('my_task:\n' + '    type: task\n' + '    while:\n' + '    - narrate a');
        expect(shapes(checker.warnings)).toEqual([]);
        const armed = gather('my_task:\n' + '    type: task\n' + '    default:\n' + '    - narrate a');
        expect(shapes(armed.checker.warnings)).toEqual([
            { line: 2, key: 'key_line_looks_like_command', start: 0, end: 12 }
        ]);
    });

    it('reports spacing_grew_weird for a key line that indents with nothing pending (:1598)', () => {
        // 2 "        extra: 1": spaces 8 > pspaces 4 and secwaiting is null. Range (0, spaces).
        const { checker, root } = gather('my_task:\n' + '    type: task\n' + '        extra: 1');
        expect(shapes(checker.warnings)).toEqual([{ line: 2, key: 'spacing_grew_weird', start: 0, end: 8 }]);
        expect(checker.warnings[0].customMessageForm).toBe(
            "Spacing grew for no reason (missing a ':', or accidental over-spacing?)."
        );
        expect(shapes(checker.errors)).toEqual([]);
        // MUTANT CAUGHT: not `continue`-ing -- "extra" would be written onto the my_task section.
        expect(Array.from(valueOf(root, 'my_task').keys())).toEqual(['type']);
    });
});

// ---------------------------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------------------------

describe('ScriptChecker.run wiring', () => {
    it('stores the gathered root section on the checker (ScriptChecker.cs:2031)', () => {
        const checker = new ScriptChecker('my_task:\n    type: task\n    script:\n    - narrate hello\n');
        // MUTANT CAUGHT: leaving `gatherActualContainers` uncalled from `run()`. Phase 2C-3
        // consumes this field, so an unwired parser would be silently inert.
        expect(checker.containers).toBe(null);
        checker.run();
        expect(checker.containers).not.toBe(null);
        expect(Array.from(checker.containers.keys())).toEqual(['my_task']);
    });

    it('runs the gather AFTER clearCommentsFromLines, so comments are not parsed', () => {
        // MUTANT CAUGHT: calling the gather before `clearCommentsFromLines`. The comment line
        // would then still be live: it is not "- ", does not end ':' and has no ": ", so it
        // would raise `identifier_missing_line`.
        const checker = new ScriptChecker('my_task:\n    # a note\n    type: task\n');
        checker.run();
        expect(checker.warnings.filter((w) => w.warningUniqueKey === 'identifier_missing_line')).toEqual([]);
        expect(Array.from(checker.containers.keys())).toEqual(['my_task']);
    });
});
