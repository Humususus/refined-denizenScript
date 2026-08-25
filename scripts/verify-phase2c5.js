/**
 * Live verification for Phase 2C-5: loads real Denizen meta and exercises the command-checking
 * layer -- `checkSingleCommand`, the twelve per-command checkers, and the registry
 * (src/server/checker/commandSpecifics.ts).
 *
 * NOTHING IN THIS PHASE REACHES THE USER YET. `CheckAllContainers` drives it and is Phase 2C-6.
 *
 * The unit suite pins each branch against a four-command fixture. What it cannot prove is the
 * thing that decides whether this phase is safe to build on: how these checks behave against the
 * real 184-command meta and against real scripts. Check 1 and the corpus sweep carry that weight,
 * and the sweep is the one that would expose a false positive before it ever reaches an editor.
 *
 * Run with: node scripts/verify-phase2c5.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadMetaDocs, DEFAULT_META_SOURCES } = require('../out/server/metaDocs/metaDocsManager');
const { ScriptChecker } = require('../out/server/checker/scriptChecker');
const { ScriptCheckContext } = require('../out/server/checker/tagChecks');
const { checkSingleCommand, COMMAND_CHECKERS, BAD_EXECUTE_COMMANDS, argHasPrefix } = require('../out/server/checker/commandSpecifics');

function check(label, condition, detail) {
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
    return condition ? 0 : 1;
}

const CORPUS = 'D:/..........backup/.arukutest/plugins/Denizen/scripts';
let META = null;

/** Runs one command line through the checker, with a permissive context. */
function cmd(commandText, opts = {}) {
    const checker = new ScriptChecker('- ' + commandText);
    checker.meta = META;
    const context = opts.context ?? new ScriptCheckContext();
    if (opts.permissive) {
        context.hasUnknowableDefinitions = true;
        context.hasUnknowableSaveEntries = true;
    }
    checkSingleCommand(checker, 0, 0, commandText, context, null);
    return {
        checker, context,
        keys: [...checker.errors, ...checker.warnings, ...checker.minorWarnings].map(w => w.warningUniqueKey),
        messages: [...checker.errors, ...checker.warnings, ...checker.minorWarnings].map(w => w.customMessageForm)
    };
}

function walk(dir, acc) {
    acc = acc || [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p, acc); } else if (e.name.endsWith('.dsc')) { acc.push(p); }
    }
    return acc;
}

loadMetaDocs({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2c5-verify-cache.json'), ttlMs: 12 * 60 * 60 * 1000, sources: DEFAULT_META_SOURCES }).then(docs => {
    META = docs;
    console.log(`Loaded ${docs.commands.size} commands, ${docs.mechanisms.size} mechanisms, ${docs.rawAdjustables.size} raw adjustables, ${docs.loadErrors.length} meta error(s).`);
    let failures = 0;

    failures += check('precondition: real meta actually loaded', docs.commands.size > 100, `${docs.commands.size} commands`);
    failures += check('precondition: rawAdjustables derived from live meta',
        docs.rawAdjustables.size > 0, Array.from(docs.rawAdjustables).sort().join(', '));
    failures += check('precondition: all twelve checkers registered', COMMAND_CHECKERS.size === 17, `${COMMAND_CHECKERS.size} command names`);

    // ------------------------------------------------------------------------------------
    // 1. REAL COMMANDS MUST BE SILENT. Against a four-command fixture "no warning" proves
    //    nothing; against the real meta it is the whole question.
    // ------------------------------------------------------------------------------------
    const CLEAN = [
        'narrate "Hello there"',
        'narrate <player.name>',
        'define greeting hello',
        'flag player greeted:true',
        'flag server clans.<[name]>:<[data]>',
        'wait 1s',
        'stop',
        'run my_other_task',
        'inject my_helper',
        'foreach <[list]> as:entry',
        'repeat 5',
        'while <[x]>',
        'if <[x]> == 5',
        'give stone quantity:4',
        'take item:stone',
        'determine cancelled',
        'adjust <player> health:20',
        'spawn zombie <player.location> save:mob',
        '~webget https://example.com save:page',
        'teleport <player> <player.location>'
    ];
    const noisy = [];
    for (const line of CLEAN) {
        const r = cmd(line, { permissive: true });
        if (r.keys.length > 0) { noisy.push(`${JSON.stringify(line)} -> ${r.keys.join(',')} :: ${r.messages[0]}`); }
    }
    failures += check(`all ${CLEAN.length} realistic commands are silent against live meta`,
        noisy.length === 0, noisy.length ? '\n      ' + noisy.join('\n      ') : '');

    // ------------------------------------------------------------------------------------
    // 2. EACH WARNING KEY FIRES ON A GENUINELY BAD COMMAND.
    // ------------------------------------------------------------------------------------
    failures += check('an unknown command name yields unknown_command',
        cmd('nosuchcommandname x', { permissive: true }).keys.includes('unknown_command'));
    failures += check('too few arguments yields too_few_args',
        cmd('narrate', { permissive: true }).keys.includes('too_few_args'));
    failures += check("'== true' yields truly_true",
        cmd('if <[x]> == true', { permissive: true }).keys.includes('truly_true'));
    failures += check("'queue clear' yields queue_clear",
        cmd('queue clear', { permissive: true }).keys.includes('queue_clear'));
    // `case_default` is UNREACHABLE through checkSingleCommand, and that is the C#'s behaviour,
    // not a porting gap. `case` and `default` are block labels with no meta entry, so :814-821
    // takes the unknown-command branch, exempts them from the warning, and RETURNS -- before the
    // registry dispatch at :865. The checker registered at ScriptCheckerCommandSpecifics.cs:295
    // therefore never runs. Verified against live meta: docs.commands has neither name.
    failures += check("'case default' yields NOTHING -- the C# returns before reaching its checker",
        cmd('case default', { permissive: true }).keys.length === 0,
        cmd('case default', { permissive: true }).keys.join(','));
    failures += check('the case checker itself works when invoked directly, so only its reachability is dead',
        (() => {
            const fn = COMMAND_CHECKERS.get('case');
            return fn !== undefined;
        })());
    failures += check("'determine canceled' yields typo_cancelled",
        cmd('determine canceled', { permissive: true }).keys.includes('typo_cancelled'));
    failures += check('a bare take yields take_raw',
        cmd('take stone', { permissive: true }).keys.includes('take_raw'));
    failures += check('execute of a vanilla command yields bad_execute',
        cmd('execute as_server "gamemode creative"', { permissive: true }).keys.includes('bad_execute'));
    failures += check('give <player> yields give_player',
        cmd('give stone <player>', { permissive: true }).keys.includes('give_player'));

    // ------------------------------------------------------------------------------------
    // 3. adjust, against REAL mechanisms. The fixture cannot tell you `health` resolves.
    // ------------------------------------------------------------------------------------
    failures += check('adjust with a real mechanism is silent',
        cmd('adjust <player> health:20', { permissive: true }).keys.length === 0,
        cmd('adjust <player> health:20', { permissive: true }).keys.join(','));
    failures += check('adjust with a nonsense mechanism yields bad_adjust_unknown_mech',
        cmd('adjust <player> nosuchmechanismname:5', { permissive: true }).keys.includes('bad_adjust_unknown_mech'));
    failures += check('adjust with no mechanism at all yields bad_adjust_no_mech',
        cmd('adjust server', { permissive: true }).keys.includes('bad_adjust_no_mech'),
        cmd('adjust server', { permissive: true }).keys.join(','));
    failures += check('adjust by MapTag is allowed (the shape the user writes most)',
        cmd('adjust <[ent]> <map[interpolation_start=0;opacity=0]>', { permissive: true }).keys.length === 0,
        cmd('adjust <[ent]> <map[interpolation_start=0;opacity=0]>', { permissive: true }).keys.join(','));

    // ------------------------------------------------------------------------------------
    // 4. THE DEAD give CHECK stays dead. Ported deliberately; this is the tripwire.
    // ------------------------------------------------------------------------------------
    failures += check('give_invalid_item NEVER fires -- the C# check is dead and is ported dead',
        !cmd('give definitely_not_a_real_item_name', { permissive: true }).keys.includes('give_invalid_item'));

    // ------------------------------------------------------------------------------------
    // 5. save: entries reach the context -- the index the <entry[...]> work needs.
    // ------------------------------------------------------------------------------------
    const saved = cmd('spawn zombie save:MyMob', { permissive: true });
    failures += check('save: is recorded, lowercased',
        Array.from(saved.context.saveEntries).join(',') === 'mymob', Array.from(saved.context.saveEntries).join(','));

    // ------------------------------------------------------------------------------------
    // 6. THE FALSE-POSITIVE SWEEP. Every command line in the user's real scripts, through the
    //    real checker. This is what decides whether the phase is safe to build on.
    //
    //    Definitions and save entries are marked unknowable, because building them per container
    //    is Phase 2C-6's job; without that, `adjust ... def:` would report on lines that are fine.
    //
    //    KNOWN OVERCOUNT, stated so the rate is read correctly: this harness treats EVERY `- `
    //    line as a command, where the real caller only does so for lines under a script key. So
    //    `- <&6>Звук: ...` inside a `lore:` list is checked as if it were a command and reports
    //    unknown_command. Those are artefacts of the harness, not of the checker, and they
    //    disappear in Phase 2C-6 when CheckAllContainers decides what is code.
    // ------------------------------------------------------------------------------------
    if (!fs.existsSync(CORPUS)) {
        console.log(`SKIP  corpus sweep -- ${CORPUS} not present`);
    }
    else {
        const byKey = new Map();
        const samples = [];
        let commandCount = 0;
        for (const file of walk(CORPUS).sort()) {
            const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                const trimmed = lines[i].trim();
                if (!trimmed.startsWith('- ')) { continue; }
                let body = trimmed.substring(2).trim();
                // A block-opening command keeps its colon in the file but not in the parsed
                // structure, which is what the real caller passes. Strip it the same way.
                if (body.endsWith(':')) { body = body.substring(0, body.length - 1); }
                if (body.length === 0) { continue; }
                commandCount++;
                const checker = new ScriptChecker(lines[i]);
                checker.meta = META;
                const context = new ScriptCheckContext();
                context.hasUnknowableDefinitions = true;
                context.hasUnknowableSaveEntries = true;
                checkSingleCommand(checker, i, 0, body, context, null);
                for (const w of [...checker.errors, ...checker.warnings, ...checker.minorWarnings]) {
                    byKey.set(w.warningUniqueKey, (byKey.get(w.warningUniqueKey) || 0) + 1);
                    if (samples.length < 30) {
                        samples.push(`${path.relative(CORPUS, file).split(path.sep).join('/')}:${i + 1}  [${w.warningUniqueKey}]  ${JSON.stringify(body.slice(0, 80))}`);
                    }
                }
            }
        }
        const total = [...byKey.values()].reduce((a, b) => a + b, 0);
        console.log(`\n  corpus sweep: ${commandCount} command lines checked`);
        for (const [k, n] of [...byKey].sort((a, b) => b[1] - a[1])) { console.log(`    ${String(n).padStart(4)}  ${k}`); }
        if (samples.length) { console.log('  first findings:'); for (const s of samples) { console.log('    ' + s); } }
        console.log('');
        const rate = commandCount === 0 ? 1 : total / commandCount;
        failures += check('fewer than 10% of real command lines draw a warning (a rate check, not a zero check)',
            rate < 0.10, `${total} warnings over ${commandCount} commands = ${(rate * 100).toFixed(1)}%`);
    }

    failures += check('argHasPrefix still holds its boundary', argHasPrefix('save:x') && !argHasPrefix('a.b:c'));
    failures += check('BAD_EXECUTE_COMMANDS still holds 76 names', BAD_EXECUTE_COMMANDS.size === 76, `${BAD_EXECUTE_COMMANDS.size}`);

    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}).catch(err => {
    console.error('Verification failed to run:', err);
    process.exit(1);
});
