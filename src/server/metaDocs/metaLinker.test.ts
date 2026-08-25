import { describe, it, expect } from 'vitest';
import { buildMetaDocs } from './metaDocsManager';
import { linkTypeGraph } from './metaLinker';
import type { MetaBlock } from './metaLoader';

function linked(...blocks: MetaBlock[]) {
    const docs = buildMetaDocs(blocks);
    linkTypeGraph(docs);
    return docs;
}

function type(name: string, base: string, extra: string[] = []): MetaBlock {
    return { objectType: 'objecttype', url: 'src#L1', data: [`@name ${name}`, `@prefix ${name.toLowerCase()}`, `@base ${base}`, `@format x`, `@description x`, ...extra, '@end_meta'] };
}

function tag(attribute: string, returns: string): MetaBlock {
    return { objectType: 'tag', url: 'src#L1', data: [`@attribute ${attribute}`, `@returns ${returns}`, '@description x', '@end_meta'] };
}

describe('linkTypeGraph object types', () => {
    it('resolves a base type name to the actual type', () => {
        const docs = linked(type('ObjectTag', 'none'), type('ElementTag', 'ObjectTag'));
        expect(docs.objectTypes.get('elementtag')!.baseType).toBe(docs.objectTypes.get('objecttag'));
    });

    it('leaves the base type null for a root type declaring base none', () => {
        expect(linked(type('ObjectTag', 'none')).objectTypes.get('objecttag')!.baseType).toBeNull();
    });

    it('records the reverse extendedBy link on the base', () => {
        const docs = linked(type('ObjectTag', 'none'), type('ElementTag', 'ObjectTag'));
        expect(docs.objectTypes.get('objecttag')!.extendedBy).toContain(docs.objectTypes.get('elementtag'));
    });

    it('resolves implements names and records the reverse link there too', () => {
        const docs = linked(type('ObjectTag', 'none'), type('FlaggableObject', 'none'), type('PlayerTag', 'ObjectTag', ['@implements FlaggableObject']));
        const player = docs.objectTypes.get('playertag')!;
        expect(player.implementsTypes).toEqual([docs.objectTypes.get('flaggableobject')]);
        expect(docs.objectTypes.get('flaggableobject')!.extendedBy).toContain(player);
    });

    it('exposes the ObjectTag and ElementTag roots on the docs', () => {
        const docs = linked(type('ObjectTag', 'none'), type('ElementTag', 'ObjectTag'));
        expect(docs.objectTagType).toBe(docs.objectTypes.get('objecttag'));
        expect(docs.elementTagType).toBe(docs.objectTypes.get('elementtag'));
    });

    it('records a load error for an unresolvable base type instead of throwing', () => {
        const docs = linked(type('PlayerTag', 'NoSuchType'));
        expect(docs.objectTypes.get('playertag')!.baseType).toBeNull();
        expect(docs.loadErrors.some(e => e.includes('NoSuchType'))).toBe(true);
    });

    it('indexes a type\'s own tags into subTags under the after-dot name', () => {
        const docs = linked(type('PlayerTag', 'none'), tag('<PlayerTag.name>', 'ElementTag'));
        expect(docs.objectTypes.get('playertag')!.subTags.get('name')).toBe(docs.tags.get('playertag.name'));
    });

    it('does not index a tag onto an unrelated type', () => {
        const docs = linked(type('PlayerTag', 'none'), type('ItemTag', 'none'), tag('<PlayerTag.name>', 'ElementTag'));
        expect(docs.objectTypes.get('itemtag')!.subTags.size).toBe(0);
    });

    it('is idempotent, so a second link pass does not double the reverse links', () => {
        const docs = linked(type('ObjectTag', 'none'), type('ElementTag', 'ObjectTag'));
        linkTypeGraph(docs);
        expect(docs.objectTypes.get('objecttag')!.extendedBy.filter(t => t.cleanName === 'elementtag').length).toBe(1);
    });
});

describe('linkTypeGraph tags', () => {
    it('resolves a tag return type to the object type', () => {
        const docs = linked(type('ElementTag', 'none'), type('PlayerTag', 'none'), tag('<PlayerTag.name>', 'ElementTag'));
        expect(docs.tags.get('playertag.name')!.returnType).toBe(docs.objectTypes.get('elementtag'));
    });

    it('resolves a parameterized return type to its outer type', () => {
        // MetaTag.cs:174 does Returns.ToLowerFast().Before('('), so ListTag(PlayerTag) is ListTag.
        const docs = linked(type('ListTag', 'none'), type('PlayerTag', 'none'), tag('<PlayerTag.groups>', 'ListTag(PlayerTag)'));
        expect(docs.tags.get('playertag.groups')!.returnType).toBe(docs.objectTypes.get('listtag'));
    });

    it('resolves the tag base type from its before-dot name', () => {
        const docs = linked(type('ElementTag', 'none'), type('PlayerTag', 'none'), tag('<PlayerTag.name>', 'ElementTag'));
        expect(docs.tags.get('playertag.name')!.baseType).toBe(docs.objectTypes.get('playertag'));
    });

    it('leaves the return type null and records an error for an unknown return type', () => {
        const docs = linked(type('PlayerTag', 'none'), tag('<PlayerTag.name>', 'NoSuchTag'));
        expect(docs.tags.get('playertag.name')!.returnType).toBeNull();
        expect(docs.loadErrors.some(e => e.includes('NoSuchTag'))).toBe(true);
    });

    it('parses the tag format and sees no parameter on a plain tag', () => {
        const docs = linked(type('ElementTag', 'none'), type('PlayerTag', 'none'), tag('<PlayerTag.name>', 'ElementTag'));
        const t = docs.tags.get('playertag.name')!;
        expect(t.parsedFormat!.parts.map(p => p.text)).toEqual(['playertag', 'name']);
        expect(t.allowsParam).toBe(false);
        expect(t.requiresParam).toBe(false);
    });

    it('treats a bare bracketed parameter as required', () => {
        // MetaTag.cs:152-154: index 1 for a multi-part tag; required unless the parameter ends with ')'.
        const docs = linked(type('ElementTag', 'none'), type('PlayerTag', 'none'), tag('<PlayerTag.flag[<name>]>', 'ElementTag'));
        const t = docs.tags.get('playertag.flag')!;
        expect(t.allowsParam).toBe(true);
        expect(t.requiresParam).toBe(true);
    });

    it('treats a parenthesised parameter as optional', () => {
        const docs = linked(type('ElementTag', 'none'), type('PlayerTag', 'none'), tag('<PlayerTag.list[(<name>)]>', 'ElementTag'));
        const t = docs.tags.get('playertag.list')!;
        expect(t.allowsParam).toBe(true);
        expect(t.requiresParam).toBe(false);
    });

    it('reads the parameter off part 0 for a single-part tag', () => {
        // MetaTag.cs:152: firstPartIndex is 0 when there is exactly one part.
        const docs = linked(type('PlayerTag', 'none'), tag('<player[<name>]>', 'PlayerTag'));
        expect(docs.tags.get('player')!.requiresParam).toBe(true);
    });
});

describe('linkTypeGraph: rawAdjustables (MetaDocsLoader.cs:177)', () => {
    function adjustableDocs(): MetaDocs {
        const d = buildMetaDocs([
            // Qualifies: its generated adjust example names itself, and the clean name has no
            // "tag" suffix.
            { objectType: 'objecttype', url: 'src#L1', data: ['@name Material', '@prefix material', '@base ObjectTag', '@format x', '@description x', '@exampleadjustobject Material', '@end_meta'] },
            // Rejected by the "tag" suffix rule, even though the adjust example names itself.
            { objectType: 'objecttype', url: 'src#L1', data: ['@name PlayerTag', '@prefix p', '@base ObjectTag', '@format x', '@description x', '@exampleadjustobject PlayerTag', '@end_meta'] },
            // Rejected because the example adjusts something else.
            { objectType: 'objecttype', url: 'src#L1', data: ['@name Inventory', '@prefix inv', '@base ObjectTag', '@format x', '@description x', '@exampleadjustobject Material', '@end_meta'] },
            // Rejected because it has no adjust example at all.
            { objectType: 'objecttype', url: 'src#L1', data: ['@name Plain', '@prefix plain', '@base ObjectTag', '@format x', '@description x', '@end_meta'] },
            { objectType: 'objecttype', url: 'src#L1', data: ['@name ObjectTag', '@prefix none', '@base none', '@format x', '@description x', '@end_meta'] }
        ]);
        linkTypeGraph(d);
        return d;
    }

    it('collects only types whose adjust example names themselves', () => {
        // The `adjust` checker uses this to tell a mechanism name from the object being
        // adjusted, so a type wrongly included would make a real mechanism read as an object.
        // MUTANT CAUGHT: dropping the `generatedExampleAdjust === name` test.
        expect(Array.from(adjustableDocs().rawAdjustables).sort()).toEqual(['Material']);
    });

    it('excludes types whose clean name ends in "tag"', () => {
        // MUTANT CAUGHT: dropping the suffix rule -- PlayerTag would join the set.
        expect(adjustableDocs().rawAdjustables.has('PlayerTag')).toBe(false);
    });

    it('is rebuilt from scratch on a second link, dropping what no longer qualifies', () => {
        // linkTypeGraph is idempotent by contract -- step 1 resets everything else too, and the
        // meta is re-linked whenever it reloads.
        //
        // Re-linking UNCHANGED docs cannot detect a missing reset, because Set.add is idempotent
        // and the second pass re-adds exactly what the first did. The stale entry only shows when
        // a type STOPS qualifying between links. Confirmed by mutation: the naive version of this
        // test survived deleting the reset entirely.
        // MUTANT CAUGHT: initialising the set once outside the function.
        const d = adjustableDocs();
        expect(Array.from(d.rawAdjustables)).toEqual(['Material']);
        d.objectTypes.get('material')!.generatedExampleAdjust = '<something.else>';
        linkTypeGraph(d);
        expect(Array.from(d.rawAdjustables)).toEqual([]);
    });
});
