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

/** Real `inventory` syntax, verbatim from meta — its first parameter is a single
 * bracketed group containing a dozen `/`-separated choices and nested groups. */
const INVENTORY_SYNTAX =
    'inventory [open/close/copy/move/swap/set/keep/exclude/fill/clear/update/adjust <mechanism>:<value>/flag <name>(:<action>)[:<value>] (expire:<time>)] (destination:<inventory>) (origin:<inventory>/<item>|...) (slot:<slot>)';

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

    it('treats a bracketed group containing spaces as a single top-level parameter (real inventory syntax)', () => {
        const tokens = tokenizeSyntax(INVENTORY_SYNTAX);
        expect(tokens.map(t => t.text)).toEqual([
            '[open/close/copy/move/swap/set/keep/exclude/fill/clear/update/adjust <mechanism>:<value>/flag <name>(:<action>)[:<value>] (expire:<time>)]',
            '(destination:<inventory>)',
            '(origin:<inventory>/<item>|...)',
            '(slot:<slot>)'
        ]);
    });

    it('keeps a nested (:<action>)[:<value>] group inside its parent token rather than splitting it out', () => {
        const tokens = tokenizeSyntax('flag [<name>(:<action>)[:<value>]] (expire:<time>)');
        expect(tokens.map(t => t.text)).toEqual([
            '[<name>(:<action>)[:<value>]]',
            '(expire:<time>)'
        ]);
    });

    it('produces offset pairs that are all valid [start, end) ranges into the syntax string', () => {
        for (const token of tokenizeSyntax(INVENTORY_SYNTAX)) {
            expect(token.start).toBeGreaterThanOrEqual(0);
            expect(token.start).toBeLessThan(token.end);
            expect(token.end).toBeLessThanOrEqual(INVENTORY_SYNTAX.length);
        }
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

    it('clamps to the last parameter when extra arguments are typed past a non-variadic last parameter', () => {
        // narrate's real last parameter is (format:<script>), which takes exactly one
        // value, not a list — but the shipped client rewrites a `null` activeParameter
        // to 0 (protocolConverter.js:345-351), so clamping to the last parameter is
        // still closer to correct than letting the highlight jump back to parameter 1.
        const text = '  - narrate a b c d e';
        expect(provideSignatureHelp(NARRATE(), text, text.length)!.activeParameter).toBe(2);
    });

    it('returns null for a zero-argument command', () => {
        const docs = docsWith('stop', 'stop', 'Stops a script.');
        const text = '  - stop ';
        expect(provideSignatureHelp(docs, text, text.length)!.activeParameter).toBeNull();
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
