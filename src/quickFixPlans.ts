// The decision half of the missing-punctuation Quick Fixes: which edits a diagnostic justifies,
// and where they go. No `vscode` import, so every branch is unit-testable — the same split
// `mutedDiagnostics.ts` uses, and for the same reason.
//
// FEATURE-IDEAS.md idea 6. The checker already reports these; this only offers the edit their
// messages already describe. No new analysis, and nothing fires where the checker is silent.

/**
 * One edit to offer: put `insert` at `character` on the diagnostic's line, replacing the `replace`
 * characters already there.
 *
 * INSERTIONS WHEREVER POSSIBLE, deliberately: an insertion cannot lose text the user wrote, so the
 * worst case of a wrong guess is one undo. All three punctuation fixes are insertions and set
 * `replace: 0`; see that field for the one code that must rewrite instead, and what is done to keep
 * it just as safe.
 */
export interface FixPlan {
    title: string;
    character: number;
    insert: string;
    /**
     * How many characters at `character` the insert REPLACES; 0 for a pure insertion.
     *
     * THE PUNCTUATION FIXES ABOVE ARE ALL 0, and the invariant in this interface's own note --
     * an edit cannot lose text the user wrote -- is theirs. `deprecated_tag_part` is the one code
     * that has to replace, because renaming `as_entity` to `as[entity]` is a rewrite by nature.
     * The guards in `planDeprecationFix` are what buy that back: it refuses unless the replaced
     * span is a whole tag part carrying no parameter of its own, so the only text lost is the
     * deprecated name itself.
     */
    replace: number;
}

/**
 * What the caller knows about the diagnostic beyond its line, for the codes that need it.
 *
 * Optional on `planFixes` so the three punctuation codes -- which need only the line -- keep their
 * two-argument call and their tests.
 */
export interface FixContext {
    /** The diagnostic's message, which for a deprecation names the replacement. */
    message: string;
    /** Column of the diagnostic's start on its line. */
    startCharacter: number;
    /** Column one past the diagnostic's end. */
    endCharacter: number;
}

/**
 * The replacement a deprecation message names, or null when it does not name one unambiguously.
 *
 * MEASURED AGAINST THE LIVE META 2026-09-03, and the measurement is why this is so strict. There
 * are 124 deprecated tags. A loose "find a word after 'use'" reads a replacement out of 52 of them
 * and is WRONG on several: `<EntityTag.map_trace>` says "use EntityTag.trace_framed_map", from
 * which the loose rule extracts `EntityTag` and would offer to rewrite the part to that. The other
 * 99 quote the replacement (`use 'aggressive'`), link it (`<@link tag ...>`), qualify it by
 * Minecraft version, or name no replacement at all ("This was removed from Citizens.").
 *
 * Requiring the WHOLE message to be `use <part>` leaves 25, of which 23 are the `as_*` family the
 * user asked about and one is `hex_encode` -> `utf8_encode`. Everything else is left to the
 * existing warning, which still says what to do; only the automatic edit is withheld.
 */
export function deprecationReplacement(message: string): string | null {
    // `Deprecated tag \`elementtag.as_entity\`: use as[entity]` -- tagTracer.ts's format.
    const tail = /`[^`]*`:\s*(.*)$/.exec(message);
    if (tail === null) {
        return null;
    }
    const strict = /^use\s+([A-Za-z0-9_]+(?:\[[^\]\s]*\])?)\.?$/i.exec(tail[1].trim());
    if (strict === null) {
        return null;
    }
    const replacement = strict[1];
    // A REPLACEMENT SPELLING OUT KEY=VALUE PAIRS IS A TEMPLATE, NOT A LITERAL, and inserting it
    // would destroy real arguments. The meta's own case: `hsb_color_gradient` says "use
    // color_gradient[from=color;to=color;style=HSB]", where `from=color` is documentation
    // shorthand, not something to paste into a script.
    if (/[=;]/.test(replacement)) {
        return null;
    }
    return replacement;
}

/**
 * The diagnostics we can act on.
 *
 * THE PUNCTUATION CODES WERE ONLY TWO, deliberately. `identifier_missing_line` says "missing a `:` or a `-`?" and
 * `key_line_looks_like_command` says "forgot a '-'?"; both name the edit, so offering it is
 * mechanical rather than a guess. The third diagnostic in the feature note,
 * `empty_command_section`, was dropped after reading what it means: a `- foo:` section with
 * nothing indented under it, whose fix is to write the body, not to add punctuation.
 *
 * `missing_colon_on_command` is the third, and the one the feature note said could not be built:
 * `- if true == false` with no trailing colon used to be reported by NEITHER engine, so there was
 * no diagnostic to hang an action from. The checker change that supplies it landed 2026-09-01
 * (`checkCommandMissingColon`, user ruling), so the Quick Fix the user actually asked for now
 * exists. It is TYPESCRIPT-ENGINE ONLY, unlike the other two: the C# server has no such check, so
 * on `denizenscript.server.engine: csharp` the diagnostic never arrives and nothing is offered.
 *
 * `empty_command_section` remains out, on the reading that its fix is to write the body rather
 * than to add punctuation.
 *
 * `deprecated_tag_part` is the fourth and the only one that is not about punctuation -- the second
 * half of FEATURE-IDEAS.md idea 7, user request 2026-09-03. It rewrites `as_entity` into
 * `as[entity]`, and it is the only code here whose plan REPLACES text. See
 * `deprecationReplacement` for why it fires on 24 of the meta's 124 deprecated tags and stays
 * silent on the rest.
 */
export const ACTIONABLE_CODES: ReadonlySet<string> = new Set([
    'identifier_missing_line',
    'key_line_looks_like_command',
    'missing_colon_on_command',
    'deprecated_tag_part'
]);

/**
 * The rewrite for one deprecated tag part, or nothing when it cannot be made safely.
 *
 * THE DIAGNOSTIC'S RANGE IS THE PART, exactly: the checker reports it from `part.startChar` to
 * `part.startChar + part.text.length` (`tagChecks.ts`). So the span to replace is handed over
 * rather than re-derived, and no second parse of the line can disagree with the checker about
 * where the part is.
 *
 * REFUSED WHEN THE PART CARRIES A PARAMETER. If the character after the range is `[`, the author
 * wrote something like `hsb_color_gradient[from=<&color[#fff]>;to=...]`, and swapping only the name
 * would leave arguments that belong to a different tag -- or, if the range were widened to swallow
 * them, destroy them. Every one of the 24 rewritable tags takes no parameter, so this costs nothing
 * and closes the case the meta itself contains.
 *
 * REFUSED WHEN NOTHING WOULD CHANGE, so a stale diagnostic arriving after the user has already
 * fixed the line offers no action instead of a no-op edit.
 */
function planDeprecationFix(text: string, context: FixContext): FixPlan[] {
    const replacement = deprecationReplacement(context.message);
    if (replacement === null) {
        return [];
    }
    const { startCharacter, endCharacter } = context;
    if (startCharacter < 0 || endCharacter > text.length || endCharacter <= startCharacter) {
        return [];
    }
    if (text[endCharacter] === '[') {
        return [];
    }
    if (text.slice(startCharacter, endCharacter) === replacement) {
        return [];
    }
    return [{
        title: `Replace with '${replacement}'`,
        character: startCharacter,
        insert: replacement,
        replace: endCharacter - startCharacter
    }];
}

/**
 * The fixes to offer for `code` on a line reading `text`, in the order they should appear.
 *
 * Returns an empty array whenever the edit would be pointless or wrong — an unrecognised code, a
 * blank line, or a line that already has the punctuation being offered.
 */
export function planFixes(code: string, text: string, context?: FixContext): FixPlan[] {
    if (!ACTIONABLE_CODES.has(code)) {
        return [];
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        return [];
    }
    if (code === 'deprecated_tag_part') {
        return context === undefined ? [] : planDeprecationFix(text, context);
    }
    // The dash goes at the first non-space character, NEVER at column 0: these lines are indented
    // inside a container, and moving one to the margin would change which container it belongs to.
    const indent = text.length - text.trimStart().length;
    // `trimEnd` matters: with trailing whitespace the colon would land after the spaces, where the
    // parser does not see it as ending the key.
    const endOfText = text.trimEnd().length;
    const plans: FixPlan[] = [];
    if (code === 'identifier_missing_line') {
        // The message offers both, so both are offered — colon first, because a bare word inside a
        // container is far more often a key than a command that lost its dash.
        if (!trimmed.endsWith(':')) {
            plans.push({ title: "Add ':' to the end of the line", character: endOfText, insert: ':', replace: 0 });
        }
        if (!trimmed.startsWith('-')) {
            plans.push({ title: "Add '- ' to the start of the line", character: indent, insert: '- ', replace: 0 });
        }
        return plans;
    }
    if (code === 'missing_colon_on_command') {
        // Only the colon, and never the dash: the checker reaches this diagnostic through the
        // container gatherer's LIST arm, so the line demonstrably already begins with `- `. The
        // `endsWith(':')` guard is still kept -- it costs nothing and means a stale diagnostic,
        // arriving after the user has already typed the colon, offers nothing rather than a
        // second one.
        if (!trimmed.endsWith(':')) {
            plans.push({ title: "Add ':' to the end of the line", character: endOfText, insert: ':', replace: 0 });
        }
        return plans;
    }
    // key_line_looks_like_command: the line already ends in ':', so only the dash is missing, and
    // its message names exactly that.
    if (!trimmed.startsWith('-')) {
        plans.push({ title: "Add '- ' to the start of the line", character: indent, insert: '- ', replace: 0 });
    }
    return plans;
}
