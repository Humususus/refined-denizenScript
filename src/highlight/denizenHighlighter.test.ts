import { describe, it, expect } from 'vitest';
import { highlightLines, HighlightOptions, baseTagSpecialColors, COLOR_TYPES } from './denizenHighlighter';
import * as pkg from '../../package.json';

// CHARACTERIZATION TESTS. They pin what the highlighter did when it was moved out of extension.ts
// (R3 Task 1), so they passed on first run by design. A failure here means highlighting changed --
// on purpose or not -- and the palette users see is different from 2.4.1.

const props = (pkg as any).contributes.configuration.properties;
const palette: Record<string, string> = {};
for (const type of COLOR_TYPES) {
    palette[type] = props['denizenscript.theme_colors.' + type].default;
}

function opts(overrides: Partial<HighlightOptions> = {}): HighlightOptions {
    return {
        headerSymbols: '|+=#_@/',
        doInlineColors: true,
        displayDarkColors: false,
        tagSpecialColors: Object.assign({}, baseTagSpecialColors),
        colorRef: palette,
        ...overrides,
    };
}

/** Non-empty single-line tokens as "type text", in emit order. */
function runs(source: string, overrides: Partial<HighlightOptions> = {}, start?: number, end?: number): string[] {
    const lines = source.split('\n');
    return highlightLines(lines, opts(overrides), start, end)
        .filter(t => t.line === t.endLine && t.end > t.start)
        .map(t => `${t.type} ${lines[t.line].slice(t.start, t.end)}`);
}

describe('denizenHighlighter (characterization)', () => {
    it('container key', () => {
        expect(runs('my_task:')).toEqual(['key my_task', 'colons :']);
    });

    it('inline key with value', () => {
        expect(runs('    type: task')).toEqual(['key_inline type', 'colons :', 'space  ', 'normal task']);
    });

    it('command with an inline colour tag and a normal tag', () => {
        expect(runs('- narrate "<&6>Hi <player.name>"')).toEqual([
            'normal -', 'command narrate', 'space  ', 'quote_double "', 'tag <', 'auto:#FFAA00 &6', 'tag >',
            'auto:#FFAA00 Hi', 'space  ', 'tag <player', 'tag_dot .', 'tag name', 'tag >', 'quote_double "',
        ]);
    });

    it('no inline colour tokens when do_inline_colors is off', () => {
        const result = runs('- narrate "<&6>Hi"', { doInlineColors: false });
        expect(result.some(r => r.startsWith('auto:'))).toBe(false);
        expect(result).toContain('quote_double Hi');
    });

    it('define with a data action', () => {
        expect(runs('- define count:++')).toEqual(['normal -', 'command define', 'space  ', 'def_name count', 'data_actions :++']);
    });

    it('if with a definition tag and an operator', () => {
        expect(runs('- if <[a]> >= 10:')).toEqual([
            'normal -', 'colons :', 'command if', 'space  ', 'tag <', 'tag_param_bracket [', 'def_name a',
            'tag_param_bracket ]', 'tag >', 'space  ', 'if_operators >=', 'space  ', 'normal 10',
        ]);
    });

    it('event line with a switch', () => {
        expect(runs('    after player breaks block with:*_pickaxe:')).toEqual([
            'key after', 'space  ', 'event_line player', 'space  ', 'event_line breaks', 'space  ', 'event_line block',
            'space  ', 'event_switch with', 'colons :', 'event_switch_value *_pickaxe', 'colons :',
        ]);
    });

    it('the four comment kinds with the default header symbols', () => {
        const result = runs('# | header |\n# TODO x\n# - narrate x\n# plain');
        expect(result).toContain('comment_header header');
        expect(result).toContain('comment_todo TODO');
        expect(result).toContain('comment_code narrate');
        expect(result).toContain('comment_normal plain');
    });

    it('a command continued onto indented lines maps tokens back to their own lines', () => {
        const lines = ['- narrate a', '    b c', '    d'];
        const tokens = highlightLines(lines, opts());
        const at = (line: number, text: string) => tokens.some(t => t.line === line && t.endLine === line && lines[line].slice(t.start, t.end) === text && t.type === 'normal');
        expect(at(0, 'a')).toBe(true);
        expect(at(1, 'b')).toBe(true);
        expect(at(1, 'c')).toBe(true);
        expect(at(2, 'd')).toBe(true);
        // The joining newline is coloured as a space running from the end of one line into the next.
        expect(tokens.some(t => t.type === 'space' && t.line === 0 && t.start === 11 && t.endLine === 1 && t.end === 0)).toBe(true);
    });

    /** Every token touching [from, to) on line 0, as "type text". */
    function covering(source: string, from: number, to: number): string[] {
        return highlightLines([source], opts())
            .filter(t => t.end > t.start && t.start < to && t.end > from)
            .map(t => `${t.type} ${source.slice(t.start, t.end)}`);
    }

    // Fixed in 2.5.0. Before, the run after a define/flag name started one character early, so a
    // `normal` run covered the name's last letter and the palette showed it in the normal colour.
    it('a define name is coloured as a definition to its last letter', () => {
        expect(covering('- define health <player.health>', 9, 15)).toEqual(['def_name health']);
        expect(covering('- define health 5', 9, 15)).toEqual(['def_name health']);
        expect(covering('- flag player inventory.hookUser:<context.item>', 14, 32))
            .toEqual(['def_name inventory', 'tag_dot .', 'def_name hookUser']);
    });

    // Fixed in 2.5.0. The dot inside a dotted name was coloured starting one character early,
    // taking the letter before it along.
    it('the dot in a dotted definition name covers only the dot', () => {
        expect(covering('- define a.b <x>', 9, 12)).toEqual(['def_name a', 'tag_dot .', 'def_name b']);
    });

    it('a quoted define name with a value still ends at the colon', () => {
        expect(covering('- define "health:5"', 10, 16)).toEqual(['def_name health']);
    });

    it('trailing spaces are bad_space', () => {
        const tokens = highlightLines(['- narrate hi   '], opts());
        expect(tokens.find(t => t.type === 'bad_space')).toMatchObject({ line: 0, start: 12, end: 15 });
    });

    it('a partial range emits only its lines, with the same key context as a full run', () => {
        const source = 'my_world:\n    type: world\n    events:\n        after player breaks block:\n        - narrate x';
        const full = highlightLines(source.split('\n'), opts()).filter(t => t.line >= 3);
        const partial = highlightLines(source.split('\n'), opts(), 3, 5);
        expect(partial.every(t => t.line >= 3)).toBe(true);
        expect(partial).toEqual(full);
    });
});
