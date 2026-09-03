import { describe, it, expect } from 'vitest';
import { evaluateMathTag, formatNumber, looksArithmetic, SUPPORTED_OPERATIONS } from './mathEval';

/**
 * FEATURE-IDEAS.md idea 4. No C# counterpart -- the C# server does no arithmetic -- so every
 * expectation comes from the tag's own documented behaviour in the meta, quoted at each group.
 *
 * The governing constraint, restated because it shapes half these tests: Denizen's exact numeric
 * representation cannot be established from anything this repo has, so a result that is not the
 * exact double must SAY so rather than being printed bare.
 */

const value = (text: string) => evaluateMathTag(text);

describe('evaluateMathTag: the documented operations', () => {
    it('adds, subtracts, multiplies and divides', () => {
        expect(value('<element[5].add[3]>')).toMatchObject({ kind: 'value', value: 8 });
        expect(value('<element[5].sub[3]>')).toMatchObject({ kind: 'value', value: 2 });
        expect(value('<element[5].mul[3]>')).toMatchObject({ kind: 'value', value: 15 });
        expect(value('<element[6].div[3]>')).toMatchObject({ kind: 'value', value: 2 });
    });

    it('handles the remaining binary operations', () => {
        expect(value('<element[7].mod[3]>')).toMatchObject({ value: 1 });
        expect(value('<element[2].power[10]>')).toMatchObject({ value: 1024 });
        // "Returns the higher number: this element or the specified one."
        expect(value('<element[5].max[10]>')).toMatchObject({ value: 10 });
        expect(value('<element[5].min[10]>')).toMatchObject({ value: 5 });
        // "Returns the logarithm of the element, with the base of the specified number."
        expect(value('<element[8].log[2]>')).toMatchObject({ value: 3 });
    });

    it('handles the unary operations', () => {
        // "For example: <element[-5].abs> returns 5."
        expect(value('<element[-5].abs>')).toMatchObject({ value: 5 });
        expect(value('<element[9].sqrt>')).toMatchObject({ value: 3 });
        expect(value('<element[1].ln>')).toMatchObject({ value: 0 });
    });

    it('rounds the three documented ways', () => {
        expect(value('<element[2.5].round>')).toMatchObject({ value: 3 });
        expect(value('<element[2.1].round_up>')).toMatchObject({ value: 3 });
        expect(value('<element[2.9].round_down>')).toMatchObject({ value: 2 });
        // "0.12345 .round_to[3] returns 0.123"
        expect(value('<element[0.12345].round_to[3]>')).toMatchObject({ value: 0.123 });
    });

    it('does trigonometry in RADIANS, as the meta says', () => {
        // "Returns the cosine of the input radian angle", and asin/acos/atan "in radians".
        // Worth a test of its own because the corpus contains `<[t].mul[90]>.cos`, which reads like
        // degrees and is not -- taking it for degrees would produce confidently wrong numbers.
        // MUTANT CAUGHT: converting to or from degrees anywhere in the trig group.
        expect(value('<element[0].cos>')).toMatchObject({ value: 1 });
        expect(value('<element[0].sin>')).toMatchObject({ value: 0 });
        expect(value('<element[1].acos>')).toMatchObject({ value: 0 });
        expect(value('<element[0].atan>')).toMatchObject({ value: 0 });
        // cos(180 radians) is NOT -1; cos(pi) is. This is the check that catches a degrees mix-up.
        const cos180 = value('<element[180].cos>');
        expect(cos180.kind === 'value' && Math.abs(cos180.value - (-1)) > 0.1).toBe(true);
    });

    it('converts between radians and degrees the way round the meta states', () => {
        // "to_radians: converts the element FROM DEGREES to radians."
        // MUTANT CAUGHT: swapping the two conversions.
        expect(value('<element[180].to_radians>')).toMatchObject({ value: Math.PI });
        const degrees = value('<element[3.141592653589793].to_degrees>');
        expect(degrees).toMatchObject({ kind: 'value' });
        expect(degrees.kind === 'value' && Math.abs(degrees.value - 180) < 1e-9).toBe(true);
    });

    it('handles truncate, factorial and the precision roundings', () => {
        // "truncate: rounds towards zero" -- which is neither round_up nor round_down for a
        // negative. MUTANT CAUGHT: implementing it as floor.
        expect(value('<element[-2.7].truncate>')).toMatchObject({ value: -2 });
        expect(value('<element[2.7].truncate>')).toMatchObject({ value: 2 });
        expect(value('<element[5].factorial>')).toMatchObject({ value: 120 });
        // "0.12345 .round_to_precision[0.005] returns 0.125"
        expect(value('<element[0.12345].round_to_precision[0.005]>')).toMatchObject({ display: '0.125' });
    });

    it('refuses a factorial it cannot represent exactly', () => {
        // "Should only be used for small values (generally: less than 20)". Beyond that a double
        // holds an approximation, and printing it would look precise while being wrong.
        expect(value('<element[25].factorial>').kind).toBe('unsupported');
        expect(value('<element[-1].factorial>').kind).toBe('unsupported');
        expect(value('<element[2.5].factorial>').kind).toBe('unsupported');
    });

    it('does integer division with truncation, per the _int family', () => {
        expect(value('<element[7].div_int[2]>')).toMatchObject({ value: 3 });
        expect(value('<element[-7].div_int[2]>')).toMatchObject({ value: -3 });
    });

    it('reads atan2 as <Y.atan2[X]>', () => {
        // The meta is explicit about the order, and getting it backwards is silent.
        // MUTANT CAUGHT: passing the arguments the other way round.
        const r = value('<element[1].atan2[0]>');
        expect(r.kind === 'value' && Math.abs(r.value - Math.PI / 2) < 1e-9).toBe(true);
    });

    it('chains operations left to right', () => {
        // (5 + 3) * 2 = 16, not 5 + (3 * 2).
        expect(value('<element[5].add[3].mul[2]>')).toMatchObject({ value: 16 });
    });

    it('evaluates a nested tag as an argument', () => {
        // The user's own example shape.
        expect(value('<element[1].sub[<element[2].mul[3]>]>')).toMatchObject({ value: -5 });
    });

    it('works with or without the surrounding angle brackets', () => {
        expect(value('element[5].add[3]')).toMatchObject({ value: 8 });
    });
});

describe('evaluateMathTag: what it refuses to guess', () => {
    it('asks for a definition rather than inventing one', () => {
        // `<[t]>` is the placeholder the feature request named specifically. It is named as it is
        // WRITTEN, brackets and all, so the prompt matches what the user can see in the script.
        expect(value('<element[5].add[<[t]>]>')).toEqual({ kind: 'needs-input', inputs: ['[t]'] });
    });

    it('asks for the whole value, not the object it is read from', () => {
        // Real line from the user's scripts. An earlier version asked for `members` here and would
        // then have choked on `.size` whatever number was typed -- promising an evaluation it
        // could not deliver. The value needed is the SIZE.
        // MUTANT CAUGHT: naming only the base part of a non-element chain.
        expect(value('<[members].size.div[3]>'))
            .toEqual({ kind: 'needs-input', inputs: ['[members].size'] });
    });

    it('asks for server state, naming the whole tag that produces it', () => {
        // `player.health` is ONE value, not a `player` with `health` applied. Splitting it would
        // ask the user for something that is not a thing.
        // MUTANT CAUGHT: naming only the first part.
        expect(value('<player.health.add[5]>')).toEqual({ kind: 'needs-input', inputs: ['player.health'] });
        expect(value('<server.flag[money].mul[2]>')).toEqual({ kind: 'needs-input', inputs: ['server.flag[money]'] });
    });

    it('collects EVERY missing input in one pass', () => {
        // Asking for one, then being asked for another, then another is a miserable way to fill in
        // three placeholders.
        // MUTANT CAUGHT: stopping at the first unresolved operand.
        expect(value('<element[<[a]>].add[<[b]>].mul[<[c]>]>'))
            .toEqual({ kind: 'needs-input', inputs: ['[a]', '[b]', '[c]'] });
    });

    it('uses supplied values once given', () => {
        const supplied = new Map([['[t]', 4]]);
        expect(evaluateMathTag('<element[5].add[<[t]>]>', supplied)).toMatchObject({ value: 9 });
    });

    it('evaluates once a read-from value is supplied', () => {
        const supplied = new Map([['[members].size', 7]]);
        expect(evaluateMathTag('<[members].size.div[2]>', supplied)).toMatchObject({ value: 3.5 });
    });

    it('supplies server state the same way', () => {
        const supplied = new Map([['player.health', 20]]);
        expect(evaluateMathTag('<player.health.div[2]>', supplied)).toMatchObject({ value: 10 });
    });

    it('reports a non-arithmetic tag as unsupported rather than as a number', () => {
        expect(value('<player.name>').kind).toBe('unsupported');
        expect(value('<element[hello].to_uppercase>').kind).toBe('unsupported');
        expect(value('').kind).toBe('unsupported');
    });

    it('reports an undefined result rather than printing NaN', () => {
        // "Null for negative numbers" -- the server returns null, and printing "NaN" would imply
        // it prints that too.
        // MUTANT CAUGHT: letting NaN through as a value.
        expect(value('<element[-9].sqrt>').kind).toBe('unsupported');
    });
});

describe('formatNumber: not implying precision the server may not share', () => {
    it('shows an integer plainly', () => {
        expect(formatNumber(8)).toEqual({ display: '8', rounded: false });
        expect(formatNumber(-5)).toEqual({ display: '-5', rounded: false });
    });

    it('collapses the classic double artefact and SAYS it rounded', () => {
        // 0.1 + 0.2 is 0.30000000000000004 in IEEE doubles and 0.3 in BigDecimal. Which one
        // Denizen prints cannot be established from anything this repo has, so the display is the
        // clean form and `rounded` is what stops it being a silent claim.
        // MUTANT CAUGHT: reporting rounded: false, which would hide the difference entirely.
        expect(formatNumber(0.1 + 0.2)).toEqual({ display: '0.3', rounded: true });
    });

    it('marks an irrational result as rounded too', () => {
        const formatted = formatNumber(1 / 3);
        expect(formatted.rounded).toBe(true);
        expect(formatted.display.startsWith('0.3333')).toBe(true);
    });

    it('does not claim rounding for a decimal that is exact', () => {
        expect(formatNumber(0.5)).toEqual({ display: '0.5', rounded: false });
        expect(formatNumber(2.25)).toEqual({ display: '2.25', rounded: false });
    });

    it('carries the rounding flag out through the result', () => {
        const result = evaluateMathTag('<element[0.1].add[0.2]>');
        expect(result).toMatchObject({ kind: 'value', display: '0.3', rounded: true });
    });
});

describe('looksArithmetic', () => {
    it('recognises an expression worth offering to evaluate', () => {
        expect(looksArithmetic('<element[5].add[3]>')).toBe(true);
        expect(looksArithmetic('<player.health.mul[2]>')).toBe(true);
    });

    it('says no to a tag with no arithmetic in it', () => {
        // Not a failed evaluation -- simply not this feature's business, and saying nothing is the
        // right answer for it.
        expect(looksArithmetic('<player.name>')).toBe(false);
        expect(looksArithmetic('<list[a|b].size>')).toBe(false);
    });

    it('covers every operation the evaluator implements', () => {
        // MUTANT CAUGHT: adding an operation to one table and forgetting the other.
        for (const op of SUPPORTED_OPERATIONS) {
            expect(looksArithmetic(`<element[4].${op}[2]>`), op).toBe(true);
        }
    });
});
