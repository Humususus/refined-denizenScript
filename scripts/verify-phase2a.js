/**
 * Live verification for Phase 2A: loads real Denizen meta over the network and
 * exercises the completion and hover providers against it.
 * Run with: node scripts/verify-phase2a.js
 */
const path = require('path');
const os = require('os');
const { loadMetaDocs, DEFAULT_META_SOURCES } = require('../out/server/metaDocs/metaDocsManager');
const { provideCompletions } = require('../out/server/providers/completionProvider');
const { provideHover } = require('../out/server/providers/hoverProvider');

const cacheFile = path.join(os.tmpdir(), 'denizen-phase2a-verify-cache.json');

function check(label, condition, detail) {
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
    return condition ? 0 : 1;
}

loadMetaDocs({ cacheFile, ttlMs: 12 * 60 * 60 * 1000, sources: DEFAULT_META_SOURCES }).then(docs => {
    console.log(`Loaded ${docs.commands.size} commands, ${docs.languages.size} languages, ${docs.loadErrors.length} load error(s).`);
    let failures = 0;

    const narrate = docs.commands.get('narrate');
    failures += check('narrate command exists', narrate !== undefined);
    if (narrate === undefined) {
        process.exit(1);
    }
    console.log(`  narrate syntax: ${narrate.syntax}`);
    console.log(`  narrate prefixes: ${narrate.argPrefixes.map(a => a.clean).join(', ')}`);
    console.log(`  narrate flat args: ${narrate.flatArguments.map(a => a.clean).join(', ')}`);
    failures += check('narrate has parsed argument prefixes', narrate.argPrefixes.length > 0);

    const nameText = 'my_task:\n  type: task\n  script:\n  - narr';
    const nameResults = provideCompletions(docs, nameText, nameText.length);
    failures += check('command name completion offers narrate',
        nameResults.some(i => i.label === 'narrate'),
        `got ${nameResults.length} item(s): ${nameResults.map(i => i.label).slice(0, 5).join(', ')}`);

    const argText = '  - narrate hello ';
    const argResults = provideCompletions(docs, argText, argText.length);
    failures += check('argument completion returns items',
        argResults.length > 0,
        `got ${argResults.map(i => i.label).join(', ')}`);

    const hoverText = '  - narrate hello';
    const hover = provideHover(docs, hoverText, 6, 0, 6);
    failures += check('hover on narrate returns documentation',
        hover !== null && hover.contents.value.includes('### Command narrate'));

    const typeText = 'my_task:\n  type: task';
    const typeHover = provideHover(docs, typeText, typeText.length, 1, 12);
    failures += check('hover on a type line returns container docs',
        typeHover !== null,
        typeHover === null ? 'null' : typeHover.contents.value.split('\n')[0]);

    const sampled = [...docs.commands.values()].filter(c => c.syntax && c.syntax.includes(':'));
    const parsed = sampled.filter(c => c.argPrefixes.length > 0);
    failures += check('most colon-bearing commands parsed at least one prefix',
        parsed.length > sampled.length * 0.8,
        `${parsed.length}/${sampled.length}`);

    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}).catch(err => {
    console.error('Verification failed to run:', err);
    process.exit(1);
});
