// Runs `vsce package`, with a fallback for a machine whose npm cannot report its own dependencies.
//
// WHY THIS WRAPPER EXISTS. vsce works out which folders to pack by shelling out to
// `npm list --production --parseable` (node_modules/@vscode/vsce/out/npm.js:69). On the machine
// this was written for, npm writes NOTHING when its stdout is a pipe -- the exact same command
// prints all twelve dependency folders in a terminal, and returns two bytes through
// child_process.exec. Measured 2026-09-02, and it is not the .cmd shim: invoking
// `node npm-cli.js list ...` through exec is just as empty.
//
// The consequence was silent and total. vsce got an empty dependency list, so it globbed no
// folders at all, so it collected ZERO files, and the only symptom was
// "Extension entrypoint(s) missing: extension/out/extension.js" -- which points at .vscodeignore
// and is entirely misleading.
//
// So: try vsce's own resolution first, and fall back to reading node_modules directly only when it
// comes back empty. On a healthy machine this file changes nothing and the fallback never runs.
//
// It is a patch of a third-party module's export, which is not something to do lightly. It is done
// here rather than in build-vsix.js so the patch is confined to one short file that does nothing
// else, and it patches the property on the module object because package.js dereferences
// `npm_1.getDependencies` at call time rather than capturing it at import.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/**
 * Every production dependency folder, transitively, resolved by walking node_modules.
 *
 * This is what `npm list --production --parseable` would have printed. Resolution follows Node's
 * own rule -- look in the nearest node_modules, then walk up -- so a nested copy of a package
 * (which npm creates on a version conflict) is found where Node would find it.
 */
function resolveProductionDeps(root) {
    const found = new Map();
    const seen = new Set();

    /** The folder Node would resolve `name` to when required from `fromDir`, or null. */
    const resolveFrom = (fromDir, name) => {
        let dir = fromDir;
        for (;;) {
            const candidate = path.join(dir, 'node_modules', name);
            if (fs.existsSync(path.join(candidate, 'package.json'))) {
                return candidate;
            }
            const parent = path.dirname(dir);
            if (parent === dir || dir === root) {
                // Never walk above the extension root: anything outside it is not ours to pack.
                return null;
            }
            dir = parent;
        }
    };

    const visit = (dir) => {
        if (seen.has(dir)) {
            return;
        }
        seen.add(dir);
        let manifest;
        try {
            manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        }
        catch {
            return;
        }
        // `dependencies` only. devDependencies must not ship, and optional/peer ones are either
        // already present as real dependencies or deliberately absent.
        for (const name of Object.keys(manifest.dependencies ?? {})) {
            const resolved = resolveFrom(dir, name);
            if (resolved !== null && !found.has(resolved)) {
                found.set(resolved, true);
                visit(resolved);
            }
        }
    };

    visit(root);
    return [...found.keys()];
}

const npm = require(path.join(ROOT, 'node_modules/@vscode/vsce/out/npm.js'));
const vsce = require(path.join(ROOT, 'node_modules/@vscode/vsce/out/api.js'));

const original = npm.getDependencies;
npm.getDependencies = async function patched(cwd, dependencies, packagedDependencies) {
    let dirs = [];
    try {
        dirs = await original(cwd, dependencies, packagedDependencies);
    }
    catch (err) {
        console.warn(`  vsce's dependency scan failed (${err.message}); falling back to node_modules.`);
    }
    // A healthy machine returns cwd plus one folder per dependency. Anything smaller means the npm
    // call produced nothing useful -- an empty list, or only cwd while dependencies exist.
    const expected = Object.keys(JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).dependencies ?? {});
    if (dirs.length > 1 || expected.length === 0) {
        return dirs;
    }
    const fallback = [cwd, ...resolveProductionDeps(cwd)];
    console.warn(`  npm reported ${dirs.length} dependency folder(s) for ${expected.length} dependencies.`);
    console.warn(`  Falling back to reading node_modules directly: ${fallback.length - 1} folder(s).`);
    return fallback;
};

vsce.createVSIX({ cwd: ROOT })
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err && err.message ? err.message : err);
        process.exit(1);
    });
