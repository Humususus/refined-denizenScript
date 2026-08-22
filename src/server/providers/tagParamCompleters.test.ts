import { describe, it, expect } from 'vitest';
import { normaliseDocParam, completeTagParam, ParamCandidate, TAG_PARAM_COMPLETERS } from './tagParamCompleters';
import { buildExtraData, parseFlatFds, ExtraData } from '../metaDocs/extraData';
import { createEmptyMetaDocs, MetaDocs, MetaMechanism, MetaTag } from '../metaDocs/metaTypes';

const DATA: ExtraData = buildExtraData(parseFlatFds([
    'blocks:', '- STONE',
    'items:', '- STICK',
    'entities:', '- ZOMBIE',
    'potion_effects:', '- SPEED',
    'biomes:', '- PLAINS',
    'statistics:', '- JUMP',
    'enchantments:', '- SHARPNESS',
    ''
].join('\n')));

function mech(object: string, name: string): MetaMechanism {
    const m = new MetaMechanism();
    m.mechObject = object;
    m.mechName = name;
    m.fullName = `${object}.${name}`;
    return m;
}

function docsWithMechs(): MetaDocs {
    const docs = createEmptyMetaDocs();
    for (const m of [mech('EntityTag', 'max_health'), mech('ItemTag', 'material'), mech('EntityTag', 'name')]) {
        docs.mechanisms.set(m.fullName.toLowerCase(), m);
    }
    return docs;
}

const DOCS: MetaDocs = docsWithMechs();
const TAG: MetaTag = new MetaTag();

function labels(candidates: ParamCandidate[]): string[] {
    return candidates.map(c => c.label);
}

function complete(docParam: string, typed: string): ParamCandidate[] {
    return completeTagParam(DOCS, DATA, docParam, typed, TAG);
}

describe('normaliseDocParam', () => {
    // CommandTabCompletions.cs:140 is
    //   .Replace('(', ')').Replace('{', ')').Replace('}', ')').Replace(")", "").Replace("|...", "")
    // which maps '(', '{' and '}' onto ')' and then deletes every ')', i.e. it deletes
    // all four bracket characters, and separately deletes the literal "|...".
    it('strips the parentheses that mark an optional parameter', () => {
        expect(normaliseDocParam('(<duration>)')).toBe('<duration>');
    });

    it('strips a trailing |... list marker', () => {
        expect(normaliseDocParam('<material>|...')).toBe('<material>');
    });

    it('strips curly braces', () => {
        expect(normaliseDocParam('{<map>}')).toBe('<map>');
    });

    it('leaves ;... intact, because only |... is deleted', () => {
        // Corroborated by CommandTabCompletions.cs:93, which registers the ByTag key
        // "<mechanism>=<value>;..." verbatim: that registration would be unreachable
        // if normalisation shortened the spec.
        expect(normaliseDocParam('<mechanism>=<value>;...')).toBe('<mechanism>=<value>;...');
    });

    it('leaves a bare | that is not followed by ... intact', () => {
        expect(normaliseDocParam('<material>|<item>')).toBe('<material>|<item>');
    });

    it('deletes unbalanced brackets too, since the C# deletes characters rather than pairs', () => {
        expect(normaliseDocParam('((a)')).toBe('a');
    });
});

describe('completeTagParam: slash options (CommandTabCompletions.cs:174-200)', () => {
    it('offers every option when nothing is typed, bolding the selected one (:187)', () => {
        expect(complete('true/false', '')).toEqual([
            { label: 'true', detail: '**true** / false', kind: 'property' },
            { label: 'false', detail: 'true / **false**', kind: 'property' }
        ]);
    });

    it('filters options by what has been typed (:185)', () => {
        expect(complete('true/false', 't')).toEqual([
            { label: 'true', detail: '**true** / false', kind: 'property' }
        ]);
    });

    it('unwraps a single-level <...> wrapper (:176-179)', () => {
        expect(labels(complete('<blocks/entities>', ''))).toEqual(['blocks', 'entities']);
    });

    it('does not unwrap when the inside contains another < (:176)', () => {
        // '<entity>/<material>' starts with '<' and ends with '>', but the inner text
        // 'entity>/<material' contains '<', so the wrapper is kept and the split yields
        // the two enum placeholders rather than a mangled 'entity>' / '<material'.
        expect(labels(complete('<entity>/<material>', ''))).toEqual(['zombie', 'stone', 'stick']);
    });

    it('expands the <entity> option into the entity enum (:190-193)', () => {
        expect(complete('<entity>/here', '')).toEqual([
            { label: 'zombie', detail: '**Entity Type**: zombie', kind: 'enum' },
            { label: 'here', detail: '<entity> / **here**', kind: 'property' }
        ]);
    });

    it('expands the <material> option into the material enum (:194-197)', () => {
        expect(complete('<material>/here', 'st')).toEqual([
            { label: 'stone', detail: '**Material**: stone', kind: 'enum' },
            { label: 'stick', detail: '**Material**: stick', kind: 'enum' }
        ]);
    });

    it('drops a <placeholder> option that is neither <entity> nor <material> (:183-198)', () => {
        expect(labels(complete('<duration>/now', ''))).toEqual(['now']);
    });

    it('normalises before dispatching, so an optional slash spec still resolves (:140 then :174)', () => {
        expect(labels(complete('(true/false)', ''))).toEqual(['true', 'false']);
    });
});

describe('completeTagParam: ByTag table (CommandTabCompletions.cs:80-95, :141-144)', () => {
    it('completes <material> from the material enum, filtered by the typed prefix', () => {
        expect(complete('<material>', 'st')).toEqual([
            { label: 'stone', detail: '**Material**: stone', kind: 'enum' },
            { label: 'stick', detail: '**Material**: stick', kind: 'enum' }
        ]);
        expect(labels(complete('<material>', 'sto'))).toEqual(['stone']);
    });

    it('normalises before the ByTag lookup, so an optional <material> still hits (:140 then :141)', () => {
        expect(labels(complete('(<material>)', ''))).toEqual(['stone', 'stick']);
    });

    it('maps each registered enum spec to the right ExtraData set', () => {
        expect(labels(complete('<item>', ''))).toEqual(['stick']);
        expect(labels(complete('<entity_type>', ''))).toEqual(['zombie']);
        // ByTag's <effect> is Data.PotionEffects (:86), NOT the particle 'effects' set
        // that the playeffect command uses (:57).
        expect(labels(complete('<effect>', ''))).toEqual(['speed']);
        expect(labels(complete('<biome>', ''))).toEqual(['plains']);
        expect(labels(complete('<statistic>', ''))).toEqual(['jump']);
        expect(labels(complete('<enchantment>', ''))).toEqual(['sharpness']);
    });

    it('labels the enum in the detail, per CompleteEnum (:206)', () => {
        expect(complete('<biome>', '')).toEqual([{ label: 'plains', detail: '**Biome**: plains', kind: 'enum' }]);
        // :245 uses "Enchantment Key", not "Enchantment".
        expect(complete('<enchantment>', '')).toEqual([{ label: 'sharpness', detail: '**Enchantment Key**: sharpness', kind: 'enum' }]);
    });

    it('registers exactly the servable ByTag specs', () => {
        expect([...TAG_PARAM_COMPLETERS.keys()].sort()).toEqual([
            '<biome>',
            '<effect>',
            '<enchantment>',
            '<entity_type>',
            '<item>',
            '<material>',
            '<mechanism>=<value>',
            '<mechanism>=<value>;...',
            '<property-map>',
            '<property-name>',
            '<statistic>'
        ]);
    });

    it('returns nothing for the deliberately unported ByTag specs', () => {
        // <script>, <procedure_script_name> and <format_script> need SuggestScriptByType
        // (workspace tracking, Phase 2D); <inventory> needs ExtraData.InventoryMatchers,
        // which this port's ExtraData does not expose; <custom_color_name> needs
        // ClientConfiguration.TextColorMap, which is not ported.
        for (const spec of ['<script>', '<procedure_script_name>', '<format_script>', '<inventory>', '<custom_color_name>']) {
            expect(complete(spec, '')).toEqual([]);
        }
    });
});

describe('completeTagParam: mechanism-backed ByTag specs', () => {
    it('completes <property-name> from the mechanism names, with no suffix (:91, :209-212)', () => {
        expect(labels(complete('<property-name>', 'ma'))).toEqual(['max_health', 'material']);
    });

    it('describes a mechanism candidate by its object and name (:368)', () => {
        expect(complete('<property-name>', 'max')).toEqual([
            { label: 'max_health', detail: '**EntityTag Mechanism**: max_health', kind: 'property' }
        ]);
    });

    it('completes <mechanism>=<value> with an = suffix (:92, :214-224)', () => {
        expect(labels(complete('<mechanism>=<value>', 'ma'))).toEqual(['max_health=', 'material=']);
    });

    it('offers nothing for <mechanism>=<value> once an = has been typed (:216-219)', () => {
        expect(complete('<mechanism>=<value>', 'material=')).toEqual([]);
    });

    it('completes <mechanism>=<value>;... after the last ; (:93, :226-229)', () => {
        expect(labels(complete('<mechanism>=<value>;...', 'name=bob;ma'))).toEqual(['max_health=', 'material=']);
    });

    it('completes <property-map> the same way as the ;-separated mechanism set (:94)', () => {
        expect(labels(complete('<property-map>', 'ma'))).toEqual(['max_health=', 'material=']);
    });

    it('checks ByTag before the ; branch, so <mechanism>=<value>;... reaches the table (:141 before :145)', () => {
        // If the ';' branch ran first, docPairs would be ['<mechanism>=<value>', '...'],
        // '...' has no '=', so .All(...) fails, the '/' branch finds no '/', and the
        // result would be empty. A non-empty result proves the ByTag lookup came first.
        expect(complete('<mechanism>=<value>;...', '').length).toBeGreaterThan(0);
    });
});

describe('completeTagParam: ;-separated key/value pairs (CommandTabCompletions.cs:145-173)', () => {
    it('offers every documented key when nothing is typed (:162-170)', () => {
        expect(complete('a=<x>;b=<y>', '')).toEqual([
            { label: 'a', detail: '**a**=`<x>`', kind: 'property' },
            { label: 'b', detail: '**b**=`<y>`', kind: 'property' }
        ]);
    });

    it('excludes keys that have already been given (:162-166)', () => {
        expect(labels(complete('a=<x>;b=<y>', 'a=1;'))).toEqual(['b']);
    });

    it('filters remaining keys by the partial key typed after the last ; (:166)', () => {
        expect(labels(complete('alpha=<x>;beta=<y>', 'b'))).toEqual(['beta']);
    });

    it('recurses into the matched key\'s value spec (:152-159)', () => {
        expect(complete('size=true/false;name=<x>', 'size=')).toEqual([
            { label: 'true', detail: 'size=**true** / false', kind: 'property' },
            { label: 'false', detail: 'size=true / **false**', kind: 'property' }
        ]);
    });

    it('offers nothing when the typed key is not documented (:155-160)', () => {
        expect(complete('size=true/false;name=<x>', 'colour=')).toEqual([]);
    });

    it('checks the ; branch before the / branch (:145 before :174)', () => {
        // 'size=true/false;name=<x>' contains both ';' and '/'. Taking the '/' branch
        // first would split on '/' and offer the literal options 'size=true' and
        // 'false;name=<x>'.
        expect(labels(complete('size=true/false;name=<x>', ''))).toEqual(['size', 'name']);
    });

    it('falls through to the / branch when not every ;-part has an = (:148)', () => {
        // 'a/b;c' contains ';' but 'c' has no '=', so the pair branch declines and the
        // '/' branch splits the whole spec on '/'.
        expect(labels(complete('a/b;c', ''))).toEqual(['a', 'b;c']);
    });

    it('offers nothing when a ;-spec has neither usable pairs nor options', () => {
        expect(complete('a;b', '')).toEqual([]);
    });
});

describe('completeTagParam: unknown specs', () => {
    it('returns an empty array rather than throwing', () => {
        expect(complete('<some_unknown_thing>', '')).toEqual([]);
        expect(complete('', '')).toEqual([]);
    });
});

// The `kind` discriminator exists so the caller can pick the RIGHT CompletionItemKind
// per source, which the label/detail pair alone cannot express. C# picks it at each
// construction site and the three sites do not agree:
//   CompleteEnum (:206)          -> CompletionItemKind.Enum
//   SuggestMechanisms (:211)     -> CompletionItemKind.Property
//   CompleteForTagPiece (:134)   -> CompletionItemKind.Property
// This module stays free of `vscode-languageserver` imports (its compiled output must
// keep having zero require() calls), so the discriminator is a plain string union and
// the mapping to a real CompletionItemKind lives in completionProvider.ts.
describe('completeTagParam: candidate kind discriminator', () => {
    it('marks enum-sourced candidates "enum" (CompleteEnum, :206)', () => {
        expect(complete('<material>', 'sto').map(c => c.kind)).toEqual(['enum']);
        expect(complete('<biome>', '').map(c => c.kind)).toEqual(['enum']);
        // The two inline enum expansions inside the '/' branch (:190-197) go through the
        // same CompleteEnum, so they are "enum" even though their siblings are not.
        expect(complete('<entity>/here', '').map(c => c.kind)).toEqual(['enum', 'property']);
    });

    it('marks mechanism-sourced candidates "property" (SuggestMechanisms, :211)', () => {
        expect(complete('<property-name>', 'ma').map(c => c.kind)).toEqual(['property', 'property']);
        expect(complete('<mechanism>=<value>', 'ma').map(c => c.kind)).toEqual(['property', 'property']);
        expect(complete('<property-map>', 'ma').map(c => c.kind)).toEqual(['property', 'property']);
    });

    it('marks option and key candidates "property" (CompleteForTagPiece, :134)', () => {
        expect(complete('true/false', '').map(c => c.kind)).toEqual(['property', 'property']);
        expect(complete('a=<x>;b=<y>', '').map(c => c.kind)).toEqual(['property', 'property']);
        expect(complete('size=true/false;name=<x>', 'size=').map(c => c.kind)).toEqual(['property', 'property']);
    });
});
