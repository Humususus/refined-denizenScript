"use strict";
// Matching a WRITTEN event line back to the MetaEvent it documents. Shared by hover (event
// description) and completion (narrowing <context.[...]> to the enclosing event's own context
// tags), both user requests of 2026-09-03.
//
// A SIBLING OF, NOT A REFACTOR OF, containerChecks.ts's checkOneEventLine. That function already
// does this same match for diagnostics, but it also carries the switch-validity preference logic
// (:1221-1249's "prefer a matcher whose switches all check out") that diagnostics need and hover/
// completion do not -- they only want the best-scoring match, full length preferred. Reusing it
// exactly would mean threading a WarnScript callback through two features that report nothing.
// Duplicating the walk here keeps both simple and keeps the tested diagnostic path untouched.
Object.defineProperty(exports, "__esModule", { value: true });
exports.contextNamesForEvent = exports.matchEventLine = void 0;
const frenetic_1 = require("./frenetic");
const eventTools_1 = require("./eventTools");
/**
 * Strips a line down to the bare event text a `MetaEvent`'s could-matchers expect: no leading
 * indent, no `on `/`after ` prefix, no trailing `:`, switches removed.
 *
 * Returns null when `line` cannot be an event line at all -- no prefix, or nothing between the
 * prefix and the colon.
 */
function bareEventText(line) {
    const trimmed = line.trim();
    const m = /^(on|after)\s+(.+):\s*$/i.exec(trimmed);
    if (m === null || m[2].trim().length === 0) {
        return null;
    }
    return m[2];
}
/**
 * The best-matching documented event for `line`, or null when nothing matches (not an event line,
 * or an event line naming something undocumented).
 *
 * FULL MATCHES ONLY. A partial match is enough to point a diagnostic at the closest event
 * (containerChecks.ts's fallback for an error message), but showing the WRONG event's
 * documentation on hover, or the wrong event's context tags in completion, is worse than showing
 * nothing -- so unlike the checker, this returns null rather than falling back to a partial match.
 */
function matchEventLine(docs, line) {
    const bare = bareEventText(line);
    if (bare === null) {
        return null;
    }
    const separated = (0, eventTools_1.separateSwitches)(docs, bare);
    const parts = (0, frenetic_1.toLowerFast)(separated.cleaned).split(' ');
    let best = null;
    let bestMatcher = null;
    for (const evt of docs.events.values()) {
        for (const matcher of evt.couldMatchers) {
            if (matcher.tryMatch(parts, false, false) <= 0) {
                continue;
            }
            if (bestMatcher === null || matcher.isBetterMatchThan(parts, false, bestMatcher)) {
                bestMatcher = matcher;
                best = evt;
            }
        }
    }
    return best;
}
exports.matchEventLine = matchEventLine;
/**
 * The names `<context.[...]>` can complete to for this event, in first-documented order with
 * duplicates removed.
 *
 * PARSED FROM `evt.context`'s PROSE, not a structured field -- the meta writes one line per name,
 * `<context.name> returns ...`, with occasional wrapped continuation lines that do not start with
 * `<context.` and are correctly skipped by simply not matching. Verified against the live meta
 * 2026-09-03: 667 events document 2001 such lines resolving to 444 distinct names, every one a
 * plain identifier -- zero contain a dot, confirming a single tag-part name is the right
 * granularity to offer. The one form this deliberately excludes is `<context.(key)>`, real syntax
 * on events whose context is an arbitrary caller-supplied map: `(key)` is documentation notation
 * for "any name you like", not a literal one to complete.
 */
function contextNamesForEvent(evt) {
    const seen = new Set();
    const names = [];
    for (const line of evt.context) {
        const m = /^<context\.([A-Za-z_][A-Za-z0-9_]*)>/i.exec(line.trim());
        if (m === null) {
            continue;
        }
        const name = (0, frenetic_1.toLowerFast)(m[1]);
        if (!seen.has(name)) {
            seen.add(name);
            names.push(name);
        }
    }
    return names;
}
exports.contextNamesForEvent = contextNamesForEvent;
//# sourceMappingURL=eventLineMatch.js.map