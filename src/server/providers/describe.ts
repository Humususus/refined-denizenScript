/**
 * Renders meta objects as markdown for hover popups and completion detail panes.
 * Ported from DenizenLangServer/CommandTabCompletions.cs (DescriptionClean,
 * LinkMeta, ObligatoryText, Describe*).
 */

import { MarkupContent, MarkupKind } from 'vscode-languageserver';
import {
    MetaObject, MetaCommand, MetaTag, MetaEvent, MetaMechanism, MetaLanguage, MetaAction
} from '../metaDocs/metaTypes';

/**
 * Escapes text for safe display inside a markdown popup, lifting `<code>` blocks
 * out into fenced yml blocks (their contents are deliberately left unescaped so
 * example scripts render as real script text).
 */
export function descriptionClean(input: string): string {
    const codeStart = input.indexOf('<code>');
    if (codeStart !== -1) {
        const codeEnd = input.indexOf('</code>', codeStart);
        if (codeEnd !== -1) {
            return descriptionClean(input.substring(0, codeStart))
                + '\n```yml\n'
                + input.substring(codeStart + '<code>'.length, codeEnd).replace(/`/g, '\'')
                + '\n```\n'
                + descriptionClean(input.substring(codeEnd + '</code>'.length));
        }
    }
    return input
        .replace(/`/g, '\'')
        .replace(/&/g, '&amp;')
        .replace(/#/g, '&#35;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Builds a markdown link to the object's page on meta.denizenscript.com.
 * Returns an empty string for object types with no web presence (guide pages,
 * extensions) — the C# original would throw a null reference there instead.
 */
export function linkMeta(obj: MetaObject): string {
    const webPath = obj.type?.webPath;
    if (!webPath) {
        return '';
    }
    return `[Meta Docs: ${webPath} ${descriptionClean(obj.cleanName)}]`
        + `(https://meta.denizenscript.com/Docs/${webPath}/${encodeURIComponent(obj.cleanName)})`;
}

/** Renders the plugin requirement, deprecation notice, and warnings block shared by every description. */
export function obligatoryText(obj: MetaObject): string {
    let result = '\n\n';
    if (obj.plugin !== null && obj.plugin.trim().length > 0) {
        result += `Required plugin(s) or platform(s): ${descriptionClean(obj.plugin)}\n\n`;
    }
    if (obj.deprecated !== null && obj.deprecated.trim().length > 0) {
        result += `Deprecation notice: ${descriptionClean(obj.deprecated)}\n\n`;
    }
    if (obj.warnings.length > 0) {
        result += '### WARNING\n' + descriptionClean(obj.warnings.join('\n- ')) + '\n\n';
    }
    return result;
}

function markdown(value: string): MarkupContent {
    return { kind: MarkupKind.Markdown, value };
}

export function describeCommand(command: MetaCommand): MarkupContent {
    return markdown(
        `### Command ${command.name}\n${descriptionClean(command.short)}\n`
        + `\`\`\`xml\n- ${command.syntax}\n\`\`\`\n${linkMeta(command)}\n\n`
        + `${descriptionClean(command.description)}${obligatoryText(command)}`
        + `Related Tags:\n- ${descriptionClean(command.tags.join('\n- '))}`
    );
}

export function describeTag(tag: MetaTag): MarkupContent {
    return markdown(
        `### Tag ${descriptionClean(tag.name)}\n${linkMeta(tag)}\n\n`
        + `Returns: ${tag.returns}\n\n`
        + `${descriptionClean(tag.description)}${obligatoryText(tag)}`
    );
}

export function describeEvent(evt: MetaEvent): MarkupContent {
    return markdown(
        `### Event ${descriptionClean(evt.name)}\n${linkMeta(evt)}\n\n`
        + `Triggers: ${descriptionClean(evt.triggers)}\n\n`
        + `Contexts:\n- ${descriptionClean(evt.context.join('\n- '))}${obligatoryText(evt)}`
    );
}

export function describeMech(mechanism: MetaMechanism): MarkupContent {
    return markdown(
        `### ${mechanism.mechObject} Mechanism ${mechanism.mechName}\n${linkMeta(mechanism)}\n\n`
        + `Input: ${mechanism.input}\n\n`
        + `${descriptionClean(mechanism.description)}${obligatoryText(mechanism)}`
        + `Related Tags:\n- ${descriptionClean(mechanism.tags.join('\n- '))}`
    );
}

export function describeLang(lang: MetaLanguage): MarkupContent {
    return markdown(
        `### ${descriptionClean(lang.name)}\n${linkMeta(lang)}\n\n`
        + `${descriptionClean(lang.description)}${obligatoryText(lang)}`
    );
}

export function describeAction(action: MetaAction): MarkupContent {
    return markdown(
        `### Action ${descriptionClean(action.name)}\n\n${linkMeta(action)}\n\n`
        + `Triggers: ${descriptionClean(action.triggers)}\n\n`
        + `Contexts:\n- ${descriptionClean(action.context.join('\n- '))}${obligatoryText(action)}`
    );
}
