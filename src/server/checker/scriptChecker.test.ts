import { describe, it, expect } from 'vitest';
import { ScriptChecker } from './scriptChecker';

// Constructor behaviour derived from ScriptChecker.cs:137-146.
describe('ScriptChecker construction', () => {
    it('normalizes \\r\\n and a lone \\r to \\n before splitting into lines', () => {
        const checker = new ScriptChecker('AAA\r\nBBB\rCCC\nDDD');
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
        expect(checker.lines[0]).toBe('');
        expect(checker.cleanedLines[0]).toBe('');
        expect(checker.commentLines).toBe(1);
        // The following non-comment line must be untouched.
        expect(checker.lines[1]).toBe('foo');
        expect(checker.cleanedLines[1]).toBe('foo');
    });

    it('adds exactly the ignore key from ##ignorewarning to ignoredWarningTypes', () => {
        const checker = new ScriptChecker('##ignorewarning stray_space_eol');
        checker.clearCommentsFromLines();
        expect(checker.ignoredWarningTypes.has('stray_space_eol')).toBe(true);
        expect(checker.ignoredWarningTypes.size).toBe(1);
    });

    it('does not add an ignore for a single-# comment, even one that looks like the directive', () => {
        const checker = new ScriptChecker('#ignorewarning stray_space_eol');
        checker.clearCommentsFromLines();
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
        expect(checker.minorWarnings).toHaveLength(0);
    });

    it('counts a blank line toward blankLines, not commentLines', () => {
        const checker = new ScriptChecker('\nfoo');
        checker.clearCommentsFromLines();
        expect(checker.blankLines).toBe(1);
        expect(checker.commentLines).toBe(0);
    });

    it('counts a dash-prefixed line toward codeLines', () => {
        const checker = new ScriptChecker('- narrate "hi"');
        checker.clearCommentsFromLines();
        expect(checker.codeLines).toBe(1);
        expect(checker.structureLines).toBe(0);
    });

    it('counts a colon-terminated line toward structureLines', () => {
        const checker = new ScriptChecker('my_script:');
        checker.clearCommentsFromLines();
        expect(checker.structureLines).toBe(1);
        expect(checker.codeLines).toBe(0);
    });
});
