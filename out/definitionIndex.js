"use strict";
// The decision half of "go to definition": what a `.dsc` file DEFINES, and what the cursor is
// REFERRING to. No `vscode` import, so every branch is unit-testable -- the same split
// `quickFixPlans.ts`, `tagSeparators.ts` and `mutedDiagnostics.ts` use.
//
// WHY THIS IS CLIENT-SIDE. It works on both engines. The C# server never implemented go-to-
// definition at all, so putting it in the TypeScript server would mean the feature vanished
// whenever `denizenscript.server.engine` was set back to `csharp` -- the same reasoning that put
// the Quick Fixes and the map-tag peek on the client.
//
// TWO KINDS OF SYMBOL, and they are found by completely different rules:
//
//   SCRIPT CONTAINERS are top-level keys -- a line at column 0 that ends in ':'. Referenced by
//   `- run <name>`, `- inject <name>`, and the other four commands in RUN_LIKE_COMMANDS.
//
//   FLAGS are written by `- flag <target> <name>[:<value>]`. Referenced from inside a tag's
//   `flag[...]`, `has_flag[...]`, `flag_expiration[...]` or `flag_map[...]` parameter.
//
// Everything here is deliberately line-based rather than a real parse. A definition jump that is
// occasionally missing is a minor annoyance; one that lands on the wrong line is worse than none,
// so every rule below is written to under-match rather than guess.
Object.defineProperty(exports, "__esModule", { value: true });
exports.referenceAt = exports.nameCandidates = exports.indexDefinitions = exports.sameName = void 0;
/**
 * Commands whose FIRST argument names a script container.
 *
 * Taken from `deffableCmdLabels` in extension.ts plus `inject`, which takes a script name the same
 * way but carries no `def:`. `bungeerun` is Depenizen's. A command not listed here is not treated
 * as a script reference at all -- see the under-match rule in the file header.
 */
const RUN_LIKE_COMMANDS = new Set(['run', 'runlater', 'inject', 'clickable', 'bungeerun']);
/** Tag parameters whose contents name a flag. Matches the four the C# server intercepts. */
const FLAG_TAG_PARTS = new Set(['flag', 'has_flag', 'flag_expiration', 'flag_map']);
/** ASCII-only lowercase, matching `toLowerFast` in the checker. Denizen names are ASCII. */
function foldAscii(text) {
    let out = '';
    for (const ch of text) {
        const code = ch.charCodeAt(0);
        out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : ch;
    }
    return out;
}
/** Whether two Denizen names refer to the same thing. Script and flag names are case-insensitive. */
function sameName(a, b) {
    return foldAscii(a) === foldAscii(b);
}
exports.sameName = sameName;
/**
 * Everything `text` defines.
 *
 * Comment lines are skipped rather than parsed: a commented-out `- flag` is not a definition, and
 * jumping to one would be actively misleading.
 */
function indexDefinitions(text) {
    const containers = [];
    const flags = [];
    const lines = text.replace(/\r/g, '').split('\n');
    for (let line = 0; line < lines.length; line++) {
        const raw = lines[line];
        if (raw.trim().startsWith('#')) {
            continue;
        }
        // A container key: column 0, ends in ':', and is not a list entry.
        // The `[^\s:]` on the name is what keeps `on player joins:` and any other indented key out
        // -- those never start at column 0 in a well-formed file, and a key holding a space is a
        // container name Denizen would not accept anyway.
        const container = /^([A-Za-z_][A-Za-z0-9_\-.]*):\s*$/.exec(raw);
        if (container !== null) {
            containers.push({ name: container[1], line, startChar: 0, endChar: container[1].length });
            continue;
        }
        // `- flag <target> <name>[:<value>]`. The target is skipped: it may be `player`, `server`,
        // `npc`, or any tag such as `<[ent]>`, and which of those it is does not change WHERE the
        // flag is written. `expire:` is an argument rather than a name, so it is excluded.
        const flag = /^\s*-\s*(?:~|\^)?flag\s+(\S+)\s+([A-Za-z_][A-Za-z0-9_\-.]*)/i.exec(raw);
        if (flag !== null && foldAscii(flag[2]) !== 'expire') {
            const startChar = raw.indexOf(flag[2], raw.indexOf(flag[1]) + flag[1].length);
            flags.push({ name: flag[2], line, startChar, endChar: startChar + flag[2].length });
            continue;
        }
        // THE OTHER WAY A FLAG GETS WRITTEN, and it is not the `flag` command at all: the `flag`
        // MECHANISM, inside a `with[...]` on an item. Found on the user's real scripts 2026-09-02 --
        // `<item[red_dye].with[display=<&c>Back;flag=pages:prev]>` is where `pages` is set, and
        // `<context.item.flag[pages]>` three lines later had nowhere to jump to without this.
        //
        // A line can carry several, so this collects every match rather than the first. It is
        // matched on the raw text rather than by parsing the tag: the mechanism only ever appears
        // as `flag=<name>` and a false hit would have to be that literal text inside a string.
        for (const mech of raw.matchAll(/\bflag=([A-Za-z_][A-Za-z0-9_\-.]*)/gi)) {
            const startChar = mech.index + mech[0].length - mech[1].length;
            flags.push({ name: mech[1], line, startChar, endChar: startChar + mech[1].length });
        }
    }
    return { containers, flags };
}
exports.indexDefinitions = indexDefinitions;
/**
 * The names to look for when resolving a reference, most specific first.
 *
 * A container reference may name a KEY INSIDE a container rather than the container itself --
 * `- run mafiaLobbyWaiting.wait_text` runs the `wait_text` task of the `mafiaLobbyWaiting`
 * container, and only the container has a top-level definition to jump to. So a dotted script name
 * falls back to its root. Flags do the opposite: `maf.players` is one flag whose name contains a
 * dot, not a `players` key of a `maf` flag, so no fallback applies.
 */
function nameCandidates(kind, name) {
    if (kind !== 'container') {
        return [name];
    }
    const dot = name.indexOf('.');
    return dot <= 0 ? [name] : [name, name.slice(0, dot)];
}
exports.nameCandidates = nameCandidates;
/**
 * What the cursor at `character` on `lineText` refers to, or null.
 *
 * Returns null far more often than not, and that is the design: an unrecognised position must
 * leave VS Code's own behaviour alone rather than offering a wrong jump.
 */
function referenceAt(lineText, character) {
    const flagRef = flagReferenceAt(lineText, character);
    if (flagRef !== null) {
        return flagRef;
    }
    return containerReferenceAt(lineText, character);
}
exports.referenceAt = referenceAt;
/**
 * A flag name under the cursor, inside one of the four flag tag parameters.
 *
 * Scans for `<...flag[` shapes rather than parsing the whole tag, because the cursor only ever
 * needs the ONE bracket group it is inside. The part name is taken from between the last '.' (or
 * '<') and the '[', so `<server.flag[x]>` and `<[ent].flag_map[y]>` are both recognised.
 */
function flagReferenceAt(lineText, character) {
    for (let open = 0; open < lineText.length; open++) {
        if (lineText[open] !== '[') {
            continue;
        }
        // The parameter must contain the cursor: `[` strictly before it, matching `]` at or after.
        const close = matchingBracket(lineText, open);
        if (close === -1 || open >= character || close < character) {
            continue;
        }
        const head = lineText.slice(0, open);
        const cut = Math.max(head.lastIndexOf('.'), head.lastIndexOf('<'));
        if (cut === -1 || !FLAG_TAG_PARTS.has(foldAscii(head.slice(cut + 1)))) {
            continue;
        }
        const name = lineText.slice(open + 1, close);
        // A flag name built from a tag is not a literal this can resolve.
        if (name.length === 0 || name.includes('<')) {
            return null;
        }
        return { kind: 'flag', name, startChar: open + 1, endChar: close };
    }
    return null;
}
/** The index of the `]` matching the `[` at `open`, or -1. Depth-counting, so nesting is safe. */
function matchingBracket(text, open) {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '[') {
            depth++;
        }
        else if (text[i] === ']') {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
}
/**
 * A script container name under the cursor, as the first argument of a run-like command.
 *
 * Only the FIRST argument counts. `- run mytask def:<player>` names one script; the `def:` value
 * is data, and treating any later word as a script name would offer jumps from ordinary arguments.
 */
function containerReferenceAt(lineText, character) {
    const command = /^(\s*-\s*)(?:~|\^)?([A-Za-z_][A-Za-z0-9_]*)(\s+)(\S+)/.exec(lineText);
    if (command === null || !RUN_LIKE_COMMANDS.has(foldAscii(command[2]))) {
        return null;
    }
    const start = command[1].length + (command[0].length - command[1].length - command[4].length);
    const end = start + command[4].length;
    if (character < start || character > end) {
        return null;
    }
    const name = command[4];
    // A name written as a tag cannot be resolved statically, and a `prefix:value` argument in the
    // first slot is not a script name at all.
    if (name.includes('<') || name.includes(':')) {
        return null;
    }
    return { kind: 'container', name, startChar: start, endChar: end };
}
//# sourceMappingURL=definitionIndex.js.map