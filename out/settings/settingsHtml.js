"use strict";
// The settings page skeleton. No `vscode` import, so the CSP is unit-tested: a script without the
// nonce is blocked and the page is silently blank. Everything visible is built by settings.js from
// the host's `state` message.
Object.defineProperty(exports, "__esModule", { value: true });
exports.settingsHtml = void 0;
function settingsHtml(o) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${o.cspSource}; img-src ${o.cspSource} data:; script-src 'nonce-${o.nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${o.styleUri}">
<title>Denizen: Settings</title>
</head>
<body>
<div id="app"></div>
<script nonce="${o.nonce}" src="${o.scriptUri}"></script>
</body>
</html>
`;
}
exports.settingsHtml = settingsHtml;
//# sourceMappingURL=settingsHtml.js.map