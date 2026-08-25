/**
 * Traces a parsed tag over the object-type graph, working out which documented
 * tags each part could be and which object types are valid after it.
 *
 * Structural port of the whole of:
 *   DenizenVSCode/DenizenLangServer/SharpDenizenTools/SharpDenizenTools/MetaHandlers/TagTracer.cs
 * `trace`, `parsePossibleTypes`, `traceTagParts`, `getFullComplexSetFrom` and
 * `traceTagPartSingle` correspond one-to-one with the C# methods of the same names;
 * every branch below cites its C# line range.
 *
 * DIAGNOSTICS. `TagTracer` in C# carries an `Error` action (TagTracer.cs:23) and a
 * `DeprecationError` action (TagTracer.cs:26), both defaulting to ignoring their
 * message, and raises them at thirteen sites. The original port of this file dropped
 * them: it served completion only, where the messages are noise, and it kept the
 * CONTROL FLOW identical — wherever C# calls `Error(...)` and then `return`s, it still
 * returned at exactly that point, because the early return is behaviour even though
 * the string is not.
 *
 * Phase 2C-4 needs them back: `CheckSingleTag` (ScriptChecker.cs:499-500) turns them
 * into the `tag_trace_failure` and `deprecated_tag_part` diagnostics. They are now
 * OPTIONAL CALLBACKS, defaulting to no-ops, so every existing caller is unaffected —
 * a second tracer implementation would have drifted from this one. The deprecation
 * sweep at TagTracer.cs:111-119, which the first port dropped entirely on the grounds
 * that it cannot affect control flow or any traced value, is restored with it.
 *
 * RESTORING THEM MUST NOT MOVE A TRACED VALUE. The completion provider consumes this
 * tracer and Phase 2B-5/2B-6's live verification pins its output; the callbacks are
 * therefore pure additions at points that already existed, never new branches.
 *
 * DEVIATION 1 — no mutation of the input tag. C# writes its results back onto
 * `SingleTag.Part.PossibleTags` / `.PossibleSubTypes` in place. This port must not:
 * `parseTag`'s output is also stored as `MetaTag.parsedFormat` on cached meta objects
 * (see metaLinker.ts step 5), so a trace that mutated parts would corrupt the loaded
 * meta docs for every later consumer. `SingleTag` stays a pure parse product and the
 * results come back in a `TraceResult` instead.
 *
 * DEVIATION 2 — `LegacySpecialTags` (TagTracer.cs:29-30) is an obsolete-tag
 * diagnostic path. The branch was originally ported so the control flow matched (it
 * returns early, before the `Docs.Tags` lookups) but with no message; the message is
 * now raised through the `error` callback. See `trace`.
 *
 * DEVIATION 3 — two null-safety guards that C# does not have, both flagged at their
 * sites: `getFullComplexSetFrom` will not put a null `objectTagType` into a type set,
 * and its base-type walk terminates on a cyclic `@base` chain instead of hanging.
 * A fourth, in `traceTagParts`, covers a null return from `parsePossibleTypes` inside
 * the type-set union, where C#'s `SelectMany` would throw.
 */

import { MetaDocs, MetaObjectType, MetaTag } from '../metaDocs/metaTypes';
import { SingleTag, TagPart } from './tagHelper';

/** The result of tracing a tag. Replaces the C# in-place mutation of `SingleTag.Part`; see deviation 1 above. */
export interface TraceResult {
    /**
     * The object types that are valid *after* the tag's last part — i.e. the set a
     * following tag part would be looked up against. Mirrors what the C# consumer
     * reads as `tag.Parts[^1].PossibleSubTypes` (TextDocumentService.cs:527, 531).
     * Empty when tracing never reached the last part.
     */
    possibleSubTypes: Set<MetaObjectType>;
    /**
     * Part index -> the documented tags matched at that index, in match order.
     * Mirrors `SingleTag.Part.PossibleTags` (TagHelper.cs:111), which is a List and
     * so may hold the same tag more than once; an index with no matches is absent
     * rather than mapped to an empty array.
     */
    possibleTags: Map<number, MetaTag[]>;
}

/** Special tags that used to exist and get special handling (TagTracer.cs:29-30). */
const LEGACY_SPECIAL_TAGS: ReadonlySet<string> = new Set(['permission', 'text', 'name', 'amount']);

/** A subtag match: the tag, and how many tag parts it consumes. C#'s `(MetaTag, int)` tuple (TagTracer.cs:253). */
type TagMatch = [MetaTag, number];

/**
 * Diagnostics raised while tracing. Both default to no-ops, exactly as the C# actions do
 * (TagTracer.cs:23, :26), so a caller that only wants the traced types passes nothing.
 */
export interface TraceCallbacks {
    /** `TagTracer.Error` (TagTracer.cs:23). Raised at twelve sites. */
    error?: (message: string) => void;
    /** `TagTracer.DeprecationError` (TagTracer.cs:26). Raised only by the sweep at :111-119. */
    deprecation?: (message: string, part: TagPart) => void;
}

/** Port of the `TagTracer` class (TagTracer.cs:14-287). Internal: `traceTag` is the public entry point. */
class TagTracer {
    /** The relevant docs object (TagTracer.cs:17). */
    readonly docs: MetaDocs;
    /** The relevant tag (TagTracer.cs:20). */
    readonly tag: SingleTag;
    /** `TagTracer.Error` (TagTracer.cs:23), defaulting to ignore. */
    readonly error: (message: string) => void;
    /** `TagTracer.DeprecationError` (TagTracer.cs:26), defaulting to ignore. */
    readonly deprecation: (message: string, part: TagPart) => void;
    /** Stands in for `SingleTag.Part.PossibleTags` (TagHelper.cs:111); see deviation 1. */
    readonly possibleTags: Map<number, MetaTag[]> = new Map();
    /** Stands in for `SingleTag.Part.PossibleSubTypes` (TagHelper.cs:114); see deviation 1. */
    readonly possibleSubTypes: Map<number, Set<MetaObjectType>> = new Map();

    constructor(docs: MetaDocs, tag: SingleTag, callbacks?: TraceCallbacks) {
        this.docs = docs;
        this.tag = tag;
        this.error = callbacks?.error ?? (() => { /* TagTracer.cs:23 -- "Default Ignore" */ });
        this.deprecation = callbacks?.deprecation ?? (() => { /* TagTracer.cs:26 -- "Default Ignore" */ });
    }

    /** `Tag.Parts[index].PossibleTags.Add(tag)`. Appends, never dedupes — C#'s field is a List. */
    private addPossibleTag(index: number, tag: MetaTag): void {
        const existing = this.possibleTags.get(index);
        if (existing) {
            existing.push(tag);
        }
        else {
            this.possibleTags.set(index, [tag]);
        }
    }

    /** Traces through a written tag, trying to find the documented tag parts inside it (TagTracer.cs:33-120). */
    trace(): void {
        const parts = this.tag.parts;
        // TagTracer.cs:35-38.
        if (parts.length === 0) {
            return;
        }
        // TagTracer.cs:39-43 — an empty root is how `<[mydef]>` is written, and means `definition`.
        let root = parts[0].text;
        if (root === '') {
            root = 'definition';
        }
        let superComplexBaseTag: MetaTag | undefined;
        let veryComplexBaseTag: MetaTag | undefined;
        let complexBaseTag: MetaTag | undefined;
        let realBaseTag: MetaTag | undefined;
        let documentedObjectBase: MetaObjectType | undefined;
        // TagTracer.cs:44-47.
        if (root === 'context' || root === 'entry') {
            this.traceTagParts(new Set(this.docs.objectTypes.values()), 2);
        }
        // TagTracer.cs:48-52. Checked before the Docs.Tags lookups below, exactly as in C#.
        else if (LEGACY_SPECIAL_TAGS.has(root)) {
            this.error(`Tag base '${root}' is deprecated: write it as a definition, like '<[${root}]>'.`);
            return;
        }
        // TagTracer.cs:53-60.
        else if (parts.length >= 4 && (superComplexBaseTag = this.docs.tags.get(`${root}.${parts[1].text}.${parts[2].text}.${parts[3].text}`))) {
            for (let i = 0; i < 4; i++) {
                this.addPossibleTag(i, superComplexBaseTag);
            }
            this.traceTagParts(this.parsePossibleTypes(superComplexBaseTag.returns, superComplexBaseTag.returnType), 4);
        }
        // TagTracer.cs:61-68.
        else if (parts.length >= 3 && (veryComplexBaseTag = this.docs.tags.get(`${root}.${parts[1].text}.${parts[2].text}`))) {
            for (let i = 0; i < 3; i++) {
                this.addPossibleTag(i, veryComplexBaseTag);
            }
            this.traceTagParts(this.parsePossibleTypes(veryComplexBaseTag.returns, veryComplexBaseTag.returnType), 3);
        }
        // TagTracer.cs:69-76.
        else if (parts.length >= 2 && (complexBaseTag = this.docs.tags.get(`${root}.${parts[1].text}`))) {
            for (let i = 0; i < 2; i++) {
                this.addPossibleTag(i, complexBaseTag);
            }
            this.traceTagParts(this.parsePossibleTypes(complexBaseTag.returns, complexBaseTag.returnType), 2);
        }
        // TagTracer.cs:77-97.
        else if ((realBaseTag = this.docs.tags.get(root))) {
            this.addPossibleTag(0, realBaseTag);
            if (parts[0].parameter === null) {
                // TagTracer.cs:82-86 — Error, then return.
                if (realBaseTag.requiresParam) {
                    this.error(`Tag base '${root}' requires an input [tag parameter] value.`);
                    return;
                }
            }
            else {
                // TagTracer.cs:90-94 — Error, then return.
                if (!realBaseTag.allowsParam) {
                    this.error(`Tag base '${root}' cannot have a [tag parameter].`);
                    return;
                }
            }
            this.traceTagParts(this.parsePossibleTypes(realBaseTag.returns, realBaseTag.returnType), 1);
        }
        // TagTracer.cs:98-105. The `Prefix == "none"` check at :100-103 is Error-only with NO
        // return, so the trace continues from the documented type either way -- the diagnostic
        // is the whole of its effect.
        else if ((documentedObjectBase = this.docs.objectTypes.get(root))) {
            if (documentedObjectBase.prefix.toLowerCase() === 'none') {
                this.error(`Tag base '${parts[0].text}' seems to refer to a pseudo-object-type, but not one that can be used as a free-standing tag base.`);
            }
            this.traceTagParts(new Set([documentedObjectBase]), 1);
        }
        // TagTracer.cs:106-109 — Error only, no return: execution falls through to :110.
        // NOTE the message uses `parts[0].text`, NOT `root`, so an empty base (written `<[x]>`)
        // reports as '' rather than as 'definition'. Ported verbatim.
        else {
            this.error(`Tag base '${parts[0].text}' does not exist.`);
        }
        // TagTracer.cs:110. Runs after TraceTagParts, so for a multi-part tag it overwrites
        // whatever the loop stored for part 0. Note this uses the base tags' return types
        // *without* ParsePossibleTypes' ExtendedBy expansion, and that an unresolved root
        // leaves it as GetFullComplexSetFrom({}) — which is not empty, see that method.
        const rootReturnTypes = new Set<MetaObjectType>();
        for (const rootTag of this.possibleTags.get(0) ?? []) {
            if (rootTag.returnType !== null && rootTag.returnType !== undefined) {
                rootReturnTypes.add(rootTag.returnType);
            }
        }
        this.possibleSubTypes.set(0, this.getFullComplexSetFrom(rootReturnTypes));
        // TagTracer.cs:111-119: the deprecation sweep. Restored in Phase 2C-4; the first port of
        // this file dropped it because it cannot affect control flow or any traced value.
        //
        // NOTE the condition at :114 -- it fires only when EVERY possible tag for the part is
        // deprecated, not when any is. A part that could be one of several documented tags, only
        // some of them deprecated, is not reported: the author may well mean a live one.
        // An empty possibleTags list yields an empty `deprecated` list, so `.any()` is false and
        // nothing fires -- which is why an unresolved part is silent here rather than reported.
        for (let i = 0; i < parts.length; i++) {
            const partTags = this.possibleTags.get(i) ?? [];
            const deprecated = partTags.filter(t => t.deprecated !== null && t.deprecated !== undefined);
            if (deprecated.length > 0 && deprecated.length === partTags.length) {
                const tag = deprecated[0];
                this.deprecation(`Deprecated tag \`${tag.cleanedName}\`: ${tag.deprecated}`, parts[i]);
            }
        }
    }

    /**
     * Converts tag return data to something usable for the trace (TagTracer.cs:123-142).
     * Returns null — not an empty set — for an unrecognised return type, and callers
     * depend on the difference: `traceTagParts` stops on null but would keep walking
     * on an empty set (TagTracer.cs:147).
     */
    parsePossibleTypes(returnType: string, known: MetaObjectType | null): Set<MetaObjectType> | null {
        returnType = returnType.toLowerCase();
        // TagTracer.cs:126-129. A tag documented as returning ObjectTag declines to narrow,
        // so every object type stays possible. This is how flags and definitions behave;
        // it is not an error case and must not be optimised away.
        if (returnType === 'objecttag') {
            return new Set(this.docs.objectTypes.values());
        }
        // TagTracer.cs:130-133.
        if (known === null || known === undefined) {
            known = this.docs.objectTypes.get(returnType) ?? null;
        }
        // TagTracer.cs:134-139.
        if (known !== null) {
            const result = new Set<MetaObjectType>([known]);
            for (const extended of known.extendedBy) {
                result.add(extended);
            }
            return result;
        }
        // TagTracer.cs:140-141 — Error, then return null.
        this.error(`(Internal) Unknown object return type '${returnType}'`);
        return null;
    }

    /** Traces the parts of the tag, after the base has been traced (TagTracer.cs:145-217). */
    traceTagParts(possibleRoots: Set<MetaObjectType> | null, index: number): void {
        const parts = this.tag.parts;
        // TagTracer.cs:147-150. The null check is why parsePossibleTypes must not collapse
        // "unknown return type" into an empty set.
        if (parts.length <= index || possibleRoots === null) {
            return;
        }
        // TagTracer.cs:151.
        while (index < parts.length) {
            // TagTracer.cs:153-157.
            const matched = this.traceTagPartSingle(possibleRoots, index);
            if (matched === null) {
                return;
            }
            let result: TagMatch[] = matched;
            // TagTracer.cs:158. Computed here, before the branches below, because all three
            // messages use it.
            const part = parts[index].text.toLowerCase();
            // TagTracer.cs:159-174 — Error, then return. THREE message forms, chosen by how many
            // object types were still in play: one names the type, up to four name them all, and
            // five or more give up on naming them.
            if (result.length === 0) {
                const names = Array.from(possibleRoots).map(r => r.name);
                if (possibleRoots.size === 1) {
                    this.error(`Tag part '${part}' does not exist for object type ${names[0]}`);
                }
                else if (possibleRoots.size < 5) {
                    this.error(`Tag part '${part}' does not exist for object types ${names.join(', ')}`);
                }
                else {
                    this.error(`Tag part '${part}' does not exist for any applicable object types`);
                }
                return;
            }
            if (parts[index].parameter === null) {
                // TagTracer.cs:177-182.
                result = result.filter(p => !p[0].requiresParam);
                if (result.length === 0) {
                    this.error(`Tag part '${part}' requires an input [tag parameter] value.`);
                    return;
                }
            }
            else {
                // TagTracer.cs:186-191.
                result = result.filter(p => p[0].allowsParam);
                if (result.length === 0) {
                    this.error(`Tag part '${part}' cannot have a [tag parameter].`);
                    return;
                }
            }
            // TagTracer.cs:193-194 — longest match wins.
            let longestPart = 0;
            for (const p of result) {
                if (p[1] > longestPart) {
                    longestPart = p[1];
                }
            }
            result = result.filter(p => p[1] === longestPart);
            // TagTracer.cs:195-213. C# builds this with SelectMany; the collection
            // expression forces enumeration here, before `index` advances at :215, so
            // reading `Tag.Parts[index].Parameter` inside the lambda is safe there and
            // eager evaluation here is equivalent.
            const nextRoots = new Set<MetaObjectType>();
            for (const p of result) {
                let contribution: Set<MetaObjectType> | null;
                // TagTracer.cs:197 — the `.as[...]` cast rewrites the type set mid-walk.
                if (p[0].baseType === this.docs.objectTagType && p[0].afterDotCleaned === 'as') {
                    // TagTracer.cs:199-203. The `?? ''` guards a hypothetical `as` tag with an
                    // optional parameter, where C# would dereference a null Parameter; the
                    // resulting 'tag' name resolves to nothing, so the cast contributes nothing.
                    let castType = (parts[index].parameter ?? '').toLowerCase();
                    if (!castType.endsWith('tag')) {
                        castType = `${castType}tag`;
                    }
                    const wantedType = this.docs.objectTypes.get(castType) ?? null;
                    // TagTracer.cs:205-209 — Error, then `return []`: contributes no types.
                    if (wantedType === null) {
                        this.error(`Tag part 'as[${castType}]' is invalid: type name given doesn't appear to be a real object type.`);
                        continue;
                    }
                    // TagTracer.cs:210.
                    contribution = this.parsePossibleTypes(castType, wantedType);
                }
                else {
                    // TagTracer.cs:212.
                    contribution = this.parsePossibleTypes(p[0].returns, p[0].returnType);
                }
                // Deviation 3: C#'s SelectMany would throw a NullReferenceException on a null
                // here (a tag whose documented @returns names no known object type). Treating
                // it as contributing nothing matches the `as[...]`-with-a-bad-type branch above
                // and keeps a single bad meta entry from killing the language server.
                if (contribution !== null) {
                    for (const contributed of contribution) {
                        nextRoots.add(contributed);
                    }
                }
            }
            possibleRoots = nextRoots;
            // TagTracer.cs:214. Only the index the match started at is recorded; parts
            // swallowed by a multi-part match keep no sub-type set of their own.
            this.possibleSubTypes.set(index, this.getFullComplexSetFrom(possibleRoots));
            // TagTracer.cs:215.
            index += longestPart;
        }
    }

    /** Gets all possible object types from a set of known types, based on their bases and implements (TagTracer.cs:220-250). */
    getFullComplexSetFrom(original: Set<MetaObjectType>): Set<MetaObjectType> {
        // TagTracer.cs:222.
        const result = new Set<MetaObjectType>();
        for (const type of original) {
            // TagTracer.cs:225-228 — ObjectTag anywhere in the input means everything is possible.
            if (type === this.docs.objectTagType) {
                return new Set(this.docs.objectTypes.values());
            }
            // TagTracer.cs:229.
            result.add(type);
            // TagTracer.cs:230-235. Deviation 3: `seen` bounds the walk. C# loops until
            // BaseType is null, which hangs forever on a cyclic `@base` chain — linkTypeGraph
            // deliberately omits the C# recursion check that would have rejected one. For an
            // acyclic graph (all real meta) `seen` never triggers and the result is identical.
            const seen = new Set<MetaObjectType>();
            let baseType = type.baseType;
            while (baseType !== null && baseType !== undefined && !seen.has(baseType)) {
                seen.add(baseType);
                result.add(baseType);
                baseType = baseType.baseType;
            }
            // TagTracer.cs:236-239.
            for (const implType of type.implementsTypes) {
                result.add(implType);
            }
            // TagTracer.cs:240-246.
            for (const extendType of this.docs.objectTypes.values()) {
                if (extendType.implementsTypes.includes(type)) {
                    result.add(extendType);
                }
            }
        }
        // TagTracer.cs:248. Deviation 3: guarded. C# adds unconditionally, which would put a
        // null into the set when docs have no ObjectTag at all, poisoning every consumer that
        // then reads `type.subTags`. Only differs from C# for docs missing ObjectTag entirely.
        if (this.docs.objectTagType !== null && this.docs.objectTagType !== undefined) {
            result.add(this.docs.objectTagType);
        }
        return result;
    }

    /** Traces just one part of the tag, gathering a list of possible subtags (TagTracer.cs:253-286). */
    traceTagPartSingle(possibleRoots: Set<MetaObjectType> | null, index: number): TagMatch[] | null {
        // TagTracer.cs:255-258. The null-element check is defensive in C# and stays so here;
        // deviation 3's guard in getFullComplexSetFrom means a null can no longer get in.
        if (possibleRoots === null || possibleRoots.has(null as unknown as MetaObjectType)) {
            return null;
        }
        const parts = this.tag.parts;
        // TagTracer.cs:259-260.
        const result: TagMatch[] = [];
        const part = parts[index].text.toLowerCase();
        for (const type of this.getFullComplexSetFrom(possibleRoots)) {
            let veryComplexTag: MetaTag | undefined;
            let complexTag: MetaTag | undefined;
            let subTag: MetaTag | undefined;
            // TagTracer.cs:263-270.
            if (index + 2 < parts.length && (veryComplexTag = type.subTags.get(`${part}.${parts[index + 1].text}.${parts[index + 2].text}`))) {
                for (let i = 0; i < 3; i++) {
                    this.addPossibleTag(index + i, veryComplexTag);
                }
                result.push([veryComplexTag, 3]);
            }
            // TagTracer.cs:271-278.
            else if (index + 1 < parts.length && (complexTag = type.subTags.get(`${part}.${parts[index + 1].text}`))) {
                for (let i = 0; i < 2; i++) {
                    this.addPossibleTag(index + i, complexTag);
                }
                result.push([complexTag, 2]);
            }
            // TagTracer.cs:279-283.
            else if ((subTag = type.subTags.get(part))) {
                this.addPossibleTag(index, subTag);
                result.push([subTag, 1]);
            }
        }
        // TagTracer.cs:285.
        return result;
    }
}

/**
 * Traces a parsed tag against the linked meta docs. `docs` must already have been
 * through `linkTypeGraph` — the trace reads baseType/implementsTypes/extendedBy/subTags
 * and each tag's returnType, all of which that pass populates.
 *
 * `tag` is not modified (see deviation 1 in the module header).
 *
 * `callbacks` is optional and defaults to the C#'s ignore-everything actions, so a caller
 * that only wants the traced types — every caller before Phase 2C-4 — passes nothing and
 * is unaffected.
 */
export function traceTag(docs: MetaDocs, tag: SingleTag, callbacks?: TraceCallbacks): TraceResult {
    const tracer = new TagTracer(docs, tag, callbacks);
    tracer.trace();
    // The C# consumer reads `tag.Parts[^1]` (TextDocumentService.cs:527, 549), i.e. the
    // last part's sets, and `Part.PossibleSubTypes` starts out as an empty HashSet
    // (TagHelper.cs:114) — so a last part the trace never reached yields an empty set.
    return {
        possibleSubTypes: tracer.possibleSubTypes.get(tag.parts.length - 1) ?? new Set(),
        possibleTags: tracer.possibleTags
    };
}
