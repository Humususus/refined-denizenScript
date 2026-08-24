import { describe, it, expect } from 'vitest';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { combineSources, buildCapabilities, buildDiagnostics } from './server';
import { ScriptChecker } from './checker/scriptChecker';

describe('combineSources', () => {
    it('returns just the defaults when extra is undefined, null, or empty', () => {
        const defaults = ['https://example.com/a.zip', 'https://example.com/b.zip'];
        expect(combineSources(defaults, undefined)).toEqual(defaults);
        expect(combineSources(defaults, null)).toEqual(defaults);
        expect(combineSources(defaults, [])).toEqual(defaults);
    });

    it('appends extra sources after the defaults', () => {
        const defaults = ['https://example.com/a.zip'];
        const extra = ['https://example.com/custom1.zip', 'https://example.com/custom2.zip'];
        expect(combineSources(defaults, extra)).toEqual([
            'https://example.com/a.zip',
            'https://example.com/custom1.zip',
            'https://example.com/custom2.zip'
        ]);
    });

    it('trims whitespace and drops blank entries', () => {
        const defaults = ['https://example.com/a.zip'];
        const extra = ['  https://example.com/custom.zip  ', '', '   '];
        expect(combineSources(defaults, extra)).toEqual([
            'https://example.com/a.zip',
            'https://example.com/custom.zip'
        ]);
    });
});

describe('buildCapabilities', () => {
    it('advertises completion and hover support', () => {
        const caps = buildCapabilities();
        expect(caps.completionProvider).toBeDefined();
        expect(caps.completionProvider!.resolveProvider).toBe(false);
        expect(caps.hoverProvider).toBe(true);
    });

    it('offers a dash as a completion trigger character', () => {
        expect(buildCapabilities().completionProvider!.triggerCharacters).toContain('-');
    });

    it('triggers completion on the characters that open a tag and separate its parts', () => {
        // Without these two the editor never asks for completions mid-tag: typing
        // '<player.' produces no request at all, so the part list only appears once
        // the user types a word character. This was a real user-visible regression
        // against the C# server.
        const triggers = buildCapabilities().completionProvider!.triggerCharacters;
        expect(triggers).toContain('<');
        expect(triggers).toContain('.');
    });

    it('advertises every trigger character the C# server does', () => {
        // InitializationService.cs:34 — new CompletionOptions(true, " .=<[;").
        // The two engines are switchable at runtime via denizenscript.server.engine,
        // so a narrower set here shows up as completions that fire in one engine and
        // not the other.
        const triggers = buildCapabilities().completionProvider!.triggerCharacters;
        for (const char of [' ', '.', '=', '<', '[', ';']) {
            expect(triggers).toContain(char);
        }
    });

    it('keeps incremental document sync', () => {
        expect(buildCapabilities().textDocumentSync).toBe(2);
    });
});

describe('signature help capability', () => {
    it('advertises signature help with the Denizen trigger characters', () => {
        const caps = buildCapabilities();
        expect(caps.signatureHelpProvider).toBeDefined();
        expect(caps.signatureHelpProvider!.triggerCharacters).toContain(' ');
    });
});

describe('buildDiagnostics', () => {
    /** A checker with no script content, used as a carrier for hand-placed warnings. */
    function emptyChecker(): ScriptChecker {
        return new ScriptChecker('');
    }

    it('maps errors to Error, warnings to Warning, and minorWarnings to Information', () => {
        // MUTANT CAUGHT: any swap in the three-way severity mapping -- above all the natural
        // misreading of `minorWarnings` as DiagnosticSeverity.Warning ("a minor warning is
        // still a warning"). DiagnosticProvider.cs:107-110 publishes them as Information, so
        // the C# shows them as blue squiggles and this engine must too.
        const checker = emptyChecker();
        checker.warn(checker.errors, 0, 'brace_syntax', 'braces', 0, 1);
        checker.warn(checker.warnings, 1, 'raw_tab_symbol', 'tabs', 0, 1);
        checker.warn(checker.minorWarnings, 2, 'todo_comment', 'todo', 0, 1);

        const byCode = new Map(buildDiagnostics(checker).map(d => [d.code, d.severity]));
        expect(byCode.get('brace_syntax')).toBe(DiagnosticSeverity.Error);
        expect(byCode.get('raw_tab_symbol')).toBe(DiagnosticSeverity.Warning);
        expect(byCode.get('todo_comment')).toBe(DiagnosticSeverity.Information);
    });

    it('never publishes infos, whether or not other warnings exist', () => {
        // MUTANT CAUGHT: adding a fourth `...checker.infos.map(...)` spread "for completeness".
        // DiagnosticProvider.cs:96-110 iterates exactly three lists; Infos feeds the C#'s
        // statistics output only and would surface as user-facing noise if published.
        const mixed = emptyChecker();
        mixed.warn(mixed.errors, 0, 'brace_syntax', 'braces', 0, 1);
        mixed.warn(mixed.infos, 1, 'stat_info', 'some statistic', 0, 1);
        const mixedCodes = buildDiagnostics(mixed).map(d => d.code);
        expect(mixedCodes).toEqual(['brace_syntax']);

        const infosOnly = emptyChecker();
        infosOnly.warn(infosOnly.infos, 0, 'stat_info', 'some statistic', 0, 1);
        expect(buildDiagnostics(infosOnly)).toEqual([]);
    });

    it("stamps every diagnostic with the literal source 'Denizen Script Checker'", () => {
        // MUTANT CAUGHT: changing the source literal (to 'Denizen', 'denizenscript', the
        // extension id, ...). DiagnosticProvider.cs:101/105/109 all pass this exact string;
        // it is what users filter the Problems panel by, and the two engines are runtime
        // switchable, so a different string here is a visibly different Problems panel.
        const checker = emptyChecker();
        checker.warn(checker.errors, 0, 'brace_syntax', 'braces', 0, 1);
        checker.warn(checker.minorWarnings, 1, 'todo_comment', 'todo', 0, 1);
        for (const diagnostic of buildDiagnostics(checker)) {
            expect(diagnostic.source).toBe('Denizen Script Checker');
        }
    });

    it('puts the warning key in code and the custom message form in message', () => {
        // MUTANT CAUGHT: swapping code and message. Both are plain strings and the C#
        // constructor takes them adjacently and positionally (DiagnosticProvider.cs:101,
        // `..., warning.WarningUniqueKey, warning.CustomMessageForm`), so a transposition
        // type-checks cleanly and would put a sentence in the code column.
        const checker = emptyChecker();
        checker.warn(checker.warnings, 4, 'old_defs', 'This script uses <def[old-defs]>.', 2, 9);

        const [diagnostic] = buildDiagnostics(checker);
        expect(diagnostic.code).toBe('old_defs');
        expect(diagnostic.message).toBe('This script uses <def[old-defs]>.');
    });

    it('builds a single-line range from startChar to endChar on the warning line', () => {
        // MUTANT CAUGHT: spilling the range onto a second line (`end.line = line + 1`, the
        // usual way to say "to the end of the line"), or reusing startChar for both ends so
        // the squiggle is zero-width. DiagnosticProvider.cs:93 builds
        // Range(Line, StartChar, Line, EndChar) -- both ends on the same line.
        const checker = emptyChecker();
        checker.warn(checker.warnings, 7, 'old_defs', 'defs', 3, 11);

        const [diagnostic] = buildDiagnostics(checker);
        expect(diagnostic.range).toEqual({
            start: { line: 7, character: 3 },
            end: { line: 7, character: 11 }
        });
    });

    it('clamps a negative startChar to 0', () => {
        // MUTANT CAUGHT: dropping Math.max(0, ...) from startChar. A negative character is
        // not a legal LSP Position, and DiagnosticProvider.cs:90 clamps it explicitly.
        const checker = emptyChecker();
        checker.warn(checker.warnings, 2, 'useless_invalid_line', 'useless', -1, 4);

        expect(buildDiagnostics(checker)[0].range.start.character).toBe(0);
    });

    it('clamps a negative line to 0', () => {
        // MUTANT CAUGHT: dropping Math.max(0, ...) from the line, leaving line -1 in the
        // published range. DiagnosticProvider.cs:89 clamps the line separately from the two
        // character fields, so a clamp applied to only the characters still fails here.
        const checker = emptyChecker();
        checker.warn(checker.warnings, -1, 'useless_invalid_line', 'useless', 0, 4);

        const [diagnostic] = buildDiagnostics(checker);
        expect(diagnostic.range.start.line).toBe(0);
        expect(diagnostic.range.end.line).toBe(0);
    });

    it('clamps a negative endChar to 0', () => {
        // MUTANT CAUGHT: dropping Math.max(0, ...) from endChar. DiagnosticProvider.cs:91
        // clamps all three fields, not just the two that today's checks can go negative on;
        // a clamp written as "line and startChar only" survives every other test here.
        const checker = emptyChecker();
        checker.warn(checker.warnings, 2, 'useless_invalid_line', 'useless', 0, -1);

        expect(buildDiagnostics(checker)[0].range.end.character).toBe(0);
    });

    it('publishes an uppercase useless_invalid_line over the TEXT, not over the indent', () => {
        // MUTANT CAUGHT: reverting lineChecks.ts's useless_invalid_line start to the C#'s
        // `lines[i].indexOf(cleanedLines[i][0])`, or its end to `lines[i].length - 1`. Both
        // were live user-visible defects, fixed by user ruling (see the DELIBERATE DEVIATION
        // note at that check). Pre-fix, "    Hello" produced startChar = -1 -- `cleanedLines`
        // is lowercased while `lines` is not, so the ordinal search for 'h' missed -- and the
        // clamp below turned that into column 0, i.e. the indent. The end stopped at 8,
        // dropping the final 'o'.
        //
        // This is deliberately an END-TO-END assertion through buildDiagnostics rather than a
        // check-level one: the clamp is what MASKED defect 1 into a plausible-looking range,
        // so the fix has to be proven at the published range, which is what the user sees.
        const checker = new ScriptChecker('    Hello');
        checker.run();
        expect(checker.warnings[0].warningUniqueKey).toBe('useless_invalid_line');

        const [diagnostic] = buildDiagnostics(checker);
        expect(diagnostic.range.start.character).toBe(4);
        expect(diagnostic.range.end.character).toBe(9);
    });

    it('has no check left that produces a negative startChar for the clamp to catch', () => {
        // MUTANT CAUGHT: reintroducing a negative-yielding start index in any line check. The
        // clamp above is retained as a faithful port of DiagnosticProvider.cs:89-91, but after
        // the useless_invalid_line fix it no longer has a live producer -- the C# treats a
        // negative index as an anomaly it absorbs (and logs to stderr, :86-92), so a check that
        // starts feeding it one again is a regression, not a supported path. The three clamp
        // tests above therefore stay SYNTHETIC on purpose; this test is what keeps that honest.
        const scripts = ['    Hello', 'Hello', '\tHello', '  Foo', '    <[x]>', '- narrate §C ', '\tBar'];
        for (const script of scripts) {
            const checker = new ScriptChecker(script);
            checker.run();
            for (const warning of [...checker.errors, ...checker.warnings, ...checker.minorWarnings]) {
                expect(warning.startChar, `${JSON.stringify(script)} / ${warning.warningUniqueKey}`)
                    .toBeGreaterThanOrEqual(0);
            }
        }
    });

    it('emits errors first, then warnings, then minorWarnings', () => {
        // MUTANT CAUGHT: reordering the three spreads, or sorting the result by position.
        // DiagnosticProvider.cs:99-110 appends the three lists in that fixed order regardless
        // of line number; the warnings below are seeded in the opposite line order so a
        // position sort produces the reverse of the expectation.
        const checker = emptyChecker();
        checker.warn(checker.minorWarnings, 0, 'todo_comment', 'todo', 0, 1);
        checker.warn(checker.warnings, 1, 'raw_tab_symbol', 'tabs', 0, 1);
        checker.warn(checker.errors, 2, 'brace_syntax', 'braces', 0, 1);

        expect(buildDiagnostics(checker).map(d => d.code))
            .toEqual(['brace_syntax', 'raw_tab_symbol', 'todo_comment']);
    });

    it('returns nothing for a clean script', () => {
        // MUTANT CAUGHT: mapping over `checker.lines` (or otherwise emitting a per-line
        // placeholder) instead of over the three warning lists -- which passes any test that
        // only ever looks at diagnostics[0].
        const checker = new ScriptChecker('my_script:\n    type: task\n    script:\n    - narrate hi\n');
        checker.run();
        expect(buildDiagnostics(checker)).toEqual([]);
    });
});
