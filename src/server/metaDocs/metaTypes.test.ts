import { describe, it, expect } from 'vitest';
import { MetaCommand, MetaTag, MetaEvent, MetaMechanism, MetaProperty, MetaAction, MetaLanguage, MetaObjectType, MetaDocs, createEmptyMetaDocs, cleanTag } from './metaTypes';

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
