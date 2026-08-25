import { describe, it, expect } from 'vitest';
import { ScriptChecker } from './scriptChecker';
import { containsObjectNotation, ScriptCheckContext, checkSingleArgument, checkSingleDataLine, checkSingleTag } from './tagChecks';
import { buildMetaDocs } from '../metaDocs/metaDocsManager';
import { linkTypeGraph } from '../metaDocs/metaLinker';
import type { MetaDocs } from '../metaDocs/metaTypes';
import type { MetaBlock } from '../metaDocs/metaLoader';

import type { ScriptWarning } from './scriptWarnings';

/** Fixture builder, same shape as tagTracer.test.ts's. */
function type(name: string, base: string, extra: string[] = []): MetaBlock {
    return {
        objectType: 'objecttype',
        url: 'src#L1',
        data: ['@name ' + name, '@prefix ' + name.toLowerCase(), '@base ' + base, '@format x', '@description x', ...extra, '@end_meta']
    };
}

/**
 * Every expectation in this file was hand-derived by reading
 * SharpDenizenTools/ScriptAnalysis/ScriptChecker.cs. Character indices are counted by hand off
 * the literal fixture strings, never read back out of the implementation.
 */

describe('containsObjectNotation (ScriptChecker.cs:1343-1362)', () => {
    it('finds a simple object notation and returns the letter..@ range', () => {
        // :1350-1354. `first` is the index of the LETTER, `last` the index of the '@'.
        // MUTANT CAUGHT: returning the '@' index as the start -- the squiggle would miss the
        // type letter, which is the whole thing being complained about.
        expect(containsObjectNotation('e@1234')).toEqual({ start: 0, end: 1 });
        expect(containsObjectNotation('p@bob')).toEqual({ start: 0, end: 1 });
    });

    it('returns null when there is no "@" at all', () => {
        expect(containsObjectNotation('narrate hello')).toBeNull();
    });

    it('ignores an "@" at index 0 -- there is no letter before it', () => {
        // :1350's `atIndex > 0` guard.
        // MUTANT CAUGHT: dropping the guard, which reads line[-1] (undefined in JS, an
        // IndexOutOfRange in C#) and so behaves differently in the two languages.
        expect(containsObjectNotation('@nothing')).toBeNull();
    });

    it('only accepts the fifteen letters that actually start an object type', () => {
        // OBJECT_NOTATION_LAST_LETTER_MATCHER is the literal string "mdlipqsebhounwr"
        // (:1338) -- the last letter of every real ObjectTag prefix. Transcribed character by
        // character, not from memory.
        // MUTANT CAUGHT: accepting any letter, which would flag every email address and every
        // `@` in a piece of prose.
        for (const ch of 'mdlipqsebhounwr') {
            expect(containsObjectNotation(`${ch}@x`), ch).toEqual({ start: 0, end: 1 });
        }
        for (const ch of 'acfgjktvxyz') {
            expect(containsObjectNotation(`${ch}@x`), ch).toBeNull();
        }
    });

    it('is CASE SENSITIVE, so an uppercase letter does not match', () => {
        // The C# matcher is built from a lowercase-only string and AsciiMatcher does not fold
        // case. `E@1` is therefore not flagged.
        // MUTANT CAUGHT: lowercasing the input, or using a case-insensitive test.
        expect(containsObjectNotation('E@1')).toBeNull();
        expect(containsObjectNotation('M@1')).toBeNull();
    });

    it('spans from the FIRST match to the LAST across several notations', () => {
        // :1352-1353 are Math.Min/Math.Max across every '@' in the line, so the range covers
        // everything between the first and last, including whatever sits in the middle.
        // 'e@1 l@2': e0 @1 space2 l3 @4... let me count -- e=0, @=1, 1=2, ' '=3, l=4, @=5.
        // MUTANT CAUGHT: returning the range of the LAST match only, or of the first only.
        expect(containsObjectNotation('e@1 l@2')).toEqual({ start: 0, end: 5 });
    });

    it('takes the widest range even when the later match is not the widest', () => {
        // Guards the Math.Min specifically: a qualifying '@' early and another later must widen
        // in both directions independently.
        expect(containsObjectNotation('zzz m@a d@b')).toEqual({ start: 4, end: 9 });
    });

    it('ignores non-qualifying "@"s while still reporting the qualifying ones', () => {
        // 'a@1 e@2': a=0 @=1 (a is not in the set, skipped), ' '=3, e=4, @=5.
        // MUTANT CAUGHT: letting a non-qualifying '@' widen `last`, which it must not.
        expect(containsObjectNotation('a@1 e@2')).toEqual({ start: 4, end: 5 });
    });

    it('flags an ordinary email address (C# QUIRK, ported verbatim)', () => {
        // 'someone@example.com': the character before '@' is 'e', which IS in the set, so this
        // reads as object notation. The C# has the same behaviour, and `CheckSingleArgument`
        // only consults it when `!isCommand` (:578), which limits the blast radius rather than
        // removing it.
        // Pinned so the quirk is a known, deliberate state rather than a surprise later.
        expect(containsObjectNotation('someone@example.com')).toEqual({ start: 6, end: 7 });
    });
});

describe('ScriptCheckContext (ScriptChecker.cs:772-785)', () => {
    it('starts with two empty sets and both unknowable flags false', () => {
        // The flags default false; `CheckAllContainers` sets them when the script has injects
        // it cannot resolve, and `CheckSingleTag` (:451, :463) reads them to suppress
        // def_of_nothing / entry_of_nothing entirely rather than emit a screen of false
        // positives.
        // MUTANT CAUGHT: defaulting either flag to true, which silences the checks the whole
        // phase exists to enable.
        const context = new ScriptCheckContext();
        expect(context.definitions.size).toBe(0);
        expect(context.saveEntries.size).toBe(0);
        expect(context.hasUnknowableDefinitions).toBe(false);
        expect(context.hasUnknowableSaveEntries).toBe(false);
    });

    it('gives each instance its own sets, not shared ones', () => {
        // A class field initialised to a shared literal would leak one container's definitions
        // into the next -- and CheckAllContainers builds one context per script key.
        // MUTANT CAUGHT: hoisting the sets to module scope or a prototype property.
        const a = new ScriptCheckContext();
        const b = new ScriptCheckContext();
        a.definitions.add('mine');
        expect(b.definitions.size).toBe(0);
    });
});

/**
 * Phase 2C-4 Task 3: `checkSingleArgument` (ScriptChecker.cs:576-624) and
 * `checkSingleDataLine` (:630-637).
 *
 * These fixtures use a checker with NO meta. `checkSingleTag` is Task 4 and is stubbed as a
 * collector here, so the tag EXTRACTION can be asserted -- offsets and all -- without dragging
 * in tag resolution. That separation is the point: the extraction loop at :595-623 is pure index
 * arithmetic and is where an off-by-one would hide.
 */
function argChecker(): ScriptChecker {
    return new ScriptChecker('- narrate placeholder');
}

/** Compact shape for asserting on a warning. */
function argShape(w: ScriptWarning): { line: number; key: string; start: number; end: number } {
    return { line: w.line, key: w.warningUniqueKey, start: w.startChar, end: w.endChar };
}

/** Runs checkSingleArgument with the tag handler replaced by a collector. */
function extractTags(line: number, startChar: number, argument: string, isCommand = false) {
    const checker = argChecker();
    const seen: { startChar: number; tag: string }[] = [];
    checkSingleArgument(checker, line, startChar, argument, null, isCommand, (l, s, t) => seen.push({ startChar: s, tag: t }));
    return { checker, seen };
}

describe('checkSingleArgument: raw object notation (ScriptChecker.cs:578-587)', () => {
    it('warns for object notation in a non-command argument', () => {
        // Range comes from containsObjectNotation, offset by startChar.
        const { checker } = extractTags(3, 10, 'e@1234');
        expect(checker.warnings.map(argShape)).toEqual([{ line: 3, key: 'raw_object_notation', start: 10, end: 11 }]);
    });

    it('does NOT warn when the argument IS a command', () => {
        // :578's `&& !isCommand`. A command's own name and arguments are checked elsewhere, and
        // flagging them here would double-report.
        // MUTANT CAUGHT: dropping the isCommand test.
        const { checker } = extractTags(0, 0, 'e@1234', true);
        expect(checker.warnings).toEqual([]);
    });

    it('does not even look when there is no "@" in the argument', () => {
        // :578's `argument.Contains('@')` short-circuit.
        const { checker } = extractTags(0, 0, 'plain text');
        expect(checker.warnings).toEqual([]);
    });
});

describe('checkSingleArgument: uneven tag marks (ScriptChecker.cs:588-594)', () => {
    it('warns when "<" and ">" counts differ, spanning the first to the last mark', () => {
        // Range is IndexOfAny/LastIndexOfAny over `argument` (:591-592), while the COUNT is over
        // `argNoArrows` (:589) -- two different strings, deliberately.
        // 'a <b c': '<' at 2, no '>' -> counts differ. First and last mark are both index 2.
        const { checker } = extractTags(1, 0, 'a <b c');
        expect(checker.warnings.map(argShape)).toEqual([{ line: 1, key: 'uneven_tags', start: 2, end: 2 }]);
    });

    it('does NOT warn for balanced marks', () => {
        const { checker } = extractTags(0, 0, 'a <player.name> b');
        expect(checker.warnings.filter(w => w.warningUniqueKey === 'uneven_tags')).toEqual([]);
    });

    it('takes its RANGE from the original argument even though it COUNTS on argNoArrows', () => {
        // :589-592 deliberately reads two different strings: the count is over `argNoArrows`
        // (so `<-` does not inflate it) but IndexOfAny/LastIndexOfAny are over `argument` (so
        // the squiggle lands on the text the user actually wrote).
        //
        // Isolating that needs an input where the two strings put their tag marks in DIFFERENT
        // PLACES, which only happens when a `<-` is present: '<- <a' is '<' at 0 and 3, but
        // 'al <a' has only the one at 3. Every earlier fixture had `argument === argNoArrows`,
        // so reading the range off the wrong string survived. Confirmed by mutation.
        //
        // MUTANT CAUGHT: taking the range from argNoArrows -- it becomes 3-3 instead of 0-3.
        const { checker } = extractTags(0, 0, '<- <a');
        expect(checker.warnings.map(argShape)).toEqual([{ line: 0, key: 'uneven_tags', start: 0, end: 3 }]);
    });

    it('is gated on length > 2, so a bare "<" is not reported', () => {
        // :589's `argument.Length > 2`. A two-character argument cannot hold a real tag.
        // MUTANT CAUGHT: dropping the length gate -- '<' alone would warn.
        expect(extractTags(0, 0, '<').checker.warnings).toEqual([]);
        expect(extractTags(0, 0, '<a').checker.warnings).toEqual([]);
    });

    it('treats "<-" as two ordinary characters, not an open tag mark', () => {
        // :588 rewrites `<-` to `al` BEFORE counting, because `<-` is a Denizen operator and
        // would otherwise read as an unclosed tag on every line that uses it.
        // MUTANT CAUGHT: dropping the `<-` substitution -- this warns.
        expect(extractTags(0, 0, 'foo <- bar').checker.warnings).toEqual([]);
    });

    it('treats ":->" the same way', () => {
        // :588's second substitution, `:->` to `arr`.
        // MUTANT CAUGHT: dropping it.
        expect(extractTags(0, 0, 'foo :-> bar').checker.warnings).toEqual([]);
    });

    it('keeps offsets correct because both substitutions are LENGTH-PRESERVING', () => {
        // `<-` (2 chars) becomes `al` (2), `:->` (3) becomes `arr` (3). Every index below :588
        // is into argNoArrows, so a substitution that changed the length would silently shift
        // every tag offset in the argument.
        // MUTANT CAUGHT: replacing `<-` with '' or with a single character -- the extracted tag
        // offset moves.
        const { seen } = extractTags(0, 0, 'a <- <player.name>');
        expect(seen).toEqual([{ startChar: 6, tag: 'player.name' }]);
    });
});

describe('checkSingleArgument: tag extraction (ScriptChecker.cs:595-623)', () => {
    it('extracts a single tag with the offset of its first character INSIDE the "<"', () => {
        // :621 passes `startChar + tagIndex + 1`, so the offset points at the tag TEXT, not at
        // the '<'. Every range checkSingleTag reports is relative to that.
        // MUTANT CAUGHT: passing tagIndex without the +1.
        expect(extractTags(0, 0, '<player.name>').seen).toEqual([{ startChar: 1, tag: 'player.name' }]);
    });

    it('adds the caller startChar to the tag offset', () => {
        expect(extractTags(0, 100, 'x <player.name>').seen).toEqual([{ startChar: 103, tag: 'player.name' }]);
    });

    it('extracts several tags from one argument', () => {
        // 'a<b>c<d>': '<' at 1 -> tag 'b' at 2; next '<' at 5 -> tag 'd' at 6.
        expect(extractTags(0, 0, 'a<b>c<d>').seen).toEqual([
            { startChar: 2, tag: 'b' },
            { startChar: 6, tag: 'd' }
        ]);
    });

    it('extracts the OUTER tag only for a nested tag, and the bracket counter is why', () => {
        // :598-615 counts '<' and '>' and stops at the one that returns the depth to zero. The
        // inner tag is part of the outer tag's text; checkSingleTag re-enters for the parameter.
        // MUTANT CAUGHT: stopping at the first '>' -- the extracted text would be truncated to
        // 'player.flag[<[x]' and the rest of the line re-scanned as garbage.
        expect(extractTags(0, 0, '<player.flag[<[x]>]>').seen).toEqual([
            { startChar: 1, tag: 'player.flag[<[x]>]' }
        ]);
    });

    it('stops the scan at an unclosed tag rather than looping', () => {
        // :616-619 breaks when no closing mark is found. The tag before it was already reported.
        // MUTANT CAUGHT: continuing the scan, which never terminates or misreports.
        expect(extractTags(0, 0, '<a> <b').seen).toEqual([{ startChar: 1, tag: 'a' }]);
    });

    it('finds nothing in an argument with no tags', () => {
        expect(extractTags(0, 0, 'just some words').seen).toEqual([]);
    });

    it('resumes the scan AFTER the closing mark, not one character on', () => {
        // :622's `IndexOf('<', endIndex)`. Starting from `tagIndex + 1` instead would re-enter
        // the tag just consumed and report its inner tag a second time.
        // MUTANT CAUGHT: resuming from tagIndex + 1.
        expect(extractTags(0, 0, '<a[<b>]> <c>').seen).toEqual([
            { startChar: 1, tag: 'a[<b>]' },
            { startChar: 10, tag: 'c' }
        ]);
    });
});

describe('checkSingleDataLine (ScriptChecker.cs:630-637)', () => {
    it('warns invalid_data_line_quotes as a MINOR warning for a double-quoted data line', () => {
        // :632-635. The list is MinorWarnings (Information severity), not Warnings.
        // MUTANT CAUGHT: routing it to `warnings` -- a style nit would get a yellow squiggle.
        const checker = argChecker();
        checkSingleDataLine(checker, 2, 5, 'some "quoted" text', null);
        expect(checker.minorWarnings.map(argShape)).toEqual([
            { line: 2, key: 'invalid_data_line_quotes', start: 5, end: 23 }
        ]);
        expect(checker.warnings).toEqual([]);
    });

    it('warns for a line STARTING with a single quote, but not one merely containing it', () => {
        // :632 is `Contains('"') || StartsWith('\'')` -- asymmetric, and deliberately so: an
        // apostrophe inside a word is ordinary text.
        // MUTANT CAUGHT: making both tests `Contains`, which flags every "don't".
        const starts = argChecker();
        checkSingleDataLine(starts, 0, 0, "'quoted'", null);
        expect(starts.minorWarnings.length).toBe(1);
        const inside = argChecker();
        checkSingleDataLine(inside, 0, 0, "don't", null);
        expect(inside.minorWarnings).toEqual([]);
    });

    it('still runs the argument checks underneath', () => {
        // :636 -- a data line is also an argument, and gets the same tag and notation checks.
        // MUTANT CAUGHT: returning early after the quote warning.
        const checker = argChecker();
        checkSingleDataLine(checker, 0, 0, 'e@1234', null);
        expect(checker.warnings.map(argShape)).toEqual([{ line: 0, key: 'raw_object_notation', start: 0, end: 1 }]);
    });
});

/**
 * Phase 2C-4 Task 4: `checkSingleTag` (ScriptChecker.cs:426-525).
 *
 * These tests use a HAND-BUILT meta fixture rather than live meta. The plan asked for real meta
 * for the base/part tests, and the live verification script (Task 6) does exactly that -- but a
 * unit test asserting "bad_tag_base does not fire for <player.name>" against 2493 downloaded tags
 * proves the network worked, not that the branch is right. The fixture here is small enough that
 * every expectation can be derived by reading it.
 */
function tagDocs(): MetaDocs {
    const d = buildMetaDocs([
        type('ObjectTag', 'none'),
        type('ElementTag', 'ObjectTag'),
        type('PlayerTag', 'ElementTag'),
        { objectType: 'tag', url: 'src#L1', data: ['@attribute <player>', '@returns PlayerTag', '@description x', '@end_meta'] },
        { objectType: 'tag', url: 'src#L1', data: ['@attribute <PlayerTag.name>', '@returns ElementTag', '@description x', '@end_meta'] },
        { objectType: 'tag', url: 'src#L1', data: ['@attribute <definition[<name>]>', '@returns ObjectTag', '@description x', '@end_meta'] },
        { objectType: 'tag', url: 'src#L1', data: ['@attribute <entry[<name>].thing>', '@returns ObjectTag', '@description x', '@end_meta'] },
        // A base whose name ends in "tag": the xtag_notation trigger at :441.
        { objectType: 'tag', url: 'src#L1', data: ['@attribute <sometag>', '@returns ObjectTag', '@description x', '@end_meta'] }
    ]);
    linkTypeGraph(d);
    return d;
}
const TAG_DOCS = tagDocs();

/** Runs checkSingleTag over one tag, with the given context. */
function checkTag(tag: string, context: ScriptCheckContext | null = null, startChar = 0) {
    const checker = new ScriptChecker('- narrate placeholder');
    checker.meta = TAG_DOCS;
    checkSingleTag(checker, 0, startChar, tag, context);
    return checker;
}

/** Just the warning keys raised, in order. */
function keys(checker: ScriptChecker): string[] {
    return [...checker.warnings, ...checker.minorWarnings].map(w => w.warningUniqueKey);
}

function contextWith(defs: string[] = [], saves: string[] = []): ScriptCheckContext {
    const c = new ScriptCheckContext();
    for (const d of defs) { c.definitions.add(d); }
    for (const s of saves) { c.saveEntries.add(s); }
    return c;
}

describe('checkSingleTag: the false-positive guard', () => {
    it('says NOTHING about a fully valid tag', () => {
        // The single most important assertion in this phase. Everything else here fires a
        // warning; if this one ever fires, the extension underlines working scripts.
        expect(keys(checkTag('player.name'))).toEqual([]);
        expect(keys(checkTag('player'))).toEqual([]);
    });

    it('says nothing when the checker has no meta loaded', () => {
        // Diagnostics run before meta finishes downloading on a cold start. With no meta there
        // is nothing to check a tag against, and guessing would mean warning about every tag in
        // the file for the first few seconds after opening it.
        // MUTANT CAUGHT: dereferencing checker.meta unguarded -- this throws.
        const checker = new ScriptChecker('- narrate placeholder');
        expect(() => checkSingleTag(checker, 0, 0, 'anything.at.all', null)).not.toThrow();
        expect(keys(checker)).toEqual([]);
    });
});

describe('checkSingleTag: the tag base (ScriptChecker.cs:436-444)', () => {
    it('reports bad_tag_base for a base that is not a known tag base', () => {
        // :437-440. `Meta.TagBases` is the set of every documented base name.
        //
        // TWO diagnostics, not one, and that is correct: the meta-set check at :437 and the
        // tracer at :502 both look at the base and both complain, under different keys. They are
        // separate mechanisms -- the set is a flat name index, the tracer walks the type graph --
        // and the C# runs both unconditionally.
        const checker = checkTag('nosuchbase.name');
        expect(keys(checker)).toEqual(['bad_tag_base', 'tag_trace_failure']);
        expect(checker.warnings[0].customMessageForm).toContain('Invalid tag base `nosuchbase`');
    });

    it('anchors bad_tag_base on the BASE PART, offset by the tag start', () => {
        // :434 -- `startChar + part.StartChar` to `startChar + part.EndChar`. The squiggle covers
        // the base name only, not the whole tag.
        //
        // `endChar` is INCLUSIVE of the part's last character, not one past it: `nosuchbase` runs
        // 0..9, so at startChar 10 the range is 10..19. An earlier draft assumed the usual
        // exclusive convention and expected 20.
        // MUTANT CAUGHT: reporting the whole tag's range instead of the part's.
        const checker = checkTag('nosuchbase.name', null, 10);
        expect({ start: checker.warnings[0].startChar, end: checker.warnings[0].endChar }).toEqual({ start: 10, end: 19 });
    });

    it('does NOT report an empty base -- that is how <[def]> is written', () => {
        // :437's `&& tagName.Length > 0`. `<[x]>` parses to an empty base name, and it is valid.
        // MUTANT CAUGHT: dropping the length test -- every definition tag in every script warns.
        expect(keys(checkTag('[x]', contextWith(['x'])))).toEqual([]);
    });

    it('reports xtag_notation for a KNOWN base whose name ends in "tag"', () => {
        // :441-444, and note it is an `else if`: a base that is not known at all gets
        // bad_tag_base instead, never both.
        // MUTANT CAUGHT: making it a second `if` -- an unknown base ending in "tag" would draw
        // bad_tag_base AND xtag_notation, where the C# gives only the first.
        expect(keys(checkTag('sometag'))).toEqual(['xtag_notation']);
        expect(keys(checkTag('nosuchtag'))).toEqual(['bad_tag_base', 'tag_trace_failure']);
    });
});

describe('checkSingleTag: definition and entry parameters (ScriptChecker.cs:445-468)', () => {
    it('reports def_of_nothing for a definition the context does not know', () => {
        expect(keys(checkTag('[missing]', contextWith(['known'])))).toEqual(['def_of_nothing']);
    });

    it('accepts a definition the context knows, written either way', () => {
        // :445 accepts both the empty base (`<[x]>`) and the spelled-out `<definition[x]>`.
        expect(keys(checkTag('[known]', contextWith(['known'])))).toEqual([]);
        expect(keys(checkTag('definition[known]', contextWith(['known'])))).toEqual([]);
    });

    it('cuts the definition name at the first "." before looking it up', () => {
        // :450's `.Before('.')`. `<[map.key]>` is reading INTO a definition called `map`.
        // MUTANT CAUGHT: looking up the whole parameter -- every map/list access warns.
        expect(keys(checkTag('[known.sub.deeper]', contextWith(['known'])))).toEqual([]);
    });

    it('lowercases the definition name before looking it up', () => {
        // :450's `.ToLowerFast()`. Definition names are stored lowercased.
        expect(keys(checkTag('[KNOWN]', contextWith(['known'])))).toEqual([]);
    });

    it('says nothing when there is no context at all', () => {
        // :451's `context is not null`. Called from a place with no container context, the
        // definition check simply does not run.
        expect(keys(checkTag('[missing]', null))).toEqual([]);
    });

    it('is silenced entirely by hasUnknowableDefinitions', () => {
        // :451. A script with an unresolvable inject has definitions the checker cannot know
        // about; without this flag one such inject would paint the whole script red.
        // MUTANT CAUGHT: dropping the flag from the condition.
        const c = contextWith([]);
        c.hasUnknowableDefinitions = true;
        expect(keys(checkTag('[missing]', c))).toEqual([]);
    });

    it('reports entry_of_nothing for an unknown save entry', () => {
        expect(keys(checkTag('entry[missing].thing', contextWith([], ['known'])))).toEqual(['entry_of_nothing']);
        expect(keys(checkTag('entry[known].thing', contextWith([], ['known'])))).toEqual([]);
    });

    it('does NOT cut the entry name at a "." -- unlike a definition', () => {
        // :462 lowercases but does NOT call `.Before('.')`, where :450 does. An asymmetry in the
        // C#, ported as-is.
        // MUTANT CAUGHT: adding the Before('.') for symmetry -- `entry[a.b]` would stop warning.
        expect(keys(checkTag('entry[known.sub].thing', contextWith([], ['known'])))).toEqual(['entry_of_nothing']);
    });

    it('is silenced entirely by hasUnknowableSaveEntries', () => {
        const c = contextWith([], []);
        c.hasUnknowableSaveEntries = true;
        expect(keys(checkTag('entry[missing].thing', c))).toEqual([]);
    });
});

describe('checkSingleTag: tag parts (ScriptChecker.cs:469-483)', () => {
    it('reports bad_tag_part for a part that is not a known tag part', () => {
        expect(keys(checkTag('player.nosuchpart'))).toContain('bad_tag_part');
    });

    it('exempts the FIRST part after entry or context, but no others', () => {
        // :474 -- `i != 1 || (tagName != "entry" && tagName != "context")`. `<context.whatever>`
        // is the commonest construct in a world script and its key name cannot be known, so the
        // first part is exempt. The SECOND part is not.
        // MUTANT CAUGHT: exempting every part of a context tag, which would stop reporting real
        // typos after the first.
        expect(keys(checkTag('context.anything_at_all'))).toEqual([]);
        expect(keys(checkTag('entry[known].anything', contextWith([], ['known'])))).toEqual([]);
        expect(keys(checkTag('context.anything.nosuchpart'))).toContain('bad_tag_part');
    });

    it('adds xtag_notation alongside bad_tag_part when the part ends in "tag"', () => {
        // :477-480 is nested INSIDE the bad-part branch, so a part ending in "tag" that IS
        // documented gets nothing, and one that is not gets BOTH warnings.
        // The tracer reports the same part separately, as it does for a bad base.
        // MUTANT CAUGHT: hoisting the xtag check out of the bad-part branch.
        expect(keys(checkTag('player.sometag'))).toEqual(['bad_tag_part', 'xtag_notation', 'tag_trace_failure']);
    });
});

describe('checkSingleTag: recursion into parameters and fallbacks (ScriptChecker.cs:484-494)', () => {
    it('checks a tag nested inside a parameter', () => {
        // :486-489 re-enters checkSingleArgument for every part's parameter, which finds tags
        // inside it and checks them too.
        // MUTANT CAUGHT: not recursing -- the inner bad base goes unreported.
        expect(keys(checkTag('player.name[<nosuchbase>]'))).toContain('bad_tag_base');
    });

    it('checks a tag inside a fallback', () => {
        // :491-494. The fallback after `||` is an argument in its own right.
        // MUTANT CAUGHT: ignoring the fallback.
        expect(keys(checkTag('player.name||<nosuchbase>'))).toContain('bad_tag_base');
    });
});

describe('checkSingleTag: the tracer diagnostics (ScriptChecker.cs:495-502)', () => {
    it('raises tag_trace_failure from the tracer error callback', () => {
        // Task 1 restored these callbacks; this is the wiring that turns them into diagnostics.
        // `<player[x]>` -- the base takes no parameter -- is a tracer error, not a base error.
        // MUTANT CAUGHT: not passing the error callback to traceTag.
        const checker = checkTag('player[x]');
        expect(keys(checker)).toContain('tag_trace_failure');
        expect(checker.warnings.find(w => w.warningUniqueKey === 'tag_trace_failure')!.customMessageForm)
            .toContain('Tag tracer:');
    });

    it('raises deprecated_tag_part as a MINOR warning', () => {
        // :500 routes this to MinorWarnings, unlike every other key in this function.
        // MUTANT CAUGHT: routing it to `warnings`.
        const d = buildMetaDocs([
            type('ObjectTag', 'none'),
            type('ElementTag', 'ObjectTag'),
            type('PlayerTag', 'ElementTag'),
            { objectType: 'tag', url: 'src#L1', data: ['@attribute <player>', '@returns PlayerTag', '@description x', '@end_meta'] },
            { objectType: 'tag', url: 'src#L1', data: ['@attribute <PlayerTag.oldway>', '@returns ElementTag', '@deprecated Use something else.', '@description x', '@end_meta'] }
        ]);
        linkTypeGraph(d);
        const checker = new ScriptChecker('- narrate placeholder');
        checker.meta = d;
        checkSingleTag(checker, 0, 0, 'player.oldway', null);
        expect(checker.minorWarnings.map(w => w.warningUniqueKey)).toEqual(['deprecated_tag_part']);
        expect(checker.warnings).toEqual([]);
    });
});

describe('checkSingleTag: parse failure (ScriptChecker.cs:428-431)', () => {
    it('raises tag_format_break over the WHOLE tag when the parse complains', () => {
        // :430's range is the whole tag, not a part -- at parse-failure time there are no
        // reliable part offsets to point at.
        const checker = checkTag('player.name[unclosed', null, 5);
        const parseWarns = checker.warnings.filter(w => w.warningUniqueKey === 'tag_format_break');
        expect(parseWarns.length).toBeGreaterThan(0);
        expect({ start: parseWarns[0].startChar, end: parseWarns[0].endChar })
            .toEqual({ start: 5, end: 5 + 'player.name[unclosed'.length });
    });
});

describe('checkSingleTag: cases the first draft of these tests missed', () => {
    it('does NOT fold a non-ASCII definition name, so a Cyrillic name still resolves', () => {
        // ScriptChecker.cs:436, :450 and :462 all use ToLowerFast(), which is ASCII-ONLY.
        // `parseTag` has already ASCII-lowered the whole tag, so the only characters a Unicode
        // fold could still change are non-ASCII uppercase ones -- and those are exactly the ones
        // the C# leaves alone.
        //
        // This is not a technicality here. Definition names reach `defNames` through the same
        // ToLowerFast, so `- define ИМЯ ...` is stored as ИМЯ. Folding the tag's parameter to
        // "имя" would look it up under a name nothing ever stored and report def_of_nothing on a
        // perfectly correct script -- in a codebase whose scripts are full of Cyrillic.
        //
        // The original implementation used toLowerCase() and this exact case was WRONG; the
        // mutation audit surfaced it as a surviving "not lowercased" mutant, because with an
        // ASCII-only fixture the call is a no-op either way.
        // MUTANT CAUGHT: using toLowerCase() instead of an ASCII-only fold.
        expect(keys(checkTag('[ИМЯ]', contextWith(['ИМЯ'])))).toEqual([]);
        // And an ASCII name still folds, so the ASCII half is not lost.
        expect(keys(checkTag('[KNOWN]', contextWith(['known'])))).toEqual([]);
    });

    it('offsets a diagnostic raised INSIDE a tag parameter past the part text and its "["', () => {
        // ScriptChecker.cs:488 -- `startChar + part.StartChar + part.Text.Length + 1`. The `+ 1`
        // steps over the opening bracket.
        //
        // The earlier recursion tests only asserted that the inner diagnostic APPEARED, never
        // where, so dropping the `+ 1` survived. The offset is the whole point of the
        // expression: it is what puts the squiggle on the nested tag rather than one character
        // to its left.
        //
        // 'player.name[<nosuchbase>]': part 1 is `name`, startChar 7, length 4, so the parameter
        // begins at 7 + 4 + 1 = 12. Inside it, checkSingleArgument finds `<` at 0 and hands the
        // tag out at 12 + 0 + 1 = 13 -- the `n` of `nosuchbase`. bad_tag_base then covers the
        // base part, 13 to 13 + 9 = 22.
        // MUTANT CAUGHT: dropping the `+ 1`; every range moves one character left.
        const checker = checkTag('player.name[<nosuchbase>]');
        const bad = checker.warnings.find(w => w.warningUniqueKey === 'bad_tag_base')!;
        expect({ start: bad.startChar, end: bad.endChar }).toEqual({ start: 13, end: 22 });
    });
});
