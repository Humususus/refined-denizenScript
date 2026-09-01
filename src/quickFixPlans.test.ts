import { describe, it, expect } from 'vitest';
import { planFixes, ACTIONABLE_CODES, FixPlan } from './quickFixPlans';

/**
 * FEATURE-IDEAS.md idea 6: Quick Fixes for the two diagnostics whose own messages name the edit.
 *
 * The rule this file exists to enforce is that an action never appears where the checker is
 * silent, and never offers punctuation the line already has — a lightbulb that inserts a second
 * colon is worse than no lightbulb.
 */

function titles(plans: FixPlan[]): string[] {
    return plans.map(p => p.title);
}

describe('planFixes: which diagnostics are actionable', () => {
    it('acts on exactly the three codes whose messages name the fix', () => {
        // MUTANT CAUGHT: adding a fourth code, e.g. `empty_command_section`, whose fix is to write
        // a body rather than to add punctuation.
        // `missing_colon_on_command` joined the set on 2026-09-01, once the checker change that
        // emits it landed -- the feature note had recorded it as unbuildable precisely because no
        // engine reported that line.
        expect([...ACTIONABLE_CODES].sort())
            .toEqual(['identifier_missing_line', 'key_line_looks_like_command', 'missing_colon_on_command']);
    });

    it('offers nothing for a diagnostic it does not act on', () => {
        // MUTANT CAUGHT: dropping the ACTIONABLE_CODES gate, which would offer to punctuate lines
        // the checker flagged for entirely unrelated reasons.
        for (const code of ['empty_command_section', 'stray_space_eol', 'unknown_command', '']) {
            expect(planFixes(code, '    something')).toEqual([]);
        }
    });

    it('offers nothing on a blank or whitespace-only line', () => {
        expect(planFixes('identifier_missing_line', '')).toEqual([]);
        expect(planFixes('identifier_missing_line', '     ')).toEqual([]);
    });
});

describe('planFixes: identifier_missing_line', () => {
    it('offers both edits its message mentions, colon first', () => {
        // The message is "missing a `:` or a `-`?", so both are offered. Colon leads because a
        // bare word inside a container is far more often a key than a command missing its dash.
        // MUTANT CAUGHT: offering only one, or reversing the order.
        expect(titles(planFixes('identifier_missing_line', '    key1')))
            .toEqual(["Add ':' to the end of the line", "Add '- ' to the start of the line"]);
    });

    it('puts the colon after the last non-space character', () => {
        // MUTANT CAUGHT: using text.length, which on a line with trailing spaces would place the
        // colon after them, where the parser does not see it as ending the key.
        const [colon] = planFixes('identifier_missing_line', '    key1   ');
        expect(colon).toEqual({ title: "Add ':' to the end of the line", character: 8, insert: ':' });
    });

    it('puts the dash at the indent, never at column 0', () => {
        // Moving the line to the margin would take it out of its container entirely.
        // MUTANT CAUGHT: `character: 0`.
        const dash = planFixes('identifier_missing_line', '        key1')[1];
        expect(dash).toEqual({ title: "Add '- ' to the start of the line", character: 8, insert: '- ' });
    });

    it('does not offer a colon to a line that already ends in one', () => {
        // MUTANT CAUGHT: dropping the endsWith(':') guard -- the fix would produce `key1::`.
        expect(titles(planFixes('identifier_missing_line', '    key1:')))
            .toEqual(["Add '- ' to the start of the line"]);
    });

    it('does not offer a dash to a line that already starts with one', () => {
        // MUTANT CAUGHT: dropping the startsWith('-') guard -- the fix would produce `- - foo`.
        expect(titles(planFixes('identifier_missing_line', '    - foo')))
            .toEqual(["Add ':' to the end of the line"]);
    });

    it('offers nothing when the line already has both', () => {
        expect(planFixes('identifier_missing_line', '    - foo:')).toEqual([]);
    });
});

describe('planFixes: key_line_looks_like_command', () => {
    it('offers only the dash, since the line already ends in a colon', () => {
        // The message is "forgot a '-'?" and nothing else. This diagnostic only fires on a line
        // that IS a key line, so a colon is already there by construction.
        // MUTANT CAUGHT: reusing the identifier_missing_line branch, which would also offer to
        // append a second colon.
        expect(titles(planFixes('key_line_looks_like_command', '    if <[x]> == y:')))
            .toEqual(["Add '- ' to the start of the line"]);
    });

    it('places the dash at the indent', () => {
        expect(planFixes('key_line_looks_like_command', '        while true:')[0])
            .toEqual({ title: "Add '- ' to the start of the line", character: 8, insert: '- ' });
    });

    it('offers nothing when a dash is already there', () => {
        expect(planFixes('key_line_looks_like_command', '    - if <[x]> == y:')).toEqual([]);
    });
});

describe('planFixes: the edits are insertions, so they are reversible', () => {
    it('never removes text, only inserts', () => {
        // Every plan is an insertion at a character position -- there is no replacement range, so
        // the worst case of a wrong offer is one undo rather than lost work.
        // MUTANT CAUGHT: turning any of these into a whole-line replacement.
        for (const text of ['    key1', '    if x == y:', '        deep']) {
            for (const code of [...ACTIONABLE_CODES]) {
                for (const plan of planFixes(code, text)) {
                    expect(plan.insert.length).toBeGreaterThan(0);
                    expect(plan.character).toBeGreaterThanOrEqual(0);
                    expect(plan.character).toBeLessThanOrEqual(text.length);
                }
            }
        }
    });

    it('produces the line the user wanted, applied literally', () => {
        // End to end on the two shapes from the feature request.
        const apply = (text: string, plan: FixPlan): string =>
            text.slice(0, plan.character) + plan.insert + text.slice(plan.character);
        expect(apply('    key1', planFixes('identifier_missing_line', '    key1')[0])).toBe('    key1:');
        expect(apply('    if <[x]> == y:', planFixes('key_line_looks_like_command', '    if <[x]> == y:')[0]))
            .toBe('    - if <[x]> == y:');
    });

    describe('missing_colon_on_command (the case the feature note said could not be built)', () => {
        const apply = (text: string, plan: FixPlan): string =>
            text.slice(0, plan.character) + plan.insert + text.slice(plan.character);

        it('turns the literal requested line into the fixed one', () => {
            // `- if true == false` -> `- if true == false:`. The checker change of 2026-09-01 is
            // what makes this reachable; before it, no diagnostic carried this code at all.
            const text = '    - if true == false';
            const plans = planFixes('missing_colon_on_command', text);
            expect(plans.map(p => p.title)).toEqual(["Add ':' to the end of the line"]);
            expect(apply(text, plans[0])).toBe('    - if true == false:');
        });

        it('offers the colon ONLY, never the dash', () => {
            // The diagnostic can only arise on a line the gatherer read as a list entry, so the
            // dash is already there. Offering to add a second one would corrupt the line.
            // MUTANT CAUGHT: falling through to the shared dash-adding tail.
            for (const text of ['    - foreach <list[a]>', '    - else', '- while <[x]>']) {
                expect(planFixes('missing_colon_on_command', text).map(p => p.insert)).toEqual([':']);
            }
        });

        it('puts the colon before trailing whitespace, not after it', () => {
            // A colon after the spaces does not end the key as far as the parser is concerned, so
            // the fix would appear to do nothing.
            // MUTANT CAUGHT: using text.length instead of text.trimEnd().length.
            expect(apply('    - if <[x]>   ', planFixes('missing_colon_on_command', '    - if <[x]>   ')[0]))
                .toBe('    - if <[x]>:   ');
        });

        it('offers nothing once the colon is already there', () => {
            expect(planFixes('missing_colon_on_command', '    - if true == false:')).toEqual([]);
        });
    });
});
