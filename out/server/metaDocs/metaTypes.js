"use strict";
/**
 * Meta documentation object model.
 * Ported from SharpDenizenTools/MetaObjects/*.cs and MetaHandlers/MetaDocs.cs.
 * Deliberately excludes PostCheck validation and BuildSearchables fuzzy-search
 * indexing (see Global Constraints in the Phase 1 plan) — those belong to
 * later phases that actually consume them.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptyMetaDocs = exports.MetaDataValue = exports.MetaExtension = exports.MetaGuidePage = exports.MetaObjectType = exports.MetaLanguage = exports.MetaAction = exports.MetaProperty = exports.MetaMechanism = exports.MetaEvent = exports.MetaTag = exports.MetaCommand = exports.MetaObject = exports.cleanTag = exports.META_TYPE_EXTENSION = exports.META_TYPE_GUIDEPAGE = exports.META_TYPE_PROPERTY = exports.META_TYPE_OBJECT = exports.META_TYPE_TAG = exports.META_TYPE_LANGUAGE = exports.META_TYPE_ACTION = exports.META_TYPE_EVENT = exports.META_TYPE_MECHANISM = exports.META_TYPE_COMMAND = void 0;
exports.META_TYPE_COMMAND = { name: 'Command', webPath: 'Commands' };
exports.META_TYPE_MECHANISM = { name: 'Mechanism', webPath: 'Mechanisms' };
exports.META_TYPE_EVENT = { name: 'Event', webPath: 'Events' };
exports.META_TYPE_ACTION = { name: 'Action', webPath: 'Actions' };
exports.META_TYPE_LANGUAGE = { name: 'Language', webPath: 'Languages' };
exports.META_TYPE_TAG = { name: 'Tag', webPath: 'Tags' };
exports.META_TYPE_OBJECT = { name: 'ObjectType', webPath: 'ObjectTypes' };
exports.META_TYPE_PROPERTY = { name: 'Property', webPath: 'Properties' };
exports.META_TYPE_GUIDEPAGE = { name: 'GuidePage', webPath: null };
exports.META_TYPE_EXTENSION = { name: 'Extension', webPath: null };
/** Strips tag structural symbols (`<`, `>`, and bracketed parameters) for searchable/clean comparison. */
function cleanTag(text) {
    let cleaned = '';
    let skipping = false;
    for (const c of text) {
        if (c === '<' || c === '>') {
            continue;
        }
        if (c === '[') {
            skipping = true;
            continue;
        }
        if (c === ']') {
            skipping = false;
            continue;
        }
        if (skipping) {
            continue;
        }
        cleaned += c;
    }
    return cleaned;
}
exports.cleanTag = cleanTag;
/** Strips structural symbols from an event name for a searchable "overly cleaned" form. Skips `(optional)` words entirely. */
function overCleanEvent(evt) {
    const parts = evt.toLowerCase().split(' ');
    const kept = [];
    for (const part of parts) {
        if (part.startsWith('(') && part.endsWith(')')) {
            continue;
        }
        kept.push(part.replace(/[<>'()]/g, ''));
    }
    return kept.join(' ').trim();
}
class MetaObject {
    constructor() {
        this.type = null;
        this.group = null;
        this.warnings = [];
        this.plugin = null;
        this.sourceFile = '';
        this.deprecated = null;
        this.synonyms = [];
        this.rawValues = new Map();
    }
    get cleanName() {
        return this.name.toLowerCase();
    }
    applyValue(key, value) {
        switch (key) {
            case 'group':
                this.group = value;
                return true;
            case 'warning':
                this.warnings.push(value);
                return true;
            case 'plugin':
                this.plugin = value;
                return true;
            case 'deprecated':
                this.deprecated = value;
                return true;
            case 'synonyms':
                this.synonyms.push(...value.split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0));
                return true;
            default:
                return false;
        }
    }
}
exports.MetaObject = MetaObject;
class MetaCommand extends MetaObject {
    constructor() {
        super(...arguments);
        this.commandName = '';
        this.required = 0;
        this.maximum = Number.MAX_SAFE_INTEGER;
        this.syntax = '';
        this.short = '';
        this.description = '';
        this.tags = [];
        this.usages = [];
        this.guide = '';
        /** Arguments written as `prefix:<value>`. Populated by `parseSyntax`. */
        this.argPrefixes = [];
        /** Literal keyword arguments with no tag input. Populated by `parseSyntax`. */
        this.flatArguments = [];
        /** Positional arguments that take dynamic input. Populated by `parseSyntax`. */
        this.linearArguments = [];
    }
    get name() {
        return this.commandName;
    }
    applyValue(key, value) {
        switch (key) {
            case 'name':
                this.commandName = value;
                return true;
            case 'required': {
                const n = parseInt(value, 10);
                if (isNaN(n)) {
                    return false;
                }
                this.required = n;
                return true;
            }
            case 'maximum': {
                const n = parseInt(value, 10);
                if (isNaN(n)) {
                    return false;
                }
                this.maximum = n === -1 ? Number.MAX_SAFE_INTEGER : n;
                return true;
            }
            case 'syntax':
                this.syntax = value;
                return true;
            case 'short':
                this.short = value;
                return true;
            case 'description':
                this.description = value;
                return true;
            case 'tags':
                this.tags = value.split('\n').filter(s => s.length > 0);
                return true;
            case 'usage':
                this.usages.push(value);
                return true;
            case 'guide':
                this.guide = value;
                return true;
            default:
                return super.applyValue(key, value);
        }
    }
    /**
     * Parses `syntax` into the three argument buckets used for completion.
     * Ported from SharpDenizenTools MetaCommand.ParseSyntax, with two deliberate
     * deviations: the C# original has a self-assignment bug on its LinearArguments
     * line (`LinearArguments = [.. LinearArguments]`), which this port fixes by
     * assigning the collected list; and a tag-valued prefix such as `[<a>:<b>]` is
     * recorded as a linear argument here rather than being dropped entirely.
     */
    parseSyntax() {
        this.argPrefixes = [];
        this.flatArguments = [];
        this.linearArguments = [];
        const firstSpace = this.syntax.indexOf(' ');
        if (firstSpace < 0) {
            return;
        }
        const cleaned = this.syntax.substring(firstSpace).replace(/\//g, ' ');
        for (const arg of cleaned.split(' ')) {
            const cleanedArg = arg.replace(/[[\](){}]/g, '');
            if (cleanedArg.trim().length === 0) {
                continue;
            }
            const colonIndex = cleanedArg.indexOf(':');
            if (colonIndex > 0) {
                const prefix = cleanedArg.substring(0, colonIndex);
                if (!prefix.includes('<')) {
                    this.argPrefixes.push({ clean: prefix, raw: arg });
                }
                else {
                    this.linearArguments.push(arg);
                }
            }
            else if (!cleanedArg.includes('<') && !cleanedArg.includes('|')) {
                this.flatArguments.push({ clean: cleanedArg, raw: arg });
            }
            else {
                this.linearArguments.push(arg);
            }
        }
    }
    addTo(docs) {
        this.parseSyntax();
        docs.commands.set(this.cleanName, this);
    }
}
exports.MetaCommand = MetaCommand;
class MetaTag extends MetaObject {
    constructor() {
        super(...arguments);
        this.tagFull = '';
        this.cleanedName = '';
        this.beforeDot = '';
        this.afterDotCleaned = '';
        this.returns = '';
        this.description = '';
        this.mechanism = '';
        this.examples = [];
    }
    get name() {
        return this.tagFull;
    }
    get cleanName() {
        return this.cleanedName;
    }
    applyValue(key, value) {
        switch (key) {
            case 'attribute': {
                this.tagFull = value;
                let cleaned = cleanTag(this.tagFull);
                if (cleaned.includes('.') && !cleaned.startsWith('&')) {
                    this.beforeDot = cleaned.substring(0, cleaned.indexOf('.'));
                }
                else {
                    this.beforeDot = 'Base';
                }
                cleaned = cleaned.toLowerCase();
                this.cleanedName = cleaned;
                const dotIndex = cleaned.indexOf('.');
                this.afterDotCleaned = dotIndex >= 0 ? cleaned.substring(dotIndex + 1) : '';
                return true;
            }
            case 'returns':
                this.returns = value;
                return true;
            case 'description':
                this.description = value;
                return true;
            case 'mechanism':
                this.mechanism = value;
                return true;
            case 'example':
                this.examples.push(value);
                return true;
            case 'exampleforreturns':
                return true;
            default:
                return super.applyValue(key, value);
        }
    }
    addTo(docs) {
        docs.tags.set(this.cleanName, this);
    }
}
exports.MetaTag = MetaTag;
class MetaEvent extends MetaObject {
    constructor() {
        super(...arguments);
        this.events = [];
        this.cleanEvents = [];
        this.overlyCleanedEvents = [];
        this.switches = [];
        this.switchNames = new Set();
        this.triggers = '';
        this.context = [];
        this.determinations = [];
        this.player = '';
        this.npc = '';
        this.cancellable = false;
        this.hasLocation = false;
        this.examples = [];
    }
    get name() {
        var _a;
        return (_a = this.events[0]) !== null && _a !== void 0 ? _a : '';
    }
    get cleanName() {
        var _a;
        return (_a = this.cleanEvents[0]) !== null && _a !== void 0 ? _a : '';
    }
    applyValue(key, value) {
        switch (key) {
            case 'events':
                this.events = value.split('\n').filter(s => s.length > 0);
                this.cleanEvents = this.events.map(s => s.toLowerCase().replace(/[<>'()]/g, ''));
                this.overlyCleanedEvents = this.events.map(overCleanEvent);
                return true;
            case 'triggers':
                this.triggers = value;
                return true;
            case 'player':
                this.player = value;
                return true;
            case 'npc':
                this.npc = value;
                return true;
            case 'switch':
                for (const switchLine of value.split('\n').filter(s => s.length > 0)) {
                    this.switches.push(switchLine);
                    const beforeSpace = switchLine.split(' ')[0];
                    const switchName = beforeSpace.split(':')[0].toLowerCase();
                    this.switchNames.add(switchName);
                }
                return true;
            case 'context':
                this.context = value.split('\n').filter(s => s.length > 0);
                return true;
            case 'determine':
                this.determinations = value.split('\n').filter(s => s.length > 0);
                return true;
            case 'cancellable':
                this.cancellable = value.trim().toLowerCase() === 'true';
                return true;
            case 'location':
                this.hasLocation = value.trim().toLowerCase() === 'true';
                return true;
            case 'example':
                this.examples.push(value);
                return true;
            case 'regex':
                return true;
            default:
                return super.applyValue(key, value);
        }
    }
    addTo(docs) {
        docs.events.set(this.cleanName, this);
    }
}
exports.MetaEvent = MetaEvent;
class MetaMechanism extends MetaObject {
    constructor() {
        super(...arguments);
        this.fullName = '';
        this.mechObject = '';
        this.mechName = '';
        this.input = '';
        this.description = '';
        this.tags = [];
        this.examples = [];
    }
    get name() {
        return this.fullName;
    }
    applyValue(key, value) {
        switch (key) {
            case 'object':
                this.mechObject = value;
                return true;
            case 'name':
                this.mechName = value;
                return true;
            case 'input':
                this.input = value;
                return true;
            case 'description':
                this.description = value;
                return true;
            case 'tags':
                this.tags = value.split('\n').filter(s => s.length > 0);
                return true;
            case 'example':
                this.examples.push(value);
                return true;
            default:
                return super.applyValue(key, value);
        }
    }
    addTo(docs) {
        this.fullName = `${this.mechObject}.${this.mechName}`;
        docs.mechanisms.set(this.cleanName, this);
    }
}
exports.MetaMechanism = MetaMechanism;
class MetaProperty extends MetaObject {
    constructor() {
        super(...arguments);
        this.fullName = '';
        this.propObject = '';
        this.propName = '';
        this.input = '';
        this.description = '';
        this.mechanismDescription = '';
        this.tagDescription = '';
        this.tagExamples = [];
        this.mechanismExamples = [];
    }
    get name() {
        return this.fullName;
    }
    applyValue(key, value) {
        switch (key) {
            case 'object':
                this.propObject = value;
                return true;
            case 'name':
                this.propName = value;
                return true;
            case 'input':
                this.input = value;
                return true;
            case 'description':
                this.description = value;
                return true;
            case 'example':
                this.tagExamples.push(value);
                this.mechanismExamples.push(value);
                return true;
            case 'tag-example':
                this.tagExamples.push(value);
                return true;
            case 'mechanism-example':
                this.mechanismExamples.push(value);
                return true;
            case 'tag':
                this.tagDescription = '\n' + value;
                return true;
            case 'mechanism':
                this.mechanismDescription = '\n' + value;
                return true;
            default:
                return super.applyValue(key, value);
        }
    }
    addTo(docs) {
        var _a, _b;
        this.fullName = `${this.propObject}.${this.propName}`;
        docs.properties.set(this.cleanName, this);
        const asTag = `<${this.fullName}>`;
        const cleanedTag = cleanTag(asTag);
        const hasControls = this.description.startsWith('Controls');
        const cleanedDescription = hasControls ? this.description.substring('Controls'.length) : this.description;
        const mech = new MetaMechanism();
        mech.type = exports.META_TYPE_MECHANISM;
        mech.mechName = this.propName;
        mech.mechObject = this.propObject;
        mech.input = this.input;
        mech.description = '(Property) ' + (hasControls ? 'Sets' : '') + cleanedDescription + this.mechanismDescription;
        mech.group = (_a = this.group) !== null && _a !== void 0 ? _a : 'Properties';
        mech.warnings = this.warnings;
        mech.examples = this.mechanismExamples;
        mech.plugin = this.plugin;
        mech.sourceFile = this.sourceFile;
        mech.deprecated = this.deprecated;
        mech.synonyms = this.synonyms;
        mech.tags = [asTag];
        mech.addTo(docs);
        const tag = new MetaTag();
        tag.type = exports.META_TYPE_TAG;
        tag.tagFull = asTag;
        tag.cleanedName = cleanedTag.toLowerCase();
        tag.beforeDot = cleanedTag.includes('.') ? cleanedTag.substring(0, cleanedTag.indexOf('.')) : 'Base';
        const cleanedTagLower = cleanedTag.toLowerCase();
        const dotIdx = cleanedTagLower.indexOf('.');
        tag.afterDotCleaned = dotIdx >= 0 ? cleanedTagLower.substring(dotIdx + 1) : '';
        tag.returns = this.input;
        tag.description = '(Property) ' + (hasControls ? 'Returns' : '') + cleanedDescription + this.tagDescription;
        tag.mechanism = this.fullName;
        tag.examples = this.tagExamples;
        tag.group = (_b = this.group) !== null && _b !== void 0 ? _b : 'Properties';
        tag.warnings = this.warnings;
        tag.plugin = this.plugin;
        tag.sourceFile = this.sourceFile;
        tag.deprecated = this.deprecated;
        tag.synonyms = this.synonyms;
        tag.addTo(docs);
    }
}
exports.MetaProperty = MetaProperty;
class MetaAction extends MetaObject {
    constructor() {
        super(...arguments);
        this.actions = [];
        this.cleanActions = [];
        this.triggers = '';
        this.context = [];
        this.determinations = [];
    }
    get name() {
        var _a;
        return (_a = this.actions[0]) !== null && _a !== void 0 ? _a : '';
    }
    get cleanName() {
        var _a;
        return (_a = this.cleanActions[0]) !== null && _a !== void 0 ? _a : '';
    }
    applyValue(key, value) {
        switch (key) {
            case 'actions':
                this.actions = value.split('\n').filter(s => s.length > 0);
                this.cleanActions = this.actions.map(s => s.toLowerCase());
                return true;
            case 'triggers':
                this.triggers = value;
                return true;
            case 'context':
                this.context = value.split('\n').filter(s => s.length > 0);
                return true;
            case 'determine':
                this.determinations = value.split('\n').filter(s => s.length > 0);
                return true;
            default:
                return super.applyValue(key, value);
        }
    }
    addTo(docs) {
        docs.actions.set(this.cleanName, this);
    }
}
exports.MetaAction = MetaAction;
class MetaLanguage extends MetaObject {
    constructor() {
        super(...arguments);
        this.langName = '';
        this.description = '';
    }
    get name() {
        return this.langName;
    }
    applyValue(key, value) {
        switch (key) {
            case 'name':
                this.langName = value;
                return true;
            case 'description':
                this.description = value;
                return true;
            default:
                return super.applyValue(key, value);
        }
    }
    addTo(docs) {
        docs.languages.set(this.cleanName, this);
    }
}
exports.MetaLanguage = MetaLanguage;
class MetaObjectType extends MetaObject {
    constructor() {
        super(...arguments);
        this.typeName = '';
        this.prefix = '';
        this.baseTypeName = '';
        this.format = '';
        this.description = '';
        this.implementsNames = [];
        this.generatedExampleTagBase = null;
        this.generatedExampleAdjust = null;
        this.exampleValues = [];
        this.matchable = null;
    }
    get name() {
        return this.typeName;
    }
    get cleanName() {
        return this.typeName.toLowerCase();
    }
    applyValue(key, value) {
        switch (key) {
            case 'name':
                this.typeName = value;
                return true;
            case 'prefix':
                this.prefix = value.toLowerCase();
                return true;
            case 'base':
                this.baseTypeName = value;
                return true;
            case 'format':
                this.format = value;
                return true;
            case 'description':
                this.description = value;
                return true;
            case 'implements':
                this.implementsNames = value.replace(/ /g, '').split(',');
                return true;
            case 'exampletagbase':
                this.generatedExampleTagBase = value;
                if (this.generatedExampleAdjust === null) {
                    this.generatedExampleAdjust = `<${this.generatedExampleTagBase}>`;
                }
                return true;
            case 'exampleadjustobject':
                this.generatedExampleAdjust = value;
                return true;
            case 'examplevalues':
                this.exampleValues = value.replace(/ /g, '').split(',');
                return true;
            case 'matchable':
                this.matchable = value;
                return true;
            case 'exampleforreturns':
                return true;
            default:
                return super.applyValue(key, value);
        }
    }
    addTo(docs) {
        docs.objectTypes.set(this.cleanName, this);
    }
}
exports.MetaObjectType = MetaObjectType;
class MetaGuidePage extends MetaObject {
    constructor() {
        super(...arguments);
        this.pageName = '';
        this.url = '';
        this.isSubPage = false;
    }
    get name() {
        return this.pageName;
    }
    addTo(docs) {
        docs.guidePages.set(this.cleanName, this);
    }
}
exports.MetaGuidePage = MetaGuidePage;
class MetaExtension extends MetaObject {
    constructor() {
        super(...arguments);
        this.extensionName = '';
        this.extendType = '';
        this.extendName = '';
        this.includeExisting = true;
    }
    get name() {
        return this.extensionName;
    }
    applyValue(key, value) {
        switch (key) {
            case 'target_type':
                this.extendType = value;
                return true;
            case 'target_name':
                this.extendName = value;
                return true;
            case 'name':
                this.extensionName = value;
                return true;
            case 'include_existing':
                this.includeExisting = value.trim().toLowerCase() === 'true';
                return true;
            default:
                return true;
        }
    }
    addTo(docs) {
        docs.extensions.set(this.cleanName, this);
    }
}
exports.MetaExtension = MetaExtension;
class MetaDataValue extends MetaObject {
    constructor() {
        super(...arguments);
        this.dataKeyName = '';
        this.values = [];
    }
    get name() {
        return this.dataKeyName;
    }
    applyValue(key, value) {
        switch (key) {
            case 'name':
                this.dataKeyName = value.toLowerCase();
                return true;
            case 'values':
                this.values = value.split(',').map(s => s.trim().toLowerCase());
                return true;
            default:
                return super.applyValue(key, value);
        }
    }
    addTo(_docs) {
        // Phase 1 does not implement ExtraData/DataValueSets consumption
        // (event-argument matching against Minecraft blocks/items/entities) —
        // this class exists only so '<--[data]' blocks parse without error.
    }
}
exports.MetaDataValue = MetaDataValue;
function createEmptyMetaDocs() {
    return {
        commands: new Map(),
        mechanisms: new Map(),
        tags: new Map(),
        objectTypes: new Map(),
        properties: new Map(),
        events: new Map(),
        actions: new Map(),
        languages: new Map(),
        guidePages: new Map(),
        extensions: new Map(),
        loadErrors: []
    };
}
exports.createEmptyMetaDocs = createEmptyMetaDocs;
//# sourceMappingURL=metaTypes.js.map