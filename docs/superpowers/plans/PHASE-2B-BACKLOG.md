# Phase 2B backlog

Collected during Phase 2A execution and from user testing on 2026-08-10.
Not a plan yet — raw input for `superpowers:writing-plans` when 2B starts.

## From user testing (highest priority — these are what the user actually hit)

### 1. `<[...]>` define completions not appearing on the TypeScript engine
**Status: unconfirmed, needs a discriminating test.** Reported 2026-08-10.
Static analysis so far shows the branch is intact:
- Phase 2A never modified the `defineMatch` branch or `getContainerDefines` (verified: the lines
  appear as unchanged context in `git diff ac312a9..HEAD -- src/extension.ts`).
- `getContainerSnippetCompletions`, which runs earlier and is unconditional, only matches at column 0
  with zero indentation (`/^(\s*)([A-Za-z_]*)$/` plus a `match[1].length != 0` bail), so it cannot
  swallow a `<[` on an indented line.
- `[` is still a registered trigger character (`src/extension.ts:1462`).
- The `escapeTagMatch` regex `/<(&?[A-Za-z0-9_]*)$/i` does not match `<[`, so gating it should not
  intercept the define path.
Open questions to settle first: does it work on `engine: csharp`? Does `getContainerDefines` find
anything for the user's script shape — it only recognises `- define <name>`, not `definemap`,
not `save:` entries, not a `definitions:` container key. If the set comes back empty the branch
returns `[]` and short-circuits, which looks identical to "not working".

### 2. Sound name completion for `playsound sound:`
Direct port target: C# `CommandTabCompletions.cs:58` —
`Register(ByCommand, "playsound", "sound", () => Data.Sounds, "Sound Enum")`.
Needs the whole `ExtraData` layer (`SharpDenizenTools/MetaHandlers/ExtraData.cs`, 359 lines): sounds,
materials, items, entities, particles, effects, potion effects, enchantments, biomes, statistics.
That unlocks a large slice of `CommandTabCompletions`' `ByCommand`/`ByTag` tables at once, not just sounds.
Values look like `block.stone.step` — sourced from Bukkit enums, shipped in the meta data set.

### 3. Go to the line where a flag is set, from a flag completion (user idea)
When flag completions appear (`<player.flag[`, `<server.flag[`), offer navigation to where the flag is
written. Two possible shapes: a `CompletionItem.command` that jumps on accept, or a proper
`DefinitionProvider` so F12 / ctrl-click works on a flag name inside `flag[...]`.
The data already exists — `workspaceIndex` knows the flags, and the C# `ScriptContainerData` tracks
`ServerFlags`/`ObjectFlags` per container with file and line. The C# server never implemented this;
it would be a genuine improvement over the original, not just parity.
Same idea generalises to script container names (the owner's original `LSP_REWRITE_PLAN.md` asked for
"on script container definition(name) память").

### 4. Dialect switcher: Default Denizen vs DenizenM (Energobro), with async thread-safety checking
Added 2026-08-10 from the owner. This is a **large** feature — likely its own phase, not a backlog item
to squeeze into 2B.

A setting selects which Denizen dialect the workspace targets:
- **Default Denizen** — upstream behaviour, what everything built so far assumes.
- **DenizenM (Energobro)** — a fork with modified tags and commands.

Two distinct pieces of work fall out of this:

**a) Dialect-aware meta.** DenizenM changes tags and other meta, so the loaded meta set has to differ per
dialect. Worth checking whether this collapses into the existing `denizenscript.server.extra_sources`
mechanism (an extra meta source layered on top) or genuinely needs a separate/replacement source set —
that decision shapes everything else. `MetaExtension` merge semantics already append rather than
overwrite, which may or may not be what a dialect override wants.

**b) `async` block thread-safety diagnostics.** DenizenM adds an `async` block inside scripts. Commands
and tags used inside it must be thread-safe, and the owner will supply the list of what is and is not
safe. The server must detect the enclosing `async` block and flag any non-thread-safe tag or command
used within it.

Notes for whoever plans this:
- The detection half lands naturally on top of Phase 2C's `ScriptChecker`, which already walks commands
  with their line/char positions and already has a warning-emission path (`Warn(...)` into
  `Errors`/`Warnings`/`MinorWarnings`, surfaced through `DiagnosticProvider`). Do NOT build a second
  parallel checker for this — wait for 2C and add a rule.
- Block-scope tracking is the new part: `ScriptChecker` currently walks a flat command list per key;
  knowing "am I inside an `async` block" needs the nesting context that `checkAsScript` already
  recurses through, so the hook point exists.
- The safe/unsafe list should be data, not code — a file the owner can edit without a rebuild, in the
  same spirit as the meta sources.
- Interaction to settle early: does the dialect switch also change which hardcoded/legacy behaviour
  applies, and does it interact with `denizenscript.server.engine`? Two orthogonal switches could get
  confusing fast.

## Deferred minors from Phase 2A reviews

Triaged by the final whole-branch review as defer-to-2B:

- **Slash-mangled `raw` in command arguments.** `(instantly/local)` becomes `'(instantly'` / `'local)'`
  because `/`→space happens before the split. Measured on real meta: **178 of 905** argument forms have
  unbalanced parens, rendered directly as completion `detail` text. Faithful to C#
  (`MetaCommand.cs:68-71`), fixed by one strip.
- **`triggerCharacters`.** Currently `['-', ' ', ':']`. C# `InitializationService.cs:34` uses `" .=<[;"`.
  `.`, `<`, `[` are mandatory for 2B or tag completion will not auto-trigger.
- **`.dsc` guard** uses raw `uri.endsWith('.dsc')`; C# uses `Uri.AbsolutePath.EndsWith`. Diverges for
  virtual/diff URIs carrying a query string. Fix alongside the `didChangeConfiguration` work.
- **`resolveProvider: false`** with eager `documentation`: measured **236 KB / 184 items** per `- ` typed.
  C# is equally eager, so not a regression — but `resolveProvider: true` + a `completionItem/resolve`
  handler is the obvious cleanup.
- **`hoverProvider.ts:50`** upper bound is inclusive, so hovering the space right after a command name
  still shows the tooltip. C# suppresses hover on a space (`TextDocumentService.cs:70`).
- **`parseSyntax()` called from `addTo`** where C# calls it from `PostCheck` (`MetaCommand.cs:147`).
  Move it when 2B introduces a post-check phase.
- **`describeTag`/`describeEvent`/`describeMech`/`describeAction` untested** — add tests in the task
  that first calls them.
- **No test for a colon-bearing or quoted in-progress argument** — write it as the first test of the
  `ByCommand` completer task.
- **No coverage of the `onCompletion`/`onHover` guard/try-catch branches** — needs an LSP integration
  harness, not a mock.
- **`NameForms` / `HasMultipleNames` / `MetaAction.RegexMatcher`** alternate-name registration still not
  ported (deferred all the way from Phase 1). Tag and action lookup in 2B will miss without it.

## Architectural decision to make before 2B starts

The final review flagged this as the thing that will cost real money:

In C#, hover is **derived from** completion — `GetHoverAt` (`TextDocumentService.cs:95-118`) calls
`GetCompletionsFor` and matches a returned label backwards from the cursor. There is no command branch
in `GetHoverAt` at all. Phase 2A instead gave `hoverProvider.ts` its own cursor parser, duplicating
logic in `completionProvider.ts` and re-deriving `trimmed`/`indent` that `lineContext.ts` already models.

Cheap today. Expensive in 2B: the tag-position parser in `GetCompletionsFor`
(`TextDocumentService.cs:421-558`) is ~140 lines of bracket/quote/subtag depth counting. Under the C#
shape you write it once and hover works free. Under the current shape you write it twice and they drift.

Recommended: extract a shared `parseCursorContext(line, column)` consumed by both providers, and have
`getFullLine` return `{ line, startOfLine, trimmed, indent }` so `hoverProvider.ts:34-36` disappears.
Do this BEFORE the tag work, not after.

Also: `hoverProvider.ts:2-3` claims it ports "the command and `type:` branches of `GetHoverAt`". There is
no command branch in `GetHoverAt` — that comment should be corrected to say it is a re-derivation.

## Remaining Phase 2 scope (unchanged from the original split)

- **2B** — tag infrastructure: `TagHelper`/`SingleTag`/`TagTracer`, `ExtraData` enums, `EventTools`,
  `ScriptEventCouldMatcher`; tag/mechanism/event completion and hover; honour `do_hover_docs` /
  `do_tab_completes` via `didChangeConfiguration`.
- **2C** — `ScriptChecker` (2038 lines) + `MixedKnowledgeSet` + `ScriptCheckerCommandSpecifics` +
  `DiagnosticProvider`; disable checks on `data` containers per the owner's requirement.
- **2D** — `WorkspaceTracker`; script container name memory; flag memory feeding completions.
