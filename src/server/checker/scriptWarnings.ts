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
        // ScriptChecker.cs:162-168: dedup scans only the list being appended to (per-list,
        // not global), matching on (line, key).
        for (const warning of list) {
            if (warning.line === line && warning.warningUniqueKey === key) {
                return;
            }
        }
        // ScriptChecker.cs:169
        list.push({ line, warningUniqueKey: key, customMessageForm: message, startChar: start, endChar: end });
    }
}
