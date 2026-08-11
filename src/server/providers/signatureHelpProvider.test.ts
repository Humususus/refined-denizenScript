import { describe, it, expect } from 'vitest';
import { tokenizeSyntax, provideSignatureHelp } from './signatureHelpProvider';
import { MetaCommand, MetaDocs, createEmptyMetaDocs, META_TYPE_COMMAND } from '../metaDocs/metaTypes';

function docsWith(name: string, syntax: string, short: string): MetaDocs {
    const docs = createEmptyMetaDocs();
    const cmd = new MetaCommand();
    cmd.type = META_TYPE_COMMAND;
    cmd.commandName = name;
    cmd.syntax = syntax;
    cmd.short = short;
    cmd.addTo(docs);
    return docs;
}

const NARRATE = () => docsWith('narrate', 'narrate [<text>] (targets:<player>|...) (format:<script>)', 'Shows text.');

describe('tokenizeSyntax', () => {
    it('returns each argument token with its offsets into the syntax string', () => {
        const tokens = tokenizeSyntax('narrate [<text>] (format:<script>)');
        expect(tokens.map(t => t.text)).toEqual(['[<text>]', '(format:<script>)']);
        expect(tokens[0].start).toBe(8);
        expect(tokens[0].end).toBe(16);
        expect(tokens[1].start).toBe(17);
    });

    it('excludes the command name itself', () => {
        expect(tokenizeSyntax('stop').length).toBe(0);
    });

    it('collapses runs of whitespace without emitting empty tokens', () => {
        expect(tokenizeSyntax('give  [<item>]   (quantity:<#>)').map(t => t.text))
            .toEqual(['[<item>]', '(quantity:<#>)']);
    });

    it('returns an empty list for an empty syntax string', () => {
        expect(tokenizeSyntax('')).toEqual([]);
    });
});

describe('provideSignatureHelp', () => {
    it('labels the signature with the full syntax line', () => {
        const text = '  - narrate hello';
        const help = provideSignatureHelp(NARRATE(), text, text.length)!;
        expect(help.signatures[0].label).toBe('narrate [<text>] (targets:<player>|...) (format:<script>)');
    });

    it('marks the first argument active while it is being typed', () => {
        const text = '  - narrate hel';
        expect(provideSignatureHelp(NARRATE(), text, text.length)!.activeParameter).toBe(0);
    });

    it('advances the active parameter as arguments are added', () => {
        const text = '  - narrate hello targ';
        expect(provideSignatureHelp(NARRATE(), text, text.length)!.activeParameter).toBe(1);
    });

    it('exposes each parameter as offsets into the label, not as a copy of the text', () => {
        const text = '  - narrate hello';
        const params = provideSignatureHelp(NARRATE(), text, text.length)!.signatures[0].parameters!;
        expect(params[0].label).toEqual([8, 16]);
    });

    it('clamps the active parameter to the last one when extra arguments are typed', () => {
        const text = '  - narrate a b c d e';
        expect(provideSignatureHelp(NARRATE(), text, text.length)!.activeParameter).toBe(2);
    });

    it('returns null while the command name is still being typed', () => {
        const text = '  - narr';
        expect(provideSignatureHelp(NARRATE(), text, text.length)).toBeNull();
    });

    it('returns null for an unknown command', () => {
        const text = '  - notacommand x';
        expect(provideSignatureHelp(NARRATE(), text, text.length)).toBeNull();
    });

    it('returns null on a line that is not a command line', () => {
        const text = '  type: task';
        expect(provideSignatureHelp(NARRATE(), text, text.length)).toBeNull();
    });

    it('returns null for an out-of-range offset', () => {
        expect(provideSignatureHelp(NARRATE(), '  - narrate x', 999)).toBeNull();
    });
});
