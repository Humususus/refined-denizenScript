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

describe('loadInjects (ScriptChecker.cs:279-310)', () => {
    /** Runs a script and returns the injects list. */
    function injectsOf(script: string): string[] {
        const checker = new ScriptChecker(script);
        checker.run();
        return checker.injects;
    }

    it('records nothing for a script with no inject command', () => {
        expect(injectsOf('t:\n    type: task\n    script:\n    - narrate hi')).toEqual([]);
    });

    it('records the target of a plain inject', () => {
        // MUTANT CAUGHT: not stripping the `- inject ` prefix, which would record the whole line.
        expect(injectsOf('t:\n    type: task\n    script:\n    - inject other_script')).toEqual(['other_script']);
    });

    it('cuts the target at the first dot, keeping only the container name', () => {
        // A `script.path` target names a path inside a container; only the container is injected.
        // MUTANT CAUGHT: dropping the `before(target, '.')`.
        expect(injectsOf('t:\n    type: task\n    script:\n    - inject other_script.some.path')).toEqual(['other_script']);
    });

    it('cuts the target at the first SPACE, ignoring later arguments', () => {
        // MUTANT CAUGHT: dropping the `before(line, ' ')`, which would record `other_script`
        // together with everything after it and so never match a real container name.
        expect(injectsOf('t:\n    type: task\n    script:\n    - inject other_script instantly')).toEqual(['other_script']);
    });

    it('adds the wildcard when the target is tag-built, AND keeps the raw name', () => {
        // ScriptChecker.cs:305-307 pushes BOTH. The raw name is kept verbatim -- `before(target,
        // '.')` returns the whole string when there is no dot -- and it can never match a real
        // container, so it is inert. The `'*'` beside it is what does the work: it means "every
        // script is injected into", the same exempt-rather-than-guess reflex as MixedKnowledgeSet's
        // empty prefix.
        // MUTANT CAUGHT: pushing only one of the two, or testing `line` instead of `target`.
        expect(injectsOf('t:\n    type: task\n    script:\n    - inject <[name]>_thing')).toEqual(['<[name]>_thing', '*']);
    });

    it('does not add the wildcard for an ordinary target', () => {
        expect(injectsOf('t:\n    type: task\n    script:\n    - inject other_script')).not.toContain('*');
    });

    it('tests the TARGET for a tag, not the rest of the arguments', () => {
        // ScriptChecker.cs:305 checks `target`, which is the line cut at the first space. A tag in
        // a LATER argument says nothing about which script is injected into, so it must not make
        // every container unknowable.
        // MUTANT CAUGHT: `line.includes('<')`, which would add the wildcard here and switch off
        // definition checking for the whole workspace on a script that named its target plainly.
        expect(injectsOf('t:\n    type: task\n    script:\n    - inject other_script <[arg]>')).toEqual(['other_script']);
    });

    it('resolves "locally" to the enclosing top-level container title', () => {
        // The `locally` form injects into a script in this same file, so the target is found by
        // walking BACKWARDS to the nearest title.
        // MUTANT CAUGHT: treating `locally` as a plain target name.
        expect(injectsOf('my_long_task_name:\n    type: task\n    script:\n    - inject locally other_path')).toEqual(['my_long_task_name']);
    });

    it('matches "locally" ANYWHERE in the arguments, not only first', () => {
        // ScriptChecker.cs:286 is `Contains`, not `StartsWith`.
        // MUTANT CAUGHT: `line.startsWith('locally')`.
        expect(injectsOf('my_long_task_name:\n    type: task\n    script:\n    - inject instantly locally')).toEqual(['my_long_task_name']);
    });

    it('picks the NEAREST preceding title when a file has several containers', () => {
        // MUTANT CAUGHT: walking forwards, or not breaking after the first hit.
        const script = [
            'first_task_name:', '    type: task', '    script:', '    - narrate hi',
            'second_task_name:', '    type: task', '    script:', '    - inject locally x'
        ].join('\n');
        expect(injectsOf(script)).toEqual(['second_task_name']);
    });

    it('skips indented keys when looking for the title', () => {
        // A `script:` key also ends with ':' -- only the column-zero test tells it from a title.
        // MUTANT CAUGHT: dropping the `!lines[x].startsWith(' ')` condition, which would record
        // `script` as the injected container.
        expect(injectsOf('my_long_task_name:\n    type: task\n    script:\n    - inject locally x')).toEqual(['my_long_task_name']);
    });

    it('treats a TAB-indented key as indented, not as a title', () => {
        // ScriptChecker.cs:290 expands tabs to four spaces before the test, against the RAW line.
        // MUTANT CAUGHT: dropping the tab expansion.
        const script = 'my_long_task_name:\n\tscript:\n\t- inject locally x';
        expect(injectsOf(script)).toEqual(['my_long_task_name']);
    });

    it('records every inject in a file, not just the first', () => {
        const script = [
            't:', '    type: task', '    script:',
            '    - inject first_target', '    - inject second_target'
        ].join('\n');
        expect(injectsOf(script)).toEqual(['first_target', 'second_target']);
    });

    it('ignores an inject inside a comment, because comments are blanked first', () => {
        // `run()` calls clearCommentsFromLines before loadInjects, which blanks comment lines in
        // both arrays. MUTANT CAUGHT: calling loadInjects before the comment strip.
        expect(injectsOf('t:\n    type: task\n    script:\n    # - inject other_script')).toEqual([]);
    });

    it('requires the trailing space, so "- injection" is not an inject', () => {
        // MUTANT CAUGHT: `startsWith('- inject')`.
        expect(injectsOf('t:\n    type: task\n    script:\n    - injection other_script')).toEqual([]);
    });
});

describe('collectStatisticInfos (ScriptChecker.cs:1676-1687)', () => {
    function statsOf(script: string): Map<string, string> {
        const checker = new ScriptChecker(script);
        checker.run();
        const out = new Map<string, string>();
        for (const info of checker.infos) {
            out.set(info.warningUniqueKey, info.customMessageForm);
        }
        return out;
    }

    it('emits the four unconditional statistics', () => {
        const stats = statsOf('t:\n    type: task\n    script:\n    - narrate hi');
        expect([...stats.keys()].sort()).toEqual(['stat_blank', 'stat_comment', 'stat_livecode', 'stat_structural']);
    });

    it('counts structural, code, comment and blank lines separately', () => {
        // Structural means "ends with a colon", so `t:` and `script:` count and `type: task` does
        // NOT -- it ends in `task`. The comment line is counted as a comment and then blanked in
        // place, so it never also counts as blank.
        // ALL FOUR NUMBERS ARE DIFFERENT on purpose: with two of them equal, swapping those two
        // counters would go unnoticed.
        // MUTANT CAUGHT: swapping any two counters.
        const script = ['t:', '    type: task', '    script:', '    - a', '    - b', '    - c', '# a comment', '', '', '', ''].join('\n');
        const stats = statsOf(script);
        expect(stats.get('stat_structural')).toContain(': 2');
        expect(stats.get('stat_livecode')).toContain(': 3');
        expect(stats.get('stat_comment')).toContain(': 1');
        expect(stats.get('stat_blank')).toContain(': 4');
    });

    it('omits the ignored-warning statistic when nothing was ignored', () => {
        // ScriptChecker.cs:1682 is conditional. MUTANT CAUGHT: emitting it unconditionally.
        expect(statsOf('t:\n    type: task\n    script:\n    - narrate hi').has('stat_ignore_warnings')).toBe(false);
    });

    it('reports the ignored-warning count when a directive suppressed something', () => {
        // `##ignorewarning` registers the key, and the collector counts every suppressed call.
        // MUTANT CAUGHT: dropping the conditional branch entirely.
        const script = ['##ignorewarning short_script_name', 't:', '    type: task', '    script:', '    - narrate hi'].join('\n');
        const stats = statsOf(script);
        expect(stats.has('stat_ignore_warnings')).toBe(true);
    });

    it('reports every statistic at line -1, since they describe the file', () => {
        // MUTANT CAUGHT: reporting at line 0, which would attach them to the first real line.
        const checker = new ScriptChecker('t:\n    type: task\n    script:\n    - narrate hi');
        checker.run();
        for (const info of checker.infos) {
            expect(info.line).toBe(-1);
        }
    });

    it('puts statistics in infos, never in the published diagnostic lists', () => {
        // `server.ts` publishes errors, warnings and minorWarnings. A statistic landing in any of
        // those would put four line-count entries in the user's Problems panel per file.
        // MUTANT CAUGHT: warning into `minorWarnings` instead of `infos`.
        const checker = new ScriptChecker('t:\n    type: task\n    script:\n    - narrate hi');
        checker.run();
        const published = [...checker.errors, ...checker.warnings, ...checker.minorWarnings]
            .map(w => w.warningUniqueKey);
        expect(published.filter(k => k.startsWith('stat_'))).toEqual([]);
        expect(checker.infos.length).toBeGreaterThan(0);
    });
});
