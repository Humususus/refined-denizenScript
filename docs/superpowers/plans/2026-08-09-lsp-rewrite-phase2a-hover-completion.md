# Phase 2A: Hover & Command Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the TypeScript LSP server its first user-visible features — hover documentation and command/argument autocompletion driven by the real Denizen meta docs — and retire the hardcoded snippet list when the TypeScript engine is active.

**Architecture:** Four new pure-logic modules under `src/server/providers/` (markdown rendering, cursor-line extraction, completion, hover), each free of any `vscode` or `vscode-languageserver/node` import so they are unit-testable under vitest. `src/server/server.ts` keeps the loaded `MetaDocs` in a module-scoped variable, declares `completionProvider`/`hoverProvider` capabilities, and delegates to those modules. `src/extension.ts` gets one surgical guard so the legacy hardcoded completion/hover providers stay registered on the C# path but stand down on the TypeScript path.

**Tech Stack:** TypeScript 5.x, `vscode-languageserver` 9.x (bare entry point only — never `/node` in provider modules), vitest 3.x, Node 18+.

## Global Constraints

- Branch: `feature/typescript-lsp-rewrite`. Commit after every task. Do not merge or open a PR.
- **`npm run compile` silently no-ops on this machine — it exits 0, prints nothing, and writes no files even when the code is genuinely broken.** The ONLY accepted compile verification is `node node_modules/typescript/bin/tsc -p ./ --skipLibCheck`.
- **`npx vitest` swallows output on this machine.** The ONLY accepted test command is `node node_modules/vitest/vitest.mjs run`.
- Paste the real captured stdout of every verification command into your report. Never paraphrase, summarize, or reconstruct it. A report claiming "all tests passed" without genuine reporter output will be rejected.
- Every file under `src/server/providers/` MUST import only from `vscode-languageserver` (the bare entry), never `vscode-languageserver/node`, and never `vscode`. This is what keeps them loadable in vitest.
- The C# engine path must remain behaviourally identical. `denizenscript.server.engine` defaults to `"csharp"`; with that default, `activate()` must do exactly what it does today.
- Tests live next to their source as `<name>.test.ts` and are excluded from the tsc build by the existing `tsconfig.json` `exclude` entry `src/**/*.test.ts`. Do not modify `tsconfig.json`.
- Do not add npm dependencies. Everything needed is already installed.
- Meta object field names in this plan are exact — verify against `src/server/metaDocs/metaTypes.ts` before inventing any.

---

### Task 1: Command syntax argument parsing

Ports `SharpDenizenTools/MetaObjects/MetaCommand.cs::ParseSyntax`. Completion needs to know which arguments a command accepts; that information only exists inside the `@Syntax` line, so it must be parsed out.

**Files:**
- Modify: `src/server/metaDocs/metaTypes.ts` (class `MetaCommand`, around lines 103-165)
- Test: `src/server/metaDocs/metaTypes.test.ts` (append to the existing file)

**Interfaces:**
- Consumes: nothing from other Phase 2A tasks.
- Produces:
  - `export interface CommandArgumentForm { clean: string; raw: string; }`
  - `MetaCommand.argPrefixes: CommandArgumentForm[]`
  - `MetaCommand.flatArguments: CommandArgumentForm[]`
  - `MetaCommand.linearArguments: string[]`
  - `MetaCommand.parseSyntax(): void`

- [ ] **Step 1: Write the failing test**

Append to `src/server/metaDocs/metaTypes.test.ts`:

```ts
describe('MetaCommand.parseSyntax', () => {
    it('splits a realistic syntax line into prefixed, flat, and linear arguments', () => {
        const cmd = new MetaCommand();
        cmd.syntax = 'narrate [<text>] (targets:<player>|...) (format:<name>) (per_player)';
        cmd.parseSyntax();
        expect(cmd.argPrefixes.map(a => a.clean)).toEqual(['targets', 'format']);
        expect(cmd.flatArguments.map(a => a.clean)).toEqual(['per_player']);
        expect(cmd.linearArguments).toEqual(['[<text>]']);
    });

    it('keeps the original bracketed text as the raw form', () => {
        const cmd = new MetaCommand();
        cmd.syntax = 'narrate [<text>] (format:<name>)';
        cmd.parseSyntax();
        expect(cmd.argPrefixes[0].raw).toBe('(format:<name>)');
    });

    it('treats a slash as an argument separator', () => {
        const cmd = new MetaCommand();
        cmd.syntax = 'inject [<script>] (path:<name>) (instantly/local)';
        cmd.parseSyntax();
        expect(cmd.flatArguments.map(a => a.clean)).toEqual(['instantly', 'local']);
    });

    it('does not treat a tag-valued prefix as a prefix', () => {
        const cmd = new MetaCommand();
        cmd.syntax = 'test [<a>:<b>]';
        cmd.parseSyntax();
        expect(cmd.argPrefixes).toEqual([]);
        expect(cmd.linearArguments).toEqual(['[<a>:<b>]']);
    });

    it('produces empty results for a syntax line with no arguments', () => {
        const cmd = new MetaCommand();
        cmd.syntax = 'stop';
        cmd.parseSyntax();
        expect(cmd.argPrefixes).toEqual([]);
        expect(cmd.flatArguments).toEqual([]);
        expect(cmd.linearArguments).toEqual([]);
    });

    it('is invoked automatically by addTo', () => {
        const docs = createEmptyMetaDocs();
        const cmd = new MetaCommand();
        cmd.commandName = 'narrate';
        cmd.syntax = 'narrate [<text>] (format:<name>)';
        cmd.addTo(docs);
        expect(docs.commands.get('narrate')!.argPrefixes.map(a => a.clean)).toEqual(['format']);
    });
});
```

If `MetaCommand` and `createEmptyMetaDocs` are not already imported at the top of that test file, add them to the existing import statement from `./metaTypes`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run src/server/metaDocs/metaTypes.test.ts`
Expected: FAIL — `cmd.parseSyntax is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/server/metaDocs/metaTypes.ts`, add this interface immediately above `export class MetaCommand extends MetaObject {`:

```ts
/** One argument as it appears in a command's `@Syntax` line, in both bare and original form. */
export interface CommandArgumentForm {
    /** The argument name stripped of `[]`, `()`, and `{}` — e.g. `format` for `(format:<name>)`. */
    clean: string;
    /** The original syntax text, e.g. `(format:<name>)`. Used as completion detail text. */
    raw: string;
}
```

Inside `MetaCommand`, add these three fields next to the existing `guide` field:

```ts
    /** Arguments written as `prefix:<value>`. Populated by `parseSyntax`. */
    argPrefixes: CommandArgumentForm[] = [];
    /** Literal keyword arguments with no tag input. Populated by `parseSyntax`. */
    flatArguments: CommandArgumentForm[] = [];
    /** Positional arguments that take dynamic input. Populated by `parseSyntax`. */
    linearArguments: string[] = [];
```

Add this method to `MetaCommand` (place it directly above `addTo`):

```ts
    /**
     * Parses `syntax` into the three argument buckets used for completion.
     * Ported from SharpDenizenTools MetaCommand.ParseSyntax, with two deliberate
     * deviations: the C# original has a self-assignment bug on its LinearArguments
     * line (`LinearArguments = [.. LinearArguments]`), which this port fixes by
     * assigning the collected list; and a tag-valued prefix such as `[<a>:<b>]` is
     * recorded as a linear argument here rather than being dropped entirely.
     */
    parseSyntax(): void {
        this.argPrefixes = [];
        this.flatArguments = [];
        this.linearArguments = [];
        const firstSpace = this.syntax.indexOf(' ');
        if (firstSpace < 0) {
            return;
        }
        const cleaned = this.syntax.substring(firstSpace).replace(/\//g, ' ');
        for (const arg of cleaned.split(' ')) {
            const cleanedArg = arg.replace(/[[\](){}]/g, '');
            if (cleanedArg.trim().length === 0) {
                continue;
            }
            const colonIndex = cleanedArg.indexOf(':');
            if (colonIndex > 0) {
                const prefix = cleanedArg.substring(0, colonIndex);
                if (!prefix.includes('<')) {
                    this.argPrefixes.push({ clean: prefix, raw: arg });
                }
                else {
                    this.linearArguments.push(arg);
                }
            }
            else if (!cleanedArg.includes('<') && !cleanedArg.includes('|')) {
                this.flatArguments.push({ clean: cleanedArg, raw: arg });
            }
            else {
                this.linearArguments.push(arg);
            }
        }
    }
```

Change `MetaCommand.addTo` so the parse always runs before registration:

```ts
    addTo(docs: MetaDocs): void {
        this.parseSyntax();
        docs.commands.set(this.cleanName, this);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS — every previously passing test still passes, plus the 6 new ones.

- [ ] **Step 5: Verify compilation**

Run: `node node_modules/typescript/bin/tsc -p ./ --skipLibCheck`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/server/metaDocs/metaTypes.ts src/server/metaDocs/metaTypes.test.ts
git commit -m "feat: parse command syntax lines into completion-ready argument forms"
```

---

### Task 2: Markdown description rendering

Ports the `Describe*` / `DescriptionClean` / `LinkMeta` / `ObligatoryText` helpers from `DenizenLangServer/CommandTabCompletions.cs` (lines 322-392). These turn meta objects into the markdown blobs shown in hover popups and completion detail panes.

**Files:**
- Create: `src/server/providers/describe.ts`
- Test: `src/server/providers/describe.test.ts`

**Interfaces:**
- Consumes: `MetaObject`, `MetaCommand`, `MetaTag`, `MetaEvent`, `MetaMechanism`, `MetaLanguage`, `MetaAction` from `../metaDocs/metaTypes`. `MetaCommand.argPrefixes` from Task 1 is NOT used here.
- Produces:
  - `descriptionClean(input: string): string`
  - `linkMeta(obj: MetaObject): string`
  - `obligatoryText(obj: MetaObject): string`
  - `describeCommand(command: MetaCommand): MarkupContent`
  - `describeTag(tag: MetaTag): MarkupContent`
  - `describeEvent(evt: MetaEvent): MarkupContent`
  - `describeMech(mechanism: MetaMechanism): MarkupContent`
  - `describeLang(lang: MetaLanguage): MarkupContent`
  - `describeAction(action: MetaAction): MarkupContent`

- [ ] **Step 1: Write the failing test**

Create `src/server/providers/describe.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { descriptionClean, linkMeta, obligatoryText, describeCommand, describeLang } from './describe';
import { MetaCommand, MetaLanguage, META_TYPE_COMMAND } from '../metaDocs/metaTypes';

describe('descriptionClean', () => {
    it('escapes markdown- and html-hostile characters', () => {
        expect(descriptionClean('a & b # c <d> `e`')).toBe('a &amp; b &#35; c &lt;d&gt; \'e\'');
    });

    it('converts a code block into a fenced yml block without escaping its contents', () => {
        const result = descriptionClean('before <code>- narrate <player.name></code> after');
        expect(result).toBe('before \n```yml\n- narrate <player.name>\n```\n after');
    });

    it('handles an unterminated code tag by escaping it like normal text', () => {
        expect(descriptionClean('oops <code> unterminated')).toBe('oops &lt;code&gt; unterminated');
    });

    it('returns an empty string unchanged', () => {
        expect(descriptionClean('')).toBe('');
    });
});

describe('linkMeta', () => {
    it('builds a meta.denizenscript.com link from the object type web path', () => {
        const cmd = new MetaCommand();
        cmd.type = META_TYPE_COMMAND;
        cmd.commandName = 'Narrate';
        expect(linkMeta(cmd)).toBe('[Meta Docs: Commands narrate](https://meta.denizenscript.com/Docs/Commands/narrate)');
    });

    it('url-encodes names containing symbols', () => {
        const cmd = new MetaCommand();
        cmd.type = META_TYPE_COMMAND;
        cmd.commandName = 'a b';
        expect(linkMeta(cmd)).toContain('/Docs/Commands/a%20b');
    });

    it('returns an empty string when the object type has no web path', () => {
        const cmd = new MetaCommand();
        cmd.type = null;
        cmd.commandName = 'narrate';
        expect(linkMeta(cmd)).toBe('');
    });
});

describe('obligatoryText', () => {
    it('is just blank padding when there is nothing to warn about', () => {
        const cmd = new MetaCommand();
        expect(obligatoryText(cmd)).toBe('\n\n');
    });

    it('reports plugin, deprecation, and warnings when present', () => {
        const cmd = new MetaCommand();
        cmd.plugin = 'Depenizen';
        cmd.deprecated = 'Use foo instead.';
        cmd.warnings = ['first', 'second'];
        const result = obligatoryText(cmd);
        expect(result).toContain('Required plugin(s) or platform(s): Depenizen');
        expect(result).toContain('Deprecation notice: Use foo instead.');
        expect(result).toContain('### WARNING\nfirst\n- second');
    });

    it('ignores a whitespace-only plugin value', () => {
        const cmd = new MetaCommand();
        cmd.plugin = '   ';
        expect(obligatoryText(cmd)).toBe('\n\n');
    });
});

describe('describeCommand', () => {
    it('renders markdown containing the name, syntax, and related tags', () => {
        const cmd = new MetaCommand();
        cmd.type = META_TYPE_COMMAND;
        cmd.commandName = 'narrate';
        cmd.short = 'Shows some text to the player.';
        cmd.syntax = 'narrate [<text>]';
        cmd.description = 'Prints text.';
        cmd.tags = ['<player.name>'];
        const result = describeCommand(cmd);
        expect(result.kind).toBe('markdown');
        expect(result.value).toContain('### Command narrate');
        expect(result.value).toContain('```xml\n- narrate [<text>]\n```');
        expect(result.value).toContain('Related Tags:\n- &lt;player.name&gt;');
    });
});

describe('describeLang', () => {
    it('renders the language name and description', () => {
        const lang = new MetaLanguage();
        lang.langName = 'Task Script Containers';
        lang.description = 'A task script.';
        const result = describeLang(lang);
        expect(result.value).toContain('### Task Script Containers');
        expect(result.value).toContain('A task script.');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run src/server/providers/describe.test.ts`
Expected: FAIL — cannot resolve `./describe`.

- [ ] **Step 3: Write minimal implementation**

Create `src/server/providers/describe.ts`:

```ts
/**
 * Renders meta objects as markdown for hover popups and completion detail panes.
 * Ported from DenizenLangServer/CommandTabCompletions.cs (DescriptionClean,
 * LinkMeta, ObligatoryText, Describe*).
 */

import { MarkupContent, MarkupKind } from 'vscode-languageserver';
import {
    MetaObject, MetaCommand, MetaTag, MetaEvent, MetaMechanism, MetaLanguage, MetaAction
} from '../metaDocs/metaTypes';

/**
 * Escapes text for safe display inside a markdown popup, lifting `<code>` blocks
 * out into fenced yml blocks (their contents are deliberately left unescaped so
 * example scripts render as real script text).
 */
export function descriptionClean(input: string): string {
    const codeStart = input.indexOf('<code>');
    if (codeStart !== -1) {
        const codeEnd = input.indexOf('</code>', codeStart);
        if (codeEnd !== -1) {
            return descriptionClean(input.substring(0, codeStart))
                + '\n```yml\n'
                + input.substring(codeStart + '<code>'.length, codeEnd).replace(/`/g, '\'')
                + '\n```\n'
                + descriptionClean(input.substring(codeEnd + '</code>'.length));
        }
    }
    return input
        .replace(/`/g, '\'')
        .replace(/&/g, '&amp;')
        .replace(/#/g, '&#35;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Builds a markdown link to the object's page on meta.denizenscript.com.
 * Returns an empty string for object types with no web presence (guide pages,
 * extensions) — the C# original would throw a null reference there instead.
 */
export function linkMeta(obj: MetaObject): string {
    const webPath = obj.type?.webPath;
    if (!webPath) {
        return '';
    }
    return `[Meta Docs: ${webPath} ${descriptionClean(obj.cleanName)}]`
        + `(https://meta.denizenscript.com/Docs/${webPath}/${encodeURIComponent(obj.cleanName)})`;
}

/** Renders the plugin requirement, deprecation notice, and warnings block shared by every description. */
export function obligatoryText(obj: MetaObject): string {
    let result = '\n\n';
    if (obj.plugin !== null && obj.plugin.trim().length > 0) {
        result += `Required plugin(s) or platform(s): ${descriptionClean(obj.plugin)}\n\n`;
    }
    if (obj.deprecated !== null && obj.deprecated.trim().length > 0) {
        result += `Deprecation notice: ${descriptionClean(obj.deprecated)}\n\n`;
    }
    if (obj.warnings.length > 0) {
        result += '### WARNING\n' + descriptionClean(obj.warnings.join('\n- ')) + '\n\n';
    }
    return result;
}

function markdown(value: string): MarkupContent {
    return { kind: MarkupKind.Markdown, value };
}

export function describeCommand(command: MetaCommand): MarkupContent {
    return markdown(
        `### Command ${command.name}\n${descriptionClean(command.short)}\n`
        + `\`\`\`xml\n- ${command.syntax}\n\`\`\`\n${linkMeta(command)}\n\n`
        + `${descriptionClean(command.description)}${obligatoryText(command)}`
        + `Related Tags:\n- ${descriptionClean(command.tags.join('\n- '))}`
    );
}

export function describeTag(tag: MetaTag): MarkupContent {
    return markdown(
        `### Tag ${descriptionClean(tag.name)}\n${linkMeta(tag)}\n\n`
        + `Returns: ${tag.returns}\n\n`
        + `${descriptionClean(tag.description)}${obligatoryText(tag)}`
    );
}

export function describeEvent(evt: MetaEvent): MarkupContent {
    return markdown(
        `### Event ${descriptionClean(evt.name)}\n${linkMeta(evt)}\n\n`
        + `Triggers: ${descriptionClean(evt.triggers)}\n\n`
        + `Contexts:\n- ${descriptionClean(evt.context.join('\n- '))}${obligatoryText(evt)}`
    );
}

export function describeMech(mechanism: MetaMechanism): MarkupContent {
    return markdown(
        `### ${mechanism.mechObject} Mechanism ${mechanism.mechName}\n${linkMeta(mechanism)}\n\n`
        + `Input: ${mechanism.input}\n\n`
        + `${descriptionClean(mechanism.description)}${obligatoryText(mechanism)}`
        + `Related Tags:\n- ${descriptionClean(mechanism.tags.join('\n- '))}`
    );
}

export function describeLang(lang: MetaLanguage): MarkupContent {
    return markdown(
        `### ${descriptionClean(lang.name)}\n${linkMeta(lang)}\n\n`
        + `${descriptionClean(lang.description)}${obligatoryText(lang)}`
    );
}

export function describeAction(action: MetaAction): MarkupContent {
    return markdown(
        `### Action ${descriptionClean(action.name)}\n\n${linkMeta(action)}\n\n`
        + `Triggers: ${descriptionClean(action.triggers)}\n\n`
        + `Contexts:\n- ${descriptionClean(action.context.join('\n- '))}${obligatoryText(action)}`
    );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS.

- [ ] **Step 5: Verify compilation**

Run: `node node_modules/typescript/bin/tsc -p ./ --skipLibCheck`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/server/providers/describe.ts src/server/providers/describe.test.ts
git commit -m "feat: add markdown rendering for meta objects"
```

---

### Task 3: Cursor line context extraction

Ports the offset arithmetic at the top of `TextDocumentService.GetCompletionsFor` and `TextDocumentService.Hover`. Both providers need to know what text precedes the cursor on its line, and what the whole line is.

**Files:**
- Create: `src/server/providers/lineContext.ts`
- Test: `src/server/providers/lineContext.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface LineContext { linePrefix: string; trimmed: string; indent: number; }`
  - `getLineContext(text: string, offset: number): LineContext | null`
  - `export interface FullLine { line: string; startOfLine: number; }`
  - `getFullLine(text: string, offset: number): FullLine | null`

- [ ] **Step 1: Write the failing test**

Create `src/server/providers/lineContext.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getLineContext, getFullLine } from './lineContext';

describe('getLineContext', () => {
    it('returns the text before the cursor on the cursor line', () => {
        const text = 'first:\n  - narrate hello\nlast:';
        const offset = text.indexOf('hello');
        const ctx = getLineContext(text, offset)!;
        expect(ctx.linePrefix).toBe('  - narrate ');
        expect(ctx.trimmed).toBe('- narrate ');
        expect(ctx.indent).toBe(2);
    });

    it('lowercases the trimmed form but not the raw prefix', () => {
        const text = '  - NARRATE Hi';
        const ctx = getLineContext(text, text.length)!;
        expect(ctx.linePrefix).toBe('  - NARRATE Hi');
        expect(ctx.trimmed).toBe('- narrate hi');
    });

    it('handles the very first line of a document', () => {
        const ctx = getLineContext('- narrate', 9)!;
        expect(ctx.trimmed).toBe('- narrate');
        expect(ctx.indent).toBe(0);
    });

    it('returns an empty prefix when the cursor sits at the start of a line', () => {
        const text = 'a:\n  - narrate';
        const ctx = getLineContext(text, 3)!;
        expect(ctx.linePrefix).toBe('');
        expect(ctx.trimmed).toBe('');
    });

    it('strips a trailing carriage return from CRLF documents', () => {
        const text = '  - narrate\r\nnext:';
        const ctx = getLineContext(text, text.indexOf('\r') + 1)!;
        expect(ctx.trimmed).toBe('- narrate');
    });

    it('returns null for an out-of-range offset', () => {
        expect(getLineContext('abc', -1)).toBeNull();
        expect(getLineContext('abc', 4)).toBeNull();
    });
});

describe('getFullLine', () => {
    it('returns the whole line the cursor sits on, not just the prefix', () => {
        const text = 'a:\n  - narrate hello there\nb:';
        const found = getFullLine(text, text.indexOf('narrate'))!;
        expect(found.line).toBe('  - narrate hello there');
        expect(found.startOfLine).toBe(3);
    });

    it('returns the final line when there is no trailing newline', () => {
        const text = 'a:\n  - stop';
        const found = getFullLine(text, text.length)!;
        expect(found.line).toBe('  - stop');
    });

    it('excludes the carriage return on CRLF documents', () => {
        const text = '  - stop\r\nnext:';
        const found = getFullLine(text, 3)!;
        expect(found.line).toBe('  - stop');
    });

    it('returns null for an out-of-range offset', () => {
        expect(getFullLine('abc', 99)).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run src/server/providers/lineContext.test.ts`
Expected: FAIL — cannot resolve `./lineContext`.

- [ ] **Step 3: Write minimal implementation**

Create `src/server/providers/lineContext.ts`:

```ts
/**
 * Cursor-position line arithmetic shared by the completion and hover providers.
 * Ported from the offset handling at the top of
 * DenizenLangServer/Services/TextDocumentService.cs (Hover, GetCompletionsFor).
 */

/** The portion of the cursor's line that precedes the cursor. */
export interface LineContext {
    /** Raw text from line start up to (not including) the cursor. */
    linePrefix: string;
    /** `linePrefix` with leading whitespace removed and lowercased. */
    trimmed: string;
    /** How many leading whitespace characters were removed to produce `trimmed`. */
    indent: number;
}

/** A whole line plus where it begins in the document. */
export interface FullLine {
    /** The line text, excluding any line terminator. */
    line: string;
    /** Absolute offset of the line's first character. */
    startOfLine: number;
}

function isInRange(text: string, offset: number): boolean {
    return offset >= 0 && offset <= text.length;
}

/**
 * Offset of the first character of the line containing `offset`.
 * `offset === 0` is special-cased: `lastIndexOf` clamps a negative `fromIndex`
 * to 0 rather than treating it as "no match", so `lastIndexOf('\n', -1)` would
 * wrongly report a hit on a document whose very first character is a newline.
 */
function findStartOfLine(text: string, offset: number): number {
    if (offset === 0) {
        return 0;
    }
    return text.lastIndexOf('\n', offset - 1) + 1;
}

/** Extracts the text preceding the cursor on its own line. Returns null if the offset is out of range. */
export function getLineContext(text: string, offset: number): LineContext | null {
    if (!isInRange(text, offset)) {
        return null;
    }
    const startOfLine = findStartOfLine(text, offset);
    let linePrefix = text.substring(startOfLine, offset);
    if (linePrefix.endsWith('\r')) {
        linePrefix = linePrefix.substring(0, linePrefix.length - 1);
    }
    const trimmedRaw = linePrefix.trimStart();
    return {
        linePrefix,
        trimmed: trimmedRaw.toLowerCase(),
        indent: linePrefix.length - trimmedRaw.length
    };
}

/** Extracts the entire line the cursor sits on. Returns null if the offset is out of range. */
export function getFullLine(text: string, offset: number): FullLine | null {
    if (!isInRange(text, offset)) {
        return null;
    }
    const startOfLine = findStartOfLine(text, offset);
    let endOfLine = text.indexOf('\n', startOfLine);
    if (endOfLine === -1) {
        endOfLine = text.length;
    }
    let line = text.substring(startOfLine, endOfLine);
    if (line.endsWith('\r')) {
        line = line.substring(0, line.length - 1);
    }
    return { line, startOfLine };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS.

- [ ] **Step 5: Verify compilation**

Run: `node node_modules/typescript/bin/tsc -p ./ --skipLibCheck`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/server/providers/lineContext.ts src/server/providers/lineContext.test.ts
git commit -m "feat: add cursor line context extraction for providers"
```

---

### Task 4: Command and argument completion

Ports the command-handling branch of `TextDocumentService.GetCompletionsFor` (lines 341-407). Tag, mechanism, event, and workspace-driven completions are deliberately out of scope — they belong to Phase 2B and 2D.

**Files:**
- Create: `src/server/providers/completionProvider.ts`
- Test: `src/server/providers/completionProvider.test.ts`

**Interfaces:**
- Consumes: `MetaCommand.argPrefixes` / `.flatArguments` (Task 1), `describeCommand` (Task 2), `getLineContext` (Task 3).
- Produces:
  - `completeCommandNames(docs: MetaDocs, partial: string): CompletionItem[]`
  - `completeCommandArguments(command: MetaCommand, argSoFar: string): CompletionItem[]`
  - `provideCompletions(docs: MetaDocs, text: string, offset: number): CompletionItem[]`

- [ ] **Step 1: Write the failing test**

Create `src/server/providers/completionProvider.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CompletionItemKind } from 'vscode-languageserver';
import { provideCompletions, completeCommandNames, completeCommandArguments } from './completionProvider';
import { MetaCommand, MetaDocs, createEmptyMetaDocs, META_TYPE_COMMAND } from '../metaDocs/metaTypes';

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
        expect(provideCompletions(docs, text, text.length).map(i => i.label)).toEqual(['narrate']);
    });

    it('completes arguments once a command name and a space are present', () => {
        const docs = docsWith(NARRATE());
        const text = '  - narrate hello for';
        expect(provideCompletions(docs, text, text.length).map(i => i.label)).toEqual(['format:']);
    });

    it('tolerates the wait-for tilde prefix', () => {
        const docs = docsWith(NARRATE());
        const text = '  - ~nar';
        expect(provideCompletions(docs, text, text.length).map(i => i.label)).toEqual(['narrate']);
    });

    it('returns nothing on a line that is not a command line', () => {
        const docs = docsWith(NARRATE());
        const text = 'my_task:\n  type: ta';
        expect(provideCompletions(docs, text, text.length)).toEqual([]);
    });

    it('returns nothing for an unrecognised command name', () => {
        const docs = docsWith(NARRATE());
        const text = '  - notacommand arg';
        expect(provideCompletions(docs, text, text.length)).toEqual([]);
    });

    it('returns nothing for an out-of-range offset', () => {
        const docs = docsWith(NARRATE());
        expect(provideCompletions(docs, '  - nar', 999)).toEqual([]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run src/server/providers/completionProvider.test.ts`
Expected: FAIL — cannot resolve `./completionProvider`.

- [ ] **Step 3: Write minimal implementation**

Create `src/server/providers/completionProvider.ts`:

```ts
/**
 * Context-free command completion. Ported from the command branch of
 * DenizenLangServer/Services/TextDocumentService.cs::GetCompletionsFor.
 *
 * Phase 2A scope: command names and their documented arguments only. Tag,
 * mechanism, event, and workspace-driven completions arrive in later phases.
 */

import { CompletionItem, CompletionItemKind } from 'vscode-languageserver';
import { MetaDocs, MetaCommand } from '../metaDocs/metaTypes';
import { describeCommand } from './describe';
import { getLineContext } from './lineContext';

/** Every command whose name starts with `partial`, as completion items carrying full docs. */
export function completeCommandNames(docs: MetaDocs, partial: string): CompletionItem[] {
    const results: CompletionItem[] = [];
    for (const [key, command] of docs.commands) {
        if (key.startsWith(partial)) {
            results.push({
                label: key,
                kind: CompletionItemKind.Method,
                detail: command.short,
                documentation: describeCommand(command)
            });
        }
    }
    return results;
}

/** The command's documented arguments that start with `argSoFar`. Prefixed arguments gain a trailing colon. */
export function completeCommandArguments(command: MetaCommand, argSoFar: string): CompletionItem[] {
    const results: CompletionItem[] = [];
    for (const arg of command.flatArguments) {
        if (arg.clean.startsWith(argSoFar)) {
            results.push({ label: arg.clean, kind: CompletionItemKind.Field, detail: arg.raw });
        }
    }
    for (const arg of command.argPrefixes) {
        if (arg.clean.startsWith(argSoFar)) {
            results.push({ label: `${arg.clean}:`, kind: CompletionItemKind.Field, detail: arg.raw });
        }
    }
    return results;
}

/** Entry point: what should be offered at `offset` within `text`. */
export function provideCompletions(docs: MetaDocs, text: string, offset: number): CompletionItem[] {
    const ctx = getLineContext(text, offset);
    if (ctx === null || !ctx.trimmed.startsWith('- ')) {
        return [];
    }
    let afterDash = ctx.trimmed.substring(2);
    if (afterDash.startsWith('~')) {
        afterDash = afterDash.substring(1);
    }
    const firstSpace = afterDash.indexOf(' ');
    if (firstSpace === -1) {
        return completeCommandNames(docs, afterDash);
    }
    const command = docs.commands.get(afterDash.substring(0, firstSpace));
    if (command === undefined) {
        return [];
    }
    return completeCommandArguments(command, afterDash.substring(afterDash.lastIndexOf(' ') + 1));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS.

- [ ] **Step 5: Verify compilation**

Run: `node node_modules/typescript/bin/tsc -p ./ --skipLibCheck`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/server/providers/completionProvider.ts src/server/providers/completionProvider.test.ts
git commit -m "feat: add command and argument completion provider"
```

---

### Task 5: Hover documentation

Ports the command and `type:` branches of `TextDocumentService.GetHoverAt`. Event and action hover need `EventTools`/`ScriptEventCouldMatcher`, which are Phase 2B work.

**Files:**
- Create: `src/server/providers/hoverProvider.ts`
- Test: `src/server/providers/hoverProvider.test.ts`

**Interfaces:**
- Consumes: `describeCommand`, `describeLang` (Task 2), `getFullLine` (Task 3).
- Produces: `provideHover(docs: MetaDocs, text: string, offset: number, line: number): Hover | null`

> **Amended after the Task 5 review.** The signature originally also took a
> `character: number`. Review found (a) the `type:` branch ignored it entirely, so
> hovering a `type:` line's leading whitespace still produced a tooltip, and (b)
> nothing guaranteed the caller's `character` described the same position as
> `offset`. Both are fixed by deriving the cursor column internally as
> `offset - startOfLine` and dropping the parameter — a desync then becomes
> impossible rather than merely unlikely. `line` remains a parameter because it is
> only used to build the returned range and the caller already knows it.

- [ ] **Step 1: Write the failing test**

Create `src/server/providers/hoverProvider.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Hover } from 'vscode-languageserver';
import { provideHover } from './hoverProvider';
import { MetaCommand, MetaLanguage, MetaDocs, createEmptyMetaDocs, META_TYPE_COMMAND, META_TYPE_LANGUAGE } from '../metaDocs/metaTypes';

function testDocs(): MetaDocs {
    const docs = createEmptyMetaDocs();
    const cmd = new MetaCommand();
    cmd.type = META_TYPE_COMMAND;
    cmd.commandName = 'narrate';
    cmd.syntax = 'narrate [<text>]';
    cmd.short = 'Shows text.';
    cmd.addTo(docs);
    const lang = new MetaLanguage();
    lang.type = META_TYPE_LANGUAGE;
    lang.langName = 'Task Script Containers';
    lang.description = 'A task script.';
    lang.addTo(docs);
    return docs;
}

function valueOf(hover: Hover): string {
    return (hover.contents as { value: string }).value;
}

describe('provideHover', () => {
    it('describes the command when the cursor is on its name', () => {
        const docs = testDocs();
        const text = '  - narrate hello';
        const hover = provideHover(docs, text, 6, 0, 6)!;
        expect(valueOf(hover)).toContain('### Command narrate');
        expect(hover.range).toEqual({ start: { line: 0, character: 4 }, end: { line: 0, character: 11 } });
    });

    it('returns nothing when the cursor is past the command name', () => {
        const docs = testDocs();
        const text = '  - narrate hello';
        expect(provideHover(docs, text, 13, 0, 13)).toBeNull();
    });

    it('skips the tilde when locating the command name', () => {
        const docs = testDocs();
        const text = '  - ~narrate hi';
        const hover = provideHover(docs, text, 7, 0, 7)!;
        expect(valueOf(hover)).toContain('### Command narrate');
        expect(hover.range!.start.character).toBe(5);
    });

    it('describes the container language on a type line', () => {
        const docs = testDocs();
        const text = 'my_task:\n  type: task';
        const offset = text.indexOf('task', 9);
        const hover = provideHover(docs, text, offset, 1, offset - 9)!;
        expect(valueOf(hover)).toContain('### Task Script Containers');
    });

    it('returns nothing for an unknown command', () => {
        const docs = testDocs();
        const text = '  - notacommand';
        expect(provideHover(docs, text, 6, 0, 6)).toBeNull();
    });

    it('returns nothing for an unknown container type', () => {
        const docs = testDocs();
        const text = '  type: nonsense';
        expect(provideHover(docs, text, 10, 0, 10)).toBeNull();
    });

    it('returns nothing on an ordinary line', () => {
        const docs = testDocs();
        const text = 'my_task:';
        expect(provideHover(docs, text, 3, 0, 3)).toBeNull();
    });

    it('returns nothing for an out-of-range offset', () => {
        expect(provideHover(testDocs(), '  - narrate', 999, 0, 999)).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run src/server/providers/hoverProvider.test.ts`
Expected: FAIL — cannot resolve `./hoverProvider`.

- [ ] **Step 3: Write minimal implementation**

Create `src/server/providers/hoverProvider.ts`:

```ts
/**
 * Hover documentation. Ported from the command and `type:` branches of
 * DenizenLangServer/Services/TextDocumentService.cs::GetHoverAt.
 *
 * Phase 2A scope: commands and container types. Event and action hover need the
 * event matcher machinery and arrive in Phase 2B.
 */

import { Hover } from 'vscode-languageserver';
import { MetaDocs } from '../metaDocs/metaTypes';
import { describeCommand, describeLang } from './describe';
import { getFullLine } from './lineContext';

const TYPE_PREFIX = 'type: ';

/** Characters that can appear in a Denizen command name. */
const COMMAND_NAME_PATTERN = /^[a-z0-9_]+$/;

/** Describes whatever meta object sits under the cursor, or null if there is nothing to say. */
export function provideHover(docs: MetaDocs, text: string, offset: number, line: number, character: number): Hover | null {
    const found = getFullLine(text, offset);
    if (found === null) {
        return null;
    }
    const raw = found.line;
    const trimmedRaw = raw.trimStart();
    const indent = raw.length - trimmedRaw.length;
    const trimmed = trimmedRaw.toLowerCase();
    if (trimmed.startsWith('- ')) {
        let nameStart = indent + 2;
        let rest = trimmed.substring(2);
        if (rest.startsWith('~')) {
            rest = rest.substring(1);
            nameStart++;
        }
        const spaceIndex = rest.indexOf(' ');
        const commandName = spaceIndex === -1 ? rest : rest.substring(0, spaceIndex);
        if (!COMMAND_NAME_PATTERN.test(commandName)) {
            return null;
        }
        const nameEnd = nameStart + commandName.length;
        if (character < nameStart || character > nameEnd) {
            return null;
        }
        const command = docs.commands.get(commandName);
        if (command === undefined) {
            return null;
        }
        return {
            contents: describeCommand(command),
            range: { start: { line, character: nameStart }, end: { line, character: nameEnd } }
        };
    }
    if (trimmed.startsWith(TYPE_PREFIX)) {
        const containerType = `${trimmed.substring(TYPE_PREFIX.length).trim()} script containers`;
        const lang = docs.languages.get(containerType);
        if (lang === undefined) {
            return null;
        }
        return {
            contents: describeLang(lang),
            range: { start: { line, character: indent }, end: { line, character: raw.length } }
        };
    }
    return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS.

- [ ] **Step 5: Verify compilation**

Run: `node node_modules/typescript/bin/tsc -p ./ --skipLibCheck`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/server/providers/hoverProvider.ts src/server/providers/hoverProvider.test.ts
git commit -m "feat: add hover documentation provider"
```

---

### Task 6: Wire providers into the LSP server

`src/server/server.ts` currently loads meta and logs a summary, then discards the result. It must retain the docs and answer `textDocument/completion` and `textDocument/hover`.

**Files:**
- Modify: `src/server/server.ts`
- Test: `src/server/server.test.ts` (append to the existing file)

**Interfaces:**
- Consumes: `provideCompletions` (Task 4), `provideHover` (Task 5).
- Produces: `export function getLoadedDocs(): MetaDocs | null` — used only by tests.

- [ ] **Step 1: Write the failing test**

Append to `src/server/server.test.ts`:

```ts
describe('buildCapabilities', () => {
    it('advertises completion and hover support', () => {
        const caps = buildCapabilities();
        expect(caps.completionProvider).toBeDefined();
        expect(caps.completionProvider!.resolveProvider).toBe(false);
        expect(caps.hoverProvider).toBe(true);
    });

    it('offers a dash as a completion trigger character', () => {
        expect(buildCapabilities().completionProvider!.triggerCharacters).toContain('-');
    });

    it('keeps incremental document sync', () => {
        expect(buildCapabilities().textDocumentSync).toBe(2);
    });
});
```

The file's first line is already `import { describe, it, expect } from 'vitest';` and its second is `import { combineSources } from './server';` — extend that second import to `import { combineSources, buildCapabilities } from './server';`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run src/server/server.test.ts`
Expected: FAIL — `buildCapabilities` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/server/server.ts`, extend the import from `vscode-languageserver/node` to include `ServerCapabilities`, `CompletionItem`, `Hover`, `TextDocumentPositionParams`:

```ts
import {
    createConnection, ProposedFeatures, TextDocuments, TextDocumentSyncKind,
    InitializeParams, InitializeResult, Connection, ServerCapabilities,
    CompletionItem, Hover, TextDocumentPositionParams
} from 'vscode-languageserver/node';
```

Add these imports below the existing `loadMetaDocs` import:

```ts
import { MetaDocs } from './metaDocs/metaTypes';
import { provideCompletions } from './providers/completionProvider';
import { provideHover } from './providers/hoverProvider';
```

Add a module-scoped holder and accessor just below `const META_CACHE_TTL_MS = ...`:

```ts
/** The loaded meta documentation, or null until the initial load resolves. */
let loadedDocs: MetaDocs | null = null;

/** Test accessor for the loaded documentation. */
export function getLoadedDocs(): MetaDocs | null {
    return loadedDocs;
}
```

Add the capability builder above `createServer`:

```ts
/** The capabilities this server advertises. Extracted so it is testable without a live connection. */
export function buildCapabilities(): ServerCapabilities {
    return {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: {
            resolveProvider: false,
            triggerCharacters: ['-', ' ', ':']
        },
        hoverProvider: true
    };
}
```

Replace the body of `connection.onInitialize` with:

```ts
    connection.onInitialize((_params: InitializeParams): InitializeResult => {
        return { capabilities: buildCapabilities() };
    });
```

Inside `createServer`, change the `.then(docs => {...})` block so it stores the docs before logging — replace `.then(docs => {` with:

```ts
            .then(docs => {
                loadedDocs = docs;
```

(the rest of that block is unchanged).

Register the two handlers immediately before `documents.listen(connection);`:

```ts
    connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
        const doc = documents.get(params.textDocument.uri);
        if (doc === undefined || loadedDocs === null || !params.textDocument.uri.endsWith('.dsc')) {
            return [];
        }
        try {
            return provideCompletions(loadedDocs, doc.getText(), doc.offsetAt(params.position));
        }
        catch (err) {
            connection.console.error(`Completion failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
            return [];
        }
    });

    connection.onHover((params: TextDocumentPositionParams): Hover | null => {
        const doc = documents.get(params.textDocument.uri);
        if (doc === undefined || loadedDocs === null || !params.textDocument.uri.endsWith('.dsc')) {
            return null;
        }
        try {
            return provideHover(loadedDocs, doc.getText(), doc.offsetAt(params.position),
                params.position.line);
        }
        catch (err) {
            connection.console.error(`Hover failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
            return null;
        }
    });
```

Do not add any new settings to `package.json` in this task. The C# server's
`do_hover_docs` / `do_tab_completes` toggles need the `didChangeConfiguration`
notification path, which does not exist on the TypeScript side yet; declaring
the settings now would put switches in the VS Code settings UI that silently do
nothing. They land in Phase 2B together with the code that honours them.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS.

- [ ] **Step 5: Verify compilation**

Run: `node node_modules/typescript/bin/tsc -p ./ --skipLibCheck`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/server/server.ts src/server/server.test.ts
git commit -m "feat: serve completion and hover from the TypeScript LSP server"
```

---

### Task 7: Stand down the hardcoded snippet providers on the TypeScript path

`activateWorkspaceCompletions` in `src/extension.ts` registers a completion provider backed by a hardcoded list (`bmlimb`, `bmmodel`, …) and a hover provider backed by the same list. With the TypeScript server now supplying real meta-driven completions, these must not compete with it — but they must remain exactly as-is on the C# path, and the workspace index plus its file watcher must keep running either way (the Denizen tree view depends on them).

**Files:**
- Modify: `src/extension.ts` (function `activateWorkspaceCompletions`, lines 1437-1470)

**Interfaces:**
- Consumes: `shouldUseTypeScriptServer` from `./serverEngineSelector` (already imported at `src/extension.ts:7`).
- Produces: nothing consumed by later tasks.

**On testing:** this task adds no unit test, deliberately. `activateWorkspaceCompletions` needs the live `vscode` module, so it cannot run under vitest; and the only pure logic involved — `shouldUseTypeScriptServer` — is already fully covered by `src/serverEngineSelector.test.ts` (it asserts `'typescript'` → true and `'csharp'`/`undefined`/`null`/garbage → false). Adding a second copy of those assertions would be padding, not coverage. Verification for this task is the diff review in Step 3 plus the manual acceptance checks at the end of this plan. Do not invent a test that mocks `vscode` to manufacture a green check.

- [ ] **Step 1: Confirm the gating premise still holds**

Run: `node node_modules/vitest/vitest.mjs run src/serverEngineSelector.test.ts`
Expected: PASS. If it does not, stop and report — the whole gating approach rests on this function.

- [ ] **Step 2: Write the implementation**

In `src/extension.ts`, replace these two registrations at the top of `activateWorkspaceCompletions` (currently lines 1439-1449):

```ts
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider("denizenscript", {
        provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) : vscode.ProviderResult<vscode.CompletionItem[]> {
            workspaceIndex.updateDocument(document);
            return getDenizenCompletions(document, position);
        }
    }, "<", "[", ".", "&", " "));
    context.subscriptions.push(vscode.languages.registerHoverProvider("denizenscript", {
        provideHover(document: vscode.TextDocument, position: vscode.Position) : vscode.ProviderResult<vscode.Hover> {
            return getDenizenMHover(document, position);
        }
    }));
```

with:

```ts
    // The TypeScript language server supplies meta-driven completion and hover.
    // The hardcoded snippet list below is the C#-path fallback only, so it stands
    // down when the TypeScript engine is active to avoid competing suggestions.
    // The workspace index and file watcher below run either way — the Denizen
    // tree view depends on them.
    if (!shouldUseTypeScriptServer(configuration.get("denizenscript.server.engine"))) {
        context.subscriptions.push(vscode.languages.registerCompletionItemProvider("denizenscript", {
            provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) : vscode.ProviderResult<vscode.CompletionItem[]> {
                workspaceIndex.updateDocument(document);
                return getDenizenCompletions(document, position);
            }
        }, "<", "[", ".", "&", " "));
        context.subscriptions.push(vscode.languages.registerHoverProvider("denizenscript", {
            provideHover(document: vscode.TextDocument, position: vscode.Position) : vscode.ProviderResult<vscode.Hover> {
                return getDenizenMHover(document, position);
            }
        }));
    }
```

Do not touch `workspaceIndex.refreshWorkspace();` on the first line of the function, and do not touch the `vscode.workspace.createFileSystemWatcher` block or anything after it.

- [ ] **Step 3: Verify the C# path is untouched**

Run: `git diff src/extension.ts`
Expected: exactly one hunk, adding the `if (!shouldUseTypeScriptServer(...)) {` line, one closing brace, four comment lines, and re-indenting the ten enclosed lines. Confirm in your report that no other line of `extension.ts` changed and that the enclosed code is character-identical apart from indentation. Paste the diff into your report.

- [ ] **Step 4: Run the full test suite**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS.

- [ ] **Step 5: Verify compilation**

Run: `node node_modules/typescript/bin/tsc -p ./ --skipLibCheck`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/extension.ts
git commit -m "feat: stand down hardcoded snippet providers when the TypeScript engine is active"
```

---

### Task 8: Live end-to-end verification

Everything so far is unit-tested against synthetic meta. This task proves the providers work against the real ~4000-object Denizen meta set.

**Files:**
- Create: `scripts/verify-phase2a.js` (throwaway verification script, committed so the check is repeatable)

**Interfaces:**
- Consumes: the compiled `out/server/` modules from every prior task.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the verification script**

Create `scripts/verify-phase2a.js`:

```js
/**
 * Live verification for Phase 2A: loads real Denizen meta over the network and
 * exercises the completion and hover providers against it.
 * Run with: node scripts/verify-phase2a.js
 */
const path = require('path');
const os = require('os');
const { loadMetaDocs, DEFAULT_META_SOURCES } = require('../out/server/metaDocs/metaDocsManager');
const { provideCompletions } = require('../out/server/providers/completionProvider');
const { provideHover } = require('../out/server/providers/hoverProvider');

const cacheFile = path.join(os.tmpdir(), 'denizen-phase2a-verify-cache.json');

function check(label, condition, detail) {
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
    return condition ? 0 : 1;
}

loadMetaDocs({ cacheFile, ttlMs: 12 * 60 * 60 * 1000, sources: DEFAULT_META_SOURCES }).then(docs => {
    console.log(`Loaded ${docs.commands.size} commands, ${docs.languages.size} languages, ${docs.loadErrors.length} load error(s).`);
    let failures = 0;

    const narrate = docs.commands.get('narrate');
    failures += check('narrate command exists', narrate !== undefined);
    if (narrate === undefined) {
        process.exit(1);
    }
    console.log(`  narrate syntax: ${narrate.syntax}`);
    console.log(`  narrate prefixes: ${narrate.argPrefixes.map(a => a.clean).join(', ')}`);
    console.log(`  narrate flat args: ${narrate.flatArguments.map(a => a.clean).join(', ')}`);
    failures += check('narrate has parsed argument prefixes', narrate.argPrefixes.length > 0);

    const nameText = 'my_task:\n  type: task\n  script:\n  - narr';
    const nameResults = provideCompletions(docs, nameText, nameText.length);
    failures += check('command name completion offers narrate',
        nameResults.some(i => i.label === 'narrate'),
        `got ${nameResults.length} item(s): ${nameResults.map(i => i.label).slice(0, 5).join(', ')}`);

    const argText = '  - narrate hello ';
    const argResults = provideCompletions(docs, argText, argText.length);
    failures += check('argument completion returns items',
        argResults.length > 0,
        `got ${argResults.map(i => i.label).join(', ')}`);

    const hoverText = '  - narrate hello';
    const hover = provideHover(docs, hoverText, 6, 0);
    // Real meta carries `@Name Narrate`, and both this port and the C# original
    // render the raw case-preserved name in the header (C# uses `command.Name`,
    // not `CleanName`) — so match case-insensitively rather than assuming lowercase.
    failures += check('hover on narrate returns documentation',
        hover !== null && hover.contents.value.toLowerCase().includes('### command narrate'),
        hover === null ? 'null' : hover.contents.value.split('\n')[0]);

    const typeText = 'my_task:\n  type: task';
    const typeHover = provideHover(docs, typeText, typeText.length, 1);
    failures += check('hover on a type line returns container docs',
        typeHover !== null,
        typeHover === null ? 'null' : typeHover.contents.value.split('\n')[0]);

    const sampled = [...docs.commands.values()].filter(c => c.syntax && c.syntax.includes(':'));
    const parsed = sampled.filter(c => c.argPrefixes.length > 0);
    failures += check('most colon-bearing commands parsed at least one prefix',
        parsed.length > sampled.length * 0.8,
        `${parsed.length}/${sampled.length}`);

    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}).catch(err => {
    console.error('Verification failed to run:', err);
    process.exit(1);
});
```

- [ ] **Step 2: Compile so `out/` is current**

Run: `node node_modules/typescript/bin/tsc -p ./ --skipLibCheck`
Expected: no output, exit code 0.

- [ ] **Step 3: Run the live verification**

Run: `node scripts/verify-phase2a.js`
Expected: every line starts with `PASS`, ending with `ALL CHECKS PASSED`, exit code 0. This downloads from GitHub — it needs network access and takes 10-60 seconds on a cold cache.

Paste the complete output into your report, including the `Loaded N commands...` line and the narrate syntax/prefix/flat-arg lines. If any check FAILs, do not "fix" the check — investigate the provider, report what you found, and stop.

- [ ] **Step 4: Run the full test suite one final time**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS, with the total test count reported.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-phase2a.js
git commit -m "test: add live end-to-end verification for Phase 2A providers"
```

---

---

### Task 9: Narrow the legacy gate to hardcoded commands only

Added after the Task 7 review and a user decision. Task 7 gated the legacy completion and hover
providers wholesale, which also disabled legacy tag, event, container-define, and player/server flag
completion — none of which the TypeScript server supplies yet (a grep of `src/server/` finds no flag
support at all). That traded four working feature areas for two. The user chose the hybrid: suppress
only the hardcoded **command** snippets (`bmlimb`, `bmmodel`, …), and let everything else keep working
until Phases 2B/2C replace it.

**Files:**
- Modify: `src/extension.ts` — revert the Task 7 gate in `activateWorkspaceCompletions` (~line 1437),
  and add narrower gates inside `getDenizenCompletions` (~line 1342) and `getDenizenMDocByLabel` (~line 1398)

**Interfaces:**
- Consumes: `shouldUseTypeScriptServer` (already imported at `src/extension.ts:7`), `configuration`.
- Produces: nothing consumed by later tasks.

**On testing:** as with Task 7, no unit test — this code needs the live `vscode` module. Verification is
the diff review plus the manual acceptance checks below. Do not mock `vscode` to manufacture a green check.

- [ ] **Step 1: Revert the Task 7 gate**

In `activateWorkspaceCompletions`, remove the `if (!shouldUseTypeScriptServer(...)) {` wrapper and its
closing brace along with the five-line comment above it, restoring both
`registerCompletionItemProvider` and `registerHoverProvider` to unconditional registration. After this
step `git diff f652ae0 -- src/extension.ts` should be empty for that function.

- [ ] **Step 2: Add the narrow completion gate**

In `getDenizenCompletions`, add this helper call at the top of the function body, immediately after the
`linePrefix` assignment:

```ts
    const suppressHardcodedCommands = shouldUseTypeScriptServer(configuration.get("denizenscript.server.engine"));
```

Then wrap ONLY the two hardcoded-command blocks. Replace:

```ts
    const commandCompletions = getDenizenMCommandCompletions(document, position);
    if (commandCompletions.length > 0) {
        return commandCompletions;
    }
```
with:
```ts
    // The TypeScript server supplies real meta-driven command completion, so the
    // hardcoded command list stands down there. Tags, events, defines and flags
    // below have no TypeScript-server equivalent yet and keep working either way.
    if (!suppressHardcodedCommands) {
        const commandCompletions = getDenizenMCommandCompletions(document, position);
        if (commandCompletions.length > 0) {
            return commandCompletions;
        }
    }
```

and replace:
```ts
    const commandArgCompletions = getDenizenMCommandArgCompletions(document, position);
    if (commandArgCompletions.length > 0) {
        return commandArgCompletions;
    }
```
with:
```ts
    if (!suppressHardcodedCommands) {
        const commandArgCompletions = getDenizenMCommandArgCompletions(document, position);
        if (commandArgCompletions.length > 0) {
            return commandArgCompletions;
        }
    }
```

Leave every other branch — events, container snippets, escape tags, context, dot tags, defines, flags —
completely untouched and unconditional.

- [ ] **Step 3: Add the narrow hover gate**

`getDenizenMDocByLabel` searches one concatenated list covering escape tags, base tags, dot tags,
commands, command args, and events. Only the command sources should stand down. Replace its body:

```ts
function getDenizenMDocByLabel(label: string) : DenizenMDoc | undefined {
    const cleanLabel = label.toLowerCase();
    return denizenMEscapeTags.concat(denizenMBaseTags).concat(denizenMDotTags).concat(denizenMCommands).concat(denizenMCommandArgs).concat(denizenMEvents)
        .filter(doc => doc.label.toLowerCase() == cleanLabel || doc.label.toLowerCase() == "&" + cleanLabel)[0];
}
```
with:
```ts
function getDenizenMDocByLabel(label: string) : DenizenMDoc | undefined {
    const cleanLabel = label.toLowerCase();
    // Commands and their arguments are documented by the TypeScript server's own
    // hover when that engine is active; the remaining sources have no equivalent yet.
    let sources = denizenMEscapeTags.concat(denizenMBaseTags).concat(denizenMDotTags);
    if (!shouldUseTypeScriptServer(configuration.get("denizenscript.server.engine"))) {
        sources = sources.concat(denizenMCommands).concat(denizenMCommandArgs);
    }
    sources = sources.concat(denizenMEvents);
    return sources.filter(doc => doc.label.toLowerCase() == cleanLabel || doc.label.toLowerCase() == "&" + cleanLabel)[0];
}
```

- [ ] **Step 4: Verify compilation**

Run: `node node_modules/typescript/bin/tsc -p ./ --skipLibCheck`
Expected: no output, exit code 0.

- [ ] **Step 5: Run the full test suite**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS, unchanged count.

- [ ] **Step 6: Verify the C# path is untouched**

Run: `git diff f652ae0..HEAD -- src/extension.ts` and then `git diff -w f652ae0..HEAD -- src/extension.ts`.
Confirm in your report that with the default (`csharp`) engine every code path is reachable exactly as
before — i.e. every new gate is a `!shouldUseTypeScriptServer(...)` guard that evaluates true by default,
and no existing line was deleted or reordered. Paste both diffs.

- [ ] **Step 7: Commit**

```bash
git add src/extension.ts
git commit -m "feat: suppress only hardcoded command snippets on the TypeScript engine"
```

---

## Manual acceptance (for the user, after Task 8)

These cannot be automated and are the user's to confirm:

1. Set `denizenscript.server.engine` to `typescript`, reload the window, open a `.dsc` file.
2. Type `  - narr` inside a `script:` block — `narrate` should be offered, with real documentation in the side panel, and **no** `bmlimb` entries.
3. Hover over the word `narrate` — the command documentation popup should appear.
4. Hover over a `type: task` line — the "Task Script Containers" language documentation should appear.
5. **Still works after Task 9** (these are the legacy features deliberately kept alive until 2B/2C):
   type `<` to get escape-tag completion; type `<[` to get container defines; type `<player.flag[` to
   get player flags and `<server.flag[` to get server flags; start an event line to get event completion.
   If any of these went silent, Task 9's gate is too wide.
6. Revert `denizenscript.server.engine` to its default, reload, and confirm the old `bmlimb` snippets are back and behave exactly as before.

## Out of scope for 2A (tracked for later plans)

- Tag completion and tag hover — needs `TagHelper`/`SingleTag`/`TagTracer` and the `tagBases`/`tagParts` sets, which `MetaDocs` does not yet carry. **Phase 2B.**
- Event and action hover/completion — needs `EventTools.SeparateSwitches` and `ScriptEventCouldMatcher`. **Phase 2B.**
- Mechanism completion under `mechanisms:` keys, and the `ExtraData` enum sets (materials, items, entities, sounds…). **Phase 2B.**
- Honouring `do_hover_docs` / `do_tab_completes` at request time — needs the `didChangeConfiguration` path. **Phase 2B.**
- `MetaMechanism`/`MetaProperty` `NameForms` alternate-name registration — a deferred Phase 1 Minor that tag lookup will need. **Phase 2B.**
- Script checking and diagnostics. **Phase 2C.**
- Workspace-wide script name and flag completion. **Phase 2D.**
