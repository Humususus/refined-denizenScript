// Pure warning model, ported from SharpDenizenTools' ScriptChecker.cs.
// This module must stay dependency-free: no `vscode-languageserver` import, no I/O.
// It is the innermost layer of the diagnostics pipeline and is fully unit-testable
// in isolation for that reason.

/** A warning about a script. Ported from ScriptChecker.cs:89-106 (the `ScriptWarning` class). */
export interface ScriptWarning {
    /** A unique key for this *type* of warning. (ScriptChecker.cs:92-93, `WarningUniqueKey`) */
    warningUniqueKey: string;
    /** The locally customized message form. (ScriptChecker.cs:95-96, `CustomMessageForm`) */
    customMessageForm: string;
    /** The line this applies to. (ScriptChecker.cs:98-99, `Line`) */
    line: number;
    /** The starting character position. (ScriptChecker.cs:101-102, `StartChar`) */
    startChar: number;
    /** The ending character position. (ScriptChecker.cs:104-105, `EndChar`) */
    endChar: number;
}

/**
 * A string paired with the line/column it was read from. Ported from ScriptChecker.cs's
 * `LineTrackedString` (constructor at :1364, fields at :1366-1373).
 *
 * EQUALITY (load-bearing for Task 2): ScriptChecker.cs:1381-1385 overrides `Equals` to compare
 * ONLY `Text`, and :1376-1379 overrides `GetHashCode` the same way -- `Line` and `StartChar`
 * are excluded from both. That makes two C# `LineTrackedString` instances with equal `Text`
 * (regardless of line or start position) the *same* `Dictionary<LineTrackedString, object>`
 * key, which is exactly how the C#'s duplicate-key and duplicate-script-name checks detect a
 * repeat: they construct a fresh `new LineTrackedString(0, key, 0)` and look it up against a
 * section built from real, differently-positioned instances (see e.g. ScriptChecker.cs:957,
 * :964, :1652).
 *
 * TypeScript objects always compare by identity as `Map`/`Set` keys or with `===`, and this
 * class does not (cannot, without a custom Map type) change that. So the text-only equality is
 * instead exposed via the static `textKey` helper: Task 2 must key its section maps on
 * `textKey(...)` (e.g. `Map<string, ...>`), never on `LineTrackedString` instances themselves,
 * to reproduce the C#'s "does this section already have a key with this text" lookup.
 */
export class LineTrackedString {
    constructor(
        /** The line number. (`Line`, ScriptChecker.cs:1370) */
        public readonly line: number,
        /** The text of the line. (`Text`, ScriptChecker.cs:1367) */
        public readonly text: string,
        /** The character index of where this line starts. (`StartChar`, ScriptChecker.cs:1373) */
        public readonly startChar: number,
    ) {}

    /**
     * The value to use as a lookup/Map key wherever the C# would rely on `LineTrackedString`'s
     * `Equals`/`GetHashCode` (text-only, per ScriptChecker.cs:1376-1385). Accepts either a
     * `LineTrackedString` or a plain string so a fresh probe key -- the TS equivalent of the
     * C#'s `new LineTrackedString(0, key, 0)` lookups -- doesn't need a throwaway instance.
     */
    static textKey(value: LineTrackedString | string): string {
        return typeof value === 'string' ? value : value.text;
    }
}

/**
 * Collects warnings into severity-separated lists, matching the four lists on
 * ScriptChecker (ScriptChecker.cs:108-118: `Errors`, `Warnings`, `MinorWarnings`, `Infos`)
 * plus the ignore tracking (ScriptChecker.cs:87 `IgnoredWarnings`, :127 `IgnoredWarningTypes`).
 *
 * Note: `Debugs` (ScriptChecker.cs:121) and `Injects` (ScriptChecker.cs:124) are not part of
 * the warning model and are out of scope for this task.
 */
export class WarningCollector {
    /** ScriptChecker.cs:108-109 (`Errors`). */
    errors: ScriptWarning[] = [];
    /** ScriptChecker.cs:111-112 (`Warnings`). */
    warnings: ScriptWarning[] = [];
    /** ScriptChecker.cs:114-115 (`MinorWarnings`). */
    minorWarnings: ScriptWarning[] = [];
    /** ScriptChecker.cs:117-118 (`Infos`). */
    infos: ScriptWarning[] = [];
    /** ScriptChecker.cs:86-87 (`IgnoredWarnings`). */
    ignoredWarnings = 0;
    /** ScriptChecker.cs:126-127 (`IgnoredWarningTypes`). */
    ignoredWarningTypes: Set<string> = new Set<string>();

    /**
     * The `(line, key)` pairs already present in each warning list, so `warn` can answer the
     * dedup question in O(1) instead of re-scanning the list.
     *
     * PERFORMANCE DEVIATION FROM ScriptChecker.cs:162-168 -- observably identical, see below.
     *
     * The C# scans the target list linearly on every `Warn` call. That is fine there because
     * DiagnosticProvider.cs:65-66 runs the check on a background thread under a 10s cancellation
     * token; here `runDiagnostics` runs inline on the LSP main thread, so the O(n^2) blocks
     * completion, hover and signature help for its whole duration. Only `basicLineFormatCheck`
     * and `checkForColorCodes` can reach it (tabs/braces/old-defs `break` after one hit), but
     * pasting a log or a JSON blob into a `.dsc` is enough: 50 000 stray-space lines measured
     * 1 700 ms before this change, and 100 000 warnings 5 405 ms.
     *
     * This is a cache, not a change of rule: the set holds exactly the pairs `warn` itself
     * pushed, and `warn` is the ONLY thing in this codebase that mutates the four lists --
     * every other reader goes through `map`/`filter`/`length`. If a future caller ever splices
     * or clears a list directly, this cache silently diverges from it, so route such a change
     * through a method here instead.
     *
     * Keyed by list identity so the per-list (not global) dedup of the C# is preserved, and
     * `WeakMap` so an ad-hoc list passed by a caller cannot pin memory.
     */
    private seenPerList = new WeakMap<ScriptWarning[], Set<string>>();

    /**
     * Adds a warning to track. Ported from the first `Warn` overload
     * (ScriptChecker.cs:155-170); the `LineTrackedString` overload (:172-180) is
     * deliberately not ported here, per the task brief.
     *
     * Parameter order matches the C# exactly (list, line, key, message, start, end) so the
     * two can be checked side by side, even though it reads oddly for a TS-first API.
     */
    warn(list: ScriptWarning[], line: number, key: string, message: string, start: number, end: number): void {
        // ScriptChecker.cs:157-161: the ignore check happens first, and increments the
        // counter on every ignored call, not just the first.
        if (this.ignoredWarningTypes.has(key)) {
            this.ignoredWarnings++;
            return;
        }
        // ScriptChecker.cs:162-168: dedup considers only the list being appended to (per-list,
        // not global), matching on (line, key). Answered from `seenPerList` rather than by
        // scanning; see the note on that field for why, and why it is equivalent.
        //
        // Registration happens AFTER the ignore check above, exactly where the C#'s scan sits,
        // so an ignored call still leaves no trace: a key that is ignored and later un-ignored
        // warns on its first surviving call, as it did before.
        let seen = this.seenPerList.get(list);
        if (seen === undefined) {
            seen = new Set<string>();
            this.seenPerList.set(list, seen);
        }
        // `line` is always a loop index, so its decimal form never contains a NUL; the first NUL
        // is therefore unambiguously the separator and no two distinct (line, key) pairs collide.
        const dedupKey = `${line}\u0000${key}`;
        if (seen.has(dedupKey)) {
            // Returning before the push is what makes the FIRST message win, as the C# loop's
            // early return does.
            return;
        }
        seen.add(dedupKey);
        // ScriptChecker.cs:169
        list.push({ line, warningUniqueKey: key, customMessageForm: message, startChar: start, endChar: end });
    }

    /**
     * Adds a warning to track, anchored to a `LineTrackedString` instead of explicit
     * line/start/end. Ported from the second `Warn` overload (ScriptChecker.cs:177-180).
     *
     * TypeScript cannot overload on argument type the way C# does, so per the controller's
     * ambiguity resolution this gets a distinct name, `warnAt`. It routes through `warn` --
     * exactly as the C# overload calls the first `Warn` -- so dedup and ignore behaviour are
     * identical, not reimplemented.
     */
    warnAt(list: ScriptWarning[], key: string, message: string, tracked: LineTrackedString): void {
        // ScriptChecker.cs:179: `Warn(warnType, line.Line, key, message, line.StartChar, line.StartChar + line.Text.Length)`.
        this.warn(list, tracked.line, key, message, tracked.startChar, tracked.startChar + tracked.text.length);
    }
}
