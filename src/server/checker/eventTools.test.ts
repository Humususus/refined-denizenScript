import { describe, it, expect } from 'vitest';
import { separateSwitches, isOnlyDigits } from './eventTools';
import { MetaDataValue, MetaDocs, createEmptyMetaDocs } from '../metaDocs/metaTypes';

/**
 * Derived from SharpDenizenTools/ScriptAnalysis/EventTools.cs:16-41.
 *
 * `separateSwitches` splits an event line into the event itself and its switches. Getting it wrong
 * in either direction is a visible bug: eat too much and a real event word becomes a switch, so the
 * event stops being found at all; eat too little and a legitimate switch is checked as if it were
 * part of the event name.
 */

/** Docs carrying a `not_switches` set, as the real meta does. */
function docsWithNotSwitches(...values: string[]): MetaDocs {
    const docs = createEmptyMetaDocs();
    const data = new MetaDataValue();
    data.applyValue('name', 'not_switches');
    data.applyValue('values', values.join(','));
    data.addTo(docs);
    return docs;
}

describe('isOnlyDigits (EventTools.cs:16, AsciiMatcher)', () => {
    it('accepts a run of digits and rejects anything else', () => {
        expect(isOnlyDigits('0123456789')).toBe(true);
        expect(isOnlyDigits('12a')).toBe(false);
        expect(isOnlyDigits('a')).toBe(false);
        expect(isOnlyDigits('1.2')).toBe(false);
    });

    it('is VACUOUSLY TRUE on the empty string', () => {
        // AsciiMatcher.IsOnlyMatches loops the characters and returns true having found no failure.
        // This is not a curiosity: it is what decides a word starting with a colon in
        // separateSwitches, where the part before the colon is ''.
        // MUTANT CAUGHT: `text.length > 0 && ...`, which would flip `:value` into a switch.
        expect(isOnlyDigits('')).toBe(true);
    });

    it('rejects non-ASCII digits', () => {
        // AsciiMatcher is ASCII by construction. Arabic-Indic digits are not 0-9.
        // MUTANT CAUGHT: using a Unicode-aware /^\d*$/u or Number.isInteger.
        expect(isOnlyDigits('٤٢')).toBe(false);
    });
});

describe('separateSwitches (EventTools.cs:23-41)', () => {
    it('leaves a switch-free line untouched and returns no switches', () => {
        const result = separateSwitches(createEmptyMetaDocs(), 'player breaks block');
        expect(result.cleaned).toBe('player breaks block');
        expect(result.switches).toEqual([]);
    });

    it('pulls a switch out of the line', () => {
        const result = separateSwitches(createEmptyMetaDocs(), 'player breaks block priority:5');
        expect(result.cleaned).toBe('player breaks block');
        expect(result.switches).toEqual([{ key: 'priority', value: '5' }]);
    });

    it('pulls a switch out of the MIDDLE without leaving a double space', () => {
        // EventTools.cs:37 appends word + ' ' and trims once at the end, so removed words leave no
        // gap. A double space here would produce an empty word and break the length comparison
        // against the could-matchers.
        // MUTANT CAUGHT: rebuilding the line with parts.join(' ') over the original array.
        const result = separateSwitches(createEmptyMetaDocs(), 'player cancelled:true breaks block');
        expect(result.cleaned).toBe('player breaks block');
        expect(result.cleaned.split(' ').length).toBe(3);
    });

    it('lowercases the switch NAME but not the VALUE', () => {
        // Callers compare names to literals, but `bad_switch_value` reports the value back to the
        // user, who should see what they typed.
        // MUTANT CAUGHT: folding the value too.
        const result = separateSwitches(createEmptyMetaDocs(), 'player breaks PRIORITY:HighValue');
        expect(result.switches).toEqual([{ key: 'priority', value: 'HighValue' }]);
    });

    it('folds the switch name with the ASCII rule only', () => {
        // MUTANT CAUGHT: toLowerFast -> toLowerCase.
        const result = separateSwitches(createEmptyMetaDocs(), 'player breaks КЛЮЧ:x');
        expect(result.switches[0].key).toBe('КЛЮЧ');
    });

    it('splits on the FIRST colon, so a value may contain colons', () => {
        const result = separateSwitches(createEmptyMetaDocs(), 'player breaks flagged:a:b:c');
        expect(result.switches).toEqual([{ key: 'flagged', value: 'a:b:c' }]);
    });

    it('does NOT treat a word in the not_switches set as a switch', () => {
        // The whole reason that data set exists: `item_flagged:cool` is part of the event line, and
        // reading it as a switch named `item_flagged` would make the event unfindable.
        // MUTANT CAUGHT: dropping the not_switches test, or negating it.
        const docs = docsWithNotSwitches('item_flagged', 'regex');
        const result = separateSwitches(docs, 'player breaks item_flagged:cool');
        expect(result.cleaned).toBe('player breaks item_flagged:cool');
        expect(result.switches).toEqual([]);
    });

    it('still treats an ordinary switch as one when a not_switches set exists', () => {
        const docs = docsWithNotSwitches('item_flagged');
        const result = separateSwitches(docs, 'player breaks item_flagged:cool priority:5');
        expect(result.cleaned).toBe('player breaks item_flagged:cool');
        expect(result.switches).toEqual([{ key: 'priority', value: '5' }]);
    });

    it('does NOT treat an all-digits prefix as a switch', () => {
        // `3:4` is a value, not a switch named `3`.
        // MUTANT CAUGHT: dropping the digits test.
        const result = separateSwitches(createEmptyMetaDocs(), 'something 3:4');
        expect(result.cleaned).toBe('something 3:4');
        expect(result.switches).toEqual([]);
    });

    it('does NOT treat a leading colon as a switch, via the empty-string digits case', () => {
        // `:value` has '' before the colon, and isOnlyDigits('') is true. This is the one place
        // that vacuous truth is observable.
        // MUTANT CAUGHT: making isOnlyDigits('') false.
        const result = separateSwitches(createEmptyMetaDocs(), 'something :value');
        expect(result.cleaned).toBe('something :value');
        expect(result.switches).toEqual([]);
    });

    it('treats a mixed digit-and-letter prefix as a switch', () => {
        // isOnlyDigits is all-or-nothing, so `p2:x` IS a switch.
        expect(separateSwitches(createEmptyMetaDocs(), 'x p2:y').switches).toEqual([{ key: 'p2', value: 'y' }]);
    });

    it('accepts a switch with an empty value', () => {
        // `flagged:` splits to ('flagged', ''), which the value checks then judge on their own.
        expect(separateSwitches(createEmptyMetaDocs(), 'x flagged:').switches).toEqual([{ key: 'flagged', value: '' }]);
    });

    it('collects several switches in order', () => {
        const result = separateSwitches(createEmptyMetaDocs(), 'player breaks priority:5 cancelled:true in:world');
        expect(result.cleaned).toBe('player breaks');
        expect(result.switches).toEqual([
            { key: 'priority', value: '5' },
            { key: 'cancelled', value: 'true' },
            { key: 'in', value: 'world' }
        ]);
    });

    it('returns an empty cleaned line when the whole input was switches', () => {
        const result = separateSwitches(createEmptyMetaDocs(), 'priority:5');
        expect(result.cleaned).toBe('');
        expect(result.switches.length).toBe(1);
    });
});
