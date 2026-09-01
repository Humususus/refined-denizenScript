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

/**
 * The separator each supported tag wants between its entries.
 *
 * `with` joined on 2026-09-01, reported by the user. `<item.with[display_name=hi;quantity=2]>` is
 * a `;`-separated mechanism set exactly as a map is -- the meta documents its parameter as
 * `<mechanism>=<value>;...` -- so leaving it out meant the helper was missing from the one tag
 * where mechanism sets are written most often. `with_single` is the one-mechanism form and takes
 * no separator at all, so it is deliberately absent.
 */
const TAG_SEPARATORS: ReadonlyMap<string, string> = new Map([
    ['map', ';'],
    ['with', ';'],
    ['list', '|']
]);

/** One open `<...>` while scanning a line. */
interface TagFrame {
    /** Characters seen after `<` and before the first `[`, so `<player.flag[` gives "player.flag". */
    name: string;
    /** Whether we are between that tag's `[` and its matching `]`. */
    inParams: boolean;
    /** Nesting of raw `[` inside the params, so `<list[a[b]c]>` closes on the right bracket. */
    bracketDepth: number;
    /**
     * The quote character an unterminated quoted value inside these params opened with, or null.
     *
     * Tracked PER FRAME rather than for the whole line, and that is the load-bearing decision. A
     * map tag is almost always written inside a quoted argument -- `- narrate "<map[a=1;b=2]>"` --
     * so a line-wide quote scanner would consider the cursor "inside a string" for every realistic
     * use and the feature would never fire at all. What the feature note means by "not inside a
     * quoted string" is a quoted VALUE within the parameters, which is exactly this.
     */
    quote: string | null;
}

/**
 * The separator to type instead of a space at `character`, or null to type an ordinary space.
 *
 * `character` is the cursor's column, so the text considered is `lineText.slice(0, character)`.
 */
export function separatorForSpace(lineText: string, character: number): string | null {
    const text = lineText.slice(0, Math.max(0, character));
    const stack: TagFrame[] = [];
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const top: TagFrame | undefined = stack[stack.length - 1];
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
    const top: TagFrame | undefined = stack[stack.length - 1];
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

/**
 * The part of a tag name after its last dot: "flag" for "player.flag", "map" for "map".
 *
 * The whole accumulated name would be wrong here. `<player.flag[x]>` must not be treated as a list
 * tag just because some earlier component was one, and it is the component the `[` belongs to that
 * decides what the parameters mean.
 */
function lastNameComponent(name: string): string {
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
