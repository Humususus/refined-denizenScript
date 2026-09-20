"use strict";
// The `vscode` half of definition-value hover: what `<[id]>` was actually assigned. Every decision
// lives in ./definitionValues, which imports no `vscode` and is unit-tested; this file is the
// wiring, the same split ./mathEvalProvider uses over ./mathEval.
//
// CLIENT-SIDE, so it works on both engines. Neither server tracks what a `- define` line assigns
// at all -- go-to-definition for flags and containers is client-side for the identical reason
// (definitionIndex.ts's header), and definitions have no server-side equivalent to begin with.
//
// SCOPED TO ONE CONTAINER, not the document and not the workspace. A definition is queue-scoped:
// two containers in the same file that both `- define hook` are setting two unrelated variables,
// so listing both was reported (2026-09-14) as the hover "showing every value in every script".
//
// ONE ASSIGNMENT, not all of them. This provider used to list every assignment in the file on the
// grounds that which one is live "can vary by branch or loop iteration" -- true, but in practice it
// filled the popup with lines the author was not asking about. The last assignment AT OR ABOVE the
// hovered line is the one that answers "what is in this right now", and its line number is always
// shown so a wrong guess is visible rather than silent.
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
const definitionIndex_1 = require("./definitionIndex");
function describeAssignment(name, assignment, total) {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**<[${name}]>**\n`);
    md.appendMarkdown(`\nLine ${assignment.line + 1}${assignment.waitable ? ' (~define)' : ''}:`);
    md.appendCodeblock(assignment.value, 'denizenscript');
    if (total > 1) {
        md.appendMarkdown(`\n*${total - 1} other assignment(s) in this container.*`);
    }
    return md;
}
class DefinitionValueHoverProvider {
    provideHover(document, position) {
        const ref = (0, definitionValues_1.definitionReferenceAt)(document.lineAt(position.line).text, position.character);
        if (ref === null) {
            return undefined;
        }
        const text = document.getText();
        const bounds = (0, definitionIndex_1.containerBoundsAt)(text.replace(/\r/g, '').split('\n'), position.line);
        const found = (0, definitionValues_1.findDefineAssignments)(text, ref.name, bounds);
        // Saying nothing when no plain assignment is found is the right answer, matching
        // MathHoverProvider's rule: this name may still be set by `as:`/`key:` on a loop, by
        // `definemap`, by a data-action form none of which this module interprets (see
        // definitionValues.ts's header), or by the CALLER through the container's `definitions:`
        // key -- and repeating "no value found" for all of those would be noise on top of names
        // this hover was never going to resolve to begin with.
        if (found.length === 0) {
            return undefined;
        }
        const active = (0, definitionValues_1.activeAssignment)(found, position.line);
        const range = new vscode.Range(position.line, ref.start, position.line, ref.end);
        return new vscode.Hover(describeAssignment(ref.name, active, found.length), range);
    }
}
exports.DefinitionValueHoverProvider = DefinitionValueHoverProvider;
function activateDefinitionValueHover(context) {
    context.subscriptions.push(vscode.languages.registerHoverProvider({ language: 'denizenscript' }, new DefinitionValueHoverProvider()));
}
exports.activateDefinitionValueHover = activateDefinitionValueHover;
//# sourceMappingURL=definitionValueHoverProvider.js.map