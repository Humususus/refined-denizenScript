"use strict";
// The settings page panel (R5). The host owns all truth: it reads the settings, runs the real
// tokenizer over the preview and the card samples, and posts the result; the webview paints spans
// by type and sends back `set` messages, written to USER settings -- the level the palette rules are
// built from (paletteRules.userLevel). Keys outside the page's catalogue are refused.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsPanel = void 0;
const crypto = __importStar(require("crypto"));
const vscode = __importStar(require("vscode"));
const paletteRules_1 = require("../highlight/paletteRules");
const settingsHtml_1 = require("./settingsHtml");
const settingsModel_1 = require("./settingsModel");
function overridden(inspected) {
    return inspected !== undefined && (inspected.workspaceValue !== undefined || inspected.workspaceFolderValue !== undefined);
}
class SettingsPanel {
    /**
     * Opens the page, or reveals the open one. Resolves true once the page's script has started and
     * asked for its state, false if it has not within 10 s -- a blocked script (CSP, a wrong resource
     * URI) leaves a blank page with no error anywhere but the webview's own console.
     */
    static show(context, highlightOptions) {
        if (SettingsPanel.current) {
            SettingsPanel.current.panel.reveal();
            return SettingsPanel.current.ready;
        }
        const media = vscode.Uri.joinPath(context.extensionUri, 'media', 'settings');
        const panel = vscode.window.createWebviewPanel('denizenSettings', 'Denizen: Settings', vscode.ViewColumn.Active, {
            enableScripts: true,
            localResourceRoots: [media],
        });
        panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icons', 'dsc.svg');
        SettingsPanel.current = new SettingsPanel(panel, media, highlightOptions);
        return SettingsPanel.current.ready;
    }
    constructor(panel, media, highlightOptions) {
        this.panel = panel;
        this.highlightOptions = highlightOptions;
        this.disposables = [];
        this.markReady = () => undefined;
        this.ready = new Promise(resolve => {
            this.markReady = resolve;
            setTimeout(() => resolve(false), 10000);
        });
        const webview = panel.webview;
        webview.html = (0, settingsHtml_1.settingsHtml)({
            nonce: crypto.randomBytes(16).toString('base64'),
            cspSource: webview.cspSource,
            scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(media, 'settings.js')).toString(),
            styleUri: webview.asWebviewUri(vscode.Uri.joinPath(media, 'settings.css')).toString(),
        });
        webview.onDidReceiveMessage(message => this.receive(message), null, this.disposables);
        // Registered after the extension's own configuration listener, so the highlight options
        // it reloads are already current when the state is rebuilt here.
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('denizenscript') || event.affectsConfiguration('refinedDenizenscript')) {
                this.postState();
            }
        }, null, this.disposables);
        panel.onDidDispose(() => {
            SettingsPanel.current = undefined;
            this.disposables.forEach(d => d.dispose());
        }, null, this.disposables);
    }
    receive(message) {
        if (message.kind === 'ready') {
            this.markReady(true);
            this.postState();
        }
        else if (message.kind === 'set' && typeof message.key === 'string' && (0, settingsModel_1.isWritableSetting)(message.key)) {
            void vscode.workspace.getConfiguration().update(message.key, message.value, vscode.ConfigurationTarget.Global);
        }
    }
    postState() {
        var _a, _b;
        const config = vscode.workspace.getConfiguration();
        const colors = {};
        for (const card of settingsModel_1.COLOR_CARDS) {
            const inspected = config.inspect(`denizenscript.theme_colors.${card.type}`);
            colors[card.type] = Object.assign(Object.assign({}, (0, settingsModel_1.parsePaletteValue)((_a = (0, paletteRules_1.userLevel)(inspected)) !== null && _a !== void 0 ? _a : '')), { overridden: overridden(inspected) });
        }
        const options = {};
        for (const card of settingsModel_1.OPTION_CARDS) {
            const inspected = config.inspect((0, settingsModel_1.optionSettingId)(card.key));
            options[card.key] = { value: (0, paletteRules_1.userLevel)(inspected), overridden: overridden(inspected) };
        }
        const mapInspected = config.inspect('denizenscript.theme_colors.text_color_map');
        const opts = this.highlightOptions();
        void this.panel.webview.postMessage(Object.assign({ kind: 'state', paletteOn: config.get('denizenscript.behaviors.use_custom_syntax_colors', true), colors,
            options, colorMap: (0, settingsModel_1.parseColorMap)((_b = (0, paletteRules_1.userLevel)(mapInspected)) !== null && _b !== void 0 ? _b : ''), colorMapOverridden: overridden(mapInspected), cards: (0, settingsModel_1.cardSpans)(opts), cardInfo: settingsModel_1.COLOR_CARDS, optionInfo: settingsModel_1.OPTION_CARDS }, (0, settingsModel_1.previewState)(opts)));
    }
}
exports.SettingsPanel = SettingsPanel;
//# sourceMappingURL=settingsPanel.js.map