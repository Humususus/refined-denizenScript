import { describe, it, expect } from 'vitest';
import { ScriptEventCouldMatcher, parseMatchers } from './scriptEventCouldMatcher';
import { knownValidatorTypes, Validator } from './eventValidators';
import { createEmptyExtraData, ExtraData } from '../metaDocs/extraData';

/**
 * Derived from SharpDenizenTools/ScriptAnalysis/ScriptEventCouldMatcher.cs (145 lines) and the
 * matcher-building half of EventTools.cs (:44-70).
 *
 * A could-matcher is one documented event's format line -- `on <player> breaks <block>` -- compiled
 * into one validator per word. Two things here are easy to port subtly wrong and expensive to get
 * wrong: the paren expansion, which decides HOW MANY matchers an event has, and the scoring, which
 * decides which of several matching events gets reported.
 */

function extra(): ExtraData {
    const data = createEmptyExtraData();
    data.blocks.add('stone');
    data.items.add('stick');
    data.entities.add('zombie');
    return data;
}

/** Builds matchers with the real validator registry. */
function build(format: string): ScriptEventCouldMatcher[] {
    const errors: string[] = [];
    const result = parseMatchers(format, knownValidatorTypes(extra()), (e) => errors.push(e));
    expect(errors).toEqual([]);
    return result;
}

/** Every format a parse produced, in order. */
function formats(format: string): string[] {
    return build(format).map(m => m.format);
}

describe('paren expansion (EventTools.cs:51-70)', () => {
    it('returns a single matcher when there is nothing optional', () => {
        expect(formats('on player breaks block')).toEqual(['on player breaks block']);
    });

    it('expands a TRAILING optional part into with/without, without-first', () => {
        // The order matters only in that it is the C#'s; the two are then filtered by score.
        expect(formats('player breaks <block> (with <item>)')).toEqual([
            'player breaks <block>',
            'player breaks <block> with <item>'
        ]);
    });

    it('expands a MIDDLE optional part without leaving a double space', () => {
        // The `paren - 1` and `endParen + 2` arithmetic steps over the spaces OUTSIDE the brackets.
        // MUTANT CAUGHT: using `paren` or `endParen + 1`, which leaves a stray space and so an
        // empty word, which the constructor then reports as "has a double space?".
        expect(formats('player (really) breaks <block>')).toEqual([
            'player breaks <block>',
            'player really breaks <block>'
        ]);
    });

    it('expands the real formats that ship with the meta', () => {
        // Copied verbatim from the live meta, which is where the shapes that actually occur are.
        // NOTE `player` is a LITERAL word in Denizen's event formats -- there is no `<player>`
        // fill-in type, and the ten registered types are exactly the ten the 490 real format lines
        // use. An invented `<player>` in an earlier draft of this test is what surfaced that.
        expect(formats('player stops spectating (<entity>)')).toEqual([
            'player stops spectating',
            'player stops spectating <entity>'
        ]);
        expect(formats('gamerule changes (in <world>)')).toEqual([
            'gamerule changes',
            'gamerule changes in <world>'
        ]);
        expect(formats("<entity> prespawns (because <'cause'>)")).toEqual([
            '<entity> prespawns',
            "<entity> prespawns because <'cause'>"
        ]);
        // A leading-paren case from the real meta, and one where the optional part is itself an
        // alternation rather than a plain word.
        expect(formats('player (right|left) clicks fake entity')).toEqual([
            'player clicks fake entity',
            'player right|left clicks fake entity'
        ]);
    });

    it('expands a LEADING optional part without a leading space', () => {
        // Exercises both asymmetric ternaries: baseText is empty here, so the without-branch must
        // not prepend a space and the with-branch must not append one to nothing.
        expect(formats('(on) player breaks')).toEqual([
            'player breaks',
            'on player breaks'
        ]);
    });

    it('expands TWO optional parts into four matchers', () => {
        // Recursion doubles per paren. MUTANT CAUGHT: recursing once instead of twice, or
        // returning after the first recursion.
        expect(formats('a (b) c (d)')).toEqual(['a c', 'a c d', 'a b c', 'a b c d']);
    });

    it('treats an all-whitespace baseText as empty, unlike an all-whitespace afterText', () => {
        // EventTools.cs:68 tests `string.IsNullOrEmpty(afterText)` against
        // `string.IsNullOrWhiteSpace(baseText)` -- two DIFFERENT predicates in one ternary. It
        // reads like a slip and is not: with a whitespace-only baseText the without-branch must
        // not insert yet another separator.
        //
        // UNREACHABLE FROM THE REAL META -- 0 of its 490 format lines begin with whitespace, so
        // this cannot fire in practice. It is pinned anyway because the two predicates DO differ
        // (the mutation audit found this test missing), and the next person to notice the
        // asymmetry will otherwise "tidy" it into a real behaviour change with nothing to object.
        const errors: string[] = [];
        const result = parseMatchers('  (a) b', new Map(), (e) => errors.push(e));
        expect(result.map(m => m.format)).toEqual([' b', '  a b']);
        // Both expansions still carry the stray leading spaces, hence empty words and errors --
        // a malformed format stays malformed, it is not silently repaired.
        expect(errors.length).toBe(3);
    });

    it('reports an unclosed paren and produces no matcher', () => {
        // EventTools.cs:61-64. The event is dropped rather than the whole meta load failing.
        const errors: string[] = [];
        const result = parseMatchers('on player (breaks', knownValidatorTypes(extra()), (e) => errors.push(e));
        expect(result).toEqual([]);
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain('inconsistent parens');
    });

    it('prefixes every error with the event being parsed', () => {
        // EventTools.cs:47 wraps the callback. Without the event name, a meta-load error names no
        // event and is unactionable.
        const errors: string[] = [];
        parseMatchers('on player (breaks', knownValidatorTypes(extra()), (e) => errors.push(e));
        expect(errors[0]).toContain("while parsing event 'on player (breaks'");
    });
});

describe('ScriptEventCouldMatcher construction (ScriptEventCouldMatcher.cs:32-90)', () => {
    const types = () => knownValidatorTypes(extra());

    it('builds one validator per word', () => {
        const matcher = new ScriptEventCouldMatcher('on player breaks block', () => {}, types());
        expect(matcher.parts).toEqual(['on', 'player', 'breaks', 'block']);
        expect(matcher.validators.length).toBe(4);
    });

    it('orders plain words BEFORE type fill-ins in argOrder', () => {
        // The cheap tests run first so a non-match is found without running a type matcher.
        // MUTANT CAUGHT: concatenating the two lists the other way round, or using the natural
        // 0..n order.
        const matcher = new ScriptEventCouldMatcher('on <entity> breaks <block>', () => {}, types());
        expect(matcher.argOrder).toEqual([0, 2, 1, 3]);
    });

    it('scores a literal word 10 for an exact hit and 0 otherwise', () => {
        const matcher = new ScriptEventCouldMatcher('breaks', () => {}, types());
        expect(matcher.validators[0]('breaks', false)).toBe(10);
        expect(matcher.validators[0]('break', false)).toBe(0);
    });

    it('scores an a|b alternation 10 for any listed word', () => {
        const matcher = new ScriptEventCouldMatcher('breaks|places', () => {}, types());
        expect(matcher.validators[0]('breaks', false)).toBe(10);
        expect(matcher.validators[0]('places', false)).toBe(10);
        expect(matcher.validators[0]('eats', false)).toBe(0);
    });

    it("scores a quoted <'label'> fill-in 1 for ANYTHING", () => {
        // :57-62. A quoted part documents what a word means without constraining it, at the
        // weakest score so a real recogniser always beats it in isBetterMatchThan.
        // MUTANT CAUGHT: returning 10, which would make a label tie with a literal.
        const matcher = new ScriptEventCouldMatcher("<'in'>", () => {}, types());
        expect(matcher.validators[0]('in', false)).toBe(1);
        expect(matcher.validators[0]('anything_at_all', false)).toBe(1);
    });

    it('resolves a <type> fill-in to that type validator', () => {
        const matcher = new ScriptEventCouldMatcher('<block>', () => {}, types());
        expect(matcher.validators[0]('stone', false)).toBe(10);
        expect(matcher.validators[0]('zombie', false)).toBe(0);
    });

    it('reports an unknown fill-in type and SKIPS that word', () => {
        // :65-69. The validator list comes out shorter than parts, which is the C#'s degradation:
        // one typo in one event's docs weakens that event, it does not throw.
        const errors: string[] = [];
        const matcher = new ScriptEventCouldMatcher('on <nonsense> breaks', (e) => errors.push(e), types());
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("unrecognized input type 'nonsense'");
        expect(matcher.parts.length).toBe(3);
        expect(matcher.validators.length).toBe(2);
    });

    it('keeps validator indices contiguous when a word is skipped', () => {
        // THE REASON `index++` SITS INSIDE EACH BRANCH rather than at the top of the loop. A skip
        // must not leave a hole, or argOrder would index past the end of validators.
        // MUTANT CAUGHT: incrementing index once per PART instead of per validator.
        const matcher = new ScriptEventCouldMatcher('on <nonsense> breaks', () => {}, types());
        expect([...matcher.argOrder].sort()).toEqual([0, 1]);
        for (const i of matcher.argOrder) {
            expect(matcher.validators[i]).toBeTypeOf('function');
        }
    });

    it('reports a double space and skips the empty word', () => {
        const errors: string[] = [];
        const matcher = new ScriptEventCouldMatcher('on  breaks', (e) => errors.push(e), types());
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain('double space');
        expect(matcher.validators.length).toBe(2);
    });

    it('reports an unclosed fill-in and skips it', () => {
        const errors: string[] = [];
        const matcher = new ScriptEventCouldMatcher('on <block breaks', (e) => errors.push(e), types());
        expect(errors[0]).toContain('unclosed fill-in part');
        expect(matcher.validators.length).toBe(2);
    });
});

describe('tryMatch (ScriptEventCouldMatcher.cs:96-123)', () => {
    const types = () => knownValidatorTypes(extra());
    const matcher = () => new ScriptEventCouldMatcher('on <entity> breaks <block>', () => {}, types());

    it('returns the MAXIMUM score across the words, not the minimum', () => {
        // Every word has already passed by the time the max is taken -- a zero returns early -- so
        // the max reports the strongest evidence. `<entity>` scores 10 on a known entity and the
        // literals score 10, so this is 10.
        // MUTANT CAUGHT: Math.max -> Math.min, which would report the weakest word instead.
        expect(matcher().tryMatch(['on', 'zombie', 'breaks', 'stone'], false, false)).toBe(10);
    });

    it('returns 0 the moment any single word fails', () => {
        expect(matcher().tryMatch(['on', 'zombie', 'eats', 'stone'], false, false)).toBe(0);
    });

    it('reports a weak but nonzero score when a fill-in is only plausible', () => {
        // `some_custom_mob` is unknown to the entity enum, so `<entity>` scores 1 -- but the two
        // literals score 10, and the max is what is reported.
        expect(matcher().tryMatch(['on', 'some_custom_mob', 'breaks', 'stone'], false, false)).toBe(10);
    });

    it('rejects a length mismatch outright when partial matching is off', () => {
        expect(matcher().tryMatch(['on', 'zombie', 'breaks'], false, false)).toBe(0);
    });

    it('accepts a SHORT input when partial matching is on', () => {
        expect(matcher().tryMatch(['on', 'zombie', 'breaks'], true, false)).toBeGreaterThan(0);
    });

    it('caps a partial match at 3, so it can never outrank a complete one', () => {
        // :118-121. A partial match is a "might be incomplete?" suggestion, not an answer.
        // MUTANT CAUGHT: dropping the Math.min, which would let a 3-of-4 word match score 10 and
        // beat an event that matched all four.
        expect(matcher().tryMatch(['on', 'zombie', 'breaks'], true, false)).toBe(3);
    });

    it('rejects a LONGER input even when partial matching is on', () => {
        // Partial means "the first few words", never "extra words are fine".
        // MUTANT CAUGHT: dropping the `pathBaseParts.length > validators.length` half.
        expect(matcher().tryMatch(['on', 'zombie', 'breaks', 'stone', 'extra'], true, false)).toBe(0);
    });

    it('passes `precise` through to the type validators', () => {
        // Loose accepts an unknown word as plausible (1); precise does not (0).
        expect(matcher().tryMatch(['on', 'some_custom_mob', 'breaks', 'stone'], false, false)).toBe(10);
        expect(matcher().tryMatch(['on', 'some_custom_mob', 'breaks', 'stone'], false, true)).toBe(0);
    });

    it('is unaffected by argOrder, since zero short-circuits and max commutes', () => {
        // Pins the claim made in the source comment: reordering is an optimisation only.
        const normal = matcher();
        const reordered = matcher();
        reordered.argOrder = [...reordered.argOrder].reverse();
        for (const words of [['on', 'zombie', 'breaks', 'stone'], ['on', 'zombie', 'eats', 'stone'], ['on', 'some_custom_mob', 'breaks', 'stone']]) {
            expect(reordered.tryMatch(words, false, false)).toBe(normal.tryMatch(words, false, false));
        }
    });
});

describe('isBetterMatchThan (ScriptEventCouldMatcher.cs:126-143)', () => {
    const types = () => knownValidatorTypes(extra());

    it('prefers the LONGER matcher outright', () => {
        // Between two matchers that both accept the line, the one explaining more of it wins.
        // This is how the optional-part expansion resolves against a line that includes the option.
        // MUTANT CAUGHT: `>` -> `<`.
        const long_ = new ScriptEventCouldMatcher('on <entity> breaks <block> with <item>', () => {}, types());
        const short_ = new ScriptEventCouldMatcher('on <entity> breaks <block>', () => {}, types());
        const words = ['on', 'zombie', 'breaks', 'stone', 'with', 'stick'];
        expect(long_.isBetterMatchThan(words, false, short_)).toBe(true);
        expect(short_.isBetterMatchThan(words, false, long_)).toBe(false);
    });

    it('prefers the more specific matcher at equal length', () => {
        // A literal scores 10 where a quoted label scores 1, so the literal wins the vote.
        const literal = new ScriptEventCouldMatcher('on zombie breaks stone', () => {}, types());
        const labelled = new ScriptEventCouldMatcher("on <'a'> <'b'> <'c'>", () => {}, types());
        const words = ['on', 'zombie', 'breaks', 'stone'];
        expect(literal.isBetterMatchThan(words, false, labelled)).toBe(true);
        expect(labelled.isBetterMatchThan(words, false, literal)).toBe(false);
    });

    it('counts a tie on a word AGAINST self, but still gives the overall tie to self', () => {
        // `betterMatches += (match > match2) ? 1 : -1` -- there is no zero. Two identical matchers
        // therefore score -4, yet `>= 0`... is false. So identical matchers are NOT better than
        // each other, and the incumbent is kept. That asymmetry is the C#'s, and it is why the
        // caller must always ask the CHALLENGER.
        // MUTANT CAUGHT: `>=` -> `>` in the comparison, or `>= 0` -> `> 0` in the return.
        const a = new ScriptEventCouldMatcher('on zombie breaks stone', () => {}, types());
        const b = new ScriptEventCouldMatcher('on zombie breaks stone', () => {}, types());
        expect(a.isBetterMatchThan(['on', 'zombie', 'breaks', 'stone'], false, b)).toBe(false);
    });

    it('gives the tie to self when the vote is exactly even', () => {
        // One word better, one worse, on a two-word matcher -> betterMatches is 0 -> `>= 0` -> true.
        // MUTANT CAUGHT: `>= 0` -> `> 0`.
        const a = new ScriptEventCouldMatcher("zombie <'x'>", () => {}, types());
        const b = new ScriptEventCouldMatcher("<'x'> breaks", () => {}, types());
        expect(a.isBetterMatchThan(['zombie', 'breaks'], false, b)).toBe(true);
    });
});

describe('the validator registry is what the matchers are built against', () => {
    it('accepts a caller-supplied registry, not a global one', () => {
        // The C# passes docs.Data.KnownValidatorTypes in. Nothing here reaches for an ambient
        // singleton, which is what lets the checker run on a cold start with no enum data.
        const custom = new Map<string, Validator>([['thing', () => 10]]);
        const matcher = new ScriptEventCouldMatcher('<thing>', () => {}, custom);
        expect(matcher.validators[0]('whatever', false)).toBe(10);
    });
});
