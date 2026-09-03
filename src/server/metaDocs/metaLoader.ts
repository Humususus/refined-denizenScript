/**
 * Meta source loading: downloading source archives and splitting their
 * `<--[type] ... -->` doc comments into raw blocks. Ported from
 * SharpDenizenTools/MetaHandlers/MetaDocsLoader.cs. Pure text/bytes
 * processing — has no knowledge of MetaObject classes.
 */

import * as https from 'https';
import AdmZip from 'adm-zip';

/** Downloads a URL's raw bytes, following redirects, matching the pattern already used in src/extension.ts's downloadFile(). */
export function downloadBinary(url: string): Promise<Buffer> {
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
            const chunks: Buffer[] = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
    });
}

/** Extracts trimmed `//`-prefixed comment lines from every `.java` file entry in a zip archive. Returns tuples of (1-based line number, entry path, comment text with the `//` and one following space stripped). */
export function extractJavaCommentLines(zipBuffer: Buffer): Array<[number, string, string]> {
    const zip = new AdmZip(zipBuffer);
    const result: Array<[number, string, string]> = [];
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

/** Builds a human/browser-friendly URL pointing at the source line, when the source was a GitHub archive zip. */
export function getCorrectUrl(webSource: string, file: string, line: number): string {
    if (webSource.startsWith('https://github')) {
        const base = webSource.substring(0, webSource.length - '.zip'.length).replace('/archive/', '/blob/');
        const afterFirstSlash = file.substring(file.indexOf('/') + 1);
        return `${base}/${afterFirstSlash}#L${line}`;
    }
    return `Web source ${webSource} file ${file} line ${line}`;
}

export interface MetaBlock {
    objectType: string;
    url: string;
    data: string[];
}

/** Splits comment lines into `<--[type] ... -->` blocks. On success, `data` ends with a synthetic `@end_meta` sentinel line, matching the C# LoadDataFromLines behavior that callers (the `@key` parser in metaObjectFactory.ts) depend on to terminate the final key/value pair. */
export function extractMetaBlocks(websrc: string, lines: Array<[number, string, string]>, loadErrors: string[]): MetaBlock[] {
    const blocks: MetaBlock[] = [];
    for (let i = 0; i < lines.length; i++) {
        const [lineNum, file, line] = lines[i];
        if (line.startsWith('<--[') && line.endsWith(']')) {
            const objectType = line.substring('<--['.length, line.length - ']'.length);
            const objectData: string[] = [];
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
