// The settings page panel (R5). The host owns all truth: it reads the settings, runs the real
// tokenizer over the preview and the card samples, and posts the result; the webview paints spans
// by type and sends back `set` messages, written to USER settings -- the level the palette rules are
// built from (paletteRules.userLevel). Keys outside the page's catalogue are refused.
//
// Meta sources (R6) are not written by key: the page sends the edited list, and the host re-reads it
// through metaSources.readSourceSettings before writing, so the webview cannot write arbitrary values.

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { HighlightOptions } from '../highlight/denizenHighlighter';
import { userLevel } from '../highlight/paletteRules';
import { settingsHtml } from './settingsHtml';
import { MetaStatus, readSourceSettings, sourceFromInput, writeSourceSettings } from '../server/metaDocs/metaSources';
import {
    COLOR_CARDS, OPTION_CARDS, PaletteValue, cardSpans, isWritableSetting, metaStatusLine, optionSettingId,
    parseColorMap, parsePaletteValue, previewState, sourcesState
} from './settingsModel';

/** What the page needs from the extension besides the settings themselves. */
export interface SettingsPanelDeps {
    highlightOptions: () => HighlightOptions;
    getMetaStatus: () => MetaStatus | undefined;
    onMetaStatus: vscode.Event<MetaStatus>;
}

const SOURCE_KEYS = ['denizenscript.server.extra_sources', 'denizenscript.server.enabled_addons', 'denizenscript.server.replace_default_sources'];

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
    static show(context: vscode.ExtensionContext, deps: SettingsPanelDeps): Promise<boolean> {
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
        SettingsPanel.current = new SettingsPanel(panel, media, deps);
        return SettingsPanel.current.ready;
    }

    private readonly disposables: vscode.Disposable[] = [];
    private markReady: (ready: boolean) => void = () => undefined;
    private readonly ready = new Promise<boolean>(resolve => {
        this.markReady = resolve;
        setTimeout(() => resolve(false), 10000);
    });

    private constructor(private readonly panel: vscode.WebviewPanel, media: vscode.Uri, private readonly deps: SettingsPanelDeps) {
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
        deps.onMetaStatus(() => this.postState(), null, this.disposables);
        panel.onDidDispose(() => {
            SettingsPanel.current = undefined;
            this.disposables.forEach(d => d.dispose());
        }, null, this.disposables);
    }

    private receive(message: { kind?: unknown; key?: unknown; value?: unknown; input?: unknown }): void {
        if (message.kind === 'ready') {
            this.markReady(true);
            this.postState();
        }
        else if (message.kind === 'set' && typeof message.key === 'string' && isWritableSetting(message.key)) {
            void vscode.workspace.getConfiguration().update(message.key, message.value, vscode.ConfigurationTarget.Global);
        }
        else if (message.kind === 'sources' && message.value !== null && typeof message.value === 'object') {
            const v = message.value as { custom?: unknown; addons?: unknown; replaceDefaults?: unknown };
            const enabled = Array.isArray(v.addons) ? v.addons.filter(a => a && (a as { enabled?: unknown }).enabled === true).map(a => (a as { id?: unknown }).id) : [];
            void this.writeSources(readSourceSettings(v.custom, enabled, v.replaceDefaults));
        }
        else if (message.kind === 'addSource' && typeof message.input === 'string') {
            const current = this.currentSources();
            const added = sourceFromInput(message.input, current);
            if (added !== null) {
                void this.writeSources({ ...current, custom: [...current.custom, added] });
            }
            void this.panel.webview.postMessage({ kind: 'addResult', ok: added !== null });
        }
        else if (message.kind === 'reinstall') {
            void vscode.commands.executeCommand('refinedDenizenscript.reinstallMeta');
        }
    }

    private currentSources() {
        const config = vscode.workspace.getConfiguration();
        return readSourceSettings(
            userLevel(config.inspect('denizenscript.server.extra_sources')),
            userLevel(config.inspect('denizenscript.server.enabled_addons')),
            userLevel(config.inspect('denizenscript.server.replace_default_sources')));
    }

    /** Writes only what changed; the language server restarts once for the lot (RestartScheduler). */
    private async writeSources(next: ReturnType<typeof readSourceSettings>): Promise<void> {
        const config = vscode.workspace.getConfiguration();
        const current = this.currentSources();
        const was = writeSourceSettings(current);
        const now = writeSourceSettings(next);
        if (JSON.stringify(was.extra_sources) !== JSON.stringify(now.extra_sources)) {
            await config.update('denizenscript.server.extra_sources', now.extra_sources, vscode.ConfigurationTarget.Global);
        }
        if (JSON.stringify(was.enabled_addons) !== JSON.stringify(now.enabled_addons)) {
            await config.update('denizenscript.server.enabled_addons', now.enabled_addons, vscode.ConfigurationTarget.Global);
        }
        if (current.replaceDefaults !== next.replaceDefaults) {
            await config.update('denizenscript.server.replace_default_sources', next.replaceDefaults, vscode.ConfigurationTarget.Global);
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
        const current = this.currentSources();
        const status = this.deps.getMetaStatus() ?? null;
        const opts = this.deps.highlightOptions();
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
            sources: { ...sourcesState(current.custom, current.addons.filter(a => a.enabled).map(a => a.id), current.replaceDefaults) },
            sourcesOverridden: SOURCE_KEYS.some(key => overridden(config.inspect(key))),
            metaStatusLine: metaStatusLine(status, Date.now()),
            metaLoadedAt: status === null ? null : status.loadedAt,
        });
    }
}
