import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// The performance report is only as good as its coverage: a hot path with no label is invisible,
// and the R3 fix then goes after whatever IS labelled. Every label the baseline relies on must be
// wired somewhere in the client sources.
const sources = ['extension.ts', 'mapTagPeek.ts', 'argumentHintsProvider.ts', 'highlight/semanticProvider.ts']
    .filter(f => fs.existsSync(path.join(__dirname, f)))
    .map(f => fs.readFileSync(path.join(__dirname, f), 'utf8'))
    .join('\n');

describe('performance labels are wired into the client', () => {
    for (const label of [
        'highlight.full', 'highlight.partial', 'highlight.setDecorations', 'highlight.ranges',
        'colors.provide', 'folding.provide', 'codelens.provide', 'codelens.count', 'inlayHints.provide',
        'index.update', 'index.updateOnCompletion', 'completion.provide', 'diagnostics.filter', 'textChange.handler',
        'semantic.provide',
    ]) {
        it(label, () => {
            expect(sources).toContain(`'${label}'`);
        });
    }
});
