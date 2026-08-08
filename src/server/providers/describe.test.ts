import { describe, it, expect } from 'vitest';
import { descriptionClean, linkMeta, obligatoryText, describeCommand, describeLang } from './describe';
import { MetaCommand, MetaLanguage, META_TYPE_COMMAND } from '../metaDocs/metaTypes';

describe('descriptionClean', () => {
    it('escapes markdown- and html-hostile characters', () => {
        expect(descriptionClean('a & b # c <d> `e`')).toBe('a &amp; b &#35; c &lt;d&gt; \'e\'');
    });

    it('converts a code block into a fenced yml block without escaping its contents', () => {
        const result = descriptionClean('before <code>- narrate <player.name></code> after');
        expect(result).toBe('before \n```yml\n- narrate <player.name>\n```\n after');
    });

    it('handles an unterminated code tag by escaping it like normal text', () => {
        expect(descriptionClean('oops <code> unterminated')).toBe('oops &lt;code&gt; unterminated');
    });

    it('converts multiple code blocks into fenced yml blocks while still escaping surrounding prose', () => {
        const result = descriptionClean('a & b <code>first</code> c & d <code>second</code> e & f');
        expect(result).toBe('a &amp; b \n```yml\nfirst\n```\n c &amp; d \n```yml\nsecond\n```\n e &amp; f');
    });

    it('returns an empty string unchanged', () => {
        expect(descriptionClean('')).toBe('');
    });
});

describe('linkMeta', () => {
    it('builds a meta.denizenscript.com link from the object type web path', () => {
        const cmd = new MetaCommand();
        cmd.type = META_TYPE_COMMAND;
        cmd.commandName = 'Narrate';
        expect(linkMeta(cmd)).toBe('[Meta Docs: Commands narrate](https://meta.denizenscript.com/Docs/Commands/narrate)');
    });

    it('url-encodes names containing symbols', () => {
        const cmd = new MetaCommand();
        cmd.type = META_TYPE_COMMAND;
        cmd.commandName = 'a b';
        expect(linkMeta(cmd)).toContain('/Docs/Commands/a%20b');
    });

    it('returns an empty string when the object type has no web path', () => {
        const cmd = new MetaCommand();
        cmd.type = null;
        cmd.commandName = 'narrate';
        expect(linkMeta(cmd)).toBe('');
    });
});

describe('obligatoryText', () => {
    it('is just blank padding when there is nothing to warn about', () => {
        const cmd = new MetaCommand();
        expect(obligatoryText(cmd)).toBe('\n\n');
    });

    it('reports plugin, deprecation, and warnings when present', () => {
        const cmd = new MetaCommand();
        cmd.plugin = 'Depenizen';
        cmd.deprecated = 'Use foo instead.';
        cmd.warnings = ['first', 'second'];
        const result = obligatoryText(cmd);
        expect(result).toContain('Required plugin(s) or platform(s): Depenizen');
        expect(result).toContain('Deprecation notice: Use foo instead.');
        expect(result).toContain('### WARNING\nfirst\n- second');
    });

    it('ignores a whitespace-only plugin value', () => {
        const cmd = new MetaCommand();
        cmd.plugin = '   ';
        expect(obligatoryText(cmd)).toBe('\n\n');
    });
});

describe('describeCommand', () => {
    it('renders markdown containing the name, syntax, and related tags', () => {
        const cmd = new MetaCommand();
        cmd.type = META_TYPE_COMMAND;
        cmd.commandName = 'narrate';
        cmd.short = 'Shows some text to the player.';
        cmd.syntax = 'narrate [<text>]';
        cmd.description = 'Prints text.';
        cmd.tags = ['<player.name>'];
        const result = describeCommand(cmd);
        expect(result.kind).toBe('markdown');
        expect(result.value).toContain('### Command narrate');
        expect(result.value).toContain('```xml\n- narrate [<text>]\n```');
        expect(result.value).toContain('Related Tags:\n- &lt;player.name&gt;');
    });
});

describe('describeLang', () => {
    it('renders the language name and description', () => {
        const lang = new MetaLanguage();
        lang.langName = 'Task Script Containers';
        lang.description = 'A task script.';
        const result = describeLang(lang);
        expect(result.value).toContain('### Task Script Containers');
        expect(result.value).toContain('A task script.');
    });
});
