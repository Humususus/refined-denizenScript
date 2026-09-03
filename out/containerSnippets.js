"use strict";
// The container skeletons offered at column 0: one per script type, as snippet bodies.
//
// Split out of extension.ts so it can be unit-tested -- these are plain data, and the one defect
// they have had (see the indentation note below) was a data defect that no test could see while
// the table lived behind a `vscode` import.
//
// The type list and each skeleton's key set come from `ScriptChecker.KnownScriptTypes`
// (SharpDenizenTools/ScriptAnalysis/ScriptChecker.cs:22-42), which is the C# server's own
// authority on what a container may contain. Each skeleton carries that type's `RequiredKeys`
// and nothing else -- a container you have to delete lines out of is worse than one you add to.
// A key listed in `ScriptKeys` is emitted as a command list (`key:` then `- `), one in
// `ListKeys` as a value list, and one in `ValueKeys` as a scalar.
//
// Types whose `RequiredKeys` is empty (custom, data, map, enchantment) get just the name, `type:`
// and `debug:` lines, which is genuinely all Denizen requires of them.
//
// Placeholders are deliberately latin identifier-ish text: these are names in code, not display
// strings. The `dialog` entry is the exception and keeps its original Russian body text, since
// a dialog's strings really are shown to players.
//
// INDENTATION IS TABS, AND MUST STAY TABS. Reported by the user 2026-09-01: the bodies used to
// carry literal two-space indents, which VS Code inserts verbatim -- so anyone whose editor is set
// to four spaces (or to real tabs) got a container indented two spaces regardless, disagreeing
// with every other line they write. `vscode.SnippetString` normalises leading `\t` to the editor's
// own `editor.insertSpaces` and `editor.tabSize`, so one `\t` per level is the only form that
// follows the user's settings. `ONE_LEVEL` below is the unit; nothing here may contain a literal
// indent space.
//
// `debug: false` is on every skeleton by user request (2026-09-01). It is safe on every type: the
// checker treats `debug` as container metadata and skips it alongside `type` and `speed`
// (containerChecks.ts, ScriptChecker.cs:974-977), so it draws no diagnostic anywhere.
//
// EVERY SKELETON MUST CHECK CLEAN, and two did not until 2026-09-01. Running the resolved bodies
// through the checker found `- narrate "hello"` drawing `bad_quotes` in five of them (quotes round
// a value with no spaces are pointless, ScriptChecker.cs:748) and economy's `format:` drawing
// `def_of_nothing` for `<[name]>`, a definition an economy container does not provide -- it seeds
// only `amount`. A skeleton that warns the moment it is inserted teaches the wrong thing, so the
// placeholders were corrected rather than the checks silenced. `containerSnippets.test.ts` pins
// the shape; the corpus script proves the checker stays quiet.
Object.defineProperty(exports, "__esModule", { value: true });
exports.containerSnippetText = exports.CONTAINER_SNIPPETS = void 0;
/** One indentation level inside a snippet body. See the indentation note in the file header. */
const ONE_LEVEL = '\t';
/** Builds a body from lines given as (level, text) pairs, so no literal indentation is written by hand. */
function body(...lines) {
    return lines.map(([level, text]) => ONE_LEVEL.repeat(level) + text).join('\n');
}
exports.CONTAINER_SNIPPETS = [
    // --- Denizen Core ---
    {
        type: 'task', detail: 'Denizen task container',
        body: body([1, 'type: task'], [1, 'debug: false'], [1, 'script:'], [1, '- ${2:narrate "Hello there!"}'])
    },
    {
        type: 'procedure', detail: 'Denizen procedure container',
        body: body([1, 'type: procedure'], [1, 'debug: false'], [1, 'script:'], [1, '- ${2:determine 1}'])
    },
    {
        type: 'world', detail: 'Denizen world container',
        body: body([1, 'type: world'], [1, 'debug: false'], [1, 'events:'], [2, 'on ${2:player joins}:'], [2, '- ${3:narrate "Hello there!"}'])
    },
    {
        type: 'custom', detail: 'Denizen custom container',
        body: body([1, 'type: custom'], [1, 'debug: false'])
    },
    {
        type: 'data', detail: 'Denizen data container',
        body: body([1, 'type: data'], [1, 'debug: false'])
    },
    // --- Denizen-Bukkit ---
    {
        type: 'assignment', detail: 'Denizen assignment container',
        body: body([1, 'type: assignment'], [1, 'debug: false'], [1, 'actions:'], [2, 'on ${2:assignment}:'], [2, '- ${3:narrate "Hello there!"}'])
    },
    {
        type: 'book', detail: 'Denizen book container',
        body: body([1, 'type: book'], [1, 'debug: false'], [1, 'title: ${2:My Book}'], [1, 'author: ${3:Author}'], [1, 'text:'], [1, '- ${4:Page one.}'])
    },
    {
        type: 'command', detail: 'Denizen command container',
        body: body([1, 'type: command'], [1, 'debug: false'], [1, 'name: ${2:mycommand}'], [1, 'description: ${3:My command.}'], [1, 'usage: /${2:mycommand}'], [1, 'script:'], [1, '- ${4:narrate "Hello there!"}'])
    },
    {
        type: 'economy', detail: 'Denizen economy container',
        body: body([1, 'type: economy'], [1, 'debug: false'], [1, 'priority: ${2:10}'], [1, 'name single: ${3:Coin}'], [1, 'name plural: ${4:Coins}'], [1, 'digits: ${5:2}'], [1, 'format: ${6:<[amount]> Coins}'], [1, 'balance: ${7:<player.flag[money]>}'], [1, 'has: ${8:<player.flag[money].is_more_than[<[amount]>]>}'], [1, 'withdraw:'], [1, '- ${9:flag player money:-:<[amount]>}'], [1, 'deposit:'], [1, '- ${10:flag player money:+:<[amount]>}'])
    },
    {
        type: 'entity', detail: 'Denizen entity container',
        body: body([1, 'type: entity'], [1, 'debug: false'], [1, 'entity_type: ${2:zombie}'])
    },
    {
        type: 'format', detail: 'Denizen format container',
        body: body([1, 'type: format'], [1, 'debug: false'], [1, 'format: ${2:<[text]>}'])
    },
    {
        type: 'interact', detail: 'Denizen interact container',
        body: body([1, 'type: interact'], [1, 'debug: false'], [1, 'steps:'], [2, '${2:1}:'], [3, '${3:click trigger}:'], [4, 'script:'], [4, '- ${4:narrate "Hello there!"}'])
    },
    {
        type: 'inventory', detail: 'Denizen inventory container',
        body: body([1, 'type: inventory'], [1, 'debug: false'], [1, 'inventory: ${2:chest}'])
    },
    {
        type: 'item', detail: 'Denizen item container',
        body: body([1, 'type: item'], [1, 'debug: false'], [1, 'material: ${2:stone}'])
    },
    {
        type: 'map', detail: 'Denizen map container',
        body: body([1, 'type: map'], [1, 'debug: false'])
    },
    {
        type: 'enchantment', detail: 'Denizen enchantment container',
        body: body([1, 'type: enchantment'], [1, 'debug: false'])
    },
    {
        type: 'dialog', detail: 'Denizen dialog container',
        body: body([1, 'type: dialog'], [1, 'debug: false'], [1, 'base:'], [2, 'type: multi'], [2, 'title: <gray>${2:Добро пожаловать!}'], [2, 'columns: 1'], [1, 'bodies:'], [2, 'header:'], [3, 'type: message'], [3, 'message: <gray>${3:Введите отображаемое имя}'], [1, 'inputs:'], [2, '1:'], [3, 'type: text'], [3, 'label: ${4:Имя}'], [3, 'key: ${5:display_name}'], [1, 'buttons:'], [2, '1:'], [3, 'label: ${6:Подтвердить}'], [3, 'script:'], [3, '- define name <context.${5:display_name}>'], [3, '- narrate <[name]>'])
    }
];
/**
 * The full snippet for a container, including its name line.
 *
 * `${1}` is the container's own name, so accepting the snippet drops the cursor on the name first
 * and tabs onward through the body.
 */
function containerSnippetText(entry) {
    return `\${1:my_${entry.type}}:\n${entry.body}`;
}
exports.containerSnippetText = containerSnippetText;
//# sourceMappingURL=containerSnippets.js.map