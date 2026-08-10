/**
 * Hover documentation. Ported from the command and `type:` branches of
 * DenizenLangServer/Services/TextDocumentService.cs::GetHoverAt.
 *
 * Phase 2A scope: commands and container types. Event and action hover need the
 * event matcher machinery and arrive in Phase 2B.
 */

import { Hover } from 'vscode-languageserver';
import { MetaDocs } from '../metaDocs/metaTypes';
import { describeCommand, describeLang } from './describe';
import { getFullLine } from './lineContext';

const TYPE_PREFIX = 'type: ';

/** Characters that can appear in a Denizen command name. */
const COMMAND_NAME_PATTERN = /^[a-z0-9_]+$/;

/**
 * Describes whatever meta object sits under the cursor, or null if there is nothing to say.
 *
 * `line` must describe the same position as `offset` (i.e. the zero-based line number that
 * `offset` falls on) — it is used only to build the returned range's line coordinates. The
 * column is not taken from the caller; it is derived internally from `offset` and the found
 * line's start, so it can never desync from `offset`.
 */
export function provideHover(docs: MetaDocs, text: string, offset: number, line: number): Hover | null {
    const found = getFullLine(text, offset);
    if (found === null) {
        return null;
    }
    const character = offset - found.startOfLine;
    const raw = found.line;
    const trimmedRaw = raw.trimStart();
    const indent = raw.length - trimmedRaw.length;
    const trimmed = trimmedRaw.toLowerCase();
    if (trimmed.startsWith('- ')) {
        let nameStart = indent + 2;
        let rest = trimmed.substring(2);
        if (rest.startsWith('~')) {
            rest = rest.substring(1);
            nameStart++;
        }
        const spaceIndex = rest.indexOf(' ');
        const commandName = spaceIndex === -1 ? rest : rest.substring(0, spaceIndex);
        if (!COMMAND_NAME_PATTERN.test(commandName)) {
            return null;
        }
        const nameEnd = nameStart + commandName.length;
        if (character < nameStart || character > nameEnd) {
            return null;
        }
        const command = docs.commands.get(commandName);
        if (command === undefined) {
            return null;
        }
        return {
            contents: describeCommand(command),
            range: { start: { line, character: nameStart }, end: { line, character: nameEnd } }
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
            contents: describeLang(lang),
            range: { start: { line, character: indent }, end: { line, character: raw.length } }
        };
    }
    return null;
}
