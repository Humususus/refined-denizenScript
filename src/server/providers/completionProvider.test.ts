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
        expect(provideCompletions(docs, createEmptyExtraData(), text, text.length, 3).map(i => i.label)).toEqual(['narrate']);
    });

    it('completes arguments once a command name and a space are present', () => {
        const docs = docsWith(NARRATE());
        const text = '  - narrate hello for';
        expect(provideCompletions(docs, createEmptyExtraData(), text, text.length, 0).map(i => i.label)).toEqual(['format:']);
    });

    it('tolerates the wait-for tilde prefix', () => {
        const docs = docsWith(NARRATE());
        const text = '  - ~nar';
        expect(provideCompletions(docs, createEmptyExtraData(), text, text.length, 0).map(i => i.label)).toEqual(['narrate']);
    });

    it('returns nothing on a line that is not a command line', () => {
        const docs = docsWith(NARRATE());
        const text = 'my_task:\n  type: ta';
        expect(provideCompletions(docs, createEmptyExtraData(), text, text.length, 1)).toEqual([]);
    });

    it('returns nothing for an unrecognised command name', () => {
        const docs = docsWith(NARRATE());
        const text = '  - notacommand arg';
        expect(provideCompletions(docs, createEmptyExtraData(), text, text.length, 0)).toEqual([]);
    });

    it('returns nothing for an out-of-range offset', () => {
        const docs = docsWith(NARRATE());
        expect(provideCompletions(docs, createEmptyExtraData(), '  - nar', 999, 0)).toEqual([]);
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
        const labels = provideCompletions(playsoundDocs(), EXTRA, text, text.length, 0).map(i => i.label);
        expect(labels).toContain('block.stone.step');
        expect(labels).toContain('block.stone.break');
        expect(labels).not.toContain('ambient.cave');
    });

    it('offers every sound when nothing follows the prefix yet', () => {
        const text = '  - playsound sound:';
        const labels = provideCompletions(playsoundDocs(), EXTRA, text, text.length, 0).map(i => i.label);
        expect(labels.sort()).toEqual(['ambient.cave', 'block.stone.break', 'block.stone.step']);
    });

    it('labels enum results with the enum name', () => {
        const text = '  - playsound sound:ambient';
        const item = provideCompletions(playsoundDocs(), EXTRA, text, text.length, 0)[0];
        expect(item.kind).toBe(CompletionItemKind.Enum);
        expect(String((item.documentation as { value: string }).value)).toContain('Sound Enum');
    });

    it('still offers the command\'s own argument names when no colon is typed', () => {
        const text = '  - playsound vol';
        const labels = provideCompletions(playsoundDocs(), EXTRA, text, text.length, 0).map(i => i.label);
        expect(labels).toContain('volume:');
    });

    it('offers nothing extra for a prefix with no registered enum', () => {
        const text = '  - playsound volume:0.';
        expect(provideCompletions(playsoundDocs(), EXTRA, text, text.length, 0)).toEqual([]);
    });

    // Regression coverage for the reported bug: with no wordPattern in
    // language-configuration.json, VS Code's default word definition treats '.' and ':'
    // as word breaks. Without an explicit textEdit, accepting a completion for
    // 'sound:block.a' replaces only the trailing 'a' (the "current word"), leaving
    // 'block.' in place and producing 'sound:block.block.amethyst_block.break'. The
    // textEdit's range must span the entire typed value so acceptance replaces
    // 'block.a' as a whole with the full dotted value.
    describe('textEdit range pins the whole typed value, not just the trailing word', () => {
        it('starts right after the "sound:" prefix and ends at the cursor, for a value part-typed after a dot', () => {
            // '  - playsound sound:block.st'
            //  0123456789...
            // 's' of 'sound:' is at index 14, so 'sound:' spans [14,20) and the value
            // ('block.st') begins at index 20. The whole string is 28 characters long
            // (indices 0..27), so the cursor sits at character 28.
            const text = '  - playsound sound:block.st';
            expect(text.length).toBe(28);
            const items = provideCompletions(playsoundDocs(), EXTRA, text, text.length, 0);
            expect(items.length).toBeGreaterThan(0);
            for (const item of items) {
                expect(item.textEdit).toEqual({
                    range: { start: { line: 0, character: 20 }, end: { line: 0, character: 28 } },
                    newText: item.label
                });
            }
        });

        it('sets newText to the full value', () => {
            const text = '  - playsound sound:block.stone.st';
            const items = provideCompletions(playsoundDocs(), EXTRA, text, text.length, 0);
            const stepItem = items.find(i => i.label === 'block.stone.step');
            expect(stepItem).toBeDefined();
            expect((stepItem!.textEdit as { newText: string }).newText).toBe('block.stone.step');
        });

        it('has an equal start and end, both at the cursor, when the value is empty', () => {
            // '  - playsound sound:' is 20 characters long (indices 0..19), so the
            // cursor sits at character 20, and there is no typed value to replace.
            const text = '  - playsound sound:';
            expect(text.length).toBe(20);
            const items = provideCompletions(playsoundDocs(), EXTRA, text, text.length, 0);
            expect(items.length).toBeGreaterThan(0);
            for (const item of items) {
                expect(item.textEdit).toEqual({
                    range: { start: { line: 0, character: 20 }, end: { line: 0, character: 20 } },
                    newText: item.label
                });
            }
        });

        it('places the range on the given line, not always line 0, in a multi-line document', () => {
            // A leading '\n' puts everything else on line 1. The line's own text is
            // identical to the single-line case above, so the character offsets within
            // the line are unchanged (20 and 28) — only the line number differs.
            const text = '\n  - playsound sound:block.st';
            expect(text.length).toBe(29);
            const items = provideCompletions(playsoundDocs(), EXTRA, text, text.length, 1);
            expect(items.length).toBeGreaterThan(0);
            for (const item of items) {
                expect(item.textEdit).toEqual({
                    range: { start: { line: 1, character: 20 }, end: { line: 1, character: 28 } },
                    newText: item.label
                });
            }
        });
    });
});

// Regression coverage for a bug caught in review: `give` (and every other command
// registered under the bare '' prefix in argumentCompleters.ts) has its enum values
// and its own argument names compete for the same unprefixed typed text. The fix
// merges both sources instead of the enum short-circuiting the argument names away.
describe('enum results merge with the command\'s own argument names (bare-prefix regression)', () => {
    const GIVE_EXTRA = buildExtraData(parseFlatFds([
        'items:', '- QUARTZ', '- QUARTZ_BLOCK',
        'potion_effects:', '- SPEED', '- SLOWNESS',
        ''
    ].join('\n')));

    function giveDocs(): MetaDocs {
        return docsWith(makeCommand('give', 'give [<item>|...] (quantity:<#>) (slot:<slot>)', 'Gives an item.'));
    }

    it('lists the argument name before the enum values when a typed prefix matches both', () => {
        const text = '  - give q';
        const labels = provideCompletions(giveDocs(), GIVE_EXTRA, text, text.length).map(i => i.label);
        expect(labels).toEqual(['quantity:', 'quartz', 'quartz_block']);
    });

    it('still yields enum values when the typed prefix matches only the enum', () => {
        const text = '  - give quar';
        const labels = provideCompletions(giveDocs(), GIVE_EXTRA, text, text.length).map(i => i.label);
        expect(labels).toEqual(['quartz', 'quartz_block']);
    });

    it('still yields the argument name when the typed prefix matches only an argument', () => {
        const text = '  - give sl';
        const labels = provideCompletions(giveDocs(), GIVE_EXTRA, text, text.length).map(i => i.label);
        expect(labels).toEqual(['slot:']);
    });

    it('yields enum values for a command unknown to the meta docs but registered in the enum table', () => {
        const docs = docsWith();
        const text = '  - cast sp';
        const labels = provideCompletions(docs, GIVE_EXTRA, text, text.length).map(i => i.label);
        expect(labels).toEqual(['speed']);
    });
});
