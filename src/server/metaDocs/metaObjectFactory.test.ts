import { describe, it, expect } from 'vitest';
import { createMetaObjectForType, loadInObject } from './metaObjectFactory';
import { MetaCommand, MetaTag } from './metaTypes';

describe('createMetaObjectForType', () => {
    it('creates the right subclass for each known type name (case-insensitive)', () => {
        expect(createMetaObjectForType('command')).toBeInstanceOf(MetaCommand);
        expect(createMetaObjectForType('Command')).toBeInstanceOf(MetaCommand);
        expect(createMetaObjectForType('tag')).toBeInstanceOf(MetaTag);
    });

    it('returns undefined for an unknown type name', () => {
        expect(createMetaObjectForType('not_a_real_type')).toBeUndefined();
    });
});

describe('loadInObject', () => {
    it('parses @key value pairs, joining multi-line continuations, into a MetaCommand', () => {
        const errors: string[] = [];
        const obj = loadInObject('command', 'https://example.com#L1', [
            '@Name narrate',
            '@Short Sends a message.',
            '@Description Narrates text',
            'across multiple lines',
            'of description.',
            '@Tags',
            '<player.name>',
            '<npc.name>',
            '@end_meta'
        ], errors) as MetaCommand;
        expect(errors).toEqual([]);
        expect(obj).toBeInstanceOf(MetaCommand);
        expect(obj.commandName).toBe('narrate');
        expect(obj.short).toBe('Sends a message.');
        expect(obj.description).toBe('Narrates text\nacross multiple lines\nof description.');
        expect(obj.tags).toEqual(['<player.name>', '<npc.name>']);
        expect(obj.sourceFile).toBe('https://example.com#L1');
    });

    it('records an error for an unknown object type and returns undefined', () => {
        const errors: string[] = [];
        const obj = loadInObject('not_a_real_type', 'src', ['@Name x', '@end_meta'], errors);
        expect(obj).toBeUndefined();
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain('unknown meta type');
    });

    it('records an error when a key/value pair cannot be applied', () => {
        const errors: string[] = [];
        loadInObject('command', 'src', ['@Required not_a_number', '@end_meta'], errors);
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("could not apply key 'Required'");
    });

    it('stops processing once @end_meta is reached', () => {
        const errors: string[] = [];
        const obj = loadInObject('command', 'src', ['@Name foo', '@end_meta', '@Short ignored'], errors) as MetaCommand;
        expect(obj.short).toBe('');
    });
});
