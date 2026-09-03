/**
 * Live verification for Phase 2B-3: loads real Denizen meta AND real Minecraft enum
 * data over the network, then exercises container key-line completion
 * (material:/entity_type:) against it, plus regression-checks command name/argument
 * completion and signature help from earlier phases.
 * Run with: node scripts/verify-phase2b3.js
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
    loadMetaDocs({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2b3-verify-cache.json'), ttlMs: 12 * 60 * 60 * 1000, sources: DEFAULT_META_SOURCES }),
    loadExtraData({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2b3-verify.fds'), ttlMs: 15 * 24 * 60 * 60 * 1000 })
]).then(([docs, extra]) => {
    console.log(`Loaded ${docs.commands.size} commands, ${docs.loadErrors.length} meta error(s).`);
    console.log(`Enum data: ${extra.sounds.size} sounds, ${extra.materials.size} materials, ${extra.entities.size} entities, ${extra.items.size} items.`);
    let failures = 0;

    // 1. material: key-line completion, with the textEdit range starting where
    // the value begins, not the last word fragment.
    const materialText = '  material: stone_b';
    const materials = provideCompletions(docs, extra, materialText, materialText.length, 0);
    failures += check('material: stone_b completes item/material names starting with stone_b',
        materials.length > 0 && materials.every(i => i.label.startsWith('stone_b')),
        `${materials.length} item(s): ${materials.map(i => i.label).join(', ')}`);
    // Loosened to a lower bound rather than an exact count: this counts real Minecraft
    // block names loaded over the network, which grows as Minecraft adds blocks. An exact
    // count would fail on a data refresh with no code defect. The named-membership check
    // right below still pins the meaningful part.
    failures += check('material: stone_b returns at least 3 items',
        materials.length >= 3, `${materials.length} item(s): ${materials.map(i => i.label).join(', ')}`);
    failures += check('material: stone_b includes stone_brick_slab, stone_brick_stairs, stone_brick_wall',
        ['stone_brick_slab', 'stone_brick_stairs', 'stone_brick_wall'].every(name => materials.some(i => i.label === name)),
        materials.map(i => i.label).join(', '));
    const firstMaterial = materials[0];
    failures += check('first material item has a textEdit',
        !!firstMaterial && !!firstMaterial.textEdit,
        firstMaterial ? JSON.stringify(firstMaterial.textEdit) : 'no items');
    if (firstMaterial && firstMaterial.textEdit) {
        failures += check('first material item textEdit.range is characters 12->19 (value start, not last word fragment)',
            firstMaterial.textEdit.range.start.character === 12 && firstMaterial.textEdit.range.end.character === 19,
            `start=${firstMaterial.textEdit.range.start.character} end=${firstMaterial.textEdit.range.end.character}`);
    }

    // 2. entity_type: key-line completion.
    const entityText = '  entity_type: zomb';
    const entities = provideCompletions(docs, extra, entityText, entityText.length, 0);
    failures += check('entity_type: zomb completes entity types starting with zomb',
        entities.length > 0 && entities.every(i => i.label.startsWith('zomb')),
        `${entities.length} item(s): ${entities.map(i => i.label).join(', ')}`);
    // Loosened to a lower bound for the same reason as the material check above: this
    // counts real Minecraft entity types loaded over the network.
    failures += check('entity_type: zomb returns at least 3 items',
        entities.length >= 3, `${entities.length} item(s): ${entities.map(i => i.label).join(', ')}`);
    failures += check('entity_type: zomb includes zombie, zombie_horse, zombie_villager',
        ['zombie', 'zombie_horse', 'zombie_villager'].every(name => entities.some(i => i.label === name)),
        entities.map(i => i.label).join(', '));

    // 3. An unregistered key yields nothing.
    const titleText = '  title: sto';
    const titles = provideCompletions(docs, extra, titleText, titleText.length, 0);
    failures += check('title: sto (unregistered key) returns nothing',
        titles.length === 0, `${titles.length} item(s): ${titles.map(i => i.label).join(', ')}`);

    // 3b. A key-line whose value contains a tag is suppressed by the C# guard.
    const tagText = '  material: <[m]>';
    const tagResults = provideCompletions(docs, extra, tagText, tagText.length, 0);
    failures += check('material: <[m]> (value contains a tag) returns nothing',
        tagResults.length === 0, `${tagResults.length} item(s): ${tagResults.map(i => i.label).join(', ')}`);

    // 4. Regression: earlier-phase completion behaviour is unaffected.
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

    // 5. Regression: signature help still works.
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
