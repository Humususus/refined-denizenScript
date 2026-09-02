// Builds the shareable .vsix: compile, test, then package.
//
//   node scripts/build-vsix.js            compile + tests + package
//   node scripts/build-vsix.js --fast     skip the tests
//
// WHY THIS IS A NODE SCRIPT AND NOT AN npm SCRIPT CHAIN. On the machine this was written for,
// `npm run <anything>` prints the banner and then the child process produces no output and does no
// work -- `npm run compile` exits 0 having emitted zero files, and a probe script's console.log
// never appears. Verified from both Git Bash and PowerShell on 2026-09-01. That is an environment
// defect rather than something this repo can fix, but it makes an npm-script chain the one shape
// the build must not take: `vsce package` runs `vscode:prepublish` -> `npm run compile`, so
// packaging would have silently produced a .vsix built from a stale out/ -- or, when out/ had been
// cleaned, one with no extension code in it at all.
//
// Every step below is therefore spawned directly with spawnSync(process.execPath, ...), the same
// pattern the mutation-audit harness in this repo uses and for the same reason: it is the only
// invocation shape here that reliably runs and reports.
//
// The npm scripts still exist and still work on a healthy machine; `npm run vsix` just calls this.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const fast = process.argv.includes('--fast');

/**
 * Fails with an explanation when the toolchain is not installed.
 *
 * WHAT THIS REPLACES. A tester hit this on 2026-09-01: their `npm install` failed, so
 * node_modules was never created, and every step afterwards died with a raw
 * `Error: Cannot find module '...node_modules/typescript/bin/tsc'` stack trace. That stack says
 * nothing about the actual problem, which happened several commands earlier.
 */
function requireToolchain() {
    const needed = [
        ['node_modules/typescript/bin/tsc', 'typescript'],
        ['node_modules/vitest/vitest.mjs', 'vitest'],
        ['node_modules/@vscode/vsce/vsce', '@vscode/vsce']
    ];
    const missing = needed.filter(([file]) => !fs.existsSync(path.join(ROOT, file)));
    if (missing.length === 0) {
        return;
    }
    console.error('\nThe build toolchain is not installed. Missing: ' + missing.map(m => m[1]).join(', '));
    console.error('\nRun this first, from the folder holding package.json:');
    console.error('    npm install');
    console.error('\nIf npm install itself failed with ERESOLVE, you are on an older checkout:');
    console.error('the @types/node conflict that caused it was fixed on 2026-09-01. Pull, or as a');
    console.error('one-off use `npm install --legacy-peer-deps`.');
    process.exit(1);
}

/** Runs a node entry point from the repo root, streaming its output. Exits the build if it fails. */
function step(label, entry, args) {
    process.stdout.write(`\n=== ${label} ===\n`);
    const result = spawnSync(process.execPath, [entry, ...args], { cwd: ROOT, stdio: 'inherit' });
    if (result.error) {
        console.error(`\n${label} could not start: ${result.error.message}`);
        process.exit(1);
    }
    if (result.status !== 0) {
        console.error(`\n${label} FAILED (exit ${result.status}). No .vsix was written.`);
        process.exit(result.status ?? 1);
    }
}

/** Files that must exist in out/ afterwards, or the package would install and do nothing. */
const REQUIRED_OUTPUT = ['out/extension.js', 'out/server/server.js'];

console.log(`Building ${pkg.name} v${pkg.version}${fast ? '  (--fast: tests skipped)' : ''}`);
requireToolchain();

step('1/3  compile', path.join('node_modules', 'typescript', 'bin', 'tsc'), ['-p', './', '--skipLibCheck']);

// THE CHECK THAT WOULD HAVE CAUGHT THE npm PROBLEM. A compiler that exits 0 without emitting is
// indistinguishable from a successful build by exit code alone, and that is exactly what was
// happening. Assert on the artefacts instead of trusting the status.
const missing = REQUIRED_OUTPUT.filter(f => !fs.existsSync(path.join(ROOT, f)));
if (missing.length > 0) {
    console.error(`\nThe compiler exited 0 but did not produce: ${missing.join(', ')}`);
    console.error('Refusing to package an extension with no code in it.');
    process.exit(1);
}
const built = new Date(fs.statSync(path.join(ROOT, 'out/extension.js')).mtimeMs);
console.log(`out/extension.js written ${built.toISOString()}`);

if (!fast) {
    step('2/3  tests', path.join('node_modules', 'vitest', 'vitest.mjs'), ['run']);
}
else {
    console.log('\n=== 2/3  tests === skipped (--fast)');
}

// Not `vsce` directly -- see the header of scripts/vsce-package.js for the npm defect it works
// around, and why it has to be a wrapper rather than a flag.
step('3/3  package', path.join('scripts', 'vsce-package.js'), []);

const vsix = `${pkg.name}-${pkg.version}.vsix`;
const vsixPath = path.join(ROOT, vsix);
if (!fs.existsSync(vsixPath)) {
    console.error(`\nvsce reported success but ${vsix} is not here.`);
    process.exit(1);
}
const mb = (fs.statSync(vsixPath).size / 1048576).toFixed(2);
console.log(`\nDone: ${vsix}  (${mb} MB)`);
console.log(`  ${vsixPath}`);
console.log('\nTo install it: VS Code -> Extensions -> "..." menu -> Install from VSIX...');
console.log('  or:  code --install-extension ' + vsix);
