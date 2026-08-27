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
        const hover = provideHover(docs, text, 6, 0)!;
        expect(valueOf(hover)).toContain('### Command narrate');
        expect(hover.range).toEqual({ start: { line: 0, character: 4 }, end: { line: 0, character: 11 } });
    });

    it('returns nothing when the cursor is past the command name', () => {
        const docs = testDocs();
        const text = '  - narrate hello';
        expect(provideHover(docs, text, 13, 0)).toBeNull();
    });

    it('skips the tilde when locating the command name', () => {
        const docs = testDocs();
        const text = '  - ~narrate hi';
        const hover = provideHover(docs, text, 7, 0)!;
        expect(valueOf(hover)).toContain('### Command narrate');
        expect(hover.range!.start.character).toBe(5);
    });

    it('describes the container language on a type line', () => {
        const docs = testDocs();
        const text = 'my_task:\n  type: task';
        const offset = text.indexOf('task', 9);
        const hover = provideHover(docs, text, offset, 1)!;
        expect(valueOf(hover)).toContain('### Task Script Containers');
        expect(hover.range).toEqual({ start: { line: 1, character: 2 }, end: { line: 1, character: 12 } });
    });

    it('returns nothing for an unknown command', () => {
        const docs = testDocs();
        const text = '  - notacommand';
        expect(provideHover(docs, text, 6, 0)).toBeNull();
    });

    it('returns nothing for an unknown container type', () => {
        const docs = testDocs();
        const text = '  type: nonsense';
        expect(provideHover(docs, text, 10, 0)).toBeNull();
    });

    it('returns nothing on an ordinary line', () => {
        const docs = testDocs();
        const text = 'my_task:';
        expect(provideHover(docs, text, 3, 0)).toBeNull();
    });

    it('returns nothing for an out-of-range offset', () => {
        expect(provideHover(testDocs(), '  - narrate', 999, 0)).toBeNull();
    });

    it('returns nothing when hovering the leading whitespace of a type line', () => {
        const docs = testDocs();
        const text = 'my_task:\n  type: task';
        // offset 9 is the very start of line 1 ("  type: task"), i.e. column 0, which is
        // inside the two-space indent (indent === 2) and so must not resolve to a hover.
        expect(provideHover(docs, text, 9, 1)).toBeNull();
    });

    it('returns nothing when hovering past the end of a type line', () => {
        const docs = testDocs();
        // CRLF line ending: the line's own text ("  type: task", raw.length === 12) has its
        // trailing \r stripped by getFullLine, but the offset of the \n itself still resolves
        // to this line, deriving character 13 (one past raw.length) — this must return null.
        const text = 'my_task:\n  type: task\r\n';
        const offset = text.indexOf('\n', 9);
        expect(provideHover(docs, text, offset, 1)).toBeNull();
    });

    it('describes the type line when hovering exactly at the indent boundary', () => {
        const docs = testDocs();
        const text = 'my_task:\n  type: task';
        // offset 11 -> character 2, exactly equal to indent (2): inclusive boundary, still a hit.
        const hover = provideHover(docs, text, 11, 1)!;
        expect(valueOf(hover)).toContain('### Task Script Containers');
    });

    it('describes the type line when hovering exactly at the end-of-line boundary', () => {
        const docs = testDocs();
        const text = 'my_task:\n  type: task';
        // offset 21 (== text.length) -> character 12, exactly equal to raw.length (12):
        // inclusive boundary, still a hit.
        const hover = provideHover(docs, text, 21, 1)!;
        expect(valueOf(hover)).toContain('### Task Script Containers');
    });
});

describe("provideHover for commands added by extra_sources", () => {
    // Reported by the user 2026-08-27: commands from an add-on meta archive completed but
    // never hovered. A /^[a-z0-9_]+$/ whitelist on the command name -- a port artifact, not
    // anything TextDocumentService.cs does -- was rejecting every hyphenated name.

    function addonDocs(): MetaDocs {
        const docs = testDocs();
        const cmd = new MetaCommand();
        cmd.type = META_TYPE_COMMAND;
        cmd.commandName = "bm-state";
        cmd.syntax = "bm-state [<name>]";
        cmd.short = "Sets a model state.";
        cmd.addTo(docs);
        return docs;
    }

    it("describes a hyphenated command name", () => {
        // MUTANT: restore the COMMAND_NAME_PATTERN guard.
        const docs = addonDocs();
        const text = "  - bm-state walk";
        const hover = provideHover(docs, text, 6, 0)!;
        expect(valueOf(hover)).toContain("bm-state");
    });

    it("anchors the hover range over the whole hyphenated name", () => {
        // MUTANT: cut the range at the hyphen. "  - bm-state" puts the name at 4..12.
        const docs = addonDocs();
        const hover = provideHover(docs, "  - bm-state walk", 6, 0)!;
        expect(hover.range).toEqual({ start: { line: 0, character: 4 }, end: { line: 0, character: 12 } });
    });

    it("still returns nothing for a name that is in no meta at all", () => {
        // The lookup, not a character whitelist, is what rejects nonsense -- so removing the
        // whitelist must not start hovering over junk.
        // MUTANT: return a hover when docs.commands.get() misses.
        const docs = addonDocs();
        expect(provideHover(docs, "  - not-a-real-command x", 6, 0)).toBeNull();
        expect(provideHover(docs, "  - <player.name> x", 6, 0)).toBeNull();
    });
});
