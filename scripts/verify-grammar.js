// Tokenises real DenizenScript lines through syntaxes/denizenscript.tmLanguage.json the same way
// VS Code does, and asserts on the scope each piece receives.
//
// The TextMate grammar is what actually colours the editor for most users --
// `denizenscript.behaviors.use_custom_syntax_colors` defaults to false, so the theme's own colours
// are used via these scopes, and the legacy decoration path is off. Nothing else in this repo
// exercises the grammar, which is how `- ~narrate` went uncoloured unnoticed.
//
// DEPENDENCIES ARE OPTIONAL ON PURPOSE. `vscode-textmate` and `vscode-oniguruma` are not in
// package.json: adding them needed --legacy-peer-deps to resolve, and making `npm ci` fragile for
// everyone to gain one test script is a bad trade. The script SKIPS cleanly when they are absent
// and tells you how to get them.
//
// Run: node scripts/verify-grammar.js
//   (first: npm install --no-save --legacy-peer-deps vscode-textmate vscode-oniguruma)
const fs = require('fs');
const path = require('path');

const GRAMMAR = path.join(__dirname, '..', 'syntaxes', 'denizenscript.tmLanguage.json');

let vsctm, oniguruma, wasmPath;
try {
    vsctm = require('vscode-textmate');
    oniguruma = require('vscode-oniguruma');
    wasmPath = path.join(path.dirname(require.resolve('vscode-oniguruma')), '..', 'release', 'onig.wasm');
    if (!fs.existsSync(wasmPath)) {
        throw new Error('onig.wasm not found');
    }
}
catch {
    console.log('SKIPPED -- the tokenizer is not installed. To run this:');
    console.log('  npm install --no-save --legacy-peer-deps vscode-textmate vscode-oniguruma');
    console.log('(The grammar JSON is still validated below.)');
    JSON.parse(fs.readFileSync(GRAMMAR, 'utf8'));
    console.log('PASS  the grammar file is valid JSON');
    process.exit(0);
}

let failures = 0;
function check(name, ok, detail) {
    console.log(`${ok ? 'PASS ' : 'FAIL '} ${name}${detail === undefined ? '' : ` -- ${detail}`}`);
    if (!ok) { failures++; }
}

(async () => {
    await oniguruma.loadWASM(fs.readFileSync(wasmPath).buffer);
    const registry = new vsctm.Registry({
        onigLib: Promise.resolve({
            createOnigScanner: p => new oniguruma.OnigScanner(p),
            createOnigString: s => new oniguruma.OnigString(s)
        }),
        loadGrammar: () => Promise.resolve(vsctm.parseRawGrammar(fs.readFileSync(GRAMMAR, 'utf8'), 'denizenscript.tmLanguage.json'))
    });
    const grammar = await registry.loadGrammar('source.denizenscript');

    const tokenize = line => grammar.tokenizeLine(line, vsctm.INITIAL).tokens
        .map(t => ({ text: line.substring(t.startIndex, t.endIndex), scopes: t.scopes }));
    /** Scopes of the first token whose text is exactly `text`, or null. */
    const scopesOf = (line, text) => {
        const tok = tokenize(line).find(t => t.text === text);
        return tok === undefined ? null : tok.scopes;
    };
    const has = (scopes, needle) => scopes !== null && scopes.some(s => s.includes(needle));
    const anyScope = (line, needle) => tokenize(line).some(t => t.scopes.some(s => s.includes(needle)));

    // 1 -- THE REPORTED BUG (2026-09-01). `~` makes a command waitable and `^` makes it run
    // instantly. The name pattern required a letter first, so the whole `~narrate` matched nothing
    // and the command name lost its colour entirely.
    for (const [line, name] of [['    - ~narrate "hi"', 'narrate'], ['    - ~run mytask', 'run'], ['    - ^narrate "hi"', 'narrate']]) {
        check(`1. "${line.trim()}" scopes its command name as a function`,
            has(scopesOf(line, name), 'support.function'), JSON.stringify(scopesOf(line, name)));
    }
    check('1b. the sigil itself is scoped as an operator rather than left plain',
        has(scopesOf('    - ~narrate "hi"', '~'), 'keyword.operator'));

    // 2 -- Denizen has NO end-of-line comment: ScriptChecker.cs:184 tests the trimmed line with
    // StartsWith('#'). The rule used to be unanchored and ran first, so any '#' greyed out the
    // rest of its line.
    check('2. a real comment line is a comment', has(scopesOf('    # hello', '    # hello'), 'comment.line'));
    check('2b. a "#" inside a tag parameter is NOT a comment',
        !anyScope('    - narrate "<&color[#FF0000]>red"', 'comment'));
    check('2c. a "#" mid-argument is NOT a comment', !anyScope('    - narrate channel#5', 'comment'));
    check('2d. the command before a "#" keeps its colour',
        has(scopesOf('    - narrate channel#5', 'narrate'), 'support.function'));

    // 3 -- a key line's value used to be one flat capture, so tags written there (display names,
    // formats, titles -- where tags are commonest) showed in the plain value colour.
    check('3. a tag on a key line is scoped as a tag',
        has(scopesOf('    display name: <&b>Test Blade', '<'), 'meta.tag'));
    check('3b. the key itself is still a section name',
        has(scopesOf('    display name: <&b>Test Blade', 'display name'), 'entity.name.section'));

    // 4 -- regressions across the rest of the grammar.
    check('4. an event line is scoped', has(scopesOf('    on player joins:', 'on player joins'), 'entity.name.section'));
    check('4b. a plain command still scopes as a function', has(scopesOf('    - narrate "hi"', 'narrate'), 'support.function'));
    check('4c. a tag in a command argument is scoped', has(scopesOf('    - narrate <player.name>', '<'), 'meta.tag'));
    check('4d. a double-quoted string is scoped', has(scopesOf('    - narrate "hello there"', '"'), 'string.quoted.double'));
    check('4e. a single-quoted string is scoped', has(scopesOf("    - narrate 'hello there'", "'"), 'string.quoted.single'));
    check('4f. a key with no value is scoped', has(scopesOf('    script:', 'script'), 'entity.name.section'));
    check('4g. an event switch value is scoped',
        has(scopesOf('    on player joins priority:5:', '5'), 'constant.language'));

    // 5 -- ARGUMENT PREFIXES. Added 2026-09-02: the command rule used to be a single `match` that
    // coloured the name and stopped, so `targets:` and `format:` were plain text. It is a
    // begin/end block now, and the risk moved from "not enough colour" to "colour on the wrong
    // thing" -- hence as many negative checks below as positive ones.
    const argLine = '    - narrate hi targets:<player> format:myformat';
    check('5. an argument prefix is scoped as an attribute name',
        has(scopesOf(argLine, 'targets'), 'entity.other.attribute-name')
        && has(scopesOf(argLine, 'format'), 'entity.other.attribute-name'));
    check('5b. its colon is scoped as a separator',
        has(scopesOf(argLine, ':'), 'punctuation.separator.key-value'));
    check('5c. a tag argument is still a tag, not a prefix',
        has(scopesOf(argLine, '<'), 'meta.tag'));

    check('5d. a "def.name" argument keeps its definition scopes',
        has(scopesOf('    - run mytask def.myvar:5', 'def.'), 'variable.other.definition')
        && has(scopesOf('    - run mytask def.myvar:5', 'myvar'), 'variable.other.readwrite'));

    // The block-opening colon of a control-flow command is NOT an argument prefix. Without the
    // lookahead guard this scoped `y` as an argument name on every `- if ... == y:` line.
    check('5e. the block-opening colon does not make an argument name',
        !anyScope('    - if <[x]> == y:', 'entity.other.attribute-name'));

    // A colon inside a string or a tag parameter belongs to the string or the tag.
    check('5f. a colon inside a quoted string is not a prefix',
        !anyScope('    - narrate "text: here"', 'entity.other.attribute-name'));
    check('5g. a colon inside a tag parameter is not a prefix',
        !anyScope('    - narrate <player.flag[a:b]>', 'entity.other.attribute-name'));

    // And a key line is not a command line, so its `key:` keeps its own scope.
    check('5h. a key line is untouched by the command rules',
        has(scopesOf('    display name: <&b>Test', 'display name'), 'entity.name.section')
        && !anyScope('    display name: <&b>Test', 'entity.other.attribute-name'));

    // 6 -- no line may tokenise to nothing, which is what a broken pattern looks like.
    for (const line of ['- ~narrate "hi"', '# c', 'my_task:', '    type: task', '    - if <[x]> == y:']) {
        check(`6. "${line}" produces tokens`, tokenize(line).length > 0);
    }

    // 7 -- REPORTED BUG (2026-09-03): "- if <[start]> < true:" ломает подсветку синтаксиса строк
    // ниже, "- if <[start]> > true:" такого не делает. The #tags rule is begin: "<", end: ">" --
    // a TextMate begin/end pair stays open across line boundaries until its `end` is found. '<'
    // and '>' both double as Denizen's comparison operators, so the bare '<' before "true" (no
    // following '>' anywhere on that line) was read as ANOTHER tag opening and its meta.tag scope
    // leaked into every following line until some unrelated '>' finally closed it. A bare '>' never
    // triggered this because it is only #tags' END pattern, never its begin -- which is exactly why
    // the user saw it with '<' and not with '>'.
    //
    // These checks thread `ruleStack` across two tokenizeLine calls, unlike every check above:
    // a single-line `scopesOf` cannot see a scope that leaks FROM one line INTO the next.
    {
        const threadTwoLines = (first, second) => {
            const r1 = grammar.tokenizeLine(first, vsctm.INITIAL);
            const r2 = grammar.tokenizeLine(second, r1.ruleStack);
            return r2.tokens.map(t => ({ text: second.substring(t.startIndex, t.endIndex), scopes: t.scopes }));
        };
        const NEXT_LINE = '    - narrate "this should be plain text"';

        const afterLt = threadTwoLines('    - if <[start]> < true:', NEXT_LINE);
        check('7. a bare "<" comparison does not open an unclosed tag',
            !afterLt.some(t => t.scopes.some(s => s.includes('meta.tag'))),
            JSON.stringify(afterLt));
        check('7b. the line after it keeps its own command scope',
            afterLt.some(t => t.text === 'narrate' && t.scopes.some(s => s.includes('support.function'))));
        check('7c. and its string keeps its own scope, not the tag body scope',
            afterLt.some(t => t.text === '"' && t.scopes.some(s => s.includes('string.quoted.double')))
            && !afterLt.some(t => t.scopes.some(s => s.includes('entity.name.function.denizenscript'))));

        // The exact "<" line the user contrasted it with, confirming it was never broken.
        const afterGt = threadTwoLines('    - if <[start]> > true:', NEXT_LINE);
        check('7d. "> true:" (the working case) still works, unchanged',
            afterGt.some(t => t.text === 'narrate' && t.scopes.some(s => s.includes('support.function'))));

        // "<=" has the identical begin-with-no-end shape as the reported "<", so it had the same
        // bug even though nobody reported it yet.
        const afterLe = threadTwoLines('    - if <[start]> <= 5:', NEXT_LINE);
        check('7e. "<=" does not open an unclosed tag either',
            !afterLe.some(t => t.scopes.some(s => s.includes('meta.tag'))), JSON.stringify(afterLe));

        // A real tag on the right-hand side of a comparison must still be recognised as one -- the
        // fix must not turn EVERY "<" into an operator, only the ones that are not tag openers.
        check('7f. a genuine tag right after the operator is still scoped as a tag',
            has(scopesOf('    - if <[x]> < <player.name>:', 'player'), 'entity.name.function'));
    }

    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
})();
