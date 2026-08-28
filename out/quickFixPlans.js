"use strict";
// The decision half of the missing-punctuation Quick Fixes: which edits a diagnostic justifies,
// and where they go. No `vscode` import, so every branch is unit-testable — the same split
// `mutedDiagnostics.ts` uses, and for the same reason.
//
// FEATURE-IDEAS.md idea 6. The checker already reports these; this only offers the edit their
// messages already describe. No new analysis, and nothing fires where the checker is silent.
Object.defineProperty(exports, "__esModule", { value: true });
exports.planFixes = exports.ACTIONABLE_CODES = void 0;
/**
 * The diagnostics we can act on.
 *
 * ONLY TWO, deliberately. `identifier_missing_line` says "missing a `:` or a `-`?" and
 * `key_line_looks_like_command` says "forgot a '-'?"; both name the edit, so offering it is
 * mechanical rather than a guess. The third diagnostic in the feature note,
 * `empty_command_section`, was dropped after reading what it means: a `- foo:` section with
 * nothing indented under it, whose fix is to write the body, not to add punctuation.
 *
 * NOT HERE, and asked for: `- if true == false` with no trailing colon. NEITHER ENGINE reports
 * that line, so there is no diagnostic to hang an action from. Making it offerable is a checker
 * change, not a Quick Fix change.
 */
exports.ACTIONABLE_CODES = new Set(['identifier_missing_line', 'key_line_looks_like_command']);
/**
 * The fixes to offer for `code` on a line reading `text`, in the order they should appear.
 *
 * Returns an empty array whenever the edit would be pointless or wrong — an unrecognised code, a
 * blank line, or a line that already has the punctuation being offered.
 */
function planFixes(code, text) {
    if (!exports.ACTIONABLE_CODES.has(code)) {
        return [];
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        return [];
    }
    // The dash goes at the first non-space character, NEVER at column 0: these lines are indented
    // inside a container, and moving one to the margin would change which container it belongs to.
    const indent = text.length - text.trimStart().length;
    // `trimEnd` matters: with trailing whitespace the colon would land after the spaces, where the
    // parser does not see it as ending the key.
    const endOfText = text.trimEnd().length;
    const plans = [];
    if (code === 'identifier_missing_line') {
        // The message offers both, so both are offered — colon first, because a bare word inside a
        // container is far more often a key than a command that lost its dash.
        if (!trimmed.endsWith(':')) {
            plans.push({ title: "Add ':' to the end of the line", character: endOfText, insert: ':' });
        }
        if (!trimmed.startsWith('-')) {
            plans.push({ title: "Add '- ' to the start of the line", character: indent, insert: '- ' });
        }
        return plans;
    }
    // key_line_looks_like_command: the line already ends in ':', so only the dash is missing, and
    // its message names exactly that.
    if (!trimmed.startsWith('-')) {
        plans.push({ title: "Add '- ' to the start of the line", character: indent, insert: '- ' });
    }
    return plans;
}
exports.planFixes = planFixes;
//# sourceMappingURL=quickFixPlans.js.map