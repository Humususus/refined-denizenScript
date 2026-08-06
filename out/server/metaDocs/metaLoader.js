"use strict";
/**
 * Meta source loading: downloading source archives and splitting their
 * `<--[type] ... -->` doc comments into raw blocks. Ported from
 * SharpDenizenTools/MetaHandlers/MetaDocsLoader.cs. Pure text/bytes
 * processing — has no knowledge of MetaObject classes.
 */
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractMetaBlocks = exports.getCorrectUrl = exports.extractJavaCommentLines = exports.downloadBinary = void 0;
const https = __importStar(require("https"));
const adm_zip_1 = __importDefault(require("adm-zip"));
/** Downloads a URL's raw bytes, following redirects, matching the pattern already used in src/extension.ts's downloadFile(). */
function downloadBinary(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: { 'User-Agent': 'DenizenMetaScanner/1.0' }
        }, response => {
            if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                downloadBinary(response.headers.location).then(resolve, reject);
                return;
            }
            if (response.statusCode !== 200) {
                reject(new Error(`Source download returned HTTP ${response.statusCode} for ${url}`));
                response.resume();
                return;
            }
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
    });
}
exports.downloadBinary = downloadBinary;
/** Extracts trimmed `//`-prefixed comment lines from every `.java` file entry in a zip archive. Returns tuples of (1-based line number, entry path, comment text with the `//` and one following space stripped). */
function extractJavaCommentLines(zipBuffer) {
    const zip = new adm_zip_1.default(zipBuffer);
    const result = [];
    for (const entry of zip.getEntries()) {
        if (entry.isDirectory || !entry.entryName.endsWith('.java')) {
            continue;
        }
        const content = entry.getData().toString('utf-8');
        const rawLines = content.split('\n');
        for (let i = 0; i < rawLines.length; i++) {
            const trimmed = rawLines[i].trim().replace(/\r/g, '');
            if (trimmed.startsWith('//')) {
                const text = trimmed.length === '//'.length ? '' : trimmed.substring('// '.length);
                result.push([i + 1, entry.entryName, text]);
            }
        }
    }
    return result;
}
exports.extractJavaCommentLines = extractJavaCommentLines;
/** Builds a human/browser-friendly URL pointing at the source line, when the source was a GitHub archive zip. */
function getCorrectUrl(webSource, file, line) {
    if (webSource.startsWith('https://github')) {
        const base = webSource.substring(0, webSource.length - '.zip'.length).replace('/archive/', '/blob/');
        const afterFirstSlash = file.substring(file.indexOf('/') + 1);
        return `${base}/${afterFirstSlash}#L${line}`;
    }
    return `Web source ${webSource} file ${file} line ${line}`;
}
exports.getCorrectUrl = getCorrectUrl;
/** Splits comment lines into `<--[type] ... -->` blocks. On success, `data` ends with a synthetic `@end_meta` sentinel line, matching the C# LoadDataFromLines behavior that callers (the `@key` parser in metaObjectFactory.ts) depend on to terminate the final key/value pair. */
function extractMetaBlocks(websrc, lines, loadErrors) {
    const blocks = [];
    for (let i = 0; i < lines.length; i++) {
        const [lineNum, file, line] = lines[i];
        if (line.startsWith('<--[') && line.endsWith(']')) {
            const objectType = line.substring('<--['.length, line.length - ']'.length);
            const objectData = [];
            let closed = false;
            let broken = false;
            for (i++; i < lines.length; i++) {
                const [, curFile, curLine] = lines[i];
                if (curLine === '-->') {
                    closed = true;
                    break;
                }
                else if (curLine.startsWith('<--[')) {
                    loadErrors.push(`While processing ${file} at line ${i + 1} found the start of a meta block, while still processing the previous meta block.`);
                    broken = true;
                    break;
                }
                else if (curFile !== file) {
                    loadErrors.push(`While processing ${file} was not able to find the end of an object's documentation!`);
                    broken = true;
                    break;
                }
                objectData.push(curLine);
            }
            if (broken || !closed) {
                continue;
            }
            objectData.push('@end_meta');
            blocks.push({ objectType, url: getCorrectUrl(websrc, file, lineNum), data: objectData });
        }
        else if (line.startsWith('<--')) {
            loadErrors.push(`While processing ${file} at line ${i + 1} found the '<--' meta starter, but not a valid meta start.`);
        }
    }
    return blocks;
}
exports.extractMetaBlocks = extractMetaBlocks;
//# sourceMappingURL=metaLoader.js.map