"use strict";
// Pure warning model, ported from SharpDenizenTools' ScriptChecker.cs.
// This module must stay dependency-free: no `vscode-languageserver` import, no I/O.
// It is the innermost layer of the diagnostics pipeline and is fully unit-testable
// in isolation for that reason.
Object.defineProperty(exports, "__esModule", { value: true });
exports.WarningCollector = void 0;
/**
 * Collects warnings into severity-separated lists, matching the four lists on
 * ScriptChecker (ScriptChecker.cs:108-118: `Errors`, `Warnings`, `MinorWarnings`, `Infos`)
 * plus the ignore tracking (ScriptChecker.cs:87 `IgnoredWarnings`, :127 `IgnoredWarningTypes`).
 *
 * Note: `Debugs` (ScriptChecker.cs:121) and `Injects` (ScriptChecker.cs:124) are not part of
 * the warning model and are out of scope for this task.
 */
class WarningCollector {
    constructor() {
        /** ScriptChecker.cs:108-109 (`Errors`). */
        this.errors = [];
        /** ScriptChecker.cs:111-112 (`Warnings`). */
        this.warnings = [];
        /** ScriptChecker.cs:114-115 (`MinorWarnings`). */
        this.minorWarnings = [];
        /** ScriptChecker.cs:117-118 (`Infos`). */
        this.infos = [];
        /** ScriptChecker.cs:86-87 (`IgnoredWarnings`). */
        this.ignoredWarnings = 0;
        /** ScriptChecker.cs:126-127 (`IgnoredWarningTypes`). */
        this.ignoredWarningTypes = new Set();
    }
    /**
     * Adds a warning to track. Ported from the first `Warn` overload
     * (ScriptChecker.cs:155-170); the `LineTrackedString` overload (:172-180) is
     * deliberately not ported here, per the task brief.
     *
     * Parameter order matches the C# exactly (list, line, key, message, start, end) so the
     * two can be checked side by side, even though it reads oddly for a TS-first API.
     */
    warn(list, line, key, message, start, end) {
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
exports.WarningCollector = WarningCollector;
//# sourceMappingURL=scriptWarnings.js.map