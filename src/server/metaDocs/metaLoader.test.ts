import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { extractJavaCommentLines, getCorrectUrl, extractMetaBlocks } from './metaLoader';

describe('extractJavaCommentLines', () => {
    it('extracts trimmed // comment lines from .java entries only', () => {
        const zip = new AdmZip();
        zip.addFile('repo-dev/src/Foo.java', Buffer.from(
            'public class Foo {\n' +
            '    // <--[command]\n' +
            '    // @Name foo\n' +
            '    // -->\n' +
            '    int x = 1; // not a doc comment start but still starts with //\n' +
            '}\n'
        ));
        zip.addFile('repo-dev/README.md', Buffer.from('// this should be ignored, not a .java file\n'));
        const zipBuffer = zip.toBuffer();

        const lines = extractJavaCommentLines(zipBuffer);
        const texts = lines.map(l => l[2]);
        expect(texts).toContain('<--[command]');
        expect(texts).toContain('@Name foo');
        expect(texts).toContain('-->');
        expect(texts).not.toContain('this should be ignored, not a .java file');
        for (const [, file] of lines) {
            expect(file).toBe('repo-dev/src/Foo.java');
        }
    });

    it('produces an empty comment for a bare // line', () => {
        const zip = new AdmZip();
        zip.addFile('r/A.java', Buffer.from('//\n// text\n'));
        const lines = extractJavaCommentLines(zip.toBuffer());
        expect(lines[0][2]).toBe('');
        expect(lines[1][2]).toBe('text');
    });
});

describe('getCorrectUrl', () => {
    it('builds a github blob link for github archive sources', () => {
        const url = getCorrectUrl('https://github.com/DenizenScript/Denizen/archive/dev.zip', 'Denizen-dev/src/Foo.java', 42);
        expect(url).toBe('https://github.com/DenizenScript/Denizen/blob/dev/src/Foo.java#L42');
    });

    it('falls back to a plain description for non-github sources', () => {
        const url = getCorrectUrl('https://example.com/data.txt', 'data.txt', 5);
        expect(url).toBe('Web source https://example.com/data.txt file data.txt line 5');
    });
});

describe('extractMetaBlocks', () => {
    it('splits <--[type] ... --> blocks into objectType + data lines', () => {
        const lines: Array<[number, string, string]> = [
            [1, 'F.java', '<--[command]'],
            [2, 'F.java', '@Name narrate'],
            [3, 'F.java', '@Short Sends a message.'],
            [4, 'F.java', '-->'],
            [5, 'F.java', 'not part of any block'],
            [6, 'F.java', '<--[tag]'],
            [7, 'F.java', '@attribute <player.name>'],
            [8, 'F.java', '-->']
        ];
        const errors: string[] = [];
        const blocks = extractMetaBlocks('https://github.com/DenizenScript/Denizen/archive/dev.zip', lines, errors);
        expect(blocks.length).toBe(2);
        expect(blocks[0].objectType).toBe('command');
        expect(blocks[0].data).toEqual(['@Name narrate', '@Short Sends a message.', '@end_meta']);
        expect(blocks[1].objectType).toBe('tag');
        expect(blocks[1].data).toEqual(['@attribute <player.name>', '@end_meta']);
        expect(errors).toEqual([]);
    });

    it('records an error and skips a block that never closes', () => {
        const lines: Array<[number, string, string]> = [
            [1, 'A.java', '<--[command]'],
            [2, 'A.java', '@Name foo'],
            [3, 'B.java', 'this belongs to a different file']
        ];
        const errors: string[] = [];
        const blocks = extractMetaBlocks('src', lines, errors);
        expect(blocks.length).toBe(0);
        expect(errors.length).toBe(1);
    });

    it('records an error for a nested block start', () => {
        const lines: Array<[number, string, string]> = [
            [1, 'A.java', '<--[command]'],
            [2, 'A.java', '<--[tag]'],
            [3, 'A.java', '-->']
        ];
        const errors: string[] = [];
        const blocks = extractMetaBlocks('src', lines, errors);
        expect(errors.length).toBe(1);
    });

    it('records an error for a stray <-- that is not a valid start', () => {
        const lines: Array<[number, string, string]> = [[1, 'A.java', '<-- not valid']];
        const errors: string[] = [];
        extractMetaBlocks('src', lines, errors);
        expect(errors.length).toBe(1);
    });
});
