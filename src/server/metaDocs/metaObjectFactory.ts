/**
 * Turns a raw meta block (object type name + `@key value` comment lines,
 * see metaLoader.ts) into a populated MetaObject instance. Ported from
 * SharpDenizenTools/MetaHandlers/MetaDocsLoader.cs's LoadInObject, plus the
 * MetaTypesData registry concept from MetaDocs.cs's constructor.
 */

import {
    MetaObject, MetaCommand, MetaTag, MetaEvent, MetaMechanism, MetaProperty,
    MetaAction, MetaLanguage, MetaObjectType, MetaGuidePage, MetaExtension, MetaDataValue,
    META_TYPE_COMMAND, META_TYPE_TAG, META_TYPE_EVENT, META_TYPE_MECHANISM, META_TYPE_PROPERTY,
    META_TYPE_ACTION, META_TYPE_LANGUAGE, META_TYPE_OBJECT, META_TYPE_GUIDEPAGE, META_TYPE_EXTENSION
} from './metaTypes';

const TYPE_FACTORIES: Record<string, () => MetaObject> = {
    command: () => Object.assign(new MetaCommand(), { type: META_TYPE_COMMAND }),
    tag: () => Object.assign(new MetaTag(), { type: META_TYPE_TAG }),
    event: () => Object.assign(new MetaEvent(), { type: META_TYPE_EVENT }),
    mechanism: () => Object.assign(new MetaMechanism(), { type: META_TYPE_MECHANISM }),
    property: () => Object.assign(new MetaProperty(), { type: META_TYPE_PROPERTY }),
    action: () => Object.assign(new MetaAction(), { type: META_TYPE_ACTION }),
    language: () => Object.assign(new MetaLanguage(), { type: META_TYPE_LANGUAGE }),
    objecttype: () => Object.assign(new MetaObjectType(), { type: META_TYPE_OBJECT }),
    guidepage: () => Object.assign(new MetaGuidePage(), { type: META_TYPE_GUIDEPAGE }),
    extension: () => Object.assign(new MetaExtension(), { type: META_TYPE_EXTENSION }),
    data: () => new MetaDataValue()
};

/** Creates a new, empty MetaObject subclass instance for the given meta type name (case-insensitive), or undefined if the type name isn't recognized. */
export function createMetaObjectForType(objectType: string): MetaObject | undefined {
    const factory = TYPE_FACTORIES[objectType.toLowerCase()];
    return factory ? factory() : undefined;
}

/** Parses `@key value` lines (with non-`@` lines treated as continuations of the previous value, joined with `\n`) and applies them to a freshly created MetaObject. Stops at a bare `@end_meta` line. Appends human-readable messages to `loadErrors` on any failure, matching MetaDocsLoader.LoadInObject's error strings. */
export function loadInObject(objectType: string, url: string, objectData: string[], loadErrors: string[]): MetaObject | undefined {
    const obj = createMetaObjectForType(objectType);
    if (!obj) {
        loadErrors.push(`While processing ${url} found unknown meta type '${objectType}'.`);
        return undefined;
    }
    obj.sourceFile = url;
    let curKey: string | null = null;
    let curValue: string | null = null;
    const flush = (): boolean => {
        if (curKey === null || curValue === null) {
            return true;
        }
        const cleanKey = curKey.toLowerCase();
        const cleanValue = curValue.trim();
        if (!obj.applyValue(cleanKey, cleanValue)) {
            loadErrors.push(`While processing ${url} in object type '${objectType}' for '${obj.name}' could not apply key '${curKey}' with value '${curValue}'.`);
        }
        else {
            const existing = obj.rawValues.get(cleanKey) ?? [];
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
            curValue = (curValue ?? '') + '\n' + line;
        }
    }
    flush();
    return obj;
}
