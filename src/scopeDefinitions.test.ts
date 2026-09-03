import { describe, it, expect } from 'vitest';
import { loopDefinitions, enclosingLoopDefinitions, tagScopeDefinitions, definitionsInScope } from './scopeDefinitions';
import { CommandCheckDetails, COMMAND_CHECKERS } from './server/checker/commandSpecifics';
import { ScriptChecker } from './server/checker/scriptChecker';
import { ScriptCheckContext } from './server/checker/tagChecks';
import { buildArgs } from './server/checker/buildArgs';

/**
 * The implicit definitions a block or tag puts in scope, from the user's request of 2026-09-03.
 *
 * The rules are the checker's, restated in `scopeDefinitions.ts` because the checker lives in the
 * server bundle. The first group below is the guard on that restatement: it drives the CHECKER's
 * own registrations and asserts they agree. If either side changes, this fails.
 */

/** The definitions the real checker tracks for a command line, via its own registry. */
function checkerDefinitions(commandText: string): string[] {
    const details = new CommandCheckDetails();
    details.checker = new ScriptChecker('- ' + commandText);
    details.commandName = commandText.split(' ')[0].toLowerCase();
    details.commandText = commandText;
    details.arguments = buildArgs(0, 0, commandText.split(' ').slice(1).join(' '), null);
    details.argCount = details.arguments.length;
    details.line = 0;
    details.startChar = 0;
    details.context = new ScriptCheckContext();
    details.script = null;
    // One entry per command, not a list: `register` COMBINES a second registration into the
    // first (commandSpecifics.ts:97-107), so the single stored function runs both.
    COMMAND_CHECKERS.get(details.commandName)?.(details);
    return [...details.context.definitions].sort();
}

describe('the restated rules agree with the checker', () => {
    // Every shape that changes the answer. If `scopeDefinitions.ts` and the checker ever disagree
    // about one of these, the restatement has drifted and this is where it shows.
    const CASES = [
        'foreach <list[a|b]>',
        'foreach <list[a|b]> as:item',
        'foreach <list[a|b]> key:k',
        'foreach <list[a|b]> as:item key:k',
        'repeat 5',
        'repeat 5 as:n',
        'while <[x]>',
        'while <[x]> as:ignored'
    ];

    for (const commandText of CASES) {
        it(`agrees for "${commandText}"`, () => {
            const mine = loopDefinitions('- ' + commandText).map(d => d.name).sort();
            expect(mine).toEqual(checkerDefinitions(commandText));
        });
    }
});

describe('loopDefinitions: the two asymmetries', () => {
    const names = (line: string) => loopDefinitions(line).map(d => d.name);

    it('gives foreach a value, a loop_index and a key', () => {
        expect(names('    - foreach <list[a|b]>:').sort()).toEqual(['key', 'loop_index', 'value']);
    });

    it('gives while a loop_index but NO loop value', () => {
        // ScriptCheckerCommandSpecifics.cs:233-252 excludes `while` from the value.
        // MUTANT CAUGHT: dropping the `!== 'while'` guard.
        expect(names('    - while <[x]>:')).toEqual(['loop_index']);
    });

    it('gives repeat a value but NO loop_index', () => {
        // The mirror asymmetry, and the one most likely to be "tidied" away.
        // MUTANT CAUGHT: dropping the `!== 'repeat'` guard.
        expect(names('    - repeat 5:')).toEqual(['value']);
    });

    it('uses the as: and key: names when given', () => {
        expect(names('    - foreach <list[a]> as:item key:slot:').sort())
            .toEqual(['item', 'loop_index', 'slot']);
    });

    it('cuts a dotted as: name at the dot, as the checker does', () => {
        // `as:my.thing` defines `my`; offering `my.thing` would offer a name no tag can reference.
        expect(names('    - foreach <list[a]> as:my.thing:')).toContain('my');
    });

    it('says nothing for the loop-control forms, which open no block', () => {
        // `- foreach stop` ends the loop; it defines nothing.
        // MUTANT CAUGHT: treating every foreach line as a block opener.
        expect(loopDefinitions('    - foreach stop')).toEqual([]);
        expect(loopDefinitions('    - repeat stop if:<[x]>')).toEqual([]);
        expect(loopDefinitions('    - while next')).toEqual([]);
    });

    it('says nothing for any other command', () => {
        expect(loopDefinitions('    - narrate hello')).toEqual([]);
        expect(loopDefinitions('    - if <[x]>:')).toEqual([]);
    });

    it('reads through the waitable sigil', () => {
        expect(names('    - ~repeat 5:')).toEqual(['value']);
    });
});

describe('enclosingLoopDefinitions: only blocks that actually enclose', () => {
    const script = [
        'my_task:',                       // 0
        '    type: task',                 // 1
        '    script:',                    // 2
        '    - foreach <list[a]> as:outer:', // 3
        '        - repeat 3:',            // 4
        '            - narrate x',        // 5
        '    - foreach <list[b]> as:sibling:', // 6
        '        - narrate y'             // 7
    ];

    it('collects every enclosing loop, innermost first', () => {
        // Innermost first: the repeat's `value`, then the foreach's three.
        expect(enclosingLoopDefinitions(script, 5).map(d => d.name))
            .toEqual(['value', 'outer', 'loop_index', 'key']);
    });

    it('does NOT offer a sibling loop that does not enclose the caret', () => {
        // Line 7 is inside the SECOND foreach; `outer` from the first is out of reach.
        // MUTANT CAUGHT: collecting every loop above the caret regardless of indentation.
        const names = enclosingLoopDefinitions(script, 7).map(d => d.name);
        expect(names).toContain('sibling');
        expect(names).not.toContain('outer');
    });

    it('offers nothing outside any loop', () => {
        expect(enclosingLoopDefinitions(script, 1)).toEqual([]);
    });

    it('includes the caret line itself, so standing on the foreach offers its names', () => {
        expect(enclosingLoopDefinitions(script, 3).map(d => d.name)).toContain('outer');
    });

    it('is not confused by blank lines or comments between the block and the caret', () => {
        const withGaps = ['- foreach <list[a]> as:v:', '', '    # note', '    - narrate x'];
        expect(enclosingLoopDefinitions(withGaps, 3).map(d => d.name)).toContain('v');
    });
});

describe('tagScopeDefinitions', () => {
    const at = (prefix: string, rest = '') => tagScopeDefinitions(prefix + rest, prefix.length).map(d => d.name);

    it('offers the filter names inside filter_tag[...]', () => {
        expect(at('- narrate <list[a|b].filter_tag[', ']>').sort()).toEqual(['filter_key', 'filter_value']);
    });

    it('offers parse_value inside parse_tag[...]', () => {
        expect(at('- narrate <list[a].parse_tag[', ']>')).toEqual(['parse_value']);
    });

    it('covers the two the user did not name, which fall out for free', () => {
        expect(at('- narrate <list[a].parse_value_tag[', ']>').sort()).toEqual(['parse_key', 'parse_value']);
        expect(at('- narrate <list[a].null_if_tag[', ']>')).toEqual(['null_if_value']);
    });

    it('offers nothing outside the bracket', () => {
        const line = '- narrate <list[a].filter_tag[x]> after';
        expect(tagScopeDefinitions(line, 3)).toEqual([]);
        expect(tagScopeDefinitions(line, line.length)).toEqual([]);
    });

    it('offers nothing for an unrelated tag parameter', () => {
        // MUTANT CAUGHT: matching any bracket rather than the named tag parts.
        expect(at('- narrate <player.flag[', ']>')).toEqual([]);
        expect(at('- narrate <list[', 'a]>')).toEqual([]);
    });

    it('keeps both scopes when one tag is nested inside another', () => {
        const names = at('- narrate <list[a].parse_tag[<[parse_value].filter_tag[', ']>]>');
        expect(names).toContain('parse_value');
        expect(names).toContain('filter_value');
    });
});

describe('definitionsInScope', () => {
    it('merges the loop and tag scopes, tag scope first', () => {
        const lines = [
            '    - foreach <list[a]> as:item:',
            '        - narrate <list[b].filter_tag[]>'
        ];
        const character = lines[1].indexOf('filter_tag[') + 'filter_tag['.length;
        const names = definitionsInScope(lines, 1, character).map(d => d.name);
        expect(names.slice(0, 2).sort()).toEqual(['filter_key', 'filter_value']);
        expect(names).toContain('item');
        expect(names).toContain('loop_index');
    });

    it('does not repeat a name that both scopes provide', () => {
        const lines = ['    - foreach <list[a]> as:filter_value:', '        - narrate <list[b].filter_tag[]>'];
        const character = lines[1].indexOf('filter_tag[') + 'filter_tag['.length;
        const names = definitionsInScope(lines, 1, character).map(d => d.name);
        expect(names.filter(n => n === 'filter_value').length).toBe(1);
    });

    it('carries a source for every definition, so the caller can say where it came from', () => {
        const lines = ['    - repeat 5:', '        - narrate <[]>'];
        for (const definition of definitionsInScope(lines, 1, 0)) {
            expect(definition.source.length).toBeGreaterThan(0);
        }
    });
});
