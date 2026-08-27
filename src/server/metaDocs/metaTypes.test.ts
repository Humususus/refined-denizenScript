import { describe, it, expect } from 'vitest';
import { MetaCommand, MetaTag, MetaEvent, MetaMechanism, MetaProperty, MetaAction, MetaLanguage, MetaObjectType, MetaDocs, MetaDataValue, createEmptyMetaDocs, cleanTag, isInDataValueSet } from './metaTypes';

describe('createEmptyMetaDocs', () => {
    it('creates empty maps for every meta type', () => {
        const docs = createEmptyMetaDocs();
        expect(docs.commands.size).toBe(0);
        expect(docs.tags.size).toBe(0);
        expect(docs.events.size).toBe(0);
        expect(docs.mechanisms.size).toBe(0);
        expect(docs.properties.size).toBe(0);
        expect(docs.actions.size).toBe(0);
        expect(docs.languages.size).toBe(0);
        expect(docs.objectTypes.size).toBe(0);
        expect(docs.guidePages.size).toBe(0);
        expect(docs.extensions.size).toBe(0);
        expect(docs.loadErrors).toEqual([]);
    });
});

describe('MetaObject base applyValue', () => {
    it('applies group, warning, plugin, deprecated, synonyms', () => {
        const cmd = new MetaCommand();
        expect(cmd.applyValue('group', 'Player')).toBe(true);
        expect(cmd.group).toBe('Player');
        expect(cmd.applyValue('warning', 'be careful')).toBe(true);
        expect(cmd.warnings).toEqual(['be careful']);
        expect(cmd.applyValue('plugin', 'Denizen')).toBe(true);
        expect(cmd.plugin).toBe('Denizen');
        expect(cmd.applyValue('deprecated', 'use foo instead')).toBe(true);
        expect(cmd.deprecated).toBe('use foo instead');
        expect(cmd.applyValue('synonyms', 'alias1, Alias2 ,alias3')).toBe(true);
        expect(cmd.synonyms).toEqual(['alias1', 'alias2', 'alias3']);
    });

    it('rejects unknown keys by returning false', () => {
        const cmd = new MetaCommand();
        expect(cmd.applyValue('not_a_real_key', 'x')).toBe(false);
    });
});

describe('MetaCommand', () => {
    it('parses name, required, maximum, syntax, short, description, tags, usage, guide', () => {
        const cmd = new MetaCommand();
        cmd.applyValue('name', 'narrate');
        cmd.applyValue('required', '1');
        cmd.applyValue('maximum', '3');
        cmd.applyValue('syntax', 'narrate [<text>] (targets:<player>|...)');
        cmd.applyValue('short', 'Sends a message.');
        cmd.applyValue('description', 'Narrates text to the target(s).');
        cmd.applyValue('tags', '<player.name>\n<npc.name>');
        cmd.applyValue('usage', 'narrate "Hello world"');
        cmd.applyValue('guide', 'https://guide.denizenscript.com/x');
        expect(cmd.name).toBe('narrate');
        expect(cmd.cleanName).toBe('narrate');
        expect(cmd.required).toBe(1);
        expect(cmd.maximum).toBe(3);
        expect(cmd.tags).toEqual(['<player.name>', '<npc.name>']);
        expect(cmd.usages).toEqual(['narrate "Hello world"']);
        expect(cmd.guide).toBe('https://guide.denizenscript.com/x');
    });

    it('treats maximum -1 as unlimited', () => {
        const cmd = new MetaCommand();
        cmd.applyValue('maximum', '-1');
        expect(cmd.maximum).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('registers itself into docs.commands by clean name on addTo', () => {
        const docs = createEmptyMetaDocs();
        const cmd = new MetaCommand();
        cmd.applyValue('name', 'Narrate');
        cmd.addTo(docs);
        expect(docs.commands.get('narrate')).toBe(cmd);
    });
});

describe('cleanTag', () => {
    it('strips angle brackets and bracketed parameters', () => {
        expect(cleanTag('<player.flag[my_flag].value>')).toBe('player.flag.value');
        expect(cleanTag('<npc.name>')).toBe('npc.name');
    });
});

describe('MetaTag', () => {
    it('parses attribute into cleanedName/beforeDot/afterDotCleaned', () => {
        const tag = new MetaTag();
        tag.applyValue('attribute', '<PlayerTag.name>');
        tag.applyValue('returns', 'ElementTag');
        tag.applyValue('description', 'Returns the name.');
        expect(tag.name).toBe('<PlayerTag.name>');
        expect(tag.cleanName).toBe('playertag.name');
        expect(tag.beforeDot).toBe('PlayerTag');
        expect(tag.afterDotCleaned).toBe('name');
        expect(tag.returns).toBe('ElementTag');
    });

    it('defaults beforeDot to Base when there is no dot', () => {
        const tag = new MetaTag();
        tag.applyValue('attribute', '<player>');
        expect(tag.beforeDot).toBe('Base');
    });

    it('registers into docs.tags on addTo', () => {
        const docs = createEmptyMetaDocs();
        const tag = new MetaTag();
        tag.applyValue('attribute', '<PlayerTag.name>');
        tag.addTo(docs);
        expect(docs.tags.get('playertag.name')).toBe(tag);
    });
});

describe('MetaEvent', () => {
    it('parses events into events/cleanEvents/overlyCleanedEvents and tracks switches', () => {
        const evt = new MetaEvent();
        evt.applyValue('events', 'player breaks <block>\nplayer breaks block');
        evt.applyValue('triggers', 'when a player breaks a block');
        evt.applyValue('switch', 'material:<material> the block material\ncancelled:<boolean> whether the event is cancelled');
        evt.applyValue('cancellable', 'true');
        expect(evt.events).toEqual(['player breaks <block>', 'player breaks block']);
        expect(evt.name).toBe('player breaks <block>');
        expect(evt.cleanEvents.length).toBe(2);
        expect(evt.switchNames.has('material')).toBe(true);
        expect(evt.switchNames.has('cancelled')).toBe(true);
        expect(evt.cancellable).toBe(true);
    });

    it('registers into docs.events by first clean event name', () => {
        const docs = createEmptyMetaDocs();
        const evt = new MetaEvent();
        evt.applyValue('events', 'player breaks block');
        evt.applyValue('triggers', 'x');
        evt.addTo(docs);
        expect(docs.events.get('player breaks block')).toBe(evt);
    });
});

describe('MetaMechanism', () => {
    it('builds fullName from object + name on addTo', () => {
        const docs = createEmptyMetaDocs();
        const mech = new MetaMechanism();
        mech.applyValue('object', 'PlayerTag');
        mech.applyValue('name', 'money');
        mech.applyValue('input', 'ElementTag(Decimal)');
        mech.applyValue('description', 'Sets the player money.');
        mech.addTo(docs);
        expect(mech.fullName).toBe('PlayerTag.money');
        expect(docs.mechanisms.get('playertag.money')).toBe(mech);
    });
});

describe('MetaProperty', () => {
    it('generates a synthetic MetaMechanism and MetaTag on addTo', () => {
        const docs = createEmptyMetaDocs();
        const prop = new MetaProperty();
        prop.applyValue('object', 'ItemTag');
        prop.applyValue('name', 'display');
        prop.applyValue('input', 'ElementTag');
        prop.applyValue('description', 'Controls the display name.');
        prop.addTo(docs);
        expect(docs.mechanisms.get('itemtag.display')).toBeDefined();
        expect(docs.properties.get('itemtag.display')).toBe(prop);
        const generatedTag = [...docs.tags.values()].find(t => t.cleanName === 'itemtag.display');
        expect(generatedTag).toBeDefined();
        expect(generatedTag!.returns).toBe('ElementTag');
    });
});

describe('MetaAction', () => {
    it('parses actions list', () => {
        const action = new MetaAction();
        action.applyValue('actions', 'wins game\nloses game');
        expect(action.actions).toEqual(['wins game', 'loses game']);
        expect(action.cleanActions).toEqual(['wins game', 'loses game']);
    });
});

describe('MetaLanguage', () => {
    it('parses name and description', () => {
        const lang = new MetaLanguage();
        lang.applyValue('name', 'Player Flags');
        lang.applyValue('description', 'Explains player flags.');
        expect(lang.name).toBe('Player Flags');
        expect(lang.description).toBe('Explains player flags.');
    });
});

describe('MetaObjectType', () => {
    it('parses core object type fields', () => {
        const type = new MetaObjectType();
        type.applyValue('name', 'PlayerTag');
        type.applyValue('prefix', 'player');
        type.applyValue('base', 'EntityTag');
        type.applyValue('format', 'player@<uuid>');
        type.applyValue('description', 'Represents a player.');
        type.applyValue('implements', 'FlaggableObject, Adjustable');
        expect(type.typeName).toBe('PlayerTag');
        expect(type.prefix).toBe('player');
        expect(type.implementsNames).toEqual(['FlaggableObject', 'Adjustable']);
    });
});

describe('MetaCommand.parseSyntax', () => {
    it('splits a realistic syntax line into prefixed, flat, and linear arguments', () => {
        const cmd = new MetaCommand();
        cmd.syntax = 'narrate [<text>] (targets:<player>|...) (format:<name>) (per_player)';
        cmd.parseSyntax();
        expect(cmd.argPrefixes.map(a => a.clean)).toEqual(['targets', 'format']);
        expect(cmd.flatArguments.map(a => a.clean)).toEqual(['per_player']);
        expect(cmd.linearArguments).toEqual(['[<text>]']);
    });

    it('keeps the original bracketed text as the raw form', () => {
        const cmd = new MetaCommand();
        cmd.syntax = 'narrate [<text>] (format:<name>)';
        cmd.parseSyntax();
        expect(cmd.argPrefixes[0].raw).toBe('(format:<name>)');
    });

    it('treats a slash as an argument separator', () => {
        const cmd = new MetaCommand();
        cmd.syntax = 'inject [<script>] (path:<name>) (instantly/local)';
        cmd.parseSyntax();
        expect(cmd.flatArguments.map(a => a.clean)).toEqual(['instantly', 'local']);
    });

    it('does not treat a tag-valued prefix as a prefix', () => {
        const cmd = new MetaCommand();
        cmd.syntax = 'test [<a>:<b>]';
        cmd.parseSyntax();
        expect(cmd.argPrefixes).toEqual([]);
        expect(cmd.linearArguments).toEqual(['[<a>:<b>]']);
    });

    it('produces empty results for a syntax line with no arguments', () => {
        const cmd = new MetaCommand();
        cmd.syntax = 'stop';
        cmd.parseSyntax();
        expect(cmd.argPrefixes).toEqual([]);
        expect(cmd.flatArguments).toEqual([]);
        expect(cmd.linearArguments).toEqual([]);
    });

    it('is invoked automatically by addTo', () => {
        const docs = createEmptyMetaDocs();
        const cmd = new MetaCommand();
        cmd.commandName = 'narrate';
        cmd.syntax = 'narrate [<text>] (format:<name>)';
        cmd.addTo(docs);
        expect(docs.commands.get('narrate')!.argPrefixes.map(a => a.clean)).toEqual(['format']);
    });
});

describe('tag lookup sets', () => {
    function tagDocs(...attributes: string[]): MetaDocs {
        const docs = createEmptyMetaDocs();
        for (const attribute of attributes) {
            const tag = new MetaTag();
            tag.applyValue('attribute', attribute);
            tag.addTo(docs);
        }
        return docs;
    }

    it('seeds the bases with context and entry before any tag loads', () => {
        const docs = createEmptyMetaDocs();
        expect(docs.tagBases.has('context')).toBe(true);
        expect(docs.tagBases.has('entry')).toBe(true);
    });

    it('records the text before the first dot as a base', () => {
        const docs = tagDocs('<PlayerTag.name>');
        expect(docs.tagBases.has('playertag')).toBe(true);
    });

    it('records every dot-separated bit after the base as a part', () => {
        const docs = tagDocs('<PlayerTag.flag[<name>].expiration>');
        expect(docs.tagParts.has('flag')).toBe(true);
        expect(docs.tagParts.has('expiration')).toBe(true);
    });

    it('does not record the base itself as a part', () => {
        const docs = tagDocs('<PlayerTag.name>');
        expect(docs.tagParts.has('playertag')).toBe(false);
    });

    it('maps every bit of a deprecated tag to its message', () => {
        const docs = createEmptyMetaDocs();
        const tag = new MetaTag();
        tag.applyValue('attribute', '<PlayerTag.old_thing>');
        tag.applyValue('deprecated', 'Use the new thing.');
        tag.addTo(docs);
        expect(docs.tagDeprecations.get('old_thing')).toBe('Use the new thing.');
        expect(docs.tagDeprecations.get('playertag')).toBe('Use the new thing.');
    });

    it('records nothing in deprecations for a healthy tag', () => {
        expect(tagDocs('<PlayerTag.name>').tagDeprecations.size).toBe(0);
    });

    it('does not poison the sets with an empty-string entry when the clean name is empty', () => {
        const docs = createEmptyMetaDocs();
        const tag = new MetaTag();
        // No applyValue('attribute', ...) call — simulates a missing/unparseable @Attribute line.
        tag.addTo(docs);
        expect(docs.tagBases.has('')).toBe(false);
        expect(docs.tagParts.has('')).toBe(false);
    });
});

describe('MetaDataValue and the data value sets (MetaDocs.cs:97, MetaDataValue.cs:24-38)', () => {
    function value(name: string, values: string): MetaDataValue {
        const data = new MetaDataValue();
        data.applyValue('name', name);
        data.applyValue('values', values);
        return data;
    }

    it('lowercases and trims each value, splitting on commas', () => {
        // MetaDataValue.cs:38: `value.Split(',').Select(s => s.Trim().ToLowerFast())`.
        expect(value('not_switches', ' Regex , Item_Flagged ,mythic_mob').values)
            .toEqual(['regex', 'item_flagged', 'mythic_mob']);
    });

    it('lowercases the key name too', () => {
        expect(value('NOT_SWITCHES', 'regex').dataKeyName).toBe('not_switches');
    });

    it('folds ASCII only, in both the name and the values', () => {
        // MUTANT CAUGHT: toLowerFast -> toLowerCase. These are the folds that decide whether a
        // lookup finds anything at all, and a Unicode fold would rewrite non-English entries.
        const data = value('КЛЮЧ', 'ЗНАЧЕНИЕ, ASCII_VALUE');
        expect(data.dataKeyName).toBe('КЛЮЧ');
        expect(data.values).toEqual(['ЗНАЧЕНИЕ', 'ascii_value']);
    });

    it('files its values into the named set on addTo', () => {
        const docs = createEmptyMetaDocs();
        value('not_switches', 'regex,item_flagged').addTo(docs);
        expect([...docs.dataValueSets.get('not_switches')!].sort()).toEqual(['item_flagged', 'regex']);
    });

    it('UNIONS with an existing set rather than replacing it', () => {
        // MetaDataValue.cs:26 is GetOrCreate(...).UnionWith(...). Several <--[data] blocks may
        // share a key name, and each contributes.
        // MUTANT CAUGHT: `docs.dataValueSets.set(name, new Set(values))`, which would leave only
        // whichever block happened to load last.
        const docs = createEmptyMetaDocs();
        value('not_switches', 'regex').addTo(docs);
        value('not_switches', 'item_flagged').addTo(docs);
        expect([...docs.dataValueSets.get('not_switches')!].sort()).toEqual(['item_flagged', 'regex']);
    });

    it('starts empty on a fresh docs object', () => {
        expect(createEmptyMetaDocs().dataValueSets.size).toBe(0);
    });
});

describe('isInDataValueSet (MetaDocs.cs:134-137)', () => {
    function docsWith(name: string, values: string): MetaDocs {
        const docs = createEmptyMetaDocs();
        const data = new MetaDataValue();
        data.applyValue('name', name);
        data.applyValue('values', values);
        data.addTo(docs);
        return docs;
    }

    it('finds a value that is in the named set', () => {
        expect(isInDataValueSet(docsWith('not_switches', 'regex,item_flagged'), 'not_switches', 'regex')).toBe(true);
    });

    it('answers false for a value not in the set', () => {
        expect(isInDataValueSet(docsWith('not_switches', 'regex'), 'not_switches', 'chance')).toBe(false);
    });

    it('answers false for a set that does not exist at all', () => {
        // The cold-start case: meta has not loaded, so every set is absent. Callers must read this
        // as "no special case applies", never as "checking is off".
        // MUTANT CAUGHT: `?? true`, or throwing on a missing set.
        expect(isInDataValueSet(createEmptyMetaDocs(), 'not_switches', 'regex')).toBe(false);
    });

    it('does not confuse the set name with a value', () => {
        // MUTANT CAUGHT: swapping the two parameters.
        const docs = docsWith('not_switches', 'regex');
        expect(isInDataValueSet(docs, 'regex', 'not_switches')).toBe(false);
    });
});

describe('MetaEvent.isValidSwitch (MetaEvent.cs:93-120)', () => {
    function event(apply: (e: MetaEvent) => void = () => {}): MetaEvent {
        const evt = new MetaEvent();
        evt.applyValue('events', 'player does thing');
        apply(evt);
        return evt;
    }

    function docsWithGlobals(...values: string[]): MetaDocs {
        const docs = createEmptyMetaDocs();
        const data = new MetaDataValue();
        data.applyValue('name', 'global_switches');
        data.applyValue('values', values.join(','));
        data.addTo(docs);
        return docs;
    }

    it('accepts a switch the event documents itself', () => {
        const evt = event(e => e.applyValue('switch', 'my_switch:value to do a thing'));
        expect(evt.isValidSwitch(createEmptyMetaDocs(), 'my_switch')).toBe(true);
    });

    it('rejects an unknown switch', () => {
        expect(event().isValidSwitch(createEmptyMetaDocs(), 'nonsense')).toBe(false);
    });

    it('ties flagged and permission to having a linked PLAYER', () => {
        // MUTANT CAUGHT: checking npc, or dropping either name.
        expect(event().isValidSwitch(createEmptyMetaDocs(), 'flagged')).toBe(false);
        expect(event().isValidSwitch(createEmptyMetaDocs(), 'permission')).toBe(false);
        const withPlayer = event(e => e.applyValue('player', 'When the player does the thing.'));
        expect(withPlayer.isValidSwitch(createEmptyMetaDocs(), 'flagged')).toBe(true);
        expect(withPlayer.isValidSwitch(createEmptyMetaDocs(), 'permission')).toBe(true);
    });

    it('ties assigned to having a linked NPC', () => {
        expect(event().isValidSwitch(createEmptyMetaDocs(), 'assigned')).toBe(false);
        expect(event(e => e.applyValue('npc', 'When the NPC is involved.')).isValidSwitch(createEmptyMetaDocs(), 'assigned')).toBe(true);
    });

    it('treats a WHITESPACE-ONLY player or npc line as absent', () => {
        // MetaEvent.cs:101 and :105 are `!string.IsNullOrWhiteSpace(...)`, not IsNullOrEmpty.
        // BOTH need a case: an earlier draft covered only the player, and the audit duly reported
        // the npc mutant surviving.
        // MUTANT CAUGHT: `this.player.length > 0` / `this.npc.length > 0`.
        expect(event(e => e.applyValue('player', '   ')).isValidSwitch(createEmptyMetaDocs(), 'flagged')).toBe(false);
        expect(event(e => e.applyValue('npc', '   ')).isValidSwitch(createEmptyMetaDocs(), 'assigned')).toBe(false);
    });

    it('ties in and location_flagged to hasLocation', () => {
        expect(event().isValidSwitch(createEmptyMetaDocs(), 'in')).toBe(false);
        const located = event(e => e.applyValue('location', 'true'));
        expect(located.isValidSwitch(createEmptyMetaDocs(), 'in')).toBe(true);
        expect(located.isValidSwitch(createEmptyMetaDocs(), 'location_flagged')).toBe(true);
    });

    it('ties cancelled and ignorecancelled to cancellable', () => {
        expect(event().isValidSwitch(createEmptyMetaDocs(), 'cancelled')).toBe(false);
        const cancellable = event(e => e.applyValue('cancellable', 'true'));
        expect(cancellable.isValidSwitch(createEmptyMetaDocs(), 'cancelled')).toBe(true);
        expect(cancellable.isValidSwitch(createEmptyMetaDocs(), 'ignorecancelled')).toBe(true);
    });

    it('accepts anything listed in the global_switches data set', () => {
        // MetaEvent.cs:115. Data rather than code, so Denizen can add a universal switch without
        // a checker release. MUTANT CAUGHT: hardcoding the list, or dropping this arm.
        expect(event().isValidSwitch(docsWithGlobals('bukkit_priority'), 'bukkit_priority')).toBe(true);
        expect(event().isValidSwitch(createEmptyMetaDocs(), 'bukkit_priority')).toBe(false);
    });

    it('lets the events OWN switch list win over the special cases', () => {
        // The own-list test is first, so an event documenting `flagged` itself is not then
        // second-guessed about having a linked player.
        // MUTANT CAUGHT: moving the switchNames test below the special cases.
        const evt = event(e => e.applyValue('switch', 'flagged:name to do a thing'));
        expect(evt.player).toBe('');
        expect(evt.isValidSwitch(createEmptyMetaDocs(), 'flagged')).toBe(true);
    });
});

describe('MetaAction.regexMatcher (MetaAction.cs:53-69)', () => {
    function action(actions: string): MetaAction {
        const act = new MetaAction();
        act.applyValue('actions', actions);
        return act;
    }

    it('is null until an actions key is applied', () => {
        expect(new MetaAction().regexMatcher).toBeNull();
    });

    it('anchors a single action and allows an optional "on " prefix', () => {
        const re = action('spawn').regexMatcher!;
        expect(re.source).toBe('^(on )?(spawn)$');
        expect(re.test('spawn')).toBe(true);
        expect(re.test('on spawn')).toBe(true);
        expect(re.test('despawn')).toBe(false);
    });

    it('replaces a fill-in with a one-word wildcard', () => {
        // MUTANT CAUGHT: `.+` or `[^\s]*` instead of `[^\s]+` -- the first would let a fill-in
        // swallow spaces, the second would let it match nothing.
        const re = action('<entity> enter proximity').regexMatcher!;
        expect(re.test('zombie enter proximity')).toBe(true);
        expect(re.test(' enter proximity')).toBe(false);
        expect(re.test('two words enter proximity')).toBe(false);
    });

    it('is case SENSITIVE -- the C# passes no IgnoreCase', () => {
        // Callers fold the action name before testing. MUTANT CAUGHT: adding the 'i' flag.
        expect(action('spawn').regexMatcher!.test('Spawn')).toBe(false);
    });

    it('joins several action names with a pipe', () => {
        const re = action('spawn\ndespawn').regexMatcher!;
        expect(re.source).toBe('^(on )?(spawn)|(despawn)$');
    });

    it('leaves the anchors binding only the OUTER arms, as the C# does', () => {
        // A ported C# defect, not a slip here: `|` outranks the anchors, so the pattern reads as
        // `(^(on )?(spawn))` or `((despawn)$)`. The first arm is therefore not anchored at the end
        // and the second not at the start, which makes action_missing accept more than it looks.
        // MUTANT CAUGHT: wrapping the alternation in a group -- which would be a real behaviour
        // change, rejecting action lines the C# accepts.
        const re = action('spawn\ndespawn').regexMatcher!;
        expect(re.test('spawn trailing junk')).toBe(true);
        expect(re.test('leading junk despawn')).toBe(true);
    });

    it('replaces ONLY the first fill-in in a line, as the C# does', () => {
        // MetaAction.cs:56-62 takes IndexOf('<') and IndexOf('>') once, not in a loop. No real
        // action has two fill-ins (checked: 0 of the 39 documented actions), so this is latent --
        // but porting it faithfully keeps this checker from accepting lines Denizen rejects.
        // MUTANT CAUGHT: looping the replacement.
        const re = action('<entity> hits <entity>').regexMatcher!;
        expect(re.source).toBe('^(on )?([^\\s]+ hits <entity>)$');
    });

    it('takes the first ">" from the whole string, not from after the "<"', () => {
        // The other half of the same C# shortcut: `end` is the FIRST '>' ANYWHERE, so a stray '>'
        // before the fill-in makes the tail slice start too early and DUPLICATE the text between
        // them. For `a > b <entity> c`: start is 6, end is 2, so the result is
        // `a > b ` + `[^\s]+` + ` b <entity> c` -- ` b ` appears twice and the fill-in is left in.
        // Documented rather than fixed, for the same reason as the single-replacement limit above.
        // MUTANT CAUGHT: `regexable.indexOf('>', start)`, which would give `a > b [^\s]+ c`.
        expect(action('a > b <entity> c').regexMatcher!.source).toBe('^(on )?(a > b [^\\s]+ b <entity> c)$');
    });
});
