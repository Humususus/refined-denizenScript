"use strict";
// The decision half of the auto-separator typing helper: given a line and a cursor column, decide
// whether pressing SPACE should type a `;`, a `|`, or an ordinary space. No `vscode` import, so
// every branch is unit-testable -- the same split `quickFixPlans.ts` and `mutedDiagnostics.ts` use.
//
// FEATURE-IDEAS.md idea 5, built on the user's ruling of 2026-09-01.
//
// THE RISK THIS FILE IS SHAPED AROUND. This is the only feature in the extension that types FOR
// the user, and the feature note said so plainly. Two things keep it honest:
//   1. It fires in one narrow place -- directly inside the `[...]` of a `<map[...]>` or
//      `<list[...]>` tag -- and returns null everywhere else, so "when in doubt, type a space".
//   2. The insertion is reversible with a single Backspace, following the escape helper's
//      precedent (extension.ts's `undoLastDenizenEscapeOrBackspace`), which is where the undo for
//      this lives too.
// A map VALUE may legitimately contain spaces (`<map[msg=hello there;x=1]>`), and no amount of
// scanning can tell that apart from a separator the user wanted. That case is what the one-key
// undo exists for, and it is why this ships behind a setting that can turn it off.
Object.defineProperty(exports, "__esModule", { value: true });
exports.separatorForSpace = void 0;
/** The separator each supported tag wants between its entries. */
const TAG_SEPARATORS = new Map([
    ['map', ';'],
    ['list', '|']
]);
/**
 * The separator to type instead of a space at `character`, or null to type an ordinary space.
 *
 * `character` is the cursor's column, so the text considered is `lineText.slice(0, character)`.
 */
function separatorForSpace(lineText, character) {
    const text = lineText.slice(0, Math.max(0, character));
    const stack = [];
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const top = stack[stack.length - 1];
        // Inside a quoted value nothing is structural: a `<`, `>` or `]` in there is just text.
        if (top !== undefined && top.inParams && top.quote !== null) {
            if (ch === top.quote) {
                top.quote = null;
            }
            continue;
        }
        if (ch === '<') {
            stack.push({ name: '', inParams: false, bracketDepth: 0, quote: null });
            continue;
        }
        if (ch === '>') {
            // A stray `>` with no open tag is ordinary text, not an underflow.
            stack.pop();
            continue;
        }
        if (top === undefined) {
            continue;
        }
        if (!top.inParams) {
            if (ch === '[') {
                top.inParams = true;
                top.bracketDepth = 1;
            }
            else {
                top.name += ch;
            }
            continue;
        }
        if (ch === '[') {
            top.bracketDepth++;
        }
        else if (ch === ']') {
            top.bracketDepth--;
            if (top.bracketDepth === 0) {
                // The params closed; anything after this belongs to the tag's sub-parts.
                top.inParams = false;
            }
        }
        else if (ch === '"' || ch === "'") {
            top.quote = ch;
        }
    }
    const top = stack[stack.length - 1];
    if (top === undefined || !top.inParams || top.quote !== null) {
        return null;
    }
    const separator = TAG_SEPARATORS.get(lastNameComponent(top.name));
    if (separator === undefined) {
        return null;
    }
    // Nothing to separate yet, or the separator is already there. These three guards are what stop
    // the helper producing `[;`, `;;` or `; ;` -- each of which would be a wrong guess the user has
    // to undo, and all three are cheap to rule out.
    const previous = text[text.length - 1];
    if (previous === undefined || previous === '[' || previous === separator || previous === ' ') {
        return null;
    }
    // `<map[key=` -- the user is starting a value, not ending an entry.
    if (previous === '=') {
        return null;
    }
    return separator;
}
exports.separatorForSpace = separatorForSpace;
/**
 * The part of a tag name after its last dot: "flag" for "player.flag", "map" for "map".
 *
 * The whole accumulated name would be wrong here. `<player.flag[x]>` must not be treated as a list
 * tag just because some earlier component was one, and it is the component the `[` belongs to that
 * decides what the parameters mean.
 */
function lastNameComponent(name) {
    const dot = name.lastIndexOf('.');
    const last = dot < 0 ? name : name.slice(dot + 1);
    // ASCII fold only, matching `toLowerFast` elsewhere in the port: tag names are ASCII, and
    // Unicode casing here could fold a non-ASCII character onto a tag name it is not.
    let out = '';
    for (const ch of last.trim()) {
        const code = ch.charCodeAt(0);
        out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : ch;
    }
    return out;
}
//# sourceMappingURL=tagSeparators.js.map