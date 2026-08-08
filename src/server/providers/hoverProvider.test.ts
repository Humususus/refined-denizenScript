import { describe, it, expect } from 'vitest';
import { Hover } from 'vscode-languageserver';
import { provideHover } from './hoverProvider';
import { MetaCommand, MetaLanguage, MetaDocs, createEmptyMetaDocs, META_TYPE_COMMAND, META_TYPE_LANGUAGE } from '../metaDocs/metaTypes';

function testDocs(): MetaDocs {
    const docs = createEmptyMetaDocs();
    const cmd = new MetaCommand();
    cmd.type = META_TYPE_COMMAND;
    cmd.commandName = 'narrate';
    cmd.syntax = 'narrate [<text>]';
    cmd.short = 'Shows text.';
    cmd.addTo(docs);
    const lang = new MetaLanguage();
    lang.type = META_TYPE_LANGUAGE;
    lang.langName = 'Task Script Containers';
    lang.description = 'A task script.';
    lang.addTo(docs);
    return docs;
}

function valueOf(hover: Hover): string {
    return (hover.contents as { value: string }).value;
}

describe('provideHover', () => {
    it('describes the command when the cursor is on its name', () => {
        const docs = testDocs();
        const text = '  - narrate hello';
        const hover = provideHover(docs, text, 6, 0, 6)!;
        expect(valueOf(hover)).toContain('### Command narrate');
        expect(hover.range).toEqual({ start: { line: 0, character: 4 }, end: { line: 0, character: 11 } });
    });

    it('returns nothing when the cursor is past the command name', () => {
        const docs = testDocs();
        const text = '  - narrate hello';
        expect(provideHover(docs, text, 13, 0, 13)).toBeNull();
    });

    it('skips the tilde when locating the command name', () => {
        const docs = testDocs();
        const text = '  - ~narrate hi';
        const hover = provideHover(docs, text, 7, 0, 7)!;
        expect(valueOf(hover)).toContain('### Command narrate');
        expect(hover.range!.start.character).toBe(5);
    });

    it('describes the container language on a type line', () => {
        const docs = testDocs();
        const text = 'my_task:\n  type: task';
        const offset = text.indexOf('task', 9);
        const hover = provideHover(docs, text, offset, 1, offset - 9)!;
        expect(valueOf(hover)).toContain('### Task Script Containers');
    });

    it('returns nothing for an unknown command', () => {
        const docs = testDocs();
        const text = '  - notacommand';
        expect(provideHover(docs, text, 6, 0, 6)).toBeNull();
    });

    it('returns nothing for an unknown container type', () => {
        const docs = testDocs();
        const text = '  type: nonsense';
        expect(provideHover(docs, text, 10, 0, 10)).toBeNull();
    });

    it('returns nothing on an ordinary line', () => {
        const docs = testDocs();
        const text = 'my_task:';
        expect(provideHover(docs, text, 3, 0, 3)).toBeNull();
    });

    it('returns nothing for an out-of-range offset', () => {
        expect(provideHover(testDocs(), '  - narrate', 999, 0, 999)).toBeNull();
    });
});
