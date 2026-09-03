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

import * as vscode from 'vscode';
import { definitionReferenceAt, findDefineAssignments, DefineAssignment } from './definitionValues';

/** How many assignments to list before summarising the rest, so a heavily-reassigned name in a big loop does not fill the hover popup. */
const MAX_SHOWN = 8;

function describeAssignments(name: string, found: DefineAssignment[]): vscode.MarkdownString {
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

export class DefinitionValueHoverProvider implements vscode.HoverProvider {
    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
        const ref = definitionReferenceAt(document.lineAt(position.line).text, position.character);
        if (ref === null) {
            return undefined;
        }
        const found = findDefineAssignments(document.getText(), ref.name);
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

export function activateDefinitionValueHover(context: vscode.ExtensionContext): void {
    context.subscriptions.push(vscode.languages.registerHoverProvider(
        { language: 'denizenscript' }, new DefinitionValueHoverProvider()));
}
