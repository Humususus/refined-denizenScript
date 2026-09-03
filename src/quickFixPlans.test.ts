import { describe, it, expect } from 'vitest';
import { planFixes, ACTIONABLE_CODES, FixPlan, deprecationReplacement } from './quickFixPlans';

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
    it('acts on exactly the four codes whose messages name the fix', () => {
        // MUTANT CAUGHT: adding a fourth code, e.g. `empty_command_section`, whose fix is to write
        // a body rather than to add punctuation.
        // `missing_colon_on_command` joined the set on 2026-09-01, once the checker change that
        // emits it landed -- the feature note had recorded it as unbuildable precisely because no
        // engine reported that line.
        expect([...ACTIONABLE_CODES].sort())
            .toEqual(['deprecated_tag_part', 'identifier_missing_line', 'key_line_looks_like_command', 'missing_colon_on_command']);
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
        expect(colon).toEqual({ title: "Add ':' to the end of the line", character: 8, insert: ':', replace: 0 });
    });

    it('puts the dash at the indent, never at column 0', () => {
        // Moving the line to the margin would take it out of its container entirely.
        // MUTANT CAUGHT: `character: 0`.
        const dash = planFixes('identifier_missing_line', '        key1')[1];
        expect(dash).toEqual({ title: "Add '- ' to the start of the line", character: 8, insert: '- ', replace: 0 });
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
            .toEqual({ title: "Add '- ' to the start of the line", character: 8, insert: '- ', replace: 0 });
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

/**
 * Rewriting a deprecated tag part -- the second half of FEATURE-IDEAS.md idea 7, user request
 * 2026-09-03. `deprecated_tag_part` is the only actionable code whose plan REPLACES text, so the
 * tests here are weighted towards the cases where it must refuse.
 *
 * Every message below is in the shape `tagTracer.ts` actually emits:
 * "Deprecated tag `x`: <the meta's @deprecated text>", and every @deprecated text is quoted from
 * the live meta as measured 2026-09-03.
 */
describe('deprecationReplacement', () => {
    it('reads the replacement when the whole message is `use <part>`', () => {
        expect(deprecationReplacement('Deprecated tag `elementtag.as_entity`: use as[entity]')).toBe('as[entity]');
        expect(deprecationReplacement('Deprecated tag `elementtag.hex_encode`: use utf8_encode')).toBe('utf8_encode');
    });

    it('refuses a message that names a DOTTED replacement', () => {
        // The failure this guards, and the reason the rule is "the whole message": a loose scan for
        // a word after "use" extracts `EntityTag` here and would offer to rewrite the part to that.
        // MUTANT CAUGHT: relaxing the anchors to a substring search.
        expect(deprecationReplacement('Deprecated tag `entitytag.map_trace`: use EntityTag.trace_framed_map')).toBeNull();
        expect(deprecationReplacement('Deprecated tag `locationtag.tree_distance`: Use MaterialTag.distance')).toBeNull();
    });

    it('refuses the quoted, linked, version-qualified and empty forms', () => {
        // 99 of the meta's 124 deprecations look like one of these.
        expect(deprecationReplacement("Deprecated tag `entitytag.arms_raised`: use 'aggressive'")).toBeNull();
        expect(deprecationReplacement('Deprecated tag `worldtag.time.full`: Use <@link tag WorldTag.time_full> instead.')).toBeNull();
        expect(deprecationReplacement("Deprecated tag `entitytag.entity_type`: Use 'EntityTag.type' on MC 1.20+.")).toBeNull();
        expect(deprecationReplacement('Deprecated tag `npctag.hologram_direction`: This was removed from Citizens.')).toBeNull();
    });

    it('refuses a replacement that is a key=value template rather than a literal', () => {
        // The meta's own trap: pasting this would overwrite the author's real colours with the
        // documentation's placeholder words.
        // MUTANT CAUGHT: dropping the [=;] guard.
        expect(deprecationReplacement('Deprecated tag `elementtag.hsb_color_gradient`: use color_gradient[from=color;to=color;style=HSB]')).toBeNull();
    });

    it('refuses anything that is not a deprecation message at all', () => {
        expect(deprecationReplacement('use as[entity]')).toBeNull();
        expect(deprecationReplacement('')).toBeNull();
    });
});

describe('planFixes for deprecated_tag_part', () => {
    const MSG = 'Deprecated tag `elementtag.as_entity`: use as[entity]';
    //           0123456789...
    const LINE = '- narrate <player.as_entity.name>';
    const START = LINE.indexOf('as_entity');
    const END = START + 'as_entity'.length;

    it('replaces exactly the deprecated part', () => {
        const plans = planFixes('deprecated_tag_part', LINE, { message: MSG, startCharacter: START, endCharacter: END });
        expect(plans).toEqual([{ title: "Replace with 'as[entity]'", character: START, insert: 'as[entity]', replace: 'as_entity'.length }]);
        // The edit applied by hand, to prove the span is right rather than merely plausible.
        expect(LINE.slice(0, START) + 'as[entity]' + LINE.slice(END)).toBe('- narrate <player.as[entity].name>');
    });

    it('offers nothing without the diagnostic context', () => {
        expect(planFixes('deprecated_tag_part', LINE)).toEqual([]);
    });

    it('refuses when the part carries a parameter of its own', () => {
        // Swapping only the name would strand arguments belonging to a different tag; widening the
        // span to swallow them would destroy them.
        // MUTANT CAUGHT: dropping the `[` guard.
        const line = "- narrate <element[x].hsb_color_gradient[from=#000000;to=#ffffff]>";
        const start = line.indexOf('hsb_color_gradient');
        const plans = planFixes('deprecated_tag_part', line, {
            message: 'Deprecated tag `elementtag.hsb_color_gradient`: use color_gradient',
            startCharacter: start,
            endCharacter: start + 'hsb_color_gradient'.length
        });
        expect(plans).toEqual([]);
    });

    it('offers nothing when the text is already the replacement', () => {
        const line = '- narrate <player.as[entity].name>';
        const start = line.indexOf('as[entity]');
        expect(planFixes('deprecated_tag_part', line, {
            message: MSG, startCharacter: start, endCharacter: start + 'as[entity]'.length
        })).toEqual([]);
    });

    it('refuses a range that does not fit the line', () => {
        // A diagnostic can outlive the edit that shortened the line.
        expect(planFixes('deprecated_tag_part', LINE, { message: MSG, startCharacter: START, endCharacter: 9999 })).toEqual([]);
        expect(planFixes('deprecated_tag_part', LINE, { message: MSG, startCharacter: 5, endCharacter: 5 })).toEqual([]);
    });
});
