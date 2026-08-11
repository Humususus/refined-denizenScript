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
 *
 * A single logical parameter can itself contain spaces (e.g. `inventory`'s first
 * argument lists a dozen literal choices separated by `/` before its final
 * `(expire:<time>)]`), so a plain space-split is wrong. This mirrors the
 * bracket/tag-depth tracking in `splitTopLevelArguments` (./cursorContext): a space
 * ends a token only at depth zero. One depth counter is shared across `[`/`]`,
 * `(`/`)`, and `<`/`>` rather than three separate counters — syntax lines nest them
 * freely (e.g. `(:<action>)[:<value>]`) and matching bracket kinds strictly would be
 * more fragile, not less. The decrement is guarded so depth can never go negative.
 */
export function tokenizeSyntax(syntax: string): SyntaxToken[] {
    const tokens: SyntaxToken[] = [];
    let depth = 0;
    let tokenStart = -1;
    let isFirst = true;
    const flush = (end: number): void => {
        if (tokenStart === -1) {
            return;
        }
        if (isFirst) {
            isFirst = false;
        }
        else {
            tokens.push({ text: syntax.substring(tokenStart, end), start: tokenStart, end });
        }
        tokenStart = -1;
    };
    for (let i = 0; i < syntax.length; i++) {
        const ch = syntax[i];
        const isSeparator = ch === ' ' && depth === 0;
        if (isSeparator) {
            flush(i);
            continue;
        }
        if (tokenStart === -1) {
            tokenStart = i;
        }
        if (ch === '[' || ch === '(' || ch === '<') {
            depth++;
        }
        else if (ch === ']' || ch === ')' || ch === '>') {
            if (depth > 0) {
                depth--;
            }
        }
    }
    flush(syntax.length);
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
        activeParameter: activeParameterFor(tokens, ctx.argIndex)
    };
}

/**
 * Picks which parameter to highlight, or `null` per the LSP contract
 * (`SignatureHelp.activeParameter`, vscode-languageserver-types `main.d.ts`:
 * "Set to `null` if the active signature has no parameters").
 *
 * When `argIndex` runs past the documented parameter list — legal for commands
 * whose last argument is variadic, e.g. `narrate`'s own
 * `(targets:<player>|...)` — the highlight clamps to that last parameter only if
 * it is actually variadic (its text contains `|...`, meaning it can absorb more
 * values). Otherwise there is nothing meaningful left to highlight, so this
 * returns `null` rather than pinning the highlight to a parameter that only ever
 * takes one value (e.g. `narrate`'s trailing `(format:<script>)`).
 */
function activeParameterFor(tokens: SyntaxToken[], argIndex: number): number | null {
    if (tokens.length === 0) {
        return null;
    }
    if (argIndex < tokens.length) {
        return argIndex;
    }
    const lastIndex = tokens.length - 1;
    return tokens[lastIndex].text.includes('|...') ? lastIndex : null;
}
