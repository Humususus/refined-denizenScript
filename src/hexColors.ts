/**
 * Finding hex colours in a Denizen line, for the editor's colour picker.
 *
 * FEATURE-IDEAS.md idea 10, user request 2026-09-03: put a swatch beside `<&color[#112233]>` and
 * open VS Code's own picker on it. `DocumentColorProvider` is the purpose-built API, so this module
 * holds only the DECISION -- where a colour is and what text replaces it -- with no `vscode` import,
 * the same split as `tagSeparators.ts`, `scopeDefinitions.ts` and `quickFixPlans.ts`.
 *
 * THE ANCHOR IS "INSIDE A TAG", and that is the whole precision story. A `DocumentColorProvider` is
 * asked for the WHOLE document on every keystroke, so a loose `#[0-9a-f]{6}` scan would light up
 * comment text and any other stray `#`. Denizen only accepts a hex colour where a ColorTag is being
 * constructed -- `<&color[#2596be]>`, `<color[#FF00FF]>`, `<&gradient[from=#000000;to=#ffffff]>` --
 * and every one of those is inside `<...>`. Requiring that costs nothing and removes the whole class
 * of false positives at once.
 *
 * VERIFIED AGAINST THE REAL CORPUS 2026-09-03: 25 files hold exactly one hex colour,
 * `- define id <element[<&color[#2596be]>123].custom_color[npc]>` -- nested two tags deep, which is
 * why depth is counted rather than a single `<...>` matched.
 *
 * THE ACCEPTED FORMS COME FROM THE ColorTag META, not from guesswork. Its `@description` says a
 * ColorTag accepts "RGB hex code like '#FF00FF', or RGBA hex codes like '#FF00FF80'". So both 6 and
 * 8 digits are colours, and the 8-digit form's last byte is alpha.
 */

/** One hex colour found on a line, with its position and channel values. */
export interface HexColorMatch {
    /** Index of the `#`. */
    start: number;
    /** Index one past the last hex digit. */
    end: number;
    /** 0-255. */
    red: number;
    green: number;
    blue: number;
    /** 0-255; 255 when the literal carried no alpha byte. */
    alpha: number;
    /** Whether the literal was written in the 8-digit RGBA form. */
    hasAlpha: boolean;
}

/** Whether the line is a Denizen comment, whose `#` starts it. */
function isComment(line: string): boolean {
    return line.trimStart().startsWith('#');
}

/**
 * Every hex colour written inside a tag on this line.
 *
 * A COMMENT LINE YIELDS NOTHING even when it contains a well-formed tag. Commented-out script is
 * ordinary in these files, and a swatch on a line the parser ignores would invite an edit that does
 * nothing. This is the anchoring the idea note called for, and it is tested on the negative.
 *
 * Tag depth is counted rather than matched with a regex because tags nest: the corpus's own case has
 * `<&color[...]>` inside `<element[...]>`. Depth clamps at zero so a stray `>` -- a comparison like
 * `<[a]> > 5` leaves one -- cannot drive the counter negative and silence the rest of the line.
 */
export function findHexColors(line: string): HexColorMatch[] {
    if (isComment(line)) {
        return [];
    }
    const results: HexColorMatch[] = [];
    let depth = 0;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '<') {
            depth++;
            continue;
        }
        if (ch === '>') {
            depth = Math.max(0, depth - 1);
            continue;
        }
        if (ch !== '#' || depth === 0) {
            continue;
        }
        // Longest form first: an 8-digit literal must not be read as a 6-digit one with two
        // characters left over.
        const match = /^#([0-9A-Fa-f]{8}|[0-9A-Fa-f]{6})/.exec(line.slice(i));
        if (match === null) {
            continue;
        }
        const digits = match[1];
        // A 7th hex digit after a 6-digit literal means the text is not a colour at all, so it is
        // left alone rather than half-matched.
        const next = line[i + 1 + digits.length];
        if (next !== undefined && /[0-9A-Fa-f]/.test(next)) {
            continue;
        }
        results.push({
            start: i,
            end: i + 1 + digits.length,
            red: parseInt(digits.slice(0, 2), 16),
            green: parseInt(digits.slice(2, 4), 16),
            blue: parseInt(digits.slice(4, 6), 16),
            alpha: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) : 255,
            hasAlpha: digits.length === 8
        });
        i += digits.length;
    }
    return results;
}

/**
 * The text that replaces a colour when one is picked.
 *
 * THE ALPHA BYTE IS WRITTEN ONLY WHEN IT MEANS SOMETHING: when the picker returns a partly
 * transparent colour, or when the author had already written the 8-digit form and would not expect
 * it to shrink. A fully opaque colour in a literal that never had alpha stays 6 digits, so opening
 * the picker and closing it again cannot silently rewrite the file.
 *
 * Lower case, matching the corpus's own `#2596be`; Denizen parses either.
 */
export function formatHexColor(red: number, green: number, blue: number, alpha: number, hadAlpha: boolean): string {
    const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
    const base = `#${byte(red)}${byte(green)}${byte(blue)}`;
    return alpha >= 255 && !hadAlpha ? base : base + byte(alpha);
}
