"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const languageClientNode = require("vscode-languageclient/node");
const path = require("path");
const fs = require("fs");
const https = require("https");
const languageServerPath = "server/DenizenLangServer.dll";
let configuration = vscode.workspace.getConfiguration();
let headerSymbols = "|+=#_@/";
let outputChannel = vscode.window.createOutputChannel("Denizen");
let debugHighlighting = false;
let debugFolding = false;
let doInlineColors = true;
let displayDarkColors = false;
let useCustomSyntaxColors = false;
class HighlightCache {
    constructor() {
        this.needRefreshStartLine = -1;
        this.needRefreshEndLine = -1;
        this.needRefreshLineShift = 0;
        this.lastDecorations = {};
    }
}
let HLCaches = new Map();
function getCache(path) {
    let result = HLCaches.get(path);
    if (result) {
        return result;
    }
    result = new HighlightCache();
    HLCaches.set(path, result);
    return result;
}
function activateLanguageServer(context, dotnetPath) {
    if (!dotnetPath || dotnetPath.length === 0) {
        dotnetPath = "dotnet";
    }
    let pathFile = context.asAbsolutePath(languageServerPath);
    if (!fs.existsSync(pathFile)) {
        return;
    }
    let pathDir = path.dirname(pathFile);
    let serverOptions = {
        run: { command: dotnetPath, args: [pathFile], options: { cwd: pathDir } },
        debug: { command: dotnetPath, args: [pathFile, "--debug"], options: { cwd: pathDir } }
    };
    let clientOptions = {
        documentSelector: ["denizenscript"],
        synchronize: {
            configurationSection: "denizenscript",
        },
        middleware: {
            provideCompletionItem: (document, position, context, token, next) => {
                if (isIndexedCompletionContext(document, position)) {
                    return [];
                }
                return next(document, position, context, token);
            },
            handleDiagnostics: (uri, diagnostics, next) => {
                next(uri, diagnostics.filter(diagnostic => !isDialogScriptDiagnostic(uri, diagnostic)));
            }
        }
    };
    let client = new languageClientNode.LanguageClient("DenizenLangServer", "Denizen Language Server", serverOptions, clientOptions);
    let disposable = client.start();
    context.subscriptions.push(disposable);
}
const highlightDecors = {};
const highlightColorRef = {};
function parseColor(inColor) {
    const colorSplit = inColor.split('\|');
    let resultColor = { color: colorSplit[0] };
    let strike = false;
    let underline = false;
    for (const i in colorSplit) {
        const subValueSplit = colorSplit[i].split('=', 2);
        const subValueSetting = subValueSplit[0];
        if (subValueSetting == "style") {
            resultColor.fontStyle = subValueSplit[1];
        }
        else if (subValueSetting == "weight") {
            resultColor.fontWeight = subValueSplit[1];
        }
        else if (subValueSetting == "strike") {
            strike = subValueSplit[1] == "true";
        }
        else if (subValueSetting == "underline") {
            underline = subValueSplit[1] == "true";
        }
        else if (subValueSetting == "background") {
            resultColor.backgroundColor = subValueSplit[1];
        }
    }
    if (strike || underline) {
        if (strike && !underline) {
            resultColor.textDecoration = "line-through";
        }
        else if (underline && !strike) {
            resultColor.textDecoration = "underline";
        }
        else {
            resultColor.textDecoration = "underline line-through";
        }
    }
    return resultColor;
}
function colorSet(name, inColor) {
    highlightDecors[name] = vscode.window.createTextEditorDecorationType(parseColor(inColor));
    highlightColorRef[name] = inColor;
}
const colorTypes = [
    "comment_header", "comment_normal", "comment_todo", "comment_code",
    "key", "key_inline", "command", "quote_double", "quote_single", "def_name",
    "event_line", "event_switch", "event_switch_value",
    "tag", "tag_dot", "tag_param", "tag_param_bracket",
    "bad_space", "space", "normal",
    "colons", "if_operators", "data_actions"
];
function loadAllColors() {
    configuration = vscode.workspace.getConfiguration();
    useCustomSyntaxColors = configuration.get("denizenscript.behaviors.use_custom_syntax_colors") === true;
    if (!useCustomSyntaxColors) {
        return;
    }
    for (const i in colorTypes) {
        let str = configuration.get("denizenscript.theme_colors." + colorTypes[i]);
        if (str === undefined) {
            outputChannel.appendLine("Missing color config for " + colorTypes[i]);
            continue;
        }
        colorSet(colorTypes[i], str);
    }
    headerSymbols = configuration.get("denizenscript.header_symbols");
    debugHighlighting = configuration.get("denizenscript.debug.highlighting");
    debugFolding = configuration.get("denizenscript.debug.folding");
    doInlineColors = configuration.get("denizenscript.behaviors.do_inline_colors");
    displayDarkColors = configuration.get("denizenscript.behaviors.display_dark_colors");
    const customColors = configuration.get("denizenscript.theme_colors.text_color_map");
    const colorsSplit = customColors.split(',');
    for (const i in colorsSplit) {
        const color = colorsSplit[i];
        let pair = color.split('=');
        if (pair.length == 2) {
            tagSpecialColors["&[" + pair[0].toLowerCase() + "]"] = pair[1];
        }
        else {
            outputChannel.appendLine("Cannot interpret color " + color);
        }
    }
}
function activateHighlighter(context) {
    loadAllColors();
}
function pathKey(uri) {
    return uri.toString();
}
function sortedSetValues(values) {
    return Array.from(values).sort((a, b) => a.localeCompare(b));
}
class DenizenSymbolSet {
    constructor() {
        this.defines = new Set();
        this.playerFlags = new Set();
        this.serverFlags = new Set();
    }
}
class DenizenWorkspaceIndex {
    constructor() {
        this.byFile = new Map();
        this.defines = new Set();
        this.playerFlags = new Set();
        this.serverFlags = new Set();
    }
    refreshWorkspace() {
        return __awaiter(this, void 0, void 0, function* () {
            const files = yield vscode.workspace.findFiles("**/*.dsc", "**/{node_modules,.git}/**");
            this.byFile.clear();
            for (const file of files) {
                this.updateUri(file);
            }
            this.rebuildMerged();
        });
    }
    updateDocument(document) {
        if (!isDenizenUri(document.uri)) {
            return;
        }
        this.byFile.set(pathKey(document.uri), this.parseText(document.getText()));
        this.rebuildMerged();
    }
    updateUri(uri) {
        if (!isDenizenUri(uri)) {
            return;
        }
        const openDoc = vscode.workspace.textDocuments.filter(doc => pathKey(doc.uri) == pathKey(uri))[0];
        if (openDoc) {
            this.updateDocument(openDoc);
            return;
        }
        try {
            const text = fs.readFileSync(uri.fsPath, { encoding: "utf-8", flag: "r" });
            this.byFile.set(pathKey(uri), this.parseText(text));
        }
        catch (err) {
            this.byFile.delete(pathKey(uri));
        }
    }
    deleteUri(uri) {
        this.byFile.delete(pathKey(uri));
        this.rebuildMerged();
    }
    rebuildMerged() {
        this.defines = new Set();
        this.playerFlags = new Set();
        this.serverFlags = new Set();
        this.byFile.forEach(symbols => {
            symbols.defines.forEach(value => this.defines.add(value));
            symbols.playerFlags.forEach(value => this.playerFlags.add(value));
            symbols.serverFlags.forEach(value => this.serverFlags.add(value));
        });
    }
    parseText(text) {
        const symbols = new DenizenSymbolSet();
        const defineMatcher = /^\s*-\s*define\s+([A-Za-z_][A-Za-z0-9_]*)\b/i;
        const flagMatcher = /^\s*-\s*flag\s+(player|server)\s+([A-Za-z_][A-Za-z0-9_\-.]*)(?::|\s|$)/i;
        for (const rawLine of text.replace(/\r/g, "").split("\n")) {
            const defineMatch = defineMatcher.exec(rawLine);
            if (defineMatch) {
                symbols.defines.add(defineMatch[1]);
                continue;
            }
            const flagMatch = flagMatcher.exec(rawLine);
            if (flagMatch) {
                if (flagMatch[1].toLowerCase() == "player") {
                    symbols.playerFlags.add(flagMatch[2]);
                }
                else {
                    symbols.serverFlags.add(flagMatch[2]);
                }
            }
        }
        return symbols;
    }
}
const workspaceIndex = new DenizenWorkspaceIndex();
function getExtensionVersion(context) {
    try {
        const packageJson = JSON.parse(fs.readFileSync(context.asAbsolutePath("package.json"), { encoding: "utf-8", flag: "r" }));
        return packageJson.version || "0.0.0";
    }
    catch (err) {
        outputChannel.appendLine("Failed to read extension package version: " + err);
        return "0.0.0";
    }
}
function normalizeVersion(version) {
    return version.trim().replace(/^v/i, "").split(/[+-]/)[0];
}
function compareVersions(left, right) {
    const leftParts = normalizeVersion(left).split(".").map(part => parseInt(part, 10) || 0);
    const rightParts = normalizeVersion(right).split(".").map(part => parseInt(part, 10) || 0);
    const max = Math.max(leftParts.length, rightParts.length);
    for (let i = 0; i < max; i++) {
        const l = i < leftParts.length ? leftParts[i] : 0;
        const r = i < rightParts.length ? rightParts[i] : 0;
        if (l > r) {
            return 1;
        }
        if (l < r) {
            return -1;
        }
    }
    return 0;
}
function githubGetJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                "Accept": "application/vnd.github+json",
                "User-Agent": "refined-denizenscript-vscode"
            }
        }, response => {
            if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                githubGetJson(response.headers.location).then(resolve, reject);
                return;
            }
            if (response.statusCode != 200) {
                reject(new Error("GitHub returned HTTP " + response.statusCode));
                response.resume();
                return;
            }
            let data = "";
            response.setEncoding("utf8");
            response.on("data", chunk => data += chunk);
            response.on("end", () => {
                try {
                    resolve(JSON.parse(data));
                }
                catch (err) {
                    reject(err);
                }
            });
        }).on("error", reject);
    });
}
function getReleaseVsixUrl(release) {
    if (!release.assets) {
        return undefined;
    }
    const asset = release.assets.filter(item => item.name.toLowerCase().endsWith(".vsix"))[0];
    return asset ? asset.browser_download_url : undefined;
}
function checkForUpdates(context, manual) {
    return __awaiter(this, void 0, void 0, function* () {
        const updateConfig = vscode.workspace.getConfiguration("refinedDenizenscript.update");
        const repo = updateConfig.get("githubRepo") || "Humususus/refined-denizenScript";
        if (!repo || repo.indexOf("/") == -1) {
            if (manual) {
                vscode.window.showErrorMessage("Refined DenizenScript update repo is invalid. Use owner/repo format.");
            }
            return;
        }
        if (!manual && updateConfig.get("autoCheck") === false) {
            return;
        }
        const intervalHours = updateConfig.get("checkIntervalHours") || 12;
        const now = Date.now();
        const lastCheck = context.globalState.get("refinedDenizenscript.lastUpdateCheck") || 0;
        if (!manual && now - lastCheck < Math.max(1, intervalHours) * 60 * 60 * 1000) {
            return;
        }
        yield context.globalState.update("refinedDenizenscript.lastUpdateCheck", now);
        try {
            const currentVersion = getExtensionVersion(context);
            const release = yield githubGetJson("https://api.github.com/repos/" + repo + "/releases/latest");
            const latestVersion = release.tag_name || "";
            if (compareVersions(latestVersion, currentVersion) <= 0) {
                if (manual) {
                    vscode.window.showInformationMessage("Refined DenizenScript is up to date. Current version: " + currentVersion + ".");
                }
                return;
            }
            const downloadUrl = getReleaseVsixUrl(release);
            const choice = yield vscode.window.showInformationMessage("Refined DenizenScript " + latestVersion + " is available. Current version: " + currentVersion + ".", "Open Release", downloadUrl ? "Download VSIX" : "");
            if (choice == "Open Release") {
                vscode.env.openExternal(vscode.Uri.parse(release.html_url));
            }
            else if (choice == "Download VSIX" && downloadUrl) {
                vscode.env.openExternal(vscode.Uri.parse(downloadUrl));
            }
        }
        catch (err) {
            outputChannel.appendLine("Failed to check Refined DenizenScript updates: " + err);
            if (manual) {
                vscode.window.showErrorMessage("Failed to check Refined DenizenScript updates. See Denizen output for details.");
            }
        }
    });
}
function activateUpdateChecks(context) {
    context.subscriptions.push(vscode.commands.registerCommand("refinedDenizenscript.checkForUpdates", () => checkForUpdates(context, true)));
    checkForUpdates(context, false);
}
const denizenCategories = [
    { label: "main", folder: "main", description: "Main scripts" },
    { label: "dialog", folder: "dialog", description: "Dialog scripts" },
    { label: "handle", folder: "handle", description: "Handler scripts" },
    { label: "data", folder: "data", description: "Data scripts" },
    { label: "util", folder: "util", description: "Utility scripts" },
    { label: "world", folder: "world", description: "World scripts" },
    { label: "animation", folder: "animation", description: "Animation scripts" }
];
function getWorkspaceRoot() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length == 0) {
        vscode.window.showErrorMessage("Open a workspace folder before creating DenizenScript files.");
        return undefined;
    }
    return folders[0].uri;
}
function getDenizenScriptRoot() {
    const root = getWorkspaceRoot();
    if (!root) {
        return undefined;
    }
    return vscode.Uri.file(path.join(root.fsPath, "denizen", "script"));
}
function ensureDirectory(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
function normalizePathForMatch(filePath) {
    return filePath.replaceAll("\\", "/").toLowerCase();
}
function isInsideDenizenScriptPath(filePath) {
    return normalizePathForMatch(filePath).indexOf("/denizen/script/") != -1;
}
function appendDscExtension(fileName) {
    return fileName.toLowerCase().endsWith(".dsc") ? fileName : fileName + ".dsc";
}
function pickDenizenCategory() {
    return __awaiter(this, void 0, void 0, function* () {
        const picked = yield vscode.window.showQuickPick(denizenCategories, {
            placeHolder: "Select DenizenScript category"
        });
        return picked ? picked.folder : undefined;
    });
}
function createDenizenCategory(uri) {
    return __awaiter(this, void 0, void 0, function* () {
        const root = getWorkspaceRoot();
        if (!root) {
            return;
        }
        const targetRoot = getSelectedFolder(uri) || root.fsPath;
        const category = yield pickDenizenCategory();
        if (!category) {
            return;
        }
        const categoryPath = path.join(targetRoot, category);
        ensureDirectory(categoryPath);
        vscode.window.showInformationMessage("Created DenizenScript category: " + vscode.workspace.asRelativePath(categoryPath));
    });
}
function getSelectedFolder(uri) {
    if (uri && uri.fsPath) {
        try {
            const stat = fs.statSync(uri.fsPath);
            if (stat.isDirectory()) {
                return uri.fsPath;
            }
            return path.dirname(uri.fsPath);
        }
        catch (err) {
            return undefined;
        }
    }
    return undefined;
}
function getScriptTargetFolder(uri) {
    return __awaiter(this, void 0, void 0, function* () {
        const selectedFolder = getSelectedFolder(uri);
        if (selectedFolder && isInsideDenizenScriptPath(selectedFolder + path.sep)) {
            return selectedFolder;
        }
        const scriptRoot = getDenizenScriptRoot();
        if (!scriptRoot) {
            return undefined;
        }
        const category = yield pickDenizenCategory();
        if (!category) {
            return undefined;
        }
        const categoryPath = path.join(scriptRoot.fsPath, category);
        ensureDirectory(categoryPath);
        return categoryPath;
    });
}
function createDenizenScriptFile(uri) {
    return __awaiter(this, void 0, void 0, function* () {
        const targetFolder = yield getScriptTargetFolder(uri);
        if (!targetFolder) {
            return;
        }
        const rawName = yield vscode.window.showInputBox({
            prompt: "DenizenScript file name",
            placeHolder: "my_script"
        });
        if (!rawName) {
            return;
        }
        const fileName = appendDscExtension(rawName.trim());
        const targetFile = path.join(targetFolder, fileName);
        ensureDirectory(targetFolder);
        if (!fs.existsSync(targetFile)) {
            fs.writeFileSync(targetFile, "", { encoding: "utf-8" });
        }
        const doc = yield vscode.workspace.openTextDocument(vscode.Uri.file(targetFile));
        vscode.window.showTextDocument(doc);
    });
}
function activateDenizenFileCommands(context) {
    context.subscriptions.push(vscode.commands.registerCommand("refinedDenizenscript.createCategory", createDenizenCategory));
    context.subscriptions.push(vscode.commands.registerCommand("refinedDenizenscript.createScriptFile", createDenizenScriptFile));
    const watcher = vscode.workspace.createFileSystemWatcher("**/denizen/script/**/*");
    watcher.onDidCreate(uri => {
        try {
            if (!isInsideDenizenScriptPath(uri.fsPath) || path.extname(uri.fsPath) != "") {
                return;
            }
            const stat = fs.statSync(uri.fsPath);
            if (stat.isDirectory()) {
                return;
            }
            const newPath = uri.fsPath + ".dsc";
            if (!fs.existsSync(newPath)) {
                fs.renameSync(uri.fsPath, newPath);
            }
        }
        catch (err) {
            outputChannel.appendLine("Failed to append .dsc to new script file: " + err);
        }
    }, null, context.subscriptions);
    context.subscriptions.push(watcher);
}
function getCompletionRange(document, position, typedLength) {
    return new vscode.Range(new vscode.Position(position.line, position.character - typedLength), position);
}
function makeCompletion(label, kind, detail, range) {
    const item = new vscode.CompletionItem(label, kind);
    item.detail = detail;
    item.insertText = label;
    item.range = range;
    return item;
}
function getDenizenCompletions(document, position) {
    const linePrefix = document.lineAt(position).text.substring(0, position.character);
    const defineMatch = /<\[([A-Za-z0-9_]*)$/.exec(linePrefix);
    if (defineMatch) {
        const range = getCompletionRange(document, position, defineMatch[1].length);
        return sortedSetValues(workspaceIndex.defines).map(value => makeCompletion(value, vscode.CompletionItemKind.Variable, "Denizen define", range));
    }
    const playerFlagMatch = /<player\.flag\[([A-Za-z0-9_\-.]*)$/i.exec(linePrefix);
    if (playerFlagMatch) {
        const range = getCompletionRange(document, position, playerFlagMatch[1].length);
        return sortedSetValues(workspaceIndex.playerFlags).map(value => makeCompletion(value, vscode.CompletionItemKind.Field, "Denizen player flag", range));
    }
    const serverFlagMatch = /<server\.flag\[([A-Za-z0-9_\-.]*)$/i.exec(linePrefix);
    if (serverFlagMatch) {
        const range = getCompletionRange(document, position, serverFlagMatch[1].length);
        return sortedSetValues(workspaceIndex.serverFlags).map(value => makeCompletion(value, vscode.CompletionItemKind.Field, "Denizen server flag", range));
    }
    return [];
}
function isIndexedCompletionContext(document, position) {
    const linePrefix = document.lineAt(position).text.substring(0, position.character);
    return /<\[([A-Za-z0-9_]*)$/i.test(linePrefix)
        || /<player\.flag\[([A-Za-z0-9_\-.]*)$/i.test(linePrefix)
        || /<server\.flag\[([A-Za-z0-9_\-.]*)$/i.test(linePrefix);
}
function activateWorkspaceCompletions(context) {
    workspaceIndex.refreshWorkspace();
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider("denizenscript", {
        provideCompletionItems(document, position) {
            workspaceIndex.updateDocument(document);
            return getDenizenCompletions(document, position);
        }
    }, "[", "."));
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.dsc");
    watcher.onDidCreate(uri => {
        workspaceIndex.updateUri(uri);
        if (denizenTreeProvider) {
            denizenTreeProvider.refresh();
        }
    }, null, context.subscriptions);
    watcher.onDidChange(uri => {
        workspaceIndex.updateUri(uri);
        if (denizenTreeProvider) {
            denizenTreeProvider.refresh();
        }
    }, null, context.subscriptions);
    watcher.onDidDelete(uri => {
        workspaceIndex.deleteUri(uri);
        if (denizenTreeProvider) {
            denizenTreeProvider.refresh();
        }
    }, null, context.subscriptions);
    context.subscriptions.push(watcher);
}
function isDenizenUri(uri) {
    return uri.fsPath.toLowerCase().endsWith(".dsc");
}
function getDenizenFileKind(name) {
    const lower = name.toLowerCase();
    if (lower.indexOf("handle") != -1) {
        return "handle";
    }
    if (lower.indexOf("data") != -1) {
        return "data";
    }
    if (lower.indexOf("dialog") != -1) {
        return "dialog";
    }
    if (lower.indexOf("task") != -1) {
        return "task";
    }
    if (lower.indexOf("command") != -1 || lower.indexOf("cmd") != -1) {
        return "command";
    }
    if (lower.indexOf("world") != -1) {
        return "world";
    }
    if (lower.indexOf("inventory") != -1 || lower.indexOf("inv") != -1) {
        return "inventory";
    }
    return "script";
}
function getKindLabel(kind) {
    if (kind == "handle") {
        return "Handle";
    }
    if (kind == "data") {
        return "Data";
    }
    if (kind == "dialog") {
        return "Dialog";
    }
    if (kind == "task") {
        return "Task";
    }
    if (kind == "command") {
        return "Command";
    }
    if (kind == "world") {
        return "World";
    }
    if (kind == "inventory") {
        return "Inventory";
    }
    return "Scripts";
}
function getIconPath(context, kind) {
    let icon = "dsc.svg";
    let lightIcon = "dsc_light.svg";
    if (kind == "handle") {
        icon = "handle_d_icon.svg";
        lightIcon = "handle_d_icon_light.svg";
    }
    else if (kind == "data") {
        icon = "data_d_icon.svg";
        lightIcon = "data_d_icon_light.svg";
    }
    else if (kind == "dialog") {
        icon = "dialog_d_icon.svg";
        lightIcon = "dialog_d_icon_light.svg";
    }
    return {
        light: context.asAbsolutePath(path.join("icons", lightIcon)),
        dark: context.asAbsolutePath(path.join("icons", icon))
    };
}
class DenizenTreeItem extends vscode.TreeItem {
}
class DenizenTreeProvider {
    constructor(context) {
        this.files = [];
        this.groups = [];
        this.onDidChangeTreeDataEmitter = new vscode.EventEmitter();
        this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
        this.context = context;
    }
    refresh() {
        this.loadFiles().then(() => this.onDidChangeTreeDataEmitter.fire(undefined));
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!element) {
                yield this.loadFiles();
                return this.groups.map(group => {
                    const item = new DenizenTreeItem(getKindLabel(group), vscode.TreeItemCollapsibleState.Expanded);
                    item.kindName = group;
                    item.iconPath = getIconPath(this.context, group);
                    return item;
                });
            }
            const group = element.kindName;
            return this.files
                .filter(uri => getDenizenFileKind(path.basename(uri.fsPath)) == group)
                .sort((a, b) => path.basename(a.fsPath).localeCompare(path.basename(b.fsPath)))
                .map(uri => {
                const item = new DenizenTreeItem(path.basename(uri.fsPath), vscode.TreeItemCollapsibleState.None);
                item.uri = uri;
                item.kindName = group;
                item.description = vscode.workspace.asRelativePath(uri);
                item.tooltip = uri.fsPath;
                item.iconPath = getIconPath(this.context, group);
                item.command = {
                    command: "vscode.open",
                    title: "Open",
                    arguments: [uri]
                };
                return item;
            });
        });
    }
    loadFiles() {
        return __awaiter(this, void 0, void 0, function* () {
            this.files = yield vscode.workspace.findFiles("**/*.dsc", "**/{node_modules,.git}/**");
            const groups = new Set();
            this.files.forEach(uri => groups.add(getDenizenFileKind(path.basename(uri.fsPath))));
            this.groups = sortedSetValues(groups);
        });
    }
}
let denizenTreeProvider;
function activateDenizenTree(context) {
    denizenTreeProvider = new DenizenTreeProvider(context);
    vscode.window.registerTreeDataProvider("denizenScripts", denizenTreeProvider);
    denizenTreeProvider.refresh();
}
function isDialogScriptDiagnostic(uri, diagnostic) {
    const message = diagnostic.message.toLowerCase();
    if (message.indexOf("script") == -1) {
        return false;
    }
    const document = vscode.workspace.textDocuments.filter(doc => pathKey(doc.uri) == pathKey(uri))[0];
    if (!document) {
        return false;
    }
    const lines = document.getText().replace(/\r/g, "").split("\n");
    let startLine = diagnostic.range.start.line;
    while (startLine >= 0 && lines[startLine].trim().length == 0) {
        startLine--;
    }
    let topLine = startLine;
    let topIndent = Number.MAX_VALUE;
    for (let i = startLine; i >= 0; i--) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.length == 0 || trimmed.startsWith("#")) {
            continue;
        }
        const indent = line.length - line.trimStart().length;
        if (trimmed.endsWith(":") && !trimmed.startsWith("-") && indent <= topIndent) {
            topLine = i;
            topIndent = indent;
            if (indent == 0) {
                break;
            }
        }
    }
    const blockIndent = topIndent == Number.MAX_VALUE ? 0 : topIndent;
    for (let i = topLine + 1; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.length == 0 || trimmed.startsWith("#")) {
            continue;
        }
        const indent = line.length - line.trimStart().length;
        if (indent <= blockIndent) {
            break;
        }
        if (/^type\s*:\s*dialog\s*$/i.test(trimmed)) {
            return true;
        }
    }
    return false;
}
let refreshTimer = undefined;
function refreshDecor() {
    refreshTimer = undefined;
    if (!useCustomSyntaxColors) {
        return;
    }
    for (const editor of vscode.window.visibleTextEditors) {
        const uri = editor.document.uri.toString();
        if (!uri.endsWith(".dsc")) {
            continue;
        }
        decorateFullFile(editor);
    }
}
let decorFixes = [];
function addDecor(decorations, type, lineNumber, startChar, endChar) {
    if (!(type in highlightDecors) && type.startsWith("auto:")) {
        highlightDecors[type] = vscode.window.createTextEditorDecorationType(parseColor(type.substring("auto:".length)));
        decorations[type] = [];
    }
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
    decorations[type].push(new vscode.Range(new vscode.Position(lineNumber, startChar), new vscode.Position(endLine, endChar)));
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
const tagSpecialColors = {
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
const TAG_ALLOWED = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&_[";
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
                        lastDecor = i + bump;
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
        addDecor(decorations, "tag_dot", lineNumber, start + dot - 1, start + dot + 1);
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
    if (trimmedEnd.length != line.length) {
        addDecor(decorations, "bad_space", lineNumber, trimmedEnd.length, line.length);
    }
    const preSpaces = trimmedEnd.length - trimmed.length;
    if (trimmed.startsWith("#")) {
        const afterComment = trimmed.substring(1).trim();
        const symbol = afterComment.length == 0 ? ' ' : afterComment.charAt(0);
        if (headerSymbols.includes(symbol)) {
            decorateComment(line, lineNumber, "comment_header", decorations);
        }
        else if (afterComment.startsWith("-")) {
            decorateComment(line, lineNumber, "comment_code", decorations);
        }
        else if (afterComment.toLowerCase().startsWith("todo")) {
            decorateComment(line, lineNumber, "comment_todo", decorations);
        }
        else {
            decorateComment(line, lineNumber, "comment_normal", decorations);
        }
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
                decorateArg(trimmed.substring(commandEnd), preSpaces + commandEnd, lineNumber, decorations, false, "cmd:" + commandText.trim());
            }
            else {
                if (commandText.includes("'") || commandText.includes("\"") || commandText.includes("[")) {
                    decorateArg(trimmed.substring(2), preSpaces + 2, lineNumber, decorations, false, "non-cmd");
                }
                else {
                    addDecor(decorations, "command", lineNumber, preSpaces + 2, endIndexCleaned);
                    if (commandEnd > 0) {
                        decorateArg(trimmed.substring(commandEnd), preSpaces + commandEnd, lineNumber, decorations, true, "cmd:" + commandText.trim());
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
function decorateFullFile(editor) {
    let decorations = {};
    let highlight = getCache(editor.document.uri.toString());
    if (Object.keys(highlight.lastDecorations).length === 0) {
        highlight.needRefreshStartLine = -1;
    }
    if (highlight.needRefreshStartLine == -1) {
        for (const c in highlightDecors) {
            decorations[c] = [];
        }
    }
    else {
        if (highlight.needRefreshLineShift > 0) {
            highlight.needRefreshEndLine += highlight.needRefreshLineShift;
        }
        if (highlight.needRefreshLineShift < 0) {
            highlight.needRefreshStartLine += highlight.needRefreshLineShift;
        }
        decorations = highlight.lastDecorations;
        for (const c in highlightDecors) {
            const rangeSet = decorations[c];
            if (highlight.needRefreshLineShift != 0) {
                for (let i = rangeSet.length - 1; i >= 0; i--) {
                    if (highlight.needRefreshLineShift > 0 ? (rangeSet[i].start.line >= highlight.needRefreshEndLine - highlight.needRefreshLineShift) : (rangeSet[i].start.line >= highlight.needRefreshStartLine - highlight.needRefreshLineShift)) {
                        rangeSet[i] = new vscode.Range(new vscode.Position(rangeSet[i].start.line + highlight.needRefreshLineShift, rangeSet[i].start.character), new vscode.Position(rangeSet[i].end.line + highlight.needRefreshLineShift, rangeSet[i].end.character));
                    }
                }
            }
            for (let i = rangeSet.length - 1; i >= 0; i--) {
                if (rangeSet[i].start.line <= highlight.needRefreshEndLine && rangeSet[i].end.line >= highlight.needRefreshStartLine) {
                    rangeSet.splice(i, 1);
                }
            }
        }
    }
    const fullText = editor.document.getText();
    const splitText = fullText.split('\n');
    const totalLines = splitText.length;
    let lastKey = "";
    const startLine = (highlight.needRefreshStartLine == -1 ? 0 : highlight.needRefreshStartLine);
    const endLine = (highlight.needRefreshStartLine == -1 ? totalLines : Math.min(highlight.needRefreshEndLine + 1, totalLines));
    if (debugHighlighting) {
        if (highlight.needRefreshStartLine == -1) {
            let type = "normal";
            if (highlight.needRefreshEndLine == 999999) {
                type = "forced";
            }
            else if (Object.keys(highlight.lastDecorations).length === 0) {
                type = "missing-keys-induced";
            }
            outputChannel.appendLine("Doing " + type + " full highlight of entire file, for file: " + editor.document.fileName);
        }
        else {
            outputChannel.appendLine("Doing partial highlight of file from start " + startLine + " to end " + endLine + ", for file: " + editor.document.fileName);
        }
    }
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
    // Apply them
    for (const c in decorations) {
        editor.setDecorations(highlightDecors[c], decorations[c]);
    }
    highlight.lastDecorations = decorations;
    highlight.needRefreshStartLine = -1;
    highlight.needRefreshEndLine = -1;
    highlight.needRefreshLineShift = 0;
}
function denizenScriptFoldingProvider(document, context, token) {
    const fullText = document.getText();
    const splitText = fullText.split('\n');
    const totalLines = splitText.length;
    const output = [];
    const processing = [];
    if (debugFolding) {
        outputChannel.appendLine("(FOLDING) Begin");
    }
    for (let i = 0; i < totalLines; i++) {
        const line = splitText[i];
        const preTrimmed = line.trimStart();
        if (preTrimmed.length == 0) {
            continue;
        }
        const spaces = line.length - preTrimmed.length;
        const fullTrimmed = preTrimmed.trimEnd();
        const isBlock = fullTrimmed.endsWith(":");
        const isCommand = fullTrimmed.startsWith("-");
        while (processing.length > 0) {
            const lastFold = processing[processing.length - 1];
            if (lastFold.spacing > spaces || spaces == 0 || (lastFold.spacing == spaces && ((isBlock && !isCommand) || lastFold.isCommand))) {
                processing.pop();
                output.push(new vscode.FoldingRange(lastFold.start, i - 1));
                if (debugFolding) {
                    outputChannel.appendLine("(FOLDING) Found an end at " + i);
                }
            }
            else {
                break;
            }
        }
        if (isBlock) {
            processing.push(new InProcFold(i, spaces, isCommand));
            if (debugFolding) {
                outputChannel.appendLine("(FOLDING) Found a start at " + i);
            }
        }
    }
    if (debugFolding) {
        outputChannel.appendLine("(FOLDING) Folds calculated with " + output.length + " normal and " + processing.length + " left");
    }
    for (let i = 0; i < processing.length; i++) { // for-each style loop bugs out and thinks the value is a String, so have to do 'i' counter style loop
        const extraFold = processing[i];
        output.push(new vscode.FoldingRange(extraFold.start, totalLines - 1));
    }
    return output;
}
function scheduleRefresh() {
    if (refreshTimer) {
        return;
    }
    refreshTimer = setTimeout(refreshDecor, 50);
}
function activateDotNet() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            outputChannel.appendLine("DenizenScript extension attempting to acquire .NET 8");
            const requestingExtensionId = 'DenizenScript.denizenscript';
            const result = yield vscode.commands.executeCommand('dotnet.acquire', { version: '8.0', requestingExtensionId });
            outputChannel.appendLine("DenizenScript extension NET 8 Acquire result: " + result + ": " + result["dotnetPath"]);
            return result["dotnetPath"];
        }
        catch (error) {
            outputChannel.appendLine("Error: " + error);
            return "";
        }
    });
}
function forceRefresh(reason) {
    if (debugHighlighting) {
        outputChannel.appendLine("Scheduled a force full refresh of syntax highlighting because: " + reason);
    }
    HLCaches.clear();
    scheduleRefresh();
}
let changeCounter = 0;
let hasLoadedConfig = false;
let searchedPathsForConfig = [];
let configColors = {};
function applyConfigColors() {
    for (const name in configColors) {
        const val = configColors[name];
        let color = "";
        if (val.startsWith("<") && val.endsWith(">")) {
            for (const tag of val.slice(1, -1).split("><")) {
                const newColor = getTagColor(tag, color);
                if (newColor) {
                    color = newColor;
                }
            }
        }
        if (color != "") {
            tagSpecialColors["&[" + name + "]"] = color;
        }
    }
}
function tryLoadConfigYaml(relativeTo) {
    if (hasLoadedConfig) {
        return;
    }
    try {
        const parts = relativeTo.fileName.replaceAll('\\', '/').split('/').slice(0, -1);
        for (let i = parts.length; i >= 1; i--) {
            const subPath = parts.slice(0, i).join('/') + '/' + "config.yml";
            if (subPath in searchedPathsForConfig) {
                return;
            }
            searchedPathsForConfig.push(subPath);
            if (fs.existsSync(subPath)) {
                const content = fs.readFileSync(subPath, { encoding: 'utf-8', flag: 'r' });
                const lines = content.replaceAll('\r', '').split('\n');
                let isReadingColors = false;
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed == "" || trimmed.startsWith("#")) {
                        continue;
                    }
                    if (line == "Colors:") {
                        outputChannel.appendLine("Path " + subPath + " had a valid config.yml! Loading custom colors from it.");
                        hasLoadedConfig = true;
                        isReadingColors = true;
                        continue;
                    }
                    if (isReadingColors) {
                        if (!line.startsWith("  ")) {
                            isReadingColors = false;
                            break;
                        }
                        const colon = trimmed.indexOf(': ');
                        if (colon != -1) {
                            const name = trimmed.substring(0, colon);
                            const colorData = trimmed.substring(colon + 2);
                            configColors[name.toLowerCase()] = colorData.toLowerCase();
                        }
                    }
                }
            }
            if (hasLoadedConfig) {
                applyConfigColors();
                return;
            }
        }
    }
    catch (err) {
        outputChannel.appendLine("Failed while trying to read a config file: " + err);
    }
}
function activate(context) {
    return __awaiter(this, void 0, void 0, function* () {
        let path = yield activateDotNet();
        activateLanguageServer(context, path);
        activateHighlighter(context);
        activateUpdateChecks(context);
        activateDenizenFileCommands(context);
        activateWorkspaceCompletions(context);
        vscode.workspace.onDidOpenTextDocument(doc => {
            if (doc.uri.toString().endsWith(".dsc")) {
                tryLoadConfigYaml(doc);
                workspaceIndex.updateDocument(doc);
                if (denizenTreeProvider) {
                    denizenTreeProvider.refresh();
                }
                forceRefresh("onDidOpenTextDocument");
            }
        }, null, context.subscriptions);
        vscode.workspace.onDidChangeTextDocument(event => {
            const curFile = event.document.uri.toString();
            if (curFile.endsWith(".dsc")) {
                workspaceIndex.updateDocument(event.document);
                let highlight = getCache(curFile);
                event.contentChanges.forEach(change => {
                    if (highlight.needRefreshStartLine == -1 || change.range.start.line < highlight.needRefreshStartLine) {
                        highlight.needRefreshStartLine = change.range.start.line;
                    }
                    if (highlight.needRefreshEndLine == -1 || change.range.end.line > highlight.needRefreshEndLine) {
                        highlight.needRefreshEndLine = change.range.end.line;
                    }
                    highlight.needRefreshLineShift += change.text.split('\n').length - 1;
                    highlight.needRefreshLineShift -= event.document.getText(change.range).split('\n').length - 1;
                });
                if (debugHighlighting) {
                    outputChannel.appendLine("Scheduled a partial refresh of syntax highlighting because onDidChangeTextDocument, from " + highlight.needRefreshStartLine + " to " + highlight.needRefreshEndLine + " with shift " + highlight.needRefreshLineShift);
                }
                scheduleRefresh();
                if (changeCounter++ < 2) {
                    forceRefresh("onDidChangeTextDocument" + changeCounter);
                }
            }
        }, null, context.subscriptions);
        vscode.window.onDidChangeVisibleTextEditors(editors => {
            for (const editor of editors) {
                const uri = editor.document.uri.toString();
                if (!uri.endsWith(".dsc")) {
                    continue;
                }
                tryLoadConfigYaml(editor.document);
                forceRefresh("onDidChangeVisibleTextEditors");
                return;
            }
        }, null, context.subscriptions);
        vscode.workspace.onDidChangeConfiguration(event => {
            loadAllColors();
            forceRefresh("onDidChangeConfiguration");
        });
        vscode.languages.registerFoldingRangeProvider('denizenscript', {
            provideFoldingRanges(document, context, token) {
                return denizenScriptFoldingProvider(document, context, token);
            }
        });
        scheduleRefresh();
        outputChannel.appendLine('Denizen extension has been activated');
    });
}
class InProcFold {
    constructor(start, spacing, isCommand) {
        this.start = start;
        this.spacing = spacing;
        this.isCommand = isCommand;
    }
}
function deactivate() {
}
//# sourceMappingURL=extension.js.map