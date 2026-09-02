import { describe, it, expect } from 'vitest';
import { normaliseDocParam, completeTagParam, ParamCandidate, TAG_PARAM_COMPLETERS, parseTextColorMap, setCustomColorNames } from './tagParamCompleters';
import { ScriptingWorkspaceData, ScriptContainerData } from '../checker/containerConvert';
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
            { label: 'true', detail: '**true** / false', kind: 'tagPiece' },
            { label: 'false', detail: 'true / **false**', kind: 'tagPiece' }
        ]);
    });

    it('filters options by what has been typed (:185)', () => {
        expect(complete('true/false', 't')).toEqual([
            { label: 'true', detail: '**true** / false', kind: 'tagPiece' }
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
            { label: 'here', detail: '<entity> / **here**', kind: 'tagPiece' }
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

    it('registers EVERY ByTag spec, with none left unported', () => {
        // Grew by four in Phase 2D: the three script-container specs and <inventory>, all of
        // which needed the workspace index that did not exist before it. `<custom_color_name>`
        // joined 2026-09-03 and was the last one outstanding, so this list is now the whole of
        // CommandTabCompletions.cs:80-95.
        expect([...TAG_PARAM_COMPLETERS.keys()].sort()).toEqual([
            '<biome>',
            '<custom_color_name>',
            '<effect>',
            '<enchantment>',
            '<entity_type>',
            '<format_script>',
            '<inventory>',
            '<item>',
            '<material>',
            '<mechanism>=<value>',
            '<mechanism>=<value>;...',
            '<procedure_script_name>',
            '<property-map>',
            '<property-name>',
            '<script>',
            '<statistic>'
        ]);
    });

    it('offers the inventory labels without needing a workspace', () => {
        // SuggestInventoryType (:231-239) is enum + scripts, and the enum half is
        // INVENTORY_MATCHERS -- a hardcoded constant, so it answers with no workspace at all.
        // MUTANT CAUGHT: leaving <inventory> unregistered, or backing it with an ExtraData set.
        const labelsFor = labels(complete('<inventory>', 'ender'));
        expect(labelsFor.sort()).toEqual(['ender_chest', 'enderchest']);
    });

    it('offers nothing for the script specs when there is no workspace', () => {
        // The null-workspace guard, which is what makes these safe to register before the first
        // scan finishes. MUTANT CAUGHT: dropping the guard in suggestScriptByType.
        for (const spec of ['<script>', '<procedure_script_name>', '<format_script>']) {
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
            { label: 'max_health', detail: '**EntityTag Mechanism**: max_health', kind: 'mechanism' }
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
            { label: 'a', detail: '**a**=`<x>`', kind: 'tagPiece' },
            { label: 'b', detail: '**b**=`<y>`', kind: 'tagPiece' }
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
            { label: 'true', detail: 'size=**true** / false', kind: 'tagPiece' },
            { label: 'false', detail: 'size=true / **false**', kind: 'tagPiece' }
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

// The `kind` discriminator names the C# CONSTRUCTION SITE, which the label/detail pair
// alone cannot express. The caller needs it twice: to pick the right CompletionItemKind,
// and to decide whether `detail` is the whole documentation or the "input option" line
// to wrap in CompleteForTagPiece's tag envelope (:133).
//   CompleteEnum (:206)          -> 'enum'      -> Enum,     detail is the whole markup
//   SuggestMechanisms (:211)     -> 'mechanism' -> Property, detail is the whole markup
//   CompleteForTagPiece (:134)   -> 'tagPiece'  -> Property, detail goes inside the envelope
// This module stays free of `vscode-languageserver` imports (its compiled output must
// keep having zero require() calls), so the discriminator is a plain string union and
// the mapping to a real CompletionItemKind lives in completionProvider.ts.
describe('completeTagParam: candidate kind discriminator', () => {
    it('marks enum-sourced candidates "enum" (CompleteEnum, :206)', () => {
        expect(complete('<material>', 'sto').map(c => c.kind)).toEqual(['enum']);
        expect(complete('<biome>', '').map(c => c.kind)).toEqual(['enum']);
        // The two inline enum expansions inside the '/' branch (:190-197) go through the
        // same CompleteEnum, so they are "enum" even though their siblings are not.
        expect(complete('<entity>/here', '').map(c => c.kind)).toEqual(['enum', 'tagPiece']);
    });

    it('marks mechanism-sourced candidates "mechanism" (SuggestMechanisms, :211)', () => {
        expect(complete('<property-name>', 'ma').map(c => c.kind)).toEqual(['mechanism', 'mechanism']);
        expect(complete('<mechanism>=<value>', 'ma').map(c => c.kind)).toEqual(['mechanism', 'mechanism']);
        expect(complete('<property-map>', 'ma').map(c => c.kind)).toEqual(['mechanism', 'mechanism']);
    });

    it('marks option and key candidates "tagPiece" (CompleteForTagPiece, :134)', () => {
        expect(complete('true/false', '').map(c => c.kind)).toEqual(['tagPiece', 'tagPiece']);
        expect(complete('a=<x>;b=<y>', '').map(c => c.kind)).toEqual(['tagPiece', 'tagPiece']);
        expect(complete('size=true/false;name=<x>', 'size=').map(c => c.kind)).toEqual(['tagPiece', 'tagPiece']);
    });

    // The two Property-kinded sites must NOT be merged back into one name. They map onto
    // the same CompletionItemKind but are documented completely differently: only
    // CompleteForTagPiece's candidates get the tag envelope (:133), which is why the
    // discriminator names the SITE rather than the LSP kind.
    it('keeps mechanism and tagPiece distinct even though both are Property in C#', () => {
        expect(complete('<property-name>', 'ma')[0].kind).toBe('mechanism');
        expect(complete('true/false', '')[0].kind).toBe('tagPiece');
        expect(complete('<property-name>', 'ma')[0].kind)
            .not.toBe(complete('true/false', '')[0].kind);
    });
});

describe('completeTagParam: workspace script containers (SuggestScriptByType, :271-279)', () => {
    /** A workspace holding one container per named type. */
    function workspaceOf(...entries: [string, string][]): ScriptingWorkspaceData {
        const data = new ScriptingWorkspaceData();
        for (const [name, type] of entries) {
            const container = new ScriptContainerData();
            container.name = name;
            container.type = type;
            data.scripts.set(name, container);
        }
        return data;
    }

    const WORKSPACE = workspaceOf(
        ['my_proc', 'procedure'],
        ['my_other_proc', 'procedure'],
        ['my_task', 'task'],
        ['my_item', 'item'],
        ['my_book', 'book'],
        ['my_format', 'format'],
        ['my_inventory', 'inventory'],
        ['my_entity', 'entity'],
        ['my_enchantment', 'enchantment'],
        ['_private_task', 'task']
    );

    function completeWith(docParam: string, typed: string, workspace = WORKSPACE): ParamCandidate[] {
        return completeTagParam(DOCS, DATA, docParam, typed, TAG, workspace);
    }

    it('offers every container type for <script>', () => {
        // :82 registers <script> with a null type, meaning any container at all.
        // MUTANT CAUGHT: passing a concrete type instead of null.
        expect(labels(completeWith('<script>', 'my_')).sort())
            .toEqual(['my_book', 'my_enchantment', 'my_entity', 'my_format', 'my_inventory', 'my_item', 'my_other_proc', 'my_proc', 'my_task']);
    });

    it('offers only procedures for <procedure_script_name>', () => {
        // MUTANT CAUGHT: dropping the type filter, which would offer every container.
        expect(labels(completeWith('<procedure_script_name>', '')).sort()).toEqual(['my_other_proc', 'my_proc']);
    });

    it('offers only format scripts for <format_script>', () => {
        expect(labels(completeWith('<format_script>', ''))).toEqual(['my_format']);
    });

    it('filters by the typed prefix', () => {
        expect(labels(completeWith('<procedure_script_name>', 'my_o'))).toEqual(['my_other_proc']);
    });

    it('hides a leading-underscore name until the underscore is typed', () => {
        // :278's `arg.StartsWith('_') || !s.Name.StartsWith('_')`. A `_`-prefixed script is
        // private by convention, so it stays out of the list until asked for by name.
        // MUTANT CAUGHT: dropping the underscore rule either way round.
        expect(labels(completeWith('<script>', ''))).not.toContain('_private_task');
        expect(labels(completeWith('<script>', '_'))).toEqual(['_private_task']);
    });

    it('adds scripts to the enum for <item>, from BOTH the item and book types', () => {
        // SuggestItem (:261-267) concatenates the item enum with TWO script lookups. The book
        // half is the easy one to lose.
        // MUTANT CAUGHT: dropping either script type, or replacing the enum instead of adding.
        const found = labels(completeWith('<item>', ''));
        expect(found).toContain('stick');
        expect(found).toContain('my_item');
        expect(found).toContain('my_book');
    });

    it('adds scripts to the enum for <entity_type> and <enchantment>', () => {
        expect(labels(completeWith('<entity_type>', ''))).toEqual(['zombie', 'my_entity']);
        expect(labels(completeWith('<enchantment>', ''))).toEqual(['sharpness', 'my_enchantment']);
    });

    it('adds scripts to the hardcoded label list for <inventory>', () => {
        const found = labels(completeWith('<inventory>', 'my_'));
        expect(found).toEqual(['my_inventory']);
        // And the labels are still there alongside.
        expect(labels(completeWith('<inventory>', 'chest'))).toEqual(['chest']);
    });

    it('marks script candidates with their own kind and carries the container', () => {
        // The caller needs both: the kind picks CompletionItemKind.Method, and the container is
        // what `describeScript` renders. MUTANT CAUGHT: reusing the 'enum' kind, or dropping the
        // container and leaving the caller to look the name up again.
        const [candidate] = completeWith('<format_script>', '');
        expect(candidate.kind).toBe('script');
        expect(candidate.script).toBeDefined();
        expect(candidate.script!.name).toBe('my_format');
    });

    it('offers no scripts when the workspace is empty, but keeps the enum half', () => {
        const empty = new ScriptingWorkspaceData();
        expect(labels(completeWith('<script>', '', empty))).toEqual([]);
        expect(labels(completeWith('<item>', '', empty))).toEqual(['stick']);
    });
});

/**
 * `<custom_color_name>` -- the last registered spec this port left unserved.
 *
 * C# reads the names from `ClientConfiguration.TextColorMap` (CommandTabCompletions.cs:95). This
 * port has no ambient client configuration, so `server.ts` reads the setting and pushes the names
 * in. Two real tags use the spec: `<&[<custom_color_name>]>` and
 * `<ElementTag.custom_color[<custom_color_name>]>`, both verified against the live meta.
 */
describe('parseTextColorMap', () => {
    it('reads the names out of the setting the client already uses', () => {
        // The shipped default, verbatim from package.json.
        expect(parseTextColorMap('base=#00AA00,emphasis=#55FFFF,error=#FF5555,warning=#FFFF55,item=#FFAA00,lore=#AAAAAA,npc=#55FF55,default=#FFFFFF'))
            .toEqual(['base', 'emphasis', 'error', 'warning', 'item', 'lore', 'npc', 'default']);
    });

    it('lowercases and trims, since the tag is matched case-insensitively', () => {
        expect(parseTextColorMap(' Base =#00AA00, EMPHASIS=#55FFFF')).toEqual(['base', 'emphasis']);
    });

    it('skips a malformed entry without losing the rest', () => {
        // One typo in a long list should cost that one colour, not all of them.
        // MUTANT CAUGHT: rejecting the whole setting when any entry is bad.
        expect(parseTextColorMap('base=#00AA00,broken,error=#FF5555')).toEqual(['base', 'error']);
    });

    it('drops a duplicate name rather than offering it twice', () => {
        expect(parseTextColorMap('base=#111111,base=#222222')).toEqual(['base']);
    });

    it('handles an unset or empty setting', () => {
        expect(parseTextColorMap(undefined)).toEqual([]);
        expect(parseTextColorMap(null)).toEqual([]);
        expect(parseTextColorMap('')).toEqual([]);
    });
});

describe('<custom_color_name> completion', () => {
    it('offers nothing before the setting has arrived', () => {
        // The server pushes the names in asynchronously. Until then this must be silent rather
        // than inventing Denizen's defaults, which the user may well have replaced.
        setCustomColorNames([]);
        expect(complete('<custom_color_name>', '')).toEqual([]);
    });

    it('offers the configured names, filtered by what is typed', () => {
        setCustomColorNames(['base', 'emphasis', 'error']);
        expect(labels(complete('<custom_color_name>', ''))).toEqual(['base', 'emphasis', 'error']);
        expect(labels(complete('<custom_color_name>', 'e'))).toEqual(['emphasis', 'error']);
        expect(labels(complete('<custom_color_name>', 'em'))).toEqual(['emphasis']);
        expect(labels(complete('<custom_color_name>', 'zz'))).toEqual([]);
    });

    it('marks them as enum candidates, like every other configured value set', () => {
        setCustomColorNames(['base']);
        const [candidate] = complete('<custom_color_name>', '');
        expect(candidate.kind).toBe('enum');
        expect(candidate.detail).toContain('base');
    });

    it('is registered under the exact spec the meta writes', () => {
        // `<&[<custom_color_name>]>` parses its parameter to this literal string; a near-miss key
        // would leave the spec unserved exactly as it was before.
        // MUTANT CAUGHT: registering a differently-spelled key.
        expect(TAG_PARAM_COMPLETERS.has('<custom_color_name>')).toBe(true);
    });
});
