import { describe, it, expect } from 'vitest';
import { WarningCollector, ScriptWarning, LineTrackedString } from './scriptWarnings';

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

    it('checks the ignore list before the dedup scan, not after', () => {
        // This is only observable when the target list already holds a matching (line, key)
        // entry at the time the now-ignored key is warned again. If the dedup scan ran first
        // (ScriptChecker.cs:162-168 before :157-161), it would find that entry and return
        // before ever consulting ignoredWarningTypes, so ignoredWarnings would stay 0 instead
        // of incrementing.
        const collector = new WarningCollector();
        collector.warn(collector.warnings, 5, 'later.ignored', 'first message', 0, 1);
        expect(collector.warnings).toHaveLength(1);

        collector.ignoredWarningTypes.add('later.ignored');
        collector.warn(collector.warnings, 5, 'later.ignored', 'second message', 2, 3);

        expect(collector.ignoredWarnings).toBe(1);
        expect(collector.warnings).toHaveLength(1);
        expect(collector.warnings[0].customMessageForm).toBe('first message');
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

// Ported from ScriptChecker.cs:177-180 (the `Warn(warnType, key, message, LineTrackedString)`
// overload) and ScriptChecker.cs:1364-1392 (`LineTrackedString` itself). TypeScript can't
// overload on argument type, so per the controller's ambiguity resolution this is exposed as
// the distinctly-named `warnAt`, routed through `warn` so dedup/ignore stay identical.
describe('WarningCollector.warnAt', () => {
    it('derives line/startChar/endChar from the tracked string (start + text.length)', () => {
        // 'seven' is 5 chars; startChar is 5, so endChar should be 5 + 5 = 10.
        // Mutant this catches: endChar computed as `tracked.text.length` alone (dropping the
        // `+ startChar` from ScriptChecker.cs:179) would pass only when startChar is 0; here
        // startChar is 5, so a dropped offset changes endChar from 10 to 5.
        const collector = new WarningCollector();
        const tracked = new LineTrackedString(3, 'seven', 5);
        collector.warnAt(collector.warnings, 'some.key', 'some message', tracked);
        expect(collector.warnings).toHaveLength(1);
        const warning: ScriptWarning = collector.warnings[0];
        expect(warning.line).toBe(3);
        expect(warning.warningUniqueKey).toBe('some.key');
        expect(warning.customMessageForm).toBe('some message');
        expect(warning.startChar).toBe(5);
        expect(warning.endChar).toBe(10);
    });

    it('dedups on (line, key) exactly as warn does, because it is the same underlying path', () => {
        // Mutant this catches: warnAt pushing to the list directly (or calling a duplicate,
        // non-deduping code path) instead of delegating to `warn` -- that would leave 2
        // entries instead of 1, and would leave the *second* message as the survivor rather
        // than the first.
        const collector = new WarningCollector();
        const first = new LineTrackedString(3, 'first-text', 0);
        const second = new LineTrackedString(3, 'different-text-different-length', 9);
        collector.warnAt(collector.warnings, 'dupe.key', 'first message', first);
        collector.warnAt(collector.warnings, 'dupe.key', 'second message', second);
        expect(collector.warnings).toHaveLength(1);
        expect(collector.warnings[0].customMessageForm).toBe('first message');
        expect(collector.warnings[0].startChar).toBe(0);
        expect(collector.warnings[0].endChar).toBe(10);
    });

    it('suppresses an ignored key and increments ignoredWarnings, same as warn', () => {
        // Mutant this catches: warnAt skipping the ignore check entirely (e.g. calling a raw
        // push helper instead of `warn`) would leave the list non-empty and ignoredWarnings
        // at 0.
        const collector = new WarningCollector();
        collector.ignoredWarningTypes.add('ignored.key');
        const tracked = new LineTrackedString(1, 'text', 0);
        collector.warnAt(collector.warnings, 'ignored.key', 'msg', tracked);
        expect(collector.warnings).toHaveLength(0);
        expect(collector.ignoredWarnings).toBe(1);
    });
});

// ScriptChecker.cs:1364-1392: LineTrackedString overrides Equals/GetHashCode to compare only
// `Text`, so it is usable as a Dictionary<LineTrackedString, object> key by text alone,
// independent of Line/StartChar. TypeScript objects always compare by identity as Map keys,
// so this class exposes `LineTrackedString.textKey` as the deliberate substitute: Task 2 is
// expected to key its section maps on `textKey(...)` (e.g. `Map<string, ...>`) rather than on
// the LineTrackedString instances themselves.
describe('LineTrackedString equality (text-only, per ScriptChecker.cs:1381-1385)', () => {
    it('treats two distinct instances with the same text as the same key via textKey', () => {
        // Mutant this catches: textKey deriving from anything other than `text` (e.g.
        // including `line` or `startChar` in the derived key, or returning the instance
        // itself) would make these two keys compare unequal, and the Map lookup below would
        // miss -- exactly the silent duplicate-key-detection failure the brief warns about.
        const a = new LineTrackedString(1, 'shared-text', 0);
        const b = new LineTrackedString(99, 'shared-text', 42);
        expect(a).not.toBe(b);
        expect(LineTrackedString.textKey(a)).toBe(LineTrackedString.textKey(b));

        const section = new Map<string, string>();
        section.set(LineTrackedString.textKey(a), 'first value');
        expect(section.has(LineTrackedString.textKey(b))).toBe(true);
        expect(section.get(LineTrackedString.textKey(b))).toBe('first value');
    });

    it('treats two instances with different text as different keys', () => {
        // Mutant this catches: textKey collapsing to a constant (or ignoring `text`) would
        // make unrelated keys collide, which would be an even worse silent failure than
        // never matching at all.
        const a = new LineTrackedString(1, 'text-a', 0);
        const b = new LineTrackedString(1, 'text-b', 0);
        expect(LineTrackedString.textKey(a)).not.toBe(LineTrackedString.textKey(b));
    });
});
