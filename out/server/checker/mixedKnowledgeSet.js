"use strict";
// Ported in full from SharpDenizenTools/ScriptAnalysis/MixedKnowledgeSet.cs (106 lines).
// This module must stay dependency-free: no `vscode-languageserver` import, no I/O. It imports
// nothing at all, which is the standing rule for src/server/checker/.
//
// WHY THIS TYPE EXISTS. Denizen scripts name things with tags:
//     - define <[prefix]>_count 1
//     - flag server <[world]>.visits:++
// The name of that definition and that flag are not knowable while checking. A plain
// Set<string> would record something useless and then, in Phase 2C-4, report "undefined
// definition" on a script that is perfectly correct. So the set keeps two halves: names known
// EXACTLY, and PREFIXES that a name is known to start with. A lookup matches either.
//
// Porting rule, as everywhere else in this directory: the C# is the specification, warts
// included. One behaviour below is dead code in the C# and is ported dead; see `minLength`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MixedKnowledgeSet = void 0;
/**
 * A set of strings that may have only partial knowledge.
 * Ported from MixedKnowledgeSet.cs:12-105.
 */
class MixedKnowledgeSet {
    constructor() {
        /** The set of exactly-known strings. (MixedKnowledgeSet.cs:15) */
        this.exactKnown = new Set();
        /** The set of partially-known strings -- prefixes, each cut at its first '<'. (:18) */
        this.partialKnown = new Set();
        /**
         * The lowest known length in the set. (MixedKnowledgeSet.cs:21)
         *
         * C# QUIRK, PORTED DEAD ON PURPOSE. This starts at 0 and `add` updates it with
         * `Math.min(minLength, str.length)`. No string has a negative length, so it can only ever
         * remain 0 -- which makes the `option.length < this.minLength` guard in `contains`
         * unreachable. It is kept, at 0, because "fixing" it into a real minimum would not be a
         * tidy-up: it would start REJECTING short names that the C# accepts, and the rejection
         * would surface in Phase 2C-4 as a false "undefined definition" warning on a script whose
         * shortest definition name happens to be shorter than any other.
         */
        this.minLength = 0;
        /** The highest known length in the set. (MixedKnowledgeSet.cs:24) This one genuinely works. */
        this.maxLength = 0;
    }
    /**
     * Merges in all data from another set. (MixedKnowledgeSet.cs:27-33)
     *
     * The two `Set` unions COPY members rather than aliasing the source's sets. C#'s
     * `HashSet.UnionWith` does the same, and it is load-bearing: ConvertContainers merges an
     * injected script's names into every script that injects it (ScriptChecker.cs:1752), so a
     * shared reference would let one container's later additions appear in another's.
     */
    mergeIn(set) {
        for (const item of set.exactKnown) {
            this.exactKnown.add(item);
        }
        for (const item of set.partialKnown) {
            this.partialKnown.add(item);
        }
        this.minLength = Math.min(this.minLength, set.minLength);
        this.maxLength = Math.max(this.maxLength, set.maxLength);
    }
    /**
     * Adds a new string to the set. (MixedKnowledgeSet.cs:36-49)
     *
     * NOTE the order: a string containing '<' is TRUNCATED FIRST (`str = str.Before('<')`) and
     * the length update at the end therefore measures the truncated form. Note too that the
     * truncation is not guarded against producing the empty string -- `add('<[x]>')` stores `''`
     * as a prefix, and `''` is a prefix of everything, so the set then matches all input. That
     * is intended: a script whose names are entirely tag-built is exempt from name checking
     * rather than drowned in false positives.
     *
     * No trimming and no case folding happen here. The C#'s callers do both before calling
     * (ScriptChecker.cs:1798, :1837), and doing it again here would be a silent second opinion.
     */
    add(str) {
        // MixedKnowledgeSet.cs:38-46
        if (str.includes('<')) {
            str = str.slice(0, str.indexOf('<'));
            this.partialKnown.add(str);
        }
        else {
            this.exactKnown.add(str);
        }
        // MixedKnowledgeSet.cs:47-48
        this.minLength = Math.min(this.minLength, str.length);
        this.maxLength = Math.max(this.maxLength, str.length);
    }
    /** Adds all new strings to the set. (MixedKnowledgeSet.cs:52-58) */
    addAll(...options) {
        for (const str of options) {
            this.add(str);
        }
    }
    /** Whether there are any entries in the set at all. (MixedKnowledgeSet.cs:61-64) */
    any() {
        return this.exactKnown.size > 0 || this.partialKnown.size > 0;
    }
    /**
     * Whether the input option string matches this set. (MixedKnowledgeSet.cs:67-85)
     *
     * Three stages, and the length guards belong to the first two only:
     *   1. `option.length < minLength` -- dead, see `minLength`.
     *   2. a `<= maxLength` fast path over both sets by exact membership.
     *   3. a linear scan of the prefixes. NO length guard here, deliberately: this is the arm
     *      that matches an option LONGER than anything ever added, which is the normal case for
     *      a prefix match and the reason the fast path cannot simply be extended to cover it.
     */
    contains(option) {
        // MixedKnowledgeSet.cs:69-72
        if (option.length < this.minLength) {
            return false;
        }
        // MixedKnowledgeSet.cs:73-76
        if (option.length <= this.maxLength && (this.exactKnown.has(option) || this.partialKnown.has(option))) {
            return true;
        }
        // MixedKnowledgeSet.cs:77-84
        for (const partial of this.partialKnown) {
            if (option.startsWith(partial)) {
                return true;
            }
        }
        return false;
    }
    /**
     * The subset of `options` that this set matches. (MixedKnowledgeSet.cs:88-91)
     *
     * NOTE it returns members of `options`, not members of this set -- for a partial entry those
     * are different strings. ConvertContainers relies on that at ScriptChecker.cs:1747, where it
     * resolves inject targets to real script names it can then look up.
     */
    getAllMatchesIn(options) {
        const result = [];
        for (const option of options) {
            if (this.contains(option)) {
                result.push(option);
            }
        }
        return result;
    }
    /** Every string in the set, exact entries first then partial ones. (MixedKnowledgeSet.cs:94-104) */
    *enumerateAll() {
        for (const exact of this.exactKnown) {
            yield exact;
        }
        for (const partial of this.partialKnown) {
            yield partial;
        }
    }
}
exports.MixedKnowledgeSet = MixedKnowledgeSet;
//# sourceMappingURL=mixedKnowledgeSet.js.map