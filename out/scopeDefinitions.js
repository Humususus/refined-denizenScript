"use strict";
// The definitions Denizen provides implicitly: loop variables inside `- foreach` / `- while` /
// `- repeat`, and the per-entry names inside `filter_tag[...]`, `parse_tag[...]` and friends.
//
// No `vscode` import, so every branch is unit-testable — the same split the other client-side
// features use.
//
// WHY THIS IS NOT A NEW ANALYSIS. The checker already computes exactly these names while walking a
// container (`commandSpecifics.ts`'s registrations for foreach/repeat/while, and the
// `trackDefinition` calls for the `_tag` family), ported from
// ScriptCheckerCommandSpecifics.cs:233-265. Nothing shows them to the user, which is what this
// fixes. The rules are restated here rather than imported because the checker lives in the SERVER
// bundle and reaching into it would pull the whole thing into the client for four small facts.
//
// THAT RESTATEMENT IS A DRIFT RISK, and it is answered by a test rather than by hope:
// `scopeDefinitions.test.ts` drives the checker's own registrations and asserts they agree with
// this module for every command and argument shape. If someone changes one, the test fails.
//
// TWO ASYMMETRIES, both the C#'s and both deliberate — they look like mistakes and are not:
//   `while` gets NO loop variable (no `value`, no `as:` name).
//   `repeat` gets NO `loop_index`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.definitionsInScope = exports.tagScopeDefinitions = exports.enclosingLoopDefinitions = exports.loopDefinitions = void 0;
/** Tag parts that put per-entry definitions in scope, and what those are. */
const TAG_SCOPES = new Map([
    ['filter_tag', ['filter_value', 'filter_key']],
    ['parse_tag', ['parse_value']],
    ['parse_value_tag', ['parse_value', 'parse_key']],
    ['null_if_tag', ['null_if_value']]
]);
/** ASCII-only lowercase, matching `toLowerFast` in the checker. */
function foldAscii(text) {
    let out = '';
    for (const ch of text) {
        const code = ch.charCodeAt(0);
        out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : ch;
    }
    return out;
}
/** The value of a `prefix:` argument on a command line, or null. Quoted and tagged values are kept whole. */
function argumentValue(commandLine, prefix) {
    const match = new RegExp(`(?:^|\\s)${prefix}:(\\S+)`, 'i').exec(commandLine);
    if (match === null) {
        return null;
    }
    // The checker cuts a define name at '.' and ':' (containerConvert.ts:337-346); the same cut
    // applies here so `as:my.thing` offers `my`, which is the name a tag can actually reference.
    return foldAscii(match[1]).split('.')[0].split(':')[0];
}
/**
 * The loop variables a `- foreach` / `- while` / `- repeat` line puts in scope inside its block.
 *
 * `commandLine` is the whole line, indentation and trailing colon included. Anything that is not
 * one of the three commands yields nothing.
 */
function loopDefinitions(commandLine) {
    var _a, _b;
    const match = /^\s*-\s*(?:~|\^)?(foreach|while|repeat)\b(.*)$/i.exec(commandLine);
    if (match === null) {
        return [];
    }
    const command = foldAscii(match[1]);
    const rest = match[2];
    // `- foreach stop` and `- foreach next` end or skip an iteration; they open no block and so
    // define nothing. Same list the missing-colon check reads out of the meta.
    if (/^\s+(stop|next)\b/i.test(rest)) {
        return [];
    }
    const definitions = [];
    const source = `${command} loop`;
    // ScriptCheckerCommandSpecifics.cs:233-252. `while` is excluded from the loop VALUE, and
    // `repeat` from `loop_index`. Both asymmetries are the C#'s.
    if (command !== 'while') {
        definitions.push({ name: (_a = argumentValue(rest, 'as')) !== null && _a !== void 0 ? _a : 'value', source });
    }
    if (command !== 'repeat') {
        definitions.push({ name: 'loop_index', source });
    }
    // :253-265. Only `foreach` takes a key.
    if (command === 'foreach') {
        definitions.push({ name: (_b = argumentValue(rest, 'key')) !== null && _b !== void 0 ? _b : 'key', source });
    }
    return definitions;
}
exports.loopDefinitions = loopDefinitions;
/**
 * The definitions in scope at `line`, from every block enclosing it.
 *
 * Walks UPWARD tracking the smallest indent seen: a line only encloses the cursor if it is
 * indented less than everything between them. That is what stops a sibling `- foreach` earlier in
 * the same block from contributing its loop variable to a place it does not reach.
 *
 * `lines` is the whole document; `line` is the caret's line.
 */
function enclosingLoopDefinitions(lines, line) {
    const definitions = [];
    const indentOf = (text) => text.length - text.trimStart().length;
    let smallest = Number.MAX_SAFE_INTEGER;
    const start = Math.min(line, lines.length - 1);
    // The caret's own line included: standing on the `- foreach` line itself, its variables are
    // about to be in scope and offering them is more useful than not.
    for (let i = start; i >= 0; i--) {
        const text = lines[i];
        if (text.trim().length === 0 || text.trim().startsWith('#')) {
            continue;
        }
        const indent = indentOf(text);
        if (indent >= smallest) {
            continue;
        }
        smallest = indent;
        for (const definition of loopDefinitions(text)) {
            if (!definitions.some(d => d.name === definition.name)) {
                definitions.push(definition);
            }
        }
        if (indent === 0) {
            break;
        }
    }
    return definitions;
}
exports.enclosingLoopDefinitions = enclosingLoopDefinitions;
/**
 * The definitions in scope at `character` on `lineText`, from the tag parameter the caret is in.
 *
 * `<list[a|b].filter_tag[<[filter_value]>...]>` — the names exist only inside that bracket, so the
 * caret has to be within it. Nesting is handled by depth counting, and the innermost enclosing
 * scope wins; an outer `parse_tag` still contributes, because both are in scope at once when one
 * is written inside the other.
 */
function tagScopeDefinitions(lineText, character) {
    const definitions = [];
    for (let open = 0; open < lineText.length && open < character; open++) {
        if (lineText[open] !== '[') {
            continue;
        }
        const close = matchingBracket(lineText, open);
        // The caret must be strictly inside: `[` before it, matching `]` at or after it. An
        // unterminated bracket (close === -1) is the common case while typing, and counts.
        if (close !== -1 && close < character) {
            continue;
        }
        const head = lineText.slice(0, open);
        const cut = Math.max(head.lastIndexOf('.'), head.lastIndexOf('<'));
        const part = foldAscii(head.slice(cut + 1));
        const names = TAG_SCOPES.get(part);
        if (names === undefined) {
            continue;
        }
        for (const name of names) {
            if (!definitions.some(d => d.name === name)) {
                definitions.push({ name, source: `${part}[...]` });
            }
        }
    }
    return definitions;
}
exports.tagScopeDefinitions = tagScopeDefinitions;
/** The index of the `]` matching the `[` at `open`, or -1 when it is never closed. */
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
/** Everything implicitly in scope at the caret: enclosing loops, plus the tag parameter it sits in. */
function definitionsInScope(lines, line, character) {
    var _a;
    const fromTags = tagScopeDefinitions((_a = lines[line]) !== null && _a !== void 0 ? _a : '', character);
    const fromLoops = enclosingLoopDefinitions(lines, line);
    // Tag scopes first: they are the narrower context, so when both offer a name the caret is
    // almost certainly about to use the tag's.
    return [...fromTags, ...fromLoops.filter(l => !fromTags.some(t => t.name === l.name))];
}
exports.definitionsInScope = definitionsInScope;
//# sourceMappingURL=scopeDefinitions.js.map