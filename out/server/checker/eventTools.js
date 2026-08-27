"use strict";
// Ported from SharpDenizenTools/ScriptAnalysis/EventTools.cs:16-41.
//
// The other half of that file -- `ParseMatchers` and `BuildMainContent` -- is in
// ./scriptEventCouldMatcher instead, to keep metaTypes.ts out of an import cycle. See the note on
// `parseMatchers` there.
//
// This module must stay I/O-free, as everything under checker/ must. It imports metaTypes for the
// data value sets, which is a pure model module.
Object.defineProperty(exports, "__esModule", { value: true });
exports.separateSwitches = exports.isOnlyDigits = void 0;
const frenetic_1 = require("./frenetic");
const metaTypes_1 = require("../metaDocs/metaTypes");
/**
 * Matcher for numerical digits 0-9 only. (EventTools.cs:16, `NumbersMatcher`)
 *
 * VACUOUSLY TRUE ON THE EMPTY STRING, exactly like `AsciiMatcher.IsOnlyMatches`, which loops the
 * characters and returns true having found no failure. That is not a curiosity here: it is what
 * decides a word beginning with a colon. In `separateSwitches`, `:value` has `''` before the
 * colon, so this returns true and the word is NOT treated as a switch.
 */
function isOnlyDigits(text) {
    for (const c of text) {
        if (c < '0' || c > '9') {
            return false;
        }
    }
    return true;
}
exports.isOnlyDigits = isOnlyDigits;
/**
 * Separates the switches from an event line. (EventTools.cs:23-41)
 *
 * Returns the cleaned event line -- the words that are not switches, rejoined -- and the switches
 * themselves.
 *
 * THREE TESTS DECIDE WHETHER A WORD IS A SWITCH, and the two negative ones are what stop ordinary
 * event words being eaten:
 *   1. it contains a colon at all;
 *   2. the part before the colon is not in the `not_switches` data set -- that set is why
 *      `item_flagged:cool` and `regex:...` stay part of the event line rather than becoming
 *      switches named `item_flagged` and `regex`;
 *   3. the part before the colon is not all digits -- which keeps a bare `3:4` out, and, through
 *      the empty-string case noted on `isOnlyDigits`, a leading `:value` too.
 *
 * The switch NAME is folded; the VALUE is not. Callers compare values against `'true'`/`'false'`
 * or parse them as numbers, and one of them (`bad_switch_value`) reports the value back to the
 * user, who should see what they typed.
 */
function separateSwitches(docs, eventLine) {
    const parts = eventLine.split(' ');
    let output = '';
    const switches = [];
    for (const part of parts) {
        if (part.includes(':') && !(0, metaTypes_1.isInDataValueSet)(docs, 'not_switches', (0, frenetic_1.before)(part, ':')) && !isOnlyDigits((0, frenetic_1.before)(part, ':'))) {
            const [switchName, switchVal] = (0, frenetic_1.beforeAndAfter)(part, ':');
            switches.push({ key: (0, frenetic_1.toLowerFast)(switchName), value: switchVal });
        }
        else {
            // EventTools.cs:37: appends the word AND a trailing space, then trims at the end. That
            // means consecutive switches collapse the gap between the words that surround them,
            // rather than leaving a double space behind.
            output += part + ' ';
        }
    }
    return { cleaned: output.trim(), switches };
}
exports.separateSwitches = separateSwitches;
//# sourceMappingURL=eventTools.js.map