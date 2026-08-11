/**
 * Live verification for Phase 2B-2: loads real Denizen meta AND real Minecraft enum
 * data over the network, then exercises signature help against all ~184 real
 * commands, plus regression-checks completion behaviour from earlier phases.
 * Run with: node scripts/verify-phase2b2.js
 */
const path = require('path');
const os = require('os');
const { loadMetaDocs, DEFAULT_META_SOURCES } = require('../out/server/metaDocs/metaDocsManager');
const { loadExtraData } = require('../out/server/metaDocs/extraData');
const { provideSignatureHelp, tokenizeSyntax } = require('../out/server/providers/signatureHelpProvider');
const { provideCompletions } = require('../out/server/providers/completionProvider');

function check(label, condition, detail) {
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
    return condition ? 0 : 1;
}

Promise.all([
    loadMetaDocs({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2b2-verify-cache.json'), ttlMs: 12 * 60 * 60 * 1000, sources: DEFAULT_META_SOURCES }),
    loadExtraData({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2b2-verify.fds'), ttlMs: 15 * 24 * 60 * 60 * 1000 })
]).then(([docs, extra]) => {
    console.log(`Loaded ${docs.commands.size} commands, ${docs.loadErrors.length} meta error(s).`);
    let failures = 0;

    // 1. Signature help on a playsound line: label equals the real @Syntax, with
    // the active parameter landing on the documented [sound:<name>] token.
    const playsound = docs.commands.get('playsound');
    failures += check('playsound command exists', playsound !== undefined);
    if (playsound !== undefined) {
        console.log(`  playsound syntax: ${playsound.syntax}`);
        const playsoundText = '  - playsound <player.location> sound:x ';
        const sh = provideSignatureHelp(docs, playsoundText, playsoundText.length);
        failures += check('playsound signature label equals real syntax',
            sh !== null && sh.signatures[0].label === playsound.syntax,
            sh === null ? 'null' : sh.signatures[0].label);
        failures += check('playsound active parameter is index 2',
            sh !== null && sh.activeParameter === 2,
            sh === null ? 'null' : `activeParameter=${sh.activeParameter}`);
        if (sh !== null && sh.activeParameter !== null) {
            const [s, e] = sh.signatures[0].parameters[sh.activeParameter].label;
            const activeText = sh.signatures[0].label.slice(s, e);
            failures += check('playsound active parameter text is [sound:<name>]',
                activeText === '[sound:<name>]', activeText);
        }
    }

    // 2. inventory tokenises into exactly 4 top-level parameters -- the regression
    // net for the Critical bug this phase fixed, where a bracketed group
    // containing spaces was shredded into fragments by a naive space split.
    const inventory = docs.commands.get('inventory');
    failures += check('inventory command exists', inventory !== undefined);
    if (inventory !== undefined) {
        console.log(`  inventory syntax: ${inventory.syntax}`);
        const invTokens = tokenizeSyntax(inventory.syntax);
        failures += check('inventory tokenises into exactly 4 parameters',
            invTokens.length === 4, `${invTokens.length} token(s): ${invTokens.map(t => t.text).join(' | ')}`);

        const invText = '  - inventory open destination:x';
        const invSh = provideSignatureHelp(docs, invText, invText.length);
        failures += check('inventory active parameter on 2nd argument is (destination:<inventory>)',
            invSh !== null && invSh.activeParameter === 1
                && invSh.signatures[0].label.slice(...invSh.signatures[0].parameters[1].label) === '(destination:<inventory>)',
            invSh === null ? 'null' : `activeParameter=${invSh.activeParameter}`);
    }

    // 3. Sweep every command in the meta: no bracket-unbalanced tokens, and every
    // parameter offset pair indexes correctly into the signature label.
    let totalCommands = 0;
    let totalTokens = 0;
    let unbalancedTokens = 0;
    let badOffsets = 0;
    for (const [, command] of docs.commands) {
        totalCommands++;
        const tokens = tokenizeSyntax(command.syntax);
        for (const token of tokens) {
            totalTokens++;
            let depth = 0;
            let wentNegative = false;
            for (const ch of token.text) {
                if (ch === '[' || ch === '(' || ch === '<') {
                    depth++;
                }
                else if (ch === ']' || ch === ')' || ch === '>') {
                    depth--;
                    if (depth < 0) {
                        wentNegative = true;
                    }
                }
            }
            if (depth !== 0 || wentNegative) {
                unbalancedTokens++;
            }
            if (!(token.start >= 0 && token.start < token.end && token.end <= command.syntax.length)) {
                badOffsets++;
            }
        }
    }
    console.log(`  sweep: ${totalCommands} command(s), ${totalTokens} token(s) total.`);
    failures += check('no command produces a bracket-unbalanced token',
        unbalancedTokens === 0, `${unbalancedTokens}/${totalTokens} unbalanced`);
    failures += check('every parameter offset pair satisfies 0 <= start < end <= label.length',
        badOffsets === 0, `${badOffsets}/${totalTokens} bad offset(s)`);

    // 4. A zero-argument command yields activeParameter === null.
    const stop = docs.commands.get('stop');
    failures += check('stop command exists', stop !== undefined);
    if (stop !== undefined) {
        console.log(`  stop syntax: ${stop.syntax}`);
        const stopText = '  - stop ';
        const stopSh = provideSignatureHelp(docs, stopText, stopText.length);
        failures += check('stop (no arguments) yields activeParameter === null',
            stopSh !== null && stopSh.activeParameter === null,
            stopSh === null ? 'signature itself null' : `activeParameter=${stopSh.activeParameter}`);
    }

    // 5. Regression: earlier-phase completion behaviour is unaffected.
    const nameText = 'my_task:\n  type: task\n  script:\n  - narr';
    failures += check('command name completion still offers narrate',
        provideCompletions(docs, extra, nameText, nameText.length, 0).some(i => i.label === 'narrate'));

    const giveText = '  - give q';
    const give = provideCompletions(docs, extra, giveText, giveText.length, 0);
    failures += check('give q still returns quantity: first',
        give.length > 0 && give[0].label === 'quantity:',
        `${give.length} item(s): ${give.slice(0, 3).map(i => i.label).join(', ')}`);

    const soundText = '  - playsound sound:block.stone.';
    const sounds = provideCompletions(docs, extra, soundText, soundText.length, 0);
    failures += check('playsound sound: still completes real sounds',
        sounds.length > 0 && sounds.every(i => i.label.startsWith('block.stone.')),
        `${sounds.length} item(s), e.g. ${sounds.slice(0, 3).map(i => i.label).join(', ')}`);

    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}).catch(err => {
    console.error('Verification failed to run:', err);
    process.exit(1);
});
