Refined-DenizenScript VS Code Extension
-------------------------------

This project is a **fork of DenizenVSCodeExtension**.

Original project:  
https://github.com/DenizenScript/DenizenVSCode

Original authors and ownership belong to **McMonkey** and the **DenizenTeam**.

This fork is maintained independently and may contain additional improvements, fixes, or experimental changes.

---

## 📖 About

DenizenScript VS Code Extension provides syntax highlighting, basic tooling, and development support for writing **Denizen scripts** inside Visual Studio Code.

This fork aims to improve usability and maintain compatibility while keeping the original project spirit.

---

## Features

This fork includes the original DenizenVSCode behavior plus additional usability features.

### DenizenM support

- Autocomplete and hover documentation for DenizenM text formatting tags and events:
- [To DenizenM](https://github.com/Energobro/DenizenM-Tjtoxshpilivili1)

### Denizen-Utilities support

- `dialog` snippet for quickly creating a dialog container fron Denizen-Utilities.
- Autocomplete for `<context.KEY>` values from `inputs.*.key` inside the current dialog container.
- [To Denizen-Utilities](https://modrinth.com/project/denizen-utilities)

### Syntax highlighting improvements

- Inline Denizen color tags are rendered in-editor, including examples like `<gold>`, `<&6>`, and `<#RRGGBB>`.
- Custom color containers from Denizen `config.yml` are parsed and applied when possible.

### Escaped symbol helper

- Select text and press `/` to convert Denizen special characters into escaped symbols.
- Type a delimited value like `/[]/` to convert it into `<&lb><&rb>`.
- Press Backspace immediately after an escape conversion to restore the original `/.../` text.

### Workflow tools

- Explorer commands for creating Denizen script categories and script files.
- Automatic `.dsc` extension handling for files created under `denizen/script`.
- Workspace completions for local defines and tracked player/server flags.
- Optional GitHub release update checks for this fork.

---

## 📥 Installation Guide

### Method 1: Install from `.vsix` file (Recommended)

1. **Download the extension file**
   - Download the latest `.vsix` file from the releases page.

2. **Install in VS Code**
   - Open **VS Code**
   - Press `Ctrl + Shift + X` to open the Extensions panel
   - Click the three dots (`···`) in the top-right corner
   - Select **Install from VSIX...**
   - Choose the downloaded `.vsix` file
   - Confirm installation

---

## 🔄 Updates

- The extension will automatically notify you when a new update is available.
- To manually check for updates:

`Ctrl + Shift + P`

Then search for:

`Refined denizen: Check for updates`

---

## 🤝 Contributing

This is an open-source project.

If you make improvements that could benefit the community, please consider contributing upstream.

---

# License

MIT License

Licensing pre-note:

This is an open source project, provided entirely freely, for everyone to use and contribute to.

If you make any changes that could benefit the community as a whole, please contribute upstream.

---

## Build

Use these steps to build the extension locally.

### Requirements

- Node.js and npm
- Visual Studio Code
- .NET 8 runtime, or the VS Code .NET Runtime extension

### Install dependencies

Run this from the extension directory:

```powershell
cd D:\vsi\denizenscript.denizenscript-1.4.9\extension
npm install
```

### Compile TypeScript

```powershell
npm run compile
```

This writes the compiled extension entry point to `out/extension.js`.

### Package VSIX

```powershell
npm run package
```

This runs the prepublish compile step and creates:

```text
refined-denizenscript-1.4.11.vsix
```

---

## The MIT License (MIT)

Copyright (c) 2026 Humususus

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS 
