"use strict";
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
 *
 * Also links each MetaTag's parsed format, parameter shape, and return/base
 * type, ported from MetaTag.cs:151-179 (also PostCheck) — again excluding
 * that method's validation (Require, the spaces check, mechanism
 * cross-checks, PostCheckSynonyms, PostCheckLinkableText).
 *
 * Imports parseTag from ../providers/tagHelper: this is the linker (not
 * metaTypes.ts, the model layer) depending on a provider module. That
 * direction is deliberate — it keeps metaTypes.ts free of runtime
 * dependencies on providers/. Do not "tidy" this by moving the parseTag
 * call into metaTypes.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.linkTypeGraph = void 0;
const tagHelper_1 = require("../providers/tagHelper");
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
function linkTypeGraph(docs) {
    var _a, _b, _c, _d, _e, _f;
    // Step 1: reset, so repeated calls are idempotent.
    for (const type of docs.objectTypes.values()) {
        type.baseType = null;
        type.implementsTypes = [];
        type.extendedBy = [];
        type.subTags = new Map();
    }
    // Step 2: expose the ObjectTag/ElementTag roots (MetaObjectType.cs:22-33).
    docs.objectTagType = (_a = docs.objectTypes.get('objecttag')) !== null && _a !== void 0 ? _a : null;
    docs.elementTagType = (_b = docs.objectTypes.get('elementtag')) !== null && _b !== void 0 ? _b : null;
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
    // Step 5: parse each tag's syntax and resolve its return/base type
    // (MetaTag.cs:151-179). Runs after the type-resolution steps above
    // because it looks tags up against the now-populated docs.objectTypes.
    for (const tag of docs.tags.values()) {
        // MetaTag.cs:151 — the meta stores the full syntax including the angle brackets;
        // parseTag wants the inside only.
        const inner = tag.tagFull.startsWith('<') && tag.tagFull.endsWith('>')
            ? tag.tagFull.substring(1, tag.tagFull.length - 1)
            : tag.tagFull;
        const parsedFormat = (0, tagHelper_1.parseTag)(inner, (message) => {
            docs.loadErrors.push(`Failed to parse meta tag '${tag.tagFull}': ${message}`);
        });
        tag.parsedFormat = parsedFormat;
        // MetaTag.cs:152-154. Guarded unlike the C# original: a malformed
        // @attribute can yield fewer parts than firstPartIndex expects, and
        // an uncaught exception here would abort the entire meta load —
        // turning one bad meta block into a dead language server. A missing
        // part is treated as "no parameter".
        const firstPartIndex = parsedFormat.parts.length === 1 ? 0 : 1;
        const parameter = (_d = (_c = parsedFormat.parts[firstPartIndex]) === null || _c === void 0 ? void 0 : _c.parameter) !== null && _d !== void 0 ? _d : null;
        tag.allowsParam = parameter !== null;
        tag.requiresParam = tag.allowsParam && !parameter.endsWith(')');
        // MetaTag.cs:174 — Before('(') so ListTag(PlayerTag) resolves to ListTag.
        const returnsKey = tag.returns.toLowerCase().split('(')[0];
        tag.returnType = (_e = docs.objectTypes.get(returnsKey)) !== null && _e !== void 0 ? _e : null;
        if (tag.returnType === null) {
            docs.loadErrors.push(`Tag '${tag.name}' specifies return type '${tag.returns}' which does not appear to be a valid object type.`);
        }
        tag.baseType = (_f = docs.objectTypes.get(tag.beforeDot.toLowerCase())) !== null && _f !== void 0 ? _f : null;
    }
    // Step 6: the raw-adjustable type names (MetaDocsLoader.cs:177).
    //
    // An object type is "raw adjustable" when its own generated example adjusts ITSELF -- i.e.
    // `@example_for_adjust` names the type -- and its clean name does not end in "tag". The
    // `adjust` command checker (Phase 2C-5) uses this to tell a mechanism name from an object
    // argument: anything in this set, written bare, is the OBJECT being adjusted rather than a
    // mechanism that does not exist.
    //
    // Derived here rather than in the checker because it is meta, not policy, and because the
    // C# derives it at load time too -- keeping it here means it is computed once per meta load
    // instead of once per adjust command in the workspace.
    docs.rawAdjustables = new Set();
    for (const type of docs.objectTypes.values()) {
        if (type.generatedExampleAdjust === type.name && !type.cleanName.endsWith('tag')) {
            docs.rawAdjustables.add(type.name);
        }
    }
}
exports.linkTypeGraph = linkTypeGraph;
//# sourceMappingURL=metaLinker.js.map