/**
 * Meta documentation object model.
 * Ported from SharpDenizenTools/MetaObjects/*.cs and MetaHandlers/MetaDocs.cs.
 * Deliberately excludes PostCheck validation and BuildSearchables fuzzy-search
 * indexing (see Global Constraints in the Phase 1 plan) — those belong to
 * later phases that actually consume them.
 */

// Type-only import: MetaTag.parsedFormat needs the SingleTag shape to declare
// its field type, but this is erased at compile time and creates no runtime
// dependency — the model layer stays free of providers/ at runtime. The
// parseTag() *call* that populates this field belongs in metaLinker.ts, not
// here; see that file's header for why.
import type { SingleTag } from '../providers/tagHelper';

export interface MetaType {
    name: string;
    webPath: string | null;
}

export const META_TYPE_COMMAND: MetaType = { name: 'Command', webPath: 'Commands' };
export const META_TYPE_MECHANISM: MetaType = { name: 'Mechanism', webPath: 'Mechanisms' };
export const META_TYPE_EVENT: MetaType = { name: 'Event', webPath: 'Events' };
export const META_TYPE_ACTION: MetaType = { name: 'Action', webPath: 'Actions' };
export const META_TYPE_LANGUAGE: MetaType = { name: 'Language', webPath: 'Languages' };
export const META_TYPE_TAG: MetaType = { name: 'Tag', webPath: 'Tags' };
export const META_TYPE_OBJECT: MetaType = { name: 'ObjectType', webPath: 'ObjectTypes' };
export const META_TYPE_PROPERTY: MetaType = { name: 'Property', webPath: 'Properties' };
export const META_TYPE_GUIDEPAGE: MetaType = { name: 'GuidePage', webPath: null };
export const META_TYPE_EXTENSION: MetaType = { name: 'Extension', webPath: null };

/** Strips tag structural symbols (`<`, `>`, and bracketed parameters) for searchable/clean comparison. */
export function cleanTag(text: string): string {
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

/** Strips structural symbols from an event name for a searchable "overly cleaned" form. Skips `(optional)` words entirely. */
function overCleanEvent(evt: string): string {
    const parts = evt.toLowerCase().split(' ');
    const kept: string[] = [];
    for (const part of parts) {
        if (part.startsWith('(') && part.endsWith(')')) {
            continue;
        }
        kept.push(part.replace(/[<>'()]/g, ''));
    }
    return kept.join(' ').trim();
}

export abstract class MetaObject {
    type: MetaType | null = null;
    group: string | null = null;
    warnings: string[] = [];
    plugin: string | null = null;
    sourceFile: string = '';
    deprecated: string | null = null;
    synonyms: string[] = [];
    rawValues: Map<string, string[]> = new Map();

    abstract get name(): string;

    get cleanName(): string {
        return this.name.toLowerCase();
    }

    applyValue(key: string, value: string): boolean {
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

    abstract addTo(docs: MetaDocs): void;
}

/** One argument as it appears in a command's `@Syntax` line, in both bare and original form. */
export interface CommandArgumentForm {
    /** The argument name stripped of `[]`, `()`, and `{}` — e.g. `format` for `(format:<name>)`. */
    clean: string;
    /** The original syntax text, e.g. `(format:<name>)`. Used as completion detail text. */
    raw: string;
}

export class MetaCommand extends MetaObject {
    commandName: string = '';
    required: number = 0;
    maximum: number = Number.MAX_SAFE_INTEGER;
    syntax: string = '';
    short: string = '';
    description: string = '';
    tags: string[] = [];
    usages: string[] = [];
    guide: string = '';
    /** Arguments written as `prefix:<value>`. Populated by `parseSyntax`. */
    argPrefixes: CommandArgumentForm[] = [];
    /** Literal keyword arguments with no tag input. Populated by `parseSyntax`. */
    flatArguments: CommandArgumentForm[] = [];
    /** Positional arguments that take dynamic input. Populated by `parseSyntax`. */
    linearArguments: string[] = [];

    get name(): string {
        return this.commandName;
    }

    applyValue(key: string, value: string): boolean {
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
    parseSyntax(): void {
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

    addTo(docs: MetaDocs): void {
        this.parseSyntax();
        docs.commands.set(this.cleanName, this);
    }
}

export class MetaTag extends MetaObject {
    tagFull: string = '';
    cleanedName: string = '';
    beforeDot: string = '';
    afterDotCleaned: string = '';
    returns: string = '';
    description: string = '';
    mechanism: string = '';
    examples: string[] = [];
    /** Resolved from `returns` by linkTypeGraph, keyed on the text before any '(' (MetaTag.cs:86-87, 174). Null if `returns` does not name a known object type. */
    returnType: MetaObjectType | null = null;
    /** Resolved from `beforeDot` by linkTypeGraph (MetaTag.cs:89-90, 179). Null if `beforeDot` does not name a known object type. */
    baseType: MetaObjectType | null = null;
    /** The parsed tag syntax, set by linkTypeGraph (MetaTag.cs:107-108, 151). Null only before linking has run. */
    parsedFormat: SingleTag | null = null;
    /** Whether the tag's first relevant part accepts a bracketed parameter (MetaTag.cs:95-96, 153). */
    allowsParam: boolean = false;
    /** Whether that parameter is required rather than optional (MetaTag.cs:98-99, 154). */
    requiresParam: boolean = false;

    get name(): string {
        return this.tagFull;
    }

    get cleanName(): string {
        return this.cleanedName;
    }

    applyValue(key: string, value: string): boolean {
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

    addTo(docs: MetaDocs): void {
        docs.tags.set(this.cleanName, this);
        // Ported from MetaTag.cs:20-34. The clean name's first dot-separated
        // bit is the "base" (e.g. "playertag"); everything after (already
        // computed as afterDotCleaned) is split into individual "parts"
        // (e.g. "flag", "expiration"). Guard against an empty/unparsed
        // cleanedName (missing or malformed @Attribute) adding a poisoning
        // '' entry to either set.
        //
        // Deliberate divergence from C#: `otherBits.Split('.')` yields [""]
        // when the clean name has no dot (MetaTag.cs:24-27), so C#'s
        // TagParts contains an empty string for every dotless tag. This
        // port excludes it on purpose — an empty candidate would match
        // every completion prefix. tagParts.size will therefore never equal
        // C#'s TagParts.Count; the two are not comparable by count.
        const dotIndex = this.cleanedName.indexOf('.');
        const base = dotIndex >= 0 ? this.cleanedName.substring(0, dotIndex) : this.cleanedName;
        if (base.length > 0) {
            docs.tagBases.add(base);
        }
        for (const bit of this.afterDotCleaned.split('.')) {
            if (bit.length > 0) {
                docs.tagParts.add(bit);
            }
        }
        if (this.deprecated && this.deprecated.trim().length > 0) {
            for (const bit of this.cleanedName.split('.')) {
                if (bit.length > 0) {
                    docs.tagDeprecations.set(bit, this.deprecated);
                }
            }
        }
    }
}

export class MetaEvent extends MetaObject {
    events: string[] = [];
    cleanEvents: string[] = [];
    overlyCleanedEvents: string[] = [];
    switches: string[] = [];
    switchNames: Set<string> = new Set();
    triggers: string = '';
    context: string[] = [];
    determinations: string[] = [];
    player: string = '';
    npc: string = '';
    cancellable: boolean = false;
    hasLocation: boolean = false;
    examples: string[] = [];

    get name(): string {
        return this.events[0] ?? '';
    }

    get cleanName(): string {
        return this.cleanEvents[0] ?? '';
    }

    applyValue(key: string, value: string): boolean {
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

    addTo(docs: MetaDocs): void {
        docs.events.set(this.cleanName, this);
    }
}

export class MetaMechanism extends MetaObject {
    fullName: string = '';
    mechObject: string = '';
    mechName: string = '';
    input: string = '';
    description: string = '';
    tags: string[] = [];
    examples: string[] = [];

    get name(): string {
        return this.fullName;
    }

    applyValue(key: string, value: string): boolean {
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

    addTo(docs: MetaDocs): void {
        this.fullName = `${this.mechObject}.${this.mechName}`;
        docs.mechanisms.set(this.cleanName, this);
    }
}

export class MetaProperty extends MetaObject {
    fullName: string = '';
    propObject: string = '';
    propName: string = '';
    input: string = '';
    description: string = '';
    mechanismDescription: string = '';
    tagDescription: string = '';
    tagExamples: string[] = [];
    mechanismExamples: string[] = [];

    get name(): string {
        return this.fullName;
    }

    applyValue(key: string, value: string): boolean {
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

    addTo(docs: MetaDocs): void {
        this.fullName = `${this.propObject}.${this.propName}`;
        docs.properties.set(this.cleanName, this);
        const asTag = `<${this.fullName}>`;
        const cleanedTag = cleanTag(asTag);
        const hasControls = this.description.startsWith('Controls');
        const cleanedDescription = hasControls ? this.description.substring('Controls'.length) : this.description;

        const mech = new MetaMechanism();
        mech.type = META_TYPE_MECHANISM;
        mech.mechName = this.propName;
        mech.mechObject = this.propObject;
        mech.input = this.input;
        mech.description = '(Property) ' + (hasControls ? 'Sets' : '') + cleanedDescription + this.mechanismDescription;
        mech.group = this.group ?? 'Properties';
        mech.warnings = this.warnings;
        mech.examples = this.mechanismExamples;
        mech.plugin = this.plugin;
        mech.sourceFile = this.sourceFile;
        mech.deprecated = this.deprecated;
        mech.synonyms = this.synonyms;
        mech.tags = [asTag];
        mech.addTo(docs);

        const tag = new MetaTag();
        tag.type = META_TYPE_TAG;
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
        tag.group = this.group ?? 'Properties';
        tag.warnings = this.warnings;
        tag.plugin = this.plugin;
        tag.sourceFile = this.sourceFile;
        tag.deprecated = this.deprecated;
        tag.synonyms = this.synonyms;
        tag.addTo(docs);
    }
}

export class MetaAction extends MetaObject {
    actions: string[] = [];
    cleanActions: string[] = [];
    triggers: string = '';
    context: string[] = [];
    determinations: string[] = [];

    get name(): string {
        return this.actions[0] ?? '';
    }

    get cleanName(): string {
        return this.cleanActions[0] ?? '';
    }

    applyValue(key: string, value: string): boolean {
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

    addTo(docs: MetaDocs): void {
        docs.actions.set(this.cleanName, this);
    }
}

export class MetaLanguage extends MetaObject {
    langName: string = '';
    description: string = '';

    get name(): string {
        return this.langName;
    }

    applyValue(key: string, value: string): boolean {
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

    addTo(docs: MetaDocs): void {
        docs.languages.set(this.cleanName, this);
    }
}

export class MetaObjectType extends MetaObject {
    typeName: string = '';
    prefix: string = '';
    baseTypeName: string = '';
    format: string = '';
    description: string = '';
    implementsNames: string[] = [];
    generatedExampleTagBase: string | null = null;
    generatedExampleAdjust: string | null = null;
    exampleValues: string[] = [];
    matchable: string | null = null;
    /** Resolved from baseTypeName by linkTypeGraph. Null for a root type (`@base none`) or an unresolvable name. */
    baseType: MetaObjectType | null = null;
    /** Resolved from implementsNames by linkTypeGraph. Named implementsTypes, not implements, because `implements` is a reserved word in strict-mode TS. */
    implementsTypes: MetaObjectType[] = [];
    /** Reverse index: every type naming this one as its base or in its implements list (MetaObjectType.cs:63). */
    extendedBy: MetaObjectType[] = [];
    /** This type's own tags, keyed by afterDotCleaned — not counting base/implements (MetaObjectType.cs:57). */
    subTags: Map<string, MetaTag> = new Map();

    get name(): string {
        return this.typeName;
    }

    get cleanName(): string {
        return this.typeName.toLowerCase();
    }

    applyValue(key: string, value: string): boolean {
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

    addTo(docs: MetaDocs): void {
        docs.objectTypes.set(this.cleanName, this);
    }
}

export class MetaGuidePage extends MetaObject {
    pageName: string = '';
    url: string = '';
    isSubPage: boolean = false;

    get name(): string {
        return this.pageName;
    }

    addTo(docs: MetaDocs): void {
        docs.guidePages.set(this.cleanName, this);
    }
}

export class MetaExtension extends MetaObject {
    extensionName: string = '';
    extendType: string = '';
    extendName: string = '';
    includeExisting: boolean = true;

    get name(): string {
        return this.extensionName;
    }

    applyValue(key: string, value: string): boolean {
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

    addTo(docs: MetaDocs): void {
        docs.extensions.set(this.cleanName, this);
    }
}

export class MetaDataValue extends MetaObject {
    dataKeyName: string = '';
    values: string[] = [];

    get name(): string {
        return this.dataKeyName;
    }

    applyValue(key: string, value: string): boolean {
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

    addTo(_docs: MetaDocs): void {
        // Phase 1 does not implement ExtraData/DataValueSets consumption
        // (event-argument matching against Minecraft blocks/items/entities) —
        // this class exists only so '<--[data]' blocks parse without error.
    }
}

export interface MetaDocs {
    commands: Map<string, MetaCommand>;
    mechanisms: Map<string, MetaMechanism>;
    tags: Map<string, MetaTag>;
    objectTypes: Map<string, MetaObjectType>;
    properties: Map<string, MetaProperty>;
    events: Map<string, MetaEvent>;
    actions: Map<string, MetaAction>;
    languages: Map<string, MetaLanguage>;
    guidePages: Map<string, MetaGuidePage>;
    extensions: Map<string, MetaExtension>;
    loadErrors: string[];
    /**
     * Every known tag "base": the clean-name text before a tag's first dot
     * (e.g. "playertag" for `<PlayerTag.name>`). Seeded with "context" and
     * "entry", which are valid tag bases with no dedicated MetaTag entry
     * (MetaDocs.cs:79). Used to offer completions for the first part of a tag.
     */
    tagBases: Set<string>;
    /**
     * Every known tag "part": each dot-separated bit of a tag's clean name
     * after its base (e.g. "flag", "expiration" for `<PlayerTag.flag.expiration>`).
     * Used to offer completions after the first dot in a tag.
     */
    tagParts: Set<string>;
    /**
     * Maps each dot-separated bit of a deprecated tag's clean name to that
     * tag's deprecation message, so completion can surface a warning for any
     * bit of a deprecated tag.
     */
    tagDeprecations: Map<string, string>;
    /** The ObjectTag root type, set by linkTypeGraph (MetaObjectType.cs:25-32). */
    objectTagType: MetaObjectType | null;
    /** The ElementTag root type, set by linkTypeGraph (MetaObjectType.cs:25-32). */
    elementTagType: MetaObjectType | null;
}

export function createEmptyMetaDocs(): MetaDocs {
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
        loadErrors: [],
        // Seeded per MetaDocs.cs:79.
        tagBases: new Set(['context', 'entry']),
        tagParts: new Set(),
        tagDeprecations: new Map(),
        objectTagType: null,
        elementTagType: null
    };
}
