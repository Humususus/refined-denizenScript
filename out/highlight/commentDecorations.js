"use strict";
// The light red band behind `###` comment lines (2.6.0) -- the one thing about comment levels that
// semantic tokens cannot draw, since a token has no background. This decides WHERE; extension.ts
// turns it into a decoration. No `vscode` import. Comment lines are few, so the whole document is
// cheap.
//
// Icons before `# TODO` and `# -` were tried in the same release and removed by the user before
// it shipped: they looked worse in the editor than in the mockup.
Object.defineProperty(exports, "__esModule", { value: true });
exports.criticalBackground = exports.criticalLines = void 0;
const commentKind_1 = require("./commentKind");
/** The lines that are `###` comments. */
function criticalLines(lines, headerSymbols) {
    const result = [];
    lines.forEach((line, i) => {
        if ((0, commentKind_1.commentKind)(line, headerSymbols) === 'comment_critical') {
            result.push(i);
        }
    });
    return result;
}
exports.criticalLines = criticalLines;
/** The `###` band: the critical colour at ~16% alpha (0x29), as the mockup's color-mix(16%). */
function criticalBackground(color) {
    const hex = /^#[0-9a-fA-F]{6}/.exec(color);
    return (hex === null ? '#FF5555' : hex[0]) + '29';
}
exports.criticalBackground = criticalBackground;
//# sourceMappingURL=commentDecorations.js.map