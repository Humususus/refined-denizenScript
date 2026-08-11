/**
 * Signature help: shows a command's full syntax and highlights the argument the
 * cursor is on.
 *
 * This has no C# counterpart to port — DenizenLangServer's SignatureHelp handler
 * (TextDocumentService.cs:213-217) returns an empty result. It is built here from
 * MetaCommand.syntax, which the meta docs already carry verbatim.
 */

import { SignatureHelp, SignatureInformation, ParameterInformation, MarkupKind } from 'vscode-languageserver';
import { MetaDocs } from '../metaDocs/metaTypes';
import { descriptionClean } from './describe';
import { parseCursorContext } from './cursorContext';

/** One argument token of a syntax line, with where it sits inside that line. */
export interface SyntaxToken {
    text: string;
    /** Index of the token's first character within the syntax string. */
    start: number;
    /** Index one past the token's last character. */
    end: number;
}

/**
 * Splits a syntax line into its argument tokens, dropping the leading command name.
 * Offsets are preserved because LSP wants parameter labels as `[start, end]` pairs
 * into the signature label so the client can highlight the active one in place.
 */
export function tokenizeSyntax(syntax: string): SyntaxToken[] {
    const tokens: SyntaxToken[] = [];
    let index = 0;
    let isFirst = true;
    while (index < syntax.length) {
        while (index < syntax.length && syntax[index] === ' ') {
            index++;
        }
        const start = index;
        while (index < syntax.length && syntax[index] !== ' ') {
            index++;
        }
        if (index > start) {
            if (isFirst) {
                isFirst = false;
            }
            else {
                tokens.push({ text: syntax.substring(start, index), start, end: index });
            }
        }
    }
    return tokens;
}

/** Describes the command under the cursor and which of its arguments is active. */
export function provideSignatureHelp(docs: MetaDocs, text: string, offset: number): SignatureHelp | null {
    const ctx = parseCursorContext(text, offset);
    if (ctx === null || ctx.typingName) {
        return null;
    }
    const command = docs.commands.get(ctx.name);
    if (command === undefined) {
        return null;
    }
    const tokens = tokenizeSyntax(command.syntax);
    const parameters: ParameterInformation[] = tokens.map(token => ({
        label: [token.start, token.end] as [number, number]
    }));
    const signature: SignatureInformation = {
        label: command.syntax,
        documentation: { kind: MarkupKind.Markdown, value: descriptionClean(command.short) },
        parameters
    };
    return {
        signatures: [signature],
        activeSignature: 0,
        activeParameter: tokens.length === 0 ? 0 : Math.min(ctx.argIndex, tokens.length - 1)
    };
}
