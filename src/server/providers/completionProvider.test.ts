import { describe, it, expect } from 'vitest';
import { CompletionItemKind } from 'vscode-languageserver';
import { provideCompletions, completeCommandNames, completeCommandArguments, completeTag } from './completionProvider';
import { MetaCommand, MetaTag, MetaMechanism, MetaEvent, MetaDocs, createEmptyMetaDocs, META_TYPE_COMMAND, META_TYPE_TAG } from '../metaDocs/metaTypes';
import { buildExtraData, parseFlatFds, createEmptyExtraData } from '../metaDocs/extraData';
import { TagCursorContext, findTagAtCursor } from './tagContext';
import { buildMetaDocs } from '../metaDocs/metaDocsManager';
import { linkTypeGraph, linkEventMatchers } from '../metaDocs/metaLinker';
import type { MetaBlock } from '../metaDocs/metaLoader';
import { parseTag } from './tagHelper';
import { traceTag } from './tagTracer';

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
        narrowTag('<QueueTag.script>', 'ScriptTag', 'The script the queue is running.'),
        // THE ADDON-NAMESPACE SHAPE, which had no fixture before and which the
        // {ObjectTag}-sentinel fallback must not break. 'myaddon' is not an object type
        // and there is no dotless '<myaddon>' tag, so tracing it reaches nothing and
        // yields the {ObjectTag} sentinel exactly as '<nosuchbase.>' does - the ONLY
        // thing that tells the two apart is that a documented tag's `beforeDot` is
        // literally 'myaddon'. Live meta has 84 bases of this shape (server, util,
        // paper, bungee, luckperms, towny, mythicmobs, essentials, factions,
        // griefprevention, quests, viaversion, playerpoints, crackshot, skyblock, tern,
        // schematic, yaml ...); breaking them would silently delete completion for every
        // third-party plugin namespace.
        narrowTag('<myaddon.status>', 'ElementTag', 'An addon namespace tag.')
    ]);
    linkTypeGraph(docs);
    return docs;
}

// Hand-derived from the fixture above, not read off the implementation.
// tagParts collects every dot-separated bit after each tag's base:
//   name, groups, foo, bar, to_uppercase, size, keys, flag, as, sub, script, status.
const ALL_PARTS = ['name', 'groups', 'foo', 'bar', 'to_uppercase', 'size', 'keys', 'flag', 'as', 'sub', 'script', 'status'];

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
                            '  - narrate <player.flag[x].', '  - narrate <[mydef].', '  - narrate <player.name.',
                            '  - narrate <context.', '  - narrate <entry[save].', '  - narrate <nosuchbase.']) {
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
        // The addon-namespace shape: {ObjectTag} sentinel, but a documented tag's
        // beforeDot is 'myaddon', so it keeps its narrowed list.
        expect(labelsAt(docs, '  - narrate <myaddon.')).toEqual(['as', 'status']);
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

    it('gates on a fraction of docs.objectTypes.size, not on a hardcoded count', () => {
        // Guards against the gate being written against a literal. The fixture has 8
        // object types where live meta has 72; both must take the same branch.
        const docs = narrowingDocs();
        expect(docs.objectTypes.size).toBe(8);
        expect(labelsAt(docs, '  - narrate <[mydef].').length).toBe(ALL_PARTS.length);
    });

    it('falls back to the FULL flat part list when the traced set covers more than half the object types', () => {
        // '<player.name.': PlayerTag.name returns ElementTag, and ParsePossibleTypes adds
        // ElementTag.ExtendedBy (PlayerTag, MapTag); GetFullComplexSetFrom then pulls in
        // ObjectTag and FlaggableObject. That is 5 of the fixture's 8 types - more than
        // half, so informationless by the same argument as the all-types case. It is the
        // fixture's stand-in for live meta's '<player.name.' at 67 of 72.
        const docs = narrowingDocs();
        expect(labelsAt(docs, '  - narrate <player.name.')).toEqual([...ALL_PARTS].sort());
        expect(labelsAt(docs, '  - narrate <player.name.'))
            .toEqual(labelsAt(docs, '  - narrate <player.name.', false));
    });

    it('pins where each fixture input sits relative to the half-of-all-types cut', () => {
        // The cut is "more than half", so a set of exactly half must still narrow. These
        // sizes are what make the label expectations above correct; if a future change
        // widens the threshold, this fails loudly instead of silently disabling narrowing.
        const docs = narrowingDocs();
        const half = docs.objectTypes.size / 2;
        const sized = (t: string) => traceTag(docs, parseTag(t, () => { /* ignore */ })).possibleSubTypes.size;
        expect(sized('player')).toBe(4);          // exactly half -> NARROWS (boundary)
        expect(sized('queue')).toBe(2);           // well under   -> narrows
        expect(sized('nosuchbase')).toBe(1);      // just ObjectTag -> under the cut, so the
                                                  // half gate lets it through; the SENTINEL
                                                  // rule below is what makes it fall back
        expect(sized('myaddon')).toBe(1);         // the same size 1, kept narrow by the name match
        expect(sized('player.name')).toBe(5);     // over half    -> falls back
        expect(sized('player.flag[x]')).toBe(8);  // all types    -> falls back
        expect(half).toBe(4);
        // The boundary case must survive: exactly half still narrows.
        expect(labelsAt(docs, '  - narrate <player.'))
            .toEqual(['as', 'flag', 'foo.bar', 'groups', 'name', 'to_uppercase']);
    });

    // ---- THIRD CASE of the same deliberate deviation: the {ObjectTag} sentinel.
    // GetFullComplexSetFrom({}) is {ObjectTag}, not {} (TagTracer.cs:248 adds ObjectTag
    // unconditionally), so "the trace reached nothing" arrives as a set of size 1 that
    // neither the empty check nor the over-half gate can see. See the matching comment
    // in completionProvider.ts. The conjunction with "no beforeDot match" is what keeps
    // the addon-namespace bases narrowed; the two tests after these pin that half.
    it('falls back to the FULL flat part list for <context.>, the tracer\'s reached-nothing sentinel', () => {
        // TagTracer.cs:44-47 routes 'context' into TraceTagParts(allTypes, 2), which
        // returns immediately at :147 because a one-part tag has nothing at index 2; :110
        // then computes GetFullComplexSetFrom({}) = {ObjectTag}. Before this rule that
        // narrowed <context.> to ObjectTag's own utility tags - none of which is ever a
        // context name - and made <context.na> match nothing at all.
        const docs = narrowingDocs();
        expect(labelsAt(docs, '  - narrate <context.')).toEqual([...ALL_PARTS].sort());
        expect(labelsAt(docs, '  - narrate <context.'))
            .toEqual(labelsAt(docs, '  - narrate <context.', false));
        // The regression that started this: a typed prefix must find real parts again.
        expect(labelsAt(docs, '  - narrate <context.na')).toEqual(['name']);
    });

    it('falls back to the FULL flat part list for <entry[x].>, which reaches the same sentinel', () => {
        // 'entry' takes the same TagTracer.cs:44-47 branch as 'context'.
        const docs = narrowingDocs();
        expect(labelsAt(docs, '  - narrate <entry[save].')).toEqual([...ALL_PARTS].sort());
        expect(labelsAt(docs, '  - narrate <entry[save].'))
            .toEqual(labelsAt(docs, '  - narrate <entry[save].', false));
    });

    it('falls back to the FULL flat part list for an unknown base, which is the same sentinel', () => {
        // '<nosuchbase.>' resolves to no tag and no object type, so TagTracer.cs:106-109
        // falls through to :110 with an empty PossibleTags[0] - byte-identical to what
        // <context.> produces. Nothing distinguishes them, so nothing should: an
        // unresolved base means "the tracer knows nothing", not "offer 15 utility tags".
        const docs = narrowingDocs();
        expect(labelsAt(docs, '  - narrate <nosuchbase.')).toEqual([...ALL_PARTS].sort());
        expect(labelsAt(docs, '  - narrate <nosuchbase.'))
            .toEqual(labelsAt(docs, '  - narrate <nosuchbase.', false));
    });

    // ---- The OTHER half of the conjunction, which no fixture covered before: an addon
    // namespace hits the exact same {ObjectTag} sentinel, and is saved ONLY by the
    // `beforeDot === lastPartText` clause. On live meta this shape carries 84 tag bases
    // (server 132 name-matches, util 61, yaml 10, schematic 9, luckperms/bungee/skyblock
    // 3, towny/mythicmobs/essentials/viaversion 2, paper/factions/griefprevention/quests/
    // playerpoints/crackshot/tern 1 ...). If the sentinel rule ever drops the conjunction,
    // every third-party plugin namespace loses its completion at once - this test is the
    // only thing that says so.
    it('keeps narrowing an addon-namespace base, whose trace is the SAME {ObjectTag} sentinel', () => {
        const docs = narrowingDocs();
        // Same traced set as <nosuchbase.> above, to the identity of the set's contents.
        const sized = (t: string) => traceTag(docs, parseTag(t, () => { /* ignore */ })).possibleSubTypes;
        expect([...sized('myaddon')].map(t => t.typeName)).toEqual(['ObjectTag']);
        expect([...sized('nosuchbase')].map(t => t.typeName)).toEqual(['ObjectTag']);
        // Yet it must NOT fall back: 'myaddon' is a documented tag's beforeDot.
        expect(labelsAt(docs, '  - narrate <myaddon.')).toEqual(['as', 'status']);
        expect(labelsAt(docs, '  - narrate <myaddon.').length).toBeLessThan(ALL_PARTS.length);
        expect(labelsAt(docs, '  - narrate <myaddon.st')).toEqual(['status']);
    });

    it('decides the addon-namespace case on the corpus, not on what the user has typed so far', () => {
        // The name-match count is taken before the typed-prefix filter, so narrowing
        // cannot flip to the flat list mid-word: '<myaddon.zzz' has zero prefix-surviving
        // candidates but 'myaddon' is still a real namespace, so it stays narrowed (and
        // therefore empty) rather than silently reverting to all 12 flat parts. A rule
        // that counted matches after the prefix filter would return the whole flat list
        // filtered by 'zzz' here - which happens to be empty too, so only a prefix that
        // DOES hit flat parts can tell them apart: 'na' is 'name' in the flat set and
        // nothing in myaddon's.
        const docs = narrowingDocs();
        expect(labelsAt(docs, '  - narrate <myaddon.na')).toEqual([]);
        expect(labelsAt(docs, '  - narrate <myaddon.na', false)).toEqual(['name']);
    });

    it('leaves base completion (componentCount 0) untouched by tracing', () => {
        const docs = narrowingDocs();
        expect(labelsAt(docs, '  - narrate <pla')).toEqual(labelsAt(docs, '  - narrate <pla', false));
        expect(labelsAt(docs, '  - narrate <pla')).toEqual(['player', 'playertag']);
    });
});

/**
 * Phase 2B-6 Task 3: completion for the text INSIDE a tag's square brackets.
 *
 * Ports the two C# branches that serve a still-open '[':
 *   - the base form, `<material[...`  (TextDocumentService.cs:504-521)
 *   - the part form, `<player.gamemode_at[...` (TextDocumentService.cs:538-554)
 *
 * The fixture must go through `linkTypeGraph`: the branch reads `MetaTag.parsedFormat`
 * and `MetaTag.allowsParam`, and the part form additionally runs the tracer, all of
 * which only that pass populates. It is a FIXTURE, not a transcript of live meta —
 * each tag's documented parameter is chosen to reach one specific branch of
 * `completeTagParam`, which is what these tests are about.
 */
const PARAM_EXTRA = buildExtraData(parseFlatFds([
    'blocks:', '- STONE', '- STONE_BRICKS',
    'items:', '- STICK',
    'statistics:', '- JUMP',
    ''
].join('\n')));

function paramMech(object: string, name: string): MetaMechanism {
    const m = new MetaMechanism();
    m.mechObject = object;
    m.mechName = name;
    m.fullName = `${object}.${name}`;
    return m;
}

function paramDocs(): MetaDocs {
    const docs = buildMetaDocs([
        narrowType('ObjectTag', 'none'),
        narrowType('ElementTag', 'ObjectTag'),
        narrowType('PlayerTag', 'ElementTag', ['@implements FlaggableObject']),
        narrowType('FlaggableObject', 'none'),
        narrowType('ItemTag', 'ObjectTag'),
        narrowType('MaterialTag', 'ObjectTag'),
        // Dotless bases, so the tracer can resolve '<player.' and '<item.'.
        narrowTag('<player>', 'PlayerTag', 'The linked player.'),
        narrowTag('<item>', 'ItemTag', 'The linked item.'),
        // BASE form: a dotless base tag that itself takes a parameter, so its parameter
        // lives on parsedFormat.parts[0] (TextDocumentService.cs:519).
        narrowTag('<material[<material>]>', 'MaterialTag', 'A material by name.'),
        // PART form, registered ByTag spec -> real candidates.
        narrowTag('<PlayerTag.gamemode_at[<material>]>', 'ElementTag', 'A gamemode.'),
        // PART form, NO documented parameter at all -> must yield nothing, not throw.
        narrowTag('<PlayerTag.name>', 'ElementTag', 'The player name.'),
        // PART form, documented parameter that no completer serves -> nothing. This is
        // also the flag case; see the client-owns-flags test below.
        narrowTag('<FlaggableObject.flag[<name>]>', 'ObjectTag', 'A flag value.'),
        // PART form, the ';'-separated mechanism-set spec — the shape whose typed text
        // is only PARTLY consumed by a candidate.
        narrowTag('<ItemTag.with[<mechanism>=<value>;...]>', 'ItemTag', 'A modified item.'),
        // A two-part BASE tag (docs.tags key 'util.random_decimal_in_range'), whose
        // documented parameter '<#.#>' matches no completer branch.
        narrowTag('<util.random_decimal_in_range[<#.#>]>', 'ElementTag', 'A random decimal.'),
        // The two CompleteForTagPiece shapes (CommandTabCompletions.cs:131-135), which
        // are the only candidates that get the tag documentation envelope. Modelled on
        // the real tags the live verify script pins: '<ViveCraftPlayerTag.position[
        // head/left/right]>' for the '/'-option branch (:187) and '<PlayerTag.
        // worldguard_flag[flag=<flag>(;location=<at>)]>' for the ';'-pair-key branch
        // (:168).
        narrowTag('<PlayerTag.position[head/left/right]>', 'ElementTag', 'A tracked position.'),
        narrowTag('<PlayerTag.region_flag[flag=<flag>(;location=<at>)]>', 'ElementTag', 'A region flag.')
    ]);
    linkTypeGraph(docs);
    // Mechanisms are keyed by cleanName ('itemtag.max_health'), i.e. by OBJECT plus name —
    // there is no by-name index, which is why the caller cannot look a candidate back up.
    for (const m of [paramMech('ItemTag', 'max_health'), paramMech('ItemTag', 'material'), paramMech('ItemTag', 'quantity')]) {
        docs.mechanisms.set(m.fullName.toLowerCase(), m);
    }
    return docs;
}

function paramItems(docs: MetaDocs, text: string) {
    return provideCompletions(docs, PARAM_EXTRA, text, text.length, 0);
}

describe('tag parameter completion', () => {
    it('builds the linked fixture the expectations below assume', () => {
        const docs = paramDocs();
        expect([...PARAM_EXTRA.materials]).toEqual(['stone', 'stone_bricks', 'stick']);
        // parsedFormat/allowsParam are what the branch reads; without linkTypeGraph both
        // are null/false and every expectation below would pass vacuously.
        const gamemodeAt = docs.tags.get('playertag.gamemode_at')!;
        expect(gamemodeAt.allowsParam).toBe(true);
        expect(gamemodeAt.parsedFormat!.parts.map(p => p.parameter)).toEqual([null, '<material>']);
        const material = docs.tags.get('material')!;
        expect(material.allowsParam).toBe(true);
        expect(material.parsedFormat!.parts.map(p => p.parameter)).toEqual(['<material>']);
        expect(docs.tags.get('playertag.name')!.allowsParam).toBe(false);
        expect(docs.tags.get('itemtag.with')!.parsedFormat!.parts[1].parameter).toBe('<mechanism>=<value>;...');
        expect(docs.tags.get('util.random_decimal_in_range')!.parsedFormat!.parts[1].parameter).toBe('<#.#>');
        // The two CompleteForTagPiece shapes. Their documented parameters must survive
        // parsing intact, or the envelope tests below would assert against nothing.
        expect(docs.tags.get('playertag.position')!.parsedFormat!.parts[1].parameter).toBe('head/left/right');
        expect(docs.tags.get('playertag.region_flag')!.parsedFormat!.parts[1].parameter)
            .toBe('flag=<flag>(;location=<at>)');
        // The envelope's heading and link are read off these two fields, so pin them.
        expect(docs.tags.get('playertag.position')!.name).toBe('<PlayerTag.position[head/left/right]>');
        expect(docs.tags.get('playertag.position')!.type!.webPath).toBe('Tags');
    });

    // WHY THE PARAMETER BRANCH MUST RUN BEFORE findTagAtCursor. A cursor inside '[...]'
    // is also inside a tag, so the existing locator claims it — and everything it can
    // offer is filtered by `lastComponent`, which necessarily still carries the '['
    // (a still-open top-level bracket can only have opened after the last counted
    // top-level dot). No entry in tagBases/tagParts contains '[' (cleanTag strips
    // bracketed parameters), so the pre-existing branch can only ever return [] here.
    it('is unreachable behind findTagAtCursor, which offers nothing for a cursor inside brackets', () => {
        const docs = paramDocs();
        const tagCtx = findTagAtCursor('<player.gamemode_at[', 12);
        expect(tagCtx).not.toBeNull();
        expect(tagCtx!.lastComponent).toBe('gamemode_at[');
        expect(completeTag(docs, tagCtx!, 0)).toEqual([]);
        expect(completeTag(docs, tagCtx!, 0, false)).toEqual([]);
    });

    it('offers the documented parameter\'s values for a tag part (the part form, :538-554)', () => {
        // '  - narrate <player.gamemode_at[': '  - narrate ' is 12 characters (indices
        // 0-11), '<' is index 12, so 'player.gamemode_at[' occupies indices 13-31 —
        // p13 l14 a15 y16 e17 r18 .19 g20 a21 m22 e23 m24 o25 d26 e27 _28 a29 t30 [31.
        // The string is 32 characters long, so the cursor sits at character 32, which is
        // also paramStart (just past the '[') with nothing typed yet.
        const docs = paramDocs();
        const text = '  - narrate <player.gamemode_at[';
        expect(text.length).toBe(32);
        const items = paramItems(docs, text);
        expect(items.map(i => i.label)).toEqual(['stone', 'stone_bricks', 'stick']);
        for (const item of items) {
            // CompleteEnum builds Enum items (CommandTabCompletions.cs:206), not Property.
            expect(item.kind).toBe(CompletionItemKind.Enum);
            expect(item.textEdit).toEqual({
                range: { start: { line: 0, character: 32 }, end: { line: 0, character: 32 } },
                newText: item.label
            });
        }
        expect(String((items[0].documentation as { value: string }).value)).toBe('**Material**: stone');
        // CompleteEnum's markup is the WHOLE documentation at that site (:206) — no tag
        // envelope, because CompleteEnum does not go through CompleteForTagPiece.
        expect(String((items[0].documentation as { value: string }).value)).not.toContain('### Tag');
        expect(String((items[0].documentation as { value: string }).value)).not.toContain('Input option');
    });

    it('replaces exactly the text typed inside the brackets, paramStart to cursor', () => {
        // '  - narrate <player.gamemode_at[sto' extends the 32-character string above with
        // 'sto' at indices 32-34, so it is 35 characters long and the cursor is at 35.
        // paramStart is unchanged at 32, so the replaced range is exactly 'sto'.
        const docs = paramDocs();
        const text = '  - narrate <player.gamemode_at[sto';
        expect(text.length).toBe(35);
        expect(text.substring(32, 35)).toBe('sto');
        const items = paramItems(docs, text);
        expect(items.map(i => i.label)).toEqual(['stone', 'stone_bricks']);
        for (const item of items) {
            expect(item.textEdit).toEqual({
                range: { start: { line: 0, character: 32 }, end: { line: 0, character: 35 } },
                newText: item.label
            });
        }
    });

    it('puts the range on the given line in a multi-line document', () => {
        // A leading '\n' moves the identical line to line 1; the character offsets within
        // the line are unchanged.
        const docs = paramDocs();
        const text = '\n  - narrate <player.gamemode_at[sto';
        const items = provideCompletions(docs, PARAM_EXTRA, text, text.length, 1);
        expect(items.length).toBeGreaterThan(0);
        for (const item of items) {
            expect(item.textEdit).toEqual({
                range: { start: { line: 1, character: 32 }, end: { line: 1, character: 35 } },
                newText: item.label
            });
        }
    });

    it('serves a base tag\'s own parameter from parsedFormat.parts[0] (the base form, :504-521)', () => {
        // '  - narrate <material[': '<' is index 12, 'material' occupies indices 13-20 and
        // '[' is index 21, so the string is 22 characters long and paramStart is 22.
        // componentCount is 0 here — this is the branch C# reaches at :516-520, which
        // looks the base up EXACTLY in docs.tags and reads parts[0], not the tracer.
        const docs = paramDocs();
        const text = '  - narrate <material[';
        expect(text.length).toBe(22);
        const items = paramItems(docs, text);
        expect(items.map(i => i.label)).toEqual(['stone', 'stone_bricks', 'stick']);
        for (const item of items) {
            expect(item.kind).toBe(CompletionItemKind.Enum);
            expect(item.textEdit).toEqual({
                range: { start: { line: 0, character: 22 }, end: { line: 0, character: 22 } },
                newText: item.label
            });
        }
    });

    // THE CLIENT OWNS FLAGS. `getFlagCompletionKind` (src/extension.ts:897) completes
    // flags from the client's own workspace index, and the shared middleware returns []
    // for exactly those contexts (src/extension.ts:59-64), so the server is never asked.
    // Porting C#'s CompleteFlag special case (TextDocumentService.cs:542-545) would be
    // dead code that additionally needs Phase 2D's WorkspaceTracker. This test exists so
    // that nobody later "fixes" the gap: the server must yield NOTHING here.
    it('yields nothing for <player.flag[ — flags are the client\'s job, not the server\'s', () => {
        const docs = paramDocs();
        // '  - narrate <player.flag[': '<' is index 12, 'player.flag[' occupies 13-24, so
        // the string is 25 characters long.
        const text = '  - narrate <player.flag[';
        expect(text.length).toBe(25);
        // The tag itself IS resolved — this is not an accident of the fixture failing to
        // find it. Its documented parameter '<name>' simply has no registered completer.
        expect(docs.tags.get('flaggableobject.flag')!.allowsParam).toBe(true);
        expect(paramItems(docs, text)).toEqual([]);
        expect(paramItems(docs, '  - narrate <player.flag[my_')).toEqual([]);
    });

    it('yields nothing, rather than throwing, for a tag part with no documented parameter', () => {
        const docs = paramDocs();
        expect(paramItems(docs, '  - narrate <player.name[')).toEqual([]);
        expect(paramItems(docs, '  - narrate <player.name[x')).toEqual([]);
    });

    it('yields nothing for a documented parameter no completer serves (<util.random_decimal_in_range[)', () => {
        // Derived, not observed: '<#.#>' normalises to itself (no brackets to strip and no
        // '|...'), is not a ByTag key, contains no ';' and no '/', so CompleteGenericTagParam
        // falls off its last branch and returns an empty list (:201).
        const docs = paramDocs();
        expect(paramItems(docs, '  - narrate <util.random_decimal_in_range[')).toEqual([]);
        expect(paramItems(docs, '  - narrate <util.random_decimal_in_range[0.')).toEqual([]);
    });

    it('yields nothing for an unknown tag rather than throwing', () => {
        const docs = paramDocs();
        expect(paramItems(docs, '  - narrate <nosuchbase[')).toEqual([]);
        expect(paramItems(docs, '  - narrate <player.nosuchpart[')).toEqual([]);
    });

    // Mechanism candidates are Property, not Enum (SuggestMechanisms, :211), and their
    // documentation comes from the candidate's own `detail`, which already names the
    // owning object type. Re-rendering through describeMech is impossible here without
    // guessing: docs.mechanisms is keyed by object-plus-name, two object types may
    // document the same mechanism name, and the candidate label carries a '=' suffix.
    it('marks mechanism candidates Property and documents them from the candidate itself', () => {
        const docs = paramDocs();
        // '  - narrate <item.with[': '<' is index 12, 'item.with[' occupies 13-22, so the
        // string is 23 characters long and paramStart is 23.
        const text = '  - narrate <item.with[';
        expect(text.length).toBe(23);
        const items = paramItems(docs, text);
        expect(items.map(i => i.label)).toEqual(['max_health=', 'material=', 'quantity=']);
        for (const item of items) {
            expect(item.kind).toBe(CompletionItemKind.Property);
        }
        expect(String((items[0].documentation as { value: string }).value))
            .toBe('**ItemTag Mechanism**: max_health');
        // Not the full DescribeMech rendering — one documentation source, never both.
        expect(String((items[0].documentation as { value: string }).value)).not.toContain('###');
        // And NOT CompleteForTagPiece's tag envelope either: SuggestMechanisms (:211) is a
        // different construction site with its own documentation, so wrapping it would
        // invent markup C# never produces here.
        expect(String((items[0].documentation as { value: string }).value)).not.toContain('### Tag');
        expect(String((items[0].documentation as { value: string }).value)).not.toContain('Input option');
    });

    // ---- CompleteForTagPiece's documentation envelope (CommandTabCompletions.cs:131-135).
    // C# :133 wraps the "input option" line in a full tag description — heading with the
    // parameter elided to '[...]>', LinkMeta, then ObligatoryText. Only the ';'-pair-key
    // (:168) and '/'-option (:187) candidates go through CompleteForTagPiece; enum and
    // mechanism candidates are built at their own sites and keep their own markup, which
    // the two tests above and below pin.
    it('wraps a /-option candidate in CompleteForTagPiece\'s full tag envelope, not the bare input option', () => {
        // '  - narrate <player.position[': '<' is index 12, 'player.position[' occupies
        // indices 13-28, so the string is 29 characters long and paramStart is 29.
        const docs = paramDocs();
        const text = '  - narrate <player.position[';
        expect(text.length).toBe(29);
        const items = paramItems(docs, text);
        expect(items.map(i => i.label)).toEqual(['head', 'left', 'right']);
        // CompleteForTagPiece builds Property items (:134), like SuggestMechanisms.
        for (const item of items) {
            expect(item.kind).toBe(CompletionItemKind.Property);
        }
        // The WHOLE string, character for character. The pieces are each load-bearing:
        //   '### Tag <PlayerTag.position[...]>' — the heading, with the documented
        //       parameter replaced by '[...]' (C#'s `tag.Name.BeforeLast('[') + "[...]>"`)
        //       and then DescriptionClean-escaped, which is what turns '<'/'>' into
        //       '&lt;'/'&gt;'.
        //   the meta-docs link — LinkMeta(tag), the same one describeTag emits.
        //   '**Input option**: **head** / left / right' — the bolded option list that was
        //       previously the ENTIRE documentation.
        //   the trailing '\n\n\n\n' — '\n\n' from the format string plus ObligatoryText's
        //       own leading '\n\n', with no plugin/deprecation/warning text to follow it.
        expect(String((items[0].documentation as { value: string }).value)).toBe(
            '### Tag &lt;PlayerTag.position[...]&gt;\n'
            + '[Meta Docs: Tags playertag.position]'
            + '(https://meta.denizenscript.com/Docs/Tags/playertag.position)\n\n'
            + '**Input option**: **head** / left / right\n\n\n\n'
        );
        // The other two options bold themselves, so the envelope is per candidate rather
        // than rendered once and shared.
        expect(String((items[1].documentation as { value: string }).value))
            .toContain('**Input option**: head / **left** / right');
        expect(String((items[2].documentation as { value: string }).value))
            .toContain('**Input option**: head / left / **right**');
        // Every candidate carries the same heading and link.
        for (const item of items) {
            const value = String((item.documentation as { value: string }).value);
            expect(value.startsWith('### Tag &lt;PlayerTag.position[...]&gt;\n')).toBe(true);
            expect(value).toContain('meta.denizenscript.com/Docs/Tags/playertag.position');
        }
    });

    it('wraps a ;-pair-key candidate in the same envelope', () => {
        // '  - narrate <player.region_flag[': '<' is index 12, 'player.region_flag['
        // occupies indices 13-31, so the string is 32 characters long.
        const docs = paramDocs();
        const text = '  - narrate <player.region_flag[';
        expect(text.length).toBe(32);
        const items = paramItems(docs, text);
        expect(items.map(i => i.label)).toEqual(['flag', 'location']);
        for (const item of items) {
            expect(item.kind).toBe(CompletionItemKind.Property);
        }
        // Same envelope, different "input option" body: the ';' branch's `**key**=`spec``
        // (:168). The heading IS DescriptionClean-escaped, but the input option is NOT —
        // C# :133 interpolates `inputData` raw and only escapes the name — so '<flag>'
        // stays literal here while the heading's angle brackets become entities. That
        // asymmetry is C#'s, and this asserts it rather than tidying it.
        expect(String((items[0].documentation as { value: string }).value)).toBe(
            '### Tag &lt;PlayerTag.region_flag[...]&gt;\n'
            + '[Meta Docs: Tags playertag.region_flag]'
            + '(https://meta.denizenscript.com/Docs/Tags/playertag.region_flag)\n\n'
            + '**Input option**: **flag**=`<flag>`\n\n\n\n'
        );
        expect(String((items[1].documentation as { value: string }).value))
            .toContain('**Input option**: **location**=`<at>`');
    });

    // DELIBERATE DEVIATION from the task brief's "textEdit from paramStart to the cursor":
    // for a ';'-separated spec, a candidate extends only the text after the last ';', so a
    // range spanning ALL of paramSoFar would delete the pairs the user already typed —
    // accepting 'max_health=' below would turn '[display_name=hi;ma' into '[max_health='.
    // The range therefore covers the longest suffix of paramSoFar that the candidate label
    // extends, which IS paramStart-to-cursor for every spec that consumes the whole typed
    // text (every case above). See the matching comment in completionProvider.ts.
    it('replaces only the segment a candidate actually extends, not earlier ;-separated pairs', () => {
        // '  - narrate <item.with[display_name=hi;ma': paramStart is 23 (see above), and
        // 'display_name=hi;ma' occupies indices 23-40 —
        // d23 i24 s25 p26 l27 a28 y29 _30 n31 a32 m33 e34 =35 h36 i37 ;38 m39 a40.
        // The string is 41 characters long, so the cursor is at 41 and the 'ma' being
        // completed starts at 39.
        const docs = paramDocs();
        const text = '  - narrate <item.with[display_name=hi;ma';
        expect(text.length).toBe(41);
        expect(text.substring(39, 41)).toBe('ma');
        const items = paramItems(docs, text);
        expect(items.map(i => i.label)).toEqual(['max_health=', 'material=']);
        for (const item of items) {
            expect(item.textEdit).toEqual({
                range: { start: { line: 0, character: 39 }, end: { line: 0, character: 41 } },
                newText: item.label
            });
        }
    });

    // ---- The branch must fire ONLY inside a still-open bracket.
    it('does not fire once the bracket is closed, leaving tag-part completion in charge', () => {
        const docs = paramDocs();
        // '  - narrate <player.gamemode_at[stone].': the bracket is closed, so this is
        // ordinary part completion after a dot — no material may leak in.
        const labels = paramItems(docs, '  - narrate <player.gamemode_at[stone].').map(i => i.label);
        expect(labels).not.toContain('stone');
        expect(labels).not.toContain('stone_bricks');
    });

    it('does not fire when the cursor is in a tag part rather than a parameter', () => {
        // '  - narrate <player.gamemode_a': '<' is index 12, the dot is index 19, so the
        // component being typed starts at 20 and the string is 30 characters long.
        const docs = paramDocs();
        const text = '  - narrate <player.gamemode_a';
        expect(text.length).toBe(30);
        const items = paramItems(docs, text);
        expect(items.map(i => i.label)).toEqual(['gamemode_at']);
        expect(items[0].kind).toBe(CompletionItemKind.Property);
        expect(items[0].textEdit).toEqual({
            range: { start: { line: 0, character: 20 }, end: { line: 0, character: 30 } },
            newText: 'gamemode_at'
        });
    });

    it('leaves base and part completion outside brackets exactly as they were', () => {
        // The 2B-4/2B-5 fixtures, unchanged, through the same entry point: adding the
        // parameter branch ahead of findTagAtCursor must not perturb inputs that never
        // reach it.
        const docs = narrowingDocs();
        expect(labelsAt(docs, '  - narrate <pla')).toEqual(['player', 'playertag']);
        expect(labelsAt(docs, '  - narrate <player.'))
            .toEqual(['as', 'flag', 'foo.bar', 'groups', 'name', 'to_uppercase']);
        expect(labelsAt(docs, '  - narrate <player.flag[x].')).toEqual([...ALL_PARTS].sort());
    });

    it('does not fire outside a tag at all, so command-argument completion still runs', () => {
        const docs = paramDocs();
        makeCommand('money', 'money [give/take/set] (quantity:<#.#>) (players:<player>|...)', 'Adjusts money.').addTo(docs);
        const labels = provideCompletions(docs, PARAM_EXTRA, '  - money pla', '  - money pla'.length, 0).map(i => i.label);
        expect(labels).toContain('players:');
        expect(labels).not.toContain('player');
        expect(labels).not.toContain('stone');
    });
});

describe('tag completion on key lines (TextDocumentService.cs:408-421)', () => {
    // Regression cover for a port bug reported by the user on 2026-08-27: this port had the
    // key-line branch RETURN the enum-completion result unconditionally, where the C# returns
    // only when that branch produced something and otherwise falls through to one shared tag
    // branch serving `-` lines and `:` lines alike. The effect was that every tag written on a
    // key line -- `display name: <...`, `format: <...` -- silently offered nothing.

    it('completes a tag base written as a key value', () => {
        // MUTANT: restore the unconditional `return completeKeyLineValues(...)`.
        const docs = narrowingDocs();
        expect(labelsAt(docs, '  display name: <pla')).toEqual(['player', 'playertag']);
    });

    it('completes a tag part written as a key value', () => {
        // MUTANT: as above. Distinct from the base case because it exercises findTagAtCursor's
        // narrowing rather than just its base list.
        const docs = narrowingDocs();
        expect(labelsAt(docs, '  format: <player.'))
            .toEqual(['as', 'flag', 'foo.bar', 'groups', 'name', 'to_uppercase']);
    });

    it('still prefers enum values over tag completion on a key line', () => {
        // MUTANT: drop the `if (enumResults.length > 0) return enumResults;` guard, or reorder
        // the two. `material: sto` must offer materials, not tags -- the C# checks the enum
        // branch first and this must keep doing so.
        // `material` is backed by ExtraData.items (argumentCompleters.ts:92), which PARAM_EXTRA
        // populates with STICK alone -- hence `sti` rather than a block name.
        const docs = paramDocs();
        const text = '  material: sti';
        const labels = provideCompletions(docs, PARAM_EXTRA, text, text.length, 0).map(i => i.label);
        expect(labels).toContain('stick');
        expect(labels).not.toContain('player');
    });

    it('completes inside an open tag even with no dash and no colon (DEVIATION #10)', () => {
        // USER RULING 2026-08-27. The C# guards this branch with
        // `StartsWithFast('-') || Contains(':')` (:421) and so offers nothing here; this port
        // deliberately lets `completeTagAt` decide instead. `key = value` is the shape of every
        // line in the expanded map-tag buffer, which is where the user hit it.
        // MUTANT: restore the `if (!ctx.trimmed.includes(':')) return [];` guard.
        const docs = narrowingDocs();
        expect(labelsAt(docs, '  translation = <player.'))
            .toEqual(['as', 'flag', 'foo.bar', 'groups', 'name', 'to_uppercase']);
    });

    it('still offers nothing on such a line when the cursor is NOT inside a tag', () => {
        // The other half of deviation #10, and the reason it is narrow: dropping the guard must
        // not start completing in prose. `completeTagAt` returns null with no open tag.
        // MUTANT: make completeTagAt fall back to the flat tag list instead of returning null.
        const docs = narrowingDocs();
        expect(labelsAt(docs, '  translation = someplaintext')).toEqual([]);
        expect(labelsAt(docs, '  just some prose about player')).toEqual([]);
    });

    it('keeps the argument under the cursor intact when a tag contains spaces', () => {
        // MUTANT: make lastTopLevelArgStart count every space, ignoring tag depth. Then the arg
        // would start after the space inside the brackets and the open tag would be lost.
        const docs = narrowingDocs();
        expect(labelsAt(docs, '  display name: <player.flag[a b].')).toEqual([...ALL_PARTS].sort());
    });

    it('anchors the key-line insert range to the real column, indent included', () => {
        // MUTANTS: `ctx.indent + argStart` -> `argStart` (shifts every insert left by the
        // indent), and `argStart = i + 1` -> `argStart = i` in lastTopLevelArgStart (off by one).
        // Both leave the LABELS identical, so every other test in this block passes with them
        // applied -- the damage is that accepting a completion overwrites the wrong characters.
        // `    display name: <pla` puts '<' at index 18 and 'pla' at 19..22.
        const docs = narrowingDocs();
        const text = '    display name: <pla';
        const items = provideCompletions(docs, createEmptyExtraData(), text, text.length, 0);
        const edit = items.find(i => i.label === 'player')!.textEdit!;
        expect(edit).toMatchObject({
            range: { start: { line: 0, character: 19 }, end: { line: 0, character: 22 } },
            newText: 'player'
        });
    });
});

describe("tag completion items carry the tag's full name as `detail`", () => {
    // TextDocumentService.cs passes `tagDoc.Name` as the third CompletionItem argument -- the
    // DETAIL -- at both construction sites, :508 for bases and :532 for narrowed parts. It is what
    // tells two same-named parts on different object types apart in the list: a bare `name` label
    // is ambiguous, `<PlayerTag.name>` beside it is not.

    it('sets detail on a base candidate that resolves to a documented tag', () => {
        // `<player>` is a dotless base tag, so the exact `docs.tags` lookup hits and both the
        // detail and the documentation come from it.
        // MUTANT CAUGHT: omitting `item.detail`.
        const text = '- narrate <player';
        const items = provideCompletions(tagDocs(), createEmptyExtraData(), text, text.length, 0);
        const player = items.find(i => i.label === 'player')!;
        expect(player).toBeDefined();
        expect(player.detail).toBe('<player>');
    });

    it('leaves detail undefined on a base candidate with no documented tag', () => {
        // C# falls back to a two-argument constructor with NEITHER detail nor documentation when
        // the exact lookup misses (:509). `context` is seeded into tagBases with no MetaTag behind
        // it (MetaDocs.cs:79), so it is exactly that case.
        // MUTANT CAUGHT: hoisting `item.detail` out of the `doc !== undefined` guard.
        const text = '- narrate <context';
        const items = provideCompletions(tagDocs(), createEmptyExtraData(), text, text.length, 0);
        const context = items.find(i => i.label === 'context');
        expect(context).toBeDefined();
        expect(context!.detail).toBeUndefined();
        expect(context!.documentation).toBeUndefined();
    });

    it('leaves detail undefined on an unnarrowed PART candidate', () => {
        // Parts deliberately carry neither documentation nor detail on the flat branch: the exact
        // `docs.tags` lookup is wrong for them -- all 33 of its part hits on real meta are
        // namespace collisions, see the note on completeTag -- so there is no name to show that
        // would be right.
        // MUTANT CAUGHT: reusing the base lookup for parts.
        const text = '- narrate <player.na';
        const items = provideCompletions(tagDocs(), createEmptyExtraData(), text, text.length, 0, false);
        expect(items.length).toBeGreaterThan(0);
        for (const item of items) {
            expect(item.detail).toBeUndefined();
        }
    });
});

/**
 * FEATURE-IDEAS.md idea 3, user ruling 2026-09-01: map keys inside `- adjust <obj> <map[...]>`
 * are mechanism names, and are DERIVED from the meta rather than hand-curated.
 *
 * The names in the fixture are the real ones the user asked for by name, and they are real
 * `EntityTag` properties in Denizen's meta -- which is the fact that made the feature note's
 * "they are not in Denizen's meta" assessment wrong and this implementation possible.
 */
/**
 * `<ObjectTag.as[<type>]>`, user request 2026-09-03.
 *
 * The routing is the whole risk here. `<type>` is documented by NINE tags and they mean different
 * things — object types for `as[...]`, but click and hover event kinds for
 * `on_click[...].type[...]`, Minecraft structures for `find.structure[...]`, notable kinds for
 * `server.notes[...]`. Measured against the live meta.
 */
describe('as[<type>] offers object types, and only there', () => {
    function asDocs(): MetaDocs {
        const blocks: MetaBlock[] = [
            { objectType: 'objecttype', url: 's#L1', data: ['@name ObjectTag', '@prefix none', '@base none', '@format x', '@description x', '@end_meta'] },
            { objectType: 'objecttype', url: 's#L2', data: ['@name EntityTag', '@prefix e', '@base ObjectTag', '@format x', '@description x', '@end_meta'] },
            { objectType: 'objecttype', url: 's#L3', data: ['@name ListTag', '@prefix li', '@base ObjectTag', '@format x', '@description x', '@end_meta'] },
            { objectType: 'objecttype', url: 's#L4', data: ['@name AreaObject', '@prefix none', '@base ObjectTag', '@format x', '@description x', '@end_meta'] },
            { objectType: 'objecttype', url: 's#L8', data: ['@name ElementTag', '@prefix el', '@base ObjectTag', '@format x', '@description x', '@end_meta'] },
            { objectType: 'objecttype', url: 's#L9', data: ['@name PlayerTag', '@prefix p', '@base ObjectTag', '@format x', '@description x', '@end_meta'] },
            { objectType: 'command', url: 's#L5', data: ['@name narrate', '@syntax narrate [<text>]', '@short x', '@group x', '@description x', '@required 1', '@maximum 2', '@end_meta'] },
            // `<player...>` has to exist as a real tag base for the part-form lookup to reach
            // `as` at all -- `as` is inherited from ObjectTag rather than written on PlayerTag.
            { objectType: 'tag', url: 's#L10', data: ['@attribute <player>', '@returns PlayerTag', '@description x', '@end_meta'] },
            // The two tags that both document a `<type>` parameter and mean different things.
            { objectType: 'tag', url: 's#L6', data: ['@attribute <ObjectTag.as[<type>]>', '@returns ObjectTag', '@description x', '@end_meta'] },
            { objectType: 'tag', url: 's#L7', data: ['@attribute <ElementTag.on_click[<message>].type[<type>]>', '@returns ElementTag', '@description x', '@end_meta'] }
        ];
        const docs = buildMetaDocs(blocks);
        linkTypeGraph(docs);
        return docs;
    }
    const DOCS = asDocs();
    const labels = (text: string) =>
        provideCompletions(DOCS, createEmptyExtraData(), text, text.length, 0).map(i => i.label);

    it('offers the short-form object type names', () => {
        // Every `*Tag` in the fixture, with `Tag` stripped -- and `AreaObject`, which is not one,
        // absent. `object` is offered because `ObjectTag` is itself a type; harmless, and it
        // follows the documented rule rather than a special case.
        expect(labels('- narrate <player.as[').sort())
            .toEqual(['element', 'entity', 'list', 'object', 'player']);
    });

    it('narrows by what is typed', () => {
        expect(labels('- narrate <player.as[ent')).toEqual(['entity']);
        expect(labels('- narrate <player.as[zzz')).toEqual([]);
    });

    it('leaves the abstract markers out', () => {
        // AreaObject is in objectTypes but is not a type anything converts TO.
        expect(labels('- narrate <player.as[')).not.toContain('areaobject');
    });

    it('does NOT offer object types for a different tag that also takes <type>', () => {
        // The failure this guards: registering `<type>` in the shared spec table would put
        // `entity` and `list` inside a click handler, where the kinds are `open_url`,
        // `run_command` and friends.
        // MUTANT CAUGHT: keying on the parameter spec alone instead of on the tag part.
        expect(labels('- narrate <element[hi].on_click[cmd].type[')).toEqual([]);
    });

    it('keys on the part named "as", not on any tag whose name merely contains it', () => {
        // `has_flag` ends in something else entirely; the point is that the LAST dotted component
        // must be exactly `as`.
        expect(labels('- narrate <player.flag[')).not.toContain('entity');
    });
});

/**
 * The bare-tag-path brackets — `<ListTag.filter[...]>` and friends, user request 2026-09-03.
 *
 * Same routing risk as `as[<type>]` above, and sharper. Eight tags document a `<tag>` parameter but
 * only six mean a Denizen tag path; `server.vanilla_tagged_entities` and `..._materials` take a
 * VANILLA MINECRAFT tag (`minecraft:logs`), their descriptions linking minecraft.wiki. Measured
 * against the live meta.
 */
describe('filter/parse-style brackets offer bare tag paths, and only there', () => {
    function bareTagDocs(): MetaDocs {
        const blocks: MetaBlock[] = [
            { objectType: 'objecttype', url: 's#L1', data: ['@name ObjectTag', '@prefix none', '@base none', '@format x', '@description x', '@end_meta'] },
            { objectType: 'objecttype', url: 's#L2', data: ['@name ListTag', '@prefix li', '@base ObjectTag', '@format x', '@description x', '@end_meta'] },
            { objectType: 'objecttype', url: 's#L3', data: ['@name ElementTag', '@prefix el', '@base ObjectTag', '@format x', '@description x', '@end_meta'] },
            { objectType: 'objecttype', url: 's#L4', data: ['@name PlayerTag', '@prefix p', '@base ObjectTag', '@format x', '@description x', '@end_meta'] },
            { objectType: 'objecttype', url: 's#L5', data: ['@name ServerTag', '@prefix none', '@base ObjectTag', '@format x', '@description x', '@end_meta'] },
            { objectType: 'command', url: 's#L6', data: ['@name narrate', '@syntax narrate [<text>]', '@short x', '@group x', '@description x', '@required 1', '@maximum 2', '@end_meta'] },
            // Bases, so the part-form lookup can reach the bracketed part at all.
            { objectType: 'tag', url: 's#L7', data: ['@attribute <list[<list>]>', '@returns ListTag', '@description x', '@end_meta'] },
            { objectType: 'tag', url: 's#L8', data: ['@attribute <server>', '@returns ServerTag', '@description x', '@end_meta'] },
            // The brackets under test.
            { objectType: 'tag', url: 's#L9', data: ['@attribute <ListTag.filter[<tag>]>', '@returns ListTag', '@description x', '@end_meta'] },
            { objectType: 'tag', url: 's#L10', data: ['@attribute <ListTag.sort_by_value[<tag>]>', '@returns ListTag', '@description x', '@end_meta'] },
            // The false friend: same `<tag>` spec, a vanilla Minecraft tag.
            { objectType: 'tag', url: 's#L11', data: ['@attribute <ServerTag.vanilla_tagged_materials[<tag>]>', '@returns ListTag', '@description x', '@end_meta'] },
            // Parts to offer.
            { objectType: 'tag', url: 's#L12', data: ['@attribute <ElementTag.to_uppercase>', '@returns ElementTag', '@description x', '@end_meta'] },
            { objectType: 'tag', url: 's#L13', data: ['@attribute <ElementTag.is_more_than[<number>]>', '@returns ElementTag', '@description x', '@end_meta'] },
            { objectType: 'tag', url: 's#L14', data: ['@attribute <PlayerTag.name>', '@returns ElementTag', '@description x', '@end_meta'] }
        ];
        const docs = buildMetaDocs(blocks);
        linkTypeGraph(docs);
        return docs;
    }
    const DOCS = bareTagDocs();
    const items = (text: string) =>
        provideCompletions(DOCS, createEmptyExtraData(), text, text.length, 0);
    const labels = (text: string) => items(text).map(i => i.label);

    it('offers tag parts inside filter[', () => {
        // The meta's own example for this bracket is `<list[1|2|3|4|5].filter[is_more_than[3]]>`.
        expect(labels('- narrate <list[a|b].filter[')).toEqual(expect.arrayContaining(['is_more_than', 'to_uppercase', 'name']));
    });

    it('narrows by what is typed', () => {
        expect(labels('- narrate <list[a|b].filter[is_')).toEqual(['is_more_than']);
        expect(labels('- narrate <list[a|b].filter[zzz')).toEqual([]);
    });

    it('offers parts for the other five bare-tag-path brackets too', () => {
        expect(labels('- narrate <list[a|b].sort_by_value[to_up')).toEqual(['to_uppercase']);
    });

    it('completes only the last component of a multi-component path', () => {
        // `sort_by_value[location.y]` is legal, so a dotted path must keep what precedes the dot.
        // MUTANT CAUGHT: filtering on the whole typed text would offer nothing here, and replacing
        // the whole typed text would delete `name.` when the candidate is accepted.
        const [item] = items('- narrate <list[a|b].sort_by_value[name.to_up');
        expect(item.label).toEqual('to_uppercase');
        const range = item.textEdit!.range;
        expect(range.end.character - range.start.character).toEqual('to_up'.length);
    });

    it('does NOT offer tag paths for a vanilla-Minecraft-tag bracket that also takes <tag>', () => {
        // The failure this guards: registering `<tag>` in the shared spec table would put 1885
        // Denizen tag parts inside a bracket whose input is `minecraft:logs`.
        // MUTANT CAUGHT: keying on the parameter spec alone instead of on the tag part.
        expect(labels('- narrate <server.vanilla_tagged_materials[')).toEqual([]);
    });

    it('attaches no documentation, since a part name maps to no single tag', () => {
        // `name` is documented by many object types; picking one would attach another type's text.
        const item = items('- narrate <list[a|b].filter[').find(i => i.label === 'name');
        expect(item!.documentation).toBeUndefined();
    });
});

/**
 * `<context.[...]>` narrowed to the enclosing event's own context names, user request
 * 2026-09-03: "в <context. выводится все теги а не только те что в ивенте".
 *
 * `context` traces to no object type at all (there is nothing for the tag tracer to trace it to),
 * so before this it always fell through to the flat 1871-part list -- the exact bug being fixed.
 */
describe('<context.[...]> is narrowed to the enclosing event, and only there', () => {
    function contextDocs(): MetaDocs {
        const docs = createEmptyMetaDocs();
        const cmd = new MetaCommand();
        cmd.type = META_TYPE_COMMAND;
        cmd.commandName = 'narrate';
        cmd.syntax = 'narrate [<text>]';
        cmd.addTo(docs);

        // At least one real tag, so the flat-list fallback has something to offer -- otherwise
        // "falls back to the flat list" and "offers nothing" would look identical.
        const tag = new MetaTag();
        tag.type = META_TYPE_TAG;
        tag.applyValue('attribute', '<ElementTag.to_uppercase>');
        tag.applyValue('returns', 'ElementTag');
        tag.addTo(docs);

        const breaks = new MetaEvent();
        breaks.applyValue('events', 'player breaks <block>');
        breaks.applyValue('player', 'x');
        breaks.applyValue('context',
            '<context.location> returns the LocationTag of the block.\n<context.material> returns the MaterialTag broken.');
        breaks.addTo(docs);

        const joins = new MetaEvent();
        joins.applyValue('events', 'player joins');
        joins.applyValue('player', 'x');
        // No @context at all -- the "resolved event with nothing to offer" case.
        joins.addTo(docs);

        linkEventMatchers(docs, createEmptyExtraData());
        return docs;
    }
    const DOCS = contextDocs();
    const labels = (text: string) => provideCompletions(DOCS, createEmptyExtraData(), text, text.length, text.split('\n').length - 1).map(i => i.label);

    it('offers only the enclosing event\'s own context names', () => {
        const text = '    on player breaks stone:\n        - narrate <context.';
        expect(labels(text).sort()).toEqual(['location', 'material']);
    });

    it('narrows further by what is typed', () => {
        const text = '    on player breaks stone:\n        - narrate <context.loc';
        expect(labels(text)).toEqual(['location']);
    });

    it('offers nothing, not the flat list, for an event documenting no context at all', () => {
        // The resolved-event-with-empty-list case: showing the flat 1871 here would claim every
        // tag part in the meta as a valid context name for "player joins", which documents none.
        const text = '    on player joins:\n        - narrate <context.';
        expect(labels(text)).toEqual([]);
    });

    it('finds the enclosing event through several lines of body', () => {
        const text = '    on player breaks stone:\n        - narrate hi\n        - if true:\n            - narrate <context.';
        expect(labels(text).sort()).toEqual(['location', 'material']);
    });

    it('falls back to the flat list when no enclosing event can be found', () => {
        // <context. written where this cannot identify an event (a task container, or the very
        // first line of a file) keeps its pre-existing behaviour rather than offering nothing.
        // MUTANT CAUGHT: returning [] instead of falling through to completeTag.
        const text = 'my_task:\n    type: task\n    script:\n    - narrate <context.';
        expect(labels(text).length).toBeGreaterThan(0);
        expect(labels(text)).not.toEqual(['location', 'material']);
    });

    it('does not narrow a plain tag base that merely starts with the same letters', () => {
        // Not "context" exactly, so the componentCount===1 && beforeLastComponent==='context'
        // gate must not fire -- this is a completely different (undocumented) base, and it falls
        // through to completeTag's own pre-existing behaviour (the flat list here) exactly as it
        // would have before this feature existed.
        const text = '    on player breaks stone:\n        - narrate <contextual_thing.';
        expect(labels(text)).not.toEqual(['location', 'material']);
    });

    it('does not fire for a deeper component of context, since context names never nest', () => {
        // `beforeLastComponent` at this cursor position is "context.location" (everything before
        // the LAST dot), never bare "context" -- so the narrowing gate excludes this shape without
        // needing a separate depth check. Pins that reading, since a future edit to
        // beforeLastComponent's definition could silently reopen it.
        const text = '    on player breaks stone:\n        - narrate <context.location.';
        expect(labels(text)).not.toEqual(['location', 'material']);
    });
});

describe('map keys and the adjust mechanism argument (user rulings 2026-09-01)', () => {
    function adjustDocs(): MetaDocs {
        const blocks: MetaBlock[] = [
            { objectType: 'objecttype', url: 's#L1', data: ['@name ObjectTag', '@prefix none', '@base none', '@format x', '@description x', '@end_meta'] },
            { objectType: 'command', url: 's#L1', data: ['@name adjust', '@syntax adjust [<ObjectTag>] [<mechanism>](:<value>)', '@short x', '@group x', '@description x', '@required 1', '@maximum 5', '@end_meta'] },
            { objectType: 'command', url: 's#L1', data: ['@name narrate', '@syntax narrate [<text>]', '@short x', '@group x', '@description x', '@required 1', '@maximum 2', '@end_meta'] },
            { objectType: 'command', url: 's#L1', data: ['@name define', '@syntax define [<name>] [<value>]', '@short x', '@group x', '@description x', '@required 1', '@maximum 3', '@end_meta'] },
            // The map tag itself, documented exactly as the real meta documents it: a GENERIC
            // `(<map>)` parameter, which is why the ordinary spec registry offers nothing here.
            { objectType: 'tag', url: 's#L1', data: ['@attribute <map[(<map>)]>', '@returns MapTag', '@description x', '@end_meta'] },
            { objectType: 'mechanism', url: 's#L1', data: ['@object EntityTag', '@name interpolation_start', '@input DurationTag', '@description x', '@end_meta'] },
            { objectType: 'mechanism', url: 's#L1', data: ['@object EntityTag', '@name interpolation_duration', '@input DurationTag', '@description x', '@end_meta'] },
            { objectType: 'mechanism', url: 's#L1', data: ['@object EntityTag', '@name translation', '@input LocationTag', '@description x', '@end_meta'] }
        ];
        const docs = buildMetaDocs(blocks);
        linkTypeGraph(docs);
        return docs;
    }
    const DOCS = adjustDocs();
    const labels = (text: string) =>
        provideCompletions(DOCS, createEmptyExtraData(), text, text.length, 0).map(i => i.label);

    it('offers mechanism names for the map keys', () => {
        expect(labels('- adjust <[ent]> <map[interpolation').sort())
            .toEqual(['interpolation_duration=', 'interpolation_start=']);
    });

    it('completes a SECOND key after a ";"', () => {
        // MUTANT CAUGHT: passing the whole parameter text instead of the segment after the last
        // `;`, which would match nothing once one entry is written.
        expect(labels('- adjust <[ent]> <map[translation=1,2,3;interpolation_d'))
            .toEqual(['interpolation_duration=']);
    });

    it('replaces only the typed segment, keeping the earlier entries', () => {
        // Accepting a candidate must not eat `translation=1,2,3;`.
        const text = '- adjust <[ent]> <map[translation=1,2,3;interpolation_d';
        const item = provideCompletions(DOCS, createEmptyExtraData(), text, text.length, 0)[0];
        expect(item.textEdit!.range.start.character).toBe('- adjust <[ent]> <map[translation=1,2,3;'.length);
    });

    it('offers nothing once the "=" is typed, since the VALUE is undocumented', () => {
        expect(labels('- adjust <[ent]> <map[translation=')).toEqual([]);
    });

    it('offers them in ANY map tag, not only an adjust argument', () => {
        // SCOPE WIDENED 2026-09-01, second user ruling. This first shipped restricted to maps
        // written as an argument to `adjust`, on the reasoning that a data map's keys are
        // arbitrary. The user asked for it in a plain `- narrate <map[...]>` too, which is their
        // call: the restriction meant the feature was missing where they went looking for it.
        // MUTANT CAUGHT: reinstating the `commandName === 'adjust'` half of the condition.
        expect(labels('- narrate <map[interpolation').sort())
            .toEqual(['interpolation_duration=', 'interpolation_start=']);
        expect(labels('- define x <map[translation')).toEqual(['translation=']);
    });

    it('offers them on a key line too', () => {
        // A key line has no command at all, so this pins that the widening reaches that path.
        expect(labels('    display name: <map[translation')).toEqual(['translation=']);
    });

    it('does not hijack a different tag that happens to take a parameter', () => {
        // MUTANT CAUGHT: testing only the command and not the tag name.
        expect(labels('- adjust <[ent]> <list[interpolation')).toEqual([]);
    });

    describe('the bare mechanism ARGUMENT, e.g. `- adjust <[ent]> inter`', () => {
        // Reported by the user 2026-09-01 as offering nothing. It is a gap in BOTH engines:
        // CommandTabCompletions.cs registers mechanism completion only for tag parameter specs
        // (:52-55), never for a command argument, so `adjust`'s documented `[<mechanism>]`
        // argument completed nothing on either server.
        it('offers mechanism names, with a colon rather than an equals', () => {
            // `adjust [<ObjectTag>] [<mechanism>](:<value>)` -- the argument form separates the
            // value with `:`, where the map form uses `=`.
            expect(labels('- adjust <[ent]> interpolation').sort())
                .toEqual(['interpolation_duration:', 'interpolation_start:']);
        });

        it('does not offer them in the FIRST argument, which is the object being adjusted', () => {
            // 680 mechanism names in the object slot would bury every real suggestion.
            // MUTANT CAUGHT: dropping the argIndex >= 1 guard.
            expect(labels('- adjust interpolation')).toEqual([]);
        });

        it('offers nothing once the ":" is typed, since the VALUE is undocumented', () => {
            expect(labels('- adjust <[ent]> translation:')).toEqual([]);
        });

        it('reads the qualifying commands from the SYNTAX, not a hardcoded name list', () => {
            // `narrate [<text>]` documents no `<mechanism>`, so it must not offer them however
            // many arguments in the cursor is.
            // MUTANT CAUGHT: matching on the command NAME being 'adjust'.
            expect(labels('- narrate a interpolation')).toEqual([]);
        });

        it('replaces the whole typed argument', () => {
            const text = '- adjust <[ent]> interpolation_d';
            const item = provideCompletions(DOCS, createEmptyExtraData(), text, text.length, 0)[0];
            expect(item.textEdit!.range.start.character).toBe('- adjust <[ent]> '.length);
            expect(item.textEdit!.range.end.character).toBe(text.length);
        });
    });
});
