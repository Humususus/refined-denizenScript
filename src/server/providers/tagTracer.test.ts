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
