/**
 * Context-free command completion. Ported from the command branch of
 * DenizenLangServer/Services/TextDocumentService.cs::GetCompletionsFor.
 *
 * Phase 2A scope: command names and their documented arguments only. Tag,
 * mechanism, event, and workspace-driven completions arrive in later phases.
 */

import { CompletionItem, CompletionItemKind, MarkupKind, Range, TextEdit } from 'vscode-languageserver';
import { MetaDocs, MetaCommand, MetaTag } from '../metaDocs/metaTypes';
import { describeCommand, describeScript, describeTag, descriptionClean, linkMeta, obligatoryText } from './describe';
import type { ScriptingWorkspaceData } from '../checker/containerConvert';
import { parseCursorContext, LineCursorContext } from './cursorContext';
import { findTagAtCursor, findTagParamAtCursor, TagCursorContext, TagParamContext } from './tagContext';
import { ExtraData } from '../metaDocs/extraData';
import { findEnumCompleters, findKeyLineCompleter } from './argumentCompleters';
import { parseTag } from './tagHelper';
import { traceTag } from './tagTracer';
import { completeTagParam, completeAdjustMapKeys, ParamCandidateKind } from './tagParamCompleters';

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
 * Two FURTHER null-returning cases are deliberate deviations from the C#, both applying
 * that same "informationless set means the tracer does not know" reading to a set that is
 * non-empty but says nothing: a set covering more than half the object types, and the
 * exactly-{ObjectTag} sentinel. Each is justified in full at its own gate in the body;
 * the second is enforced AFTER the candidate loop because it depends on the loop's result.
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
    const beforeLastDot = tag.beforeLastComponent;
    // Parse errors are irrelevant here — this is a half-typed tag by definition, and the
    // tracer copes with whatever parts come out. Diagnostics are a later phase.
    const parsed = parseTag(beforeLastDot, () => { /* ignore */ });
    const traced = traceTag(docs, parsed);
    // TextDocumentService.cs:531. The `return null` is the fall-through to :535.
    if (traced.possibleSubTypes.size === 0) {
        return null;
    }
    // DELIBERATE DEVIATION from TextDocumentService.cs:531-533 — do not "restore fidelity"
    // here. THE C# HAS NO SUCH GATE: it narrows whenever the set is non-empty, however
    // large. ONE rule with three cases, all resting on the same argument — an
    // INFORMATIONLESS traced set must be read as "the tracer does not know", so control
    // falls through to the flat list, never as "here are your only candidates":
    //
    //   CASE 1 (above, C#-faithful): the set is EMPTY — tracing never reached the last part.
    //   CASE 2 (immediately below):  the set covers MORE THAN HALF the known object types.
    //   CASE 3 (after the loop):     the set is EXACTLY {ObjectTag} — the tracer's
    //                                "I reached nothing" sentinel — and no candidate
    //                                matched by NAME. See the block at the gate itself.
    //
    // Cases 2 and 3 are the deviations. The rest of this comment justifies case 2; case 3
    // is justified where it is enforced, because it cannot be decided until the candidate
    // loop has run.
    //
    // WHY a near-total set carries no information. Narrowing to it filters almost nothing
    // out, yet the narrowed branch still pays its full price, and nothing absorbs that
    // price: C# has no Distinct(), so one label recurs once per type that documents it;
    // `describeTag` is built EAGERLY for every item; and `resolveProvider: false`
    // (server.ts, in buildCapabilities) forecloses resolving documentation lazily. So the
    // server serialises a megabyte of duplicate-laden markdown to say "everything is still
    // possible". Measured on live meta (72 object types, 2493 tags, 1871 parts):
    //
    //   input               narrowed                                        flat fallback
    //   <[mydef].           2240 items, 367 dupes, 1136 KB, ~5.7 ms   ->    1871, 0, 269 KB, ~1.8 ms
    //   <player.flag[x].    (identical to the above)                  ->    (identical)
    //   <player.name.       1761 items, 307 dupes,  896 KB, ~6.0 ms   ->    1871, 0, 269 KB
    //
    // `<player.name.` traces to 67 of 72 types: it excludes 5 types (7%) while costing 78%
    // of the payload and 84% of the duplicates of the all-types case. That is the shape the
    // half cut exists to catch.
    //
    // WHY HALF is not a tuned magic number. The traced-set size is BIMODAL on real data,
    // with a wide empty band in the middle. Sweeping 39,944 realistic one- and two-component
    // tag prefixes (every dotless base tag, with and without a parameter, and every part
    // reachable from one) the only non-empty sizes that occur at all are:
    //
    //     2 (85)   3 (1624)   4 (847)   5 (987)   7 (130)   ||   67 (12392)   72 (125)
    //
    // Nothing whatsoever lands between 7 and 67. Half of 72 is 36, the middle of that
    // 60-wide gap, so the cut is the midpoint of a bimodal distribution rather than a
    // threshold tuned to a corpus. Genuine narrowing (`<player.` at 5 types -> 755 items,
    // `<queue.` at 4 -> 218, `<server.` at 1 -> 147) sits an order of magnitude below it and
    // is untouched. If a future corpus puts real mass between 7 and 67, this cut stops being
    // obviously safe and should be re-derived — re-run the sweep before changing it.
    //
    // The high mode is not an accident either: it is what a tag documenting `@returns
    // ObjectTag` produces, TagTracer.cs:126-129 deliberately declining to narrow. That
    // covers flags, definitions and `proc` — the most common constructs in Denizen script —
    // so treating these sets as "the tracer does not know" makes them genuinely unnarrowed,
    // rather than merely "not narrowed to a WRONG subset".
    //
    // Expressed as a fraction of `docs.objectTypes.size`, never a literal, since the corpus
    // grows. Strict `>` so a set of exactly half still narrows. This subsumes the all-types
    // case, which reaches the same fallback through the same comparison.
    if (traced.possibleSubTypes.size * 2 > docs.objectTypes.size) {
        return null;
    }
    const lastPartText = parsed.parts.length === 0 ? '' : parsed.parts[parsed.parts.length - 1].text;
    const results: CompletionItem[] = [];
    /** Did anything qualify via the NAME clause (`beforeDot === lastPartText`)? Case 3 reads this. */
    let nameMatched = false;
    for (const candidate of docs.tags.values()) {
        const byType = candidate.baseType !== null && traced.possibleSubTypes.has(candidate.baseType);
        const byName = candidate.beforeDot === lastPartText;
        if (!byType && !byName) {
            continue;
        }
        // Same deliberate divergence from C# as MetaTag.addTo's tagParts population: a
        // dotless tag has an empty afterDotCleaned, and an empty candidate would match
        // every prefix and insert nothing. C#'s Select would emit it; this drops it.
        if (candidate.afterDotCleaned.length === 0) {
            continue;
        }
        // Recorded HERE — after the empty-label drop, before the typed-prefix filter — so
        // case 3 below asks "is this a real namespace in the corpus?" and not "does what
        // the user has typed so far happen to hit one of its tags?". Deciding it after the
        // prefix filter would make `<server.` narrow and `<server.zzz` silently revert to
        // the whole flat list: narrowing would flicker on and off between keystrokes on
        // one and the same base. Pinned by completionProvider.test.ts's "decides the
        // addon-namespace case on the corpus, not on what the user has typed so far".
        if (byName) {
            nameMatched = true;
        }
        if (!candidate.afterDotCleaned.startsWith(prefix)) {
            continue;
        }
        const textEdit: TextEdit = { range, newText: candidate.afterDotCleaned };
        results.push({
            label: candidate.afterDotCleaned,
            kind: CompletionItemKind.Property,
            textEdit,
            // Unlike the flat branch, this IS the tag being completed, so its own
            // documentation is genuinely its own — no namespace-collision risk, and so
            // no need for that branch's `componentCount === 0` gate. The same holds for
            // the detail: TextDocumentService.cs:532 passes `tag.Name` here too, and here
            // it is unconditional because the candidate IS a MetaTag rather than a string
            // that may or may not resolve to one.
            detail: candidate.name,
            documentation: describeTag(candidate)
        });
    }
    // CASE 3 of the deviation opened above. `getFullComplexSetFrom` adds ObjectTag
    // unconditionally (TagTracer.cs:248), so `getFullComplexSetFrom({})` is {ObjectTag},
    // not {} — a set of size 1 that is literally the tracer's "I reached nothing"
    // sentinel, and which neither case 1 (size 0) nor case 2 (over half of 72) can see.
    // Reaching it is not exotic: TagTracer.cs:110 computes exactly that whenever part 0
    // resolved to no documented tag, which covers
    //   - `<context.` and `<entry[x].`, routed at TagTracer.cs:44-47 into
    //     `traceTagParts(allTypes, 2)`, which returns at :147 for a one-part tag — the
    //     single most common construct in Denizen event scripts;
    //   - any unresolved base (`<nosuchbase.`), which falls through :106-109 to :110.
    // A set of {ObjectTag} narrows to ObjectTag's 15 own utility tags (advanced_matches,
    // as, exists, if_null, object_type, prefix, proc...), none of which is ever a context
    // name — so `<context.loc` matched NOTHING where the flat list had offered `location`.
    // Informationless by exactly the argument case 2 rests on, and strictly worse: 15
    // wrong items instead of many right ones.
    //
    // THE CONJUNCTION IS LOAD-BEARING, NOT BELT-AND-BRACES. Every pseudo-object base
    // reaches this same sentinel — `<server.`, `<util.`, and the third-party plugin
    // namespaces `<paper.`, `<bungee.`, `<luckperms.`, `<towny.`, `<mythicmobs.`,
    // `<essentials.`, `<factions.`, `<griefprevention.`, `<quests.`, `<viaversion.`,
    // `<playerpoints.`, `<crackshot.`, `<skyblock.`, `<tern.`, `<schematic.`, `<yaml.`,
    // 84 tag bases in all on live meta. They have no object type behind them, so the ONLY
    // thing that distinguishes them from `<context.` is that some documented tag's
    // `beforeDot` is literally their name. Measured on live meta (2493 tags, 72 types):
    //
    //   input          traced set     name matches   result
    //   <context.      {ObjectTag}    0              flat 1871  (was 15)
    //   <entry[x].     {ObjectTag}    0              flat 1871  (was 15)
    //   <nosuchbase.   {ObjectTag}    0              flat 1871  (was 15)
    //   <server.       {ObjectTag}    132            narrowed 147 (unchanged)
    //   <util.         {ObjectTag}    61             narrowed  76 (unchanged)
    //   <luckperms.    {ObjectTag}    3              narrowed  18 (unchanged)
    //   <paper.        {ObjectTag}    1              narrowed  16 (unchanged)
    //
    // Dropping `!nameMatched` deletes tag completion for all 84 at a stroke. Pinned by
    // completionProvider.test.ts's "keeps narrowing an addon-namespace base".
    //
    // WHY THIS GATE IS AFTER THE LOOP while the other two are before it: the name-match
    // count is not knowable until the candidates have been walked, and walking them twice
    // to keep the three gates adjacent would double the per-keystroke cost of the hot
    // path. `results` is simply discarded on the fallback.
    //
    // The explicit null/undefined check is not dead code: `docs.objectTagType` is null for
    // meta that documents no ObjectTag at all (see tagTracer.ts deviation 3, which keeps
    // the null out of the set). Without it this would be `has(null)`, always false — the
    // same outcome, but by accident rather than by statement.
    if (!nameMatched && traced.possibleSubTypes.size === 1
        && docs.objectTagType !== null && docs.objectTagType !== undefined
        && traced.possibleSubTypes.has(docs.objectTagType)) {
        return null;
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
                    // TextDocumentService.cs:508 passes `tagDoc.Name` as the item's DETAIL and
                    // `DescribeTag(tagDoc)` as its documentation. The detail is the tag's full
                    // signature -- `<PlayerTag.name>` beside the label `name` -- which is what
                    // tells the two `name` parts on different object types apart in the list.
                    // Set together with the documentation, and only here, because C# falls back
                    // to a two-argument constructor with NEITHER when the lookup misses (:509).
                    item.detail = doc.name;
                    item.documentation = describeTag(doc);
                }
            }
            results.push(item);
        }
    }
    return results;
}

/**
 * `ParamCandidateKind` -> the real LSP kind. `tagParamCompleters.ts` cannot name
 * `CompletionItemKind` itself without importing `vscode-languageserver`, which it must
 * not (its compiled output has zero `require()` calls, and that is checked), so the
 * mapping lives here. Three construction sites collapse onto the two kinds C# actually
 * uses: `CompleteEnum` builds Enum items (CommandTabCompletions.cs:206) while
 * `SuggestMechanisms` (:211) and `CompleteForTagPiece` (:134) both build Property items.
 * The sites stay distinct on the way here anyway, because they do NOT agree on
 * documentation — see `tagPieceDocumentation`.
 */
const PARAM_CANDIDATE_KINDS: Record<ParamCandidateKind, CompletionItemKind> = {
    enum: CompletionItemKind.Enum,
    mechanism: CompletionItemKind.Property,
    tagPiece: CompletionItemKind.Property,
    // `SuggestScriptByType` builds Method items (CommandTabCompletions.cs:278), which is what
    // gives a script container a visibly different icon from an enum value in the list.
    script: CompletionItemKind.Method
};

/**
 * The documented parameter spec for the bracket the cursor is inside, plus the tag it
 * belongs to — or null when nothing documents that bracket.
 *
 * Two branches, exactly as C# has two:
 *
 *   BASE FORM (`<material[...`, no top-level dot before the bracket) —
 *   TextDocumentService.cs:516-520. The base name is looked up EXACTLY in `docs.tags`
 *   and the parameter read off `parsedFormat.parts[0]`.
 *
 *   PART FORM (`<player.gamemode_at[...`, at least one dot) —
 *   TextDocumentService.cs:546-553. An exact `docs.tags` lookup is NOT usable here and
 *   is not a shortcut worth trying: `docs.tags` is keyed by the tag's CLEAN name, which
 *   starts with the owning object type (`playertag.gamemode_at`), whereas the text on
 *   the line starts with whatever base the user wrote (`player.gamemode_at`). The two
 *   coincide only by accident. C# therefore re-parses the tag with an empty parameter
 *   appended, traces it, and takes the last part's matched tags — which is what the
 *   tracer's `possibleTags` map exists to provide. `parseTag` lowercases, and every
 *   caller path has already lowercased the line (lineContext.ts:55), so appending `[]`
 *   to `tagName` reproduces C#'s `fullTag.BeforeLast('[').Trim() + "[]"`.
 *
 * `ctx.partIndex` selects the branch and is NOT used to index `parsedFormat.parts`:
 * that index counts parts of the tag the USER typed, while `parsedFormat` describes a
 * possibly different documented tag (`<PlayerTag.gamemode_at[...]>` has its own part 0,
 * `playertag`, which the user never wrote). The indices actually read — `parts[0]` for
 * the base form and the last part for the part form, both mirroring the C# — are
 * bounds-checked anyway: a malformed `@attribute` can leave `parsedFormat` with fewer
 * parts than expected (metaLinker.ts:101-107 guards the same way), and an uncaught
 * throw here would kill the whole completion request rather than one candidate list.
 */
function findDocumentedTagParam(docs: MetaDocs, ctx: TagParamContext): { tag: MetaTag; docParam: string } | null {
    let tag: MetaTag | undefined;
    let partIndex: number;
    if (ctx.partIndex === 0) {
        // TextDocumentService.cs:516-517.
        tag = docs.tags.get(ctx.tagName);
        partIndex = 0;
    }
    else {
        // TextDocumentService.cs:546-550.
        const parsed = parseTag(`${ctx.tagName}[]`, () => { /* ignore: half-typed by definition */ });
        const traced = traceTag(docs, parsed);
        const matched = traced.possibleTags.get(parsed.parts.length - 1);
        // `FirstOrDefault(t => t.AllowsParam)` (:550). `possibleTags` accumulates every
        // documented tag that matched the part, including ones that take no parameter.
        tag = matched === undefined ? undefined : matched.find(candidate => candidate.allowsParam);
        partIndex = -1;
    }
    // :517's `&& actualBase.AllowsParam`; the part form has already filtered on it.
    if (tag === undefined || !tag.allowsParam || tag.parsedFormat === null) {
        return null;
    }
    const parts = tag.parsedFormat.parts;
    // -1 means "the last part", C#'s `Parts[^1]` (:551, :553).
    const part = parts[partIndex === -1 ? parts.length - 1 : partIndex];
    // :551's `Parameter is not null`, plus the bounds check the C# does without.
    if (part === undefined || part.parameter === null) {
        return null;
    }
    return { tag, docParam: part.parameter };
}

/**
 * How much of `typed` the candidate `label` is extending, as a character count taken
 * back from the cursor.
 *
 * `completeTagParam` filters every candidate with `X.startsWith(segment)` where
 * `segment` is a SUFFIX of the typed text, but which suffix depends on the branch that
 * fired, and only that module knows: the whole of it for an enum or option spec, the
 * text after the last `;` for a mechanism set or a `;`-pair key, the text after that
 * segment's `=` when the value spec is recursed into. Replacing all of `typed`
 * regardless would delete work the user has already done — accepting `max_health=` for
 * `<item.with[display_name=hi;ma` would leave `<item.with[max_health=`, silently
 * dropping `display_name=hi`.
 *
 * So the segment is recovered instead of assumed: it is the longest suffix of `typed`
 * that `label` starts with. That is exact rather than heuristic for the sources that
 * can contain a separator ambiguity — mechanism names and enum values contain neither
 * `;` nor `=`, so no suffix reaching across one of those boundaries can be a prefix of
 * such a label, and the longest match is therefore the branch's own segment. For every
 * spec that consumes the whole typed text (which is all of them without a `;` or `=`)
 * this returns `typed.length`, i.e. exactly paramStart-to-cursor.
 */
function matchedSuffixLength(typed: string, label: string): number {
    for (let length = typed.length; length > 0; length--) {
        if (label.startsWith(typed.substring(typed.length - length))) {
            return length;
        }
    }
    return 0;
}

/**
 * `CompleteForTagPiece`'s documentation envelope (CommandTabCompletions.cs:131-135).
 *
 * C# :133 is one interpolated string:
 *
 *     $"### Tag {DescriptionClean(tag.Name.BeforeLast('[') + "[...]>")}\n{LinkMeta(tag)}
 *       \n\n**Input option**: {inputData}\n\n{ObligatoryText(tag)}"
 *
 * and it is assembled here from `describe.ts`'s existing helpers rather than re-spelled:
 * `descriptionClean`, `linkMeta` and `obligatoryText` are the direct ports of the three
 * C# functions this line calls, already used by `describeTag` for the same tag object.
 * The result is deliberately shaped like `describeTag`'s output — same `### Tag` heading,
 * same meta link, same obligatory tail — with the `Returns:`/description body swapped for
 * the "input option" line, exactly as C# does.
 *
 * The heading shows the tag's own name with its parameter elided: `BeforeLast('[')`
 * cuts at the LAST '[', so `<ViveCraftPlayerTag.position[head/left/right]>` becomes
 * `<ViveCraftPlayerTag.position[...]>`. FreneticExtensions' `BeforeLast` returns the
 * whole string when the character is absent, which the `lastIndexOf` guard below
 * reproduces — unreachable on this path (a tag reaching it always has a documented
 * parameter, hence a '[') but the C# is total here and so is this.
 *
 * Only `tagPiece` candidates get this. `CompleteEnum` (:206) and `SuggestMechanisms`
 * (:211) build their own documentation from their own sites and never see the envelope;
 * wrapping them would invent a C# construction that does not exist.
 */
function tagPieceDocumentation(tag: MetaTag, inputData: string): string {
    const bracket = tag.name.lastIndexOf('[');
    const elided = (bracket === -1 ? tag.name : tag.name.substring(0, bracket)) + '[...]>';
    return `### Tag ${descriptionClean(elided)}\n${linkMeta(tag)}\n\n`
        + `**Input option**: ${inputData}\n\n${obligatoryText(tag)}`;
}

/**
 * Completions for the text inside a tag's `[...]`, as located by `findTagParamAtCursor`.
 * Ports the two `CompleteGenericTagParam` call sites (TextDocumentService.cs:519 and
 * :553) and the item construction their results feed (CommandTabCompletions.cs:134,
 * :206, :211).
 *
 * Returns null — not an empty array — when nothing documents this bracket, so the
 * caller can fall through to the tag branch. An empty array means "this bracket IS
 * documented and the answer is genuinely nothing", which is what `<player.flag[` gives:
 * its documented `<name>` matches no registered completer.
 *
 * THE FLAG SPECIAL CASE IS DELIBERATELY NOT PORTED. C# intercepts `flag`, `has_flag`,
 * `flag_expiration` and `flag_map` here (TextDocumentService.cs:542-545) and answers
 * from `CompleteFlag`. In this extension the CLIENT owns flag completion: it indexes
 * the workspace itself (`getFlagCompletionKind`, src/extension.ts:897) and the shared
 * middleware returns [] for exactly those contexts without ever asking the server
 * (src/extension.ts:59-64). Porting it would be unreachable code that additionally
 * needs Phase 2D's WorkspaceTracker. Pinned by completionProvider.test.ts's
 * "yields nothing for <player.flag[".
 *
 * DOCUMENTATION IS PER CONSTRUCTION SITE, because C# picks it per construction site.
 * `tagPiece` candidates (`CompleteForTagPiece`, :131-135) are wrapped in the tag
 * envelope — see `tagPieceDocumentation`; the tag it needs is `documented.tag`, the same
 * object C# passes. `enum` candidates keep the bare `**{key}**: {value}` that
 * `CompleteEnum` (:206) emits, unwrapped, because that IS the whole of C#'s markup there.
 * `mechanism` candidates keep their `detail` for the reason below.
 *
 * MECHANISM DOCUMENTATION COMES FROM THE CANDIDATE, NEVER FROM RE-RENDERING.
 * `describe.ts` exports `describeMech`, and C#'s `SuggestMechanisms` does call
 * `DescribeMech` (:211), but a candidate cannot be looked back up here:
 * `docs.mechanisms` is keyed by object AND name (`itemtag.max_health`, MetaTypes' `MetaMechanism.addTo`), there is no
 * by-name index, and `suggestMechanisms` deliberately emits one candidate per object
 * type that documents a shared name. A name-only scan would attach one object type's
 * description to another's item — confidently wrong documentation, which this file
 * already refuses to synthesise once (see `completeTag`'s note on part documentation).
 * The candidate's own `detail` already names the right object type, so it is the single
 * source used. An empty `detail` means "suppress documentation entirely", mirroring
 * `CompleteEnum`'s `key == null ? null : ...` (:206); no `ByTag` registration reaches
 * it today, but `completeEnum` can produce it.
 */
function completeTagParameter(docs: MetaDocs, extra: ExtraData, ctx: TagParamContext, line: number, workspace: ScriptingWorkspaceData | null, commandName: string = ''): CompletionItem[] | null {
    const documented = findDocumentedTagParam(docs, ctx);
    if (documented === null) {
        return null;
    }
    // NO C# COUNTERPART -- FEATURE-IDEAS.md idea 3, user ruling 2026-09-01. Inside a `<map[...]>`
    // written as an argument to `adjust`, the map's keys are mechanism names; everywhere else a
    // map's keys are arbitrary and this must not fire. See `completeAdjustMapKeys` for why the
    // list is derived from the meta rather than hand-curated, which is what the feature note
    // assumed would be necessary.
    const candidates = documented.tag.cleanName === 'map' && commandName === 'adjust'
        ? completeAdjustMapKeys(docs, ctx.paramSoFar)
        : completeTagParam(docs, extra, documented.docParam, ctx.paramSoFar, documented.tag, workspace);
    const cursor = ctx.paramStart + ctx.paramSoFar.length;
    const results: CompletionItem[] = [];
    for (const candidate of candidates) {
        const replaced = matchedSuffixLength(ctx.paramSoFar, candidate.label);
        const range: Range = {
            start: { line, character: cursor - replaced },
            end: { line, character: cursor }
        };
        const textEdit: TextEdit = { range, newText: candidate.label };
        const item: CompletionItem = {
            label: candidate.label,
            kind: PARAM_CANDIDATE_KINDS[candidate.kind],
            textEdit
        };
        // A script candidate is documented from the container itself, not from its detail text --
        // CommandTabCompletions.cs:278 passes `DescribeScript(s)`, which is a whole markdown block
        // (type, name, description keys, definitions, and where the file is), where `detail` is
        // just the name again.
        if (candidate.kind === 'script' && candidate.script !== undefined) {
            item.detail = candidate.script.name;
            item.documentation = describeScript(candidate.script);
        }
        else if (candidate.detail.length > 0) {
            item.documentation = {
                kind: MarkupKind.Markdown,
                value: candidate.kind === 'tagPiece'
                    ? tagPieceDocumentation(documented.tag, candidate.detail)
                    : candidate.detail
            };
        }
        results.push(item);
    }
    return results;
}

/**
 * Entry point: what should be offered at `offset` on `line` within `text`.
 *
 * `trace` is the `denizenscript.server.tagTracing` setting, read in server.ts. It is
 * forwarded to `completeTag` and to nothing else: it governs whether tag-PART completion
 * narrows its candidate list by the traced return type, and that is the only place the
 * user's answer is honoured.
 *
 * It is NOT a global "may the tracer run" switch, and the parameter branch shows why:
 * `findDocumentedTagParam` calls `traceTag` unconditionally (see its PART FORM note),
 * because there tracing is how the documented tag is RESOLVED at all — turning it off
 * would not widen the results, it would delete them. Same for `completeKeyLineValues`
 * and the command branches, which never resolve a tag in the first place. So the setting
 * changes exactly one behaviour, while the tracer itself may still run regardless.
 */
/**
 * Index within `trimmed` where the argument under the cursor begins — the character after the
 * last space that was NOT inside a tag. Ported from TextDocumentService.cs:441-449.
 *
 * A command line gets this from `splitTopLevelArguments` via `parseCommandLine`; a key line has
 * no such structure, so the C#'s inline scan is what applies. It counts `<` and `>` and ignores
 * any space seen while that depth is non-zero, which is what keeps `<list[a b c]>` in one piece.
 *
 * EQUIVALENT MUTANT: changing `i + 1` to `i` is undetectable. It only ever prepends the matched
 * space to `argThusFar` while decrementing `argStart` by one, and every position downstream is
 * computed as `argStart + (index within argThusFar)`, so the two cancel exactly. Measured, not
 * merely argued: 34,304 cursor positions across all 1,172 corpus lines plus twelve hand-built
 * edge cases (nested tags, quotes, spaces inside brackets, empty and whitespace-only lines)
 * produced an identical tag and tag-parameter context under both versions, zero differences.
 */
function lastTopLevelArgStart(trimmed: string): number {
    let argStart = 0;
    let depth = 0;
    for (let i = 0; i < trimmed.length; i++) {
        const ch = trimmed[i];
        if (ch === '<') {
            depth++;
        }
        else if (ch === '>') {
            depth--;
        }
        else if (ch === ' ' && depth === 0) {
            argStart = i + 1;
        }
    }
    return argStart;
}

/**
 * Tag-parameter and tag-part completion for an argument, shared by the command-line and key-line
 * paths. Returns `null` when the cursor is not inside an open tag, so each caller can decide what
 * to do next — the command path falls through to argument names and enums, the key line has
 * nothing further to offer.
 *
 * Extracted 2026-08-27 while fixing the key-line path; the C# never had two copies of this to
 * begin with (TextDocumentService.cs:421 serves both kinds of line from one block), and having
 * two here is exactly how the key line came to lose tag completion.
 */
function completeTagAt(docs: MetaDocs, extra: ExtraData, argThusFar: string, argStart: number, line: number, trace: boolean, workspace: ScriptingWorkspaceData | null, commandName: string = ''): CompletionItem[] | null {
    const paramCtx = findTagParamAtCursor(argThusFar, argStart);
    if (paramCtx !== null) {
        const paramResults = completeTagParameter(docs, extra, paramCtx, line, workspace, commandName);
        // Null means nothing documents this bracket (unknown tag, or one that takes no
        // parameter). Fall through rather than returning []: the tag-part branch is then
        // free to answer, and does — with [], for the reason above — so this deliberately
        // keeps the pre-existing behaviour byte-for-byte for every unserved input.
        if (paramResults !== null) {
            return paramResults;
        }
    }
    const tagCtx = findTagAtCursor(argThusFar, argStart);
    if (tagCtx !== null) {
        return completeTag(docs, tagCtx, line, trace);
    }
    return null;
}

export function provideCompletions(docs: MetaDocs, extra: ExtraData, text: string, offset: number, line: number, trace: boolean = true, workspace: ScriptingWorkspaceData | null = null): CompletionItem[] {
    const ctx = parseCursorContext(text, offset);
    if (ctx === null) {
        return [];
    }
    if (ctx.kind === 'line') {
        const enumResults = completeKeyLineValues(extra, ctx, line);
        if (enumResults.length > 0) {
            return enumResults;
        }
        // PORT BUG FIXED 2026-08-27, reported by the user as "no completions inside an expanded
        // map tag" and true of every key line in every script.
        //
        // TextDocumentService.cs:408-420 returns from the enum branch ONLY when that branch
        // produced results; otherwise it falls through to :421, whose condition is
        // `trimmed.StartsWithFast('-') || trimmed.Contains(':')` -- one shared tag branch that
        // serves command lines and key lines alike. This port had split the two paths and made
        // the key-line path return unconditionally, so `display name: <&b`, `format: <[text]`
        // and every other tag written on a key line silently offered nothing.
        //
        // DELIBERATE DEVIATION #10 FROM TextDocumentService.cs:421 -- USER RULING, 2026-08-27.
        //
        // The C# guards this branch with `StartsWithFast('-') || Contains(':')`, so a line with
        // neither offers nothing at all. That rule exists to avoid completing in prose, but it
        // uses the shape of the LINE to answer a question about the CURSOR, and it gets that
        // question wrong wherever a tag is written outside those two shapes: a continuation line
        // of a multi-line tag, and the expanded map-tag buffer, whose lines read `key = value`.
        // The user reported the second case directly.
        //
        // The guard is dropped rather than widened, because `completeTagAt` already answers the
        // right question: it returns null unless the cursor sits inside an unclosed `<`, which is
        // exactly the condition the C# was reaching for. A line with no open tag still yields
        // nothing, so the ONLY inputs whose behaviour changes are those already inside a tag.
        const argStart = lastTopLevelArgStart(ctx.trimmed);
        // `null` means "no open tag at the cursor" -- on a key line there is nothing else left
        // to offer, so it becomes the empty list rather than falling through to the
        // command-argument branch, which has no command to work from.
        return completeTagAt(docs, extra, ctx.trimmed.substring(argStart), ctx.indent + argStart, line, trace, workspace) ?? [];
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
    //
    // ("the branch below" above means the argument-name/enum branch at the end of this
    // function — the one both tag branches jump over. The separate note below is about
    // the tag-PART branch immediately following, which is a different "below".)

    // SECOND ORDERING QUESTION, unrelated to the first: the parameter branch runs BEFORE
    // findTagAtCursor, and that ordering is load-bearing. A cursor inside a
    // tag's `[...]` is also inside the tag, so `findTagAtCursor` matches it too and —
    // returning unconditionally below — would claim it first. What it would offer is
    // nothing: it filters candidates by `lastComponent`, which in this situation always
    // still carries the '[' (a top-level bracket can only remain open at the cursor if
    // it opened after the last counted top-level dot, since tagContext's scan stops
    // counting dots while a bracket is open), and no entry in `tagBases`/`tagParts`
    // contains a '[' because `cleanTag` strips bracketed parameters before either set is
    // built. So for every input the parameter branch serves, the tag-part branch returned
    // [] — the ordering takes nothing away, it fills a hole. Verified across 65,241 real
    // inputs in this phase's final review, not just argued. Pinned by completionProvider.test.ts's
    // "is unreachable behind findTagAtCursor".
    //
    // C# resolves the same conflict the same way round: :504 asks whether the base
    // contains a '[' before offering bases, and :529 asks whether the component contains
    // a '[' before offering parts. The bracket question is decided first on both paths.
    // `ctx.name` is the command this line runs, and it is passed only from here: the key-line
    // branch above has no command, and a `<map[...]>` on a key line is data rather than an adjust
    // argument, so it must keep offering nothing.
    const sharedTagResults = completeTagAt(docs, extra, ctx.argThusFar, ctx.argStart, line, trace, workspace, ctx.name);
    if (sharedTagResults !== null) {
        return sharedTagResults;
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
