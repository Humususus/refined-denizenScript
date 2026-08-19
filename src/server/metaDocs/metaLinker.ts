/**
 * Links the object-type graph: resolves each MetaObjectType's baseTypeName
 * and implementsNames into actual MetaObjectType references, builds the
 * reverse extendedBy index, and indexes each type's own tags into subTags.
 * Ported from SharpDenizenTools/MetaObjects/MetaObjectType.cs:128-184
 * (PostCheck). Deliberately excludes that method's validation warnings
 * (Require, prefix-uniqueness, the recursive-loop check, PostCheckSynonyms,
 * PostCheckLinkableText) — those belong to a diagnostics phase, not this
 * one. The AddTo half that sets ObjectTagType/ElementTagType is ported from
 * MetaObjectType.cs:22-33.
 */

import { MetaDocs } from './metaTypes';

/**
 * Resolves the object-type graph in docs: baseType, implementsTypes,
 * extendedBy, and subTags on every MetaObjectType, plus docs.objectTagType
 * and docs.elementTagType.
 *
 * Idempotent: unlike the C# original (PostCheck runs exactly once per
 * load), this resets every field it populates before relinking, since our
 * tests and cache reloads can rebuild MetaDocs and call this repeatedly. A
 * second call without the reset would double every reverse link.
 */
export function linkTypeGraph(docs: MetaDocs): void {
    // Step 1: reset, so repeated calls are idempotent.
    for (const type of docs.objectTypes.values()) {
        type.baseType = null;
        type.implementsTypes = [];
        type.extendedBy = [];
        type.subTags = new Map();
    }

    // Step 2: expose the ObjectTag/ElementTag roots (MetaObjectType.cs:22-33).
    docs.objectTagType = docs.objectTypes.get('objecttag') ?? null;
    docs.elementTagType = docs.objectTypes.get('elementtag') ?? null;

    // Step 3: resolve baseType and implementsTypes, and populate the
    // reverse extendedBy index (MetaObjectType.cs:131-155).
    for (const type of docs.objectTypes.values()) {
        if (type.baseTypeName.toLowerCase() !== 'none') {
            const base = docs.objectTypes.get(type.baseTypeName.toLowerCase());
            if (base) {
                type.baseType = base;
                base.extendedBy.push(type);
            }
            else {
                docs.loadErrors.push(`Object type name '${type.typeName}' specifies basetype '${type.baseTypeName}' which is invalid.`);
            }
        }
        for (const implementsName of type.implementsNames) {
            const implemented = docs.objectTypes.get(implementsName.toLowerCase());
            if (implemented) {
                type.implementsTypes.push(implemented);
                implemented.extendedBy.push(type);
            }
            else {
                docs.loadErrors.push(`Object type name '${type.typeName}' specifies implement type '${implementsName}' which is invalid.`);
            }
        }
    }

    // Step 4: index each type's own tags into subTags, keyed by
    // afterDotCleaned (MetaObjectType.cs:165-169). C# uses Dictionary.Add
    // here, which throws on a duplicate key; this uses Map.set, which
    // silently overwrites an earlier entry sharing the same beforeDot +
    // afterDotCleaned pair. See the Phase 2B-5 Task 1 report for the real
    // collision count measured against live data.
    for (const tag of docs.tags.values()) {
        const owner = docs.objectTypes.get(tag.beforeDot.toLowerCase());
        if (owner && tag.afterDotCleaned.length > 0) {
            owner.subTags.set(tag.afterDotCleaned, tag);
        }
    }
}
