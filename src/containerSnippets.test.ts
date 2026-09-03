import { describe, it, expect } from 'vitest';
import { CONTAINER_SNIPPETS, containerSnippetText } from './containerSnippets';

/**
 * These tests exist because of a defect the user hit on 2026-09-01: the skeletons carried literal
 * two-space indents, which `vscode.SnippetString` inserts verbatim, so an editor configured for
 * four spaces produced a container indented two. The table was unreachable from a test at the
 * time, sitting behind extension.ts's `vscode` import, which is why it went unnoticed.
 */

/** Every line of every snippet, with the container name line included. */
function allLines(): { type: string; line: string }[] {
    const out: { type: string; line: string }[] = [];
    for (const entry of CONTAINER_SNIPPETS) {
        for (const line of containerSnippetText(entry).split('\n')) {
            out.push({ type: entry.type, line });
        }
    }
    return out;
}

describe('container snippet indentation', () => {
    it('indents with TABS ONLY, so the editor decides the width', () => {
        // THE REPORTED DEFECT. A literal indent space means the user's editor.tabSize and
        // editor.insertSpaces are ignored, and the container disagrees with every other line in
        // their file. VS Code normalises leading \t and only leading \t.
        // MUTANT CAUGHT: any body reverting to literal spaces for indentation.
        const bad = allLines().filter(({ line }) => /^\t* +/.test(line));
        expect(bad.map(b => `${b.type}: ${JSON.stringify(b.line)}`)).toEqual([]);
    });

    it('never mixes a tab in after the indent has ended', () => {
        // A tab inside the text (rather than in front of it) is not normalised and would land as a
        // raw tab in the file -- which the checker reports as `raw_tab_symbol`.
        const bad = allLines().filter(({ line }) => /\S[\s\S]*\t/.test(line));
        expect(bad.map(b => `${b.type}: ${JSON.stringify(b.line)}`)).toEqual([]);
    });

    it('starts the container name at column 0 and everything else deeper', () => {
        for (const entry of CONTAINER_SNIPPETS) {
            const lines = containerSnippetText(entry).split('\n');
            expect(lines[0].startsWith('\t')).toBe(false);
            for (const line of lines.slice(1)) {
                expect(line.startsWith('\t')).toBe(true);
            }
        }
    });

    it('never jumps more than one level deeper at a time', () => {
        // A skeleton that skips a level is a container Denizen cannot parse.
        for (const entry of CONTAINER_SNIPPETS) {
            let previous = 0;
            for (const line of containerSnippetText(entry).split('\n')) {
                const depth = /^\t*/.exec(line)![0].length;
                expect(depth, `${entry.type}: ${JSON.stringify(line)}`).toBeLessThanOrEqual(previous + 1);
                previous = depth;
            }
        }
    });
});

describe('container snippet content', () => {
    it('gives every container a debug line, directly under its type line', () => {
        // Requested by the user 2026-09-01. `debug` is container metadata the checker skips
        // alongside `type` and `speed` (ScriptChecker.cs:974-977), so it is safe on every type.
        // MUTANT CAUGHT: adding a new container type without the debug line.
        for (const entry of CONTAINER_SNIPPETS) {
            const lines = containerSnippetText(entry).split('\n');
            expect(lines[1], entry.type).toBe(`\ttype: ${entry.type}`);
            expect(lines[2], entry.type).toBe('\tdebug: false');
        }
    });

    it('names each snippet after the type it declares', () => {
        for (const entry of CONTAINER_SNIPPETS) {
            expect(containerSnippetText(entry).startsWith(`\${1:my_${entry.type}}:`)).toBe(true);
        }
    });

    it('covers the 17 known script types, with no duplicates', () => {
        const types = CONTAINER_SNIPPETS.map(e => e.type);
        expect(new Set(types).size).toBe(types.length);
        expect(types.sort()).toEqual([
            'assignment', 'book', 'command', 'custom', 'data', 'dialog', 'economy', 'enchantment',
            'entity', 'format', 'interact', 'inventory', 'item', 'map', 'procedure', 'task', 'world'
        ]);
    });

    it('numbers its tab stops from 2 upward, leaving ${1} for the container name', () => {
        // ${1} is the name line, so a body that also used ${1} would tie an inner placeholder to
        // the container's name and edit both at once.
        for (const entry of CONTAINER_SNIPPETS) {
            expect(/\$\{1[:}]/.test(entry.body), entry.type).toBe(false);
        }
    });

    it('reuses a tab stop only where the two places must stay in sync', () => {
        // `command` repeats ${2} for name/usage and `dialog` repeats ${5} for the input key and
        // the tag reading it. Both are deliberate: typing once should fill both.
        const repeated = CONTAINER_SNIPPETS.filter(e => {
            const stops = [...e.body.matchAll(/\$\{(\d+)[:}]/g)].map(m => m[1]);
            return new Set(stops).size !== stops.length;
        }).map(e => e.type);
        expect(repeated.sort()).toEqual(['command', 'dialog']);
    });
});
