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
import { parseTag } from './tagHelper';
import { traceTag } from './tagTracer';

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
 * The narrowed half of tag-part completion: the tags actually valid on whatever the
 * preceding tag part returns. Ported from TextDocumentService.cs:522-534.
 *
 * Returns null — NOT an empty array — when the trace could not narrow, meaning the
 * caller must fall back to the full flat `docs.tagParts` list. That distinction is the
 * single most load-bearing thing in this file:
 *
 *   C# reads `if (lastPart.PossibleSubTypes.Any())` at :531. When that is false control
 *   falls through to :535, which returns `MetaDocs.CurrentMeta.TagParts.Where(tag =>
 *   tag.StartsWith(subComponent))` — i.e. EVERY documented part name, filtered only by
 *   the typed prefix. An empty type set means "I know nothing, so offer everything",
 *   never "offer nothing".
 *
 * That is not an exotic edge case. `traceTag` leaves the last part's set empty whenever
 * tracing never reached it, which happens for ordinary input:
 *   - a multi-part base tag swallowing every part, e.g. `<server.flag[x].` (real meta
 *     contains a tag literally named `server.flag`, so TagTracer.cs:69-76 consumes both
 *     parts and resumes past the end);
 *   - a multi-part subtag swallowing the final part, e.g. `<player.foo.bar.`
 *     (TagTracer.cs:214 only records a set at the index a match STARTED at);
 *   - any early return in the trace, e.g. a base tag handed a parameter it forbids.
 * Treating those as "no candidates" would make them offer nothing at all — strictly
 * worse than the unnarrowed behaviour this replaces.
 *
 * The text traced is everything before the last top-level dot (TextDocumentService.cs:
 * 523-527), derived from the cursor context rather than re-scanned: `lastComponentStart
 * - tagStart` is the offset just past that dot within `tagSoFar`, so one less drops the
 * dot itself. `componentCount > 0` (checked by the caller) guarantees that offset is at
 * least 1, so the slice is never negative.
 *
 * The candidate rule mirrors :533's two OR'd conditions: a tag qualifies if its
 * `baseType` is one of the traced sub-types, OR its `beforeDot` equals the traced tag's
 * last part text. The second condition is what keeps pseudo-object bases working —
 * `<server.x>`, `<util.x>` and friends have no object type behind them, so their
 * `baseType` is null and only the name match can find them. The comparison is
 * case-sensitive, as in C#: `beforeDot` keeps the meta's original casing (MetaTag's
 * `attribute` handler lowercases only AFTER taking it) while the traced part text is
 * lowercased by `parseTag`, so this matches lowercase pseudo-bases like `server` and
 * deliberately does not match object-type bases like `PlayerTag` — which the first
 * condition already covers, by identity rather than by name.
 */
function completeTagNarrowed(docs: MetaDocs, tag: TagCursorContext, prefix: string, range: Range): CompletionItem[] | null {
    const beforeLastDot = tag.tagSoFar.substring(0, tag.lastComponentStart - tag.tagStart - 1);
    // Parse errors are irrelevant here — this is a half-typed tag by definition, and the
    // tracer copes with whatever parts come out. Diagnostics are a later phase.
    const parsed = parseTag(beforeLastDot, () => { /* ignore */ });
    const traced = traceTag(docs, parsed);
    // TextDocumentService.cs:531. The `return null` is the fall-through to :535.
    if (traced.possibleSubTypes.size === 0) {
        return null;
    }
    // DELIBERATE DEVIATION from TextDocumentService.cs:531-533 — do not "restore fidelity"
    // here. C# narrows whenever the set is non-empty, including when it holds EVERY object
    // type. Such a set carries zero information: narrowing to it filters nothing out while
    // paying the full cost of the narrowed branch. Measured on live meta (72 object types,
    // 2493 tags, 1871 parts), for `<[mydef].` and `<player.flag[x].`:
    //     narrowed  2240 items, 367 duplicate labels (name x28, id x13, size x9), 1136 KB, ~5.7 ms
    //     flat      1871 items,   0 duplicates,                                     269 KB, ~0.1 ms
    // Nothing absorbs that: C# has no Distinct(), `describeTag` is built eagerly per item,
    // and `resolveProvider: false` (server.ts) forecloses lazy resolution. The all-types set
    // arises exactly when a tag declines to narrow by documenting `@returns ObjectTag`
    // (TagTracer.cs:126-129) — i.e. flags, definitions and `proc`, the most common
    // constructs in Denizen script — so treating it as "the tracer does not know" makes
    // those genuinely unnarrowed, rather than merely "not narrowed to a WRONG subset".
    //
    // Verified safe against live meta before shipping: of all 2493 documented tags traced
    // as written, exactly 3 produce an all-72 set and all 3 are ObjectTag-returning; the
    // largest set from a legitimately narrowing trace is 5, a gap of 67. No real input
    // narrows to all-72 for a good reason.
    //
    // Compared against `docs.objectTypes.size` rather than a literal, since the corpus
    // grows. Equal size implies equal set here: every member of possibleSubTypes comes from
    // docs.objectTypes (via objectTypes lookups, baseType, implementsTypes or extendedBy),
    // so a subset of that map with the same cardinality IS that map.
    if (traced.possibleSubTypes.size === docs.objectTypes.size) {
        return null;
    }
    const lastPartText = parsed.parts.length === 0 ? '' : parsed.parts[parsed.parts.length - 1].text;
    const results: CompletionItem[] = [];
    for (const candidate of docs.tags.values()) {
        const byType = candidate.baseType !== null && traced.possibleSubTypes.has(candidate.baseType);
        if (!byType && candidate.beforeDot !== lastPartText) {
            continue;
        }
        // Same deliberate divergence from C# as MetaTag.addTo's tagParts population: a
        // dotless tag has an empty afterDotCleaned, and an empty candidate would match
        // every prefix and insert nothing. C#'s Select would emit it; this drops it.
        if (candidate.afterDotCleaned.length === 0 || !candidate.afterDotCleaned.startsWith(prefix)) {
            continue;
        }
        const textEdit: TextEdit = { range, newText: candidate.afterDotCleaned };
        results.push({
            label: candidate.afterDotCleaned,
            kind: CompletionItemKind.Property,
            textEdit,
            // Unlike the flat branch, this IS the tag being completed, so its own
            // documentation is genuinely its own — no namespace-collision risk, and so
            // no need for that branch's `componentCount === 0` gate.
            documentation: describeTag(candidate)
        });
    }
    return results;
}

/**
 * Completions for the tag component the cursor sits inside, as located by
 * `findTagAtCursor`. `componentCount === 0` means the cursor is still in the tag's
 * base (the text before its first top-level dot, e.g. "player" in `<player.na`), so
 * candidates come from `docs.tagBases`; any later component draws from `docs.tagParts`
 * instead (TextDocumentService.cs makes the same base-vs-part split: :506 for bases,
 * :535 for parts).
 *
 * `tag.lastComponent` is matched case-insensitively. On every path that reaches here from
 * `provideCompletions` it is ALREADY lowercase: `getLineContext` (lineContext.ts:55)
 * lowercases the whole line prefix before `parseCommandLine` splits arguments out of it,
 * so `ctx.argThusFar` — and with it `lastComponent` — cannot carry uppercase. That
 * lowercasing is load-bearing for command-name and argument matching too, so it is not
 * redundant with the `toLowerCase()` below and must not be deleted as such. The call
 * below is defence-in-depth for `completeTag`'s own contract, which takes a
 * `TagCursorContext` directly: `findTagAtCursor` deliberately preserves case (see
 * tagContext.ts's file header) while `tagBases`/`tagParts` hold only lowercase entries
 * (MetaTag.addTo), so a future caller that does not pre-lowercase still gets correct
 * matches. Pinned by completionProvider.test.ts's "lowercases the typed component before
 * matching" test, which drives `completeTag` directly for exactly that reason. The C#
 * equivalent lowercases the whole tag before matching (TextDocumentService.cs:473); this
 * lowercases only the component being completed, which is equivalent for prefix-matching
 * against already-lowercase candidate sets.
 *
 * `textEdit` covers only `tag.lastComponent` — from `lastComponentStart` to the cursor —
 * not the whole tag, mirroring `completeEnumValues`'s replace-the-whole-typed-value shape
 * but scoped to the single dot-separated component being typed.
 *
 * Documentation is attached to BASE candidates only, and only when `docs.tags` holds an
 * exact entry for the candidate (e.g. the dotless tag `<player>`, whose clean name IS the
 * base). C# resolves the two branches through two DIFFERENT lookups: bases use the exact
 * `Tags.TryGetValue` (TextDocumentService.cs:507), which this ports exactly; parts use
 * `TryFindLikelyTagForPart` (:535, defined :652-658 as
 * `Tags.FirstOrDefault(t => t.Key.EndsWith("." + tagText))`), which is NOT ported yet.
 * Reusing the base lookup on parts is not a rough approximation of the part lookup, it is
 * wrong: a part can only hit `docs.tags` exactly when an unrelated *dotless base tag*
 * happens to share its name. Measured on the real corpus (2493 tags, 1871 parts): the
 * exact lookup documents 33 parts and all 33 are such collisions — completing `<queue.`
 * would show the dotless base tag `<script>`'s documentation on the part `script` (which
 * comes from `<queue.script>`/`<npc.script>`) — where C#'s real lookup documents 1826
 * parts correctly. So parts deliberately carry no documentation rather than confidently
 * wrong documentation, and none is synthesised for them. Porting
 * `TryFindLikelyTagForPart` is a 2B-5 precondition (see docs/superpowers/plans/
 * PHASE-2B-BACKLOG.md); it needs a suffix index precomputed alongside `tagParts`, since
 * a naive scan is O(tags x parts) per keystroke.
 *
 * That whole paragraph describes the FLAT branch only. When `trace` is on and the cursor
 * is past the tag's base, `completeTagNarrowed` below runs first and, if it can narrow,
 * returns real `MetaTag` objects that each carry their own documentation — which is why
 * the `componentCount === 0` documentation gate does not apply there. See that function.
 */
export function completeTag(docs: MetaDocs, tag: TagCursorContext, line: number, trace: boolean = true): CompletionItem[] {
    const prefix = tag.lastComponent.toLowerCase();
    const source = tag.componentCount === 0 ? docs.tagBases : docs.tagParts;
    const range: Range = {
        start: { line, character: tag.lastComponentStart },
        end: { line, character: tag.lastComponentStart + tag.lastComponent.length }
    };
    // TextDocumentService.cs:522-534. Only for a component past the base: component 0 is
    // a tag base, which has nothing before it to trace. A null result means "the trace
    // could not narrow", and control falls through to the flat branch below EXACTLY as
    // C# falls from the `if (lastPart.PossibleSubTypes.Any())` block into :535.
    if (trace && tag.componentCount > 0) {
        const narrowed = completeTagNarrowed(docs, tag, prefix, range);
        if (narrowed !== null) {
            return narrowed;
        }
    }
    const results: CompletionItem[] = [];
    for (const candidate of source) {
        if (candidate.startsWith(prefix)) {
            const textEdit: TextEdit = { range, newText: candidate };
            const item: CompletionItem = {
                label: candidate,
                kind: CompletionItemKind.Property,
                textEdit
            };
            // Bases only — see the doc comment above for why the exact lookup must not
            // be reused for parts (all 33 of its part hits are namespace collisions).
            if (tag.componentCount === 0) {
                const doc = docs.tags.get(candidate);
                if (doc !== undefined) {
                    item.documentation = describeTag(doc);
                }
            }
            results.push(item);
        }
    }
    return results;
}

/**
 * Entry point: what should be offered at `offset` on `line` within `text`.
 *
 * `trace` is the `denizenscript.server.tagTracing` setting, read in server.ts. It only
 * reaches `completeTag`; every other branch is unaffected by it.
 */
export function provideCompletions(docs: MetaDocs, extra: ExtraData, text: string, offset: number, line: number, trace: boolean = true): CompletionItem[] {
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
        return completeTag(docs, tagCtx, line, trace);
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
