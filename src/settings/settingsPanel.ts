// The settings page panel (R5). The host owns all truth: it reads the settings, runs the real
// tokenizer over the preview and the card samples, and posts the result; the webview paints spans
// by type and sends back `set` messages, written to USER settings -- the level the palette rules are
// built from (paletteRules.userLevel). Keys outside the page's catalogue are refused.

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { HighlightOptions } from '../highlight/denizenHighlighter';
import { userLevel } from '../highlight/paletteRules';
import { settingsHtml } from './settingsHtml';
import {
    COLOR_CARDS, OPTION_CARDS, PaletteValue, cardSpans, isWritableSetting, optionSettingId,
    parseColorMap, parsePaletteValue, previewState
} from './settingsModel';

type Inspected<T> = { globalValue?: T; defaultValue?: T; workspaceValue?: T; workspaceFolderValue?: T } | undefined;

function overridden<T>(inspected: Inspected<T>): boolean {
    return inspected !== undefined && (inspected.workspaceValue !== undefined || inspected.workspaceFolderValue !== undefined);
}

export class SettingsPanel {
    private static current: SettingsPanel | undefined;

    /**
     * Opens the page, or reveals the open one. Resolves true once the page's script has started and
     * asked for its state, false if it has not within 10 s -- a blocked script (CSP, a wrong resource
     * URI) leaves a blank page with no error anywhere but the webview's own console.
     */
    static show(context: vscode.ExtensionContext, highlightOptions: () => HighlightOptions): Promise<boolean> {
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

    private readonly disposables: vscode.Disposable[] = [];
    private markReady: (ready: boolean) => void = () => undefined;
    private readonly ready = new Promise<boolean>(resolve => {
        this.markReady = resolve;
        setTimeout(() => resolve(false), 10000);
    });

    private constructor(private readonly panel: vscode.WebviewPanel, media: vscode.Uri, private readonly highlightOptions: () => HighlightOptions) {
        const webview = panel.webview;
        webview.html = settingsHtml({
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

    private receive(message: { kind?: unknown; key?: unknown; value?: unknown }): void {
        if (message.kind === 'ready') {
            this.markReady(true);
            this.postState();
        }
        else if (message.kind === 'set' && typeof message.key === 'string' && isWritableSetting(message.key)) {
            void vscode.workspace.getConfiguration().update(message.key, message.value, vscode.ConfigurationTarget.Global);
        }
    }

    private postState(): void {
        const config = vscode.workspace.getConfiguration();
        const colors: Record<string, PaletteValue & { overridden: boolean }> = {};
        for (const card of COLOR_CARDS) {
            const inspected = config.inspect<string>(`denizenscript.theme_colors.${card.type}`);
            colors[card.type] = { ...parsePaletteValue(userLevel(inspected) ?? ''), overridden: overridden(inspected) };
        }
        const options: Record<string, { value: unknown; overridden: boolean }> = {};
        for (const card of OPTION_CARDS) {
            const inspected = config.inspect(optionSettingId(card.key));
            options[card.key] = { value: userLevel(inspected), overridden: overridden(inspected) };
        }
        const mapInspected = config.inspect<string>('denizenscript.theme_colors.text_color_map');
        const opts = this.highlightOptions();
        void this.panel.webview.postMessage({
            kind: 'state',
            paletteOn: config.get<boolean>('denizenscript.behaviors.use_custom_syntax_colors', true),
            colors,
            options,
            colorMap: parseColorMap(userLevel(mapInspected) ?? ''),
            colorMapOverridden: overridden(mapInspected),
            cards: cardSpans(opts),
            cardInfo: COLOR_CARDS,
            optionInfo: OPTION_CARDS,
            ...previewState(opts),
        });
    }
}
