import { describe, it, expect } from 'vitest';
import { CompletionItemKind } from 'vscode-languageserver';
import { provideCompletions, completeCommandNames, completeCommandArguments, completeTag } from './completionProvider';
import { MetaCommand, MetaTag, MetaDocs, createEmptyMetaDocs, META_TYPE_COMMAND, META_TYPE_TAG } from '../metaDocs/metaTypes';
import { buildExtraData, parseFlatFds, createEmptyExtraData } from '../metaDocs/extraData';
import { TagCursorContext } from './tagContext';
import { buildMetaDocs } from '../metaDocs/metaDocsManager';
import { linkTypeGraph } from '../metaDocs/metaLinker';
import type { MetaBlock } from '../metaDocs/metaLoader';

function makeCommand(name: string, syntax: string, short: string): MetaCommand {
    const cmd = new MetaCommand();
    cmd.type = META_TYPE_COMMAND;
    cmd.commandName = name;
    cmd.syntax = syntax;
    cmd.short = short;
    return cmd;
}

function docsWith(...commands: MetaCommand[]): MetaDocs {
    const docs = createEmptyMetaDocs();
    for (const cmd of commands) {
        cmd.addTo(docs);
    }
    return docs;
}

function makeTag(attribute: string, returns: string, description: string): MetaTag {
    const tag = new MetaTag();
    tag.type = META_TYPE_TAG;
    tag.applyValue('attribute', attribute);
    tag.applyValue('returns', returns);
    tag.applyValue('description', description);
    return tag;
}

// Registers two tags: `<PlayerTag.name>` (base "playertag", part "name", no exact
// docs.tags entry for the bare base "playertag") and `<player>` (base "player" with
// no dot, so its own cleanName IS the base — an exact docs.tags entry for "player").
// The pair is what lets a single fixture cover both "has documentation" and "does not"
// for base completion without a third tag.
function tagDocs(): MetaDocs {
    const docs = createEmptyMetaDocs();
    makeTag('<PlayerTag.name>', 'ElementTag', 'Returns the name of the player.').addTo(docs);
    makeTag('<player>', 'PlayerTag', 'Returns the linked player.').addTo(docs);
    return docs;
}

const NARRATE = () => makeCommand('narrate', 'narrate [<text>] (targets:<player>|...) (format:<name>) (per_player)', 'Shows text.');
const NOTE = () => makeCommand('note', 'note [<object>] [as:<name>]', 'Notes an object.');

describe('completeCommandNames', () => {
    it('returns every command sharing the given prefix', () => {
        const docs = docsWith(NARRATE(), NOTE());
        expect(completeCommandNames(docs, 'n').map(i => i.label).sort()).toEqual(['narrate', 'note']);
    });

    it('narrows as the prefix grows', () => {
        const docs = docsWith(NARRATE(), NOTE());
        expect(completeCommandNames(docs, 'na').map(i => i.label)).toEqual(['narrate']);
    });

    it('marks results as methods and attaches documentation', () => {
        const docs = docsWith(NARRATE());
        const item = completeCommandNames(docs, 'narrate')[0];
        expect(item.kind).toBe(CompletionItemKind.Method);
        expect(item.detail).toBe('Shows text.');
        expect(String((item.documentation as { value: string }).value)).toContain('### Command narrate');
    });

    it('returns everything for an empty prefix', () => {
        const docs = docsWith(NARRATE(), NOTE());
        expect(completeCommandNames(docs, '')).toHaveLength(2);
    });
});

describe('completeCommandArguments', () => {
    it('offers prefixed arguments with a trailing colon', () => {
        const cmd = NARRATE();
        cmd.parseSyntax();
        expect(completeCommandArguments(cmd, 'f').map(i => i.label)).toEqual(['format:']);
    });

    it('offers flat arguments without a colon', () => {
        const cmd = NARRATE();
        cmd.parseSyntax();
        expect(completeCommandArguments(cmd, 'per').map(i => i.label)).toEqual(['per_player']);
    });

    it('offers both kinds when the prefix matches both', () => {
        const cmd = NARRATE();
        cmd.parseSyntax();
        expect(completeCommandArguments(cmd, '').map(i => i.label).sort())
            .toEqual(['format:', 'per_player', 'targets:']);
    });

    it('matches a prefix name against the text typed before the colon', () => {
        const cmd = NARRATE();
        cmd.parseSyntax();
        expect(completeCommandArguments(cmd, 'targets').map(i => i.label)).toEqual(['targets:']);
    });
});

describe('provideCompletions', () => {
    it('completes a command name after a dash', () => {
        const docs = docsWith(NARRATE(), NOTE());
        const text = 'my_task:\n  type: task\n  script:\n  - na';
        expect(provideCompletions(docs, createEmptyExtraData(), text, text.length, 3).map(i => i.label)).toEqual(['narrate']);
    });

    it('completes arguments once a command name and a space are present', () => {
        const docs = docsWith(NARRATE());
        const text = '  - narrate hello for';
        expect(provideCompletions(docs, createEmptyExtraData(), text, text.length, 0).map(i => i.label)).toEqual(['format:']);
    });

    it('tolerates the wait-for tilde prefix', () => {
        const docs = docsWith(NARRATE());
        const text = '  - ~nar';
        expect(provideCompletions(docs, createEmptyExtraData(), text, text.length, 0).map(i => i.label)).toEqual(['narrate']);
    });

    it('returns nothing on a line that is not a command line', () => {
        const docs = docsWith(NARRATE());
        const text = 'my_task:\n  type: ta';
        expect(provideCompletions(docs, createEmptyExtraData(), text, text.length, 1)).toEqual([]);
    });

    it('returns nothing for an unrecognised command name', () => {
        const docs = docsWith(NARRATE());
        const text = '  - notacommand arg';
        expect(provideCompletions(docs, createEmptyExtraData(), text, text.length, 0)).toEqual([]);
    });

    it('returns nothing for an out-of-range offset', () => {
        const docs = docsWith(NARRATE());
        expect(provideCompletions(docs, createEmptyExtraData(), '  - nar', 999, 0)).toEqual([]);
    });
});

describe('enum-backed argument value completion', () => {
    const EXTRA = buildExtraData(parseFlatFds([
        'sounds:', '- BLOCK.STONE.STEP', '- BLOCK.STONE.BREAK', '- AMBIENT.CAVE',
        'blocks:', '- STONE', '- STONE_BRICKS',
        ''
    ].join('\n')));

    function playsoundDocs(): MetaDocs {
        return docsWith(makeCommand('playsound',
            'playsound [<location>|...] [sound:<name>] (volume:<#.#>)', 'Plays a sound.'));
    }

    it('offers sound names after the sound: prefix', () => {
        const text = '  - playsound <player.location> sound:block.stone.';
        const labels = provideCompletions(playsoundDocs(), EXTRA, text, text.length, 0).map(i => i.label);
        expect(labels).toContain('block.stone.step');
        expect(labels).toContain('block.stone.break');
        expect(labels).not.toContain('ambient.cave');
    });

    it('offers every sound when nothing follows the prefix yet', () => {
        const text = '  - playsound sound:';
        const labels = provideCompletions(playsoundDocs(), EXTRA, text, text.length, 0).map(i => i.label);
        expect(labels.sort()).toEqual(['ambient.cave', 'block.stone.break', 'block.stone.step']);
    });

    it('labels enum results with the enum name', () => {
        const text = '  - playsound sound:ambient';
        const item = provideCompletions(playsoundDocs(), EXTRA, text, text.length, 0)[0];
        expect(item.kind).toBe(CompletionItemKind.Enum);
        expect(String((item.documentation as { value: string }).value)).toContain('Sound Enum');
    });

    it('still offers the command\'s own argument names when no colon is typed', () => {
        const text = '  - playsound vol';
        const labels = provideCompletions(playsoundDocs(), EXTRA, text, text.length, 0).map(i => i.label);
        expect(labels).toContain('volume:');
    });

    it('offers nothing extra for a prefix with no registered enum', () => {
        const text = '  - playsound volume:0.';
        expect(provideCompletions(playsoundDocs(), EXTRA, text, text.length, 0)).toEqual([]);
    });

    // Regression coverage for the reported bug: with no wordPattern in
    // language-configuration.json, VS Code's default word definition treats '.' and ':'
    // as word breaks. Without an explicit textEdit, accepting a completion for
    // 'sound:block.a' replaces only the trailing 'a' (the "current word"), leaving
    // 'block.' in place and producing 'sound:block.block.amethyst_block.break'. The
    // textEdit's range must span the entire typed value so acceptance replaces
    // 'block.a' as a whole with the full dotted value.
    describe('textEdit range pins the whole typed value, not just the trailing word', () => {
        it('starts right after the "sound:" prefix and ends at the cursor, for a value part-typed after a dot', () => {
            // '  - playsound sound:block.st'
            //  0123456789...
            // 's' of 'sound:' is at index 14, so 'sound:' spans [14,20) and the value
            // ('block.st') begins at index 20. The whole string is 28 characters long
            // (indices 0..27), so the cursor sits at character 28.
            const text = '  - playsound sound:block.st';
            expect(text.length).toBe(28);
            const items = provideCompletions(playsoundDocs(), EXTRA, text, text.length, 0);
            expect(items.length).toBeGreaterThan(0);
            for (const item of items) {
                expect(item.textEdit).toEqual({
                    range: { start: { line: 0, character: 20 }, end: { line: 0, character: 28 } },
                    newText: item.label
                });
            }
        });

        it('sets newText to the full value', () => {
            const text = '  - playsound sound:block.stone.st';
            const items = provideCompletions(playsoundDocs(), EXTRA, text, text.length, 0);
            const stepItem = items.find(i => i.label === 'block.stone.step');
            expect(stepItem).toBeDefined();
            expect((stepItem!.textEdit as { newText: string }).newText).toBe('block.stone.step');
        });

        it('has an equal start and end, both at the cursor, when the value is empty', () => {
            // '  - playsound sound:' is 20 characters long (indices 0..19), so the
            // cursor sits at character 20, and there is no typed value to replace.
            const text = '  - playsound sound:';
            expect(text.length).toBe(20);
            const items = provideCompletions(playsoundDocs(), EXTRA, text, text.length, 0);
            expect(items.length).toBeGreaterThan(0);
            for (const item of items) {
                expect(item.textEdit).toEqual({
                    range: { start: { line: 0, character: 20 }, end: { line: 0, character: 20 } },
                    newText: item.label
                });
            }
        });

        it('places the range on the given line, not always line 0, in a multi-line document', () => {
            // A leading '\n' puts everything else on line 1. The line's own text is
            // identical to the single-line case above, so the character offsets within
            // the line are unchanged (20 and 28) — only the line number differs.
            const text = '\n  - playsound sound:block.st';
            expect(text.length).toBe(29);
            const items = provideCompletions(playsoundDocs(), EXTRA, text, text.length, 1);
            expect(items.length).toBeGreaterThan(0);
            for (const item of items) {
                expect(item.textEdit).toEqual({
                    range: { start: { line: 1, character: 20 }, end: { line: 1, character: 28 } },
                    newText: item.label
                });
            }
        });
    });
});

// Regression coverage for a bug caught in review: `give` (and every other command
// registered under the bare '' prefix in argumentCompleters.ts) has its enum values
// and its own argument names compete for the same unprefixed typed text. The fix
// merges both sources instead of the enum short-circuiting the argument names away.
describe('enum results merge with the command\'s own argument names (bare-prefix regression)', () => {
    const GIVE_EXTRA = buildExtraData(parseFlatFds([
        'items:', '- QUARTZ', '- QUARTZ_BLOCK',
        'potion_effects:', '- SPEED', '- SLOWNESS',
        ''
    ].join('\n')));

    function giveDocs(): MetaDocs {
        return docsWith(makeCommand('give', 'give [<item>|...] (quantity:<#>) (slot:<slot>)', 'Gives an item.'));
    }

    it('lists the argument name before the enum values when a typed prefix matches both', () => {
        const text = '  - give q';
        const labels = provideCompletions(giveDocs(), GIVE_EXTRA, text, text.length, 0).map(i => i.label);
        expect(labels).toEqual(['quantity:', 'quartz', 'quartz_block']);
    });

    it('still yields enum values when the typed prefix matches only the enum', () => {
        const text = '  - give quar';
        const labels = provideCompletions(giveDocs(), GIVE_EXTRA, text, text.length, 0).map(i => i.label);
        expect(labels).toEqual(['quartz', 'quartz_block']);
    });

    it('still yields the argument name when the typed prefix matches only an argument', () => {
        const text = '  - give sl';
        const labels = provideCompletions(giveDocs(), GIVE_EXTRA, text, text.length, 0).map(i => i.label);
        expect(labels).toEqual(['slot:']);
    });

    it('yields enum values for a command unknown to the meta docs but registered in the enum table', () => {
        const docs = docsWith();
        const text = '  - cast sp';
        const labels = provideCompletions(docs, GIVE_EXTRA, text, text.length, 0).map(i => i.label);
        expect(labels).toEqual(['speed']);
    });
});

// Pins the exact replace range computed from cursorContext's argStart/argEnd
// (rather than a second getLineContext call reconstructing it by subtracting
// ctx.argValue.length). Verified against live behaviour before the refactor —
// must hold unchanged after it.
describe('replace range from cursorContext argStart/argEnd (regression pin)', () => {
    it('matches the pre-refactor range for a partially-typed sound value', () => {
        const docs = docsWith(makeCommand('playsound',
            'playsound [<location>|...] [sound:<name>] (volume:<#.#>)', 'Plays a sound.'));
        const extra = buildExtraData(parseFlatFds([
            'sounds:', '- BLOCK.AMBIENT', ''
        ].join('\n')));
        const text = '  - playsound sound:block.a';
        const items = provideCompletions(docs, extra, text, text.length, 0);
        expect(items.length).toBeGreaterThan(0);
        for (const item of items) {
            expect((item.textEdit as { range: unknown }).range).toEqual({
                start: { line: 0, character: 20 },
                end: { line: 0, character: 27 }
            });
        }
    });
});

// Regression coverage for Fix 5: `determine` needs neither workspace tracking nor
// tags (CommandTabCompletions.cs:66-67), registers a hardcoded value set under a
// null enum key, and that null key must suppress the documentation field entirely
// (CommandTabCompletions.cs:206's `key == null ? null : ...` in CompleteEnum).
describe('determine enum completer (suppressed documentation)', () => {
    it('offers both values with no documentation attached', () => {
        const docs = docsWith();
        const text = '  - determine ';
        const items = provideCompletions(docs, createEmptyExtraData(), text, text.length, 0);
        expect(items.map(i => i.label).sort()).toEqual(['cancelled', 'cancelled:false']);
        for (const item of items) {
            expect(item.documentation).toBeUndefined();
        }
    });
});

describe('key-line value completion', () => {
    const KEY_EXTRA = buildExtraData(parseFlatFds([
        'items:', '- STONE', '- STONE_BRICKS', '- STICK',
        'entities:', '- ZOMBIE', '- ZOMBIE_HORSE',
        ''
    ].join('\n')));

    it('completes material values on a container key line', () => {
        const text = '  material: stone';
        const labels = provideCompletions(createEmptyMetaDocs(), KEY_EXTRA, text, text.length, 0).map(i => i.label);
        expect(labels.sort()).toEqual(['stone', 'stone_bricks']);
    });

    it('completes entity_type values', () => {
        const text = '  entity_type: zombie_';
        const labels = provideCompletions(createEmptyMetaDocs(), KEY_EXTRA, text, text.length, 0).map(i => i.label);
        expect(labels).toEqual(['zombie_horse']);
    });

    it('offers everything when the value is still empty', () => {
        const text = '  material: ';
        const labels = provideCompletions(createEmptyMetaDocs(), KEY_EXTRA, text, text.length, 0).map(i => i.label);
        expect(labels.sort()).toEqual(['stick', 'stone', 'stone_bricks']);
    });

    it('replaces the whole typed value, not just the last word fragment', () => {
        const text = '  material: stone_b';
        const item = provideCompletions(createEmptyMetaDocs(), KEY_EXTRA, text, text.length, 0)[0];
        expect(item.textEdit).toEqual({
            range: { start: { line: 0, character: 12 }, end: { line: 0, character: 19 } },
            newText: 'stone_bricks'
        });
    });

    it('replaces the whole typed value at a non-default indent (four spaces, not the two every other case here uses)', () => {
        // '    material: stone_b': indent is 4 spaces (indices 0-3), 'material' is indices
        // 4-11, ':' at 12, a single space at 13, then 'stone_b' at indices 14-20 (7
        // characters). trimmed (post-indent) is 'material: stone_b', 17 characters below
        // trimmed.length=17, so valueEnd = indent(4) + trimmed.length(17) = 21, and
        // valueStart = indent(4) + colon(8) + 1 + leadingSpaces(1) = 14 — matching the
        // literal index of 's' in 'stone_b' above.
        const text = '    material: stone_b';
        const item = provideCompletions(createEmptyMetaDocs(), KEY_EXTRA, text, text.length, 0)[0];
        expect(item.textEdit).toEqual({
            range: { start: { line: 0, character: 14 }, end: { line: 0, character: 21 } },
            newText: 'stone_bricks'
        });
    });

    it('does not fire on a key line that already contains a tag', () => {
        const text = '  material: <[mat]>';
        expect(provideCompletions(createEmptyMetaDocs(), KEY_EXTRA, text, text.length, 0)).toEqual([]);
    });

    it('does not fire on an unregistered key', () => {
        const text = '  title: sto';
        expect(provideCompletions(createEmptyMetaDocs(), KEY_EXTRA, text, text.length, 0)).toEqual([]);
    });

    it('does not fire on a command line', () => {
        const text = '  - narrate mat';
        expect(provideCompletions(createEmptyMetaDocs(), KEY_EXTRA, text, text.length, 0)).toEqual([]);
    });
});

describe('tag completion', () => {
    it('offers base tags starting with the typed prefix, with a textEdit replacing the whole typed base', () => {
        // '  - narrate <pla': '  - narrate ' is 12 characters (indices 0-11: two spaces,
        // '-', space, 'narrate', space), '<' is index 12, 'pla' occupies indices 13-15.
        // The string is 16 characters long (indices 0-15), so the cursor sits at
        // character 16. componentCount is 0 (no dot yet), so lastComponentStart equals
        // tagStart, which is 13 (just after '<').
        const text = '  - narrate <pla';
        expect(text.length).toBe(16);
        const items = provideCompletions(tagDocs(), createEmptyExtraData(), text, text.length, 0);
        expect(items.map(i => i.label).sort()).toEqual(['player', 'playertag']);
        for (const item of items) {
            expect(item.textEdit).toEqual({
                range: { start: { line: 0, character: 13 }, end: { line: 0, character: 16 } },
                newText: item.label
            });
            // Property, not Field/Enum/Method — matches C#, which passes
            // CompletionItemKind.Property on every tag completion it builds
            // (TextDocumentService.cs:508 and :509 for bases, :535 for parts). Every
            // sibling completer in this file picks its kind deliberately, so pin this one.
            expect(item.kind).toBe(CompletionItemKind.Property);
        }
    });

    it('attaches documentation for a base tag with an exact docs.tags entry ("player", a dotless tag), but still returns one without ("playertag", which only exists as "playertag.name")', () => {
        const text = '  - narrate <pla';
        const items = provideCompletions(tagDocs(), createEmptyExtraData(), text, text.length, 0);
        const player = items.find(i => i.label === 'player');
        const playertag = items.find(i => i.label === 'playertag');
        expect(player).toBeDefined();
        expect(playertag).toBeDefined();
        expect(String((player!.documentation as { value: string }).value)).toContain('### Tag');
        expect(playertag!.documentation).toBeUndefined();
    });

    it('offers tag parts starting with the typed prefix once a component follows a dot', () => {
        // '  - narrate <player.na': '<' is at index 12, 'player.na' occupies indices
        // 13-21 (p13 l14 a15 y16 e17 r18 .19 n20 a21). The string is 22 characters long,
        // so the cursor is at character 22. The single dot inside the tag is at index 19
        // (relative index 6 within "player.na"), so the component after it, "na", starts
        // at index 20 — that is lastComponentStart.
        const text = '  - narrate <player.na';
        expect(text.length).toBe(22);
        const items = provideCompletions(tagDocs(), createEmptyExtraData(), text, text.length, 0);
        expect(items.map(i => i.label)).toEqual(['name']);
        expect(items[0].textEdit).toEqual({
            range: { start: { line: 0, character: 20 }, end: { line: 0, character: 22 } },
            newText: 'name'
        });
    });

    it('offers every part when nothing follows the dot yet', () => {
        // '  - narrate <player.': same as above minus the two "na" characters, so the
        // string is 20 characters long and the cursor (and lastComponentStart, since
        // lastComponent is empty) is at character 20.
        const text = '  - narrate <player.';
        expect(text.length).toBe(20);
        const items = provideCompletions(tagDocs(), createEmptyExtraData(), text, text.length, 0);
        expect(items.map(i => i.label)).toEqual(['name']);
        expect(items[0].textEdit).toEqual({
            range: { start: { line: 0, character: 20 }, end: { line: 0, character: 20 } },
            newText: 'name'
        });
    });

    // The tag fixture plus a real command whose argument list actually contains a 'pla'
    // match. `narrate` cannot serve here: none of its arguments starts with 'pla', so a
    // `- narrate pla` fixture could only assert emptiness — and emptiness is exactly what
    // this test must not rest on. (The previous version asserted `- narrate hello` gave
    // `[]` against a fixture with NO commands at all, so it returned `[]` at the
    // `docs.commands.get(ctx.name) === undefined` path no matter what the tag branch did.)
    // Real syntax, taken from live meta: `money [give/take/set] (quantity:<#.#>)
    // (players:<player>|...)`.
    function moneyAndTagDocs(): MetaDocs {
        const docs = tagDocs();
        makeCommand('money', 'money [give/take/set] (quantity:<#.#>) (players:<player>|...)', 'Adjusts money.').addTo(docs);
        return docs;
    }

    it('does not fire outside a tag: argument completion still runs and no tag candidate leaks in', () => {
        // No '<' anywhere on the line, so findTagAtCursor must return null and the
        // argument branch below it must run. Both halves discriminate: the tag bases
        // 'player' and 'playertag' would BOTH match the typed prefix 'pla' if the tag
        // branch wrongly fired, and because that branch returns early, firing it would
        // also suppress the command's own 'players:' argument entirely.
        const text = '  - money pla';
        const labels = provideCompletions(moneyAndTagDocs(), createEmptyExtraData(), text, text.length, 0).map(i => i.label);
        expect(labels).toContain('players:');
        expect(labels).not.toContain('player');
        expect(labels).not.toContain('playertag');
    });

    // Carried-over finding from Task 3's review: findTagAtCursor deliberately does not
    // lowercase tagSoFar/lastComponent (tagContext.ts's file header explains why — the
    // position-scanning passes don't need case normalization). tagBases/tagParts hold
    // only lowercase entries (MetaTag.addTo). completeTag is exercised directly here,
    // with a hand-built TagCursorContext carrying a capitalised lastComponent, rather
    // than through provideCompletions/the full text pipeline — that pipeline already
    // lowercases the whole line in getLineContext before parseCommandLine ever runs, so
    // driving this through provideCompletions would never actually exercise a capitalised
    // lastComponent and would silently confound the thing this test is meant to prove.
    // completeTag's own declared contract takes a TagCursorContext directly, so a caller
    // that (now or later) does not pre-lowercase must still get correct matches.
    it('lowercases the typed component before matching, so a capitalised prefix still matches', () => {
        const docs = tagDocs();
        const ctx: TagCursorContext = {
            tagSoFar: 'Pla',
            tagStart: 5,
            componentCount: 0,
            lastComponent: 'Pla',
            lastComponentStart: 5
        };
        const labels = completeTag(docs, ctx, 0).map(i => i.label).sort();
        expect(labels).toEqual(['player', 'playertag']);
    });

    // The fixtures above deliberately never run linkTypeGraph, so every MetaTag in them
    // has a null baseType/returnType and every trace comes back empty — which is exactly
    // the fallback path, and is why the assertions above are unchanged by tracing. The
    // narrowing suite below builds its own LINKED fixture; see its header.
    it('falls back to the full flat part list against an unlinked fixture, so tracing changes nothing here', () => {
        const docs = tagDocs();
        const text = '  - narrate <player.';
        const traced = provideCompletions(docs, createEmptyExtraData(), text, text.length, 0);
        const untraced = provideCompletions(docs, createEmptyExtraData(), text, text.length, 0, false);
        expect(traced.map(i => i.label)).toEqual([...docs.tagParts]);
        expect(traced.map(i => i.label)).toEqual(untraced.map(i => i.label));
    });
});

/**
 * Task 4 (Phase 2B-5): narrowing tag-part completion to the traced return type.
 *
 * These fixtures MUST go through `linkTypeGraph` — `traceTag` reads baseType /
 * returnType / subTags / extendedBy, all of which only that pass populates. The
 * older `tagDocs()` fixtures above skip linking on purpose; they exercise the
 * fallback branch and must keep doing so.
 *
 * The type graph is:
 *     ObjectTag <- ElementTag <- {PlayerTag, MapTag}
 *     ObjectTag <- {ListTag, QueueTag, ScriptTag}
 *     FlaggableObject (rootless), implemented by PlayerTag
 */
function narrowType(name: string, base: string, extra: string[] = []): MetaBlock {
    return { objectType: 'objecttype', url: 'src#L1', data: [`@name ${name}`, `@prefix ${name.toLowerCase()}`, `@base ${base}`, '@format x', '@description x', ...extra, '@end_meta'] };
}

function narrowTag(attribute: string, returns: string, description: string): MetaBlock {
    return { objectType: 'tag', url: 'src#L1', data: [`@attribute ${attribute}`, `@returns ${returns}`, `@description ${description}`, '@end_meta'] };
}

function narrowingDocs(): MetaDocs {
    const docs = buildMetaDocs([
        narrowType('ObjectTag', 'none'),
        narrowType('ElementTag', 'ObjectTag'),
        narrowType('PlayerTag', 'ElementTag', ['@implements FlaggableObject']),
        narrowType('MapTag', 'ElementTag'),
        narrowType('ListTag', 'ObjectTag'),
        narrowType('FlaggableObject', 'none'),
        narrowType('QueueTag', 'ObjectTag'),
        narrowType('ScriptTag', 'ObjectTag'),
        // Dotless base tags: beforeDot is 'Base', so they own no parts and are never
        // narrowed candidates themselves. '<script>' is the 2B-4 namespace collision.
        narrowTag('<player>', 'PlayerTag', 'Returns the linked player.'),
        narrowTag('<queue>', 'QueueTag', 'Returns the current queue.'),
        narrowTag('<script>', 'ScriptTag', 'Returns the current script container.'),
        // Returns ObjectTag, so tracing it declines to narrow and yields EVERY object
        // type - the all-types case the deliberate deviation below falls back on.
        narrowTag('<definition[<name>]>', 'ObjectTag', 'A definition value.'),
        // A two-part complex base tag, i.e. docs.tags holds the key 'mybase.sub'. This
        // is the fixture stand-in for real meta's '<server.flag[...]>'.
        narrowTag('<mybase.sub>', 'PlayerTag', 'A complex base tag.'),
        // Type-owned tags.
        narrowTag('<PlayerTag.name>', 'ElementTag', 'The player name.'),
        narrowTag('<PlayerTag.groups>', 'ListTag', 'The player groups.'),
        narrowTag('<PlayerTag.foo.bar>', 'ListTag', 'A two-part subtag.'),
        narrowTag('<ElementTag.to_uppercase>', 'ElementTag', 'Uppercased.'),
        narrowTag('<ListTag.size>', 'ElementTag', 'The list size.'),
        narrowTag('<MapTag.keys>', 'ListTag', 'The map keys.'),
        narrowTag('<FlaggableObject.flag[<name>]>', 'ObjectTag', 'A flag value.'),
        narrowTag('<ObjectTag.as[<type>]>', 'ObjectTag', 'A type cast.'),
        narrowTag('<QueueTag.script>', 'ScriptTag', 'The script the queue is running.')
    ]);
    linkTypeGraph(docs);
    return docs;
}

// Hand-derived from the fixture above, not read off the implementation.
// tagParts collects every dot-separated bit after each tag's base:
//   name, groups, foo, bar, to_uppercase, size, keys, flag, as, sub, script.
const ALL_PARTS = ['name', 'groups', 'foo', 'bar', 'to_uppercase', 'size', 'keys', 'flag', 'as', 'sub', 'script'];

function labelsAt(docs: MetaDocs, text: string, trace?: boolean): string[] {
    return provideCompletions(docs, createEmptyExtraData(), text, text.length, 0, trace).map(i => i.label).sort();
}

describe('tag completion narrowed by the traced return type', () => {
    it('builds the linked fixture the narrowing expectations assume', () => {
        const docs = narrowingDocs();
        expect([...docs.tagParts].sort()).toEqual([...ALL_PARTS].sort());
        expect(docs.objectTypes.size).toBe(8);
        expect(docs.tags.get('playertag.name')!.baseType).toBe(docs.objectTypes.get('playertag'));
        expect(docs.tags.get('player')!.returnType).toBe(docs.objectTypes.get('playertag'));
    });

    it('offers only the parts reachable from PlayerTag, not a part that exists solely on an unrelated type', () => {
        // traceTag('player') -> GetFullComplexSetFrom({PlayerTag})
        //   = {PlayerTag, ElementTag (base), ObjectTag (base + the unconditional add),
        //      FlaggableObject (implements)}.
        // Candidates are the tags whose baseType is in that set:
        //   PlayerTag.name -> 'name', PlayerTag.groups -> 'groups',
        //   PlayerTag.foo.bar -> 'foo.bar', ElementTag.to_uppercase -> 'to_uppercase',
        //   FlaggableObject.flag -> 'flag', ObjectTag.as -> 'as'.
        // ListTag.size and MapTag.keys are NOT reachable, and 'sub'/'script' belong to
        // bases/types that are not in the set either.
        const docs = narrowingDocs();
        expect(labelsAt(docs, '  - narrate <player.'))
            .toEqual(['as', 'flag', 'foo.bar', 'groups', 'name', 'to_uppercase']);
        expect(labelsAt(docs, '  - narrate <player.')).not.toContain('size');
        expect(labelsAt(docs, '  - narrate <player.')).not.toContain('keys');
    });

    it('offers the full flat part list when tracing is switched off', () => {
        const docs = narrowingDocs();
        expect(labelsAt(docs, '  - narrate <player.', false)).toEqual([...ALL_PARTS].sort());
        expect(labelsAt(docs, '  - narrate <player.', false)).toEqual([...docs.tagParts].sort());
    });

    it('still filters the narrowed set by the typed prefix', () => {
        const docs = narrowingDocs();
        expect(labelsAt(docs, '  - narrate <player.na')).toEqual(['name']);
        expect(labelsAt(docs, '  - narrate <player.f')).toEqual(['flag', 'foo.bar']);
    });

    it('leaves the textEdit range at lastComponentStart -> cursor, exactly as the untraced branch does', () => {
        // '  - narrate <player.' is 20 characters (indices 0..19); '<' is index 12, the
        // dot is index 19, so the (empty) component after it starts at 20 = the cursor.
        const docs = narrowingDocs();
        const text = '  - narrate <player.';
        expect(text.length).toBe(20);
        const items = provideCompletions(docs, createEmptyExtraData(), text, text.length, 0);
        expect(items.length).toBeGreaterThan(0);
        for (const item of items) {
            expect(item.textEdit).toEqual({
                range: { start: { line: 0, character: 20 }, end: { line: 0, character: 20 } },
                newText: item.label
            });
            expect(item.kind).toBe(CompletionItemKind.Property);
        }
        // '  - narrate <player.na' is 22 characters; 'na' starts at 20.
        const typed = '  - narrate <player.na';
        expect(typed.length).toBe(22);
        for (const item of provideCompletions(docs, createEmptyExtraData(), typed, typed.length, 0)) {
            expect(item.textEdit).toEqual({
                range: { start: { line: 0, character: 20 }, end: { line: 0, character: 22 } },
                newText: item.label
            });
        }
    });

    it('carries each narrowed item\'s OWN documentation, fixing the 2B-4 <queue.>/<script> collision', () => {
        // traceTag('queue') -> {QueueTag, ObjectTag}, so the candidates are
        // QueueTag.script -> 'script' and ObjectTag.as -> 'as'.
        const docs = narrowingDocs();
        const items = provideCompletions(docs, createEmptyExtraData(), '  - narrate <queue.', '  - narrate <queue.'.length, 0);
        expect(items.map(i => i.label).sort()).toEqual(['as', 'script']);
        const script = items.find(i => i.label === 'script')!;
        const scriptDoc = String((script.documentation as { value: string }).value);
        expect(scriptDoc).toContain('QueueTag.script');
        expect(scriptDoc).toContain('The script the queue is running.');
        // The dotless base tag '<script>' shares the part's name and is what the 2B-4
        // exact-lookup would have attached here; it must not be what we show.
        expect(scriptDoc).not.toContain('Returns the current script container.');
        expect(String((items.find(i => i.label === 'as')!.documentation as { value: string }).value))
            .toContain('ObjectTag.as');
    });

    // ---- The empty-trace fallback. An empty possibleSubTypes means "fall back to the
    // full flat part list", never "offer nothing". Both cases below are real, not
    // contrived: the first mirrors live meta's '<server.flag[x].', the second any part
    // swallowed by a multi-part subtag match.
    it('falls back to the FULL flat part list when a complex base tag consumed every part', () => {
        // 'mybase.sub' is a docs.tags key, so TagTracer.cs:69-76 consumes parts 0 and 1
        // and resumes at index 2, which is past the end; only part 0 gets a sub-type set
        // (:110), and the consumer reads the LAST part's — which stays empty.
        const docs = narrowingDocs();
        expect(labelsAt(docs, '  - narrate <mybase.sub.')).toEqual([...ALL_PARTS].sort());
        expect(labelsAt(docs, '  - narrate <mybase.sub.'))
            .toEqual(labelsAt(docs, '  - narrate <mybase.sub.', false));
    });

    it('falls back to the FULL flat part list when a two-part subtag swallowed the final part', () => {
        // 'player.foo.bar' matches PlayerTag.foo.bar (length 2) at index 1, so the loop
        // records sub-types at index 1 and jumps to index 3. Part 2 - the last - has none.
        const docs = narrowingDocs();
        expect(labelsAt(docs, '  - narrate <player.foo.bar.')).toEqual([...ALL_PARTS].sort());
        expect(labelsAt(docs, '  - narrate <player.foo.bar.'))
            .toEqual(labelsAt(docs, '  - narrate <player.foo.bar.', false));
    });

    it('falls back to the FULL flat part list when a base tag was given a parameter it does not allow', () => {
        // TagTracer.cs:90-94 returns before :110 runs, so not even part 0 gets a set.
        const docs = narrowingDocs();
        expect(labelsAt(docs, '  - narrate <player[bob].')).toEqual([...ALL_PARTS].sort());
    });

    it('never offers fewer items than the untraced list would, for any input the tracer cannot narrow', () => {
        // The guarantee in one assertion: a trace that cannot narrow - because it is empty,
        // or because it yielded every object type - must not be read as "no candidates".
        // Regression pin for the whole fallback branch.
        const docs = narrowingDocs();
        for (const text of ['  - narrate <mybase.sub.', '  - narrate <player.foo.bar.', '  - narrate <player[bob].',
                            '  - narrate <player.flag[x].', '  - narrate <[mydef].']) {
            expect(labelsAt(docs, text)).toEqual(labelsAt(docs, text, false));
            expect(labelsAt(docs, text).length).toBe(ALL_PARTS.length);
        }
    });

    it('leaves the genuinely-narrowing cases untouched by the all-types fallback', () => {
        // Regression pin: the deviation must only catch the informationless all-types set.
        const docs = narrowingDocs();
        expect(labelsAt(docs, '  - narrate <player.'))
            .toEqual(['as', 'flag', 'foo.bar', 'groups', 'name', 'to_uppercase']);
        expect(labelsAt(docs, '  - narrate <queue.')).toEqual(['as', 'script']);
        expect(labelsAt(docs, '  - narrate <player.na')).toEqual(['name']);
        expect(labelsAt(docs, '  - narrate <nosuchbase.')).toEqual(['as']);
    });

    // ---- DELIBERATE DEVIATION from TextDocumentService.cs:531-533: a traced set holding
    // EVERY object type carries no information, so it is treated as "the tracer does not
    // know" and falls back to the flat list rather than being narrowed to itself. See the
    // matching comment in completionProvider.ts for the full rationale and cost figures.
    // This is what makes flags and definitions genuinely unnarrowed, which is the property
    // asked for at the outset - not merely "not narrowed to a WRONG subset".
    it('falls back to the FULL flat part list after a flag, whose ObjectTag return means every type is possible', () => {
        // traceTag('player.flag[x]') hits TagTracer.cs:126-129 (returns ObjectTag), so
        // possibleSubTypes is every object type - informationless, hence the fallback.
        const docs = narrowingDocs();
        expect(labelsAt(docs, '  - narrate <player.flag[x].')).toEqual([...ALL_PARTS].sort());
        expect(labelsAt(docs, '  - narrate <player.flag[x].'))
            .toEqual(labelsAt(docs, '  - narrate <player.flag[x].', false));
    });

    it('falls back to the FULL flat part list for a definition, for the same reason', () => {
        // '<[mydef].' - an empty root means 'definition' (TagTracer.cs:40-43), which
        // returns ObjectTag. Definitions are the most common construct in Denizen script,
        // so this is the case the deviation exists for.
        const docs = narrowingDocs();
        expect(labelsAt(docs, '  - narrate <[mydef].')).toEqual([...ALL_PARTS].sort());
        expect(labelsAt(docs, '  - narrate <[mydef].'))
            .toEqual(labelsAt(docs, '  - narrate <[mydef].', false));
        // Nothing is filtered away by type: 'size' (ListTag) and 'keys' (MapTag) are both
        // unreachable from PlayerTag, yet both are offered here - the escape hatch working.
        expect(labelsAt(docs, '  - narrate <[mydef].')).toContain('size');
        expect(labelsAt(docs, '  - narrate <[mydef].')).toContain('keys');
        expect(labelsAt(docs, '  - narrate <player.')).not.toContain('keys');
    });

    it('gates on the traced set matching docs.objectTypes.size, not on a hardcoded count', () => {
        // Guards against the gate being written against a literal. The fixture has 8
        // object types where live meta has 72; both must take the same branch.
        const docs = narrowingDocs();
        expect(docs.objectTypes.size).toBe(8);
        expect(labelsAt(docs, '  - narrate <[mydef].').length).toBe(ALL_PARTS.length);
    });

    it('narrows an unknown base to ObjectTag\'s own tags rather than the full flat list', () => {
        // GetFullComplexSetFrom({}) is {ObjectTag}, not {} (TagTracer.cs:248 adds
        // ObjectTag unconditionally), so the trace of an unknown root is non-empty and
        // the narrowed branch runs. Pinned by tagTracer.test.ts's
        // "yields exactly {ObjectTag} for a single-part unknown root".
        const docs = narrowingDocs();
        expect(labelsAt(docs, '  - narrate <nosuchbase.')).toEqual(['as']);
        expect(labelsAt(docs, '  - narrate <nosuchbase.', false)).toEqual([...ALL_PARTS].sort());
    });

    it('leaves base completion (componentCount 0) untouched by tracing', () => {
        const docs = narrowingDocs();
        expect(labelsAt(docs, '  - narrate <pla')).toEqual(labelsAt(docs, '  - narrate <pla', false));
        expect(labelsAt(docs, '  - narrate <pla')).toEqual(['player', 'playertag']);
    });
});
