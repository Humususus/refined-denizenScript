import { describe, it, expect } from 'vitest';
import { WarningCollector, ScriptWarning } from './scriptWarnings';

// All behaviour here is derived from ScriptChecker.cs:155-170 (the `Warn` method taking
// explicit line/key/message/start/end args). See scriptWarnings.ts for the line-by-line
// correspondence notes.

describe('WarningCollector.warn', () => {
    it('appends to the given list with all five fields set', () => {
        const collector = new WarningCollector();
        collector.warn(collector.errors, 3, 'some.key', 'some message', 5, 9);
        expect(collector.errors).toHaveLength(1);
        const warning: ScriptWarning = collector.errors[0];
        expect(warning.line).toBe(3);
        expect(warning.warningUniqueKey).toBe('some.key');
        expect(warning.customMessageForm).toBe('some message');
        expect(warning.startChar).toBe(5);
        expect(warning.endChar).toBe(9);
    });

    it('dedups two warns with the same line and same key to one entry', () => {
        const collector = new WarningCollector();
        collector.warn(collector.warnings, 3, 'dupe.key', 'first message', 0, 1);
        collector.warn(collector.warnings, 3, 'dupe.key', 'second message', 2, 3);
        expect(collector.warnings).toHaveLength(1);
        // The C# loop returns on the first match, so the original entry survives untouched.
        expect(collector.warnings[0].customMessageForm).toBe('first message');
    });

    it('appends both when the same key is warned on different lines', () => {
        const collector = new WarningCollector();
        collector.warn(collector.warnings, 1, 'same.key', 'msg a', 0, 1);
        collector.warn(collector.warnings, 2, 'same.key', 'msg b', 0, 1);
        expect(collector.warnings).toHaveLength(2);
    });

    it('appends both when different keys are warned on the same line', () => {
        const collector = new WarningCollector();
        collector.warn(collector.warnings, 1, 'key.a', 'msg a', 0, 1);
        collector.warn(collector.warnings, 1, 'key.b', 'msg b', 0, 1);
        expect(collector.warnings).toHaveLength(2);
    });

    it('appends nothing and increments ignoredWarnings for an ignored key', () => {
        const collector = new WarningCollector();
        collector.ignoredWarningTypes.add('ignored.key');
        collector.warn(collector.warnings, 1, 'ignored.key', 'msg', 0, 1);
        expect(collector.warnings).toHaveLength(0);
        expect(collector.ignoredWarnings).toBe(1);
    });

    it('increments ignoredWarnings on every repeated ignored warn, not once', () => {
        const collector = new WarningCollector();
        collector.ignoredWarningTypes.add('ignored.key');
        collector.warn(collector.warnings, 1, 'ignored.key', 'msg', 0, 1);
        collector.warn(collector.warnings, 1, 'ignored.key', 'msg', 0, 1);
        collector.warn(collector.warnings, 2, 'ignored.key', 'msg', 0, 1);
        expect(collector.ignoredWarnings).toBe(3);
    });

    it('dedups per-list: the same line+key in errors and warnings yields one in each', () => {
        const collector = new WarningCollector();
        collector.warn(collector.errors, 4, 'shared.key', 'error msg', 0, 1);
        collector.warn(collector.warnings, 4, 'shared.key', 'warning msg', 0, 1);
        expect(collector.errors).toHaveLength(1);
        expect(collector.warnings).toHaveLength(1);

        // And a repeat within errors alone still dedups against errors only.
        collector.warn(collector.errors, 4, 'shared.key', 'error msg again', 0, 1);
        expect(collector.errors).toHaveLength(1);
        expect(collector.warnings).toHaveLength(1);
    });
});
