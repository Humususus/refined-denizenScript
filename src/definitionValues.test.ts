import { describe, it, expect } from 'vitest';
import { definitionReferenceAt, findDefineAssignments } from './definitionValues';

describe('definitionReferenceAt', () => {
    it('reads the name and span when the cursor sits inside <[...]>', () => {
        const line = '    - narrate <[myvar]>';
        const ref = definitionReferenceAt(line, line.indexOf('myvar') + 2)!;
        expect(ref.name).toBe('myvar');
        expect(line.slice(ref.start, ref.end)).toBe('<[myvar]>');
    });

    it('reads a sub-mapped dotted name whole', () => {
        // Define's own docs: "<[a.b.c]>" is equivalent to "<[a].get[b].get[c]>" -- one name.
        const line = '    - narrate "<[myroot.mykey]>"';
        expect(definitionReferenceAt(line, line.indexOf('myroot') + 2)!.name).toBe('myroot.mykey');
    });

    it('returns null before or after the tag entirely', () => {
        const line = '    - narrate <[myvar]> tail';
        expect(definitionReferenceAt(line, 2)).toBeNull();
        expect(definitionReferenceAt(line, line.indexOf('tail'))).toBeNull();
    });

    it('returns null for a dynamically-built name', () => {
        // No literal text to look up -- `<[slot]>` has to be evaluated to know the real name.
        const line = '        - define overwriteSlots.<[slot]> <[item]>';
        expect(definitionReferenceAt(line, line.indexOf('slot') + 20)).toBeNull();
    });

    it('picks the bracket the cursor is actually inside, on a line with several', () => {
        const line = '    - narrate "<[first]> and <[second]>"';
        expect(definitionReferenceAt(line, line.indexOf('second') + 2)!.name).toBe('second');
    });

    it('returns null on a line with no <[...]> at all', () => {
        expect(definitionReferenceAt('    - narrate hi', 10)).toBeNull();
    });
});

describe('findDefineAssignments', () => {
    it('finds a plain assignment', () => {
        const text = '    - define range <player.flag[range_level].mul[3]>';
        const found = findDefineAssignments(text, 'range');
        expect(found).toEqual([{ line: 0, value: '<player.flag[range_level].mul[3]>', waitable: false }]);
    });

    it('is case-insensitive on the name, matching Denizen definitions generally', () => {
        const text = '    - define Range 5';
        expect(findDefineAssignments(text, 'range')).toEqual([{ line: 0, value: '5', waitable: false }]);
    });

    it('reads a literal sub-mapped name the same way completion does', () => {
        const text = '    - define myroot.mykey MyValue';
        expect(findDefineAssignments(text, 'myroot.mykey')).toEqual([{ line: 0, value: 'MyValue', waitable: false }]);
    });

    it('recognises the ~define (waitable) form', () => {
        const text = '- ~define result <server.flag[big_data].parse_tag[<[parse_value].to_uppercase>]>';
        const found = findDefineAssignments(text, 'result');
        expect(found.length).toBe(1);
        expect(found[0].waitable).toBe(true);
    });

    it('finds every assignment in file order, including repeats', () => {
        // The real shape of the user's own corpus: `page` reassigned three times in one file.
        const text = [
            '    - define page 1',
            '    - define page <[page].max[1].min[<[max_page]>]>',
            '    - if true:',
            '        - define page <[page].add[1]>'
        ].join('\n');
        const found = findDefineAssignments(text, 'page');
        expect(found.map(f => f.line)).toEqual([0, 1, 3]);
        expect(found[2].value).toBe('<[page].add[1]>');
    });

    it('does not match a data-action colon form', () => {
        // `name:->:value` (append) puts a value behind an action this module does not interpret.
        // MUTANT CAUGHT: requiring only a non-word boundary instead of whitespace after the name.
        const text = '        - define membersList:->:<item[heavy_core]>';
        expect(findDefineAssignments(text, 'membersList')).toEqual([]);
    });

    it('does not match the remove form', () => {
        const text = '    - define myDef:!';
        expect(findDefineAssignments(text, 'myDef')).toEqual([]);
    });

    it('does not match a dynamically-built name', () => {
        // Real corpus line: the target key itself is a tag, so there is no static "overwriteSlots"
        // assignment to report -- the actual key varies at runtime.
        const text = '        - define overwriteSlots.<[slot]> <[item]>';
        expect(findDefineAssignments(text, 'overwriteSlots')).toEqual([]);
        expect(findDefineAssignments(text, 'overwriteSlots.slot')).toEqual([]);
    });

    it('does not match a commented-out define', () => {
        const text = '    # - define range 5';
        expect(findDefineAssignments(text, 'range')).toEqual([]);
    });

    it('does not match a different name', () => {
        const text = '    - define other 5';
        expect(findDefineAssignments(text, 'range')).toEqual([]);
    });

    it('does not match definemap, a different command with a different shape', () => {
        const text = '    - definemap range count:5 type:Taco';
        expect(findDefineAssignments(text, 'range')).toEqual([]);
    });

    it('does not require the value to look like anything in particular', () => {
        // Quoted values, lists, fallback ("||"), whatever -- the whole rest of the line is kept
        // verbatim and uninterpreted.
        const text = "    - define clan_name_regex '^[A-Za-z0-9!@\\[\\]()]{1,16}$'";
        expect(findDefineAssignments(text, 'clan_name_regex')[0].value).toBe("'^[A-Za-z0-9!@\\[\\]()]{1,16}$'");
    });
});
