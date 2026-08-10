import { describe, it, expect } from 'vitest';
import { CompletionItemKind } from 'vscode-languageserver';
import { provideCompletions, completeCommandNames, completeCommandArguments } from './completionProvider';
import { MetaCommand, MetaDocs, createEmptyMetaDocs, META_TYPE_COMMAND } from '../metaDocs/metaTypes';
import { buildExtraData, parseFlatFds, createEmptyExtraData } from '../metaDocs/extraData';

function makeCommand(name: string, syntax: string, short: string): MetaCommand {
    const cmd = new MetaCommand();
    cmd.type = META_TYPE_COMMAND;
    cmd.commandName = name;
    cmd.syntax = syntax;
    cmd.short = short;
    return cmd;
}

function docsWith(...commands: MetaCommand[]): MetaDocs {
    const docs = createEmptyMetaDocs();
    for (const cmd of commands) {
        cmd.addTo(docs);
    }
    return docs;
}

const NARRATE = () => makeCommand('narrate', 'narrate [<text>] (targets:<player>|...) (format:<name>) (per_player)', 'Shows text.');
const NOTE = () => makeCommand('note', 'note [<object>] [as:<name>]', 'Notes an object.');

describe('completeCommandNames', () => {
    it('returns every command sharing the given prefix', () => {
        const docs = docsWith(NARRATE(), NOTE());
        expect(completeCommandNames(docs, 'n').map(i => i.label).sort()).toEqual(['narrate', 'note']);
    });

    it('narrows as the prefix grows', () => {
        const docs = docsWith(NARRATE(), NOTE());
        expect(completeCommandNames(docs, 'na').map(i => i.label)).toEqual(['narrate']);
    });

    it('marks results as methods and attaches documentation', () => {
        const docs = docsWith(NARRATE());
        const item = completeCommandNames(docs, 'narrate')[0];
        expect(item.kind).toBe(CompletionItemKind.Method);
        expect(item.detail).toBe('Shows text.');
        expect(String((item.documentation as { value: string }).value)).toContain('### Command narrate');
    });

    it('returns everything for an empty prefix', () => {
        const docs = docsWith(NARRATE(), NOTE());
        expect(completeCommandNames(docs, '')).toHaveLength(2);
    });
});

describe('completeCommandArguments', () => {
    it('offers prefixed arguments with a trailing colon', () => {
        const cmd = NARRATE();
        cmd.parseSyntax();
        expect(completeCommandArguments(cmd, 'f').map(i => i.label)).toEqual(['format:']);
    });

    it('offers flat arguments without a colon', () => {
        const cmd = NARRATE();
        cmd.parseSyntax();
        expect(completeCommandArguments(cmd, 'per').map(i => i.label)).toEqual(['per_player']);
    });

    it('offers both kinds when the prefix matches both', () => {
        const cmd = NARRATE();
        cmd.parseSyntax();
        expect(completeCommandArguments(cmd, '').map(i => i.label).sort())
            .toEqual(['format:', 'per_player', 'targets:']);
    });

    it('matches a prefix name against the text typed before the colon', () => {
        const cmd = NARRATE();
        cmd.parseSyntax();
        expect(completeCommandArguments(cmd, 'targets').map(i => i.label)).toEqual(['targets:']);
    });
});

describe('provideCompletions', () => {
    it('completes a command name after a dash', () => {
        const docs = docsWith(NARRATE(), NOTE());
        const text = 'my_task:\n  type: task\n  script:\n  - na';
        expect(provideCompletions(docs, createEmptyExtraData(), text, text.length).map(i => i.label)).toEqual(['narrate']);
    });

    it('completes arguments once a command name and a space are present', () => {
        const docs = docsWith(NARRATE());
        const text = '  - narrate hello for';
        expect(provideCompletions(docs, createEmptyExtraData(), text, text.length).map(i => i.label)).toEqual(['format:']);
    });

    it('tolerates the wait-for tilde prefix', () => {
        const docs = docsWith(NARRATE());
        const text = '  - ~nar';
        expect(provideCompletions(docs, createEmptyExtraData(), text, text.length).map(i => i.label)).toEqual(['narrate']);
    });

    it('returns nothing on a line that is not a command line', () => {
        const docs = docsWith(NARRATE());
        const text = 'my_task:\n  type: ta';
        expect(provideCompletions(docs, createEmptyExtraData(), text, text.length)).toEqual([]);
    });

    it('returns nothing for an unrecognised command name', () => {
        const docs = docsWith(NARRATE());
        const text = '  - notacommand arg';
        expect(provideCompletions(docs, createEmptyExtraData(), text, text.length)).toEqual([]);
    });

    it('returns nothing for an out-of-range offset', () => {
        const docs = docsWith(NARRATE());
        expect(provideCompletions(docs, createEmptyExtraData(), '  - nar', 999)).toEqual([]);
    });
});

describe('enum-backed argument value completion', () => {
    const EXTRA = buildExtraData(parseFlatFds([
        'sounds:', '- BLOCK.STONE.STEP', '- BLOCK.STONE.BREAK', '- AMBIENT.CAVE',
        'blocks:', '- STONE', '- STONE_BRICKS',
        ''
    ].join('\n')));

    function playsoundDocs(): MetaDocs {
        return docsWith(makeCommand('playsound',
            'playsound [<location>|...] [sound:<name>] (volume:<#.#>)', 'Plays a sound.'));
    }

    it('offers sound names after the sound: prefix', () => {
        const text = '  - playsound <player.location> sound:block.stone.';
        const labels = provideCompletions(playsoundDocs(), EXTRA, text, text.length).map(i => i.label);
        expect(labels).toContain('block.stone.step');
        expect(labels).toContain('block.stone.break');
        expect(labels).not.toContain('ambient.cave');
    });

    it('offers every sound when nothing follows the prefix yet', () => {
        const text = '  - playsound sound:';
        const labels = provideCompletions(playsoundDocs(), EXTRA, text, text.length).map(i => i.label);
        expect(labels.sort()).toEqual(['ambient.cave', 'block.stone.break', 'block.stone.step']);
    });

    it('labels enum results with the enum name', () => {
        const text = '  - playsound sound:ambient';
        const item = provideCompletions(playsoundDocs(), EXTRA, text, text.length)[0];
        expect(item.kind).toBe(CompletionItemKind.Enum);
        expect(String((item.documentation as { value: string }).value)).toContain('Sound Enum');
    });

    it('still offers the command\'s own argument names when no colon is typed', () => {
        const text = '  - playsound vol';
        const labels = provideCompletions(playsoundDocs(), EXTRA, text, text.length).map(i => i.label);
        expect(labels).toContain('volume:');
    });

    it('offers nothing extra for a prefix with no registered enum', () => {
        const text = '  - playsound volume:0.';
        expect(provideCompletions(playsoundDocs(), EXTRA, text, text.length)).toEqual([]);
    });
});
