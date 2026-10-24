// Counts how many coloured ranges the highlighter produces for one file, in both colour modes --
// the number the performance report shows as `highlight.ranges`.
//
//   node scripts/count-highlight-ranges.js [file=.superpowers/perf/big.dsc] [--after-r3]
//
// R3 uses it twice: right after the highlighter moved out of extension.ts the counts must equal
// R2's in-editor measurement (palette 50793, theme 355 on the R2 fixture) -- proof the move changed
// nothing -- and after the palette moved to semantic tokens the decoration count in palette mode
// must drop to the theme-mode figure.
//
// Mirrors extension.ts's configuration with every setting at its default and no config.yml.

const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');
const { highlightLines, baseTagSpecialColors, COLOR_TYPES } = require('../out/highlight/denizenHighlighter');

const file = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(__dirname, '..', '.superpowers', 'perf', 'big.dsc');
const props = pkg.contributes.configuration.properties;
const setting = key => props[key].default;

function tagSpecialColors() {
    const colors = Object.assign({}, baseTagSpecialColors);
    for (const pair of setting('denizenscript.theme_colors.text_color_map').split(',')) {
        const [name, value] = pair.split('=');
        if (value !== undefined) {
            colors['&[' + name.toLowerCase() + ']'] = value;
        }
    }
    return colors;
}

/** What extension.ts would decorate: palette types only when the palette is on, inline colours always. */
function count(palette, decoratedTypes) {
    const colorRef = {};
    if (palette) {
        for (const type of COLOR_TYPES) {
            colorRef[type] = setting('denizenscript.theme_colors.' + type);
        }
    }
    const tokens = highlightLines(fs.readFileSync(file, 'utf8').split('\n'), {
        headerSymbols: setting('denizenscript.header_symbols'),
        doInlineColors: setting('denizenscript.behaviors.do_inline_colors'),
        displayDarkColors: setting('denizenscript.behaviors.display_dark_colors'),
        tagSpecialColors: tagSpecialColors(),
        colorRef,
    });
    return tokens.filter(t => t.type.startsWith('auto:') || (palette && decoratedTypes.includes(t.type))).length;
}

// Which palette types are still decorations. Before R3 Task 4: all of them.
const decorated = process.argv.includes('--after-r3') ? ['bad_space'] : [...COLOR_TYPES];
console.log(`palette ${count(true, decorated)}`);
console.log(`theme ${count(false, decorated)}`);
