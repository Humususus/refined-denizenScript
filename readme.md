# Refined-DenizenScript

A fork of [DenizenVSCode](https://github.com/DenizenScript/DenizenVSCode) — syntax highlighting, completion, hover and diagnostics for **Denizen scripts** in Visual Studio Code.

Original project by **McMonkey** and the **DenizenTeam**. This fork is maintained independently and adds usability features, third-party integrations, and an in-progress TypeScript rewrite of the language server.

**Version:** 1.4.11 · **License:** MIT

---

## Install

1. Download the latest `.vsix` from the releases page.
2. In VS Code press `Ctrl+Shift+X`, click the `···` menu, choose **Install from VSIX…**, and pick the file.

The extension notifies you when a new release is available. To check manually: `Ctrl+Shift+P` → `Refined denizen: Check for updates`.

---

## What this fork adds

### DenizenM support
Autocomplete and hover documentation for DenizenM text-formatting tags and events. → [DenizenM](https://github.com/Energobro/DenizenM-Tjtoxshpilivili1)

### Denizen-Utilities support
- A `dialog` snippet for scaffolding a dialog container.
- Autocomplete for `<context.KEY>` values, read from `inputs.*.key` in the surrounding dialog container.

→ [Denizen-Utilities](https://modrinth.com/project/denizen-utilities)

### Escaped symbol helper
- Select text and press `/` to convert Denizen special characters into escape codes.
- Type a delimited value like `/[]/` to turn it into `<&lb><&rb>`.
- Press Backspace immediately after a conversion to undo it back to the original `/…/` text.

### Syntax highlighting
Custom colour containers from your Denizen `config.yml` are parsed and applied where possible.

### Workflow tools
- Explorer commands for creating Denizen script categories and files.
- Automatic `.dsc` extension handling for files created under `denizen/script`.
- Workspace-wide completion for local `- define` names and tracked player/server flags.
- Mute diagnostics over a selected range (`Refined DenizenScript: Mute Diagnostics in Selection`).

---

## Language server engines

The extension ships **two** language server implementations, selected by the `denizenscript.server.engine` setting:

| Value | What it is |
|---|---|
| `csharp` *(default)* | The original .NET language server. Complete and stable. Requires the .NET 8 runtime. |
| `typescript` | An in-progress rewrite in TypeScript. No .NET dependency. Faster to start, but **not yet feature-complete**. |

The C# engine is the default and its behaviour is unchanged by this fork. Switch engines only if you want to try the rewrite.

---

## TypeScript rewrite: current status

The rewrite is a **faithful port** of `SharpDenizenTools`, not a reimplementation. The C# is treated as the specification, warts included: behaviours that look like bugs are ported verbatim and marked `C# QUIRK` in the source, so the two engines stay diffable. Where the port knowingly disagrees with the C#, the site is marked `DELIBERATE DEVIATION` and the reason is recorded.

**Current state:** 704 unit tests across 31 files, 10 end-to-end verification scripts that run against live Denizen meta, TypeScript compiling clean.

### Working on the `typescript` engine

**Completion**
- Command names and command arguments.
- Argument values from Minecraft enums — sounds, materials, entity types, statistics and more.
- Tag bases and tag parts, narrowed to the preceding part's return type (disable with `denizenscript.server.tagTracing`).
- Tag parameters inside `[...]` — documented enums, mechanism names, `mechanism=value` pairs, and documented option lists.

**Hover** for commands and container types.

**Diagnostics — 23 checks, in three layers:**

*Line level:* raw tabs, `{ braced }` syntax, old `<def[...]>` syntax, useless/invalid lines, stray end-of-line spaces, TODO comments, the `§` symbol misused for colour codes.

*Container structure:* duplicate keys, duplicate script names, empty sections, empty command sections, and nine distinct spacing and line-shape problems.

*Container validity:* containers with no content, containers with no `type` key, and unknown container types.

`##ignorewarning <key>` at the top of a file suppresses a check for that file.

### Not there yet

- **Tag and command checking.** `<[undefined_def]>` and garbage tags like `<player.nonsense>` are **not** diagnosed. The machinery is ported and tested but not yet connected — it needs the container walker, which is the next phase.
- **Event line completion and validation.**
- **Tag hover** and tag deprecation warnings.
- **Cross-file workspace analysis.** Script names, and definitions injected from other files, are not resolved.
- **YAML validation.** The C# engine uses YamlDotNet for this; the rewrite has no YAML dependency by design, and the hand-written structure parser covers most of what it caught.

Because of the above, **the C# engine still reports strictly more problems than the TypeScript one.**

### Notable fixes the rewrite makes

Four defects in the original C# were corrected rather than reproduced, each after an explicit decision:

- Diagnostics that pointed at a line's indentation instead of at the offending text (three separate cases, including one where a capitalised key produced a negative column).
- A colour-code warning that reported on the wrong line, and another that was swallowed entirely.
- **`dialog` containers are recognised.** The C# type table predates them, so every `type: dialog` container was reported as an unknown type — an error on perfectly valid scripts.

---

## Building from source

**Requirements:** Node.js and npm; VS Code; .NET 8 runtime (only for the `csharp` engine).

```bash
npm install
```

### Compiling

> **Do not use `npm run compile` to verify a build.** On some setups it exits 0 without writing anything, even when the code is broken. Invoke the compiler directly:

```bash
node node_modules/typescript/bin/tsc -p ./ --skipLibCheck
```

It prints nothing on success; check the exit code.

The compiled output in `out/` is **committed to the repository** — it is what actually ships in the VSIX. After changing anything in `src/`, rebuild and commit `out/` as well, or the change will not reach users.

### Testing

```bash
node node_modules/vitest/vitest.mjs run
```

Use this rather than `npx vitest`, which can swallow the output.

The `scripts/verify-phase*.js` scripts are end-to-end checks that download real Denizen meta and exercise the server the way it runs in production. Run them after any change to the language server:

```bash
node scripts/verify-phase2c3.js
```

Each prints `ALL CHECKS PASSED` or a list of failures.

### Packaging

```bash
npm run package
```

Produces `refined-denizenscript-1.4.11.vsix`.

---

## Contributing

This is an open-source project, provided freely for everyone to use and contribute to. If you make changes that could benefit the community as a whole, please contribute them upstream to [DenizenVSCode](https://github.com/DenizenScript/DenizenVSCode).

---

## License

MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the licensing of ported third-party code (the TypeScript language server).

Copyright (c) 2026 Humususus

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
