# Refined-DenizenScript

Syntax highlighting, completion, hover and diagnostics for **Denizen scripts** in Visual Studio Code.

A fork of [DenizenVSCode](https://github.com/DenizenScript/DenizenVSCode) by **McMonkey** and the **DenizenTeam**, maintained independently with extra features and fixes.

---

## Install

1. Download the latest `.vsix` from the releases page.
2. In VS Code press `Ctrl+Shift+X` → `···` menu → **Install from VSIX…** → pick the file.

You'll be notified when a new release is out. To check manually: `Ctrl+Shift+P` → `Refined denizen: Check for updates`.

---

## Features

### DenizenM
Autocomplete and hover docs for DenizenM text-formatting tags and events.
→ [DenizenM](https://github.com/Energobro/DenizenM-Tjtoxshpilivili1)

### Denizen-Utilities
- `dialog` snippet for scaffolding a dialog container.
- Autocomplete for `<context.KEY>` values, read from `inputs.*.key` in the surrounding dialog container.

→ [Denizen-Utilities](https://modrinth.com/project/denizen-utilities)

### Escaped symbol helper
- Select text and press `/` to convert Denizen special characters into escape codes.
- Type a delimited value like `/[]/` to turn it into `<&lb><&rb>`.
- Press Backspace right after a conversion to undo it back to the original `/…/` text.

### Workspace completion
- Local `- define` names offered inside `<[...]>`.
- Tracked player and server flags, kept separate so they don't mix in suggestions.
- Indexed across your whole open folder, not just the current file.

### Syntax highlighting
Custom colour containers from your Denizen `config.yml` are parsed and applied where possible.

### Workflow tools
- Explorer commands for creating Denizen script categories and files.
- Automatic `.dsc` extension handling for files created under `denizen/script`.
- Mute diagnostics over a selected range — `Refined DenizenScript: Mute Diagnostics in Selection`.
- `##ignorewarning <key>` at the top of a file silences one check for that file.

---

## Fixes

Things this fork corrects that the original gets wrong:

- **`type: dialog` containers are recognised.** Previously every dialog container was reported as an unknown script type — a red error on perfectly valid scripts.
- **Squiggles land on the text, not the indentation.** Three separate cases where a warning underlined the leading whitespace instead of the thing it was complaining about, including one where a capitalised key produced a broken range.
- **Colour-code warnings report on the right line.** `§` used for colour codes was previously reported on the wrong line when a command spanned several lines, and was missed entirely when it appeared on a continuation line.

---

## Language server

Two engines ship with the extension, picked with the `denizenscript.server.engine` setting:

- **`csharp`** *(default)* — the original .NET server. Complete and stable. Needs the .NET 8 runtime.
- **`typescript`** — an in-progress rewrite with no .NET dependency and a faster start. Completion, hover and most script diagnostics work; **tag and command checking isn't finished**, so it reports less than the C# engine. Try it if you want, but the default is the safe choice.

---

## Contributing

Open source, free for everyone to use and contribute to. If you make changes that could benefit the community, please contribute them upstream to [DenizenVSCode](https://github.com/DenizenScript/DenizenVSCode).

---

## License

MIT.

- Original project — Copyright (c) 2019-2025 The Denizen Scripting Team — [LICENSE.txt](LICENSE.txt)
- This fork — Copyright (c) 2026 Humususus
- Ported third-party code — [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
