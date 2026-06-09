import * as vscode from 'vscode';
import * as languageClient from "vscode-languageclient";
import * as languageClientNode from "vscode-languageclient/node";
import * as path from "path";
import * as fs from "fs";
import * as https from "https";

const languageServerPath : string = "server/DenizenLangServer.dll";

let configuration : vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration();

let headerSymbols : string = "|+=#_@/";

let outputChannel = vscode.window.createOutputChannel("Denizen");

let debugHighlighting : boolean = false;
let debugFolding : boolean = false;
let doInlineColors : boolean = true;
let displayDarkColors : boolean = false;
let useCustomSyntaxColors : boolean = false;

class HighlightCache {
    needRefreshStartLine : number = -1;
    needRefreshEndLine : number = -1;
    needRefreshLineShift : number = 0;
    lastDecorations : { [color: string]: vscode.Range[] } = {};
}

let HLCaches : Map<string, HighlightCache> = new Map<string, HighlightCache>();

function getCache(path : string) {
    let result : HighlightCache = HLCaches.get(path);
    if (result) {
        return result;
    }
    result = new HighlightCache();
    HLCaches.set(path, result);
    return result;
}

function activateLanguageServer(context: vscode.ExtensionContext, dotnetPath : string) {
    if (!dotnetPath || dotnetPath.length === 0) {
        dotnetPath = "dotnet";
    }
    let pathFile : string = context.asAbsolutePath(languageServerPath);
    if (!fs.existsSync(pathFile)) {
        return;
    }
    let pathDir : string = path.dirname(pathFile);
    let serverOptions: languageClientNode.ServerOptions = {
        run: { command: dotnetPath, args: [pathFile], options: { cwd: pathDir } },
        debug: { command: dotnetPath, args: [pathFile, "--debug"], options: { cwd: pathDir } }
    }
    let clientOptions: languageClient.LanguageClientOptions = {
        documentSelector: ["denizenscript"],
        synchronize: {
            configurationSection: "denizenscript",
        },
        middleware: {
            provideCompletionItem: (document: vscode.TextDocument, position: vscode.Position, context: any, token: vscode.CancellationToken, next: Function) => {
                return next(document, position, context, token);
            },
            handleDiagnostics: (uri: vscode.Uri, diagnostics: vscode.Diagnostic[], next: Function) => {
                next(uri, diagnostics.filter(diagnostic => !isDialogScriptDiagnostic(uri, diagnostic) && !isDenizenMDiagnostic(uri, diagnostic)));
            }
        }
    }
    let client = new languageClientNode.LanguageClient("DenizenLangServer", "Denizen Language Server", serverOptions, clientOptions);
    let disposable = client.start();
    context.subscriptions.push(disposable);
}

const highlightDecors: { [color: string]: vscode.TextEditorDecorationType } = {};
const highlightColorRef: { [color: string]: string } = {};

function parseColor(inColor : string) : vscode.DecorationRenderOptions {
    const colorSplit : string[] = inColor.split('\|');
    let resultColor : vscode.DecorationRenderOptions = { color : colorSplit[0] };
    let strike : boolean = false;
    let underline : boolean = false;
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

function colorSet(name : string, inColor : string) {
    highlightDecors[name] = vscode.window.createTextEditorDecorationType(parseColor(inColor));
    highlightColorRef[name] = inColor;
}

const colorTypes : string[] = [
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
    headerSymbols = configuration.get("denizenscript.header_symbols");
    debugHighlighting = configuration.get("denizenscript.debug.highlighting");
    debugFolding = configuration.get("denizenscript.debug.folding");
    doInlineColors = configuration.get("denizenscript.behaviors.do_inline_colors");
    displayDarkColors = configuration.get("denizenscript.behaviors.display_dark_colors");
    tagSpecialColors = Object.assign({}, baseTagSpecialColors);
    const customColors : string = configuration.get("denizenscript.theme_colors.text_color_map");
    const colorsSplit : string[] = customColors.split(',');
    for (const i in colorsSplit) {
        const color = colorsSplit[i];
        let pair : string[] = color.split('=');
        if (pair.length == 2) {
            tagSpecialColors["&[" + pair[0].toLowerCase() + "]"] = pair[1];
        }
        else {
            outputChannel.appendLine("Cannot interpret color " + color);
        }
    }
    applyConfigColors();
    if (!useCustomSyntaxColors) {
        return;
    }
    for (const i in colorTypes) {
        let str : string = configuration.get("denizenscript.theme_colors." + colorTypes[i]);
        if (str === undefined) {
            outputChannel.appendLine("Missing color config for " + colorTypes[i]);
            continue;
        }
        colorSet(colorTypes[i], str);
    }
}

function activateHighlighter(context: vscode.ExtensionContext) {
    loadAllColors();
}

function pathKey(uri: vscode.Uri) : string {
    return uri.toString();
}

function sortedSetValues(values: Set<string>) : string[] {
    return Array.from(values).sort((a, b) => a.localeCompare(b));
}

class DenizenSymbolSet {
    defines : Set<string> = new Set<string>();
    playerFlags : Set<string> = new Set<string>();
    serverFlags : Set<string> = new Set<string>();
}

class DenizenWorkspaceIndex {
    private byFile : Map<string, DenizenSymbolSet> = new Map<string, DenizenSymbolSet>();
    defines : Set<string> = new Set<string>();
    playerFlags : Set<string> = new Set<string>();
    serverFlags : Set<string> = new Set<string>();

    async refreshWorkspace() {
        const files = await vscode.workspace.findFiles("**/*.dsc", "**/{node_modules,.git}/**");
        this.byFile.clear();
        for (const file of files) {
            this.updateUri(file);
        }
        this.rebuildMerged();
    }

    updateDocument(document: vscode.TextDocument) {
        if (!isDenizenUri(document.uri)) {
            return;
        }
        this.byFile.set(pathKey(document.uri), this.parseText(document.getText()));
        this.rebuildMerged();
    }

    updateUri(uri: vscode.Uri) {
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

    deleteUri(uri: vscode.Uri) {
        this.byFile.delete(pathKey(uri));
        this.rebuildMerged();
    }

    private rebuildMerged() {
        this.defines = new Set<string>();
        this.playerFlags = new Set<string>();
        this.serverFlags = new Set<string>();
        this.byFile.forEach(symbols => {
            symbols.defines.forEach(value => this.defines.add(value));
            symbols.playerFlags.forEach(value => this.playerFlags.add(value));
            symbols.serverFlags.forEach(value => this.serverFlags.add(value));
        });
    }

    private parseText(text: string) : DenizenSymbolSet {
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

interface GitHubReleaseAsset {
    name: string;
    browser_download_url: string;
}

interface GitHubRelease {
    tag_name: string;
    name?: string;
    html_url: string;
    assets?: GitHubReleaseAsset[];
}

function getExtensionVersion(context: vscode.ExtensionContext) : string {
    try {
        const packageJson = JSON.parse(fs.readFileSync(context.asAbsolutePath("package.json"), { encoding: "utf-8", flag: "r" }));
        return packageJson.version || "0.0.0";
    }
    catch (err) {
        outputChannel.appendLine("Failed to read extension package version: " + err);
        return "0.0.0";
    }
}

function normalizeVersion(version: string) : string {
    return version.trim().replace(/^v/i, "").split(/[+-]/)[0];
}

function compareVersions(left: string, right: string) : number {
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

function githubGetJson(url: string) : Promise<any> {
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
                const error = new Error("GitHub returned HTTP " + response.statusCode);
                (error as any).statusCode = response.statusCode;
                reject(error);
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

function downloadFile(url: string, targetPath: string) : Promise<void> {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                "User-Agent": "refined-denizenscript-vscode"
            }
        }, response => {
            if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                downloadFile(response.headers.location, targetPath).then(resolve, reject);
                return;
            }
            if (response.statusCode != 200) {
                const error = new Error("GitHub asset returned HTTP " + response.statusCode);
                (error as any).statusCode = response.statusCode;
                reject(error);
                response.resume();
                return;
            }
            ensureDirectory(path.dirname(targetPath));
            const file = fs.createWriteStream(targetPath);
            response.pipe(file);
            file.on("finish", () => {
                file.close();
                resolve();
            });
            file.on("error", err => {
                file.close();
                reject(err);
            });
        }).on("error", reject);
    });
}

function getReleaseVsixUrl(release: GitHubRelease) : string | undefined {
    if (!release.assets) {
        return undefined;
    }
    const asset = release.assets.filter(item => item.name.toLowerCase().endsWith(".vsix"))[0];
    return asset ? asset.browser_download_url : undefined;
}

async function installVsixUpdate(context: vscode.ExtensionContext, downloadUrl: string, version: string) {
    const fileName = "refined-denizenscript-" + normalizeVersion(version) + ".vsix";
    const targetPath = path.join(context.globalStorageUri.fsPath, "updates", fileName);
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Installing Refined DenizenScript update",
        cancellable: false
    }, async progress => {
        progress.report({ message: "Downloading VSIX..." });
        await downloadFile(downloadUrl, targetPath);
        progress.report({ message: "Installing extension..." });
        await vscode.commands.executeCommand("workbench.extensions.installExtension", vscode.Uri.file(targetPath));
    });
    const choice = await vscode.window.showInformationMessage("Refined DenizenScript update was installed. Reload VS Code to activate it.", "Reload Window");
    if (choice == "Reload Window") {
        vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
}

async function checkForUpdates(context: vscode.ExtensionContext, manual: boolean) {
    const updateConfig = vscode.workspace.getConfiguration("refinedDenizenscript.update");
    const repo = updateConfig.get("githubRepo") as string || "Humususus/refined-denizenScript";
    if (!repo || repo.indexOf("/") == -1) {
        if (manual) {
            vscode.window.showErrorMessage("Refined DenizenScript update repo is invalid. Use owner/repo format.");
        }
        return;
    }
    if (!manual && updateConfig.get("autoCheck") === false) {
        return;
    }
    const intervalHours = updateConfig.get("checkIntervalHours") as number || 12;
    const now = Date.now();
    const lastCheck = context.globalState.get("refinedDenizenscript.lastUpdateCheck") as number || 0;
    if (!manual && now - lastCheck < Math.max(1, intervalHours) * 60 * 60 * 1000) {
        return;
    }
    await context.globalState.update("refinedDenizenscript.lastUpdateCheck", now);
    try {
        const currentVersion = getExtensionVersion(context);
        const release = await githubGetJson("https://api.github.com/repos/" + repo + "/releases/latest") as GitHubRelease;
        const latestVersion = release.tag_name || "";
        if (compareVersions(latestVersion, currentVersion) <= 0) {
            if (manual) {
                vscode.window.showInformationMessage("Refined DenizenScript is up to date. Current version: " + currentVersion + ".");
            }
            return;
        }
        const downloadUrl = getReleaseVsixUrl(release);
        const choice = await vscode.window.showInformationMessage(
            "Refined DenizenScript " + latestVersion + " is available. Current version: " + currentVersion + ".",
            downloadUrl ? "Install Update" : "",
            "Open Release",
            downloadUrl ? "Download VSIX" : ""
        );
        if (choice == "Install Update" && downloadUrl) {
            try {
                await installVsixUpdate(context, downloadUrl, latestVersion);
            }
            catch (err) {
                outputChannel.appendLine("Failed to install Refined DenizenScript update: " + err);
                vscode.window.showErrorMessage("Failed to install update automatically. Opening VSIX download instead.");
                vscode.env.openExternal(vscode.Uri.parse(downloadUrl));
            }
        }
        else if (choice == "Open Release") {
            vscode.env.openExternal(vscode.Uri.parse(release.html_url));
        }
        else if (choice == "Download VSIX" && downloadUrl) {
            vscode.env.openExternal(vscode.Uri.parse(downloadUrl));
        }
    }
    catch (err) {
        if ((err as any).statusCode == 404 || (err + "").indexOf("HTTP 404") != -1) {
            if (manual) {
                vscode.window.showInformationMessage("No Refined DenizenScript GitHub releases were found yet.");
            }
            return;
        }
        outputChannel.appendLine("Failed to check Refined DenizenScript updates: " + err);
        if (manual) {
            vscode.window.showErrorMessage("Failed to check Refined DenizenScript updates. See Denizen output for details.");
        }
    }
}

function activateUpdateChecks(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerCommand("refinedDenizenscript.checkForUpdates", () => checkForUpdates(context, true)));
    checkForUpdates(context, false);
}

const denizenCategories : { label: string, folder: string, description: string }[] = [
    { label: "main", folder: "main", description: "Main scripts" },
    { label: "dialog", folder: "dialog", description: "Dialog scripts" },
    { label: "handle", folder: "handle", description: "Handler scripts" },
    { label: "data", folder: "data", description: "Data scripts" },
    { label: "util", folder: "util", description: "Utility scripts" },
    { label: "world", folder: "world", description: "World scripts" },
    { label: "animation", folder: "animation", description: "Animation scripts" }
];

function getWorkspaceRoot() : vscode.Uri | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length == 0) {
        vscode.window.showErrorMessage("Open a workspace folder before creating DenizenScript files.");
        return undefined;
    }
    return folders[0].uri;
}

function getDenizenScriptRoot() : vscode.Uri | undefined {
    const root = getWorkspaceRoot();
    if (!root) {
        return undefined;
    }
    return vscode.Uri.file(path.join(root.fsPath, "denizen", "script"));
}

function ensureDirectory(dir: string) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function normalizePathForMatch(filePath: string) : string {
    return filePath.replaceAll("\\", "/").toLowerCase();
}

function isInsideDenizenScriptPath(filePath: string) : boolean {
    return normalizePathForMatch(filePath).indexOf("/denizen/script/") != -1;
}

function appendDscExtension(fileName: string) : string {
    return fileName.toLowerCase().endsWith(".dsc") ? fileName : fileName + ".dsc";
}

async function pickDenizenCategory() : Promise<string | undefined> {
    const picked = await vscode.window.showQuickPick(denizenCategories, {
        placeHolder: "Select DenizenScript category"
    });
    return picked ? picked.folder : undefined;
}

async function createDenizenCategory(uri?: vscode.Uri) {
    const root = getWorkspaceRoot();
    if (!root) {
        return;
    }
    const targetRoot = getSelectedFolder(uri) || root.fsPath;
    const category = await pickDenizenCategory();
    if (!category) {
        return;
    }
    const categoryPath = path.join(targetRoot, category);
    ensureDirectory(categoryPath);
    vscode.window.showInformationMessage("Created DenizenScript category: " + vscode.workspace.asRelativePath(categoryPath));
}

function getSelectedFolder(uri?: vscode.Uri) : string | undefined {
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

function getActiveEditorFolder() : string | undefined {
    const activeUri = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri;
    if (!activeUri || activeUri.scheme != "file") {
        return undefined;
    }
    return path.dirname(activeUri.fsPath);
}

function getScriptTargetFolder(uri?: vscode.Uri) : string | undefined {
    const selectedFolder = getSelectedFolder(uri);
    if (selectedFolder) {
        return selectedFolder;
    }
    const activeFolder = getActiveEditorFolder();
    if (activeFolder) {
        return activeFolder;
    }
    const scriptRoot = getDenizenScriptRoot();
    if (scriptRoot) {
        return scriptRoot.fsPath;
    }
    const root = getWorkspaceRoot();
    return root ? root.fsPath : undefined;
}

async function createDenizenScriptFile(uri?: vscode.Uri) {
    const targetFolder = getScriptTargetFolder(uri);
    if (!targetFolder) {
        return;
    }
    const rawName = await vscode.window.showInputBox({
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
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetFile));
    vscode.window.showTextDocument(doc);
}

function activateDenizenFileCommands(context: vscode.ExtensionContext) {
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

function getCompletionRange(document: vscode.TextDocument, position: vscode.Position, typedLength: number) : vscode.Range {
    return new vscode.Range(new vscode.Position(position.line, position.character - typedLength), position);
}

function makeCompletion(label: string, kind: vscode.CompletionItemKind, detail: string, range: vscode.Range) : vscode.CompletionItem {
    const item = new vscode.CompletionItem(label, kind);
    item.detail = detail;
    item.insertText = label;
    item.range = range;
    return item;
}

function makeSnippetCompletion(label: string, detail: string, snippet: string, range: vscode.Range) : vscode.CompletionItem {
    const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
    item.detail = detail;
    item.insertText = new vscode.SnippetString(snippet);
    item.range = range;
    return item;
}

interface DenizenMDoc {
    label: string;
    insertText: string;
    detail: string;
    markdown: string;
}

const denizenMEscapeTags : DenizenMDoc[] = [
    {
        label: "&sprite",
        insertText: "sprite[$1]",
        detail: "DenizenM text formatting tag",
        markdown: "`<&sprite[minecraft:items:item/porkchop]>`\n\nRenders a resource-pack sprite in formatted text."
    },
    {
        label: "&shadow_color",
        insertText: "shadow_color[$1]",
        detail: "DenizenM text formatting tag",
        markdown: "`<&shadow_color[#51a2ff]>`\n\nApplies a text shadow color. Use a hex color value."
    },
    {
        label: "&shadow_gradient",
        insertText: "shadow_gradient[from=$1;to=$2]",
        detail: "DenizenM text formatting tag",
        markdown: "`<&shadow_gradient[from=#51a2ff;to=#FFF085]>`\n\nApplies a gradient to text shadow color."
    },
    {
        label: "&dual_gradient",
        insertText: "dual_gradient[from=$1;to=$2;s_from=$3;s_to=$4]",
        detail: "DenizenM text formatting tag",
        markdown: "`<&dual_gradient[from=#51a2ff;to=#FFF085;s_from=#FFF085;s_to=#51a2ff]>`\n\nApplies both normal text gradient and shadow gradient."
    },
    {
        label: "&player_head",
        insertText: "player_head[$1]",
        detail: "DenizenM text formatting tag",
        markdown: "`<&player_head[Tjtoxshpilivili1]>` or `<&player_head[!Tjtoxshpilivili1]>`\n\nRenders a player head texture. Prefix the name with `!` for face-only texture."
    }
];

const denizenMDotTags : DenizenMDoc[] = [
    {
        label: "shadow_color",
        insertText: "shadow_color[$1]",
        detail: "DenizenM ElementTag tag",
        markdown: "`<element.shadow_color[#51a2ff]>`\n\nAdds text shadow color formatting to an element."
    },
    {
        label: "shadow_gradient",
        insertText: "shadow_gradient[from=$1;to=$2]",
        detail: "DenizenM ElementTag tag",
        markdown: "`<element.shadow_gradient[from=#51a2ff;to=#FFF085]>`\n\nAdds text shadow gradient formatting to an element."
    },
    {
        label: "dual_gradient",
        insertText: "dual_gradient[from=$1;to=$2;s_from=$3;s_to=$4]",
        detail: "DenizenM ElementTag tag",
        markdown: "`<element.dual_gradient[from=#51a2ff;to=#FFF085;s_from=#FFF085;s_to=#51a2ff]>`\n\nAdds normal text gradient and shadow gradient formatting to an element."
    },
    {
        label: "rarity_color",
        insertText: "rarity_color",
        detail: "DenizenM ItemTag tag",
        markdown: "`<player.item_in_hand.rarity_color>`\n\nReturns the item's rarity color as a ColorTag."
    },
    {
        label: "unsorted",
        insertText: "unsorted",
        detail: "DenizenM entity search tag",
        markdown: "`<location.find_entities[...].within[...].unsorted>`\n\nBypasses distance-based sorting for better performance when order is not needed."
    }
];

const denizenMCommandArgs : DenizenMDoc[] = [
    {
        label: "async",
        insertText: "async",
        detail: "DenizenM teleport argument",
        markdown: "`teleport <player> <location> async`\n\nTeleports asynchronously to avoid loading-chunk lag."
    },
    {
        label: "forced",
        insertText: "forced",
        detail: "DenizenM playeffect argument",
        markdown: "`playeffect effect:END_ROD <location> visibility:100 forced`\n\nForces extended particle visibility."
    },
    {
        label: "add",
        insertText: "add",
        detail: "DenizenM resourcepack argument",
        markdown: "`resourcepack add ...`\n\nAdds an additional resource pack instead of replacing the existing stack."
    }
];

const denizenMKnownTerms : string[] = [
    "&sprite", "&shadow_color", "&shadow_gradient", "&dual_gradient", "&player_head",
    ".shadow_color", ".shadow_gradient", ".dual_gradient", ".rarity_color", ".unsorted",
    " custom_model_data", "remove_resource_pack", "remove_resource_packs",
    " resourcepack ", " teleport ", " playeffect ", " async", " forced"
];

function makeDenizenMCompletion(doc: DenizenMDoc, range: vscode.Range) : vscode.CompletionItem {
    const item = new vscode.CompletionItem(doc.label, vscode.CompletionItemKind.Function);
    item.detail = doc.detail;
    item.documentation = new vscode.MarkdownString(doc.markdown);
    item.insertText = new vscode.SnippetString(doc.insertText);
    item.filterText = doc.label.startsWith("&") ? doc.label.substring(1) : doc.label;
    item.range = range;
    return item;
}

function makeDenizenMEscapeCompletion(doc: DenizenMDoc, range: vscode.Range) : vscode.CompletionItem {
    const item = makeDenizenMCompletion(doc, range);
    item.insertText = new vscode.SnippetString(doc.label + doc.insertText.substring(doc.label.substring(1).length));
    item.filterText = doc.label;
    return item;
}

function isTopLevelContainerLine(line: string) : boolean {
    return /^[A-Za-z_][A-Za-z0-9_\-]*\s*:\s*(#.*)?$/.test(line);
}

function getContainerText(document: vscode.TextDocument, position: vscode.Position) : string {
    let startLine = 0;
    for (let line = position.line; line >= 0; line--) {
        if (isTopLevelContainerLine(document.lineAt(line).text)) {
            startLine = line;
            break;
        }
    }
    let endLine = document.lineCount;
    for (let line = startLine + 1; line < document.lineCount; line++) {
        if (isTopLevelContainerLine(document.lineAt(line).text)) {
            endLine = line;
            break;
        }
    }
    const lines : string[] = [];
    for (let line = startLine; line < endLine; line++) {
        lines.push(document.lineAt(line).text);
    }
    return lines.join("\n");
}

function getContainerDefines(document: vscode.TextDocument, position: vscode.Position) : Set<string> {
    const defines = new Set<string>();
    const defineMatcher = /^\s*-\s*define\s+([A-Za-z_][A-Za-z0-9_]*)\b/i;
    for (const rawLine of getContainerText(document, position).replace(/\r/g, "").split("\n")) {
        const defineMatch = defineMatcher.exec(rawLine);
        if (defineMatch) {
            defines.add(defineMatch[1]);
        }
    }
    return defines;
}

function getDialogInputKeys(document: vscode.TextDocument, position: vscode.Position) : Set<string> {
    const keys = new Set<string>();
    const lines = getContainerText(document, position).replace(/\r/g, "").split("\n");
    let isDialog = false;
    let inputsIndent = -1;
    const keyMatcher = /^(\s*)key\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:#.*)?$/i;
    for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (/^type\s*:\s*dialog\s*(?:#.*)?$/i.test(trimmed)) {
            isDialog = true;
        }
        const indent = rawLine.length - rawLine.trimStart().length;
        if (/^inputs\s*:\s*(?:#.*)?$/i.test(trimmed)) {
            inputsIndent = indent;
            continue;
        }
        if (inputsIndent != -1 && trimmed.length > 0 && indent <= inputsIndent) {
            inputsIndent = -1;
        }
        if (inputsIndent != -1) {
            const keyMatch = keyMatcher.exec(rawLine);
            if (keyMatch) {
                keys.add(keyMatch[2]);
            }
        }
    }
    return isDialog ? keys : new Set<string>();
}

function getContainerSnippetCompletions(document: vscode.TextDocument, position: vscode.Position) : vscode.CompletionItem[] {
    const linePrefix = document.lineAt(position).text.substring(0, position.character);
    const match = /^(\s*)([A-Za-z_]*)$/i.exec(linePrefix);
    if (!match || match[1].length != 0) {
        return [];
    }
    const range = getCompletionRange(document, position, match[2].length);
    const dialogSnippet = "${1:my_dialog}:\n  type: dialog\n  base:\n    type: multi\n    title: <gray>${2:Добро пожаловать!}\n    columns: 1\n  bodies:\n    header:\n      type: message\n      message: <gray>${3:Введите отображаемое имя}\n  inputs:\n    1:\n      type: text\n      label: ${4:Имя}\n      key: ${5:display_name}\n  buttons:\n    1:\n      label: ${6:Подтвердить}\n      script:\n      - define name <context.${5:display_name}>\n      - narrate <[name]>";
    return [makeSnippetCompletion("dialog", "Denizen dialog container", dialogSnippet, range)];
}

function getDenizenCompletions(document: vscode.TextDocument, position: vscode.Position) : vscode.CompletionItem[] {
    const linePrefix = document.lineAt(position).text.substring(0, position.character);
    const containerSnippets = getContainerSnippetCompletions(document, position);
    if (containerSnippets.length > 0) {
        return containerSnippets;
    }
    const escapeTagMatch = /<(&?[A-Za-z0-9_]*)$/i.exec(linePrefix);
    if (escapeTagMatch) {
        const range = getCompletionRange(document, position, escapeTagMatch[1].length);
        return denizenMEscapeTags.map(doc => makeDenizenMEscapeCompletion(doc, range));
    }
    const contextMatch = /<context\.([A-Za-z0-9_]*)$/i.exec(linePrefix);
    if (contextMatch) {
        const range = getCompletionRange(document, position, contextMatch[1].length);
        return sortedSetValues(getDialogInputKeys(document, position)).map(value => makeCompletion(value, vscode.CompletionItemKind.Property, "Dialog input context", range));
    }
    const dotTagMatch = /<[^\s<>]*\.([A-Za-z0-9_]*)$/i.exec(linePrefix);
    if (dotTagMatch) {
        const range = getCompletionRange(document, position, dotTagMatch[1].length);
        return denizenMDotTags.map(doc => makeDenizenMCompletion(doc, range));
    }
    const commandArgMatch = /^\s*-\s*(?:~)?(teleport|playeffect|resourcepack)\b.*\s([A-Za-z_]*)$/i.exec(linePrefix);
    if (commandArgMatch) {
        const range = getCompletionRange(document, position, commandArgMatch[2].length);
        const command = commandArgMatch[1].toLowerCase();
        return denizenMCommandArgs
            .filter(doc => (command == "teleport" && doc.label == "async") || (command == "playeffect" && doc.label == "forced") || (command == "resourcepack" && doc.label == "add"))
            .map(doc => makeDenizenMCompletion(doc, range));
    }
    const defineMatch = /<\[([A-Za-z0-9_]*)$/.exec(linePrefix);
    if (defineMatch) {
        const range = getCompletionRange(document, position, defineMatch[1].length);
        return sortedSetValues(getContainerDefines(document, position)).map(value => makeCompletion(value, vscode.CompletionItemKind.Variable, "Denizen define", range));
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

function getDenizenMDocByLabel(label: string) : DenizenMDoc | undefined {
    const cleanLabel = label.toLowerCase();
    return denizenMEscapeTags.concat(denizenMDotTags).concat(denizenMCommandArgs)
        .filter(doc => doc.label.toLowerCase() == cleanLabel || doc.label.toLowerCase() == "&" + cleanLabel)[0];
}

function getDenizenMHover(document: vscode.TextDocument, position: vscode.Position) : vscode.Hover | undefined {
    const line = document.lineAt(position).text;
    const char = position.character;
    const tagStart = line.lastIndexOf("<", char);
    const tagEnd = line.indexOf(">", char);
    if (tagStart != -1 && tagEnd != -1 && tagStart < char) {
        const tagText = line.substring(tagStart + 1, tagEnd);
        const escapeMatch = /^(&[A-Za-z0-9_]+)(?:[\[\.]|$)/.exec(tagText);
        if (escapeMatch) {
            const doc = getDenizenMDocByLabel(escapeMatch[1]);
            if (doc) {
                return new vscode.Hover(new vscode.MarkdownString(doc.markdown));
            }
        }
        const dotParts = tagText.split(/[.\[\]]/).filter(part => part.length > 0);
        for (const part of dotParts) {
            const doc = getDenizenMDocByLabel(part);
            if (doc) {
                return new vscode.Hover(new vscode.MarkdownString(doc.markdown));
            }
        }
    }
    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_]+/);
    if (wordRange) {
        const word = document.getText(wordRange);
        const doc = getDenizenMDocByLabel(word);
        if (doc) {
            return new vscode.Hover(new vscode.MarkdownString(doc.markdown), wordRange);
        }
    }
    return undefined;
}

function activateWorkspaceCompletions(context: vscode.ExtensionContext) {
    workspaceIndex.refreshWorkspace();
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider("denizenscript", {
        provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) : vscode.ProviderResult<vscode.CompletionItem[]> {
            workspaceIndex.updateDocument(document);
            return getDenizenCompletions(document, position);
        }
    }, "<", "[", ".", "&", " "));
    context.subscriptions.push(vscode.languages.registerHoverProvider("denizenscript", {
        provideHover(document: vscode.TextDocument, position: vscode.Position) : vscode.ProviderResult<vscode.Hover> {
            return getDenizenMHover(document, position);
        }
    }));
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

function isDenizenUri(uri: vscode.Uri) : boolean {
    return uri.fsPath.toLowerCase().endsWith(".dsc");
}

function getDenizenFileKind(name: string) : string {
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

function getKindLabel(kind: string) : string {
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

function getIconPath(context: vscode.ExtensionContext, kind: string) : any {
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
    }
}

class DenizenTreeItem extends vscode.TreeItem {
    uri : vscode.Uri;
    kindName : string;
}

class DenizenTreeProvider implements vscode.TreeDataProvider<DenizenTreeItem> {
    private context: vscode.ExtensionContext;
    private files : vscode.Uri[] = [];
    private groups : string[] = [];
    private onDidChangeTreeDataEmitter = new vscode.EventEmitter<DenizenTreeItem | undefined>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    refresh() {
        this.loadFiles().then(() => this.onDidChangeTreeDataEmitter.fire(undefined));
    }

    getTreeItem(element: DenizenTreeItem) : vscode.TreeItem {
        return element;
    }

    async getChildren(element?: DenizenTreeItem) : Promise<DenizenTreeItem[]> {
        if (!element) {
            await this.loadFiles();
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
    }

    private async loadFiles() {
        this.files = await vscode.workspace.findFiles("**/*.dsc", "**/{node_modules,.git}/**");
        const groups = new Set<string>();
        this.files.forEach(uri => groups.add(getDenizenFileKind(path.basename(uri.fsPath))));
        this.groups = sortedSetValues(groups);
    }
}

let denizenTreeProvider: DenizenTreeProvider | undefined;

function activateDenizenTree(context: vscode.ExtensionContext) {
    denizenTreeProvider = new DenizenTreeProvider(context);
    vscode.window.registerTreeDataProvider("denizenScripts", denizenTreeProvider);
    denizenTreeProvider.refresh();
}

function isDialogScriptDiagnostic(uri: vscode.Uri, diagnostic: vscode.Diagnostic) : boolean {
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

function isDenizenMDiagnostic(uri: vscode.Uri, diagnostic: vscode.Diagnostic) : boolean {
    const document = vscode.workspace.textDocuments.filter(doc => pathKey(doc.uri) == pathKey(uri))[0];
    const message = diagnostic.message.toLowerCase();
    const lineText = document && diagnostic.range.start.line < document.lineCount ? document.lineAt(diagnostic.range.start.line).text.toLowerCase() : "";
    const combined = message + "\n" + lineText;
    return denizenMKnownTerms.some(term => combined.indexOf(term) != -1);
}

let refreshTimer: NodeJS.Timer | undefined = undefined;

function refreshDecor() {
    refreshTimer = undefined;
    for (const editor of vscode.window.visibleTextEditors) {
        const uri = editor.document.uri.toString();
        if (!uri.endsWith(".dsc")) {
            continue;
        }
        decorateFullFile(editor);
    }
}

let decorFixes: number[] = [];

function addDecor(decorations: { [color: string]: vscode.Range[] }, type: string, lineNumber: number, startChar: number, endChar: number) {
    if (!(type in highlightDecors)) {
        if (!type.startsWith("auto:")) {
            return;
        }
        highlightDecors[type] = vscode.window.createTextEditorDecorationType(parseColor(type.substring("auto:".length)));
    }
    if (!(type in decorations)) {
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

function decorateTag(tag : string, start: number, lineNumber: number, decorations: { [color: string]: vscode.Range[] }) {
    const len : number = tag.length;
    let inTagCounter : number = 0;
    let tagStart : number = 0;
    let inTagParamCounter : number = 0;
    let defaultDecor : string = "tag";
    let lastDecor : number = -1; // Color the < too.
    let textColor : string = "tag_param";
    let lastDot : number = 0;
    let lastBracket : number = 0;
    for (let i = 0; i < len; i++) {
        const c : string = tag.charAt(i);
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
                const tagText : string = tag.substring(tagStart + 1, i);
                let autoColor : string = getTagColor(tagText, textColor);
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
                    const lastTag : string = tag.substring(0, i);
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
                const lastTag : string = tag.substring(lastDot + 1, lastBracket);
                const bracketedText : string = tag.substring(lastBracket + 1, i);
                const colorFormat = "&[" + bracketedText.toLowerCase() + "]";
                if (lastTag == "custom_color" && !bracketedText.includes('<') && colorFormat in tagSpecialColors) {
                    const color : string = tagSpecialColors[colorFormat];
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

const ifOperators : string[] = [ "<", ">", "<=", ">=", "==", "!=", "||", "&&", "(", ")", "or", "not", "and", "in", "contains", "!in", "!contains", "matches", "!matches" ];

const ifCmdLabels : string[] = [ "cmd:if", "cmd:else", "cmd:while", "cmd:waituntil" ];

const deffableCmdLabels : string[] = [ "cmd:run", "cmd:runlater", "cmd:clickable", "cmd:bungeerun" ];

function checkIfHasTagEnd(arg : string, quoted: boolean, quoteMode: string, canQuote : boolean) : boolean {
    const len : number = arg.length;
    let params : number = 0;
    for (let i = 0; i < len; i++) {
        const c : string = arg.charAt(i);
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


const baseTagSpecialColors: { [color: string]: string } = {
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
let tagSpecialColors: { [color: string]: string } = Object.assign({}, baseTagSpecialColors);
const formatCodes: { [code: string]: string } = {
    "&l": "bold", "bold": "bold",
    "&o": "italic", "italic": "italic",
    "&m": "strike", "strikethrough": "strike",
    "&n": "underline", "underline": "underline"
};

const hexChars: { [c: string] : boolean } = {}
const hexRefStr = "abcdefABCDEF0123456789";
for (let hexID = 0; hexID < hexRefStr.length; hexID++) {
    hexChars[hexRefStr.charAt(hexID)] = true;
}

function isHex(text : string) : boolean {
    for (let i = 0; i < text.length; i++) {
        let c : string = text.charAt(i);
        if (!(c in hexChars)) {
            return false;
        }
    }
    return true;
}

function getColorData(color : string) : string {
    if (color.startsWith("#")) {
        return color;
    }
    if (color.startsWith("auto:#")) {
        return color.substring("auto:".length);
    }
    const knownColor : string = highlightColorRef[color];
    if (knownColor) {
        return knownColor;
    }
    return null;
}

function fixDark(color : string) {
    if (color == null) {
        return null;
    }
    if (displayDarkColors) {
        return color;
    }
    const splitter : number = color.indexOf('|');
    const part : string = splitter == -1 ? color : color.substring(0, splitter);
    if (!part.startsWith('#') || part.length < 7) {
        return color;
    }
    const red : number = parseInt(part.substring(1, 3), 16);
    const green : number = parseInt(part.substring(3, 5), 16);
    const blue : number = parseInt(part.substring(5, 7), 16);
    if (red < 64 && green < 64 && blue < 64) {
        return null;
    }
    return color;
}

function getTagColor(tagText : string, preColor : string) : string {
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
        const colorText : string = tagText.substring("&color[".length, tagText.length - 1);
        if (colorText.length == 7 && colorText.startsWith("#") && isHex(colorText.substring(1))) {
            return fixDark(colorText);
        }
    }
    const formatter : string = formatCodes[tagText];
    if (formatter) {
        const rgb : string = getColorData(preColor);
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

const TAG_ALLOWED : string = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&_#[";
const dataActions : string[] = [ ":->:", ":<-:", ":|:", ":!", ":++", ":--", ":<-", ":+:", ":-:", ":*:", ":/:", ":" ];

function decorateArg(arg : string, start: number, lineNumber: number, decorations: { [color: string]: vscode.Range[] }, canQuote : boolean, contextualLabel : string) {
    const len : number = arg.length;
    let quoted : boolean = false;
    let quoteMode : string = 'x';
    let inTagCounter : number = 0;
    let tagStart : number = 0;
    const referenceDefault = "normal";
    let defaultDecor : string = referenceDefault;
    let lastDecor : number = 0;
    let hasTagEnd : boolean = checkIfHasTagEnd(arg, false, 'x', canQuote);
    let spaces : number = 0;
    let textColor : string = referenceDefault;
    for (let i = 0; i < len; i++) {
        const c : string = arg.charAt(i);
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
                const tagText : string = arg.substring(tagStart + 1, i);
                let autoColor : string = getTagColor(tagText, textColor);
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
            let part : string = arg.substring(lastDecor, i);
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
            const nextArg : string = arg.includes(" ", i + 1) ? arg.substring(i + 1, arg.indexOf(" ", i + 1)) : arg.substring(i + 1);
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
                    let colonIndex : number = nextArg.indexOf(':');
                    if (colonIndex == -1) {
                        if (contextualLabel != "cmd:flag") {
                            colonIndex = nextArg.length;
                        }
                    }
                    if (contextualLabel == "cmd:flag" && nextArg.startsWith("expire:")) {
                        colonIndex = -1;
                    }
                    const tagMark : number = nextArg.indexOf('<');
                    if ((tagMark == -1 || tagMark > colonIndex) && colonIndex != -1) {
                        const argStart : string = nextArg.charAt(0);
                        let bump : number = 0;
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

function indexOfAny(text : string, searches : string[], start : number) : number {
    let least : number = -1;
    for (let search of searches) {
        const thisHit = text.indexOf(search, start);
        if (thisHit != -1 && (thisHit < least || least == -1)) {
            least = thisHit;
        }
    }
    return least;
}

function decorateDefName(decorations: { [color: string]: vscode.Range[] }, part : string, lineNumber : number, start : number) {
    let dot : number = indexOfAny(part, ['.', '|'], 0);
    let lastIndex : number = 0;
    while (dot != -1) {
        addDecor(decorations, "def_name", lineNumber, start + lastIndex, start + dot);
        addDecor(decorations, "tag_dot", lineNumber, start + dot - 1, start + dot + 1);
        lastIndex = dot + 1;
        dot = indexOfAny(part, ['.', '|'], dot + 1);
    }
    addDecor(decorations, "def_name", lineNumber, start + lastIndex, start + part.length);
}

function decorateComment(line : string, lineNumber: number, decorType: string, decorations: { [color: string]: vscode.Range[] }) {
    decorateSpaceable(line, 0, lineNumber, decorType, decorations);
}

function decorateSpaceable(line : string, preLength: number, lineNumber: number, decorType: string, decorations: { [color: string]: vscode.Range[] }) {
    const len : number = line.length;
    let lastDecor : number = 0;
    for (let i = 0; i < len; i++) {
        const c : string = line.charAt(i);
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

const definiteNotScriptKeys : string[] = [
    "interact scripts", "default constants", "data", "constants", "text", "lore", "aliases", "slots", "enchantments", "input", "description"
];

function decorateLine(line : string, lineNumber: number, decorations: { [color: string]: vscode.Range[] }, lastKey : string, isData : boolean) {
    if (line.endsWith("\r")) {
        line = line.substring(0, line.length - 1);
    }
    const trimmedEnd : string = line.trimEnd();
    let trimmed : string = trimmedEnd.trimStart().replaceAll('\n', ' ').toLowerCase();
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
        const isNonScript : boolean = isData;
        addDecor(decorations, "normal", lineNumber, preSpaces, preSpaces + 1);
        if (isNonScript) {
            decorateArg(trimmed.substring(1), preSpaces + 1, lineNumber, decorations, false, "non-script");
        }
        else {
            if (trimmed.endsWith(":")) {
                addDecor(decorations, "colons", lineNumber, preSpaces + trimmed.length - 1, preSpaces + trimmed.length);
                trimmed = trimmed.substring(0, trimmed.length - 1);
            }
            const afterDash : string = trimmed.substring(1);
            const commandEnd : number = afterDash.indexOf(' ', 1) + 1;
            const endIndexCleaned : number = preSpaces + (commandEnd == 0 ? trimmed.length : commandEnd);
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

function decorateDefinitionsKey(arg : string, start: number, lineNumber: number, decorations: { [color: string]: vscode.Range[] }) {
    const len : number = arg.length;
    let lastDecor = 0;
    let textColor = "def_name";
    for (let i = 0; i < len; i++) {
        const c : string = arg.charAt(i);
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

function decorateEventLine(line : string, preLength: number, lineNumber: number, decorations: { [color: string]: vscode.Range[] }) {
    let charIndex : number = 0;
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

function decorateFullFile(editor: vscode.TextEditor) {
    let decorations: { [color: string]: vscode.Range[] } = {};
    let highlight : HighlightCache = getCache(editor.document.uri.toString());
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
            const rangeSet : vscode.Range[] = decorations[c];
            if (highlight.needRefreshLineShift != 0) {
                for (let i : number = rangeSet.length - 1; i >= 0; i--) {
                    if (highlight.needRefreshLineShift > 0 ? (rangeSet[i].start.line >= highlight.needRefreshEndLine - highlight.needRefreshLineShift) : (rangeSet[i].start.line >= highlight.needRefreshStartLine - highlight.needRefreshLineShift)) {
                        rangeSet[i] = new vscode.Range(new vscode.Position(rangeSet[i].start.line + highlight.needRefreshLineShift, rangeSet[i].start.character), new vscode.Position(rangeSet[i].end.line + highlight.needRefreshLineShift, rangeSet[i].end.character));
                    }
                }
            }
            for (let i : number = rangeSet.length - 1; i >= 0; i--) {
                if (rangeSet[i].start.line <= highlight.needRefreshEndLine && rangeSet[i].end.line >= highlight.needRefreshStartLine) {
                    rangeSet.splice(i, 1);
                }
            }
        }
    }
    const fullText : string = editor.document.getText();
    const splitText : string[] = fullText.split('\n');
    const totalLines = splitText.length;
    let lastKey : string = "";
    const startLine : number = (highlight.needRefreshStartLine == -1 ? 0 : highlight.needRefreshStartLine);
    const endLine : number = (highlight.needRefreshStartLine == -1 ? totalLines : Math.min(highlight.needRefreshEndLine + 1, totalLines));
    if (debugHighlighting) {
        if (highlight.needRefreshStartLine == -1) {
            let type : String = "normal";
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
    let definitelyDataSpacing : number = -1;
    // Actually choose colors
    for (let i : number = 0; i < endLine; i++) {
        let lineText : string = splitText[i];
        const trimmedLineStart : string = lineText.trimStart();
        const spaces : number = lineText.length - trimmedLineStart.length;
        const trimmedLine : string = trimmedLineStart.trimEnd();
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
                const nextLine : string = splitText[i + 1];
                const nextTrimmedLineStart : string = nextLine.trimStart();
                const nextSpaces : number = nextLine.length - nextTrimmedLineStart.length;
                const nextTrimmedLine : string = nextTrimmedLineStart.trimEnd();
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

function denizenScriptFoldingProvider(document: vscode.TextDocument, context: vscode.FoldingContext, token: vscode.CancellationToken) : vscode.ProviderResult<vscode.FoldingRange[]> {
    const fullText : string = document.getText();
    const splitText : string[] = fullText.split('\n');
    const totalLines = splitText.length;
    const output : vscode.FoldingRange[] = [];
    const processing : InProcFold[] = [];
    if (debugFolding) {
        outputChannel.appendLine("(FOLDING) Begin");
    }
    for (let i : number = 0; i < totalLines; i++) {
        const line : string = splitText[i];
        const preTrimmed : string = line.trimStart();
        if (preTrimmed.length == 0) {
            continue;
        }
        const spaces : number = line.length - preTrimmed.length;
        const fullTrimmed : string = preTrimmed.trimEnd();
        const isBlock : boolean = fullTrimmed.endsWith(":");
        const isCommand : boolean = fullTrimmed.startsWith("-");
        while (processing.length > 0) {
            const lastFold : InProcFold = processing[processing.length - 1];
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
    for (let i : number = 0; i < processing.length; i++) { // for-each style loop bugs out and thinks the value is a String, so have to do 'i' counter style loop
        const extraFold : InProcFold = processing[i];
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

async function activateDotNet() {
    try {
        outputChannel.appendLine("DenizenScript extension attempting to acquire .NET 8");
        const requestingExtensionId = 'DenizenScript.denizenscript';
        const result = await vscode.commands.executeCommand('dotnet.acquire', { version: '8.0', requestingExtensionId });
        outputChannel.appendLine("DenizenScript extension NET 8 Acquire result: " + result + ": " + result["dotnetPath"]);
        return result["dotnetPath"];
    }
    catch (error) {
        outputChannel.appendLine("Error: " + error);
        return "";
    }
}

function forceRefresh(reason: String) {
    if (debugHighlighting) {
        outputChannel.appendLine("Scheduled a force full refresh of syntax highlighting because: " + reason);
    }
    HLCaches.clear();
    scheduleRefresh();
}

let changeCounter : number = 0;

let hasLoadedConfig : boolean = false;
let searchedPathsForConfig : string[] = [];
let configColors : { [name : string] : string } = {};

function applyConfigColors() {
    for (const name in configColors) {
        const val : string = configColors[name];
        let color = "";
        const tagMatches = val.match(/<([^<>]+)>/g);
        if (tagMatches && tagMatches.length > 0) {
            for (const rawTag of tagMatches) {
                const tag = rawTag.substring(1, rawTag.length - 1);
                const newColor : string = getTagColor(tag, color);
                if (newColor) {
                    color = newColor;
                }
            }
        }
        else {
            const directColor : string = getTagColor(val, "");
            if (directColor) {
                color = directColor;
            }
        }
        if (color != "") {
            tagSpecialColors["&[" + name + "]"] = color;
        }
    }
}

function tryLoadConfigYaml(relativeTo : vscode.TextDocument) {
    if (hasLoadedConfig) {
        return;
    }
    try {
        const parts : string[] = relativeTo.fileName.replaceAll('\\', '/').split('/').slice(0, -1);
        for (let i : number = parts.length; i >= 1; i--) {
            const subPath : string = parts.slice(0, i).join('/') + '/' + "config.yml";
            if (subPath in searchedPathsForConfig) {
                return;
            }
            searchedPathsForConfig.push(subPath);
            if (fs.existsSync(subPath)) {
                const content : string = fs.readFileSync(subPath, { encoding: 'utf-8', flag: 'r' });
                const lines : string[] = content.replaceAll('\r', '').split('\n');
                let isReadingColors : boolean = false;
                for (const line of lines) {
                    const trimmed : string = line.trim();
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
                        const colon : number = trimmed.indexOf(': ');
                        if (colon != -1) {
                            const name : string = trimmed.substring(0, colon);
                            const colorData : string = trimmed.substring(colon + 2);
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

export async function activate(context: vscode.ExtensionContext) {
    let path : string = await activateDotNet();
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
        const curFile : string = event.document.uri.toString();
        if (curFile.endsWith(".dsc")) {
            workspaceIndex.updateDocument(event.document);
            let highlight : HighlightCache = getCache(curFile);
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
        provideFoldingRanges(document: vscode.TextDocument, context: vscode.FoldingContext, token: vscode.CancellationToken) : vscode.ProviderResult<vscode.FoldingRange[]> {
            return denizenScriptFoldingProvider(document, context, token);
        }
    });
    scheduleRefresh();
    outputChannel.appendLine('Denizen extension has been activated');
}

class InProcFold {
    start : number;
    spacing : number;
    isCommand : boolean;
    constructor(start: number, spacing: number, isCommand : boolean) {
        this.start = start;
        this.spacing = spacing;
        this.isCommand = isCommand;
    }
}

export function deactivate() {
}
