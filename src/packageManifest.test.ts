import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SEMANTIC_TYPES } from './highlight/semanticEncoding';

// Pins what 2.4.0 removed: the C# engine, its settings and .NET dependency, and the GitHub
// updater. Read straight from package.json so a revert of any one of them fails here.
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const props: Record<string, unknown> = pkg.contributes.configuration.properties;
const commandIds: string[] = pkg.contributes.commands.map((c: { command: string }) => c.command);

describe('package.json — removed features stay removed', () => {
    it('has no language-server engine switch', () => {
        expect(props).not.toHaveProperty(['denizenscript.server.engine']);
    });
    it('has no C#-only settings', () => {
        for (const key of ['denizenscript.extra_sources', 'denizenscript.behaviors.do_hover_docs', 'denizenscript.behaviors.do_tab_completes']) {
            expect(props).not.toHaveProperty([key]);
        }
    });
    it('has no GitHub updater settings, command or activation event', () => {
        expect(Object.keys(props).filter(k => k.startsWith('refinedDenizenscript.update.'))).toEqual([]);
        expect(commandIds).not.toContain('refinedDenizenscript.checkForUpdates');
        expect(pkg.activationEvents).not.toContain('onCommand:refinedDenizenscript.checkForUpdates');
    });
    it('does not depend on the .NET runtime extension', () => {
        expect(pkg.extensionDependencies ?? []).not.toContain('ms-dotnettools.vscode-dotnet-runtime');
    });
    it('no setting description still talks about choosing an engine', () => {
        const text = JSON.stringify(props);
        expect(text).not.toMatch(/C# engine|TypeScript (language server )?engine|server\.engine/);
    });
    it('ships the performance debug setting and its two commands', () => {
        expect(props).toHaveProperty(['denizenscript.debug.performance']);
        expect(commandIds).toEqual(expect.arrayContaining(['refinedDenizenscript.showPerformanceReport', 'refinedDenizenscript.resetPerformanceStats']));
    });
    // engines.vscode is below 1.74, so VS Code does NOT synthesise onCommand activation: a palette
    // command run before any .dsc opened answers "command not found" without these.
    it('activates on the palette-only commands', () => {
        for (const id of ['refinedDenizenscript.showPerformanceReport', 'refinedDenizenscript.resetPerformanceStats']) {
            expect(pkg.activationEvents).toContain(`onCommand:${id}`);
        }
    });
    it('declares every Denizen semantic token type', () => {
        const declared = (pkg.contributes.semanticTokenTypes ?? []).map((t: { id: string }) => t.id);
        expect(declared).toEqual(expect.arrayContaining([...SEMANTIC_TYPES]));
    });
    // Many themes leave semantic highlighting off ("configuredByTheme"), and then the palette's
    // token colours are silently ignored. Turned on for Denizen files only.
    it('turns semantic highlighting on for denizenscript files', () => {
        expect(pkg.contributes.configurationDefaults['[denizenscript]']['editor.semanticHighlighting.enabled']).toBe(true);
    });
    // Spec 3b, user ruling 2026-10-25: everyone is used to the Denizen palette. Explicit user values win.
    it('uses the Denizen palette by default', () => {
        expect((props['denizenscript.behaviors.use_custom_syntax_colors'] as { default: unknown }).default).toBe(true);
    });
    // The TODO / code comment icons were tried during 2.6.0 and removed by the user before release.
    it('has no comment icons setting', () => {
        expect(props).not.toHaveProperty(['denizenscript.behaviors.comment_icons']);
    });
    // The tree provider was registered in code for several releases while the manifest never
    // declared the view, so nobody could see it.
    it('declares the Denizen scripts view the tree provider is registered for', () => {
        const viewIds = Object.values(pkg.contributes.views ?? {}).flat().map(v => (v as { id: string }).id);
        expect(viewIds).toContain('denizenScripts');
    });
    // The view appeared unasked in 2.6.1; the user asked for a way to switch it off (2026-10-26).
    it('lets the Denizen scripts view be switched off', () => {
        expect(props).toHaveProperty(['denizenscript.behaviors.show_scripts_view']);
        const view = pkg.contributes.views.explorer.find((v: { id: string }) => v.id === 'denizenScripts');
        expect(view.when).toContain('config.denizenscript.behaviors.show_scripts_view');
    });
    it('keeps the TypeScript meta-source settings', () => {
        expect(props).toHaveProperty(['denizenscript.server.extra_sources']);
        expect(props).toHaveProperty(['denizenscript.server.replace_default_sources']);
    });
});
