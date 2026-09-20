"use strict";
// What a `- define <id> <value>` line actually assigns, for hover on `<[id]>` -- user request
// 2026-09-03: "в ховер <[define]> было бы прикольно смотреть что туда записано".
//
// No `vscode` import, so every branch is unit-testable -- the same split `definitionIndex.ts`,
// `quickFixPlans.ts` and `tagSeparators.ts` use.
//
// SCOPED TO THE PLAIN "SET" FORM ONLY, and that scoping is read out of the meta rather than
// assumed. `Define`'s documented syntax is `define [<id>](:<action>)[:<value>]`: besides a bare
// `- define name value`, real scripts use `- define name:->:value` (a data-action append) and
// `- define name:!` (remove) -- both put the value's meaning behind an action this module does not
// interpret, so showing "value" for them would be showing something that is not the value. Under-
// matching these (returning nothing) is deliberate, following `definitionIndex.ts`'s own rule: "a
// definition jump that is occasionally missing is a minor annoyance; one that lands on the wrong
// line is worse than none." The identical reasoning applies to a DYNAMIC name -- found in the
// user's own corpus, `- define overwriteSlots.<[slot]> <[item]>` -- which cannot be resolved
// without evaluating `<[slot]>`, so it is left unmatched rather than guessed at.
//
// `definemap` is NOT covered. Its syntax builds a whole map from `key:value` pairs across one or
// more lines, which is a different shape entirely (no single "the value") and a rarer command in
// practice than `define`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.findDefineAssignments = exports.definitionReferenceAt = exports.activeAssignment = void 0;
/** ASCII-only lowercase, matching `toLowerFast` in the checker and `definitionIndex.ts`'s own fold. */
function foldAscii(text) {
    let out = '';
    for (const ch of text) {
        const code = ch.charCodeAt(0);
        out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : ch;
    }
    return out;
}
/**
 * The assignment that answers "what is in `<[id]>` here", out of those already scoped to one
 * container, or null when there are none.
 *
 * Prefers the last one AT OR ABOVE `line`, because that is the one that has run by the time
 * execution reaches the hovered line. Falls back to the last in the container when the author
 * hovers a use that sits above every assignment of that name -- showing a later line, labelled
 * with its number, beats showing nothing.
 *
 * This provider used to list every assignment instead, on the grounds that which one is live can
 * vary by branch or loop iteration. That is true and is why the line number is always rendered;
 * in practice the full list filled the popup with lines the author was not asking about.
 */
function activeAssignment(found, line) {
    if (found.length === 0) {
        return null;
    }
    for (let i = found.length - 1; i >= 0; i--) {
        if (found[i].line <= line) {
            return found[i];
        }
    }
    return found[found.length - 1];
}
exports.activeAssignment = activeAssignment;
/**
 * The `<[id]>` reference the cursor sits inside on this line, sub-map dots included — or null.
 *
 * THE WHOLE BRACKET CONTENT IS THE NAME, dots and all: the `Define` command's own description
 * states `<[a.b.c]>` is equivalent to `<[a].get[b].get[c]>`, so a sub-mapped reference is written
 * as one dotted id, not as `<[a]>` followed by tag-chaining. A name containing `<` or `>` (a tag
 * used to build the id dynamically, e.g. `<[<[prefix]>_suffix]>`) is refused rather than guessed
 * at -- there is no static text to look up in that case.
 */
function definitionReferenceAt(line, character) {
    // MATCHES `<[name]` WITHOUT REQUIRING THE `>`. Requiring `]>` meant the hover only ever fired
    // on a bare `<[ent]>` and went silent the moment the author read anything off it --
    // `<[ent].some.tags>` has a '.' where the pattern wanted '>', so it did not match at all. That
    // is the commoner form by far, and it was reported as the hover simply not working.
    //
    // The bracket content is still the whole name, dots included: `Define`'s own description states
    // `<[a.b.c]>` is equivalent to `<[a].get[b].get[c]>`. What follows the ']' is tag parts, which
    // belong to the tag rather than to the definition being looked up.
    for (const m of line.matchAll(/<\[([^\[\]<>]*)\]/g)) {
        const start = m.index;
        // The '>' is taken in when the reference IS the whole tag, so the hover area over a bare
        // `<[id]>` is exactly what it was before this pattern changed.
        const afterBracket = start + m[0].length;
        const end = line[afterBracket] === '>' ? afterBracket + 1 : afterBracket;
        if (character < start || character > end) {
            continue;
        }
        const name = m[1];
        return name.length === 0 ? null : { name, start, end };
    }
    return null;
}
exports.definitionReferenceAt = definitionReferenceAt;
/**
 * Every plain `- define <name> <value>` (or `- ~define ...`) assignment of `name` in `text`, in
 * file order, optionally restricted to a half-open line range.
 *
 * Comment lines are skipped, matching `definitionIndex.ts`: a commented-out assignment is not one.
 *
 * `scope` is how the hover stays inside ONE container. A definition is queue-scoped, so a `- define
 * hook` in a different container of the same file is a different variable that happens to share a
 * name -- listing it was reported as the hover "showing every value in every script".
 */
function findDefineAssignments(text, name, scope) {
    const target = foldAscii(name);
    const results = [];
    const lines = text.replace(/\r/g, '').split('\n');
    const from = scope === undefined ? 0 : Math.max(0, scope.start);
    const to = scope === undefined ? lines.length : Math.min(lines.length, scope.end);
    // Name: the same identifier-plus-dot shape `argumentValue` in scopeDefinitions.ts reads a
    // define target from, so a sub-mapped id like `myroot.mykey` is captured whole. Requiring
    // whitespace directly after the name is what excludes `name:->:value` and `name:!`: both put a
    // ':' there instead, so neither reaches this pattern at all -- not matched with the wrong
    // meaning, simply not matched.
    const pattern = /^\s*-\s*(~?)define\s+([A-Za-z_][A-Za-z0-9_.]*)\s+(.+)$/i;
    for (let line = from; line < to; line++) {
        const raw = lines[line];
        if (raw.trim().startsWith('#')) {
            continue;
        }
        const m = pattern.exec(raw);
        if (m === null) {
            continue;
        }
        if (foldAscii(m[2]) !== target) {
            continue;
        }
        results.push({ line, value: m[3], waitable: m[1] === '~' });
    }
    return results;
}
exports.findDefineAssignments = findDefineAssignments;
//# sourceMappingURL=definitionValues.js.map