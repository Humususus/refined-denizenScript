import { describe, it, expect } from 'vitest';
import { CompletionItem } from 'vscode-languageserver';
import { buildMetaDocs } from '../metaDocs/metaDocsManager';
import { createEmptyExtraData } from '../metaDocs/extraData';
import { ScriptContainerData, ScriptingWorkspaceData } from '../checker/containerConvert';
import { provideCompletions } from './completionProvider';
import { parseDataActions } from './containerCompleters';

// The meta's own `data actions` language text, as loaded 2026-10-27 (Denizen-Core).
const DATA_ACTIONS = [
    'Several commands function as a way to modify data values,',
    'including <@link command flag>, <@link command yaml>, and <@link command define>.',
    'These operations can be used with a syntax like "<key>:<action>:<value>"',
    'The following actions are available:',
    'Actions that take no input value:',
    "Increment: '++': raises the value numerically up by 1. Example: - define x:++",
    "Decrement: '--': lowers the value numerically down by 1. Example: - define x:--",
    "Remove: '!': removes the value entirely. Example: - define x:!",
    'Actions that take an input value:',
    "Add: '+': adds the input value to the value at the key. Example: - define x:+:5",
    "Subtract: '-': subtracts the input value from the value at the key. Example: - define x:-:5",
    "Multiply: '*': multiplies the value at the key by the input value. Example: - define x:*:5",
    "Divide: '/': divides the value at the key by the input value. Example: - define x:/:5",
    "List insert: '->': adds the input value as a single new entry in the list (see also 'List split'). Example: - define x:->:new_value",
    "List remove: '<-': removes the input value from the list. Example: - define x:<-:old_value",
    "List split: '|': splits the input list and adds each value into an existing list at the key. Example: - define x:|:a|b|c",
    'Special cases:',
    "In some commands, specifying no action or input value will automatically set the key's value to 'true'.",
];

const docs = buildMetaDocs([
    { objectType: 'language', url: 'core#1', data: ['@name Data Actions', '@group Useful Lists', '@description', ...DATA_ACTIONS, '@end_meta'] },
    { objectType: 'command', url: 'core#2', data: ['@Name Define', '@Syntax define [<id>](:<action>)[:<value>]', '@Required 1', '@Maximum 2', '@Short Creates a definition.', '@group queue', '@end_meta'] },
    { objectType: 'command', url: 'core#3', data: ['@Name Flag', '@Syntax flag [<object>|...] [<name>([<#>])](:<action>)[:<value>] (expire:<time>)', '@Required 2', '@Maximum 3', '@Short Sets a flag.', '@group core', '@end_meta'] },
    { objectType: 'language', url: 'core#4', data: ['@name Task Script Containers', '@group Script Container System', '@description', 'Task script containers are generic script containers for commands that can be run at any time.', 'More detail.', '', 'Second paragraph.', '@end_meta'] },
    { objectType: 'language', url: 'core#5', data: ['@name World Script Containers', '@group Script Container System', '@description', 'World script containers are generic script containers for commands that are automatically ran when an event fires.', '@end_meta'] },
    { objectType: 'language', url: 'core#6', data: ['@name Entity Script Containers', '@group Script Container System', '@description', 'Entity script containers are an easy way to pre-define custom entities.', '@end_meta'] },
    { objectType: 'mechanism', url: 'bukkit#1', data: ['@object EntityTag', '@name custom_name', '@input ElementTag', '@description', 'Sets the custom name of the entity.', '@end_meta'] },
    { objectType: 'property', url: 'bukkit#2', data: ['@object EntityTag', '@name age', '@input ElementTag', '@description', 'The entity\'s age.', '@end_meta'] },
    { objectType: 'mechanism', url: 'bukkit#3', data: ['@object ItemTag', '@name lore', '@input ListTag', '@description', 'Sets the item\'s lore.', '@end_meta'] },
]);
const extra = createEmptyExtraData();
extra.entities = new Set(['zombie', 'spider']);

function complete(text: string, workspace: ScriptingWorkspaceData | null = null): CompletionItem[] {
    return provideCompletions(docs, extra, text, text.length, text.split('\n').length - 1, true, workspace);
}
const labels = (items: CompletionItem[]) => items.map(i => i.label);
const SCRIPT = 'a:\n    type: task\n    script:\n';

describe('data actions (spec 8)', () => {
    it('reads all ten actions from the meta', () => {
        const actions = parseDataActions(docs);
        expect(actions.map(a => a.symbol)).toEqual(['++', '--', '!', '+', '-', '*', '/', '->', '<-', '|']);
        expect(actions.filter(a => a.takesValue).map(a => a.symbol)).toEqual(['+', '-', '*', '/', '->', '<-', '|']);
        expect(actions[0]).toMatchObject({ name: 'Increment', description: 'raises the value numerically up by 1.', example: '- define x:++' });
    });

    it('offers them after `- define name:`', () => {
        const items = complete(SCRIPT + '    - define count:');
        expect(labels(items)).toEqual(['++', '--', '!', '+:', '-:', '*:', '/:', '->:', '<-:', '|:']);
        expect(JSON.stringify(items[0].documentation)).toContain('raises the value numerically up by 1.');
    });

    it('filters by what is typed after the colon, replacing it', () => {
        const items = complete(SCRIPT + '    - define count:+');
        expect(labels(items)).toEqual(['++', '+:']);
        const edit = items[0].textEdit as { range: { start: { character: number }; end: { character: number } }; newText: string };
        expect(edit.range.start.character).toBe('    - define count:'.length);
        expect(edit.range.end.character).toBe('    - define count:+'.length);
    });

    it('accepts an indexed key', () => {
        expect(labels(complete(SCRIPT + '    - define list[3]:'))).toContain('<-:');
    });

    it('offers them on a flag name, not on its object or on expire:', () => {
        expect(labels(complete(SCRIPT + '    - flag player rewards:'))).toContain('++');
        expect(labels(complete(SCRIPT + '    - flag player expire:'))).not.toContain('++');
        expect(labels(complete(SCRIPT + '    - flag rewards:'))).not.toContain('++');
    });

    // Review Focus 1: a value is not an action.
    it('leaves tags and ordinary values alone', () => {
        expect(labels(complete(SCRIPT + '    - define x:<pl'))).not.toContain('++');
        expect(labels(complete(SCRIPT + '    - define url:https:'))).not.toContain('++');
        expect(labels(complete(SCRIPT + '    - define x:5'))).not.toContain('++');
    });
});

describe('container types on type: (spec 9)', () => {
    it('offers every container type the meta documents, with its first paragraph', () => {
        const items = complete('my_script:\n    type: ');
        expect(labels(items)).toEqual(expect.arrayContaining(['task', 'world', 'entity', 'dialog']));
        const task = items.find(i => i.label === 'task')!;
        expect(JSON.stringify(task.documentation)).toContain('Task script containers are generic script containers');
        expect(JSON.stringify(task.documentation)).not.toContain('Second paragraph');
    });
    it('filters by what is typed', () => {
        expect(labels(complete('my_script:\n    type: wo'))).toEqual(['world']);
    });
    it('only on the type: line directly under a container', () => {
        expect(labels(complete('my_script:\n    type: data\n    data:\n        type: '))).not.toContain('task');
    });
});

describe('entity containers (spec 10)', () => {
    function workspace(...scripts: [string, string][]): ScriptingWorkspaceData {
        const ws = new ScriptingWorkspaceData();
        for (const [name, type] of scripts) {
            const data = new ScriptContainerData();
            data.name = name;
            data.type = type;
            ws.scripts.set(name, data);
        }
        return ws;
    }

    it('entity_type: offers entity scripts from the workspace beside the vanilla types', () => {
        const ws = workspace(['space_zombie', 'entity'], ['spawn_task', 'task'], ['my_mob', 'entity']);
        const items = complete('my_mob:\n    type: entity\n    entity_type: sp', ws);
        expect(labels(items)).toEqual(['spider', 'space_zombie']);
        const script = items.find(i => i.label === 'space_zombie')!;
        expect(script.detail).toBe('Entity script');
        // The container being written is not offered as its own type.
        expect(labels(complete('my_mob:\n    type: entity\n    entity_type: my', ws))).toEqual([]);
    });

    it('offers EntityTag mechanisms as keys under mechanisms:', () => {
        const items = complete('my_mob:\n    type: entity\n    entity_type: zombie\n    mechanisms:\n        cus');
        expect(labels(items)).toEqual(['custom_name']);
        const edit = items[0].textEdit as { newText: string };
        expect(edit.newText).toBe('custom_name: ');
        expect(labels(complete('my_mob:\n    type: entity\n    mechanisms:\n        '))).toEqual(['age', 'custom_name']);
    });

    // Review Focus 2.
    it('nothing from this list under mechanisms: of another container type', () => {
        expect(labels(complete('my_item:\n    type: item\n    mechanisms:\n        '))).not.toContain('custom_name');
    });
});
