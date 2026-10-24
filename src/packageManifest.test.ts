import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

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
    it('keeps the TypeScript meta-source settings', () => {
        expect(props).toHaveProperty(['denizenscript.server.extra_sources']);
        expect(props).toHaveProperty(['denizenscript.server.replace_default_sources']);
    });
});
