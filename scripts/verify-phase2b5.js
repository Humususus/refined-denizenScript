/**
 * Live verification for Phase 2B-5: loads real Denizen meta AND real Minecraft enum
 * data over the network, links the object-type graph (linkTypeGraph), and exercises
 * traced tag-part completion (traceTag / the completeTagNarrowed branch of
 * completeTag) against it, plus regression-checks command name/argument completion,
 * base tag completion, key-line completion and signature help from earlier phases
 * with tracing at its default (on).
 * Run with: node scripts/verify-phase2b5.js
 */
const path = require('path');
const os = require('os');
const { loadMetaDocs, DEFAULT_META_SOURCES } = require('../out/server/metaDocs/metaDocsManager');
const { loadExtraData } = require('../out/server/metaDocs/extraData');
const { provideCompletions } = require('../out/server/providers/completionProvider');
const { provideSignatureHelp } = require('../out/server/providers/signatureHelpProvider');
const { describeTag } = require('../out/server/providers/describe');

function check(label, condition, detail) {
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
    return condition ? 0 : 1;
}

Promise.all([
    loadMetaDocs({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2b5-verify-cache.json'), ttlMs: 12 * 60 * 60 * 1000, sources: DEFAULT_META_SOURCES }),
    loadExtraData({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2b5-verify.fds'), ttlMs: 15 * 24 * 60 * 60 * 1000 })
]).then(([docs, extra]) => {
    console.log(`Loaded ${docs.commands.size} commands, ${docs.tags.size} tags, ${docs.objectTypes.size} object types, ${docs.loadErrors.length} meta error(s).`);
    let failures = 0;

    // 1. The object-type graph linked (metaLinker.linkTypeGraph, called from
    // loadMetaDocs after applyExtensions): the ObjectTag/ElementTag roots resolve,
    // most object types resolved a baseType, and every tag resolved a returnType.
    // Bounds sit well below what was actually observed while building this phase
    // (72 object types, 63 with a base, 2493 of 2493 tags resolving a returnType) so
    // that a data refresh which adds or removes a handful of types/tags cannot flip
    // this to a false failure, while a genuinely broken link pass (e.g. everything
    // stays null) still trips it.
    failures += check('docs.objectTagType resolved (the ObjectTag root)',
        docs.objectTypes.get('objecttag') !== undefined && docs.objectTagType === docs.objectTypes.get('objecttag'),
        docs.objectTagType ? docs.objectTagType.typeName : 'null');
    failures += check('docs.elementTagType resolved (the ElementTag root)',
        docs.objectTypes.get('elementtag') !== undefined && docs.elementTagType === docs.objectTypes.get('elementtag'),
        docs.elementTagType ? docs.elementTagType.typeName : 'null');
    const typesWithBase = [...docs.objectTypes.values()].filter(t => t.baseType !== null).length;
    failures += check('at least 40 object types resolved a baseType (observed 63/72)',
        typesWithBase >= 40, `${typesWithBase} of ${docs.objectTypes.size}`);
    const tagsWithReturnType = [...docs.tags.values()].filter(t => t.returnType !== null).length;
    failures += check('at least 2000 tags resolved a returnType (observed 2493/2493)',
        tagsWithReturnType >= 2000, `${tagsWithReturnType} of ${docs.tags.size}`);
    failures += check('at least 50 object types have subTags populated (observed 70/72)',
        [...docs.objectTypes.values()].filter(t => t.subTags.size > 0).length >= 50,
        `${[...docs.objectTypes.values()].filter(t => t.subTags.size > 0).length}`);

    // 2. Traced narrowing on a real, deeply-typed base: '<player.' offers strictly
    // fewer parts traced than untraced, and both are non-empty. The subset assertion
    // is the load-bearing one — it cannot pass "by accident" the way two bare counts
    // (one smaller than the other) could if narrowing were simply broken in a way
    // that dropped random items rather than genuinely restricting to PlayerTag's
    // reachable set.
    const playerDotText = '  - narrate <player.';
    const playerTraced = provideCompletions(docs, extra, playerDotText, playerDotText.length, 0);
    const playerUntraced = provideCompletions(docs, extra, playerDotText, playerDotText.length, 0, false);
    console.log(`<player. narrowing: ${playerTraced.length} traced vs ${playerUntraced.length} untraced (observed 755 vs 1871).`);
    failures += check('<player. traced is non-empty', playerTraced.length > 0, `${playerTraced.length}`);
    failures += check('<player. untraced is non-empty', playerUntraced.length > 0, `${playerUntraced.length}`);
    failures += check('<player. traced offers strictly fewer parts than untraced',
        playerTraced.length < playerUntraced.length,
        `${playerTraced.length} vs ${playerUntraced.length}`);
    failures += check('<player. traced offers a plausible (headroom below observed 755) count',
        playerTraced.length >= 200 && playerTraced.length < playerUntraced.length,
        `${playerTraced.length}`);
    // NOTE on why this is a decompose check rather than a raw label-subset check: a
    // narrowed candidate's label is `candidate.afterDotCleaned` verbatim, which can be
    // a COMPOUND string like "regex.group" or "foo.bar" for a tag with a two-part
    // attribute name (real examples on live meta: "regex.group", "replace_text.with",
    // "is.to", "pad_left.with", "proc.context" ...). The flat/untraced branch instead
    // draws from `docs.tagParts`, which `MetaTag.addTo` (metaTypes.ts) fills by
    // SPLITTING every tag's afterDotCleaned on '.' into single-word bits — so "regex"
    // and "group" are each present individually there, but the whole string
    // "regex.group" never is. A literal `playerTraced.every(label in untracedLabels)`
    // therefore fails on real data even though narrowing is working correctly; this is
    // confirmed intentional, not a defect — completionProvider.test.ts's narrowing
    // suite pins exactly this shape (`labelsAt(docs, '<player.f')` expects
    // `['flag', 'foo.bar']`, a fixture-only compound label with no counterpart in
    // ALL_PARTS). The invariant that DOES hold, and still cannot pass by accident, is
    // structural: every piece of a traced label, split on '.', was independently added
    // to the global (not PlayerTag-only) `docs.tagParts` set by whichever tag(s)
    // document it — so decomposing must always succeed for a genuine candidate drawn
    // from `docs.tags`. A narrowing bug that fabricated or corrupted labels would break
    // this just as reliably as a raw subset check would.
    const playerUntracedLabels = new Set(playerUntraced.map(i => i.label));
    const nonDecomposing = playerTraced.filter(i => !i.label.split('.').every(bit => playerUntracedLabels.has(bit)));
    failures += check('<player. traced labels each decompose (split on ".") into pieces that all exist in the untraced flat part set',
        nonDecomposing.length === 0,
        nonDecomposing.length === 0 ? '(all decompose cleanly)' : nonDecomposing.map(i => i.label).join(', '));

    // 3. A flag access returns ObjectTag, so ParsePossibleTypes declines to narrow
    // (TagTracer.cs:126-129) and completeTagNarrowed's own "more than half the object
    // types" guard falls back to the flat list — proving flags are NOT wrongly
    // narrowed. Traced and untraced must offer the exact same count here (an exact
    // equality, not a threshold: it is the "not narrowed at all" invariant, which
    // survives a corpus refresh because both sides grow together).
    const flagText = '  - narrate <player.flag[home].';
    const flagTraced = provideCompletions(docs, extra, flagText, flagText.length, 0);
    const flagUntraced = provideCompletions(docs, extra, flagText, flagText.length, 0, false);
    failures += check('<player.flag[home]. traced and untraced offer the exact same count (flags are not narrowed)',
        flagTraced.length === flagUntraced.length && flagTraced.length > 0,
        `${flagTraced.length} traced vs ${flagUntraced.length} untraced`);
    failures += check('<player.flag[home]. traced labels are identical (as a set) to the untraced labels',
        flagTraced.map(i => i.label).sort().join(',') === flagUntraced.map(i => i.label).sort().join(','),
        `traced-only: ${flagTraced.filter(i => !flagUntraced.some(u => u.label === i.label)).map(i => i.label).join(', ') || '(none)'}`);

    // 4. Prefix narrowing still composes with type narrowing: '<player.na' narrows
    // (strictly fewer than untraced) and still contains a known-real PlayerTag part
    // ('name' — every PlayerTag/EntityTag/OfflinePlayer-alike documents one).
    const naText = '  - narrate <player.na';
    const naTraced = provideCompletions(docs, extra, naText, naText.length, 0);
    const naUntraced = provideCompletions(docs, extra, naText, naText.length, 0, false);
    console.log(`<player.na narrowing: ${naTraced.length} traced vs ${naUntraced.length} untraced (observed 4 vs 7).`);
    failures += check('<player.na traced is non-empty and every label starts with "na"',
        naTraced.length > 0 && naTraced.every(i => i.label.startsWith('na')),
        `${naTraced.length} item(s): ${naTraced.map(i => i.label).join(', ')}`);
    failures += check('<player.na traced offers strictly fewer parts than untraced',
        naTraced.length < naUntraced.length,
        `${naTraced.length} vs ${naUntraced.length}`);
    failures += check('<player.na traced still contains the known-real PlayerTag part "name"',
        naTraced.some(i => i.label === 'name'),
        naTraced.map(i => i.label).join(', '));

    // 5. A narrowed part carries its own documentation (a real MetaTag object, not a
    // synthesized/borrowed one), and specifically fixes the 2B-4 <queue.>/<script>
    // namespace collision: the 'script' part completed after '<queue.' must document
    // QueueTag's OWN 'script' tag, not the unrelated dotless base tag '<script>' that
    // merely happens to share the part's name. Both sides of the comparison are
    // pulled from the live corpus at runtime (via docs.objectTypes/docs.tags and the
    // same describeTag the provider uses) rather than hardcoded text, so this does
    // not depend on the live meta's prose staying byte-for-byte stable.
    const queueText = '  - narrate <queue.';
    const queueTraced = provideCompletions(docs, extra, queueText, queueText.length, 0);
    const scriptItem = queueTraced.find(i => i.label === 'script');
    failures += check('<queue. traced offers a "script" part',
        scriptItem !== undefined, queueTraced.map(i => i.label).join(', '));
    if (scriptItem !== undefined) {
        failures += check('the narrowed "script" item carries documentation',
            !!scriptItem.documentation && typeof scriptItem.documentation.value === 'string' && scriptItem.documentation.value.length > 0,
            scriptItem.documentation ? '(present)' : '(missing)');
        const queueType = docs.objectTypes.get('queuetag');
        failures += check('QueueTag object type resolved (precondition for the next two checks)',
            queueType !== undefined, queueType ? queueType.typeName : 'undefined');
        const realQueueScriptTag = queueType ? queueType.subTags.get('script') : undefined;
        failures += check('QueueTag owns a real "script" subtag in its linked subTags map',
            realQueueScriptTag !== undefined,
            queueType ? `subTags has ${queueType.subTags.size} entries` : 'no QueueTag');
        if (realQueueScriptTag !== undefined && scriptItem.documentation) {
            const expected = describeTag(realQueueScriptTag);
            failures += check('the narrowed "script" item\'s documentation is exactly QueueTag.script\'s own describeTag() output',
                scriptItem.documentation.value === expected.value,
                scriptItem.documentation.value === expected.value ? '(match)' : `got: ${scriptItem.documentation.value.slice(0, 80)}...`);
        }
        const dotlessScript = docs.tags.get('script');
        failures += check('the dotless "<script>" base tag exists in this corpus (precondition for the collision check)',
            dotlessScript !== undefined, dotlessScript ? dotlessScript.name : 'undefined');
        if (dotlessScript !== undefined && scriptItem.documentation) {
            const collision = describeTag(dotlessScript);
            failures += check('the narrowed "script" item\'s documentation is NOT the dotless "<script>" base tag\'s documentation (2B-4 collision fixed)',
                scriptItem.documentation.value !== collision.value,
                scriptItem.documentation.value !== collision.value ? '(distinct, as expected)' : 'BUG: identical to the collision doc');
        }
    }

    // 6. Regression: every non-tag-part-completion assertion from verify-phase2b4.js
    // still holds with tracing at its default (on). Tracing only ever changes the
    // completeTagNarrowed branch (componentCount > 0), so command-name completion,
    // base-tag completion, argument-name completion, enum-value completion, key-line
    // completion and signature help are all expected to be byte-for-byte unaffected;
    // this section re-asserts that against the live corpus rather than assuming it.
    const baseText = '  - narrate <pla';
    const baseItems = provideCompletions(docs, extra, baseText, baseText.length, 0);
    failures += check('[regression] narrate <pla still offers player among base completions',
        baseItems.some(i => i.label === 'player'),
        `${baseItems.length} item(s): ${baseItems.map(i => i.label).slice(0, 10).join(', ')}`);
    const playerItem = baseItems.find(i => i.label === 'player');
    failures += check('[regression] the "player" base item textEdit still replaces only "pla" (13->16)',
        !!playerItem && !!playerItem.textEdit
            && playerItem.textEdit.range.start.character === 13
            && playerItem.textEdit.range.end.character === 16
            && playerItem.textEdit.newText === 'player',
        playerItem ? JSON.stringify(playerItem.textEdit) : 'no player item');

    const nameText = 'my_task:\n  type: task\n  script:\n  - narr';
    failures += check('[regression] command name completion still offers narrate',
        provideCompletions(docs, extra, nameText, nameText.length, 0).some(i => i.label === 'narrate'));

    const giveText = '  - give q';
    const give = provideCompletions(docs, extra, giveText, giveText.length, 0);
    failures += check('[regression] give q still returns quantity: first',
        give.length > 0 && give[0].label === 'quantity:',
        `${give.length} item(s): ${give.slice(0, 3).map(i => i.label).join(', ')}`);

    const soundText = '  - playsound sound:block.stone.';
    const sounds = provideCompletions(docs, extra, soundText, soundText.length, 0);
    failures += check('[regression] playsound sound: still completes real sounds (argument value completion)',
        sounds.length > 0 && sounds.every(i => i.label.startsWith('block.stone.')),
        `${sounds.length} item(s), e.g. ${sounds.slice(0, 3).map(i => i.label).join(', ')}`);

    const materialText = '  material: stone_b';
    const materials = provideCompletions(docs, extra, materialText, materialText.length, 0);
    failures += check('[regression] material: stone_b still completes item/material names (key-line completion)',
        materials.length > 0 && materials.every(i => i.label.startsWith('stone_b')),
        `${materials.length} item(s): ${materials.map(i => i.label).join(', ')}`);

    const playsound = docs.commands.get('playsound');
    failures += check('[regression] playsound command exists', playsound !== undefined);
    if (playsound !== undefined) {
        const playsoundText = '  - playsound <player.location> sound:x ';
        const sh = provideSignatureHelp(docs, playsoundText, playsoundText.length);
        let activeText;
        if (sh !== null && sh.activeParameter !== null) {
            const [s, e] = sh.signatures[0].parameters[sh.activeParameter].label;
            activeText = sh.signatures[0].label.slice(s, e);
        }
        failures += check('[regression] playsound signature help still reports [sound:<name>] active',
            activeText === '[sound:<name>]',
            sh === null ? 'signature help returned null' : `activeParameter=${sh.activeParameter}, text=${activeText}`);
    }

    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}).catch(err => {
    console.error('Verification failed to run:', err);
    process.exit(1);
});
