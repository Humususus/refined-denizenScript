// What semantic tokens cannot draw for comments (2.6.0): the light red band behind `###` lines and
// the icons before `# TODO` and `# -`. This decides WHERE and WHAT; extension.ts turns it into
// decorations. No `vscode` import. Comment lines are few, so the whole document is cheap.

import { commentKind } from './commentKind';

export interface CommentMarks {
    /** Lines that are `###` comments: a full-line background. */
    critical: number[];
    /** `# TODO` lines and the column of their `#`: an icon before it. */
    todo: { line: number; column: number }[];
    /** `# -` (commented-out code) lines and the column of their `#`. */
    code: { line: number; column: number }[];
}

export function commentLines(lines: string[], headerSymbols: string): CommentMarks {
    const marks: CommentMarks = { critical: [], todo: [], code: [] };
    lines.forEach((line, i) => {
        const kind = commentKind(line, headerSymbols);
        const column = line.length - line.trimStart().length;
        if (kind === 'comment_critical') {
            marks.critical.push(i);
        }
        else if (kind === 'comment_todo') {
            marks.todo.push({ line: i, column });
        }
        else if (kind === 'comment_code') {
            marks.code.push({ line: i, column });
        }
    });
    return marks;
}

/** The icon, as SVG text, matching the settings mockup's shapes. */
export function iconSvg(kind: 'todo' | 'code', color: string): string {
    if (kind === 'todo') {
        return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">'
            + `<rect x="1" y="1" width="14" height="14" rx="3" fill="${color}"/>`
            + '<path d="M4.5 8.2l2.3 2.3 4.7-5" stroke="#000000" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
            + '</svg>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">'
        + `<path d="M4 3l9 5-9 5z" fill="${color}"/>`
        + '</svg>';
}

/** The `###` band: the critical colour at ~16% alpha (0x29), as the mockup's color-mix(16%). */
export function criticalBackground(color: string): string {
    const hex = /^#[0-9a-fA-F]{6}/.exec(color);
    return (hex === null ? '#FF5555' : hex[0]) + '29';
}
