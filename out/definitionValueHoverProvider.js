"use strict";
// The `vscode` half of definition-value hover: what `<[id]>` was actually assigned. Every decision
// lives in ./definitionValues, which imports no `vscode` and is unit-tested; this file is the
// wiring, the same split ./mathEvalProvider uses over ./mathEval.
//
// CLIENT-SIDE, so it works on both engines. Neither server tracks what a `- define` line assigns
// at all -- go-to-definition for flags and containers is client-side for the identical reason
// (definitionIndex.ts's header), and definitions have no server-side equivalent to begin with.
//
// SCOPED TO THE CURRENT DOCUMENT, not the workspace. Unlike a script container or a flag, a
// definition is queue-scoped and almost never meaningfully referenced across files; scanning every
// open document for a definition hover would be the wrong kind of thorough.
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
exports.activateDefinitionValueHover = exports.DefinitionValueHoverProvider = void 0;
const vscode = __importStar(require("vscode"));
const definitionValues_1 = require("./definitionValues");
/** How many assignments to list before summarising the rest, so a heavily-reassigned name in a big loop does not fill the hover popup. */
const MAX_SHOWN = 8;
function describeAssignments(name, found) {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**<[${name}]>**\n`);
    for (const assignment of found.slice(0, MAX_SHOWN)) {
        md.appendMarkdown(`\nLine ${assignment.line + 1}${assignment.waitable ? ' (~define)' : ''}:`);
        md.appendCodeblock(assignment.value, 'denizenscript');
    }
    if (found.length > MAX_SHOWN) {
        md.appendMarkdown(`\n*...and ${found.length - MAX_SHOWN} more assignment(s) further in this file.*`);
    }
    return md;
}
class DefinitionValueHoverProvider {
    provideHover(document, position) {
        const ref = (0, definitionValues_1.definitionReferenceAt)(document.lineAt(position.line).text, position.character);
        if (ref === null) {
            return undefined;
        }
        const found = (0, definitionValues_1.findDefineAssignments)(document.getText(), ref.name);
        // Saying nothing when no plain assignment is found is the right answer, matching
        // MathHoverProvider's rule: this name may still be set by `as:`/`key:` on a loop, by
        // `definemap`, or by a data-action form none of which this module interprets (see
        // definitionValues.ts's header), and repeating "no value found" for all of those would be
        // noise on top of names this hover was never going to resolve to begin with.
        if (found.length === 0) {
            return undefined;
        }
        const range = new vscode.Range(position.line, ref.start, position.line, ref.end);
        return new vscode.Hover(describeAssignments(ref.name, found), range);
    }
}
exports.DefinitionValueHoverProvider = DefinitionValueHoverProvider;
function activateDefinitionValueHover(context) {
    context.subscriptions.push(vscode.languages.registerHoverProvider({ language: 'denizenscript' }, new DefinitionValueHoverProvider()));
}
exports.activateDefinitionValueHover = activateDefinitionValueHover;
//# sourceMappingURL=definitionValueHoverProvider.js.map