import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// language-configuration.json is JSONC; strip line comments (none of its strings contain "//").
const text = fs.readFileSync(path.join(__dirname, '..', 'language-configuration.json'), 'utf8')
    .split(/\r?\n/).map(line => line.replace(/^\s*\/\/.*$/, '')).join('\n')
    .replace(/,(\s*[}\]])/g, '$1');
const config = JSON.parse(text);

describe('language-configuration.json', () => {
    // Reported 2026-10-25 once the palette stopped painting over VS Code's bracket-pair colours:
    // `likes: [)|(]` in a data container and `<list[(|)]>` turned red. Parentheses and quotes are
    // ordinary text in Denizen -- decoration in player-facing strings, apostrophes in words -- so
    // counting them as pairs flags text as broken code. Square brackets are tag-parameter syntax
    // and always balanced, so they are the only pair worth colouring and matching.
    it('only square brackets are bracket pairs', () => {
        expect(config.brackets).toEqual([['[', ']']]);
    });

    // Reported 2026-10-26: with the palette drawn as semantic tokens (2.5.0), VS Code's per-depth
    // bracket colours (yellow / pink / blue) showed through on every <[x]> and tag[...], where the
    // 2.4.1 palette had painted them in tag_param_bracket. Colouring is switched off; matching the
    // pair under the cursor ("brackets" above) still works.
    it('does not colourize bracket pairs by depth', () => {
        expect(config.colorizedBracketPairs).toEqual([]);
    });

    it('still auto-closes quotes and parentheses while typing', () => {
        expect(config.autoClosingPairs).toEqual(expect.arrayContaining([['(', ')'], ['"', '"'], ["'", "'"]]));
    });
});
