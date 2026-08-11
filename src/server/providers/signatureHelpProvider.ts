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
 * Picks which parameter to highlight. Returns `null` only when there are no
 * parameters at all (`tokens.length === 0`) — that case is spec-correct per the
 * LSP contract (`SignatureHelp.activeParameter`, vscode-languageserver-types
 * `main.d.ts`: "Set to `null` if the active signature has no parameters") and
 * harmless, since there is nothing to emphasise either way.
 *
 * When `argIndex` runs past the documented parameter list, the highlight clamps
 * UNCONDITIONALLY to the last parameter — including for a non-variadic last
 * parameter. An earlier version of this function returned `null` in that case
 * (reserving the clamp for variadic last parameters, e.g. `narrate`'s own
 * `(targets:<player>|...)`), reasoning that `null` means "emphasise nothing" per
 * the type declaration above. That reasoning does not survive contact with the
 * shipped client: `vscode-languageclient`'s `protocolConverter.js:345-351` does
 *
 *     if (Is.number(item.activeParameter)) { result.activeParameter = item.activeParameter; }
 *     else { result.activeParameter = 0; }   // activeParameter was optional in the past
 *
 * and `Is.number(null)` is `false` (see `utils/is.js`: it tests
 * `typeof value === 'number' || value instanceof Number`). So a deliberate
 * `null` is silently converted to `0` on the client side — which highlights the
 * FIRST parameter, the exact opposite of "nothing is active". Concretely: once
 * the user types a space past their last argument, the highlight would jump
 * back to parameter 1 instead of staying near where they are typing. Clamping
 * to the last parameter is a far closer approximation of "still on this
 * signature, nothing more specific to say" than jumping to the first one, so
 * the clamp is now unconditional and the variadic-only special case is gone.
 * Do not reintroduce a `null` return here for a non-empty `tokens` — it will be
 * silently rewritten to `0` by the client before it ever reaches the user.
 */
function activeParameterFor(tokens: SyntaxToken[], argIndex: number): number | null {
    if (tokens.length === 0) {
        return null;
    }
    if (argIndex < tokens.length) {
        return argIndex;
    }
    return tokens.length - 1;
}
