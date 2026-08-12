/**
 * Live verification for Phase 2B-4: loads real Denizen meta AND real Minecraft enum
 * data over the network, then exercises tag completion (tagBases/tagParts/completeTag)
 * against it, plus regression-checks command name/argument completion, key-line
 * completion and signature help from earlier phases.
 * Run with: node scripts/verify-phase2b4.js
 */
const path = require('path');
const os = require('os');
const { loadMetaDocs, DEFAULT_META_SOURCES } = require('../out/server/metaDocs/metaDocsManager');
const { loadExtraData } = require('../out/server/metaDocs/extraData');
const { provideCompletions } = require('../out/server/providers/completionProvider');
const { provideSignatureHelp } = require('../out/server/providers/signatureHelpProvider');

function check(label, condition, detail) {
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
    return condition ? 0 : 1;
}

Promise.all([
    loadMetaDocs({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2b4-verify-cache.json'), ttlMs: 12 * 60 * 60 * 1000, sources: DEFAULT_META_SOURCES }),
    loadExtraData({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2b4-verify.fds'), ttlMs: 15 * 24 * 60 * 60 * 1000 })
]).then(([docs, extra]) => {
    console.log(`Loaded ${docs.commands.size} commands, ${docs.tags.size} tags, ${docs.loadErrors.length} meta error(s).`);
    console.log(`Tag lookup sets: ${docs.tagBases.size} bases, ${docs.tagParts.size} parts, ${docs.tagDeprecations.size} deprecations.`);
    let failures = 0;

    // 1. tagBases/tagParts/tagDeprecations are populated from the real corpus. One
    // day's data observed tags 2493, bases 232, parts 1871, deprecations 145 -- these
    // are observations, not thresholds (Denizen adds tags over time), so the bounds
    // below sit well below what was observed, leaving headroom for growth without
    // going so low that a genuinely broken parse (e.g. only a handful of tags) would
    // slip through as a pass.
    failures += check('at least 1500 tags loaded (observed 2493)',
        docs.tags.size >= 1500, `${docs.tags.size}`);
    failures += check('tagBases has at least 100 entries (observed 232)',
        docs.tagBases.size >= 100, `${docs.tagBases.size}`);
    failures += check('tagParts has at least 1000 entries (observed 1871)',
        docs.tagParts.size >= 1000, `${docs.tagParts.size}`);
    failures += check('tagDeprecations has at least 50 entries (observed 145)',
        docs.tagDeprecations.size >= 50, `${docs.tagDeprecations.size}`);
    // Not just "the seed survived" (createEmptyMetaDocs() unconditionally seeds
    // tagBases with these two, and nothing ever clears/reassigns tagBases -- that
    // alone would be tautological, already covered by the seed's own unit test).
    // This also requires "playertag", which comes only from parsing a real
    // PlayerTag MetaTag in the downloaded corpus, so the check genuinely depends on
    // live loading having worked, not merely on the static seed literal in source.
    failures += check('tagBases carries the static "context"/"entry" seed and also gained "playertag" from real corpus loading',
        docs.tagBases.has('context') && docs.tagBases.has('entry') && docs.tagBases.has('playertag'),
        `context=${docs.tagBases.has('context')} entry=${docs.tagBases.has('entry')} playertag=${docs.tagBases.has('playertag')}`);

    // 2. Base-tag completion: '  - narrate <pla' offers 'player' (among others) as a
    // base candidate, with the textEdit replacing only the typed 'pla'.
    // '  - narrate ' is 12 characters (2 spaces, '-', space, 'narrate', space), '<' is
    // index 12, 'pla' occupies 13-15; the string is 16 characters long.
    const baseText = '  - narrate <pla';
    const baseItems = provideCompletions(docs, extra, baseText, baseText.length, 0);
    failures += check('narrate <pla offers player among base completions',
        baseItems.some(i => i.label === 'player'),
        `${baseItems.length} item(s): ${baseItems.map(i => i.label).slice(0, 10).join(', ')}`);
    failures += check('narrate <pla base completions all start with "pla"',
        baseItems.length > 0 && baseItems.every(i => i.label.startsWith('pla')),
        baseItems.map(i => i.label).join(', '));
    const playerItem = baseItems.find(i => i.label === 'player');
    failures += check('the "player" base item textEdit replaces only "pla" (13->16)',
        !!playerItem && !!playerItem.textEdit
            && playerItem.textEdit.range.start.character === 13
            && playerItem.textEdit.range.end.character === 16
            && playerItem.textEdit.newText === 'player',
        playerItem ? JSON.stringify(playerItem.textEdit) : 'no player item');

    // 3. Part-tag completion, out of TagTracer scope: '  - narrate <player.' offers
    // every known part (no return-type narrowing exists yet in this phase), so its
    // count should equal docs.tagParts.size exactly rather than some smaller
    // "plausible for PlayerTag" number -- narrowing that would be the TagTracer work
    // this phase explicitly does not implement.
    const allPartsText = '  - narrate <player.';
    const allParts = provideCompletions(docs, extra, allPartsText, allPartsText.length, 0);
    failures += check('narrate <player. offers exactly docs.tagParts.size parts (no return-type narrowing in this phase)',
        allParts.length === docs.tagParts.size,
        `${allParts.length} item(s) vs ${docs.tagParts.size} known parts`);
    failures += check('narrate <player. offers a plausible (large) part count',
        allParts.length >= 1000, `${allParts.length}`);

    // 3b. Narrowing by prefix still works once a component follows the dot.
    const naPartsText = '  - narrate <player.na';
    const naParts = provideCompletions(docs, extra, naPartsText, naPartsText.length, 0);
    failures += check('narrate <player.na narrows to parts starting with "na"',
        naParts.length > 0 && naParts.every(i => i.label.startsWith('na')),
        `${naParts.length} item(s): ${naParts.map(i => i.label).join(', ')}`);
    failures += check('narrate <player.na returns strictly fewer parts than the unfiltered set',
        naParts.length < allParts.length,
        `${naParts.length} vs ${allParts.length}`);

    // 4. textEdit on a part completion replaces only the component being typed, not
    // the whole tag. '<' is at index 12, 'player.na' occupies 13-21 (dot at 19), so
    // 'na' -- the component after the dot -- starts at 20; the string is 22 long.
    failures += check('narrate <player.na is 22 characters (fixture assumption for the range check below)',
        naPartsText.length === 22, `${naPartsText.length}`);
    const naItem = naParts[0];
    failures += check('first "na" part item has a textEdit covering only "na" (20->22), not the whole tag',
        !!naItem && !!naItem.textEdit
            && naItem.textEdit.range.start.character === 20
            && naItem.textEdit.range.end.character === 22,
        naItem ? JSON.stringify(naItem.textEdit) : 'no items');

    // 5. Regression: earlier-phase behaviour is unaffected by this phase's changes.
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
    failures += check('playsound sound: still completes real sounds (argument value completion)',
        sounds.length > 0 && sounds.every(i => i.label.startsWith('block.stone.')),
        `${sounds.length} item(s), e.g. ${sounds.slice(0, 3).map(i => i.label).join(', ')}`);

    const materialText = '  material: stone_b';
    const materials = provideCompletions(docs, extra, materialText, materialText.length, 0);
    failures += check('material: stone_b still completes item/material names (key-line completion)',
        materials.length > 0 && materials.every(i => i.label.startsWith('stone_b')),
        `${materials.length} item(s): ${materials.map(i => i.label).join(', ')}`);

    const playsound = docs.commands.get('playsound');
    failures += check('playsound command exists', playsound !== undefined);
    if (playsound !== undefined) {
        const playsoundText = '  - playsound <player.location> sound:x ';
        const sh = provideSignatureHelp(docs, playsoundText, playsoundText.length);
        let activeText;
        if (sh !== null && sh.activeParameter !== null) {
            const [s, e] = sh.signatures[0].parameters[sh.activeParameter].label;
            activeText = sh.signatures[0].label.slice(s, e);
        }
        failures += check('playsound signature help still reports [sound:<name>] active',
            activeText === '[sound:<name>]',
            sh === null ? 'signature help returned null' : `activeParameter=${sh.activeParameter}, text=${activeText}`);
    }

    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}).catch(err => {
    console.error('Verification failed to run:', err);
    process.exit(1);
});
