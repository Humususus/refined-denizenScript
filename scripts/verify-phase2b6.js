/**
 * Live verification for Phase 2B-6: loads real Denizen meta AND real Minecraft enum
 * data over the network, then exercises tag PARAMETER completion (findTagParamAtCursor /
 * completeTagParam / the completionProvider wiring that fires inside a tag's `[...]`)
 * against it, plus regression-checks the tag PART narrowing from Phase 2B-5.
 *
 * This phase's unit suite is fixture-only, and its fixture's headline tag
 * (`playertag.gamemode_at`) is FICTIONAL -- it does not exist in the real corpus. This
 * script is what proves the real dispatch tables (ExtraData-backed enums, the
 * mechanism/`;`-pair/`/`-option branches of `completeParam`, the client-owns-flags
 * boundary) actually fire against real documented parameter specs, not just the
 * hand-written specs baked into the unit fixtures.
 *
 * Run with: node scripts/verify-phase2b6.js
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
    loadMetaDocs({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2b6-verify-cache.json'), ttlMs: 12 * 60 * 60 * 1000, sources: DEFAULT_META_SOURCES }),
    loadExtraData({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2b6-verify.fds'), ttlMs: 15 * 24 * 60 * 60 * 1000 })
]).then(([docs, extra]) => {
    console.log(`Loaded ${docs.commands.size} commands, ${docs.tags.size} tags, ${docs.mechanisms.size} mechanisms, ${docs.loadErrors.length} meta error(s).`);
    console.log(`ExtraData: ${extra.materials.size} materials, ${extra.statistics.size} statistics, ${extra.entities.size} entity types.`);
    let failures = 0;

    // 0. Sanity: the fixture's headline tag really is fictional, and the corpus has real
    // headroom for the exact-count checks below (both are load-bearing preconditions for
    // everything that follows -- if either goes false, the bounds below need revisiting,
    // not the checks themselves).
    failures += check('precondition: "playertag.gamemode_at" (the unit fixture\'s headline tag) does NOT exist in the real corpus',
        docs.tags.get('playertag.gamemode_at') === undefined);
    failures += check('precondition: at least 1000 materials loaded (observed 1568)', extra.materials.size >= 1000, `${extra.materials.size}`);
    failures += check('precondition: at least 50 statistics loaded (observed 84)', extra.statistics.size >= 50, `${extra.statistics.size}`);

    // 1. ExtraData-backed parameter, bare brackets: '<player.item_cooldown[' has documented
    // parameter '<material>', registered via registerEnum -> completeEnum(extra.materials,
    // ..., ''). With an empty typed segment, EVERY value in extra.materials starts with ''
    // (String.startsWith('') is true for the empty string, unconditionally), so this is an
    // EXACT equality with extra.materials.size, not a threshold -- a completer that dropped
    // or duplicated even one material would trip it, and it survives a corpus refresh
    // because both sides are read from the same live `extra` at runtime.
    const cooldownText = '  - narrate <player.item_cooldown[';
    const cooldownItems = provideCompletions(docs, extra, cooldownText, cooldownText.length, 0);
    console.log(`<player.item_cooldown[ (bare): ${cooldownItems.length} item(s) (observed 1568).`);
    failures += check('<player.item_cooldown[ (bare) offers exactly extra.materials.size items',
        cooldownItems.length === extra.materials.size, `${cooldownItems.length} vs ${extra.materials.size}`);
    failures += check('<player.item_cooldown[ (bare) offers a plausible (headroom below observed 1568) count',
        cooldownItems.length >= 1000, `${cooldownItems.length}`);
    failures += check('every <player.item_cooldown[ label is a real, known material',
        cooldownItems.every(i => extra.materials.has(i.label)), '(checked against extra.materials)');

    // 2. Same ExtraData-backed shape, different enum: '<player.statistic[' -> '<statistic>'.
    const statBareText = '  - narrate <player.statistic[';
    const statBareItems = provideCompletions(docs, extra, statBareText, statBareText.length, 0);
    console.log(`<player.statistic[ (bare): ${statBareItems.length} item(s) (observed 84).`);
    failures += check('<player.statistic[ (bare) offers exactly extra.statistics.size items',
        statBareItems.length === extra.statistics.size, `${statBareItems.length} vs ${extra.statistics.size}`);
    failures += check('<player.statistic[ (bare) offers a plausible (headroom below observed 84) count',
        statBareItems.length >= 50, `${statBareItems.length}`);
    // Cardinality alone could be satisfied by a same-size but WRONG set, so assert
    // membership too -- the same pairing the materials check above already has. Together
    // (same size + every label real) these force exactly extra.statistics, since a set of
    // the right size drawn entirely from extra.statistics with no duplicates IS it.
    failures += check('every <player.statistic[ label is a real, known statistic',
        statBareItems.every(i => extra.statistics.has(i.label)), '(checked against extra.statistics)');
    failures += check('<player.statistic[ labels are distinct (with the size and membership checks above, pins the set exactly)',
        new Set(statBareItems.map(i => i.label)).size === statBareItems.length,
        `${new Set(statBareItems.map(i => i.label)).size} distinct of ${statBareItems.length}`);

    // 3. The SAME ExtraData enum ('<material>'), reached through THREE different
    // documented-parameter shapes, must all agree on a typed prefix -- this is the
    // strongest form of "narrows on a typed prefix" available against live data, because
    // the expected set is derived from extra.materials itself (never hardcoded), so it
    // cannot rot as the corpus grows, while a completer that filtered wrongly in any of
    // the three shapes would break the three-way agreement.
    //   a) '<material[sto'      -- the BASE form (partIndex 0), an exact `docs.tags.get`
    //                              lookup (TextDocumentService.cs:516-517), no tracing.
    //   b) '<player.statistic[jump].qualifier[sto' -- a PART form three deep, whose
    //                              documented spec is '<material>/<entity>': the '/'
    //                              branch's <material> special case (completeParam,
    //                              tagParamCompleters.ts:276-278).
    // Confirmed live (see task report) that no real entity type starts with "sto", so the
    // '/'-branch's <entity> half contributes nothing here and the two-branch union in (b)
    // reduces to exactly the same set as (a) -- this is asserted directly below rather than
    // assumed.
    const expectedMaterialsSto = [...extra.materials].filter(m => m.startsWith('sto')).sort();
    failures += check('precondition: at least 10 real materials start with "sto" (observed 15, headroom for the checks below)',
        expectedMaterialsSto.length >= 10, `${expectedMaterialsSto.length}: ${expectedMaterialsSto.join(', ')}`);
    const noEntityStartsWithSto = [...extra.entities].every(e => !e.startsWith('sto'));
    failures += check('precondition: no real entity type starts with "sto" (isolates the <material> half of the qualifier\'s <material>/<entity> spec)',
        noEntityStartsWithSto, noEntityStartsWithSto ? '(none)' : [...extra.entities].filter(e => e.startsWith('sto')).join(', '));

    const materialBaseText = '  - narrate <material[sto';
    const materialBaseItems = provideCompletions(docs, extra, materialBaseText, materialBaseText.length, 0);
    failures += check('<material[sto (base form, exact docs.tags lookup) matches extra.materials filtered by "sto" exactly',
        materialBaseItems.map(i => i.label).sort().join(',') === expectedMaterialsSto.join(','),
        `${materialBaseItems.length} item(s): ${materialBaseItems.map(i => i.label).sort().join(', ')}`);

    const qualifierText = '  - narrate <player.statistic[jump].qualifier[sto';
    const qualifierItems = provideCompletions(docs, extra, qualifierText, qualifierText.length, 0);
    console.log(`<player.statistic[jump].qualifier[sto: ${qualifierItems.length} item(s) (observed 15).`);
    failures += check('<player.statistic[jump].qualifier[sto (3-part chain) matches extra.materials filtered by "sto" exactly',
        qualifierItems.map(i => i.label).sort().join(',') === expectedMaterialsSto.join(','),
        `${qualifierItems.length} item(s): ${qualifierItems.map(i => i.label).sort().join(', ')}`);

    // 4. A registered mechanism-pair spec ('<mechanism>=<value>'): '<player.item_in_hand.
    // with[qua' should offer exactly the one matching mechanism name, suffixed with '='
    // (SuggestMechanisms's `suffix` argument, tagParamCompleters.ts ~:109). An exact array,
    // not a bound: with a specific typed prefix, C#'s `StartsWith` semantics make this
    // deterministic, and "offers quantity=" was the behaviour pinned live during Task 3's
    // review.
    const withQuaText = '  - narrate <player.item_in_hand.with[qua';
    const withQuaItems = provideCompletions(docs, extra, withQuaText, withQuaText.length, 0);
    failures += check('<player.item_in_hand.with[qua offers exactly ["quantity="]',
        withQuaItems.length === 1 && withQuaItems[0].label === 'quantity=',
        `${withQuaItems.length} item(s): ${withQuaItems.map(i => i.label).join(', ')}`);
    // SuggestMechanisms (:211) is its own construction site with its own documentation
    // (DescribeMech in C#, the condensed heading here), so it must NOT pick up
    // CompleteForTagPiece's tag envelope. Pinned next to the enum case in check 5.
    failures += check('a mechanism candidate is NOT wrapped in the tag envelope (SuggestMechanisms, :211)',
        withQuaItems.length === 1 && !!withQuaItems[0].documentation
            && withQuaItems[0].documentation.value === '**ItemTag Mechanism**: quantity',
        withQuaItems.length === 1 && withQuaItems[0].documentation ? JSON.stringify(withQuaItems[0].documentation.value) : '(missing)');

    // 5. A slash-option spec with plain (non-placeholder) options: real live example
    // '<ViveCraftPlayerTag.position[head/left/right]>'. With nothing typed, every
    // documented option must appear, and ONLY the documented options -- an exact set
    // equality, since C#'s '/' branch (CompleteGenericTagParam:174-198) offers precisely
    // the option list, no more and no less, when nothing has narrowed it yet.
    const viveText = '  - narrate <vivecraftplayertag.position[';
    const viveItems = provideCompletions(docs, extra, viveText, viveText.length, 0);
    failures += check('<vivecraftplayertag.position[ (slash-spec, nothing typed) offers exactly its documented options head/left/right',
        viveItems.map(i => i.label).sort().join(',') === ['head', 'left', 'right'].sort().join(','),
        `${viveItems.length} item(s): ${viveItems.map(i => i.label).join(', ')}`);
    // The documentation is CompleteForTagPiece's FULL envelope (CommandTabCompletions.cs:
    // 131-135), not the bare option list. This check previously asserted the bare
    // '**head** / left / right'; it was correct about what the port emitted and wrong
    // about what C# emits, and the final fix wave rendered the envelope. The expectation
    // below is STRICTLY STRONGER than the one it replaces: it still pins the bolded
    // option list, character for character, and additionally pins the '### Tag' heading
    // with the parameter elided to '[...]>', the LinkMeta line, and the ObligatoryText
    // tail -- every piece C# :133 interpolates. Built from the live tag object rather
    // than hardcoded, so it tracks a corpus refresh.
    const viveTag = docs.tags.get('vivecraftplayertag.position');
    failures += check('precondition: the ViveCraft position tag is present and named as the envelope check assumes',
        !!viveTag && viveTag.name === '<ViveCraftPlayerTag.position[head/left/right]>',
        viveTag ? `name=${viveTag.name}, plugin=${viveTag.plugin}, warnings=${viveTag.warnings.length}` : '(missing)');
    // The expected string is written out longhand rather than re-derived from describe.ts,
    // so it cannot agree with the implementation by construction. That is only safe while
    // the tag has no plugin/deprecation/warning text -- ObligatoryText would otherwise add
    // lines -- so that is asserted rather than assumed: if the corpus ever gains them this
    // precondition fails loudly instead of the check quietly drifting.
    failures += check('precondition: the ViveCraft position tag has no plugin/deprecation/warning text (so ObligatoryText is just its own "\\n\\n")',
        !!viveTag && !viveTag.plugin && !viveTag.deprecated && viveTag.warnings.length === 0,
        viveTag ? `plugin=${viveTag.plugin}, deprecated=${viveTag.deprecated}, warnings=${viveTag.warnings.length}` : '(missing)');
    const headItem = viveItems.find(i => i.label === 'head');
    const expectedHeadDoc = '### Tag &lt;ViveCraftPlayerTag.position[...]&gt;\n'
        + '[Meta Docs: Tags vivecraftplayertag.position]'
        + '(https://meta.denizenscript.com/Docs/Tags/vivecraftplayertag.position)\n\n'
        + '**Input option**: **head** / left / right\n\n\n\n';
    failures += check('the "head" slash-option documentation is CompleteForTagPiece\'s full tag envelope, with the chosen option bolded inside it',
        !!headItem && !!headItem.documentation && headItem.documentation.value === expectedHeadDoc,
        headItem && headItem.documentation ? JSON.stringify(headItem.documentation.value) : '(missing)');
    // The two halves separately, so a failure above says WHICH half moved.
    failures += check('the "head" documentation still bolds the chosen option within the full option list',
        !!headItem && !!headItem.documentation && headItem.documentation.value.includes('**Input option**: **head** / left / right'),
        headItem && headItem.documentation ? '(present)' : '(missing)');
    failures += check('the "head" documentation carries the tag heading with its parameter elided to "[...]"',
        !!headItem && !!headItem.documentation && headItem.documentation.value.startsWith('### Tag &lt;ViveCraftPlayerTag.position[...]&gt;\n'),
        headItem && headItem.documentation ? headItem.documentation.value.split('\n')[0] : '(missing)');
    // Enum and mechanism candidates are built at their OWN C# sites and must NOT be
    // wrapped -- CompleteEnum (:206) and SuggestMechanisms (:211) produce their whole
    // markup themselves. This is what stops the envelope from being applied everywhere.
    failures += check('an ExtraData enum candidate is NOT wrapped in the tag envelope (CompleteEnum, :206)',
        cooldownItems.length > 0 && !!cooldownItems[0].documentation
            && cooldownItems[0].documentation.value === `**Material**: ${cooldownItems[0].label}`,
        cooldownItems.length > 0 && cooldownItems[0].documentation ? JSON.stringify(cooldownItems[0].documentation.value) : '(missing)');

    // 6. THE ';'-SPEC CASE -- the most valuable check in this script. Real live tag:
    // '<PlayerTag.worldguard_flag[flag=<flag>(;location=<at>)]>'. Typing 'flag=x;lo' and
    // accepting 'location' must produce '...flag=x;location', NOT '...[location' -- the
    // brief's original design would have deleted the 'flag=x;' the user already typed by
    // replacing from paramStart, a data-loss bug caught in Task 3's review. This asserts
    // the textEdit range starts strictly AFTER the ';' (where "lo" begins), not at
    // paramStart (the column right after '[') -- computed from the input text itself, not
    // hardcoded, so it survives everything except the actual bug reappearing.
    const wgText = '  - narrate <player.worldguard_flag[flag=x;lo';
    const wgItems = provideCompletions(docs, extra, wgText, wgText.length, 0);
    const paramStartCol = wgText.indexOf('[') + 1; // column right after '[' -- the BUGGY range start
    const afterSemicolonCol = wgText.lastIndexOf(';') + 1; // column right after ';' -- the CORRECT range start
    failures += check('precondition: the buggy paramStart column and the correct after-";" column differ (fixture assumption for the check below)',
        paramStartCol !== afterSemicolonCol, `paramStart=${paramStartCol}, after-";"=${afterSemicolonCol}`);
    failures += check('<player.worldguard_flag[flag=x;lo offers exactly ["location"]',
        wgItems.length === 1 && wgItems[0].label === 'location',
        `${wgItems.length} item(s): ${wgItems.map(i => i.label).join(', ')}`);
    if (wgItems.length === 1) {
        const wgEdit = wgItems[0].textEdit;
        failures += check('the "location" textEdit.newText is "location"',
            !!wgEdit && wgEdit.newText === 'location', wgEdit ? wgEdit.newText : '(no textEdit)');
        failures += check('the "location" textEdit range starts right AFTER the ";" (column ' + afterSemicolonCol + '), not at paramStart (column ' + paramStartCol + ')',
            !!wgEdit && wgEdit.range.start.character === afterSemicolonCol && wgEdit.range.start.character !== paramStartCol,
            wgEdit ? `start=${wgEdit.range.start.character}` : '(no textEdit)');
        failures += check('the "location" textEdit range ends at the cursor (column ' + wgText.length + '), covering only "lo"',
            !!wgEdit && wgEdit.range.end.character === wgText.length,
            wgEdit ? `end=${wgEdit.range.end.character}` : '(no textEdit)');
    }

    // 7. General textEdit-covers-only-typed-text check, independent of the ';' case above:
    // '<player.item_in_hand.with[qua' -- the textEdit must cover only the 3 typed
    // characters ("qua"), not the whole bracket contents.
    if (withQuaItems.length === 1) {
        const withEdit = withQuaItems[0].textEdit;
        const quaStartCol = withQuaText.length - 'qua'.length;
        failures += check('the "quantity=" textEdit range covers only the typed "qua" (' + quaStartCol + '->' + withQuaText.length + ')',
            !!withEdit && withEdit.range.start.character === quaStartCol && withEdit.range.end.character === withQuaText.length,
            withEdit ? JSON.stringify(withEdit.range) : '(no textEdit)');
    }

    // 8. The client-owns-flags boundary: '<player.flag[' must offer NOTHING from the
    // server -- not an empty-but-documented answer, literally the same [] a completely
    // unknown bracket would give, so that a future port of C#'s `CompleteFlag`
    // (TextDocumentService.cs:542-545) fails this check loudly instead of silently
    // reintroducing server-side flag name leakage.
    const flagText = '  - narrate <player.flag[';
    const flagItems = provideCompletions(docs, extra, flagText, flagText.length, 0);
    failures += check('<player.flag[ offers NOTHING from the server (client-owns-flags boundary)',
        flagItems.length === 0, `${flagItems.length} item(s): ${flagItems.map(i => i.label).join(', ')}`);

    // 9. Regression: Phase 2B-5's tag-part narrowing and its flag/definitions fallback
    // both still hold with this phase's parameter-completion branch wired in ahead of the
    // tag-part branch (completionProvider.ts's paramCtx-before-tagCtx ordering).
    const playerDotText = '  - narrate <player.';
    const playerTraced = provideCompletions(docs, extra, playerDotText, playerDotText.length, 0);
    const playerUntraced = provideCompletions(docs, extra, playerDotText, playerDotText.length, 0, false);
    console.log(`[regression] <player. narrowing: ${playerTraced.length} traced vs ${playerUntraced.length} untraced (observed 755 vs 1871).`);
    failures += check('[regression] <player. traced is non-empty and strictly narrower than untraced',
        playerTraced.length > 0 && playerTraced.length < playerUntraced.length,
        `${playerTraced.length} vs ${playerUntraced.length}`);

    const flagDotText = '  - narrate <player.flag[home].';
    const flagDotTraced = provideCompletions(docs, extra, flagDotText, flagDotText.length, 0);
    const flagDotUntraced = provideCompletions(docs, extra, flagDotText, flagDotText.length, 0, false);
    failures += check('[regression] <player.flag[home]. traced and untraced still agree exactly (flags/definitions fallback still returns the flat list)',
        flagDotTraced.length === flagDotUntraced.length && flagDotTraced.length > 0
            && flagDotTraced.map(i => i.label).sort().join(',') === flagDotUntraced.map(i => i.label).sort().join(','),
        `${flagDotTraced.length} traced vs ${flagDotUntraced.length} untraced`);

    const baseText = '  - narrate <pla';
    const baseItems = provideCompletions(docs, extra, baseText, baseText.length, 0);
    failures += check('[regression] narrate <pla still offers player among base completions',
        baseItems.some(i => i.label === 'player'),
        `${baseItems.length} item(s): ${baseItems.map(i => i.label).slice(0, 10).join(', ')}`);

    const nameText = 'my_task:\n  type: task\n  script:\n  - narr';
    failures += check('[regression] command name completion still offers narrate',
        provideCompletions(docs, extra, nameText, nameText.length, 0).some(i => i.label === 'narrate'));

    const giveText = '  - give q';
    const give = provideCompletions(docs, extra, giveText, giveText.length, 0);
    failures += check('[regression] give q still returns quantity: first',
        give.length > 0 && give[0].label === 'quantity:',
        `${give.length} item(s): ${give.slice(0, 3).map(i => i.label).join(', ')}`);

    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}).catch(err => {
    console.error('Verification failed to run:', err);
    process.exit(1);
});
