"use strict";
/**
 * Hover documentation. Ported from the command and `type:` branches of
 * DenizenLangServer/Services/TextDocumentService.cs::GetHoverAt.
 *
 * Phase 2A scope: commands and container types. Event and action hover need the
 * event matcher machinery and arrive in Phase 2B.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.provideHover = void 0;
const describe_1 = require("./describe");
const lineContext_1 = require("./lineContext");
const cursorContext_1 = require("./cursorContext");
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
    return null;
}
exports.provideHover = provideHover;
//# sourceMappingURL=hoverProvider.js.map