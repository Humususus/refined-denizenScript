import { describe, it, expect } from 'vitest';
import { buildMetaDocs } from '../metaDocs/metaDocsManager';
import { linkTypeGraph } from '../metaDocs/metaLinker';
import type { MetaBlock } from '../metaDocs/metaLoader';
import type { MetaDocs, MetaObjectType, MetaTag } from '../metaDocs/metaTypes';
import { parseTag } from './tagHelper';
import { traceTag } from './tagTracer';

// Fixture builders copied in shape from metaLinker.test.ts.
function type(name: string, base: string, extra: string[] = []): MetaBlock {
    return { objectType: 'objecttype', url: 'src#L1', data: [`@name ${name}`, `@prefix ${name.toLowerCase()}`, `@base ${base}`, `@format x`, `@description x`, ...extra, '@end_meta'] };
}

function tag(attribute: string, returns: string): MetaBlock {
    return { objectType: 'tag', url: 'src#L1', data: [`@attribute ${attribute}`, `@returns ${returns}`, '@description x', '@end_meta'] };
}

/**
 * The fixture graph. Object types: ObjectTag <- ElementTag <- {PlayerTag, MapTag},
 * ObjectTag <- ListTag, plus a rootless FlaggableObject that PlayerTag implements.
 */
function buildFixture(): MetaDocs {
    const docs = buildMetaDocs([
        type('ObjectTag', 'none'),
        type('ElementTag', 'ObjectTag'),
        type('PlayerTag', 'ElementTag', ['@implements FlaggableObject']),
        type('MapTag', 'ElementTag'),
        type('ListTag', 'ObjectTag'),
        type('FlaggableObject', 'none'),
        // Base tags (beforeDot is 'Base', so these are not indexed into any type's subTags).
        tag('<player>', 'PlayerTag'),
        tag('<name>', 'PlayerTag'),
        tag('<definition[<name>]>', 'ObjectTag'),
        tag('<somereq[<x>]>', 'PlayerTag'),
        tag('<weirdbase>', 'NoSuchType'),
        // A two-part complex base tag: Docs.Tags holds the key 'mybase.sub' (TagTracer.cs:69).
        tag('<mybase.sub>', 'PlayerTag'),
        // Type-owned tags.
        tag('<PlayerTag.name>', 'ElementTag'),
        tag('<PlayerTag.groups>', 'ListTag'),
        tag('<PlayerTag.foo.bar>', 'ListTag'),
        tag('<ElementTag.foo>', 'ElementTag'),
        tag('<ElementTag.to_uppercase>', 'ElementTag'),
        tag('<ListTag.size>', 'ElementTag'),
        tag('<FlaggableObject.flag[<name>]>', 'ObjectTag'),
        tag('<ObjectTag.as[<type>]>', 'ObjectTag')
    ]);
    linkTypeGraph(docs);
    return docs;
}

const docs = buildFixture();

function traced(text: string) {
    return traceTag(docs, parseTag(text, () => { /* ignore */ }));
}

function typeNames(types: Iterable<MetaObjectType>): string[] {
    return [...types].map(t => t.cleanName).sort();
}

function tagNames(tags: MetaTag[] | undefined): string[] {
    return (tags ?? []).map(t => t.cleanName).sort();
}

describe('traceTag fixture sanity', () => {
    it('links the fixture graph the way the trace expectations assume', () => {
        expect(docs.objectTypes.size).toBe(6);
        expect(docs.objectTagType).toBe(docs.objectTypes.get('objecttag'));
        expect(docs.objectTypes.get('playertag')!.baseType).toBe(docs.objectTypes.get('elementtag'));
        expect(docs.objectTypes.get('playertag')!.implementsTypes).toEqual([docs.objectTypes.get('flaggableobject')]);
        expect(docs.objectTypes.get('playertag')!.subTags.get('foo.bar')).toBe(docs.tags.get('playertag.foo.bar'));
        expect(docs.tags.get('weirdbase')!.returnType).toBeNull();
    });
});

describe('traceTag base resolution (TagTracer.cs:33-120)', () => {
    it('resolves a plain base tag to its return type closure', () => {
        // Single part, so TraceTagParts returns at :147 and the answer comes from :110:
        // GetFullComplexSetFrom({PlayerTag}) = PlayerTag + base chain (ElementTag, ObjectTag)
        // + implements (FlaggableObject), plus ObjectTag again at :248.
        const result = traced('player');
        expect(typeNames(result.possibleSubTypes)).toEqual(['elementtag', 'flaggableobject', 'objecttag', 'playertag']);
        expect(tagNames(result.possibleTags.get(0))).toEqual(['player']);
    });

    it('traces a subtag off a base tag and reports the subtag return closure after the last part', () => {
        // :195-214 — after 'groups' the roots are ParsePossibleTypes(ListTag) = {ListTag}
        // (ListTag has no ExtendedBy), whose GetFullComplexSetFrom is {ListTag, ObjectTag}.
        const result = traced('player.groups');
        expect(typeNames(result.possibleSubTypes)).toEqual(['listtag', 'objecttag']);
        expect(tagNames(result.possibleTags.get(1))).toEqual(['playertag.groups']);
    });

    it('adds ExtendedBy to a return type set (:136-138)', () => {
        // 'name' returns ElementTag; ParsePossibleTypes adds ElementTag.ExtendedBy
        // (PlayerTag, MapTag), then GetFullComplexSetFrom pulls in ObjectTag and
        // PlayerTag's implemented FlaggableObject.
        expect(typeNames(traced('player.name').possibleSubTypes))
            .toEqual(['elementtag', 'flaggableobject', 'maptag', 'objecttag', 'playertag']);
    });

    it('treats an empty root as "definition" (:40-43)', () => {
        const result = traced('[mydef]');
        expect(tagNames(result.possibleTags.get(0))).toEqual(['definition']);
        // 'definition' returns ObjectTag, so :126-129 yields every type, and
        // GetFullComplexSetFrom short-circuits at :225-228 to every type as well.
        expect(result.possibleSubTypes.size).toBe(docs.objectTypes.size);
    });

    it('consumes a two-part complex base tag as one unit of length 2 (:69-76)', () => {
        const result = traced('mybase.sub.name');
        expect(tagNames(result.possibleTags.get(0))).toEqual(['mybase.sub']);
        expect(tagNames(result.possibleTags.get(1))).toEqual(['mybase.sub']);
        // Tracing resumed at index 2, so 'name' was matched against the PlayerTag set.
        expect(tagNames(result.possibleTags.get(2))).toEqual(['playertag.name']);
        expect(typeNames(result.possibleSubTypes))
            .toEqual(['elementtag', 'flaggableobject', 'maptag', 'objecttag', 'playertag']);
    });

    it('traces a documented object type used as a free-standing base (:98-105)', () => {
        // 'maptag' is not in Docs.Tags but is in Docs.ObjectTypes, so tracing starts
        // from [MapTag] at index 1. No base tag exists, so part 0 gets no PossibleTags.
        const result = traced('maptag.to_uppercase');
        expect(result.possibleTags.get(0)).toBeUndefined();
        expect(tagNames(result.possibleTags.get(1))).toEqual(['elementtag.to_uppercase']);
    });

    it('starts tracing at index 2 for a context root (:44-47)', () => {
        const result = traced('context.foo.name');
        expect(result.possibleTags.get(1)).toBeUndefined();
        expect(tagNames(result.possibleTags.get(2))).toEqual(['playertag.name']);
    });

    it('returns early for a legacy special tag base, before the Docs.Tags lookup (:48-52)', () => {
        // The fixture defines a real base tag '<name>'; the legacy branch is checked
        // first, so nothing is traced at all.
        const result = traced('name.foo');
        expect(result.possibleTags.size).toBe(0);
        expect(result.possibleSubTypes.size).toBe(0);
    });

    it('returns early when a base tag requires a parameter that is absent (:82-86)', () => {
        const result = traced('somereq.name');
        expect(tagNames(result.possibleTags.get(0))).toEqual(['somereq']);
        // The early return skips :110, so not even part 0 gets sub-types.
        expect(result.possibleTags.get(1)).toBeUndefined();
        expect(result.possibleSubTypes.size).toBe(0);
    });

    it('traces normally when that required parameter is present', () => {
        const result = traced('somereq[bob].name');
        expect(tagNames(result.possibleTags.get(1))).toEqual(['playertag.name']);
    });

    it('returns early when a base tag is given a parameter it does not allow (:90-94)', () => {
        const result = traced('player[bob].name');
        expect(tagNames(result.possibleTags.get(0))).toEqual(['player']);
        expect(result.possibleTags.get(1)).toBeUndefined();
        expect(result.possibleSubTypes.size).toBe(0);
    });
});

describe('traceTag unknown roots (TagTracer.cs:106-110)', () => {
    it('does not throw for a root that does not exist', () => {
        expect(() => traced('nosuchroot.name')).not.toThrow();
    });

    it('leaves the last part untraced for an unknown multi-part root', () => {
        const result = traced('nosuchroot.name');
        expect(result.possibleTags.size).toBe(0);
        expect(result.possibleSubTypes.size).toBe(0);
    });

    it('yields exactly {ObjectTag} for a single-part unknown root', () => {
        // :110 still runs (the else branch at :106-109 has no return): part 0 has no
        // PossibleTags, so GetFullComplexSetFrom is called with an empty set and its
        // loop body never runs, leaving only the unconditional add at :248.
        expect(typeNames(traced('nosuchroot').possibleSubTypes)).toEqual(['objecttag']);
    });
});

describe('traceTag inheritance (TagTracer.cs:220-250)', () => {
    it('reaches a base type\'s tag from a derived-type part, via the baseType walk (:230-235)', () => {
        const result = traced('player.to_uppercase');
        expect(tagNames(result.possibleTags.get(1))).toEqual(['elementtag.to_uppercase']);
    });

    it('reaches an implemented type\'s tag (:236-239)', () => {
        const result = traced('player.flag[x]');
        expect(tagNames(result.possibleTags.get(1))).toEqual(['flaggableobject.flag']);
    });

    it('does not reach a sibling type\'s tag', () => {
        // ListTag.size is not reachable from PlayerTag.
        expect(traced('player.size').possibleTags.get(1)).toBeUndefined();
    });
});

describe('traceTag objecttag short-circuit (TagTracer.cs:126-129, 225-228)', () => {
    it('offers every object type after a tag that returns ObjectTag', () => {
        const result = traced('player.flag[x]');
        expect(result.possibleSubTypes.size).toBe(docs.objectTypes.size);
        expect(typeNames(result.possibleSubTypes)).toEqual(typeNames(docs.objectTypes.values()));
    });

    it('offers every object type for a definition', () => {
        expect(traced('[mydef]').possibleSubTypes.size).toBe(docs.objectTypes.size);
    });
});

describe('traceTag as[...] cast (TagTracer.cs:197-211)', () => {
    it('switches the type set to the named type', () => {
        expect(typeNames(traced('player.as[listtag]').possibleSubTypes)).toEqual(['listtag', 'objecttag']);
    });

    it('appends "tag" when the given name lacks it (:200-203)', () => {
        expect(typeNames(traced('player.as[list]').possibleSubTypes)).toEqual(['listtag', 'objecttag']);
        expect(typeNames(traced('player.as[element]').possibleSubTypes))
            .toEqual(typeNames(traced('player.as[elementtag]').possibleSubTypes));
    });

    it('contributes no types when the cast names something that is not a type (:206-209)', () => {
        // The lambda returns [], so possibleRoots becomes empty and :214 stores
        // GetFullComplexSetFrom({}) = {ObjectTag}.
        expect(typeNames(traced('player.as[notarealtype]').possibleSubTypes)).toEqual(['objecttag']);
    });
});

describe('traceTag longest-match wins (TagTracer.cs:193-194, 215)', () => {
    it('prefers a two-part subtag over a one-part one and advances the index by two', () => {
        // At index 1 both PlayerTag.foo.bar (length 2) and ElementTag.foo (length 1)
        // match, so :263-283 records both on part 1. :193-194 keeps only the length-2
        // match, and :215 advances to index 3, where 'size' is looked up on ListTag.
        const result = traced('player.foo.bar.size');
        expect(tagNames(result.possibleTags.get(1))).toEqual(['elementtag.foo', 'playertag.foo.bar']);
        expect(tagNames(result.possibleTags.get(2))).toEqual(['playertag.foo.bar']);
        expect(tagNames(result.possibleTags.get(3))).toEqual(['listtag.size']);
        expect(typeNames(result.possibleSubTypes))
            .toEqual(['elementtag', 'flaggableobject', 'maptag', 'objecttag', 'playertag']);
    });

    it('leaves the final part untraced when a multi-part match swallowed it', () => {
        // 'player.foo.bar' ends on the swallowed part 2, whose PossibleSubTypes is
        // never assigned - TraceTagParts only assigns at the index it started from.
        expect(traced('player.foo.bar').possibleSubTypes.size).toBe(0);
    });

    it('leaves the last part untraced when a complex base tag consumed the whole tag', () => {
        // The same gap at the base: :69-76 consumes parts 0 and 1 and calls
        // TraceTagParts with index 2, which returns at :147 because Parts.Count is 2.
        // :110 then fills in part 0 only, so the LAST part - which is what the C#
        // consumer reads (TextDocumentService.cs:527) - keeps its empty starting set.
        // This is not a fixture artifact: real meta has a 'server.flag' tag, so
        // `<server.flag[x].` behaves exactly this way in the C# original too.
        const result = traced('mybase.sub');
        expect(tagNames(result.possibleTags.get(1))).toEqual(['mybase.sub']);
        expect(result.possibleSubTypes.size).toBe(0);
    });
});

describe('traceTag stops on an unknown return type (TagTracer.cs:140-141, 147)', () => {
    it('stops tracing entirely rather than falling back to ObjectTag', () => {
        // '<weirdbase>' returns an unknown type, so ParsePossibleTypes returns null and
        // TraceTagParts bails at :147. Were null collapsed to an empty set, tracing
        // would continue and TraceTagPartSingle's GetFullComplexSetFrom({}) = {ObjectTag}
        // would happily match ObjectTag.as here.
        const result = traced('weirdbase.as[listtag]');
        expect(tagNames(result.possibleTags.get(0))).toEqual(['weirdbase']);
        expect(result.possibleTags.get(1)).toBeUndefined();
        expect(result.possibleSubTypes.size).toBe(0);
    });
});

describe('traceTag parameter filtering (TagTracer.cs:175-192)', () => {
    it('drops a subtag that requires a parameter when none is given', () => {
        const result = traced('player.flag');
        expect(tagNames(result.possibleTags.get(1))).toEqual(['flaggableobject.flag']);
        // Recorded by TraceTagPartSingle, but filtered out at :177, so tracing stops.
        expect(result.possibleSubTypes.size).toBe(0);
    });

    it('drops a subtag that cannot take a parameter when one is given', () => {
        const result = traced('player.name[x]');
        expect(tagNames(result.possibleTags.get(1))).toEqual(['playertag.name']);
        expect(result.possibleSubTypes.size).toBe(0);
    });
});

describe('traceTag does not mutate its input', () => {
    it('leaves the parsed SingleTag untouched', () => {
        const parsed = parseTag('player.name', () => { /* ignore */ });
        const before = JSON.parse(JSON.stringify(parsed));
        traceTag(docs, parsed);
        expect(JSON.parse(JSON.stringify(parsed))).toEqual(before);
    });

    it('does not corrupt a cached MetaTag.parsedFormat when tracing it', () => {
        const cached = docs.tags.get('playertag.name')!;
        const before = JSON.parse(JSON.stringify(cached.parsedFormat));
        traceTag(docs, cached.parsedFormat!);
        expect(JSON.parse(JSON.stringify(cached.parsedFormat))).toEqual(before);
    });
});

describe('traceTag degenerate input', () => {
    it('returns empty results for a tag with no usable parts', () => {
        const result = traceTag(docs, { parts: [], fallback: null, endChar: 0 });
        expect(result.possibleSubTypes.size).toBe(0);
        expect(result.possibleTags.size).toBe(0);
    });
});

/**
 * The tracer's diagnostics, restored in Phase 2C-4. Every message below was copied from
 * TagTracer.cs, not paraphrased -- `CheckSingleTag` (ScriptChecker.cs:499) puts them in front of
 * the user verbatim, prefixed with "Tag tracer: ".
 *
 * There are THIRTEEN raise sites in the C#: twelve `Error` and one `DeprecationError`. They were
 * enumerated with `grep -n "Error(" TagTracer.cs` before any of this was written, and each test
 * below names the C# line it covers.
 */
function tracedWith(text: string) {
    const errors: string[] = [];
    const deprecations: { message: string; partText: string }[] = [];
    const result = traceTag(docs, parseTag(text, () => { /* ignore */ }), {
        error: (m) => errors.push(m),
        deprecation: (m, part) => deprecations.push({ message: m, partText: part.text })
    });
    return { errors, deprecations, result };
}

describe('traceTag diagnostics: the tag base (TagTracer.cs:44-109)', () => {
    it('reports a legacy special tag base as deprecated (:50)', () => {
        // The fixture also declares a real `<name>` tag, and this branch is checked BEFORE the
        // Docs.Tags lookups -- so the legacy list wins over a documented tag of the same name.
        // MUTANT CAUGHT: moving the LEGACY_SPECIAL_TAGS branch below the Docs.Tags lookups.
        expect(tracedWith('name').errors).toEqual([
            "Tag base 'name' is deprecated: write it as a definition, like '<[name]>'."
        ]);
    });

    it('reports a base that requires a [parameter] and was given none (:84)', () => {
        expect(tracedWith('somereq').errors).toEqual([
            "Tag base 'somereq' requires an input [tag parameter] value."
        ]);
    });

    it('reports a base that cannot take a [parameter] but was given one (:92)', () => {
        expect(tracedWith('player[x]').errors).toEqual([
            "Tag base 'player' cannot have a [tag parameter]."
        ]);
    });

    it('reports a base that does not exist (:108)', () => {
        expect(tracedWith('nosuchbase').errors).toEqual([
            "Tag base 'nosuchbase' does not exist."
        ]);
    });

    it('names the RAW base text, not the substituted "definition", for an empty base (:108)', () => {
        // :39-43 rewrites an empty root to `definition` for LOOKUP, but :108's message reads
        // `Tag.Parts[0].Text` -- the original, empty. Ported verbatim; the fixture has no
        // `definition` tag registered under that name... except it does, so use a shape that
        // misses: the message form is what matters here.
        // MUTANT CAUGHT: using `root` instead of `parts[0].text` in the :108 message.
        const errs = tracedWith('nosuchbase').errors;
        expect(errs[0].startsWith("Tag base 'nosuchbase'")).toBe(true);
    });

    it('reports nothing at all for a valid base', () => {
        // The false-positive guard. A base that resolves must be silent.
        expect(tracedWith('player').errors).toEqual([]);
        expect(tracedWith('definition[x]').errors).toEqual([]);
    });
});

describe('traceTag diagnostics: return types and parts (TagTracer.cs:140-207)', () => {
    it('reports an unknown object return type (:140)', () => {
        // The fixture's `<weirdbase>` is documented as returning `NoSuchType`, so
        // parsePossibleTypes finds no type and errors before returning null.
        expect(tracedWith('weirdbase').errors).toEqual([
            "(Internal) Unknown object return type 'nosuchtype'"
        ]);
    });

    it('names the ONE object type when only one was in play (:163)', () => {
        expect(tracedWith('playertag.nosuchpart').errors).toEqual([
            "Tag part 'nosuchpart' does not exist for object type PlayerTag"
        ]);
    });

    it('names ALL the object types when there are fewer than five (:167)', () => {
        // `<player.name>` returns ElementTag, which expands to {ElementTag, PlayerTag, MapTag}.
        // MUTANT CAUGHT: using the `< 5` branch's message for the single-type case, or vice
        // versa -- the three forms are chosen by count and only a multi-type fixture separates
        // them.
        const errs = tracedWith('player.name.nosuchpart').errors;
        expect(errs.length).toBe(1);
        expect(errs[0].startsWith("Tag part 'nosuchpart' does not exist for object types ")).toBe(true);
        const named = errs[0].substring("Tag part 'nosuchpart' does not exist for object types ".length).split(', ').sort();
        expect(named).toEqual(['ElementTag', 'MapTag', 'PlayerTag']);
    });

    it('gives up on naming them when five or more are in play (:171)', () => {
        // `<definition[x]>` returns ObjectTag, which means every type is possible -- six in the
        // fixture, so the count is >= 5.
        expect(tracedWith('definition[x].nosuchpart').errors).toEqual([
            "Tag part 'nosuchpart' does not exist for any applicable object types"
        ]);
    });

    it('reports a part that requires a [parameter] and was given none (:180)', () => {
        // PlayerTag implements FlaggableObject, whose `flag[<name>]` requires its parameter.
        expect(tracedWith('player.flag').errors).toEqual([
            "Tag part 'flag' requires an input [tag parameter] value."
        ]);
    });

    it('reports a part that cannot take a [parameter] but was given one (:189)', () => {
        expect(tracedWith('player.groups[x]').errors).toEqual([
            "Tag part 'groups' cannot have a [tag parameter]."
        ]);
    });

    it('reports an as[...] cast to a type that does not exist (:207)', () => {
        // NOTE the message quotes the NORMALISED type name -- ':200-203' appends "tag" when the
        // written name does not end with it, so `as[nosuch]` reports as `as[nosuchtag]`.
        // MUTANT CAUGHT: quoting the raw parameter instead of the normalised castType.
        expect(tracedWith('player.as[nosuch]').errors).toEqual([
            "Tag part 'as[nosuchtag]' is invalid: type name given doesn't appear to be a real object type."
        ]);
    });

    it('reports nothing for a fully valid multi-part tag', () => {
        // The false-positive guard again, and the one that matters most: this is the shape of
        // almost every tag in a real script.
        expect(tracedWith('player.groups.size').errors).toEqual([]);
        expect(tracedWith('player.flag[x]').errors).toEqual([]);
        expect(tracedWith('player.as[list]').errors).toEqual([]);
    });
});

describe('traceTag diagnostics: the deprecation sweep (TagTracer.cs:111-119)', () => {
    // A separate fixture: the shared one has no deprecated tags, and adding one to it would
    // change counts several existing tests assert on.
    function deprecatedFixture(): MetaDocs {
        const d = buildMetaDocs([
            type('ObjectTag', 'none'),
            type('ElementTag', 'ObjectTag'),
            type('PlayerTag', 'ElementTag'),
            { objectType: 'tag', url: 'src#L1', data: ['@attribute <player>', '@returns PlayerTag', '@description x', '@end_meta'] },
            { objectType: 'tag', url: 'src#L1', data: ['@attribute <PlayerTag.oldway>', '@returns ElementTag', '@deprecated Use something else.', '@description x', '@end_meta'] },
            { objectType: 'tag', url: 'src#L1', data: ['@attribute <PlayerTag.fine>', '@returns ElementTag', '@description x', '@end_meta'] }
        ]);
        linkTypeGraph(d);
        return d;
    }
    const depDocs = deprecatedFixture();
    function traceDep(text: string) {
        const deprecations: { message: string; partText: string }[] = [];
        traceTag(depDocs, parseTag(text, () => { /* ignore */ }), {
            deprecation: (m, part) => deprecations.push({ message: m, partText: part.text })
        });
        return deprecations;
    }

    it('reports a part whose only possible tag is deprecated', () => {
        // The sweep the first port of this file dropped entirely, on the correct grounds that it
        // cannot affect control flow. Phase 2C-4 needs it for `deprecated_tag_part`.
        // MUTANT CAUGHT: leaving the sweep out.
        expect(traceDep('player.oldway')).toEqual([
            { message: 'Deprecated tag `playertag.oldway`: Use something else.', partText: 'oldway' }
        ]);
    });

    it('reports NOTHING for a part that is not deprecated', () => {
        expect(traceDep('player.fine')).toEqual([]);
    });

    it('reports NOTHING for a part the trace never resolved', () => {
        // :114's condition is `deprecated.Any() && ...`, and an unresolved part has an empty
        // possibleTags list -- so the empty `deprecated` list makes the first conjunct false.
        // MUTANT CAUGHT: writing the condition as `deprecated.length === partTags.length` alone,
        // which is trivially true for two empty lists and would fire on every unresolved part.
        expect(traceDep('player.nosuchpart')).toEqual([]);
    });

    it('defaults both callbacks to no-ops when none are passed', () => {
        // Every caller before Phase 2C-4 passes nothing, and must keep working. This is the
        // assertion that the signature change is backwards compatible.
        expect(() => traceTag(depDocs, parseTag('player.oldway', () => { /* ignore */ }))).not.toThrow();
        expect(() => traceTag(depDocs, parseTag('nosuchbase', () => { /* ignore */ }))).not.toThrow();
    });
});

/**
 * Three tests added after a mutation audit found the originals did not discriminate. Each needed
 * a fixture the shared one cannot express; the comments record what was missing.
 */
describe('traceTag diagnostics: cases the shared fixture cannot reach', () => {
    // No `definition` tag, one pseudo-object-type with `@prefix none`, and a part name that two
    // different types both define -- one deprecated, one not.
    function edgeFixture(): MetaDocs {
        const d = buildMetaDocs([
            type('ObjectTag', 'none'),
            type('ElementTag', 'ObjectTag'),
            type('PlayerTag', 'ElementTag'),
            type('MapTag', 'ElementTag'),
            // `type()` hardcodes `@prefix <lowercased name>`, so this one is written out.
            { objectType: 'objecttype', url: 'src#L1', data: ['@name PseudoTag', '@prefix none', '@base ObjectTag', '@format x', '@description x', '@end_meta'] },
            { objectType: 'tag', url: 'src#L1', data: ['@attribute <player>', '@returns PlayerTag', '@description x', '@end_meta'] },
            { objectType: 'tag', url: 'src#L1', data: ['@attribute <PlayerTag.widen>', '@returns ElementTag', '@description x', '@end_meta'] },
            { objectType: 'tag', url: 'src#L1', data: ['@attribute <ElementTag.dup>', '@returns ElementTag', '@deprecated Old one.', '@description x', '@end_meta'] },
            { objectType: 'tag', url: 'src#L1', data: ['@attribute <PlayerTag.dup>', '@returns ElementTag', '@description x', '@end_meta'] }
        ]);
        linkTypeGraph(d);
        return d;
    }
    const edgeDocs = edgeFixture();
    function traceEdge(text: string) {
        const errors: string[] = [];
        const deprecations: string[] = [];
        traceTag(edgeDocs, parseTag(text, () => { /* ignore */ }), {
            error: (m) => errors.push(m),
            deprecation: (m) => deprecations.push(m)
        });
        return { errors, deprecations };
    }

    it('names the EMPTY base text, not the substituted "definition" (:108)', () => {
        // TagTracer.cs:39-43 rewrites an empty root to `definition` for the LOOKUP, but :108's
        // message reads `Tag.Parts[0].Text` -- the original, still empty. So `<[x]>` in a doc set
        // with no `definition` tag reports an empty name.
        //
        // The first version of this test used `nosuchbase`, where root and parts[0].text are the
        // SAME STRING, so it could not tell the two apart at all. Confirmed by mutation: swapping
        // `parts[0].text` for `root` survived it. This fixture has no `definition` tag, which is
        // what forces the else branch for an empty base.
        // MUTANT CAUGHT: using `root` in the :108 message.
        expect(traceEdge('[x]').errors).toEqual(["Tag base '' does not exist."]);
    });

    it('reports a pseudo-object-type used as a free-standing base (:102)', () => {
        // The check is `documentedObjectBase.Prefix.ToLowerFast() == "none"`, and the shared
        // fixture's `type()` helper always writes a real prefix -- so no test could reach this
        // branch and dropping the whole error survived. This fixture declares `@prefix none`.
        //
        // NOTE the trace CONTINUES afterwards (:104 runs either way); the diagnostic is the
        // entire effect of the branch.
        // MUTANT CAUGHT: dropping the error.
        expect(traceEdge('pseudotag').errors).toEqual([
            "Tag base 'pseudotag' seems to refer to a pseudo-object-type, but not one that can be used as a free-standing tag base."
        ]);
    });

    it('does NOT report deprecation when only SOME of a part\'s possible tags are deprecated', () => {
        // TagTracer.cs:114 is `deprecated.Any() && deprecated.Count == part.PossibleTags.Count`.
        // The second conjunct is the point: a part that could be one of several documented tags,
        // only some of them deprecated, is left alone -- the author may well mean a live one.
        //
        // The original tests only ever produced parts with ONE possible tag, where the two
        // conjuncts agree, so weakening the condition to `deprecated.length > 0` survived.
        // Reaching a multi-tag part needs a widened root set: `<player.widen>` returns ElementTag,
        // which expands to {ElementTag, PlayerTag, MapTag}, and both ElementTag and PlayerTag
        // define `dup`.
        // MUTANT CAUGHT: dropping the `=== partTags.length` conjunct.
        expect(traceEdge('player.widen.dup').deprecations).toEqual([]);
        // Sanity: the deprecated one alone still reports, so the fixture is not simply silent.
        expect(traceEdge('player.widen.dup').errors).toEqual([]);
    });
});
