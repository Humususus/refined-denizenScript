"use strict";
// The container structure parser, ported from SharpDenizenTools' ScriptChecker.cs:1409-1673
// (`GatherActualContainers` and its helper `CanWarnAboutCommandMissingDash`).
// This module must stay dependency-free: no `vscode-languageserver` import, no I/O.
//
// This is NOT a YAML parser. It is a stateful indentation machine that walks the lines once,
// tracking how deep it is and what it is currently building, and it reports thirteen distinct
// structural problems as it goes. Porting rule, as everywhere else in this directory: the C# is
// the specification, warts included. Several behaviours below look like bugs; each is marked
// with a `C# QUIRK` note and ported verbatim so the two checkers stay diffable.
//
// There is exactly ONE intentional exception to that rule, labelled DELIBERATE DEVIATION at its
// site and taken as a USER RULING on a user-visible defect: `cleanStartCut` (:1424), whose
// character search returned -1 -- or, worse, a silently wrong index -- on any key that starts
// with a capital letter, putting the squiggle on the indentation and the stored structure's
// columns out by an arbitrary amount. That is the only place this port knowingly disagrees with
// the C#; anything else that differs is a bug in this file.
//
// The C#'s local variable names are preserved exactly (`spacedsections`, `spacedlists`,
// `currentSection`, `currentRootSection`, `pspaces`, `secwaiting`, `clist`, `buildingSubList`)
// so the correspondence can be checked line by line against the cited C# line numbers.
Object.defineProperty(exports, "__esModule", { value: true });
exports.gatherActualContainers = exports.canWarnAboutCommandMissingDash = void 0;
const scriptWarnings_1 = require("./scriptWarnings");
const lineChecks_1 = require("./lineChecks");
const frenetic_1 = require("./frenetic");
/** ScriptChecker.cs:51-54 (`CommandsWithColonsAndArguments`). */
const COMMANDS_WITH_COLONS_AND_ARGUMENTS = new Set(['if', 'else', 'foreach', 'while', 'repeat', 'choose', 'case']);
/** ScriptChecker.cs:57-60 (`CommandsWithColonsButNoArguments`). */
const COMMANDS_WITH_COLONS_BUT_NO_ARGUMENTS = new Set(['else', 'default', 'random']);
/**
 * FreneticUtilities' `string.BeforeAndAfter(match, out after)`: everything before the first
 * occurrence of `match`, and everything after it. If `match` is absent the whole input is
 * returned as the "before" half and the "after" half is empty. Used at ScriptChecker.cs:1572,
 * where the `cleaned.Contains(": ")` guard at :1570 makes the absent case unreachable.
 */
function beforeAndAfter(input, match) {
    const index = input.indexOf(match);
    if (index < 0) {
        return [input, ''];
    }
    return [input.slice(0, index), input.slice(index + match.length)];
}
/** C#'s `string.IsNullOrWhiteSpace`. Used at ScriptChecker.cs:1538. */
function isNullOrWhiteSpace(text) {
    return text.trim().length === 0;
}
/**
 * C#'s `dict[key] = value` on a `Dictionary<LineTrackedString, object>`.
 *
 * This is NOT the same as `map.set(textKey(key), { key, value })`. When a key of equal text is
 * already present, .NET replaces the VALUE and KEEPS THE ORIGINAL KEY OBJECT (and its slot, so
 * enumeration order is unchanged too). That is directly observable: after a `duplicate_script`
 * the stored key still points at the FIRST container's line, and Phase 2C-3 reports against it.
 */
function setEntry(section, key, value) {
    const mapKey = scriptWarnings_1.LineTrackedString.textKey(key);
    const existing = section.get(mapKey);
    if (existing !== undefined) {
        existing.value = value;
        return;
    }
    section.set(mapKey, { key, value });
}
/**
 * C#'s `section.Keys.Last()` (ScriptChecker.cs:1590), or `null` for an empty section --
 * the C# guards that case with `sec.Any() &&` before calling `.Last()`.
 */
function lastKey(section) {
    let last = null;
    for (const entry of section.values()) {
        last = entry.key;
    }
    return last;
}
/**
 * Determines whether a section key that looks like it might have been meant as a command should
 * actually show a warning. Ported from ScriptChecker.cs:1641-1673.
 *
 * Exported for its own unit coverage; `gatherActualContainers` is its only in-tree caller.
 */
function canWarnAboutCommandMissingDash(args, currentRootSection) {
    // ScriptChecker.cs:1643
    const cmdName = (0, frenetic_1.toLowerFast)(args[0]);
    // ScriptChecker.cs:1644-1647: NOTE which set goes with which arity. A key with exactly one
    // word is checked against the NO-ARGUMENTS set; anything longer against the WITH-ARGUMENTS
    // set. So `while:` is not flagged (one word, and "while" is not in the no-args set) but
    // `while x:` is.
    const set = args.length === 1 ? COMMANDS_WITH_COLONS_BUT_NO_ARGUMENTS : COMMANDS_WITH_COLONS_AND_ARGUMENTS;
    if (!set.has(cmdName)) {
        return false;
    }
    // ScriptChecker.cs:1648-1651
    if (currentRootSection === null) {
        return true;
    }
    // ScriptChecker.cs:1652-1655: the C# probes with a throwaway `new LineTrackedString(0,
    // "type", 0)`, which only matches because of the text-only equality override. `textKey`
    // accepts the bare string for exactly this shape.
    const typeEntry = currentRootSection.get(scriptWarnings_1.LineTrackedString.textKey('type'));
    if (typeEntry === undefined) {
        return true;
    }
    // ScriptChecker.cs:1656-1659: a `type` key holding a section or a list (rather than a
    // scalar) falls through to `true`.
    const typeValue = typeEntry.value;
    if (!(typeValue instanceof scriptWarnings_1.LineTrackedString)) {
        return true;
    }
    const typeText = (0, frenetic_1.toLowerFast)(typeValue.text);
    // ScriptChecker.cs:1660-1663
    if (typeText === 'data') {
        return false;
    }
    // ScriptChecker.cs:1664-1671
    if (typeText === 'command' && cmdName === 'default') {
        return false;
    }
    if (typeText === 'interact' && cmdName === 'default') {
        return false;
    }
    // ScriptChecker.cs:1672
    return true;
}
exports.canWarnAboutCommandMissingDash = canWarnAboutCommandMissingDash;
/**
 * Gathers a map of all actual containers, checking for errors as it goes, and returning the map.
 * Ported from ScriptChecker.cs:1409-1638.
 *
 * Thirteen warning keys come out of fourteen call sites (`duplicate_key` fires from two).
 * Four of them are ERRORS -- `duplicate_key` (:1475, :1615), `empty_command_section` (:1484),
 * `duplicate_script` (:1611) and `empty_section` (:1627); the other nine are WARNINGS.
 *
 * The loop mutates its own index in three places (:1518, :1540, and the outer `for`), so it is a
 * classic `for` and not a `for...of` -- the same shape as `basicLineFormatCheck`. A `for...of`
 * port would re-judge every continuation line as a line of its own.
 */
function gatherActualContainers(checker) {
    const lines = checker.lines;
    const cleanedLines = checker.cleanedLines;
    // ScriptChecker.cs:1411-1419: eight pieces of state that all carry meaning across iterations.
    //   rootScriptSection -- the file's top level, and the identity compared against at :1603.
    //   spacedsections    -- indent width -> the section open at that width.
    //   spacedlists       -- indent width -> the list open at that width.
    //   currentSection    -- where key/value pairs are being written right now.
    //   currentRootSection-- the CONTAINER currently being filled (not the file root); only ever
    //                        set when a section is opened directly off the root (:1603-1606), and
    //                        read solely by canWarnAboutCommandMissingDash to find `type`.
    //   pspaces           -- the previous non-blank line's indent, i.e. the growth/shrink datum.
    //   secwaiting        -- a key that has been seen but whose value has not been built yet.
    //   clist             -- the list currently being appended to, or null if not in a list.
    //   buildingSubList   -- true between a `- foo:` line and the first line of foo's sub-list.
    const rootScriptSection = new Map();
    const spacedsections = new Map([[0, rootScriptSection]]);
    const spacedlists = new Map();
    let currentSection = rootScriptSection;
    let currentRootSection = null;
    let pspaces = 0;
    let secwaiting = null;
    let clist = null;
    let buildingSubList = false;
    // ScriptChecker.cs:1420
    for (let i = 0; i < lines.length; i++) {
        // ScriptChecker.cs:1422: tabs expand to four spaces HERE, because `countPreSpaces` counts
        // literal spaces only and a tab would terminate its count at zero (lineChecks.ts:38-40).
        // `line` is the tab-expanded line for the rest of this iteration; `lines[i]` is still raw
        // and is used deliberately at :1506 and :1512.
        const line = lines[i].replaceAll('\t', '    ');
        // ScriptChecker.cs:1423
        const cleaned = cleanedLines[i];
        // ScriptChecker.cs:1424.
        // -----------------------------------------------------------------
        // DELIBERATE DEVIATION FROM ScriptChecker.cs -- NOT a porting mistake.
        // -----------------------------------------------------------------
        // The C# is `int cleanStartCut = line.IndexOf(cleaned[0]);`. `cleaned` is trimmed AND
        // lowercased (:145) while `line` is raw, and C#'s IndexOf(char) is ordinal, so on a line
        // whose first non-space character is UPPERCASE the search is for a character the line's
        // key does not contain. Two ways that goes wrong, both measured against the faithful
        // port before this change:
        //
        //   1. NO MATCH AT ALL -> -1. `MyTask:` searches raw "MyTask:" for 'm' and finds none.
        //      Every startChar derived from `cleanStartCut` is then negative, the published
        //      range is clamped to column 0 (DiagnosticProvider.cs:86-92), and the squiggle sits
        //      on the indentation instead of the text. Measured: `duplicate_key` on a capitalised
        //      key published as columns 0-5 instead of 4-10.
        //
        //   2. A MATCH IN THE WRONG PLACE -- worse, and not visible as a clamp. `Test:` searches
        //      raw "Test:" for 't' and finds the one at index 3, so the range starts mid-word
        //      with no anomaly reported anywhere.
        //
        // This is not only a range defect: `cleanStartCut` is also the column stored on every
        // `LineTrackedString` this parser puts into the returned structure, which Phase 2C-3
        // consumes. A container whose name is capitalised would be recorded at column -1.
        //
        // Blast radius, traced site by site: :1534/:1550/:1556 (the `cleanStartCut + 2` list
        // pushes below) are IMMUNE either way, because a list line's `cleaned[0]` is '-', which
        // has no case. :1565 (`endIndex`), :1629 and :1633 are affected, and :1629 is what all
        // four ERROR-severity diagnostics anchor to through `warnAt`.
        //
        // Fixing it was a USER RULING, taken in preference to bug-for-bug fidelity and on the
        // same grounds as the `useless_invalid_line` range in lineChecks.ts: a squiggle sitting
        // on the indent instead of on the offending text is a defect the user can see and the C#
        // cannot defend. Capitalised keys (`MyTask:`, `Type:`) are ordinary Denizen style.
        //
        // The corrected value is the first non-whitespace position, which is evidently what the
        // C# expression was reaching for -- on lowercase keys, the only input the C# handles
        // correctly, `line.indexOf(cleaned[0])` and this agree exactly.
        //
        // It is taken from `lines[i]`, the RAW line, NOT from `line`, the tab-expanded one the C#
        // searches. LSP columns count a tab as one character, so on a tab-indented script the
        // expanded index over-reports by three per tab and lands the squiggle past the text --
        // the same visible symptom this deviation exists to remove, arriving by a second route.
        // `spaces` below still comes from the expanded `line`, and rightly so: that one is an
        // indent WIDTH used for comparisons, not a column.
        const cleanStartCut = cleaned.length === 0 ? 0 : (0, lineChecks_1.firstNonWhitespaceIndex)(lines[i]);
        // ScriptChecker.cs:1425-1428: blank (and comment-blanked) lines are skipped WITHOUT
        // touching pspaces, so indentation comparisons span them.
        if (cleaned.length === 0) {
            continue;
        }
        // ScriptChecker.cs:1429
        const spaces = (0, lineChecks_1.countPreSpaces)(line);
        // ScriptChecker.cs:1430-1460: a dedent. Restore whatever was open at the new width.
        if (spaces < pspaces) {
            const tempList = spacedlists.get(spaces);
            const temp = spacedsections.get(spaces);
            if (tempList !== undefined) {
                // ScriptChecker.cs:1432-1435. NOTE: a list restore does NOT also restore
                // `currentSection` -- lists win, and the section pointer is left where it was.
                clist = tempList;
            }
            else if (temp !== undefined) {
                // ScriptChecker.cs:1436-1439
                currentSection = temp;
            }
            else {
                // ScriptChecker.cs:1440-1445: dedented to a width that was never opened. This is
                // the branch that keeps a mis-indented file from crashing the parser.
                checker.warn(checker.warnings, i, 'shrunk_spacing', `Simple spacing error - shrunk unexpectedly to new space count, from ${pspaces} down to ${spaces}, while expecting any of: ${Array.from(spacedsections.keys()).join(', ')}.`, 0, spaces);
                pspaces = spaces;
                continue;
            }
            // ScriptChecker.cs:1446-1459: everything deeper than the new width is now closed.
            // Both loops snapshot the keys first, as the C# does with `new List<int>(...)`.
            for (const test of Array.from(spacedsections.keys())) {
                if (test > spaces) {
                    spacedsections.delete(test);
                }
            }
            for (const test of Array.from(spacedlists.keys())) {
                if (test > spaces) {
                    spacedlists.delete(test);
                }
            }
        }
        // ScriptChecker.cs:1461-1560: a list entry.
        if (cleaned.startsWith('- ')) {
            // ScriptChecker.cs:1463-1466
            if (spaces > pspaces && clist !== null && !buildingSubList) {
                checker.warn(checker.warnings, i, 'growing_spaces_in_script', "Spacing grew for no reason (missing a ':' on a command, or accidental over-spacing?).", 0, spaces);
                // NOTE: no `continue` -- the C# warns and carries on, so the over-indented entry
                // still joins the current list.
            }
            // ScriptChecker.cs:1467-1499
            if (secwaiting !== null) {
                if (clist === null) {
                    // ScriptChecker.cs:1469-1479: the pending key becomes a list.
                    clist = [];
                    spacedlists.set(spaces, clist);
                    // ScriptChecker.cs:1473-1476: the FIRST of the two duplicate_key sites. The
                    // C# scans `currentSection.Keys.Any(k => k.Text == secwaiting.Text)` rather
                    // than probing the dictionary; `Map.has(textKey)` answers the same question.
                    if (currentSection.has(scriptWarnings_1.LineTrackedString.textKey(secwaiting))) {
                        checker.warnAt(checker.errors, 'duplicate_key', 'Duplicate key - a key of the same name already exists in this script section.', secwaiting);
                    }
                    // ScriptChecker.cs:1477-1478
                    setEntry(currentSection, secwaiting, clist);
                    secwaiting = null;
                }
                else if (buildingSubList) {
                    // ScriptChecker.cs:1480-1492: the pending key came from a `- foo:` line, so
                    // it becomes a single-key map appended to the CURRENT list, and the list
                    // pointer moves into that map's own list.
                    if (spaces <= pspaces) {
                        // ScriptChecker.cs:1482-1485. NOTE: no `continue` -- the sub-list is
                        // still built, so the line that triggered this lands inside the section
                        // it just declared empty.
                        checker.warnAt(checker.errors, 'empty_command_section', 'Script section within command is empty (add contents, or remove the section).', secwaiting);
                    }
                    // ScriptChecker.cs:1486-1491
                    const newclist = [];
                    const subSection = new Map();
                    setEntry(subSection, secwaiting, newclist);
                    clist.push(subSection);
                    secwaiting = null;
                    buildingSubList = false;
                    clist = newclist;
                    spacedlists.set(spaces, newclist);
                }
                else {
                    // ScriptChecker.cs:1493-1498
                    checker.warn(checker.warnings, i, 'growing_spacing_impossible', "Line grew when that isn't possible (spacing error?).", 0, spaces);
                    pspaces = spaces;
                    continue;
                }
            }
            else if (clist === null) {
                // ScriptChecker.cs:1500-1505. NOTE the range's end: `line.IndexOf('-')`, not
                // `spaces`. They coincide for a normally indented line but the C# genuinely uses
                // a different expression here than it does at :1465.
                checker.warn(checker.warnings, i, 'weird_line_growth', 'Line purpose unknown, attempted list entry when not building a list (likely line format error, perhaps missing or misplaced a `:` on lines above, or incorrect tabulation?).', 0, line.indexOf('-'));
                pspaces = spaces;
                continue;
            }
            // ScriptChecker.cs:1506-1507: `lines[i]` RAW, so the entry keeps its original case.
            let textRaw = lines[i].trim().slice('- '.length);
            let textLow = (0, frenetic_1.toLowerFast)(textRaw);
            // ScriptChecker.cs:1508-1529: a command that does not end in ':' owns every
            // following line that is indented deeper and is not itself a list entry -- those are
            // its argument block, not lines of their own.
            if (!cleaned.endsWith(':')) {
                while (i + 1 < lines.length) {
                    // ScriptChecker.cs:1512-1513
                    const line2 = lines[i + 1].replaceAll('\t', '    ');
                    const cleaned2 = cleanedLines[i + 1];
                    if ((0, lineChecks_1.countPreSpaces)(line2) > spaces && !cleaned2.startsWith('- ')) {
                        // ScriptChecker.cs:1516-1517: the WHOLE tab-expanded line is appended,
                        // indentation included, while `textLow` gets the trimmed cleaned form --
                        // so the two halves are not parallel. Ported as written.
                        textRaw += '\n' + line2;
                        textLow += '\n' + cleaned2;
                        // ScriptChecker.cs:1518: THIS is the index mutation. Advancing the outer
                        // loop's `i` is what stops the consumed line from being judged on its own.
                        i++;
                        // ScriptChecker.cs:1519-1522: a consumed line ending in ':' opens a
                        // sub-block, so stop here and let the ':' handling below take over.
                        if (cleaned2.endsWith(':')) {
                            break;
                        }
                    }
                    else {
                        // ScriptChecker.cs:1524-1527
                        break;
                    }
                }
            }
            // ScriptChecker.cs:1530-1557.
            // NOTE: every LineTrackedString built here is anchored at `i` AFTER the loop above
            // may have advanced it -- i.e. at the LAST line of the block -- while `cleanStartCut`
            // still comes from the FIRST. C# QUIRK, ported verbatim.
            if (textLow.endsWith(':')) {
                if (textLow.startsWith('definemap ')) {
                    // ScriptChecker.cs:1532-1547: a definemap's body is data, not script, so the
                    // entry is stored WITH its trailing ':' and the indented body is swallowed
                    // without being parsed at all.
                    clist.push(new scriptWarnings_1.LineTrackedString(i, textRaw, cleanStartCut + 2));
                    while (i + 1 < lines.length) {
                        const subLine = lines[i + 1].replaceAll('\t', '    ');
                        if (isNullOrWhiteSpace(subLine) || (0, lineChecks_1.countPreSpaces)(subLine) > spaces) {
                            // ScriptChecker.cs:1540: the second index mutation.
                            i++;
                        }
                        else {
                            break;
                        }
                    }
                }
                else {
                    // ScriptChecker.cs:1548-1552: a `- foo:` command section.
                    secwaiting = new scriptWarnings_1.LineTrackedString(i, textRaw.slice(0, -1), cleanStartCut + 2);
                    buildingSubList = true;
                }
            }
            else {
                // ScriptChecker.cs:1554-1557
                clist.push(new scriptWarnings_1.LineTrackedString(i, textRaw, cleanStartCut + 2));
            }
            // ScriptChecker.cs:1558-1559
            pspaces = spaces;
            continue;
        }
        // ScriptChecker.cs:1561-1562: any non-list line closes the current list. NOTE that only
        // the entry at THIS width is dropped from `spacedlists`; shallower lists survive and can
        // still be restored by a later dedent (that is what makes :1495 reachable at all).
        clist = null;
        spacedlists.delete(spaces);
        // ScriptChecker.cs:1563-1579
        let startofline;
        let endofline = '';
        let endIndex = cleanStartCut;
        if (cleaned.endsWith(':')) {
            // ScriptChecker.cs:1566-1569: taken from `cleaned`, so ALREADY lowercased.
            startofline = cleaned.slice(0, -1);
        }
        else if (cleaned.includes(': ')) {
            // ScriptChecker.cs:1570-1574: taken from the tab-expanded RAW line, so NOT lowercased
            // -- :1629/:1633 lowercase the key half explicitly, and the value half never is.
            [startofline, endofline] = beforeAndAfter(line.trim(), ': ');
            // C# QUIRK, ported verbatim: only the key's length is added, not `": ".length`, so
            // `endIndex` lands on the ':' rather than on the first character of the value.
            endIndex += startofline.length;
        }
        else {
            // ScriptChecker.cs:1575-1579
            checker.warn(checker.warnings, i, 'identifier_missing_line', 'Line purpose unknown, no identifier (missing a `:` or a `-`?).', 0, line.length);
            // NOTE: `continue` WITHOUT updating pspaces, so the next line compares against the
            // last line that parsed.
            continue;
        }
        // ScriptChecker.cs:1580-1584
        if (startofline.length === 0) {
            checker.warn(checker.warnings, i, 'key_line_no_content', 'key line missing contents (misplaced a `:`)?', 0, line.length);
            continue;
        }
        // ScriptChecker.cs:1585-1588. NOTE: no `continue` -- this is the only one of the nine
        // warnings that lets the line through and still stores the key.
        if (startofline.includes('<')) {
            checker.warn(checker.warnings, i, 'tag_in_key', 'Keys cannot contain tags.', 0, line.length);
        }
        // ScriptChecker.cs:1589
        const inputArgs = startofline.split(' ');
        // ScriptChecker.cs:1590-1593: two suppressions beyond the helper's own -- a pending
        // `data:` key, and any currently-open section whose LAST key is `data` (i.e. we are
        // inside a data blob, where anything goes).
        if (spaces > 0 &&
            canWarnAboutCommandMissingDash(inputArgs, currentRootSection) &&
            !(secwaiting !== null && secwaiting.text === 'data') &&
            !anyOpenSectionEndsInData(spacedsections)) {
            checker.warn(checker.warnings, i, 'key_line_looks_like_command', "Line appears to be intended as command, but forgot a '-'?", 0, line.length);
        }
        // ScriptChecker.cs:1594-1622: an indent. The pending key becomes a section.
        if (spaces > pspaces) {
            if (secwaiting === null) {
                // ScriptChecker.cs:1596-1601
                checker.warn(checker.warnings, i, 'spacing_grew_weird', "Spacing grew for no reason (missing a ':', or accidental over-spacing?).", 0, spaces);
                pspaces = spaces;
                continue;
            }
            // ScriptChecker.cs:1602
            const sect = new Map();
            // ScriptChecker.cs:1603-1606: a section opened directly off the file root IS a
            // container, so it becomes the reference point for the `type` lookup.
            if (currentSection === rootScriptSection) {
                currentRootSection = sect;
            }
            // ScriptChecker.cs:1607-1617: the SECOND duplicate_key site, sharing its scan with
            // duplicate_script -- which of the two fires is decided purely by whether the
            // section being written to is the file root.
            if (currentSection.has(scriptWarnings_1.LineTrackedString.textKey(secwaiting))) {
                if (currentSection === rootScriptSection) {
                    checker.warnAt(checker.errors, 'duplicate_script', 'Duplicate script - a script container of the same name already exists in this script file.', secwaiting);
                }
                else {
                    checker.warnAt(checker.errors, 'duplicate_key', 'Duplicate key - a key of the same name already exists in this script section.', secwaiting);
                }
            }
            // ScriptChecker.cs:1618-1621
            setEntry(currentSection, secwaiting, sect);
            currentSection = sect;
            spacedsections.set(spaces, sect);
            secwaiting = null;
        }
        // ScriptChecker.cs:1623-1634
        if (endofline.length === 0) {
            // ScriptChecker.cs:1625-1628: a key with no value, arriving at a width that did not
            // grow -- so the previous pending key never got contents.
            if (secwaiting !== null && spaces <= pspaces) {
                checker.warnAt(checker.errors, 'empty_section', 'Script section is empty (add contents, or remove the section).', secwaiting);
            }
            // ScriptChecker.cs:1629. NOTE this OVERWRITES the abandoned key rather than storing
            // it, which is why an empty section leaves no trace in the returned map.
            secwaiting = new scriptWarnings_1.LineTrackedString(i, (0, frenetic_1.toLowerFast)(startofline), cleanStartCut);
        }
        else {
            // ScriptChecker.cs:1631-1634: key and value on one line. No duplicate check here --
            // only the two section/list paths above get one.
            setEntry(currentSection, new scriptWarnings_1.LineTrackedString(i, (0, frenetic_1.toLowerFast)(startofline), cleanStartCut), new scriptWarnings_1.LineTrackedString(i, endofline, endIndex));
        }
        // ScriptChecker.cs:1635
        pspaces = spaces;
    }
    // ScriptChecker.cs:1637
    return rootScriptSection;
}
exports.gatherActualContainers = gatherActualContainers;
/**
 * ScriptChecker.cs:1590's `spacedsections.Values.Any(sec => sec.Any() && sec.Keys.Last().Text
 * == "data")`. Split out of the condition purely for readability; behaviour is identical,
 * including the short-circuit.
 */
function anyOpenSectionEndsInData(spacedsections) {
    for (const sec of spacedsections.values()) {
        if (sec.size === 0) {
            continue;
        }
        const last = lastKey(sec);
        if (last !== null && last.text === 'data') {
            return true;
        }
    }
    return false;
}
//# sourceMappingURL=containerGather.js.map