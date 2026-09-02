// Inline argument hints against the LIVE meta: take real commands, tokenise their real @Syntax the
// way the server does for signature help, and check what the grey text would say.
//
// This closes the one gap the unit tests cannot: those use hand-written syntax strings, and the
// value of the feature depends entirely on the shapes Denizen actually documents -- which include
// arguments with a dozen slash-separated literals, nested brackets, and lines long enough to fill a
// screen.
//
// Run: node scripts/verify-hints.js
const fs = require('fs');
const path = require('path');
const os = require('os');

const { tokenizeSyntax } = require('../out/server/providers/signatureHelpProvider');
const { parseSyntaxParameter, hintTextFor, remainingArguments } = require('../out/argumentHints');
const { loadMetaDocs, DEFAULT_META_SOURCES } = require('../out/server/metaDocs/metaDocsManager');

const CACHE = path.join(os.tmpdir(), 'denizen-hints-verify-cache.json');

let failures = 0;
function check(name, ok, detail) {
    console.log(`${ok ? 'PASS ' : 'FAIL '} ${name}${detail === undefined ? '' : ` -- ${detail}`}`);
    if (!ok) { failures++; }
}

/** The parameters of a real command, as the provider would receive them from signature help. */
function parametersOf(command) {
    return tokenizeSyntax(command.syntax).map(t => parseSyntaxParameter(t.text));
}

(async () => {
    const meta = await loadMetaDocs({ cacheFile: CACHE, ttlMs: 1000 * 60 * 60 * 12, sources: DEFAULT_META_SOURCES });
    // A PARTIAL DOWNLOAD IS NOT A FAILURE OF THIS CODE, and must not be reported as one. The four
    // meta archives are fetched from github.com in parallel and that connection drops
    // intermittently; a run that gets only Denizen-Core sees 39 commands rather than ~180, and
    // every check below would then measure the wrong thing. Observed three times in a row on
    // 2026-09-02. Skipping loudly is the honest answer -- see the same reasoning in
    // metaDocsManager.ts's stale-cache fallback.
    // The four default sources give 184 commands when all of them arrive. The threshold is set
    // just under that rather than at some comfortable-looking round number: a run with 163 was
    // seen to pass the gate and then fail a check, because a source that half-arrived contributes
    // commands whose @Syntax never parsed. "Nearly all the meta" is still the wrong meta.
    if (meta.commands.size < 180) {
        console.log(`SKIPPED -- only ${meta.commands.size} commands loaded, so the meta is incomplete.`);
        console.log('  Re-run when github.com is reachable. The unit tests in');
        console.log('  src/argumentHints.test.ts are offline and cover the rules themselves.');
        process.exit(0);
    }
    check('meta loaded', true, `${meta.commands.size} commands`);

    // 1 -- the shape the user asked about by name.
    const playsound = meta.commands.get('playsound');
    const psParams = parametersOf(playsound);
    console.log(`      playsound syntax: ${playsound.syntax}`);
    const psHint = hintTextFor(psParams, '- playsound <player.location> ');
    console.log(`      after "<player.location>": ${psHint}`);
    check('1. playsound still asks for its required sound argument',
        psHint !== null && psHint.includes('sound:'), psHint ?? '(nothing)');

    // 2 -- a supplied prefix disappears from the hint, whatever order it was written in.
    const withSound = hintTextFor(psParams, '- playsound sound:block.stone.break <player.location> ');
    check('2. a supplied prefix drops out of the hint', withSound === null || !withSound.includes('sound:'),
        withSound ?? '(nothing left)');

    // 3 -- a command with everything supplied says nothing at all.
    const stop = meta.commands.get('stop');
    check('3. a command with no arguments produces no hint',
        hintTextFor(parametersOf(stop), '- stop ') === null, `stop syntax: ${stop.syntax}`);

    // 4 -- THE NOISE GATE. Denizen has some enormous syntax lines; none may render past the cap.
    let longest = 0;
    let longestName = '';
    let overCap = [];
    for (const [name, command] of meta.commands) {
        const hint = hintTextFor(parametersOf(command), `- ${name} `);
        if (hint === null) { continue; }
        if (hint.length > longest) { longest = hint.length; longestName = name; }
        if (hint.length > 64) { overCap.push(`${name} (${hint.length})`); }
    }
    check('4. no command renders a hint past the cap', overCap.length === 0,
        overCap.slice(0, 5).join(', ') || `longest is ${longestName} at ${longest} chars`);

    // 5 -- every command with documented arguments produces SOMETHING on a bare line. A silent
    // hint everywhere would mean the feature is quietly dead.
    let withArgs = 0, hinted = 0;
    for (const [name, command] of meta.commands) {
        if (parametersOf(command).length === 0) { continue; }
        withArgs++;
        if (hintTextFor(parametersOf(command), `- ${name} `) !== null) { hinted++; }
    }
    check('5. every command with arguments hints on a bare line', hinted === withArgs,
        `${hinted}/${withArgs}`);

    // 6 -- and a fully-written line goes quiet, which is what stops the hint nagging.
    const narrate = meta.commands.get('narrate');
    const nParams = parametersOf(narrate);
    // Every documented argument, including `from:` -- an earlier version of this check left that
    // one out and then blamed the code for still mentioning it. The line is built from the meta
    // rather than typed out, so it cannot drift again when Denizen adds an argument.
    const supplied = '- narrate "hi" ' + nParams
        .filter(p => p.prefix !== null)
        .map(p => `${p.prefix}:x`)
        .join(' ') + ' per_player ';
    console.log(`      narrate syntax: ${narrate.syntax}`);
    console.log(`      fully-supplied line: ${supplied}`);
    console.log(`      remaining: ${remainingArguments(nParams, supplied).map(p => p.text).join(' ') || '(none)'}`);
    check('6. a fully-supplied narrate line goes quiet', hintTextFor(nParams, supplied) === null,
        hintTextFor(nParams, supplied) ?? '(nothing)');

    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
})();
