# Changelog

## 2.0.2

### Fixes

- `<` and `>` no longer auto-close as a bracket pair, and no longer drive VS Code's native
  bracket-match/colourisation. Denizen reuses them as comparison operators in every `- if`/
  `- while` condition, so treating them as a guaranteed-balanced pair was unsound on top of the
  2.0.1 grammar fix: typing a lone `<` for a less-than check auto-inserted a `>` right after it,
  and a `<`/`<=` with no balancing `>` on the same line threw off VS Code's own bracket counter for
  the rest of the document -- changing the colour of unrelated `[...]` brackets and operators
  further down the file, and making `==`, `<=`, `>=` and `>` render as different colours from each
  other even though they carry the same syntax scope. `<`/`>` now colour consistently, from the
  grammar alone.

## 2.0.1

### Fixes

- A comparison `<` (as in `- if <[start]> < true:`) no longer breaks syntax highlighting on every
  line below it. The tag-highlighting rule read a bare `<` as the start of a new tag and stayed
  "open" hunting for a `>` until one turned up somewhere later in the file; `<=` had the same
  problem. Both now require an actual tag to start (a letter, `&`, or `[`) before highlighting
  begins.

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
