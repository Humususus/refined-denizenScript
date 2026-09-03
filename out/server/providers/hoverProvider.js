"use strict";
/**
 * Hover documentation. Ported from the command and `type:` branches of
 * DenizenLangServer/Services/TextDocumentService.cs::GetHoverAt.
 *
 * Phase 2A scope was commands and container types; event hover was deferred pending the event
 * matcher machinery, which landed in Phase 2C-7. Added 2026-09-03, user request -- "на events нет
 * ховер описания ивента".
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.provideHover = void 0;
const describe_1 = require("./describe");
const lineContext_1 = require("./lineContext");
const cursorContext_1 = require("./cursorContext");
const eventLineMatch_1 = require("../checker/eventLineMatch");
const TYPE_PREFIX = 'type: ';
// A `COMMAND_NAME_PATTERN = /^[a-z0-9_]+$/` guard used to sit here, and it was a PORT ARTIFACT
// rather than anything the C# does. TextDocumentService.cs:101-118 derives hover from the
// completion list -- it asks GetCompletionsFor and matches each returned label against the line,
// so any command the completer can offer is hoverable, with no character whitelist anywhere.
//
// The whitelist silently excluded every command name containing a hyphen. That costs nothing on
// the official meta (measured: 0 of 184 command names fall outside it) but breaks exactly the
// commands users add through `denizenscript.server.extra_sources`, where hyphenated names are
// common -- reported by the user 2026-08-27 as add-on commands completing but never hovering.
//
// The `docs.commands.get(...)` lookup below already answers the only question that matters, and
// answers it correctly for names the pattern could never have anticipated.
/**
 * Describes whatever meta object sits under the cursor, or null if there is nothing to say.
 *
 * `line` must describe the same position as `offset` (i.e. the zero-based line number that
 * `offset` falls on) — it is used only to build the returned range's line coordinates. The
 * column is not taken from the caller; it is derived internally from `offset` and the found
 * line's start, so it can never desync from `offset`.
 */
function provideHover(docs, text, offset, line) {
    const found = (0, lineContext_1.getFullLine)(text, offset);
    if (found === null) {
        return null;
    }
    const character = offset - found.startOfLine;
    const raw = found.line;
    const trimmedRaw = raw.trimStart();
    const indent = raw.length - trimmedRaw.length;
    const trimmed = trimmedRaw.toLowerCase();
    const cmdCtx = (0, cursorContext_1.parseCommandLine)(trimmed, indent);
    if (cmdCtx !== null) {
        if (character < cmdCtx.nameStart || character > cmdCtx.nameEnd) {
            return null;
        }
        const command = docs.commands.get(cmdCtx.name);
        if (command === undefined) {
            return null;
        }
        return {
            contents: (0, describe_1.describeCommand)(command),
            range: { start: { line, character: cmdCtx.nameStart }, end: { line, character: cmdCtx.nameEnd } }
        };
    }
    if (trimmed.startsWith(TYPE_PREFIX)) {
        if (character < indent || character > raw.length) {
            return null;
        }
        const containerType = `${trimmed.substring(TYPE_PREFIX.length).trim()} script containers`;
        const lang = docs.languages.get(containerType);
        if (lang === undefined) {
            return null;
        }
        return {
            contents: (0, describe_1.describeLang)(lang),
            range: { start: { line, character: indent }, end: { line, character: raw.length } }
        };
    }
    // An event line -- `on player joins:` or `after player breaks block cancelled:true:`. Not
    // gated on being inside a world container's `events:` key, unlike the client-side event
    // completion (`isInWorldEvents`): that gate needs a structural walk of the whole document that
    // hover has no reason to duplicate. `matchEventLine` requiring a FULL could-matcher hit already
    // does the real work -- the trimmed text has to look exactly like a documented event, which
    // "on player joins:" written somewhere it does not belong could only coincide with by writing
    // that literal string, a false positive with no bad consequence (correct information, just
    // technically unsolicited).
    //
    // WHOLE-LINE RANGE, matching the `type:` branch just above rather than pinpointing the event
    // name's own span: switches (`priority:5`) are part of what gets matched and are reasonable to
    // hover too, and a per-word range would need the same span bookkeeping `checkOneEventLine` does
    // for its diagnostic, which hover does not need for correctness.
    if (character >= indent && character <= raw.length) {
        const evt = (0, eventLineMatch_1.matchEventLine)(docs, raw);
        if (evt !== null) {
            return {
                contents: (0, describe_1.describeEvent)(evt),
                range: { start: { line, character: indent }, end: { line, character: raw.length } }
            };
        }
    }
    return null;
}
exports.provideHover = provideHover;
//# sourceMappingURL=hoverProvider.js.map