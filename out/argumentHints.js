"use strict";
// The decision half of the inline argument hints: given a command's documented syntax and the line
// the user has typed so far, work out which arguments they have NOT supplied yet. No `vscode`
// import, so every branch is unit-testable -- the same split `definitionIndex.ts`,
// `quickFixPlans.ts` and `tagSeparators.ts` use.
//
// Backlog item 5, asked for 2026-08-11: "what arguments does this command still take?", shown as
// grey text in the line rather than as a floating panel.
//
// WHERE THE SYNTAX COMES FROM. The client has no meta of its own, so it asks whichever language
// server is running via `vscode.executeSignatureHelpProvider` and reads the parameter list off the
// answer. That is why this module takes plain strings: it is deliberately ignorant of both the LSP
// types and `MetaCommand`, so it can be driven from a signature response, from the meta directly,
// or from a test fixture.
//
// THE HARD PART IS "ALREADY SUPPLIED", and Denizen has two kinds of argument that answer it
// differently. A PREFIXED argument (`sound:<name>`) is supplied when its prefix appears anywhere on
// the line, in any order. A BARE argument (`[<text>]`) has no marker at all, so the only thing that
// can be said is how many bare arguments have been written, and the documented bare parameters are
// consumed in order to match. Everything below follows from that split.
Object.defineProperty(exports, "__esModule", { value: true });
exports.hintTextFor = exports.remainingArguments = exports.splitWrittenArguments = exports.parseSyntaxParameter = void 0;
/**
 * Reads one syntax token into a parameter.
 *
 * `[sound:<name>]` is required with prefix `sound`; `(volume:<#.#>)` is optional with prefix
 * `volume`; `[<text>]` is required and bare.
 *
 * The prefix must be a plain word before a colon and OUTSIDE any `<...>`: `[<location>]` has a
 * colon in none of its parts, but `[<player>:<value>]` would, and that colon belongs to the value
 * rather than naming a prefix. Requiring the prefix to be leading word characters is what keeps
 * those apart.
 */
function parseSyntaxParameter(text) {
    const required = text.startsWith('[');
    // Strip ONE layer of the enclosing bracket, whichever kind it is, so the prefix test sees the
    // argument itself. A token with no enclosing bracket (some syntaxes have bare literals) is
    // left alone.
    const inner = /^[[(](.*)[\])]$/.exec(text);
    const body = inner === null ? text : inner[1];
    const prefixMatch = /^([A-Za-z_][A-Za-z0-9_]*):/.exec(body);
    return {
        text,
        prefix: prefixMatch === null ? null : prefixMatch[1].toLowerCase(),
        required
    };
}
exports.parseSyntaxParameter = parseSyntaxParameter;
/** ASCII-only lowercase, matching `toLowerFast` in the checker. */
function foldAscii(text) {
    let out = '';
    for (const ch of text) {
        const code = ch.charCodeAt(0);
        out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : ch;
    }
    return out;
}
/**
 * The arguments already written on `commandLine`, split the way Denizen splits them.
 *
 * A space only separates arguments at depth zero: `<map[a=1;b=2]>` and `"hello there"` are each one
 * argument. Same counting rule as `splitTopLevelArguments` in the server's cursorContext, kept
 * separate because this module is client-side and must not depend on the server.
 *
 * The leading `- ` and the command name are dropped, so index 0 is the command's first argument.
 */
function splitWrittenArguments(commandLine) {
    const dash = commandLine.indexOf('-');
    if (dash === -1) {
        return [];
    }
    const text = commandLine.slice(dash + 1);
    const parts = [];
    let depth = 0;
    let quote = null;
    let start = -1;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quote !== null) {
            if (ch === quote) {
                quote = null;
            }
            continue;
        }
        if (ch === '"' || ch === '\'') {
            quote = ch;
            if (start === -1) {
                start = i;
            }
            continue;
        }
        if (ch === '<' || ch === '[' || ch === '(') {
            depth++;
        }
        else if (ch === '>' || ch === ']' || ch === ')') {
            if (depth > 0) {
                depth--;
            }
        }
        if (ch === ' ' && depth === 0) {
            if (start !== -1) {
                parts.push(text.slice(start, i));
                start = -1;
            }
            continue;
        }
        if (start === -1) {
            start = i;
        }
    }
    if (start !== -1) {
        parts.push(text.slice(start));
    }
    // The first token is the command name, sigil and all.
    return parts.slice(1);
}
exports.splitWrittenArguments = splitWrittenArguments;
/**
 * The documented parameters the user has not supplied yet, in syntax order.
 *
 * `atCursor` is the argument the caret currently sits in. It is EXCLUDED from the "already
 * written" count, because a half-typed argument is one the user is still working on -- counting it
 * would make the hint drop the very parameter being typed, which is when the hint is most wanted.
 */
function remainingArguments(parameters, commandLine) {
    const written = splitWrittenArguments(commandLine);
    // The argument under the caret is the last one when the line ends mid-word; a line ending in a
    // space means a fresh, empty argument and nothing to discount.
    const settled = commandLine.endsWith(' ') ? written : written.slice(0, -1);
    const usedPrefixes = new Set();
    let bareCount = 0;
    for (const arg of settled) {
        const colon = arg.indexOf(':');
        const prefix = colon > 0 ? foldAscii(arg.slice(0, colon)) : null;
        // Only a plain word before the colon names a prefix. `<player.flag[x]>` contains no
        // top-level colon; `"a: b"` is quoted; either way a non-word prefix means a bare argument.
        if (prefix !== null && /^[a-z_][a-z0-9_]*$/.test(prefix)) {
            usedPrefixes.add(prefix);
        }
        else {
            bareCount++;
        }
    }
    const remaining = [];
    for (const parameter of parameters) {
        if (parameter.prefix !== null) {
            if (!usedPrefixes.has(parameter.prefix)) {
                remaining.push(parameter);
            }
            continue;
        }
        // Bare parameters are consumed in order by the bare arguments written.
        if (bareCount > 0) {
            bareCount--;
            continue;
        }
        remaining.push(parameter);
    }
    return remaining;
}
exports.remainingArguments = remainingArguments;
/** How much hint text to render before it stops being a hint and starts being clutter. */
const MAX_HINT_LENGTH = 60;
/**
 * The grey text to show at the end of the line, or null when there is nothing worth saying.
 *
 * REQUIRED ARGUMENTS COME FIRST and optional ones fill whatever room is left. A line missing a
 * required argument is the case the user actually needs telling about; the optional ones are a
 * reminder, and a reminder that pushes the required one off the end would be worse than useless.
 *
 * The result is capped and ellipsised rather than wrapped: an inlay hint renders on one line, and
 * a command like `inventory` has a syntax long enough to fill a screen on its own.
 */
function hintTextFor(parameters, commandLine) {
    const remaining = remainingArguments(parameters, commandLine);
    if (remaining.length === 0) {
        return null;
    }
    const ordered = [...remaining.filter(p => p.required), ...remaining.filter(p => !p.required)];
    const shown = [];
    let length = 0;
    for (const parameter of ordered) {
        const next = length === 0 ? parameter.text.length : length + 1 + parameter.text.length;
        if (next > MAX_HINT_LENGTH) {
            shown.push('…');
            break;
        }
        shown.push(parameter.text);
        length = next;
    }
    return shown.length === 0 ? null : shown.join(' ');
}
exports.hintTextFor = hintTextFor;
//# sourceMappingURL=argumentHints.js.map