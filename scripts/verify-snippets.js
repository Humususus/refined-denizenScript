// Every container skeleton, accepted unedited, must be a container the checker is silent about --
// at any indent width the user's editor might be set to.
//
// This exists because of two defects reported/found on 2026-09-01: the bodies carried literal
// two-space indents (so `editor.tabSize` was ignored), and five of them inserted a line the
// checker immediately warned about. Neither was visible to a unit test, the first because the
// table sat behind extension.ts's `vscode` import and the second because the check needs meta.
//
// Run: node scripts/verify-snippets.js
const fs = require('fs');
const path = require('path');
const os = require('os');

const { CONTAINER_SNIPPETS, containerSnippetText } = require('../out/containerSnippets');
const { ScriptChecker } = require('../out/server/checker/scriptChecker');
const { loadMetaDocs, DEFAULT_META_SOURCES } = require('../out/server/metaDocs/metaDocsManager');
const { loadExtraData } = require('../out/server/metaDocs/extraData');
const { linkEventMatchers } = require('../out/server/metaDocs/metaLinker');

const CACHE = path.join(os.tmpdir(), 'denizen-snippets-verify-cache.json');
const EXTRA_CACHE = path.join(os.tmpdir(), 'denizen-snippets-verify-extra.fds');

let failures = 0;
function check(name, ok, detail) {
    console.log(`${ok ? 'PASS ' : 'FAIL '} ${name}${detail === undefined ? '' : ` -- ${detail}`}`);
    if (!ok) { failures++; }
}

/** Resolve `${n:default}` to its default and `${n}` to nothing, as accepting a snippet unedited does. */
function resolve(text) {
    return text.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\{\d+\}/g, '');
}

(async () => {
    const meta = await loadMetaDocs({ cacheFile: CACHE, ttlMs: 1000 * 60 * 60 * 12, sources: DEFAULT_META_SOURCES });
    const extra = await loadExtraData({ cacheFile: EXTRA_CACHE, ttlMs: 1000 * 60 * 60 * 24 * 15 });
    linkEventMatchers(meta, extra);
    check('meta loaded', meta.commands.size > 100, `${meta.commands.size} commands, ${meta.loadErrors.length} load error(s)`);
    if (meta.commands.size < 100) {
        console.log('\nMeta did not load; the checks below cannot run. See the note in metaDocsManager.ts.');
        process.exit(1);
    }

    // 1 -- indentation is tabs, so the editor's own settings decide the width.
    const spaceIndented = [];
    for (const entry of CONTAINER_SNIPPETS) {
        for (const line of containerSnippetText(entry).split('\n')) {
            if (/^\t* +/.test(line)) { spaceIndented.push(`${entry.type}: ${JSON.stringify(line)}`); }
        }
    }
    check('1. no skeleton indents with literal spaces', spaceIndented.length === 0,
        spaceIndented.join(' | ') || `${CONTAINER_SNIPPETS.length} skeletons, tabs only`);

    // 2 -- every skeleton declares its type and turns debug off, in that order.
    const missing = CONTAINER_SNIPPETS.filter(e => {
        const lines = containerSnippetText(e).split('\n');
        return lines[1] !== `\ttype: ${e.type}` || lines[2] !== '\tdebug: false';
    }).map(e => e.type);
    check('2. every skeleton has "type:" then "debug: false"', missing.length === 0,
        missing.join(', ') || `${CONTAINER_SNIPPETS.length} skeletons`);

    // 3 -- the whole point: inserted at any width, the result must draw no diagnostic at all.
    for (const width of [2, 4, 8]) {
        const dirty = [];
        for (const entry of CONTAINER_SNIPPETS) {
            const text = resolve(containerSnippetText(entry)).replaceAll('\t', ' '.repeat(width));
            const checker = new ScriptChecker(text);
            checker.meta = meta;
            checker.extraData = extra;
            checker.run();
            const found = [...checker.errors, ...checker.warnings, ...checker.minorWarnings];
            if (found.length > 0) {
                dirty.push(`${entry.type}: ${found.map(w => `${w.warningUniqueKey}@L${w.line + 1}`).join(',')}`);
            }
        }
        check(`3. every skeleton checks clean at ${width}-space indentation`, dirty.length === 0,
            dirty.join(' | ') || `${CONTAINER_SNIPPETS.length}/${CONTAINER_SNIPPETS.length} clean`);
    }

    // 4 -- and with real tabs, which is a different input again: the checker expands them itself.
    const tabDirty = [];
    for (const entry of CONTAINER_SNIPPETS) {
        const checker = new ScriptChecker(resolve(containerSnippetText(entry)));
        checker.meta = meta;
        checker.extraData = extra;
        checker.run();
        // `raw_tab_symbol` is EXPECTED here and only here: Denizen itself dislikes literal tabs in
        // a script file, so an editor set to real tabs gets that warning from its own settings, not
        // from the skeleton. Everything else must still be silent.
        const found = [...checker.errors, ...checker.warnings, ...checker.minorWarnings]
            .filter(w => w.warningUniqueKey !== 'raw_tab_symbol');
        if (found.length > 0) {
            tabDirty.push(`${entry.type}: ${found.map(w => w.warningUniqueKey).join(',')}`);
        }
    }
    check('4. every skeleton checks clean with real tabs too (bar raw_tab_symbol)', tabDirty.length === 0,
        tabDirty.join(' | ') || `${CONTAINER_SNIPPETS.length}/${CONTAINER_SNIPPETS.length} clean`);

    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
})();
