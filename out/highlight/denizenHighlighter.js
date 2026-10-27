"use strict";
// The Denizen syntax highlighter, as a pure tokenizer: no `vscode` import, so it can be unit-tested
// and shared by the decoration path and the semantic-tokens provider.
//
// MOVED MECHANICALLY from extension.ts (R3 Task 1). Every function body below is the one that was
// there, byte for byte, with exactly two kinds of change: `addDecor` appends a HighlightToken
// instead of creating a vscode.Range (its decorFixes line/column mapping is untouched), and the
// `decorations` parameter is typed HighlightToken[]. The "is this colour type enabled?" filter
// `addDecor` used to apply now lives in the caller, so this module emits every token it finds.
//
// Deliberate changes since the move, each marked where it happens: the definition-name and
// dotted-name off-by-ones (2.5.0), and comment classification delegated to ./commentKind (2.6.0).
Object.defineProperty(exports, "__esModule", { value: true });
exports.highlightLines = exports.highlightFragment = exports.getTagColor = exports.baseTagSpecialColors = exports.setHighlightOptions = exports.COLOR_TYPES = void 0;
const commentKind_1 = require("./commentKind");
exports.COLOR_TYPES = [
    "comment_header", "comment_normal", "comment_todo", "comment_code",
    "key", "key_inline", "command", "quote_double", "quote_single", "def_name",
    "event_line", "event_switch", "event_switch_value",
    "tag", "tag_dot", "tag_param", "tag_param_bracket",
    "bad_space", "space", "normal",
    "colons", "if_operators", "data_actions",
    // Appended in 2.6.0 -- semanticEncoding resolves overlaps by this order, so new types go last.
    "comment_warning", "comment_critical"
];
let headerSymbols = "|+=_@/";
let doInlineColors = true;
let displayDarkColors = false;
let tagSpecialColors = {};
let highlightColorRef = {};
/**
 * Installs the configuration the moved functions read as module state. Kept as module state
 * rather than threaded through every signature so the moved bodies stay identical; the objects
 * are held by reference, exactly as the old module-level variables were.
 */
function setHighlightOptions(opts) {
    headerSymbols = opts.headerSymbols;
    doInlineColors = opts.doInlineColors;
    displayDarkColors = opts.displayDarkColors;
    tagSpecialColors = opts.tagSpecialColors;
    highlightColorRef = opts.colorRef;
}
exports.setHighlightOptions = setHighlightOptions;
let decorFixes = [];
function addDecor(decorations, type, lineNumber, startChar, endChar) {
    const originalStartChar = startChar;
    const originalEndChar = endChar;
    let endLine = lineNumber;
    for (const dfix of decorFixes) {
        if (originalStartChar < dfix) {
            break;
        }
        lineNumber++;
        startChar = originalStartChar - dfix;
    }
    for (const dfix of decorFixes) {
        if (originalEndChar < dfix) {
            break;
        }
        endLine++;
        endChar = originalEndChar - dfix;
    }
    decorations.push({ line: lineNumber, start: startChar, endLine: endLine, end: endChar, type: type });
}
function decorateTag(tag, start, lineNumber, decorations) {
    const len = tag.length;
    let inTagCounter = 0;
    let tagStart = 0;
    let inTagParamCounter = 0;
    let defaultDecor = "tag";
    let lastDecor = -1; // Color the < too.
    let textColor = "tag_param";
    let lastDot = 0;
    let lastBracket = 0;
    for (let i = 0; i < len; i++) {
        const c = tag.charAt(i);
        if (c == '<') {
            inTagCounter++;
            if (inTagCounter == 1) {
                addDecor(decorations, defaultDecor, lineNumber, start + lastDecor, start + i);
                lastDecor = i;
                textColor = defaultDecor;
                defaultDecor = "tag";
                tagStart = i;
                lastDot = i;
            }
        }
        else if (c == '>' && inTagCounter > 0) {
            inTagCounter--;
            if (inTagCounter == 0) {
                const tagText = tag.substring(tagStart + 1, i);
                let autoColor = getTagColor(tagText, textColor);
                if (autoColor != null) {
                    addDecor(decorations, "auto:" + autoColor, lineNumber, start + tagStart + 1, start + i);
                    addDecor(decorations, "tag", lineNumber, start + tagStart, start + tagStart + 1);
                    defaultDecor = "auto:" + autoColor;
                    textColor = defaultDecor;
                }
                else {
                    decorateTag(tagText, start + tagStart + 1, lineNumber, decorations);
                    defaultDecor = inTagParamCounter > 0 ? textColor : "tag";
                }
                addDecor(decorations, "tag", lineNumber, start + i, start + i + 1);
                lastDecor = i + 1;
            }
        }
        else if (c == '[' && inTagCounter == 0 && i + 1 < len) {
            inTagParamCounter++;
            if (inTagParamCounter == 1) {
                lastBracket = i;
                addDecor(decorations, defaultDecor, lineNumber, start + lastDecor, start + i);
                addDecor(decorations, "tag_param_bracket", lineNumber, start + i, start + i + 1);
                lastDecor = i + 1;
                if (i == 0) {
                    defaultDecor = "def_name";
                }
                else {
                    const lastTag = tag.substring(0, i);
                    if (lastTag.endsWith(".flag") || lastTag.endsWith(".flag_expiration") || lastTag.endsWith(".has_flag")) {
                        defaultDecor = "def_name";
                    }
                    else {
                        defaultDecor = "tag_param";
                    }
                }
            }
        }
        else if (c == ']' && inTagCounter == 0) {
            inTagParamCounter--;
            if (inTagParamCounter == 0) {
                const lastTag = tag.substring(lastDot + 1, lastBracket);
                const bracketedText = tag.substring(lastBracket + 1, i);
                const colorFormat = "&[" + bracketedText.toLowerCase() + "]";
                if (lastTag == "custom_color" && !bracketedText.includes('<') && colorFormat in tagSpecialColors) {
                    const color = tagSpecialColors[colorFormat];
                    addDecor(decorations, "auto:" + color, lineNumber, start + lastDecor, start + i);
                }
                else if (defaultDecor == "def_name") {
                    decorateDefName(decorations, tag.substring(lastDecor, i), lineNumber, start + lastDecor);
                }
                else {
                    addDecor(decorations, defaultDecor, lineNumber, start + lastDecor, start + i);
                }
                addDecor(decorations, "tag_param_bracket", lineNumber, start + i, start + i + 1);
                defaultDecor = "tag";
                lastDecor = i + 1;
            }
        }
        else if ((c == '.' || c == '|') && inTagCounter == 0 && inTagParamCounter == 0) {
            addDecor(decorations, defaultDecor, lineNumber, start + lastDecor, start + i);
            lastDecor = i + 1;
            addDecor(decorations, "tag_dot", lineNumber, start + i, start + i + 1);
            lastDot = i;
        }
        else if (c == ' ' && inTagCounter == 0) {
            addDecor(decorations, defaultDecor, lineNumber, start + lastDecor, start + i);
            addDecor(decorations, "space", lineNumber, start + i, start + i + 1);
            lastDecor = i + 1;
        }
    }
    if (lastDecor < len) {
        addDecor(decorations, defaultDecor, lineNumber, start + lastDecor, start + len);
    }
}
const ifOperators = ["<", ">", "<=", ">=", "==", "!=", "||", "&&", "(", ")", "or", "not", "and", "in", "contains", "!in", "!contains", "matches", "!matches"];
const ifCmdLabels = ["cmd:if", "cmd:else", "cmd:while", "cmd:waituntil"];
const deffableCmdLabels = ["cmd:run", "cmd:runlater", "cmd:clickable", "cmd:bungeerun"];
/**
 * The `cmd:<name>` context label for a command, with any waitable/instant sigil stripped.
 *
 * `~` makes a command waitable and `^` makes it run instantly; neither is part of the name
 * (ScriptChecker.cs:809-812 strips them for exactly this reason). Without stripping them here the
 * label came out as `cmd:~run`, matching nothing in `deffableCmdLabels` or `ifCmdLabels`, so a
 * waitable command silently lost its `def:` name colouring and its `if` operator colouring.
 * Reported by the user 2026-09-01 for `~narrate`.
 */
function commandContextLabel(commandText) {
    const name = commandText.trim();
    return "cmd:" + (name.startsWith("~") || name.startsWith("^") ? name.substring(1) : name);
}
function checkIfHasTagEnd(arg, quoted, quoteMode, canQuote) {
    const len = arg.length;
    let params = 0;
    for (let i = 0; i < len; i++) {
        const c = arg.charAt(i);
        if (canQuote && (c == '"' || c == '\'')) {
            if (quoted && c == quoteMode) {
                quoted = false;
            }
            else if (!quoted) {
                quoted = true;
                quoteMode = c;
            }
        }
        else if (c == '[') {
            params++;
        }
        else if (c == ']' && params > 0) {
            params--;
        }
        else if (c == '>') {
            return true;
        }
    }
    return false;
}
exports.baseTagSpecialColors = {
    "&0": "#000000", "black": "#000000",
    "&1": "#0000AA", "dark_blue": "#0000AA",
    "&2": "#00AA00", "dark_green": "#00AA00",
    "&3": "#00AAAA", "dark_aqua": "#00AAAA",
    "&4": "#AA0000", "dark_red": "#AA0000",
    "&5": "#AA00AA", "dark_purple": "#AA00AA",
    "&6": "#FFAA00", "gold": "#FFAA00",
    "&7": "#AAAAAA", "gray": "#AAAAAA",
    "&8": "#555555", "dark_gray": "#555555",
    "&9": "#5555FF", "blue": "#5555FF",
    "&a": "#55FF55", "green": "#55FF55",
    "&b": "#55FFFF", "aqua": "#55FFFF",
    "&c": "#FF5555", "red": "#FF5555",
    "&d": "#FF55FF", "light_purple": "#FF55FF",
    "&e": "#FFFF55", "yellow": "#FFFF55",
    "&f": "#FFFFFF", "white": "#FFFFFF", "&r": "#FFFFFF", "reset": "#FFFFFF"
};
const formatCodes = {
    "&l": "bold", "bold": "bold",
    "&o": "italic", "italic": "italic",
    "&m": "strike", "strikethrough": "strike",
    "&n": "underline", "underline": "underline"
};
const hexChars = {};
const hexRefStr = "abcdefABCDEF0123456789";
for (let hexID = 0; hexID < hexRefStr.length; hexID++) {
    hexChars[hexRefStr.charAt(hexID)] = true;
}
function isHex(text) {
    for (let i = 0; i < text.length; i++) {
        let c = text.charAt(i);
        if (!(c in hexChars)) {
            return false;
        }
    }
    return true;
}
function getColorData(color) {
    if (color.startsWith("#")) {
        return color;
    }
    if (color.startsWith("auto:#")) {
        return color.substring("auto:".length);
    }
    const knownColor = highlightColorRef[color];
    if (knownColor) {
        return knownColor;
    }
    return null;
}
function fixDark(color) {
    if (color == null) {
        return null;
    }
    if (displayDarkColors) {
        return color;
    }
    const splitter = color.indexOf('|');
    const part = splitter == -1 ? color : color.substring(0, splitter);
    if (!part.startsWith('#') || part.length < 7) {
        return color;
    }
    const red = parseInt(part.substring(1, 3), 16);
    const green = parseInt(part.substring(3, 5), 16);
    const blue = parseInt(part.substring(5, 7), 16);
    if (red < 64 && green < 64 && blue < 64) {
        return null;
    }
    return color;
}
function getTagColor(tagText, preColor) {
    if (!doInlineColors) {
        return null;
    }
    tagText = tagText.toLowerCase();
    if (tagText.startsWith("#") && tagText.length == 7 && isHex(tagText.substring(1))) {
        return fixDark(tagText);
    }
    if (tagText in tagSpecialColors) {
        return fixDark(tagSpecialColors[tagText]);
    }
    if (tagText.startsWith("&color[") && tagText.endsWith("]") && !tagText.includes(".")) {
        const colorText = tagText.substring("&color[".length, tagText.length - 1);
        if (colorText.length == 7 && colorText.startsWith("#") && isHex(colorText.substring(1))) {
            return fixDark(colorText);
        }
    }
    const formatter = formatCodes[tagText];
    if (formatter) {
        const rgb = getColorData(preColor);
        if (rgb) {
            if (formatter == "bold") {
                return rgb + "|weight=bold";
            }
            else if (formatter == "italic") {
                return rgb + "|style=italic";
            }
            else if (formatter == "strike") {
                return rgb + "|strike=true";
            }
            else if (formatter == "underline") {
                return rgb + "|underline=true";
            }
        }
    }
    return null;
}
exports.getTagColor = getTagColor;
const TAG_ALLOWED = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&_#[";
const dataActions = [":->:", ":<-:", ":|:", ":!", ":++", ":--", ":<-", ":+:", ":-:", ":*:", ":/:", ":"];
function decorateArg(arg, start, lineNumber, decorations, canQuote, contextualLabel) {
    const len = arg.length;
    let quoted = false;
    let quoteMode = 'x';
    let inTagCounter = 0;
    let tagStart = 0;
    const referenceDefault = "normal";
    let defaultDecor = referenceDefault;
    let lastDecor = 0;
    let hasTagEnd = checkIfHasTagEnd(arg, false, 'x', canQuote);
    let spaces = 0;
    let textColor = referenceDefault;
    for (let i = 0; i < len; i++) {
        const c = arg.charAt(i);
        if (canQuote && (c == '"' || c == '\'')) {
            if (quoted && c == quoteMode) {
                addDecor(decorations, defaultDecor, lineNumber, start + lastDecor, start + i);
                addDecor(decorations, c == '"' ? "quote_double" : "quote_single", lineNumber, start + i, start + i + 1);
                lastDecor = i + 1;
                defaultDecor = referenceDefault;
                textColor = defaultDecor;
                quoted = false;
            }
            else if (!quoted) {
                addDecor(decorations, defaultDecor, lineNumber, start + lastDecor, start + i);
                lastDecor = i;
                quoted = true;
                defaultDecor = c == '"' ? "quote_double" : "quote_single";
                textColor = defaultDecor;
                quoteMode = c;
            }
        }
        else if (hasTagEnd && c == '<' && i + 1 < len && TAG_ALLOWED.includes(arg.charAt(i + 1))) {
            inTagCounter++;
            if (inTagCounter == 1) {
                addDecor(decorations, defaultDecor, lineNumber, start + lastDecor, start + i);
                lastDecor = i;
                tagStart = i;
                defaultDecor = "tag";
            }
        }
        else if (hasTagEnd && c == '>' && inTagCounter > 0) {
            inTagCounter--;
            if (inTagCounter == 0) {
                const tagText = arg.substring(tagStart + 1, i);
                let autoColor = getTagColor(tagText, textColor);
                if (autoColor != null) {
                    addDecor(decorations, "tag", lineNumber, start + tagStart, start + tagStart + 1);
                    addDecor(decorations, "auto:" + autoColor, lineNumber, start + tagStart + 1, start + i);
                    defaultDecor = "auto:" + autoColor;
                    textColor = defaultDecor;
                }
                else {
                    decorateTag(tagText, start + tagStart + 1, lineNumber, decorations);
                    defaultDecor = textColor;
                }
                addDecor(decorations, "tag", lineNumber, start + i, start + i + 1);
                lastDecor = i + 1;
            }
        }
        else if (inTagCounter == 0 && c == ':' && deffableCmdLabels.includes(contextualLabel.replaceAll("~", ""))) {
            let part = arg.substring(lastDecor, i);
            let bump = 0;
            const origPart = part;
            if (canQuote && (part.startsWith("'") || part.startsWith('"'))) {
                part = part.substring(1);
                bump = 1;
            }
            if (part.startsWith("def.") && !part.includes('<') && !part.includes(' ')) {
                if (bump == 1) {
                    addDecor(decorations, origPart.startsWith('"') ? "quote_double" : "quote_single", lineNumber, start + lastDecor, start + lastDecor + 1);
                    addDecor(decorations, "normal", lineNumber, start + lastDecor + 1, start + lastDecor + 1 + "def.".length);
                }
                else {
                    addDecor(decorations, defaultDecor, lineNumber, start + lastDecor, start + lastDecor + "def.".length);
                }
                decorateDefName(decorations, part.substring("def.".length), lineNumber, start + bump + lastDecor + "def.".length);
                lastDecor = i;
            }
        }
        else if (c == ' ' && (quoted || !canQuote) && inTagCounter == 0) {
            addDecor(decorations, defaultDecor, lineNumber, start + lastDecor, start + i);
            addDecor(decorations, "space", lineNumber, start + i, start + i + 1);
            lastDecor = i + 1;
        }
        else if (c == ' ' && !quoted && canQuote && inTagCounter == 0) {
            hasTagEnd = checkIfHasTagEnd(arg.substring(i + 1), quoted, quoteMode, canQuote);
            addDecor(decorations, defaultDecor, lineNumber, start + lastDecor, start + i);
            addDecor(decorations, "space", lineNumber, start + i, start + i + 1);
            lastDecor = i + 1;
            if (!quoted) {
                inTagCounter = 0;
                defaultDecor = canQuote ? referenceDefault : textColor;
                spaces++;
            }
            const nextArg = arg.includes(" ", i + 1) ? arg.substring(i + 1, arg.indexOf(" ", i + 1)) : arg.substring(i + 1);
            if (!quoted && canQuote) {
                if (ifOperators.includes(nextArg) && ifCmdLabels.includes(contextualLabel)) {
                    addDecor(decorations, "if_operators", lineNumber, start + i + 1, start + i + 1 + nextArg.length);
                    i += nextArg.length;
                    lastDecor = i + 1;
                }
                else if (nextArg.startsWith("as:") && !nextArg.includes("<") && (contextualLabel == "cmd:foreach" || contextualLabel == "cmd:repeat")) {
                    addDecor(decorations, "normal", lineNumber, start + i + 1, start + i + 1 + "as:".length);
                    decorateDefName(decorations, nextArg.substring("as:".length), lineNumber, start + i + 1 + "as:".length);
                    i += nextArg.length;
                    lastDecor = i + 1;
                }
                else if (nextArg.startsWith("key:") && !nextArg.includes("<") && contextualLabel == "cmd:foreach") {
                    addDecor(decorations, "normal", lineNumber, start + i + 1, start + i + 1 + "key:".length);
                    decorateDefName(decorations, nextArg.substring("key:".length), lineNumber, start + i + 1 + "key:".length);
                    i += nextArg.length;
                    lastDecor = i + 1;
                }
                else if (spaces == 1 && (contextualLabel == "cmd:define" || contextualLabel == "cmd:definemap") || contextualLabel == "cmd:flag") {
                    let colonIndex = nextArg.indexOf(':');
                    if (colonIndex == -1) {
                        if (contextualLabel != "cmd:flag") {
                            colonIndex = nextArg.length;
                        }
                    }
                    if (contextualLabel == "cmd:flag" && nextArg.startsWith("expire:")) {
                        colonIndex = -1;
                    }
                    const tagMark = nextArg.indexOf('<');
                    if ((tagMark == -1 || tagMark > colonIndex) && colonIndex != -1) {
                        const argStart = nextArg.charAt(0);
                        let bump = 0;
                        if (!quoted && canQuote && (argStart == '"' || argStart == '\'')) {
                            quoted = true;
                            defaultDecor = argStart == '"' ? "quote_double" : "quote_single";
                            quoteMode = argStart;
                            bump = 1;
                            addDecor(decorations, defaultDecor, lineNumber, start + i + 1, start + i + 2);
                        }
                        decorateDefName(decorations, nextArg.substring(bump, colonIndex), lineNumber, start + i + 1 + bump);
                        i += colonIndex;
                        // The name ends at i + 1 (where its ':' is, if any) whether or not it was
                        // quoted -- colonIndex is measured in nextArg, which includes the quote.
                        // This was `i + bump`, one short for an unquoted name, so a `normal` run
                        // covered the name's last letter (fixed 2.5.0).
                        lastDecor = i + 1;
                        const afterColon = nextArg.substring(colonIndex);
                        for (let possible of dataActions) {
                            if (afterColon.startsWith(possible)) {
                                addDecor(decorations, "data_actions", lineNumber, start + i + 1, start + i + 1 + possible.length);
                                lastDecor = i + possible.length + 1;
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
    if (lastDecor < len) {
        addDecor(decorations, defaultDecor, lineNumber, start + lastDecor, start + len);
    }
}
function indexOfAny(text, searches, start) {
    let least = -1;
    for (let search of searches) {
        const thisHit = text.indexOf(search, start);
        if (thisHit != -1 && (thisHit < least || least == -1)) {
            least = thisHit;
        }
    }
    return least;
}
function decorateDefName(decorations, part, lineNumber, start) {
    let dot = indexOfAny(part, ['.', '|'], 0);
    let lastIndex = 0;
    while (dot != -1) {
        addDecor(decorations, "def_name", lineNumber, start + lastIndex, start + dot);
        addDecor(decorations, "tag_dot", lineNumber, start + dot, start + dot + 1);
        lastIndex = dot + 1;
        dot = indexOfAny(part, ['.', '|'], dot + 1);
    }
    addDecor(decorations, "def_name", lineNumber, start + lastIndex, start + part.length);
}
function decorateComment(line, lineNumber, decorType, decorations) {
    decorateSpaceable(line, 0, lineNumber, decorType, decorations);
}
function decorateSpaceable(line, preLength, lineNumber, decorType, decorations) {
    const len = line.length;
    let lastDecor = 0;
    for (let i = 0; i < len; i++) {
        const c = line.charAt(i);
        if (c == ' ') {
            addDecor(decorations, decorType, lineNumber, preLength + lastDecor, preLength + i);
            addDecor(decorations, "space", lineNumber, preLength + i, preLength + i + 1);
            lastDecor = i + 1;
        }
    }
    if (lastDecor < len) {
        addDecor(decorations, decorType, lineNumber, preLength + lastDecor, preLength + len);
    }
}
const definiteNotScriptKeys = [
    "interact scripts", "default constants", "data", "constants", "text", "lore", "aliases", "slots", "enchantments", "input", "description"
];
function decorateLine(line, lineNumber, decorations, lastKey, isData) {
    if (line.endsWith("\r")) {
        line = line.substring(0, line.length - 1);
    }
    const trimmedEnd = line.trimEnd();
    let trimmed = trimmedEnd.trimStart().replaceAll('\n', ' ').toLowerCase();
    if (trimmed.length == 0) {
        return;
    }
    // Trailing whitespace used to be marked bad_space here (removed 2026-10-26, user report): it is
    // harmless in Denizen, and after a command a blank line of spaces is joined on as a
    // continuation, so the red block landed in the next line's indentation where nothing was wrong.
    const preSpaces = trimmedEnd.length - trimmed.length;
    if (trimmed.startsWith("#")) {
        decorateComment(line, lineNumber, (0, commentKind_1.commentKind)(line, headerSymbols), decorations);
    }
    else if (trimmed.startsWith("-")) {
        const isNonScript = isData;
        addDecor(decorations, "normal", lineNumber, preSpaces, preSpaces + 1);
        if (isNonScript) {
            decorateArg(trimmed.substring(1), preSpaces + 1, lineNumber, decorations, false, "non-script");
        }
        else {
            if (trimmed.endsWith(":")) {
                addDecor(decorations, "colons", lineNumber, preSpaces + trimmed.length - 1, preSpaces + trimmed.length);
                trimmed = trimmed.substring(0, trimmed.length - 1);
            }
            const afterDash = trimmed.substring(1);
            const commandEnd = afterDash.indexOf(' ', 1) + 1;
            const endIndexCleaned = preSpaces + (commandEnd == 0 ? trimmed.length : commandEnd);
            const commandText = commandEnd == 0 ? afterDash : afterDash.substring(0, commandEnd);
            if (!afterDash.startsWith(" ")) {
                addDecor(decorations, "bad_space", lineNumber, preSpaces + 1, endIndexCleaned);
                decorateArg(trimmed.substring(commandEnd), preSpaces + commandEnd, lineNumber, decorations, false, commandContextLabel(commandText));
            }
            else {
                if (commandText.includes("'") || commandText.includes("\"") || commandText.includes("[")) {
                    decorateArg(trimmed.substring(2), preSpaces + 2, lineNumber, decorations, false, "non-cmd");
                }
                else {
                    addDecor(decorations, "command", lineNumber, preSpaces + 2, endIndexCleaned);
                    if (commandEnd > 0) {
                        decorateArg(trimmed.substring(commandEnd), preSpaces + commandEnd, lineNumber, decorations, true, commandContextLabel(commandText));
                    }
                }
            }
        }
    }
    else if (trimmed.endsWith(":")) {
        if (trimmed.startsWith("on ") || trimmed.startsWith("after ")) {
            decorateEventLine(trimmed.substring(0, trimmed.length - 1), preSpaces, lineNumber, decorations);
        }
        else {
            decorateSpaceable(trimmed.substring(0, trimmed.length - 1), preSpaces, lineNumber, "key", decorations);
        }
        addDecor(decorations, "colons", lineNumber, trimmedEnd.length - 1, trimmedEnd.length);
    }
    else if (trimmed.includes(": ")) {
        const colonIndex = line.indexOf(": ");
        const key = trimmed.substring(0, colonIndex - preSpaces);
        decorateSpaceable(key, preSpaces, lineNumber, "key_inline", decorations);
        addDecor(decorations, "colons", lineNumber, colonIndex, colonIndex + 1);
        addDecor(decorations, "space", lineNumber, colonIndex + 1, colonIndex + 2);
        if (key == "definitions") {
            decorateDefinitionsKey(trimmed.substring(colonIndex - preSpaces + 2), colonIndex + 2, lineNumber, decorations);
        }
        else {
            decorateArg(trimmed.substring(colonIndex - preSpaces + 2), colonIndex + 2, lineNumber, decorations, false, "key:" + key);
        }
    }
    else {
        addDecor(decorations, "bad_space", lineNumber, preSpaces, line.length);
    }
}
function decorateDefinitionsKey(arg, start, lineNumber, decorations) {
    const len = arg.length;
    let lastDecor = 0;
    let textColor = "def_name";
    for (let i = 0; i < len; i++) {
        const c = arg.charAt(i);
        if (c == '[') {
            addDecor(decorations, textColor, lineNumber, start + lastDecor, start + i);
            addDecor(decorations, "tag_param_bracket", lineNumber, start + i, start + i + 1);
            textColor = "tag_param";
            lastDecor = i + 1;
        }
        else if (c == ']') {
            addDecor(decorations, textColor, lineNumber, start + lastDecor, start + i);
            addDecor(decorations, "tag_param_bracket", lineNumber, start + i, start + i + 1);
            textColor = "bad_space";
            lastDecor = i + 1;
        }
        else if (c == ' ') {
            addDecor(decorations, textColor, lineNumber, start + lastDecor, start + i);
            addDecor(decorations, "space", lineNumber, start + i, start + i + 1);
            lastDecor = i + 1;
        }
        else if (c == '|') {
            addDecor(decorations, textColor, lineNumber, start + lastDecor, start + i);
            addDecor(decorations, "normal", lineNumber, start + i, start + i + 1);
            textColor = "def_name";
            lastDecor = i + 1;
        }
    }
    if (lastDecor < len - 1) {
        addDecor(decorations, textColor, lineNumber, start + lastDecor, start + len);
    }
}
function decorateEventLine(line, preLength, lineNumber, decorations) {
    let charIndex = 0;
    for (let arg of line.split(' ')) {
        let format = "event_line";
        if (charIndex == 0 && (arg == 'on' || arg == 'after')) {
            format = "key";
        }
        if (charIndex > 0) {
            addDecor(decorations, "space", lineNumber, preLength + charIndex - 1, preLength + charIndex);
        }
        const colon = arg.indexOf(':');
        if (colon != -1) {
            addDecor(decorations, "event_switch", lineNumber, preLength + charIndex, preLength + charIndex + colon);
            addDecor(decorations, "colons", lineNumber, preLength + charIndex + colon, preLength + charIndex + colon + 1);
            addDecor(decorations, "event_switch_value", lineNumber, preLength + charIndex + colon + 1, preLength + charIndex + arg.length);
        }
        else {
            addDecor(decorations, format, lineNumber, preLength + charIndex, preLength + charIndex + arg.length);
        }
        charIndex += arg.length + 1;
    }
}
/**
 * Colours the expanded tag view (R8): a FRAGMENT, one `<list[…]>` / `<map[…]>` tag spread over
 * several lines, not a script. Read as script lines, none is a command, a key or a comment, so
 * `decorateLine` painted every line `bad_space` -- the reported "red list". Here the lines are
 * joined into one argument, exactly as a command continued onto deeper lines is, and coloured as
 * that argument; `decorFixes` maps the offsets back to lines and columns.
 */
function highlightFragment(splitText, opts) {
    setHighlightOptions(opts);
    const decorations = [];
    decorFixes = [];
    let text = '';
    splitText.forEach((line, i) => {
        const clean = line.endsWith('\r') ? line.substring(0, line.length - 1) : line;
        if (i > 0) {
            decorFixes.push(text.length + 1);
            text += '\n';
        }
        text += clean;
    });
    if (text.trim().length > 0) {
        decorateArg(text, 0, 0, decorations, false, 'non-script');
    }
    decorFixes = [];
    return decorations;
}
exports.highlightFragment = highlightFragment;
/**
 * Tokenizes `splitText` (the document split on '\n'). Scans from line 0 so that key and data-block
 * state is right, but emits only for lines at or after `startLine` -- the partial-refresh contract
 * decorateFile relied on.
 */
function highlightLines(splitText, opts, startLine = 0, endLine = splitText.length) {
    setHighlightOptions(opts);
    const decorations = [];
    let lastKey = "";
    let definitelyDataSpacing = -1;
    // Actually choose colors
    for (let i = 0; i < endLine; i++) {
        let lineText = splitText[i];
        const trimmedLineStart = lineText.trimStart();
        const spaces = lineText.length - trimmedLineStart.length;
        const trimmedLine = trimmedLineStart.trimEnd();
        if (trimmedLine.endsWith(":") && !trimmedLine.startsWith("-")) {
            lastKey = trimmedLine.substring(0, trimmedLine.length - 1).toLowerCase();
            if (spaces <= definitelyDataSpacing) {
                definitelyDataSpacing = -1;
            }
            if (definiteNotScriptKeys.includes(lastKey) && definitelyDataSpacing == -1) {
                definitelyDataSpacing = spaces;
            }
        }
        else if (trimmedLine == "type: data" && (definitelyDataSpacing == -1 || spaces <= definitelyDataSpacing)) {
            definitelyDataSpacing = spaces - 1;
        }
        if (spaces < definitelyDataSpacing) {
            definitelyDataSpacing = -1;
        }
        decorFixes = [];
        let lineNum = i;
        if (trimmedLine.startsWith("- ") && !trimmedLine.endsWith(":")) {
            while (i + 1 < splitText.length) {
                const nextLine = splitText[i + 1];
                const nextTrimmedLineStart = nextLine.trimStart();
                const nextSpaces = nextLine.length - nextTrimmedLineStart.length;
                const nextTrimmedLine = nextTrimmedLineStart.trimEnd();
                if (nextSpaces > spaces && !nextTrimmedLine.startsWith("- ")) {
                    decorFixes.push(lineText.length + 1);
                    lineText += "\n" + nextLine;
                    i++;
                    if (nextTrimmedLine.endsWith(':')) {
                        break;
                    }
                }
                else {
                    break;
                }
            }
        }
        if (trimmedLine.startsWith("- definemap ") && trimmedLine.endsWith(":") && definitelyDataSpacing == -1) {
            definitelyDataSpacing = spaces + 1;
        }
        if (i >= startLine) {
            decorateLine(lineText, lineNum, decorations, lastKey, definitelyDataSpacing != -1);
        }
    }
    return decorations;
}
exports.highlightLines = highlightLines;
//# sourceMappingURL=denizenHighlighter.js.map