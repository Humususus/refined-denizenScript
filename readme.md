<img width="840" height="180" alt="Frame 1" src="https://github.com/user-attachments/assets/4b738eed-b730-4b1e-8dd6-f44b8dfa4510" />


# Refined-DenizenScript

Syntax highlighting, completion, hover and diagnostics for **Denizen scripts** in Visual Studio Code.

A fork of [DenizenVSCode](https://github.com/DenizenScript/DenizenVSCode) by **McMonkey** and the **DenizenTeam**, maintained independently with extra features and fixes.

---

## Install

1. Download the latest `.vsix` from the releases page.
2. In VS Code press `Ctrl+Shift+X` → `···` menu → **Install from VSIX…** → pick the file.

You'll be notified when a new release is out. To check manually: `Ctrl+Shift+P` → `Refined denizen: Check for updates`.

Auto-checking is configurable — `refinedDenizenscript.update.autoCheck` and `refinedDenizenscript.update.checkIntervalHours`.

---
<img width="840" height="180" alt="Frame 12" src="https://github.com/user-attachments/assets/c17cf3b7-5200-48ed-b466-8b6841cf191e" />

### File and folder icons
A **DenizenScript Icons** file icon theme, with distinct icons for `.dsc` files and for 28 recognised Denizen folder names — `handlers`, `data`, `dialogs`, `utils`, `worlds`, `commands`, `entities`, `tasks`, `animations`, `extensions` and more, including their singular/plural spellings.

Enable it with `Ctrl+Shift+P` → `Preferences: File Icon Theme` → **DenizenScript Icons**.

### Mute diagnostics
Silence warnings you don't want without touching the script:

- **`Refined DenizenScript: Mute Diagnostics in Selection`** — select a range and mute everything reported inside it.
- **`Refined DenizenScript: Unmute Diagnostics`** — undo it.
- `##ignorewarning <key>` at the top of a file silences one specific check for that whole file.

### Escaped symbol helper
- Select text and press <kbd>/</kbd> to convert Denizen special characters into escape codes.
- Type a delimited value like `/[]/` to turn it into `<&lb><&rb>`.
- Press <kbd>Backspace</kbd> right after a conversion to undo it back to the original `/…/` text.

### Automatic tag separators
Pressing <kbd>Space</kbd> directly inside `<map[…]>` inserts `;`, and inside `<list[…]>` inserts `|`. It fires nowhere else, a quoted value inside the parameters suppresses it, one <kbd>Backspace</kbd> turns the separator back into a plain space, and `denizenscript.autoInsertTagSeparators` switches it off.

### DenizenM support
Completion and hover documentation for [DenizenM](https://github.com/Energobro/DenizenM-Tjtoxshpilivili1) — escape tags, base tags, dot tags, commands, command arguments and events. DenizenM syntax is also excluded from diagnostics, so the base Denizen checker doesn't flag it as invalid.

### Denizen-Utilities support
- `dialog` snippet for scaffolding a dialog container.
- Completion for `<context.KEY>` values, read from `inputs.*.key` in the surrounding dialog container.
- Dialog containers are excluded from the diagnostics that don't apply to them.

→ [Denizen-Utilities](https://modrinth.com/project/denizen-utilities)

### Workspace completion
- Local `- define` names offered inside `<[...]>`.
- Player and server flags, kept in **separate** indexes so they never mix in suggestions.
- Indexed across the whole open folder, not just the current file (`denizenscript.behaviors.track_full_workspace`).

### Completion in the places that used to offer nothing
Each of these was an empty suggestion list before:

- **`<entry[123].…>`** — the sub-tags of the command that wrote the `save:`, narrowed to that command. Entry tags are documented per command, so they are absent from the tag index entirely.
- **Event lines** under a world container's `events:` key, with the `on `/`after ` prefix handled and `<block>`-style placeholders turned into tabstops.
- **Event switch values** — `bukkit_priority:`, `cancelled:` and `ignorecancelled:`. Only these three: the rest take flag names, permissions, areas and numbers, where there is no list to offer.
- **Implicit definitions** — `<[value]>`, `<[loop_index]>`, your own `as:`/`key:` names inside a loop, and `<[filter_value]>` / `<[parse_value]>` inside the tag that provides them.
- **`<map[…]>` keys** and mechanism names in `- adjust`, read from the meta rather than a hand-kept list.
- **`as[…]`** — object type names in the short form, which is what the 23 deprecated `as_*` tags point at.
- **`filter[…]`, `parse[…]`, `sort_by_value[…]`** and friends — the tag path applied to each entry, written without its `<>`.
- **`<custom_color_name>`** — the colour names from your own Denizen colour map.

> The first four work on both engines. The last four read the meta through the language server, so they need the TypeScript engine.

### Quick Fixes
Lightbulb actions, offered only where the checker already reports something and its message already names the edit:

- Add a missing `:` or `- ` to a line that needs one, including `- if true == false` with no trailing colon.
- **Rewrite a deprecated tag** — `as_entity` → `as[entity]`. Offered for the 24 tags whose deprecation names a single, unambiguous replacement, and deliberately withheld for the rest rather than guessing at a rewrite that would lose your arguments.

### Go to definition
<kbd>F12</kbd> on a flag jumps to where it is set; on a script name, to the container that defines it.

### Inline argument hints
Grey text at the end of the line you are editing, showing the arguments the command still accepts. Only the caret's line is annotated (`denizenscript.inlineArgumentHints`).

To see them **on demand only**, leave the setting on and set `editor.inlayHints.enabled` to `offUnlessPressed` — the hint then appears while you hold <kbd>Ctrl</kbd>+<kbd>Alt</kbd>.

> Needs the TypeScript engine. The C# engine has no signature help, so nothing is shown there.

### Offline math
Hovering an arithmetic tag such as `<element[1].sub[<element[2].mul[3]>]>` shows what it works out to, without a server (`denizenscript.evaluateMathTags`).

Anything the server would have to answer — definitions, flags, `<player.…>` — is listed as a value to supply rather than guessed at; **`Refined DenizenScript: Evaluate Math Tag`** asks for those and shows the result. A result that is not exactly representable is labelled as rounded.

### Long map and list tags
A clickable **Expand tag** lens above any line holding a multi-entry `<map[…]>` or `<list[…]>` opens it formatted across several lines. The expanded view is editable and writes back as a single line — the file never holds the multi-line form, which Denizen's parser would reject (`refinedDenizenscript.mapTag.showExpandLens`).

### Syntax highlighting and inline colours
- Custom colour containers from your Denizen `config.yml` are parsed and applied where possible.
- Inline colour rendering for colour tags (`denizenscript.behaviors.do_inline_colors`), with an option for very dark colours (`display_dark_colors`).
- **A colour picker on hex colours** — a swatch beside `<&color[#2596be]>` opens VS Code's own picker, and both the `#RRGGBB` and `#RRGGBBAA` forms are handled. Only inside a tag, and never on a commented-out line.
- Prefixed arguments are coloured too, not just the command name.
- Uses your active VS Code theme by default; the legacy DenizenScript palette is available via `denizenscript.behaviors.use_custom_syntax_colors`.

### Script scaffolding
- **`Refined DenizenScript: Create Category`** — <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> then <kbd>C</kbd>
- **`Refined DenizenScript: Create Script File`** — <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> then <kbd>F</kbd>
- Automatic `.dsc` extension handling for files created under `denizen/script`.

### Extra meta sources
Load documentation for your own add-ons alongside the official Denizen meta — `denizenscript.extra_sources` (C# engine) or `denizenscript.server.extra_sources` (TypeScript engine), as direct `.zip` URLs.

---
<img width="840" height="180" alt="Frame 13" src="https://github.com/user-attachments/assets/43a32c99-4ebe-46ac-a522-2a5ca475ddc9" />


Defects this fork corrects that the original gets wrong:

- **Squiggles land on the text, not the indentation.** Three separate cases where a warning underlined the leading whitespace instead of the thing it complained about, including one where a capitalised key produced a broken range.
- **Colour-code warnings report on the right line.** `§` used for colour codes was reported on the wrong line when a command spanned several lines, and missed entirely when it appeared on a continuation line.

---

## Language server

Two engines ship with the extension, picked with `denizenscript.server.engine`:

- **`typescript`** *(default)* — no .NET dependency, faster start. Completion, hover and most script diagnostics work; **tag and command checking isn't finished**, so it still reports less than the C# engine — a bad tag or an undefined `<[definition]>` can go unreported, and there's no event completion, tag hover, deprecation warnings, or cross-file analysis.
- **`csharp`** — the original .NET server. Complete and stable, at the cost of the .NET 8 runtime. Switch to this if you hit a gap the TypeScript engine hasn't caught up on yet.

---
<img width="840" height="180" alt="Frame 15" src="https://github.com/user-attachments/assets/e778841e-7e34-44f5-a2eb-70fb6b682b7e" />

### Setup

```bash
npm install
```

### Build

```bash
node node_modules/typescript/bin/tsc -p ./ --skipLibCheck
```

> Don't use `npm run compile` to verify a build — on some setups it exits 0 without writing anything, even when the code is broken. Invoke the compiler directly and check the exit code; it prints nothing on success.

The compiled output in `out/` is **committed to the repository** and is what actually ships in the VSIX. After changing anything in `src/`, rebuild and commit `out/` too, or the change won't reach users.

### Test

```bash
node node_modules/vitest/vitest.mjs run
```

Use this rather than `npx vitest`, which can swallow the output.

`scripts/verify-phase*.js` are end-to-end checks that download real Denizen meta and drive the server the way it runs in production. Run them after any language-server change:

```bash
node scripts/verify-phase2c3.js
```

Each prints `ALL CHECKS PASSED` or a list of failures.

### Package

Builds the shareable `.vsix` — compiles, runs the tests, then packages:

```bash
node scripts/build-vsix.js
```

`npm run package` does the same thing. Prefer the `node` form: on some setups `npm run` starts the child process and it produces nothing, which is how a broken build once got packaged silently.

The result is `refined-denizenscript-<version>.vsix` in this folder, about 2 MB. Install it with `Ctrl+Shift+X` → `···` → **Install from VSIX…**, or `code --install-extension refined-denizenscript-<version>.vsix`.

Add `--fast` to skip the tests.

> If `npm install` fails with `ERESOLVE`, you are on a checkout from before 2026-09-02 — the `@types/node` conflict behind it is fixed. Pull, or use `npm install --legacy-peer-deps` once.

### Current state

The TypeScript language server is a **faithful port** of `SharpDenizenTools`, not a reimplementation. The C# is treated as the specification, warts included: behaviours that look like bugs are ported verbatim and marked `C# QUIRK` in the source. Where the port knowingly disagrees, the site is marked `DELIBERATE DEVIATION` and the reason recorded.

| | |
|---|---|
| Unit tests | **1553 passing**, 52 files |
| End-to-end verification | **21 scripts**, all passing against live meta |
| TypeScript compile | clean |


---
<img width="840" height="180" alt="Frame 16" src="https://github.com/user-attachments/assets/5e41cb33-1037-455e-bf23-096ee98cba2f" />

Open source, free for everyone to use and contribute to. If you make changes that could benefit the community, please contribute them upstream to [DenizenVSCode](https://github.com/DenizenScript/DenizenVSCode).

---
<img width="840" height="180" alt="Frame 14" src="https://github.com/user-attachments/assets/fac5372a-2ebb-4d94-a021-b8ba056cbdb5" />

MIT.

- Original project — Copyright (c) 2019-2025 The Denizen Scripting Team — [LICENSE.txt](https://github.com/Humususus/refined-denizenScript/blob/main/LICENSE.txt)
- This fork — Copyright (c) 2026 Humususus
- Ported third-party code — [THIRD_PARTY_NOTICES.md](https://github.com/Humususus/refined-denizenScript/blob/main/THIRD_PARTY_NOTICES.md)
