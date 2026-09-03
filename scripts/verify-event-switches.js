// Drift guard for EVENT_SWITCH_VALUES (denizenEvents.ts), FEATURE-IDEAS.md idea 9.
//
// The three switch value lists are hardcoded because they are prose in the meta, not a machine
// readable field. This asserts the prose still says what the code claims. If Denizen ever adds a
// Bukkit priority or documents `ignorecancelled:false`, this fails instead of the editor quietly
// offering a stale list.
//
// Run: node scripts/verify-event-switches.js
const fs = require('fs');
const path = require('path');

const CACHE = path.join(process.env.LOCALAPPDATA, 'DenizenVSCodeExtension', 'cache', 'meta-blocks-cache.json');
if (!fs.existsSync(CACHE)) {
    console.error('SKIP: no meta cache at ' + CACHE);
    process.exit(0);
}
const blocks = JSON.parse(fs.readFileSync(CACHE, 'utf8')).blocks ?? [];

function languageText(name) {
    for (const b of blocks) {
        if (b.objectType !== 'language') { continue; }
        const lines = b.data ?? [];
        if (lines.some(l => new RegExp('^@name\\s+' + name + '\\s*$', 'i').test(l.trim()))) {
            return lines.join('\n');
        }
    }
    return null;
}

const failures = [];
function check(label, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { console.log(`  OK   ${label}: ${a}`); }
    else { failures.push(`${label}\n     meta says: ${a}\n     code says: ${e}`); }
}

// The code's lists, read out of the source so the two cannot be edited apart.
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'denizenEvents.ts'), 'utf8');
function codeList(key) {
    const m = new RegExp(`\\['${key}',\\s*\\[([^\\]]*)\\]`).exec(src);
    if (m === null) { failures.push(`${key}: not found in EVENT_SWITCH_VALUES`); return null; }
    return m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(s => s.length > 0);
}

console.log('Bukkit Event Priority');
const prio = languageText('Bukkit Event Priority');
if (prio === null) { failures.push('language entry "Bukkit Event Priority" not found'); }
else {
    const m = /Valid priorities, in order of execution, are:\s*([^.]+)\./i.exec(prio);
    if (m === null) { failures.push('the "Valid priorities" sentence is gone from Bukkit Event Priority'); }
    else { check('bukkit_priority', m[1].split(',').map(s => s.trim()), codeList('bukkit_priority')); }
}

console.log('Script Event Cancellation');
const cancel = languageText('Script Event Cancellation');
if (cancel === null) { failures.push('language entry "Script Event Cancellation" not found'); }
else {
    // 'can take a "cancelled:<true/false>" argument and a "ignorecancelled:true" argument.'
    const cm = /"cancelled:<([^>]+)>"/i.exec(cancel);
    check('cancelled', cm === null ? null : cm[1].split('/').map(s => s.trim()), codeList('cancelled'));
    const im = /"ignorecancelled:([^"]+)"/i.exec(cancel);
    check('ignorecancelled', im === null ? null : [im[1].trim()], codeList('ignorecancelled'));
}

// The switches deliberately NOT completed must still be switches, not something else.
console.log('global switches still global');
const globals = new Set();
for (const b of blocks) {
    if (b.objectType !== 'data') { continue; }
    const lines = b.data ?? [];
    if (!lines.some(l => /^@name\s+global_switches\s*$/i.test(l.trim()))) { continue; }
    const values = lines.find(l => /^@values/i.test(l.trim()));
    if (values !== undefined) {
        for (const v of values.replace(/^@values/i, '').split(',')) { globals.add(v.trim().toLowerCase()); }
    }
}
console.log('  global_switches in meta: ' + JSON.stringify([...globals].sort()));
for (const completed of ['bukkit_priority', 'cancelled', 'ignorecancelled']) {
    if (!globals.has(completed)) {
        failures.push(`${completed} is completed everywhere but is no longer a global switch`);
    }
}

if (failures.length > 0) {
    console.error('\nFAILED:\n - ' + failures.join('\n - '));
    process.exit(1);
}
console.log('\nAll event-switch value lists match the meta.');
