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
