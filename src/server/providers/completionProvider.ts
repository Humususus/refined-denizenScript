/**
 * Context-free command completion. Ported from the command branch of
 * DenizenLangServer/Services/TextDocumentService.cs::GetCompletionsFor.
 *
 * Phase 2A scope: command names and their documented arguments only. Tag,
 * mechanism, event, and workspace-driven completions arrive in later phases.
 */

import { CompletionItem, CompletionItemKind, MarkupKind, Range, TextEdit } from 'vscode-languageserver';
import { MetaDocs, MetaCommand } from '../metaDocs/metaTypes';
import { describeCommand, describeTag } from './describe';
import { parseCursorContext, LineCursorContext } from './cursorContext';
import { findTagAtCursor, TagCursorContext } from './tagContext';
import { ExtraData } from '../metaDocs/extraData';
import { findEnumCompleters, findKeyLineCompleter } from './argumentCompleters';

/** Every command whose name starts with `partial`, as completion items carrying full docs. */
export function completeCommandNames(docs: MetaDocs, partial: string): CompletionItem[] {
    const results: CompletionItem[] = [];
    for (const [key, command] of docs.commands) {
        if (key.startsWith(partial)) {
            results.push({
                label: key,
                kind: CompletionItemKind.Method,
                detail: command.short,
                documentation: describeCommand(command)
            });
        }
    }
    return results;
}

/** The command's documented arguments that start with `argSoFar`. Prefixed arguments gain a trailing colon. */
export function completeCommandArguments(command: MetaCommand, argSoFar: string): CompletionItem[] {
    const results: CompletionItem[] = [];
    for (const arg of command.flatArguments) {
        if (arg.clean.startsWith(argSoFar)) {
            results.push({ label: arg.clean, kind: CompletionItemKind.Field, detail: arg.raw });
        }
    }
    for (const arg of command.argPrefixes) {
        if (arg.clean.startsWith(argSoFar)) {
            results.push({ label: `${arg.clean}:`, kind: CompletionItemKind.Field, detail: arg.raw });
        }
    }
    return results;
}

/**
 * Values of the enum backing this command argument, filtered by what has been typed.
 * `range` covers the entire typed argument value (not just the VS Code "current word"),
 * so accepting a dotted value like a sound name replaces all of `block.` rather than
 * leaving it in place and appending after it — see language-configuration.json's lack
 * of a wordPattern, which makes `.` and `:` break VS Code's default word boundaries.
 */
export function completeEnumValues(extra: ExtraData, commandName: string, argPrefix: string, argValue: string, range: Range): CompletionItem[] {
    const completers = findEnumCompleters(commandName, argPrefix);
    const results: CompletionItem[] = [];
    for (const completer of completers) {
        for (const value of completer.values(extra)) {
            if (value.startsWith(argValue)) {
                const textEdit: TextEdit = { range, newText: value };
                const item: CompletionItem = {
                    label: value,
                    kind: CompletionItemKind.Enum,
                    textEdit
                };
                // Some registrations (e.g. `determine`) intentionally carry no enum
                // label, meaning no documentation should be attached — see
                // CommandTabCompletions.cs's `key == null ? null : ...` in CompleteEnum.
                if (completer.label !== null) {
                    item.documentation = { kind: MarkupKind.Markdown, value: `**${completer.label}**: ${value}` };
                }
                results.push(item);
            }
        }
    }
    return results;
}

/**
 * Values of the enum backing a container key's value (e.g. `material: sto`), for a
 * non-command line. Mirrors TextDocumentService.cs:408-420's `LinePrefixCompleters`
 * branch: bail out if the line has no `:`, or if it already contains a `<` — a
 * tag's resolved value is not statically knowable, so no enum can be offered.
 * `range` follows `completeEnumValues`'s shape, covering the whole typed value so
 * a dotted or underscored value replaces cleanly instead of duplicating.
 */
export function completeKeyLineValues(extra: ExtraData, ctx: LineCursorContext, line: number): CompletionItem[] {
    const trimmed = ctx.trimmed;
    const colon = trimmed.indexOf(':');
    if (colon === -1 || trimmed.includes('<')) {
        return [];
    }
    const key = trimmed.substring(0, colon);
    const completer = findKeyLineCompleter(key);
    if (completer === null) {
        return [];
    }
    const rawValue = trimmed.substring(colon + 1);
    const value = rawValue.trim();
    const leadingSpaces = rawValue.length - rawValue.trimStart().length;
    const valueStart = ctx.indent + colon + 1 + leadingSpaces;
    const valueEnd = ctx.indent + trimmed.length;
    const range: Range = { start: { line, character: valueStart }, end: { line, character: valueEnd } };
    const results: CompletionItem[] = [];
    for (const candidate of completer.values(extra)) {
        if (candidate.startsWith(value)) {
            const textEdit: TextEdit = { range, newText: candidate };
            const item: CompletionItem = {
                label: candidate,
                kind: CompletionItemKind.Enum,
                textEdit
            };
            if (completer.label !== null) {
                item.documentation = { kind: MarkupKind.Markdown, value: `**${completer.label}**: ${candidate}` };
            }
            results.push(item);
        }
    }
    return results;
}

/**
 * Completions for the tag component the cursor sits inside, as located by
 * `findTagAtCursor`. `componentCount === 0` means the cursor is still in the tag's
 * base (the text before its first top-level dot, e.g. "player" in `<player.na`), so
 * candidates come from `docs.tagBases`; any later component draws from `docs.tagParts`
 * instead (TextDocumentService.cs's equivalent branch does the same base-vs-part split).
 *
 * `tag.lastComponent` is matched case-insensitively: `findTagAtCursor` deliberately does
 * not lowercase it (see tagContext.ts's file header), but `tagBases`/`tagParts` hold only
 * lowercase entries (MetaTag.addTo), so a capitalised prefix like `<Pla` would otherwise
 * match nothing — this was flagged in Task 3's review as the bug most likely to survive
 * unnoticed here. The C# equivalent lowercases the whole tag before matching
 * (TextDocumentService.cs:473); this lowercases only the component being completed,
 * which is equivalent for prefix-matching against already-lowercase candidate sets.
 *
 * `textEdit` covers only `tag.lastComponent` — from `lastComponentStart` to the cursor —
 * not the whole tag, mirroring `completeEnumValues`'s replace-the-whole-typed-value shape
 * but scoped to the single dot-separated component being typed.
 *
 * Documentation is attached only when `docs.tags` has an exact entry for the candidate
 * itself (e.g. a bare tag like `<player>`, whose clean name has no dot). A part such as
 * "expiration" is not itself a full tag name, so most candidates carry no documentation —
 * that is expected, not a bug, and no documentation is synthesised for them.
 */
export function completeTag(docs: MetaDocs, tag: TagCursorContext, line: number): CompletionItem[] {
    const prefix = tag.lastComponent.toLowerCase();
    const source = tag.componentCount === 0 ? docs.tagBases : docs.tagParts;
    const range: Range = {
        start: { line, character: tag.lastComponentStart },
        end: { line, character: tag.lastComponentStart + tag.lastComponent.length }
    };
    const results: CompletionItem[] = [];
    for (const candidate of source) {
        if (candidate.startsWith(prefix)) {
            const textEdit: TextEdit = { range, newText: candidate };
            const item: CompletionItem = {
                label: candidate,
                kind: CompletionItemKind.Property,
                textEdit
            };
            const doc = docs.tags.get(candidate);
            if (doc !== undefined) {
                item.documentation = describeTag(doc);
            }
            results.push(item);
        }
    }
    return results;
}

/** Entry point: what should be offered at `offset` on `line` within `text`. */
export function provideCompletions(docs: MetaDocs, extra: ExtraData, text: string, offset: number, line: number): CompletionItem[] {
    const ctx = parseCursorContext(text, offset);
    if (ctx === null) {
        return [];
    }
    if (ctx.kind === 'line') {
        return completeKeyLineValues(extra, ctx, line);
    }
    if (ctx.typingName) {
        return completeCommandNames(docs, ctx.name);
    }
    // Checked here — after typingName is known false, before the argument-name/enum
    // branch below — because `<` cannot begin an argument keyword or an enum value:
    // completeCommandArguments matches `arg.clean.startsWith(argSoFar)` and
    // completeEnumValues matches `value.startsWith(argValue)`, and neither an
    // argument's `clean` name nor any registered enum value ever starts with '<'. So
    // once the cursor is inside an unclosed tag, argThusFar/argValue carry that literal
    // '<...' text and the branch below is guaranteed to return nothing anyway — running
    // it would waste work to reconfirm an emptiness this branch already knows. Tag
    // completion is the only branch that can offer anything useful here.
    const tagCtx = findTagAtCursor(ctx.argThusFar, ctx.argStart);
    if (tagCtx !== null) {
        return completeTag(docs, tagCtx, line);
    }
    // C# merges both sources rather than choosing one (TextDocumentService.cs:362-367
    // appends the ByCommand completer's output onto the argument-name results), and the
    // order matters: argument names first, enum values after. Returning only the enum
    // results would hide a command's own arguments behind any bare-prefix enum — e.g.
    // `- give q` would list quartz items but swallow `quantity:`.
    const command = docs.commands.get(ctx.name);
    const argResults = command === undefined ? [] : completeCommandArguments(command, ctx.argThusFar);
    // Start of the value within argThusFar: argThusFar may still carry a `prefix:`
    // that argValue does not, so the difference in their lengths is exactly how far
    // into argThusFar (from ctx.argStart) the value itself begins.
    const valueStart = ctx.argStart + (ctx.argThusFar.length - ctx.argValue.length);
    const range: Range = { start: { line, character: valueStart }, end: { line, character: ctx.argEnd } };
    return [...argResults, ...completeEnumValues(extra, ctx.name, ctx.argPrefix, ctx.argValue, range)];
}
