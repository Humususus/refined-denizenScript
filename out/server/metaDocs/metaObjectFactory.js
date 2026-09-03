"use strict";
/**
 * Turns a raw meta block (object type name + `@key value` comment lines,
 * see metaLoader.ts) into a populated MetaObject instance. Ported from
 * SharpDenizenTools/MetaHandlers/MetaDocsLoader.cs's LoadInObject, plus the
 * MetaTypesData registry concept from MetaDocs.cs's constructor.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadInObject = exports.createMetaObjectForType = void 0;
const metaTypes_1 = require("./metaTypes");
const TYPE_FACTORIES = {
    command: () => Object.assign(new metaTypes_1.MetaCommand(), { type: metaTypes_1.META_TYPE_COMMAND }),
    tag: () => Object.assign(new metaTypes_1.MetaTag(), { type: metaTypes_1.META_TYPE_TAG }),
    event: () => Object.assign(new metaTypes_1.MetaEvent(), { type: metaTypes_1.META_TYPE_EVENT }),
    mechanism: () => Object.assign(new metaTypes_1.MetaMechanism(), { type: metaTypes_1.META_TYPE_MECHANISM }),
    property: () => Object.assign(new metaTypes_1.MetaProperty(), { type: metaTypes_1.META_TYPE_PROPERTY }),
    action: () => Object.assign(new metaTypes_1.MetaAction(), { type: metaTypes_1.META_TYPE_ACTION }),
    language: () => Object.assign(new metaTypes_1.MetaLanguage(), { type: metaTypes_1.META_TYPE_LANGUAGE }),
    objecttype: () => Object.assign(new metaTypes_1.MetaObjectType(), { type: metaTypes_1.META_TYPE_OBJECT }),
    guidepage: () => Object.assign(new metaTypes_1.MetaGuidePage(), { type: metaTypes_1.META_TYPE_GUIDEPAGE }),
    extension: () => Object.assign(new metaTypes_1.MetaExtension(), { type: metaTypes_1.META_TYPE_EXTENSION }),
    data: () => new metaTypes_1.MetaDataValue()
};
/** Creates a new, empty MetaObject subclass instance for the given meta type name (case-insensitive), or undefined if the type name isn't recognized. */
function createMetaObjectForType(objectType) {
    const factory = TYPE_FACTORIES[objectType.toLowerCase()];
    return factory ? factory() : undefined;
}
exports.createMetaObjectForType = createMetaObjectForType;
/** Parses `@key value` lines (with non-`@` lines treated as continuations of the previous value, joined with `\n`) and applies them to a freshly created MetaObject. Stops at a bare `@end_meta` line. Appends human-readable messages to `loadErrors` on any failure, matching MetaDocsLoader.LoadInObject's error strings. */
function loadInObject(objectType, url, objectData, loadErrors) {
    const obj = createMetaObjectForType(objectType);
    if (!obj) {
        loadErrors.push(`While processing ${url} found unknown meta type '${objectType}'.`);
        return undefined;
    }
    obj.sourceFile = url;
    let curKey = null;
    let curValue = null;
    const flush = () => {
        var _a;
        if (curKey === null || curValue === null) {
            return true;
        }
        const cleanKey = curKey.toLowerCase();
        const cleanValue = curValue.trim();
        if (!obj.applyValue(cleanKey, cleanValue)) {
            loadErrors.push(`While processing ${url} in object type '${objectType}' for '${obj.name}' could not apply key '${curKey}' with value '${curValue}'.`);
        }
        else {
            const existing = (_a = obj.rawValues.get(cleanKey)) !== null && _a !== void 0 ? _a : [];
            existing.push(cleanValue);
            obj.rawValues.set(cleanKey, existing);
        }
        return true;
    };
    for (const line of objectData) {
        if (line.startsWith('@')) {
            flush();
            curKey = null;
            curValue = null;
            const space = line.indexOf(' ');
            if (space === -1) {
                curKey = line.substring(1);
                if (curKey === 'end_meta') {
                    break;
                }
                continue;
            }
            curKey = line.substring(1, space);
            curValue = line.substring(space + 1);
        }
        else {
            curValue = (curValue !== null && curValue !== void 0 ? curValue : '') + '\n' + line;
        }
    }
    flush();
    return obj;
}
exports.loadInObject = loadInObject;
//# sourceMappingURL=metaObjectFactory.js.map