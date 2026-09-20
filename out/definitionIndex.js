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
exports.runDefinitionContextAt = exports.runScriptNameContextAt = exports.referenceAt = exports.nameCandidates = exports.containerBoundsAt = exports.indexDefinitions = exports.sameName = exports.parseDefinitionsKey = void 0;
/**
 * The entries of a `definitions:` key, given everything after the colon.
 *
 * `definitions: id[Айди]|target[Энтити]|__player|text` -- pipe-separated, each optionally
 * documented. Real example from the user's own scripts, which is also why the description is kept
 * verbatim rather than folded or trimmed of its own punctuation.
 *
 * SPLITS AT BRACKET DEPTH 0, where the checker's port of this (containerChecks.ts, seeding
 * ScriptCheckContext.definitions) splits on every '|'. The divergence only shows on a description
 * that itself contains a pipe, where the naive split invents a second, nameless entry; the checker
 * gets away with it because it cuts at '[' and throws the description away, and this does not.
 */
function parseDefinitionsKey(value) {
    const results = [];
    let depth = 0;
    let current = '';
    const flush = () => {
        const entry = current.trim();
        current = '';
        if (entry.length === 0) {
            return;
        }
        const open = entry.indexOf('[');
        if (open === -1) {
            results.push({ name: entry, description: null });
            return;
        }
        const name = entry.slice(0, open).trim();
        // `lastIndexOf` rather than the matching bracket: a description may legitimately contain
        // brackets, and the entry ends at the outermost close whatever is nested inside it.
        const close = entry.lastIndexOf(']');
        const description = close > open ? entry.slice(open + 1, close).trim() : entry.slice(open + 1).trim();
        if (name.length === 0) {
            return;
        }
        results.push({ name, description: description.length === 0 ? null : description });
    };
    for (const ch of value) {
        if (ch === '[') {
            depth++;
        }
        else if (ch === ']') {
            depth = Math.max(0, depth - 1);
        }
        else if (ch === '|' && depth === 0) {
            flush();
            continue;
        }
        current += ch;
    }
    flush();
    return results;
}
exports.parseDefinitionsKey = parseDefinitionsKey;
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
    var _a;
    const containers = [];
    const flags = [];
    /** The container whose body the walk is currently inside, for attaching `definitions:`. */
    let openContainer = null;
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
            containers.push({ name: container[1], line, startChar: 0, endChar: container[1].length, definitions: [], containerType: null });
            // A new container ends the previous one, so the next `definitions:` belongs to this.
            openContainer = containers[containers.length - 1];
            continue;
        }
        // The `definitions:` key of the container currently open above.
        //
        // FIRST ONE WINS, and it must be indented. A container's own key is the one that names what
        // `- run` passes in; a deeper `definitions:` -- inside a `data:` block, or under a `path:`
        // sub-key -- is something else, and this walk is line-based and cannot tell how deep it
        // really is. Taking only the first is the same under-match bias as the rest of this file.
        if (openContainer !== null && ((_a = openContainer.definitions) !== null && _a !== void 0 ? _a : []).length === 0) {
            const defs = /^\s+definitions:\s*(.*)$/i.exec(raw);
            if (defs !== null) {
                openContainer.definitions = parseDefinitionsKey(defs[1]);
                continue;
            }
        }
        // The container's `type:` key, on the same first-one-wins terms as `definitions:` above --
        // an item container's `mechanisms:` block, for one, can hold a nested `type:` of its own.
        if (openContainer !== null && openContainer.containerType === null) {
            const type = /^\s+type:\s*(\S+)\s*$/i.exec(raw);
            if (type !== null) {
                openContainer.containerType = foldAscii(type[1]);
                continue;
            }
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
 * The half-open line range of the script container containing `line`.
 *
 * A container starts at a column-0 `name:` key and runs until the next one. Blank and comment
 * lines do not end it -- a comment between two containers reads as part of the first, which costs
 * nothing since nothing is looked up in comments anyway.
 *
 * Returns the WHOLE file when `line` sits above the first container key, which is the honest answer
 * for a file that has none: there is no container to scope to, so nothing is scoped away.
 */
function containerBoundsAt(lines, line) {
    let start = 0;
    for (let i = Math.min(line, lines.length - 1); i >= 0; i--) {
        if (/^[A-Za-z_][A-Za-z0-9_\-.]*:\s*$/.test(lines[i])) {
            start = i;
            break;
        }
    }
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^[A-Za-z_][A-Za-z0-9_\-.]*:\s*$/.test(lines[i])) {
            end = i;
            break;
        }
    }
    return { start, end };
}
exports.containerBoundsAt = containerBoundsAt;
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
/**
 * Commands that accept `def.<name>:<value>` arguments.
 *
 * A strict subset of RUN_LIKE_COMMANDS: `inject` runs a script in the CURRENT queue and shares its
 * definitions, so it documents no `def` argument and offering one would be inventing syntax.
 * Mirrors `deffableCmdLabels` in extension.ts, which drives the same distinction for highlighting.
 */
const DEF_PASSING_COMMANDS = new Set(['run', 'runlater', 'clickable', 'bungeerun']);
/**
 * Whether the cursor is in the SCRIPT NAME slot of a run-like command, and what is typed there.
 *
 * The mirror image of `runDefinitionContextAt`: that one wants the caret past the name, this one
 * wants it inside. `inject` is included here where it is excluded there -- it names a script the
 * same way, it just takes no `def` arguments once it has one.
 *
 * Returns null the moment the slot holds something that is not a plain name: a `<tag>` cannot be
 * resolved statically, and a `prefix:value` means the author skipped the script argument entirely.
 */
function runScriptNameContextAt(lineText, character) {
    const head = /^(\s*-\s*)(?:~|\^)?([A-Za-z_][A-Za-z0-9_]*)(\s+)/.exec(lineText);
    if (head === null || !RUN_LIKE_COMMANDS.has(foldAscii(head[2]))) {
        return null;
    }
    const argStart = head[0].length;
    if (character < argStart) {
        return null;
    }
    // The first argument runs to the next whitespace. A caret past it is editing a LATER argument,
    // which is runDefinitionContextAt's business rather than this one's.
    let argEnd = argStart;
    while (argEnd < lineText.length && !/\s/.test(lineText[argEnd])) {
        argEnd++;
    }
    if (character > argEnd) {
        return null;
    }
    const typed = lineText.slice(argStart, character);
    if (typed.includes('<') || typed.includes(':')) {
        return null;
    }
    return { typed };
}
exports.runScriptNameContextAt = runScriptNameContextAt;
/**
 * The `- run <script>` line the cursor is on, or null.
 *
 * Distinct from `containerReferenceAt` because the two want opposite positions: that one needs the
 * cursor ON the script name, this one needs it AFTER, in the argument area. Firing while the name
 * is still being typed would offer to fill in definitions for a script the author has not finished
 * naming, and would fight the script-name completion for the same keystrokes.
 */
function runDefinitionContextAt(lineText, character) {
    const command = /^(\s*-\s*)(?:~|\^)?([A-Za-z_][A-Za-z0-9_]*)(\s+)(\S+)/.exec(lineText);
    if (command === null || !DEF_PASSING_COMMANDS.has(foldAscii(command[2]))) {
        return null;
    }
    const name = command[4];
    // Same two exclusions as containerReferenceAt: a name built from a tag cannot be resolved
    // statically, and a `prefix:value` in the first slot is an argument, not a script name.
    if (name.includes('<') || name.includes(':')) {
        return null;
    }
    const nameEnd = command[0].length;
    // Strictly after, and after at least one space: at `nameEnd` itself the caret is still touching
    // the last letter of the name.
    if (character <= nameEnd) {
        return null;
    }
    const prefix = lineText.slice(0, character);
    const lastSpace = prefix.lastIndexOf(' ');
    const typed = lastSpace === -1 ? '' : prefix.slice(lastSpace + 1);
    // A caret inside an unclosed tag is writing a VALUE, not an argument name.
    if (typed.includes('<')) {
        return null;
    }
    const present = new Set();
    for (const match of lineText.matchAll(/(?:^|\s)def\.([^\s:]+):/gi)) {
        present.add(foldAscii(match[1]));
    }
    return { scriptName: name, present, typed };
}
exports.runDefinitionContextAt = runDefinitionContextAt;
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