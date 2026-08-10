"use strict";
/**
 * Renders meta objects as markdown for hover popups and completion detail panes.
 * Ported from DenizenLangServer/CommandTabCompletions.cs (DescriptionClean,
 * LinkMeta, ObligatoryText, Describe*).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.describeAction = exports.describeLang = exports.describeMech = exports.describeEvent = exports.describeTag = exports.describeCommand = exports.obligatoryText = exports.linkMeta = exports.descriptionClean = void 0;
const vscode_languageserver_1 = require("vscode-languageserver");
/**
 * Escapes text for safe display inside a markdown popup, lifting `<code>` blocks
 * out into fenced yml blocks (their contents are deliberately left unescaped so
 * example scripts render as real script text).
 */
function descriptionClean(input) {
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
exports.descriptionClean = descriptionClean;
/**
 * Builds a markdown link to the object's page on meta.denizenscript.com.
 *
 * Two deliberate deviations from the C# original (CommandTabCompletions.cs:357):
 * 1. Returns an empty string for object types with no web presence (guide pages,
 *    extensions) — the C# original would throw a null reference there instead.
 * 2. Uses JS `encodeURIComponent` instead of `HttpUtility.UrlEncode`. These are
 *    NOT equivalent in general (`UrlEncode` encodes a space as `+` and also
 *    escapes `'`, whereas `encodeURIComponent` encodes a space as `%20` and
 *    leaves `'`, `(`, `)`, `!`, `*` unescaped). This is intentional, not an
 *    oversight: the encoded name here is a URL *path* segment, not a query
 *    string or form field, and `+` only means "space" in the latter two
 *    contexts — for a path segment, `%20` is the correct percent-encoding.
 *    Verified against the live site: e.g. multi-word event/action names like
 *    `player clicks button` resolve correctly as
 *    `https://meta.denizenscript.com/Docs/Events/player%20clicks%20button`.
 */
function linkMeta(obj) {
    var _a;
    const webPath = (_a = obj.type) === null || _a === void 0 ? void 0 : _a.webPath;
    if (!webPath) {
        return '';
    }
    return `[Meta Docs: ${webPath} ${descriptionClean(obj.cleanName)}]`
        + `(https://meta.denizenscript.com/Docs/${webPath}/${encodeURIComponent(obj.cleanName)})`;
}
exports.linkMeta = linkMeta;
/** Renders the plugin requirement, deprecation notice, and warnings block shared by every description. */
function obligatoryText(obj) {
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
exports.obligatoryText = obligatoryText;
function markdown(value) {
    return { kind: vscode_languageserver_1.MarkupKind.Markdown, value };
}
function describeCommand(command) {
    return markdown(`### Command ${command.name}\n${descriptionClean(command.short)}\n`
        + `\`\`\`xml\n- ${command.syntax}\n\`\`\`\n${linkMeta(command)}\n\n`
        + `${descriptionClean(command.description)}${obligatoryText(command)}`
        + `Related Tags:\n- ${descriptionClean(command.tags.join('\n- '))}`);
}
exports.describeCommand = describeCommand;
function describeTag(tag) {
    return markdown(`### Tag ${descriptionClean(tag.name)}\n${linkMeta(tag)}\n\n`
        + `Returns: ${tag.returns}\n\n`
        + `${descriptionClean(tag.description)}${obligatoryText(tag)}`);
}
exports.describeTag = describeTag;
function describeEvent(evt) {
    return markdown(`### Event ${descriptionClean(evt.name)}\n${linkMeta(evt)}\n\n`
        + `Triggers: ${descriptionClean(evt.triggers)}\n\n`
        + `Contexts:\n- ${descriptionClean(evt.context.join('\n- '))}${obligatoryText(evt)}`);
}
exports.describeEvent = describeEvent;
function describeMech(mechanism) {
    return markdown(`### ${mechanism.mechObject} Mechanism ${mechanism.mechName}\n${linkMeta(mechanism)}\n\n`
        + `Input: ${mechanism.input}\n\n`
        + `${descriptionClean(mechanism.description)}${obligatoryText(mechanism)}`
        + `Related Tags:\n- ${descriptionClean(mechanism.tags.join('\n- '))}`);
}
exports.describeMech = describeMech;
function describeLang(lang) {
    return markdown(`### ${descriptionClean(lang.name)}\n${linkMeta(lang)}\n\n`
        + `${descriptionClean(lang.description)}${obligatoryText(lang)}`);
}
exports.describeLang = describeLang;
function describeAction(action) {
    return markdown(`### Action ${descriptionClean(action.name)}\n\n${linkMeta(action)}\n\n`
        + `Triggers: ${descriptionClean(action.triggers)}\n\n`
        + `Contexts:\n- ${descriptionClean(action.context.join('\n- '))}${obligatoryText(action)}`);
}
exports.describeAction = describeAction;
//# sourceMappingURL=describe.js.map