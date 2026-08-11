/**
 * Parses the command context under the cursor, shared by the completion and hover
 * providers. Consolidates the line-walking that C# performs separately in
 * TextDocumentService.GetCompletionsFor (the `- ` branch) and GetHoverAt.
 */

import { getLineContext } from './lineContext';

/** What the cursor is looking at on a `- command args...` line. */
export interface CommandCursorContext {
    /** The command name, lowercased. May be a partial word while being typed. */
    name: string;
    /** True while the name itself is being typed — no space follows it yet. */
    typingName: boolean;
    /** Column on the line where the command name starts. */
    nameStart: number;
    /** Column one past the last character of the command name. */
    nameEnd: number;
    /** The whitespace-delimited argument the cursor sits in. Empty after a trailing space. */
    argThusFar: string;
    /** Text before the first `:` of `argThusFar`, or `''` when it has no colon. */
    argPrefix: string;
    /** Text after the first `:` of `argThusFar`, or all of it when it has no colon. */
    argValue: string;
    /** Column on the line where `argThusFar` begins. */
    argStart: number;
    /** Column on the line where `argThusFar` ends — the cursor column. */
    argEnd: number;
    /** 0-based index of the argument the cursor sits in, counting after the command name. -1 while the name itself is being typed. */
    argIndex: number;
}

/**
 * Parses an already-trimmed, already-lowercased command line.
 * `indent` is how many characters were trimmed from its left, so the returned
 * columns are relative to the full line.
 */
export function parseCommandLine(trimmed: string, indent: number): CommandCursorContext | null {
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
    const argIndex = typingName ? -1 : rest.substring(0, rest.lastIndexOf(' ')).split(' ').length - 1;
    return {
        name,
        typingName,
        nameStart,
        nameEnd: nameStart + name.length,
        argThusFar,
        argPrefix: colon === -1 ? '' : argThusFar.substring(0, colon),
        argValue: colon === -1 ? argThusFar : argThusFar.substring(colon + 1),
        argStart: nameStart + argOffsetInRest,
        argEnd: indent + trimmed.length,
        argIndex
    };
}

/** Parses the command context at `offset` within `text`, or null if the cursor is not on a command line. */
export function parseCursorContext(text: string, offset: number): CommandCursorContext | null {
    const line = getLineContext(text, offset);
    if (line === null) {
        return null;
    }
    return parseCommandLine(line.trimmed, line.indent);
}
