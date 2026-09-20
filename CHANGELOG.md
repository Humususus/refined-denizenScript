# Changelog

## 2.3.0

### New features

- **Script names complete on `- run`.** Typing `- run ` now offers the script containers in the
  workspace, each labelled with its type and file. Filtered to the types a run-like command can
  execute — `task`, `procedure`, `command` — so items, inventories and worlds stay out of the list;
  a container whose `type:` could not be read is still offered rather than hidden. Covers `run`,
  `runlater`, `inject`, `clickable` and `bungeerun`. TypeScript engine only: the C# server already
  answers this, and registering both would list every script twice.

- **Script definitions on `- run`.** Hovering the script name lists the definitions that script
  declares in its `definitions:` key, with the `[square bracket]` documentation beside each name.
  Typing past the name offers the matching `def.` arguments: one suggestion that fills the whole
  line at once, plus one per name. Names already on the line are not offered again. Covers `run`,
  `runlater`, `clickable` and `bungeerun` — not `inject`, which shares the current queue and takes
  no `def` arguments.

### Fixes

- **`<[definitionName]>` hover listed assignments from every container in the file.** A definition
  is queue-scoped, so a `- define hook` in an unrelated container is a different variable that
  happens to share a name. The hover is now scoped to the enclosing container. Measured on real
  scripts: 11 definitions across the test corpus were showing values from containers they have
  nothing to do with.
- **That hover also listed every assignment at once**, filling the popup with lines that were not
  being asked about. It now shows the one that answers the question — the closest `- define` at or
  above the hovered line — with its line number, noting how many others the container holds.
- **That hover did not fire on `<[ent].some.tags>`**, only on a bare `<[ent]>`. The pattern
  required the `]>` to be adjacent, and reading anything off the definition puts a `.` there
  instead — so it went silent on the commoner of the two forms.

## 2.2.0

### New features

- **Async-safety diagnostics.** A command or tag inside a DenizenM `- async:` block that isn't
  safe off the main thread is now reported — it still runs, but Denizen hands it back to the main
  thread and the async queue waits on it, which is usually the opposite of what the block was
  written for. The lists come from DenizenM's own machine-readable `@asyncsave` / `@asynccmd`
  markings, so `narrate` and `playsound` stay quiet (they run async or defer cleanly) while
  `teleport` and `<player.health>` are flagged. Silenced per file with
  `##ignorewarning async_unsafe_command` / `async_unsafe_tag`.

  Two deliberate limits, both to avoid squiggling correct script: a tag is only reported when it
  resolves to exactly one documented type — `<[ent].location>` is ambiguous by nature and stays
  silent — and commands that Denizen can defer to the main thread without waiting (`compass`,
  `fakeequip`, `actionbar`) are treated as safe. The whole check switches itself off unless the
  loaded meta actually has the `async` command, so plain Denizen without the fork sees nothing new.

- **`playsound sound_category:` completion.** The ten Bukkit sound categories are now offered.
  The meta documents the argument but links out to a javadoc instead of listing the values, so
  they ship with the extension.

### Fixes

- Enum argument completion was case-sensitive, so an uppercase prefix matched nothing at all —
  `- playsound sound_category:MAST` and `- give QUAR` both completed to an empty list, and VS
  Code's own filtering couldn't recover because it only narrows what the server already sent.
  Denizen resolves these arguments case-insensitively, so uppercase input is valid script.

### Performance

- The workspace symbol index was rebuilt on **every keystroke**: two regexes over every line of
  the edited file, then a union of three sets across every indexed `.dsc` in the workspace, all on
  the extension host's thread. On a 4000-line script that was the main source of typing lag. It's
  now debounced by 300ms, which costs nothing in correctness — completion already re-indexes the
  active document before reading it.
- Document colour scanning is cached per document version. VS Code re-requests colours on
  decoration refreshes, focus changes and configuration changes; each of those used to be a fresh
  full-file scan.

## 2.1.1

### Fixes

- Typing an IME/dead-key composed character (reported: Vietnamese Telex "â", pressing "a" twice)
  showed the composed character and then deleted it. The `Backspace` key was bound for every
  `.dsc` file unconditionally, routing every Backspace press — including the ones an input method
  sends as part of composing a character — through this extension's async command handler before
  falling through to normal deletion, which desynchronised it from the composition. Backspace is
  now only ever intercepted in the narrow window right after this extension's own space→separator
  or `/`→escape conversion, via a `when`-clause context key rather than a check inside the command;
  every other Backspace, including all IME composition, now reaches VS Code's native handling
  exactly as if this extension were not installed.

## 2.1.0

### New features

- **Event hover.** Hovering an event line (`on player joins:`) now shows its description, trigger
  text and documented `<context.…>` values.
- **`<context.[...]>` completion narrowed to the enclosing event.** It used to fall through to
  every documented tag part (1871 of them); it now offers only the context names the enclosing
  event actually documents, walking up to the nearest `on `/`after ` line to find it.
- **Hover on `<[definitionName]>` shows what it was set to.** Every plain `- define name value`
  assignment of that name in the file is listed, each with its line number — not a guess at which
  one is "active", since that can vary by branch or loop iteration. Data-action forms
  (`name:->:value`, `name:!`) and dynamically-built names are left alone rather than misread.
- **The TypeScript engine is now the default**, not `csharp`. It still reports less overall — tag
  and command validation isn't wired up yet, and there's no event completion, tag hover,
  deprecation warnings, or cross-file analysis — but it needs no .NET runtime and starts faster.
  Switch back to `csharp` if you hit a gap it hasn't caught up on. The setting's own description
  was cut from over 1600 characters to a few lines; VS Code's settings UI was stalling on it.

### Fixes

- A tag parameter holding a whole nested tag (`filter_tag[<[filter_value].equals[x]>]`, the
  documented form for `filter_tag`/`parse_tag`) lost all highlighting from the point the nested tag
  closed onward — its `>` was being read as the OUTER tag's close. Tags can now nest correctly.
- Inline argument hints (`denizenscript.inlineArgumentHints`) no longer query signature help on the
  `csharp` engine. That engine doesn't implement it, and the request was failing outright rather
  than returning an empty response as assumed — which, combined with the editor's own
  default error-reveal behaviour, made the Output panel pop open and refill on every cursor move
  onto a command line. The request is no longer sent at all unless the TypeScript engine is running.

## 2.0.3

No functional change over 2.0.1's content. A 2.0.2 build briefly went out with a real regression
(auto-close on `<` stopped working); it was fixed and folded back into 2.0.1 as that version's
history, but version numbers can't go backwards for anyone who had already installed 2.0.2 — this
extension's own update checker and VS Code's own extension installer both compare version numbers,
and neither offers an "update" to a lower one. Re-released under 2.0.3, strictly above both, so the
update checker picks it up regardless of which of 2.0.0/2.0.1/2.0.2 someone is currently on.

## 2.0.1

### Fixes

- A comparison `<` (as in `- if <[start]> < true:`) no longer breaks syntax highlighting on every
  line below it. The tag-highlighting rule read a bare `<` as the start of a new tag and stayed
  "open" hunting for a `>` until one turned up somewhere later in the file; `<=` had the same
  problem. Both now require an actual tag to start (a letter, `&`, or `[`) before highlighting
  begins.
- A second, related bug in the same area: comparisons like `<element[true]> <= <element[123]>:`
  could shift the colour of unrelated `[...]` brackets and operators further down the file, and
  made `==`, `<=`, `>=` and `>` render as different colours from each other despite sharing the
  same syntax scope. This came from VS Code's own native bracket-pair matching, which -- unlike the
  grammar above -- has no way to tell a tag-opening `<` from a comparison `<` and was miscounting
  them across the whole document. `<`/`>` are no longer treated as a matched bracket pair for that
  purpose, so their colour now comes from the grammar alone, consistently. Typing `<` still
  auto-inserts a closing `>`, unchanged.

## 2.0.0

The major version marks the second language server: a TypeScript rewrite of the .NET one, selectable
with `denizenscript.server.engine`. The C# engine remains the default and is unchanged.

### Language server

- **A TypeScript engine with no .NET dependency and a faster start.** A faithful port of
  `SharpDenizenTools` rather than a reimplementation — where the original's behaviour looks like a
  bug it is ported verbatim and marked in the source, and every deliberate disagreement is recorded.
  Completion, hover and most script diagnostics work; tag and command checking is not finished, so
  it still reports less than the C# engine.
- Cross-file workspace checking: injects, script containers and tag parameters validated against
  the whole open folder rather than one file.

### New features

- **Go to definition** — <kbd>F12</kbd> on a flag jumps to where it is set, on a script name to the
  container that defines it.
- **Inline argument hints** — grey text showing the arguments the command still accepts, on the
  line you are editing. On demand with `editor.inlayHints.enabled: offUnlessPressed`.
- **Offline math** — arithmetic tags are evaluated locally on hover; the *Evaluate Math Tag*
  command asks for the values it cannot resolve instead of guessing them.
- **Colour picker** — a swatch beside a hex colour written inside a tag, opening VS Code's own
  picker. Both `#RRGGBB` and `#RRGGBBAA`.
- **Expand lens for long tags** — opens a multi-entry `<map[…]>` or `<list[…]>` formatted across
  several lines; editable, and written back as one line.
- **Automatic tag separators** — <kbd>Space</kbd> inside `<map[…]>` inserts `;`, inside `<list[…]>`
  inserts `|`. One <kbd>Backspace</kbd> undoes it.
- **Quick Fixes** — add a missing `:` or `- `, and rewrite a deprecated tag such as `as_entity` into
  `as[entity]`. The rewrite is offered only for the tags whose deprecation names a single
  unambiguous replacement.
- **Completion where there was none** — `<entry[123].…>` sub-tags, event lines and their switch
  values, `<map[…]>` keys and `- adjust` mechanisms, `as[…]` object types, the tag path inside
  `filter[…]` / `parse[…]` / `sort_by_value[…]`, the definitions a loop or filter tag puts in
  scope, and `<custom_color_name>` from your own colour map.
- **Mute diagnostics** in a selection or for a whole file, and an escaped-symbol helper.
- **File and folder icon theme** for `.dsc` and 28 recognised Denizen folder names.

### Fixes

- Squiggles land on the text rather than on the leading indentation, in three separate cases.
- `§` colour-code warnings report on the correct line of a multi-line command.
- `- ~narrate` and every other waitable command keeps its syntax highlighting.
- Snippets follow the editor's indent settings.
- An expired meta cache plus a dead network no longer leaves the server with no meta at all, and a
  partial download is refused rather than stored.
- An extra meta source reliably overrides the official meta it redefines.
