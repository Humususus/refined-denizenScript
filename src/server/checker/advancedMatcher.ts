// Ported in full from SharpDenizenTools/ScriptAnalysis/AdvancedMatcher.cs (192 lines).
// This module must stay dependency-free: no `vscode-languageserver` import, no I/O. Its one
// import is ./frenetic, which is itself import-free.
//
// WHAT THIS IS. Denizen lets a script say "any of these" wherever a single name would do:
//     on player breaks stone|dirt|*_log:
//     on player right clicks !armor_stand:
//     on entity spawns regex:zombie|skeleton:
// The engine has a small matcher language for that, and this file is a replica of it. Everything
// downstream in the event-matching stack -- the `<block>`/`<item>`/`<entity>` validators in
// ./eventValidators, and through those every could-matcher -- asks `isAdvancedMatchable` whether
// a word is one of these patterns before deciding what it is allowed to conclude about it.
//
// The C# names each helper after the SHAPE it was built from rather than what it does, and two of
// those names read backwards (see `PrefixAsteriskMatchHelper`). The names are kept anyway, so that
// this file diffs cleanly against the C#.

import { toLowerFast } from './frenetic';

/**
 * Entry point for the replica of the Denizen advanced matcher engine.
 * (AdvancedMatcher.cs:15-19, `MatchHelper`)
 */
export abstract class MatchHelper {
    /** True if the text is a match, otherwise false. (AdvancedMatcher.cs:18) */
    abstract doesMatch(input: string): boolean;
}

/** Matches anything at all -- built from a bare `*`. (AdvancedMatcher.cs:22-26) */
export class AlwaysMatchHelper extends MatchHelper {
    doesMatch(_input: string): boolean {
        return true;
    }
}

/** Matches one exact word, case-insensitively. (AdvancedMatcher.cs:29-37) */
export class ExactMatchHelper extends MatchHelper {
    text: string;

    constructor(text: string) {
        super();
        this.text = toLowerFast(text);
    }

    doesMatch(input: string): boolean {
        return this.text === toLowerFast(input);
    }
}

/**
 * Built from `*text`, and therefore matches input that ENDS WITH the text.
 * (AdvancedMatcher.cs:40-48)
 *
 * The name is the C#'s and it reads backwards: "prefix asterisk" describes where the asterisk
 * sits in the pattern, not what the match tests. `*_log` matches `oak_log`. Renaming it to
 * something honest would make every future diff against AdvancedMatcher.cs need a translation
 * step, so it keeps the name it has.
 */
export class PrefixAsteriskMatchHelper extends MatchHelper {
    text: string;

    constructor(text: string) {
        super();
        this.text = toLowerFast(text);
    }

    doesMatch(input: string): boolean {
        return toLowerFast(input).endsWith(this.text);
    }
}

/** Built from `text*`, so it matches input that STARTS WITH the text. (AdvancedMatcher.cs:51-59) */
export class PostfixAsteriskMatchHelper extends MatchHelper {
    text: string;

    constructor(text: string) {
        super();
        this.text = toLowerFast(text);
    }

    doesMatch(input: string): boolean {
        return toLowerFast(input).startsWith(this.text);
    }
}

/**
 * Built from a pattern with asterisks in the middle, e.g. `a*b*c`. (AdvancedMatcher.cs:62-92)
 *
 * NOTE this one does NOT fold its own texts, unlike the three above: `createMatcher` hands it
 * `toLowerFast(input).split('*')`, already folded. Folding again here would be harmless today and
 * wrong the moment anything else constructs it directly, so it is left exactly as the C# has it.
 */
export class MultipleAsteriskMatchHelper extends MatchHelper {
    texts: string[];

    constructor(texts: string[]) {
        super();
        this.texts = texts;
    }

    doesMatch(input: string): boolean {
        // AdvancedMatcher.cs:71-76: the ends are checked up front. For `a*c` against `abc` this is
        // already the whole answer; the scan below is what handles the middle segments.
        let index = 0;
        input = toLowerFast(input);
        if (!input.startsWith(this.texts[0]) || !input.endsWith(this.texts[this.texts.length - 1])) {
            return false;
        }
        // AdvancedMatcher.cs:77-89: each segment must appear AFTER the previous one ended, which is
        // what makes `a*b*c` reject `a_c_b_d`. The resumed `indexOf` is load-bearing.
        //
        // The empty-segment skip is NOT: it is an EQUIVALENT MUTANT, MEASURED. Empty segments come
        // from `**` or a leading/trailing `*`, and `indexOf('', i)` returns `i` unchanged, then
        // advances by 0 -- exactly what skipping does. Removing the guard changed nothing across
        // 73,660 (pattern, input) pairs: every pattern of length 1-5 over `a b * ! |` that reaches
        // this helper, against every input of length 0-6 over `a b`. It is kept because the C# has
        // it, and because the reader who deletes it deserves to find this note rather than repeat
        // the measurement.
        for (const text of this.texts) {
            if (text.length === 0) {
                continue;
            }
            index = input.indexOf(text, index);
            if (index === -1) {
                return false;
            }
            index += text.length;
        }
        return true;
    }
}

/**
 * Built from `regex:...`. (AdvancedMatcher.cs:95-103)
 *
 * The C# compiles with `RegexOptions.IgnoreCase` and tests with `Regex.IsMatch`, which is an
 * UNANCHORED search -- `regex:log` matches `oak_log`. `RegExp.test` is the same, so the `i` flag
 * is the whole translation.
 *
 * KNOWN LIMIT, not a deviation: .NET and JavaScript disagree on some regex syntax (balancing
 * groups, `\p{...}` spellings, some inline options). A pattern .NET accepts and JavaScript does
 * not throws here, exactly where the C# would have succeeded. Both engines throw at CONSTRUCTION
 * on a pattern they reject, so the failure lands in the same place either way -- the script
 * checker's per-container try/catch (ScriptChecker.cs:1321), reported as `exception_internal`.
 * Closing this gap would mean shipping a .NET regex engine, which is not worth it for the handful
 * of scripts that could hit it.
 */
export class RegexMatchHelper extends MatchHelper {
    pattern: RegExp;

    constructor(regex: string) {
        super();
        this.pattern = new RegExp(regex, 'i');
    }

    doesMatch(input: string): boolean {
        return this.pattern.test(input);
    }
}

/** Built from `a|b|c` -- matches if ANY sub-matcher does. (AdvancedMatcher.cs:106-124) */
export class MultipleMatchesHelper extends MatchHelper {
    matches: MatchHelper[];

    constructor(matches: MatchHelper[]) {
        super();
        this.matches = matches;
    }

    doesMatch(input: string): boolean {
        for (const match of this.matches) {
            if (match.doesMatch(input)) {
                return true;
            }
        }
        return false;
    }
}

/** Built from `!...` -- inverts whatever follows. (AdvancedMatcher.cs:127-135) */
export class InverseMatchHelper extends MatchHelper {
    matcher: MatchHelper;

    constructor(matcher: MatchHelper) {
        super();
        this.matcher = matcher;
    }

    doesMatch(input: string): boolean {
        return !this.matcher.doesMatch(input);
    }
}

/**
 * Whether the text uses the advanced matcher system at all.
 * (AdvancedMatcher.cs:138-141)
 *
 * This is the gate the event validators lean on hardest. A word that IS advanced-matchable can no
 * longer be checked against a list of known blocks or items -- `*_log` is not in any enum -- so the
 * validators answer "plausible" for it instead of "wrong". Widening this predicate therefore
 * SILENCES checks, and narrowing it invents false positives on legitimate patterns.
 */
export function isAdvancedMatchable(input: string): boolean {
    return input.startsWith('regex:') || input.includes('|') || input.includes('*') || input.startsWith('!');
}

/**
 * Creates a valid matcher out of the given text. (AdvancedMatcher.cs:144-190)
 *
 * The branch ORDER is the specification. `!` is stripped first, so `!a|b` is "not (a or b)" and
 * not "(not a) or b". `regex:` outranks `|` and `*`, so a regex is never split on its own
 * alternation or quantifier. Only then do the asterisk shapes get considered.
 */
export function createMatcher(input: string): MatchHelper {
    // AdvancedMatcher.cs:148-151
    if (input.startsWith('!')) {
        return new InverseMatchHelper(createMatcher(input.substring(1)));
    }
    // AdvancedMatcher.cs:152-155
    if (input.startsWith('regex:')) {
        return new RegexMatchHelper(input.substring('regex:'.length));
    }
    // AdvancedMatcher.cs:156-165
    if (input.includes('|')) {
        return new MultipleMatchesHelper(input.split('|').map(createMatcher));
    }
    const asterisk = input.indexOf('*');
    if (asterisk !== -1) {
        // AdvancedMatcher.cs:168-171: reached only when the input IS a lone `*`, since we are
        // already inside the "contains an asterisk" branch.
        if (input.length === 1) {
            return new AlwaysMatchHelper();
        }
        // AdvancedMatcher.cs:172-175: a single leading asterisk and no other.
        if (asterisk === 0 && input.indexOf('*', 1) === -1) {
            return new PrefixAsteriskMatchHelper(input.substring(1));
        }
        // AdvancedMatcher.cs:176-179, kept after the leading-asterisk case to match the C#.
        //
        // THE ORDER OF THESE TWO IS AN EQUIVALENT MUTANT, MEASURED. Swapping them changes nothing:
        // both conditions can only hold at once when the asterisk is simultaneously at index 0 and
        // at the end, i.e. for the single input `*` -- which the `input.length === 1` case above
        // has already taken. A sweep of all 3905 patterns of length 1-5 over the alphabet
        // `a b * ! |` found 0 differences in the shape chosen. Left in the C#'s order anyway, since
        // "the C# is the specification" costs nothing here and a future reader diffing the two
        // files should not have to re-derive this.
        if (asterisk === input.length - 1) {
            return new PostfixAsteriskMatchHelper(input.substring(0, input.length - 1));
        }
        // AdvancedMatcher.cs:180-183
        return new MultipleAsteriskMatchHelper(toLowerFast(input).split('*'));
    }
    // AdvancedMatcher.cs:185-188
    return new ExactMatchHelper(input);
}
