// What kind of comment a line is. One function, shared by the highlighter, comment folding and the
// comment decorations, so the colour, the fold and the icon can never disagree about a line.
// No `vscode` import.

export type CommentKind = 'comment_critical' | 'comment_warning' | 'comment_header' | 'comment_code' | 'comment_todo' | 'comment_normal';

/**
 * `###`+ is critical and `##` a warning when followed by a space or the end of the line. `##word`
 * is NOT a level: `##ignorewarning x` is how the checker is silenced, and a yellow directive would
 * read as a warning about the directive. Everything else keeps the pre-2.6.0 order: header symbol,
 * `-` (commented-out code), `todo`, plain. Null when the trimmed line does not start with `#` --
 * Denizen has no end-of-line comment.
 */
export function commentKind(line: string, headerSymbols: string): CommentKind | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith('#')) {
        return null;
    }
    const level = /^(#+)(\s|$)/.exec(trimmed);
    if (level !== null && level[1].length >= 3) {
        return 'comment_critical';
    }
    if (level !== null && level[1].length === 2) {
        return 'comment_warning';
    }
    const afterComment = trimmed.substring(1).trim();
    const symbol = afterComment.length === 0 ? ' ' : afterComment.charAt(0);
    if (headerSymbols.includes(symbol)) {
        return 'comment_header';
    }
    if (afterComment.startsWith('-')) {
        return 'comment_code';
    }
    if (afterComment.toLowerCase().startsWith('todo')) {
        return 'comment_todo';
    }
    return 'comment_normal';
}
