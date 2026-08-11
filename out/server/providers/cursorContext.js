"use strict";
/**
 * Parses the command context under the cursor, shared by the completion and hover
 * providers. Consolidates the line-walking that C# performs separately in
 * TextDocumentService.GetCompletionsFor (the `- ` branch) and GetHoverAt.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCursorContext = exports.parseCommandLine = void 0;
const lineContext_1 = require("./lineContext");
/**
 * Parses an already-trimmed, already-lowercased command line.
 * `indent` is how many characters were trimmed from its left, so the returned
 * columns are relative to the full line.
 */
function parseCommandLine(trimmed, indent) {
    if (!trimmed.startsWith('- ')) {
        return null;
    }
    let nameStart = indent + 2;
    let rest = trimmed.substring(2);
    if (rest.startsWith('~')) {
        rest = rest.substring(1);
        nameStart++;
    }
    const firstSpace = rest.indexOf(' ');
    const name = firstSpace === -1 ? rest : rest.substring(0, firstSpace);
    const typingName = firstSpace === -1;
    // Offset of argThusFar within `rest`: the empty string right after `rest`
    // itself while the name is still being typed (there is no argument yet), or
    // the text following the last space otherwise.
    const argOffsetInRest = typingName ? rest.length : rest.lastIndexOf(' ') + 1;
    const argThusFar = typingName ? '' : rest.substring(argOffsetInRest);
    const colon = argThusFar.indexOf(':');
    return {
        name,
        typingName,
        nameStart,
        nameEnd: nameStart + name.length,
        argThusFar,
        argPrefix: colon === -1 ? '' : argThusFar.substring(0, colon),
        argValue: colon === -1 ? argThusFar : argThusFar.substring(colon + 1),
        argStart: nameStart + argOffsetInRest,
        argEnd: indent + trimmed.length
    };
}
exports.parseCommandLine = parseCommandLine;
/** Parses the command context at `offset` within `text`, or null if the cursor is not on a command line. */
function parseCursorContext(text, offset) {
    const line = (0, lineContext_1.getLineContext)(text, offset);
    if (line === null) {
        return null;
    }
    return parseCommandLine(line.trimmed, line.indent);
}
exports.parseCursorContext = parseCursorContext;
//# sourceMappingURL=cursorContext.js.map