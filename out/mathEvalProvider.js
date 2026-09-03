"use strict";
// The `vscode` half of offline math evaluation: a hover that shows what an arithmetic tag works
// out to, and a command that asks for the values only the server would know. Every decision lives
// in ./mathEval, which imports no `vscode` and is unit-tested; this file is the wiring.
//
// CLIENT-SIDE, so it works on both engines -- the C# server does no arithmetic at all, and the
// TypeScript one does not either; this is new capability rather than a port.
//
// A HOVER RATHER THAN A PANEL, at least to begin with. The feature request asked for a side panel
// with fillable placeholders, and the command below covers that half. But the common case is
// wanting to know what `<element[1].sub[<element[2].mul[3]>]>` comes to, and for that a hover
// costs one mouse movement where a panel costs a command, a focus change and a way back.
//
// THE HONESTY RULE, carried through from ./mathEval: a result that is not the exact double is
// labelled as rounded. Denizen's numeric representation cannot be established from anything this
// repo has, so a bare number would be a claim this code is not in a position to make.
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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateMathEval = exports.MathHoverProvider = void 0;
const vscode = __importStar(require("vscode"));
const mathEval_1 = require("./mathEval");
const tagFormatter_1 = require("./tagFormatter");
/** Renders a result as the markdown shown to the user. */
function describeResult(expression, result) {
    const md = new vscode.MarkdownString();
    md.appendCodeblock(expression, 'denizenscript');
    if (result.kind === 'value') {
        md.appendMarkdown(`\n**= ${result.display}**`);
        if (result.rounded) {
            // Never silently. See the honesty rule in the file header.
            md.appendMarkdown(`\n\nShown rounded; the exact double is \`${result.value}\`.`
                + ' Denizen may print either form depending on how it stores numbers.');
        }
    }
    else if (result.kind === 'needs-input') {
        md.appendMarkdown('\nNeeds values only the server knows:\n');
        for (const input of result.inputs) {
            md.appendMarkdown(`\n- \`${input}\``);
        }
        md.appendMarkdown('\n\nRun **Refined DenizenScript: Evaluate Math Tag** to supply them.');
    }
    else {
        md.appendMarkdown(`\n${result.reason}`);
    }
    return md;
}
class MathHoverProvider {
    provideHover(document, position) {
        if (!vscode.workspace.getConfiguration('denizenscript').get('evaluateMathTags', true)) {
            return undefined;
        }
        const found = (0, tagFormatter_1.findTagAt)(document.lineAt(position.line).text, position.character);
        // Saying nothing about a non-arithmetic tag is the right answer: the language server's own
        // hover documents those, and a second hover repeating "not arithmetic" would be noise.
        if (found === null || !(0, mathEval_1.looksArithmetic)(found.text)) {
            return undefined;
        }
        const range = new vscode.Range(position.line, found.start, position.line, found.end);
        return new vscode.Hover(describeResult(found.text, (0, mathEval_1.evaluateMathTag)(found.text)), range);
    }
}
exports.MathHoverProvider = MathHoverProvider;
/**
 * Evaluates the tag at the caret, asking for each value the server would supply.
 *
 * This is the "fillable placeholders" half of the original request. It asks with an input box per
 * missing value rather than opening a panel: the values are typed once and thrown away, and a
 * panel that has to be closed afterwards is more ceremony than the task deserves.
 */
function evaluateMathCommand() {
    return __awaiter(this, void 0, void 0, function* () {
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined || editor.document.languageId !== 'denizenscript') {
            return;
        }
        const position = editor.selection.active;
        const found = (0, tagFormatter_1.findTagAt)(editor.document.lineAt(position.line).text, position.character);
        if (found === null || !(0, mathEval_1.looksArithmetic)(found.text)) {
            vscode.window.showInformationMessage('Put the caret inside an arithmetic tag, such as <element[5].add[3]>.');
            return;
        }
        const supplied = new Map();
        // Loop rather than resolve once: supplying a value can reveal further inputs, because a tag
        // used as an argument is only reached once the ones before it are known.
        for (let round = 0; round < 16; round++) {
            const result = (0, mathEval_1.evaluateMathTag)(found.text, supplied);
            if (result.kind !== 'needs-input') {
                const md = describeResult(found.text, result);
                md.isTrusted = false;
                if (result.kind === 'value') {
                    const copy = 'Copy result';
                    const choice = yield vscode.window.showInformationMessage(`${found.text} = ${result.display}${result.rounded ? '  (rounded)' : ''}`, copy);
                    if (choice === copy) {
                        yield vscode.env.clipboard.writeText(result.display);
                    }
                }
                else {
                    vscode.window.showInformationMessage(result.reason);
                }
                return;
            }
            const name = result.inputs[0];
            const typed = yield vscode.window.showInputBox({
                title: `Evaluate ${found.text}`,
                prompt: `Value for ${name}`,
                placeHolder: 'a number',
                validateInput: text => Number.isFinite(Number(text)) && text.trim().length > 0
                    ? undefined
                    : 'Enter a number.'
            });
            if (typed === undefined) {
                return;
            }
            supplied.set(name, Number(typed));
        }
    });
}
function activateMathEval(context) {
    context.subscriptions.push(vscode.languages.registerHoverProvider({ language: 'denizenscript' }, new MathHoverProvider()));
    context.subscriptions.push(vscode.commands.registerCommand('refinedDenizenscript.evaluateMathTag', evaluateMathCommand));
}
exports.activateMathEval = activateMathEval;
//# sourceMappingURL=mathEvalProvider.js.map