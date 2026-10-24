// Times the language server's check pass on one big file -- the R2 performance baseline.
//
//   node scripts/bench-server.js [file=.superpowers/perf/big.dsc] [runs=10]
//
// Meta is loaded exactly as scripts/verify-phase2d.js loads it, then timed once; each run is a
// fresh `new ScriptChecker(text).run()`, the work the server does ~300 ms after you stop typing.
//
// If every number looks absurd, suspect a partial meta download before the code: the cache files
// in the OS temp folder are shared with the verify scripts.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const { loadMetaDocs, DEFAULT_META_SOURCES } = require('../out/server/metaDocs/metaDocsManager');
const { loadExtraData } = require('../out/server/metaDocs/extraData');
const { linkEventMatchers } = require('../out/server/metaDocs/metaLinker');
const { ScriptChecker } = require('../out/server/checker/scriptChecker');

const file = process.argv[2] || path.join(__dirname, '..', '.superpowers', 'perf', 'big.dsc');
const runs = Number(process.argv[3] || 10);

async function main() {
    if (!fs.existsSync(file)) {
        console.error(`${file} not found. Run node scripts/make-perf-fixture.js first.`);
        process.exit(1);
    }
    const text = fs.readFileSync(file, 'utf8');

    const metaStart = performance.now();
    let docs, extra;
    try {
        [docs, extra] = await Promise.all([
            loadMetaDocs({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2d-verify-cache.json'), ttlMs: 12 * 36e5, sources: DEFAULT_META_SOURCES }),
            loadExtraData({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2d-extra-cache.json'), ttlMs: 12 * 36e5 })
        ]);
    }
    catch (err) {
        console.error(`Could not load the meta (no cache and no network?): ${err instanceof Error ? err.message : err}`);
        process.exit(1);
    }
    linkEventMatchers(docs, extra);
    console.log(`file: ${file} (${text.split('\n').length} lines)`);
    console.log(`meta load: ${(performance.now() - metaStart).toFixed(0)} ms, ${docs.commands.size} commands`);

    const times = [];
    let last = null;
    for (let i = 0; i < runs; i++) {
        const start = performance.now();
        const checker = new ScriptChecker(text);
        checker.meta = docs;
        checker.extraData = extra;
        checker.run();
        times.push(performance.now() - start);
        last = checker;
    }
    const sorted = [...times].sort((a, b) => a - b);
    console.log(`check runs: ${times.map(t => t.toFixed(0)).join(' ')} ms`);
    console.log(`check min / median / max: ${sorted[0].toFixed(1)} / ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} / ${sorted[sorted.length - 1].toFixed(1)} ms`);

    const byKey = new Map();
    for (const w of [...last.errors, ...last.warnings, ...last.minorWarnings]) {
        byKey.set(w.warningUniqueKey, (byKey.get(w.warningUniqueKey) || 0) + 1);
    }
    console.log(`diagnostics: ${[...byKey].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(', ') || 'none'}`);
    // The fixture is supposed to be ordinary scripts at scale. Duplicates mean the renaming in
    // make-perf-fixture.js missed, and the timing above is of error reporting, not checking.
    if ((byKey.get('duplicate_script') || 0) > 0) {
        console.error(`FAIL: ${byKey.get('duplicate_script')} duplicate_script findings -- the fixture is not a valid workload.`);
        process.exit(1);
    }
}

main().catch(err => { console.error(err); process.exit(1); });
