/**
 * Live verification for Phase 2B-1: loads real Denizen meta AND real Minecraft enum
 * data over the network, then exercises argument value completion against both.
 * Run with: node scripts/verify-phase2b1.js
 */
const path = require('path');
const os = require('os');
const { loadMetaDocs, DEFAULT_META_SOURCES } = require('../out/server/metaDocs/metaDocsManager');
const { loadExtraData } = require('../out/server/metaDocs/extraData');
const { provideCompletions } = require('../out/server/providers/completionProvider');

function check(label, condition, detail) {
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
    return condition ? 0 : 1;
}

Promise.all([
    loadMetaDocs({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2a-verify-cache.json'), ttlMs: 12 * 60 * 60 * 1000, sources: DEFAULT_META_SOURCES }),
    loadExtraData({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2b1-verify.fds'), ttlMs: 15 * 24 * 60 * 60 * 1000 })
]).then(([docs, extra]) => {
    console.log(`Loaded ${docs.commands.size} commands, ${docs.loadErrors.length} meta error(s).`);
    console.log(`Enum data: ${extra.sounds.size} sounds, ${extra.materials.size} materials, ${extra.entities.size} entities, ${extra.items.size} items.`);
    let failures = 0;

    failures += check('sounds loaded', extra.sounds.size > 1000, `${extra.sounds.size}`);
    failures += check('block.stone.step present', extra.sounds.has('block.stone.step'));

    const soundText = '  - playsound <player.location> sound:block.stone.';
    const sounds = provideCompletions(docs, extra, soundText, soundText.length, 0);
    failures += check('playsound sound: completes real sounds',
        sounds.length > 0 && sounds.every(i => i.label.startsWith('block.stone.')),
        `${sounds.length} item(s), e.g. ${sounds.slice(0, 3).map(i => i.label).join(', ')}`);

    const soundItem = sounds[0];
    const soundReplaced = soundItem && soundItem.textEdit
        ? soundText.slice(0, soundItem.textEdit.range.start.character) + soundItem.textEdit.newText + soundText.slice(soundItem.textEdit.range.end.character)
        : undefined;
    failures += check('playsound completion replaces the whole value (no block.block duplication)',
        !!soundItem && !!soundItem.textEdit && !soundReplaced.includes('block.block') && soundReplaced.endsWith(soundItem.textEdit.newText),
        soundItem ? `newText=${soundItem.textEdit ? soundItem.textEdit.newText : '(none)'} -> ${soundReplaced}` : 'no completion items');

    const castText = '  - cast spe';
    const cast = provideCompletions(docs, extra, castText, castText.length, 0);
    failures += check('cast completes potion effects',
        cast.some(i => i.label === 'speed'),
        `${cast.length} item(s): ${cast.slice(0, 5).map(i => i.label).join(', ')}`);

    const blockText = '  - modifyblock <player.location> stone_b';
    const blocks = provideCompletions(docs, extra, blockText, blockText.length, 0);
    failures += check('modifyblock completes block materials',
        blocks.length > 0,
        `${blocks.length} item(s): ${blocks.slice(0, 3).map(i => i.label).join(', ')}`);

    const nameText = 'my_task:\n  type: task\n  script:\n  - narr';
    failures += check('command name completion still works',
        provideCompletions(docs, extra, nameText, nameText.length, 0).some(i => i.label === 'narrate'));

    const argText = '  - narrate hello for';
    failures += check('command argument completion still works',
        provideCompletions(docs, extra, argText, argText.length, 0).some(i => i.label === 'format:'));

    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}).catch(err => {
    console.error('Verification failed to run:', err);
    process.exit(1);
});
