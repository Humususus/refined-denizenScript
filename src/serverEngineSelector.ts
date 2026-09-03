/**
 * Decides which Denizen language server engine to run. Kept free of any
 * `vscode` import (unlike extension.ts) so it can be unit-tested with
 * vitest outside the Extension Host.
 */

export type ServerEngine = 'csharp' | 'typescript';

export function shouldUseTypeScriptServer(engineSetting: string | undefined | null): boolean {
    return engineSetting === 'typescript';
}
