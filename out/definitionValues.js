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
exports.findDefineAssignments = exports.definitionReferenceAt = void 0;
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
 * The `<[id]>` reference the cursor sits inside on this line, sub-map dots included — or null.
 *
 * THE WHOLE BRACKET CONTENT IS THE NAME, dots and all: the `Define` command's own description
 * states `<[a.b.c]>` is equivalent to `<[a].get[b].get[c]>`, so a sub-mapped reference is written
 * as one dotted id, not as `<[a]>` followed by tag-chaining. A name containing `<` or `>` (a tag
 * used to build the id dynamically, e.g. `<[<[prefix]>_suffix]>`) is refused rather than guessed
 * at -- there is no static text to look up in that case.
 */
function definitionReferenceAt(line, character) {
    for (const m of line.matchAll(/<\[([^\[\]<>]*)\]>/g)) {
        const start = m.index;
        const end = start + m[0].length;
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
 * file order.
 *
 * Comment lines are skipped, matching `definitionIndex.ts`: a commented-out assignment is not one.
 */
function findDefineAssignments(text, name) {
    const target = foldAscii(name);
    const results = [];
    const lines = text.replace(/\r/g, '').split('\n');
    // Name: the same identifier-plus-dot shape `argumentValue` in scopeDefinitions.ts reads a
    // define target from, so a sub-mapped id like `myroot.mykey` is captured whole. Requiring
    // whitespace directly after the name is what excludes `name:->:value` and `name:!`: both put a
    // ':' there instead, so neither reaches this pattern at all -- not matched with the wrong
    // meaning, simply not matched.
    const pattern = /^\s*-\s*(~?)define\s+([A-Za-z_][A-Za-z0-9_.]*)\s+(.+)$/i;
    for (let line = 0; line < lines.length; line++) {
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