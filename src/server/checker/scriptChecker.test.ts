import { describe, it, expect } from 'vitest';
import { ScriptChecker } from './scriptChecker';

// Constructor behaviour derived from ScriptChecker.cs:137-146.
describe('ScriptChecker construction', () => {
    it('normalizes \\r\\n and a lone \\r to \\n before splitting into lines', () => {
        const checker = new ScriptChecker('AAA\r\nBBB\rCCC\nDDD');
        // MUTANT CAUGHT: swapping the order of the two replaceAll calls, i.e. collapsing lone
        // '\r' first. That turns the '\r\n' into '\n\n' before the CRLF pass can see it, so this
        // yields five lines with a spurious blank at index 1. Dropping either replaceAll on its
        // own is caught the same way: without the CRLF pass a stray '\r' survives inside line 1,
        // and without the lone-'\r' pass 'BBB\rCCC' never splits.
        expect(checker.lines).toEqual(['AAA', 'BBB', 'CCC', 'DDD']);
    });

    it('trims and lowercases cleanedLines but leaves lines untouched', () => {
        const checker = new ScriptChecker('  Foo  \nBar');
        // A mutant that also trims/lowercases `lines`, or that skips trim/lowercase on
        // `cleanedLines`, is caught by comparing the two arrays against different expectations.
        expect(checker.lines).toEqual(['  Foo  ', 'Bar']);
        expect(checker.cleanedLines).toEqual(['foo', 'bar']);
    });

    it('stores the original un-normalized script text', () => {
        const checker = new ScriptChecker('AAA\r\nBBB');
        // MUTANT CAUGHT: assigning `fullOriginalScript` after the CRLF normalization instead of
        // before it (ScriptChecker.cs:139 comes first for a reason), which would store 'AAA\nBBB'.
        // Load-bearing rather than cosmetic: checkForTabs/checkForBraces/checkForOldDefs and
        // checkForColorCodes all take their cheap whole-document guard off this exact string.
        expect(checker.fullOriginalScript).toBe('AAA\r\nBBB');
    });
});

// ClearCommentsFromLines behaviour derived from ScriptChecker.cs:183-215. Read in full before
// writing these: the brief's plan text only quotes the opening few lines, but the method also
// counts blank/code/structure lines in the same loop (see scriptChecker.ts for the note).
describe('ScriptChecker.clearCommentsFromLines', () => {
    it('blanks a full-line comment in both arrays and counts it in commentLines', () => {
        const checker = new ScriptChecker('# a comment\nfoo');
        checker.clearCommentsFromLines();
        // MUTANT CAUGHT: blanking only one of the two arrays. Blanking `cleanedLines` alone
        // leaves the comment text visible to every check that reads `lines` (checkForTabs,
        // checkForBraces, checkForOldDefs, checkForColorCodes all do); blanking `lines` alone
        // leaves it visible to the `cleanedLines`-driven branches of basicLineFormatCheck.
        expect(checker.lines[0]).toBe('');
        expect(checker.cleanedLines[0]).toBe('');
        expect(checker.commentLines).toBe(1);
        // MUTANT CAUGHT: splicing the comment out of the arrays instead of blanking it in place
        // (ScriptChecker.cs:198-200). That shifts every later line up by one, so every warning
        // after a comment would point at the wrong line -- here 'foo' would move to index 0 and
        // lines[1] would be undefined.
        expect(checker.lines[1]).toBe('foo');
        expect(checker.cleanedLines[1]).toBe('foo');
    });

    it('adds exactly the ignore key from ##ignorewarning to ignoredWarningTypes', () => {
        const checker = new ScriptChecker('##ignorewarning stray_space_eol');
        checker.clearCommentsFromLines();
        // MUTANT CAUGHT: an off-by-one in the slice offset, or adding the whole cleaned line
        // rather than the text after '##ignorewarning '. Either stores a key that no
        // `warningUniqueKey` can ever equal, so the directive would silently do nothing --
        // exactly the failure a user would report as "##ignorewarning is broken".
        expect(checker.ignoredWarningTypes.has('stray_space_eol')).toBe(true);
        // MUTANT CAUGHT: also adding the raw/untrimmed form alongside the sliced one.
        expect(checker.ignoredWarningTypes.size).toBe(1);
    });

    it('does not add an ignore for a single-# comment, even one that looks like the directive', () => {
        const checker = new ScriptChecker('#ignorewarning stray_space_eol');
        checker.clearCommentsFromLines();
        // MUTANT CAUGHT: reading the directive as single-'#' ('#ignorewarning ') throughout --
        // the natural mistake for anyone who half-remembers the syntax, since every other
        // comment in this language uses one '#'. Such a mutant would add the key here.
        expect(checker.ignoredWarningTypes.size).toBe(0);
    });

    it('does not add an ignore when the raw line has leading whitespace before ##, even though ' +
        'the trimmed cleaned line qualifies (ScriptChecker.cs:189 checks the RAW line for "##", ' +
        'deliberately asymmetric with the cleaned-line match used for the directive text itself)', () => {
        const checker = new ScriptChecker('  ##ignorewarning stray_space_eol');
        checker.clearCommentsFromLines();
        // A mutant that checks cleanedLines[i].startsWith('##') instead of Lines[i].startsWith('##')
        // would incorrectly add this ignore, since the cleaned line (trimmed) does start with "##".
        expect(checker.ignoredWarningTypes.size).toBe(0);
    });

    it('flags a todo comment with the exact range computed from the raw (untrimmed) line', () => {
        const checker = new ScriptChecker('  # todo: something');
        checker.clearCommentsFromLines();
        expect(checker.minorWarnings).toHaveLength(1);
        const warning = checker.minorWarnings[0];
        expect(warning.warningUniqueKey).toBe('todo_comment');
        expect(warning.line).toBe(0);
        // Lines[i].Trim() for the message, but Lines[i].IndexOf('#') / Lines[i].Length (raw,
        // untrimmed) for the range -- a mutant using the cleaned line for start/end would report
        // startChar 0 / endChar 18 instead of 2 / 19.
        expect(warning.customMessageForm).toBe('TODO Line: # todo: something');
        expect(warning.startChar).toBe(2);
        expect(warning.endChar).toBe(19);
    });

    it('does not flag a non-todo comment', () => {
        const checker = new ScriptChecker('# just a normal comment');
        checker.clearCommentsFromLines();
        // MUTANT CAUGHT: dropping the `comment.startsWith('todo')` guard, or inverting it. Either
        // turns every comment in the file into a `todo_comment` minor warning -- and comments are
        // the most common line in a real script, so this is the loudest possible regression.
        expect(checker.minorWarnings).toHaveLength(0);
    });

    it('counts a blank line toward blankLines, not commentLines', () => {
        const checker = new ScriptChecker('\nfoo');
        checker.clearCommentsFromLines();
        // MUTANT CAUGHT: incrementing `commentLines` from the blank-line branch. A blank line is
        // not a comment, and the two counters feed different statistics later in the port. The
        // sibling assertion is what discriminates: a mutant that increments BOTH still satisfies
        // the first expectation.
        expect(checker.blankLines).toBe(1);
        expect(checker.commentLines).toBe(0);
    });

    it('counts a dash-prefixed line toward codeLines', () => {
        const checker = new ScriptChecker('- narrate "hi"');
        checker.clearCommentsFromLines();
        // MUTANT CAUGHT: swapping the bodies of the `startsWith('-')` and `endsWith(':')`
        // branches (ScriptChecker.cs:206-212), so a command line counts as structure. Paired
        // with the structureLines test below, which pins the other half of the swap; the
        // sibling-counter assertion is what makes each half fail on its own.
        expect(checker.codeLines).toBe(1);
        expect(checker.structureLines).toBe(0);
    });

    it('counts a colon-terminated line toward structureLines', () => {
        const checker = new ScriptChecker('my_script:');
        checker.clearCommentsFromLines();
        // MUTANT CAUGHT: the other half of the branch swap described above -- a container header
        // counting as a code line. Also catches dropping the `endsWith(':')` branch entirely,
        // which would leave structureLines permanently 0.
        expect(checker.structureLines).toBe(1);
        expect(checker.codeLines).toBe(0);
    });
});

describe('cleanedLines uses the ASCII fold, not the Unicode one', () => {
    // ScriptChecker.cs:145 is ToLowerFast(), which lowercases A-Z ONLY. This was the last of the
    // five copies of that fold in the checker to still be a plain toLowerCase().

    it('leaves Cyrillic case alone while still folding ASCII', () => {
        // MUTANT: toLowerFast -> toLowerCase. Denizen folds identifiers with an ASCII rule, so a
        // Unicode fold here rewrites every non-English identifier on the way into the parser
        // while the raw lines keep their case -- and the two get compared against each other.
        const checker = new ScriptChecker('МойТаск: ABC');
        expect(checker.cleanedLines).toEqual(['МойТаск: abc']);
    });

    it('keeps a non-ASCII container title spelled as written', () => {
        // MUTANT: as above. The gatherer reads cleanedLines, so the fold decides how every
        // container title is spelled downstream; with toLowerCase this key is "мойдлинныйтаск".
        const checker = new ScriptChecker('МойДлинныйТаск:\n    type: task\n    script:\n    - narrate hi');
        checker.run();
        expect([...checker.generatedWorkspace.scripts.keys()]).toEqual(['МойДлинныйТаск']);
    });

    it('still folds an ASCII title, so the fold is not simply switched off', () => {
        // MUTANT: drop the fold entirely and return the input unchanged. Every other test in this
        // block still passes with that applied; this is the one that says the ASCII half works.
        const checker = new ScriptChecker('MyLongTask:\n    type: task\n    script:\n    - narrate hi');
        checker.run();
        expect([...checker.generatedWorkspace.scripts.keys()]).toEqual(['mylongtask']);
    });

    it('resolves a Cyrillic definition used with the same case', () => {
        // The user-visible payoff: a define and the tag reading it must agree on spelling.
        // MUTANT: any fold that disagrees between the define site and the tag site.
        const checker = new ScriptChecker('my_long_task:\n    type: task\n    script:\n    - define ИМЯ x\n    - narrate <[ИМЯ]>');
        checker.run();
        expect(checker.warnings.map(w => w.warningUniqueKey)).not.toContain('def_of_nothing');
    });
});
