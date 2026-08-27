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

## Features

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

### Third-party add-on support
Add-ons like [DenizenM](https://github.com/Energobro/DenizenM-Tjtoxshpilivili1), BetterModel or DiscordSRV are supported by loading their own meta documentation, not by a built-in list. Point `denizenscript.server.extra_sources` at their meta `.zip` archives and their commands, tags, mechanisms and events become first-class: real completion, real hover, and no false "unknown command" diagnostics.

This replaced a hardcoded table of a few dozen entries. The table could only guess — it offered every entry at every position regardless of what object preceded it, and suppressed diagnostics by matching words as generic as `teleport` and `async`, which silently hid real errors.

### Denizen-Utilities support
- `dialog` snippet for scaffolding a dialog container.
- Completion for `<context.KEY>` values, read from `inputs.*.key` in the surrounding dialog container.
- Dialog containers are excluded from the diagnostics that don't apply to them.

→ [Denizen-Utilities](https://modrinth.com/project/denizen-utilities)

### Workspace completion
- Local `- define` names offered inside `<[...]>`.
- Player and server flags, kept in **separate** indexes so they never mix in suggestions.
- Indexed across the whole open folder, not just the current file (`denizenscript.behaviors.track_full_workspace`).

### Syntax highlighting and inline colours
- Custom colour containers from your Denizen `config.yml` are parsed and applied where possible.
- Inline colour rendering for colour tags (`denizenscript.behaviors.do_inline_colors`), with an option for very dark colours (`display_dark_colors`).
- Uses your active VS Code theme by default; the legacy DenizenScript palette is available via `denizenscript.behaviors.use_custom_syntax_colors`.

### Script scaffolding
- **`Refined DenizenScript: Create Category`** — <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> then <kbd>C</kbd>
- **`Refined DenizenScript: Create Script File`** — <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> then <kbd>F</kbd>
- Automatic `.dsc` extension handling for files created under `denizen/script`.

### Extra meta sources
Load documentation for your own add-ons alongside the official Denizen meta — `denizenscript.extra_sources` (C# engine) or `denizenscript.server.extra_sources` (TypeScript engine), as direct `.zip` URLs.

---

## Fixes

Defects this fork corrects that the original gets wrong:

- **`type: dialog` containers are recognised.** Previously every dialog container was reported as an unknown script type — a red error on perfectly valid scripts.
- **Squiggles land on the text, not the indentation.** Three separate cases where a warning underlined the leading whitespace instead of the thing it complained about, including one where a capitalised key produced a broken range.
- **Colour-code warnings report on the right line.** `§` used for colour codes was reported on the wrong line when a command spanned several lines, and missed entirely when it appeared on a continuation line.

---

## Language server

Two engines ship with the extension, picked with `denizenscript.server.engine`:

- **`csharp`** *(default)* — the original .NET server. Complete and stable. Needs the .NET 8 runtime.
- **`typescript`** — an in-progress rewrite with no .NET dependency and a faster start. Completion, hover and most script diagnostics work; **tag and command checking isn't finished**, so it reports less than the C# engine. The default is the safe choice.

---

## For developers

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

```bash
npm run package
```

### Current state

The TypeScript language server is a **faithful port** of `SharpDenizenTools`, not a reimplementation. The C# is treated as the specification, warts included: behaviours that look like bugs are ported verbatim and marked `C# QUIRK` in the source. Where the port knowingly disagrees, the site is marked `DELIBERATE DEVIATION` and the reason recorded.

| | |
|---|---|
| Unit tests | **704 passing**, 31 files |
| End-to-end verification | **10 scripts**, all passing against live meta |
| TypeScript compile | clean |

**Done:** meta loading and linking · command, argument, tag and tag-parameter completion · tag tracing · hover · 23 diagnostics across three layers (line-level checks, container structure, container validity).

**In progress:** tag and command checking — the layer that reports an undefined `<[definition]>` or a garbage tag. The pieces are ported and tested; connecting them needs the container walker.

**Not started:** event validation · tag hover and deprecation warnings · cross-file workspace analysis · YAML validation (deliberately — the rewrite takes no YAML dependency, and the hand-written structure parser covers most of what it caught).

Every test names the mutant it catches, and each task ends with a mutation audit that proves it does. That standard exists because nine tests across one phase named a mutant they did not actually catch — every one found by auditing, none by review.

---

## Contributing

Open source, free for everyone to use and contribute to. If you make changes that could benefit the community, please contribute them upstream to [DenizenVSCode](https://github.com/DenizenScript/DenizenVSCode).

---

## License

MIT.

- Original project — Copyright (c) 2019-2025 The Denizen Scripting Team — [LICENSE.txt](LICENSE.txt)
- This fork — Copyright (c) 2026 Humususus
- Ported third-party code — [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
