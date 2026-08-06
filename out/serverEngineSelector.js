"use strict";
/**
 * Decides which Denizen language server engine to run. Kept free of any
 * `vscode` import (unlike extension.ts) so it can be unit-tested with
 * vitest outside the Extension Host.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldUseTypeScriptServer = void 0;
function shouldUseTypeScriptServer(engineSetting) {
    return engineSetting === 'typescript';
}
exports.shouldUseTypeScriptServer = shouldUseTypeScriptServer;
//# sourceMappingURL=serverEngineSelector.js.map