"use strict";
/**
 * Renders meta objects as markdown for hover popups and completion detail panes.
 * Ported from DenizenLangServer/CommandTabCompletions.cs (DescriptionClean,
 * LinkMeta, ObligatoryText, Describe*).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.describeScript = exports.describeAction = exports.describeLang = exports.describeMech = exports.describeEvent = exports.describeTag = exports.describeCommand = exports.obligatoryText = exports.linkMeta = exports.descriptionClean = void 0;
const vscode_languageserver_1 = require("vscode-languageserver");
// `describeScript` only. checker/ modules never import providers/, so this direction adds no
// cycle: containerConvert and scriptWarnings both import nothing from here.
const scriptWarnings_1 = require("../checker/scriptWarnings");
const frenetic_1 = require("../checker/frenetic");
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
/** Keys shown BEFORE the definitions block. (CommandTabCompletions.cs:284) */
const SCRIPT_LEADING_KEYS = ['Description', 'Display Name', 'Title', 'Name Single'];
/** Keys shown AFTER it, as inline code. (CommandTabCompletions.cs:312) */
const SCRIPT_TRAILING_KEYS = ['ID', 'Entity_Type', 'Inventory', 'Size', 'Material', 'Book', 'Format'];
/** One of a container's keys as display text, or null when it has no such key. */
function scriptKeyText(script, key) {
    const entry = script.keys.get((0, frenetic_1.toLowerFast)(key));
    if (entry === undefined) {
        return null;
    }
    const value = entry.value;
    if (value instanceof scriptWarnings_1.LineTrackedString) {
        return value.text;
    }
    // CommandTabCompletions.cs:288-291: a list key is rendered as its own bulleted block.
    if (Array.isArray(value)) {
        return '\n' + value.map(o => `- ${o instanceof scriptWarnings_1.LineTrackedString ? o.text : String(o)}`).join('\n');
    }
    // A sub-mapping has no `ToString()` worth showing; the C# would print the dictionary's type
    // name here, which is noise rather than information.
    return null;
}
/**
 * Documentation for a script container, for completion items that offer one.
 * Ported from `DescribeScript` (CommandTabCompletions.cs:281-320).
 *
 * The shape is: a headline naming the type and name, then whichever of four descriptive keys the
 * container has, then its definitions with their bracketed explanations unpacked, then whichever
 * of seven identifying keys it has, and finally where to find it. Everything is conditional --
 * a container with none of those keys still gets a headline and a location.
 */
function describeScript(script) {
    let addedFirst = '';
    for (const key of SCRIPT_LEADING_KEYS) {
        const text = scriptKeyText(script, key);
        if (text !== null) {
            addedFirst += `\n**${key}:** ${text}  `;
        }
    }
    let defInfo = '';
    const definitions = scriptKeyText(script, 'definitions');
    if (definitions !== null) {
        defInfo = '\n### Definitions:';
        // `- define name[what it is for]` documents itself; the C# splits that apart so the
        // bracketed half becomes the description rather than part of the name.
        for (const def of definitions.split('|').map(s => s.trim()).filter(s => s.length > 0)) {
            let name = def;
            let info = '';
            if (def.includes('[') && def.endsWith(']')) {
                name = (0, frenetic_1.before)(def, '[').trim();
                info = (0, frenetic_1.beforeLast)((0, frenetic_1.after)(def, '['), ']').trim();
            }
            defInfo += `\n- **${name}:** ${info}  `;
        }
    }
    let addedAfter = '';
    for (const key of SCRIPT_TRAILING_KEYS) {
        const text = scriptKeyText(script, key);
        if (text !== null) {
            addedAfter += `\n**${key}:** \`${text}\`  `;
        }
    }
    // `lineNumber + 1` because the checker counts from 0 and humans count from 1.
    return markdown(`${script.type} script '${script.name}'  ${addedFirst}${defInfo}\n${addedAfter}\n`
        + `In \`${script.fileName}\` at line \`${script.lineNumber + 1}\``);
}
exports.describeScript = describeScript;
//# sourceMappingURL=describe.js.map