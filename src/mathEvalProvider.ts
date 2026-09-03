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

import * as vscode from 'vscode';
import { evaluateMathTag, looksArithmetic, MathResult } from './mathEval';
import { findTagAt } from './tagFormatter';

/** Renders a result as the markdown shown to the user. */
function describeResult(expression: string, result: MathResult): vscode.MarkdownString {
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

export class MathHoverProvider implements vscode.HoverProvider {
    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
        if (!vscode.workspace.getConfiguration('denizenscript').get<boolean>('evaluateMathTags', true)) {
            return undefined;
        }
        const found = findTagAt(document.lineAt(position.line).text, position.character);
        // Saying nothing about a non-arithmetic tag is the right answer: the language server's own
        // hover documents those, and a second hover repeating "not arithmetic" would be noise.
        if (found === null || !looksArithmetic(found.text)) {
            return undefined;
        }
        const range = new vscode.Range(position.line, found.start, position.line, found.end);
        return new vscode.Hover(describeResult(found.text, evaluateMathTag(found.text)), range);
    }
}

/**
 * Evaluates the tag at the caret, asking for each value the server would supply.
 *
 * This is the "fillable placeholders" half of the original request. It asks with an input box per
 * missing value rather than opening a panel: the values are typed once and thrown away, and a
 * panel that has to be closed afterwards is more ceremony than the task deserves.
 */
async function evaluateMathCommand(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined || editor.document.languageId !== 'denizenscript') {
        return;
    }
    const position = editor.selection.active;
    const found = findTagAt(editor.document.lineAt(position.line).text, position.character);
    if (found === null || !looksArithmetic(found.text)) {
        vscode.window.showInformationMessage('Put the caret inside an arithmetic tag, such as <element[5].add[3]>.');
        return;
    }
    const supplied = new Map<string, number>();
    // Loop rather than resolve once: supplying a value can reveal further inputs, because a tag
    // used as an argument is only reached once the ones before it are known.
    for (let round = 0; round < 16; round++) {
        const result = evaluateMathTag(found.text, supplied);
        if (result.kind !== 'needs-input') {
            const md = describeResult(found.text, result);
            md.isTrusted = false;
            if (result.kind === 'value') {
                const copy = 'Copy result';
                const choice = await vscode.window.showInformationMessage(
                    `${found.text} = ${result.display}${result.rounded ? '  (rounded)' : ''}`, copy);
                if (choice === copy) {
                    await vscode.env.clipboard.writeText(result.display);
                }
            }
            else {
                vscode.window.showInformationMessage(result.reason);
            }
            return;
        }
        const name = result.inputs[0];
        const typed = await vscode.window.showInputBox({
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
}

export function activateMathEval(context: vscode.ExtensionContext): void {
    context.subscriptions.push(vscode.languages.registerHoverProvider(
        { language: 'denizenscript' }, new MathHoverProvider()));
    context.subscriptions.push(vscode.commands.registerCommand(
        'refinedDenizenscript.evaluateMathTag', evaluateMathCommand));
}
