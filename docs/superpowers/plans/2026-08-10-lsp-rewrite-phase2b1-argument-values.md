# Phase 2B-1: Shared Cursor Context & Argument Value Completion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `- playsound sound:` suggest real Minecraft sound names (and the same for materials, items, entities, particles, potion effects, enchantments, biomes, statistics), and extract the shared cursor parser that both providers need before the tag work begins.

**Architecture:** One new pure module parses the cursor's command context once (`cursorContext.ts`), replacing the duplicated line-walking currently inlined in `completionProvider.ts` and `hoverProvider.ts`. A second new module (`extraData.ts`) downloads and caches `minecraft.fds` — a flat list-of-lists document — and exposes the enum sets. A third (`argumentCompleters.ts`) holds the command→prefix→enum registration table ported from C#. The completion provider then consults that table when the cursor sits in a command argument.

**Tech Stack:** TypeScript 5.x, `vscode-languageserver` 9.x (bare entry only in providers), vitest 3.x, Node 18+.

## Global Constraints

- Branch: `feature/typescript-lsp-rewrite`. Commit after every task. **Do not merge into main** — the owner wants everything to stay on this branch until a complete working version exists.
- **`npm run compile` silently no-ops on this machine** — exits 0, prints nothing, writes no files even when the code is genuinely broken. The ONLY accepted compile verification is `node node_modules/typescript/bin/tsc -p ./ --skipLibCheck`.
- **`npx vitest` swallows output on this machine.** The ONLY accepted test command is `node node_modules/vitest/vitest.mjs run`.
- Paste the real captured stdout of every verification command into your report. Never paraphrase, summarize, or reconstruct it.
- Every file under `src/server/` except `server.ts` MUST import only from `vscode-languageserver` (the bare entry), never `vscode-languageserver/node`, and never `vscode`.
- The C# engine path must stay behaviourally identical. `denizenscript.server.engine` defaults to `"csharp"`.
- Do not add npm dependencies. Do not modify `tsconfig.json`.
- Tests live next to their source as `<name>.test.ts`.
- **Never weaken a failing check to make it pass.** Three genuine bugs were caught in Phase 2A precisely because implementers reported failures instead of tuning assertions.

## Verified facts about the data source

Confirmed by fetching `https://meta.denizenscript.com/data/minecraft.fds` (101,962 bytes) during planning:

- The document is **flat**: every line is either a top-level `key:` at column 0 or a `- value` list entry. Zero indented lines. Exactly one non-conforming line — the trailing empty line at EOF.
- Thirteen sections, with these entry counts: `biomes` 65, `blocks` 1105, `enchantments` 42, `effects` 95, `potion_effects` 39, `sounds` 1728, `entities` 151, `potions` 46, `attributes` 35, `particles` 114, `items` 1416, `gamerules` 56, `statistics` 84.
- Values are stored **uppercase with dots** (`BLOCK.STONE.STEP`). C# lowercases every value in `GetDataSet` (`ExtraData.cs:107`), yielding `block.stone.step`. This port must do the same.
- `Materials` is not a section — C# derives it as the union of `blocks` and `items` (`ExtraData.cs:100-102`).

---

### Task 1: Shared cursor context parser

Both providers currently re-derive the same thing: strip the dash, strip a `~`, find the command name, find the argument under the cursor. `hoverProvider.ts` additionally recomputes `trimmed`/`indent` by hand that `lineContext.ts` already models. Extracting this now is what makes Task 4 cheap, and it is the prerequisite the Phase 2A final review flagged before any tag work.

**Files:**
- Create: `src/server/providers/cursorContext.ts`
- Test: `src/server/providers/cursorContext.test.ts`
- Modify: `src/server/providers/completionProvider.ts`
- Modify: `src/server/providers/hoverProvider.ts`

**Interfaces:**
- Consumes: `getLineContext`, `getFullLine` from `./lineContext`.
- Produces:
  - `export interface CommandCursorContext { name: string; typingName: boolean; nameStart: number; nameEnd: number; argThusFar: string; argPrefix: string; argValue: string; }`
  - `parseCursorContext(text: string, offset: number): CommandCursorContext | null`
  - `parseCommandLine(trimmed: string, indent: number): CommandCursorContext | null`

- [ ] **Step 1: Write the failing test**

Create `src/server/providers/cursorContext.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseCursorContext, parseCommandLine } from './cursorContext';

describe('parseCommandLine', () => {
    it('reports a name still being typed', () => {
        const ctx = parseCommandLine('- narr', 2)!;
        expect(ctx.name).toBe('narr');
        expect(ctx.typingName).toBe(true);
        expect(ctx.nameStart).toBe(4);
        expect(ctx.nameEnd).toBe(8);
    });

    it('reports a completed name and an empty argument after a trailing space', () => {
        const ctx = parseCommandLine('- narrate ', 2)!;
        expect(ctx.name).toBe('narrate');
        expect(ctx.typingName).toBe(false);
        expect(ctx.argThusFar).toBe('');
        expect(ctx.argPrefix).toBe('');
        expect(ctx.argValue).toBe('');
    });

    it('splits a prefixed argument on the first colon', () => {
        const ctx = parseCommandLine('- playsound sound:block.stone.st', 2)!;
        expect(ctx.name).toBe('playsound');
        expect(ctx.argThusFar).toBe('sound:block.stone.st');
        expect(ctx.argPrefix).toBe('sound');
        expect(ctx.argValue).toBe('block.stone.st');
    });

    it('treats an argument without a colon as a bare value', () => {
        const ctx = parseCommandLine('- narrate hello wor', 2)!;
        expect(ctx.argThusFar).toBe('wor');
        expect(ctx.argPrefix).toBe('');
        expect(ctx.argValue).toBe('wor');
    });

    it('splits on the FIRST colon only, so values may contain colons', () => {
        const ctx = parseCommandLine('- run mytask def:a:b', 2)!;
        expect(ctx.argPrefix).toBe('def');
        expect(ctx.argValue).toBe('a:b');
    });

    it('skips a leading tilde and shifts the name range accordingly', () => {
        const ctx = parseCommandLine('- ~waituntil x', 2)!;
        expect(ctx.name).toBe('waituntil');
        expect(ctx.nameStart).toBe(5);
        expect(ctx.nameEnd).toBe(14);
    });

    it('returns null for a line that is not a command line', () => {
        expect(parseCommandLine('type: task', 2)).toBeNull();
        expect(parseCommandLine('', 0)).toBeNull();
        expect(parseCommandLine('-', 0)).toBeNull();
    });

    it('accounts for indentation in the name range', () => {
        const ctx = parseCommandLine('- narrate hi', 6)!;
        expect(ctx.nameStart).toBe(8);
        expect(ctx.nameEnd).toBe(15);
    });
});

describe('parseCursorContext', () => {
    it('parses the command line the cursor sits on', () => {
        const text = 'my_task:\n  type: task\n  script:\n  - playsound sound:amb';
        const ctx = parseCursorContext(text, text.length)!;
        expect(ctx.name).toBe('playsound');
        expect(ctx.argPrefix).toBe('sound');
        expect(ctx.argValue).toBe('amb');
    });

    it('returns null when the cursor is not on a command line', () => {
        const text = 'my_task:\n  type: task';
        expect(parseCursorContext(text, text.length)).toBeNull();
    });

    it('returns null for an out-of-range offset', () => {
        expect(parseCursorContext('  - narrate', 999)).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run src/server/providers/cursorContext.test.ts`
Expected: FAIL — cannot resolve `./cursorContext`.

- [ ] **Step 3: Write the implementation**

Create `src/server/providers/cursorContext.ts`:

```ts
/**
 * Parses the command context under the cursor, shared by the completion and hover
 * providers. Consolidates the line-walking that C# performs separately in
 * TextDocumentService.GetCompletionsFor (the `- ` branch) and GetHoverAt.
 */

import { getLineContext } from './lineContext';

/** What the cursor is looking at on a `- command args...` line. */
export interface CommandCursorContext {
    /** The command name, lowercased. May be a partial word while being typed. */
    name: string;
    /** True while the name itself is being typed — no space follows it yet. */
    typingName: boolean;
    /** Column on the line where the command name starts. */
    nameStart: number;
    /** Column one past the last character of the command name. */
    nameEnd: number;
    /** The whitespace-delimited argument the cursor sits in. Empty after a trailing space. */
    argThusFar: string;
    /** Text before the first `:` of `argThusFar`, or `''` when it has no colon. */
    argPrefix: string;
    /** Text after the first `:` of `argThusFar`, or all of it when it has no colon. */
    argValue: string;
}

/**
 * Parses an already-trimmed, already-lowercased command line.
 * `indent` is how many characters were trimmed from its left, so the returned
 * columns are relative to the full line.
 */
export function parseCommandLine(trimmed: string, indent: number): CommandCursorContext | null {
    if (!trimmed.startsWith('- ')) {
        return null;
    }
    let nameStart = indent + 2;
    let rest = trimmed.substring(2);
    if (rest.startsWith('~')) {
        rest = rest.substring(1);
        nameStart++;
    }
    const firstSpace = rest.indexOf(' ');
    const name = firstSpace === -1 ? rest : rest.substring(0, firstSpace);
    const typingName = firstSpace === -1;
    const argThusFar = typingName ? '' : rest.substring(rest.lastIndexOf(' ') + 1);
    const colon = argThusFar.indexOf(':');
    return {
        name,
        typingName,
        nameStart,
        nameEnd: nameStart + name.length,
        argThusFar,
        argPrefix: colon === -1 ? '' : argThusFar.substring(0, colon),
        argValue: colon === -1 ? argThusFar : argThusFar.substring(colon + 1)
    };
}

/** Parses the command context at `offset` within `text`, or null if the cursor is not on a command line. */
export function parseCursorContext(text: string, offset: number): CommandCursorContext | null {
    const line = getLineContext(text, offset);
    if (line === null) {
        return null;
    }
    return parseCommandLine(line.trimmed, line.indent);
}
```

- [ ] **Step 4: Rewrite `provideCompletions` to use it**

In `src/server/providers/completionProvider.ts`, replace the import of `getLineContext` with `parseCursorContext` from `./cursorContext`, and replace the body of `provideCompletions` with:

```ts
export function provideCompletions(docs: MetaDocs, text: string, offset: number): CompletionItem[] {
    const ctx = parseCursorContext(text, offset);
    if (ctx === null) {
        return [];
    }
    if (ctx.typingName) {
        return completeCommandNames(docs, ctx.name);
    }
    const command = docs.commands.get(ctx.name);
    if (command === undefined) {
        return [];
    }
    return completeCommandArguments(command, ctx.argThusFar);
}
```

Leave `completeCommandNames` and `completeCommandArguments` unchanged. Every existing test in `completionProvider.test.ts` must still pass untouched — if any fails, that is a real behavioural difference; report it rather than editing the test.

- [ ] **Step 5: Rewrite the command branch of `provideHover` to use it**

In `src/server/providers/hoverProvider.ts`, replace the hand-rolled command-name extraction with `parseCommandLine`. Keep `getFullLine` — hover still needs the untrimmed line for the `type:` branch's range. The command branch becomes:

```ts
    const cmdCtx = parseCommandLine(trimmed, indent);
    if (cmdCtx !== null) {
        if (!COMMAND_NAME_PATTERN.test(cmdCtx.name)) {
            return null;
        }
        if (character < cmdCtx.nameStart || character > cmdCtx.nameEnd) {
            return null;
        }
        const command = docs.commands.get(cmdCtx.name);
        if (command === undefined) {
            return null;
        }
        return {
            contents: describeCommand(command),
            range: { start: { line, character: cmdCtx.nameStart }, end: { line, character: cmdCtx.nameEnd } }
        };
    }
```

Add the `parseCommandLine` import. Leave the `type:` branch exactly as it is. Every existing test in `hoverProvider.test.ts` must still pass untouched.

- [ ] **Step 6: Run the full suite**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS — all 111 previous tests plus the 11 new ones.

- [ ] **Step 7: Verify compilation**

Run: `node node_modules/typescript/bin/tsc -p ./ --skipLibCheck`
Expected: no output, exit code 0.

- [ ] **Step 8: Commit**

```bash
git add src/server/providers/cursorContext.ts src/server/providers/cursorContext.test.ts src/server/providers/completionProvider.ts src/server/providers/hoverProvider.ts
git commit -m "refactor: extract shared cursor context parser for both providers"
```

---

### Task 2: Minecraft enum data loading

Ports `SharpDenizenTools/MetaHandlers/ExtraData.cs`. The C# uses a full FDS parser; the document is flat, so a purpose-built reader is correct here and far smaller.

**Files:**
- Create: `src/server/metaDocs/extraData.ts`
- Test: `src/server/metaDocs/extraData.test.ts`

**Interfaces:**
- Consumes: `downloadBinary` from `./metaLoader` (already exists, follows redirects).
- Produces:
  - `export interface ExtraData { blocks: Set<string>; items: Set<string>; particles: Set<string>; effects: Set<string>; sounds: Set<string>; entities: Set<string>; enchantments: Set<string>; biomes: Set<string>; attributes: Set<string>; gamerules: Set<string>; potionEffects: Set<string>; potions: Set<string>; statistics: Set<string>; materials: Set<string>; all: Set<string>; }`
  - `EXTRA_DATA_SOURCE: string`
  - `parseFlatFds(content: string): Map<string, string[]>`
  - `buildExtraData(sections: Map<string, string[]>): ExtraData`
  - `createEmptyExtraData(): ExtraData`
  - `loadExtraData(options: { cacheFile: string; ttlMs: number; source?: string }): Promise<ExtraData>`

- [ ] **Step 1: Write the failing test**

Create `src/server/metaDocs/extraData.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseFlatFds, buildExtraData, createEmptyExtraData } from './extraData';

const SAMPLE = [
    'biomes:',
    '- BADLANDS',
    '- BEACH',
    'sounds:',
    '- BLOCK.STONE.STEP',
    '- AMBIENT.CAVE',
    'blocks:',
    '- STONE',
    'items:',
    '- STICK',
    '- STONE',
    ''
].join('\n');

describe('parseFlatFds', () => {
    it('groups list entries under their preceding key', () => {
        const sections = parseFlatFds(SAMPLE);
        expect(sections.get('biomes')).toEqual(['BADLANDS', 'BEACH']);
        expect(sections.get('sounds')).toEqual(['BLOCK.STONE.STEP', 'AMBIENT.CAVE']);
    });

    it('ignores blank lines and stray text', () => {
        const sections = parseFlatFds('biomes:\n- BEACH\n\ngarbage without a dash\n- PLAINS\n');
        expect(sections.get('biomes')).toEqual(['BEACH', 'PLAINS']);
    });

    it('returns an empty map for empty input', () => {
        expect(parseFlatFds('').size).toBe(0);
    });

    it('handles CRLF line endings', () => {
        const sections = parseFlatFds('biomes:\r\n- BEACH\r\n');
        expect(sections.get('biomes')).toEqual(['BEACH']);
    });
});

describe('buildExtraData', () => {
    it('lowercases every value, matching the C# GetDataSet behaviour', () => {
        const data = buildExtraData(parseFlatFds(SAMPLE));
        expect(data.sounds.has('block.stone.step')).toBe(true);
        expect(data.sounds.has('BLOCK.STONE.STEP')).toBe(false);
    });

    it('derives materials as the union of blocks and items', () => {
        const data = buildExtraData(parseFlatFds(SAMPLE));
        expect([...data.materials].sort()).toEqual(['stick', 'stone']);
    });

    it('collects every value into `all`', () => {
        const data = buildExtraData(parseFlatFds(SAMPLE));
        expect(data.all.has('badlands')).toBe(true);
        expect(data.all.has('ambient.cave')).toBe(true);
    });

    it('yields empty sets for sections the document omits', () => {
        const data = buildExtraData(parseFlatFds('biomes:\n- BEACH\n'));
        expect(data.sounds.size).toBe(0);
        expect(data.statistics.size).toBe(0);
    });
});

describe('createEmptyExtraData', () => {
    it('produces every set empty', () => {
        const data = createEmptyExtraData();
        expect(data.sounds.size).toBe(0);
        expect(data.materials.size).toBe(0);
        expect(data.all.size).toBe(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run src/server/metaDocs/extraData.test.ts`
Expected: FAIL — cannot resolve `./extraData`.

- [ ] **Step 3: Write the implementation**

Create `src/server/metaDocs/extraData.ts`:

```ts
/**
 * Minecraft enum data (sounds, materials, entities, …) used to complete command
 * argument values. Ported from SharpDenizenTools/MetaHandlers/ExtraData.cs.
 *
 * The C# reads the document with a general FDS parser. The published document is
 * entirely flat — every line is either a top-level `key:` or a `- value` entry,
 * with no nesting anywhere — so a purpose-built reader is used here instead.
 */

import * as fs from 'fs';
import * as path from 'path';
import { downloadBinary } from './metaLoader';

export const EXTRA_DATA_SOURCE = 'https://meta.denizenscript.com/data/minecraft.fds';

export interface ExtraData {
    blocks: Set<string>;
    items: Set<string>;
    particles: Set<string>;
    effects: Set<string>;
    sounds: Set<string>;
    entities: Set<string>;
    enchantments: Set<string>;
    biomes: Set<string>;
    attributes: Set<string>;
    gamerules: Set<string>;
    potionEffects: Set<string>;
    potions: Set<string>;
    statistics: Set<string>;
    /** Union of blocks and items. Not a document section — derived, as in C#. */
    materials: Set<string>;
    /** Every value from every section, for the script checker's keyword collision test. */
    all: Set<string>;
}

export function createEmptyExtraData(): ExtraData {
    return {
        blocks: new Set(), items: new Set(), particles: new Set(), effects: new Set(),
        sounds: new Set(), entities: new Set(), enchantments: new Set(), biomes: new Set(),
        attributes: new Set(), gamerules: new Set(), potionEffects: new Set(), potions: new Set(),
        statistics: new Set(), materials: new Set(), all: new Set()
    };
}

/** Reads the flat `key:` / `- value` document into section name -> raw values. */
export function parseFlatFds(content: string): Map<string, string[]> {
    const sections = new Map<string, string[]>();
    let current: string[] | null = null;
    for (const rawLine of content.split('\n')) {
        const line = rawLine.endsWith('\r') ? rawLine.substring(0, rawLine.length - 1) : rawLine;
        if (line.startsWith('- ')) {
            if (current !== null) {
                current.push(line.substring(2).trim());
            }
            continue;
        }
        if (line.endsWith(':') && line.length > 1 && !line.startsWith(' ')) {
            current = [];
            sections.set(line.substring(0, line.length - 1).toLowerCase(), current);
        }
    }
    return sections;
}

function setOf(sections: Map<string, string[]>, key: string, all: Set<string>): Set<string> {
    const result = new Set<string>();
    for (const value of sections.get(key) ?? []) {
        if (value.length > 0) {
            const lowered = value.toLowerCase();
            result.add(lowered);
            all.add(lowered);
        }
    }
    return result;
}

export function buildExtraData(sections: Map<string, string[]>): ExtraData {
    const all = new Set<string>();
    const blocks = setOf(sections, 'blocks', all);
    const items = setOf(sections, 'items', all);
    return {
        blocks,
        items,
        particles: setOf(sections, 'particles', all),
        effects: setOf(sections, 'effects', all),
        sounds: setOf(sections, 'sounds', all),
        entities: setOf(sections, 'entities', all),
        enchantments: setOf(sections, 'enchantments', all),
        biomes: setOf(sections, 'biomes', all),
        attributes: setOf(sections, 'attributes', all),
        gamerules: setOf(sections, 'gamerules', all),
        potionEffects: setOf(sections, 'potion_effects', all),
        potions: setOf(sections, 'potions', all),
        statistics: setOf(sections, 'statistics', all),
        materials: new Set([...blocks, ...items]),
        all
    };
}

/**
 * Loads the enum data, preferring a cache file younger than `ttlMs`.
 * Never throws: on any failure it returns whatever it has, falling back to empty
 * sets, because argument-value completion degrading to nothing is far better
 * than the whole language server failing to start.
 */
export async function loadExtraData(options: { cacheFile: string; ttlMs: number; source?: string }): Promise<ExtraData> {
    const source = options.source ?? EXTRA_DATA_SOURCE;
    try {
        if (fs.existsSync(options.cacheFile)) {
            const age = Date.now() - fs.statSync(options.cacheFile).mtimeMs;
            if (age < options.ttlMs) {
                return buildExtraData(parseFlatFds(fs.readFileSync(options.cacheFile, 'utf8')));
            }
        }
    }
    catch {
        // fall through to a fresh download
    }
    try {
        const content = (await downloadBinary(source)).toString('utf8');
        const data = buildExtraData(parseFlatFds(content));
        if (data.all.size > 0) {
            fs.mkdirSync(path.dirname(options.cacheFile), { recursive: true });
            fs.writeFileSync(options.cacheFile, content);
        }
        return data;
    }
    catch {
        return createEmptyExtraData();
    }
}
```

- [ ] **Step 4: Run the full suite**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS.

- [ ] **Step 5: Verify compilation**

Run: `node node_modules/typescript/bin/tsc -p ./ --skipLibCheck`
Expected: no output, exit code 0.

- [ ] **Step 6: Verify against the real document**

Run:
```bash
node node_modules/typescript/bin/tsc -p ./ --skipLibCheck && node -e "
const os=require('os'),path=require('path');
const {loadExtraData}=require('./out/server/metaDocs/extraData');
loadExtraData({cacheFile:path.join(os.tmpdir(),'denizen-extradata-verify.fds'),ttlMs:0}).then(d=>{
  console.log('sounds',d.sounds.size,'items',d.items.size,'blocks',d.blocks.size,'materials',d.materials.size,'all',d.all.size);
  console.log('block.stone.step present:', d.sounds.has('block.stone.step'));
  console.log('sample sounds:', [...d.sounds].slice(0,3).join(', '));
});"
```
Expected: `sounds 1728`, `items 1416`, `blocks 1105`, and `block.stone.step present: true`. Paste the real output. If the counts differ from the plan's stated figures the upstream document changed — report the new numbers, do not edit the check.

- [ ] **Step 7: Commit**

```bash
git add src/server/metaDocs/extraData.ts src/server/metaDocs/extraData.test.ts
git commit -m "feat: load Minecraft enum data for argument value completion"
```

---

### Task 3: Argument value completer registry

Ports the `ByCommand` registration table from `DenizenLangServer/CommandTabCompletions.cs:46-96`. Only the entries backed by `ExtraData` are in scope — those needing workspace script lookup (`SuggestScriptByType`) or the tag system belong to later phases.

**Files:**
- Create: `src/server/providers/argumentCompleters.ts`
- Test: `src/server/providers/argumentCompleters.test.ts`

**Interfaces:**
- Consumes: `ExtraData` from `../metaDocs/extraData`.
- Produces:
  - `export interface EnumCompleter { prefix: string; label: string; values: (data: ExtraData) => Set<string>; }`
  - `COMMAND_VALUE_COMPLETERS: Map<string, EnumCompleter[]>`
  - `findEnumCompleter(commandName: string, argPrefix: string): EnumCompleter | null`

- [ ] **Step 1: Write the failing test**

Create `src/server/providers/argumentCompleters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { findEnumCompleter, COMMAND_VALUE_COMPLETERS } from './argumentCompleters';
import { buildExtraData, parseFlatFds } from '../metaDocs/extraData';

const DATA = buildExtraData(parseFlatFds([
    'sounds:', '- BLOCK.STONE.STEP',
    'blocks:', '- STONE',
    'items:', '- STICK',
    'entities:', '- ZOMBIE',
    'particles:', '- FLAME',
    'effects:', '- SMOKE',
    'potion_effects:', '- SPEED',
    'statistics:', '- JUMP',
    ''
].join('\n')));

describe('findEnumCompleter', () => {
    it('matches playsound on its sound prefix', () => {
        const completer = findEnumCompleter('playsound', 'sound')!;
        expect(completer.label).toBe('Sound Enum');
        expect(completer.values(DATA).has('block.stone.step')).toBe(true);
    });

    it('matches modifyblock on its empty prefix', () => {
        const completer = findEnumCompleter('modifyblock', '')!;
        expect(completer.values(DATA).has('stone')).toBe(true);
    });

    it('matches cast on potion effects', () => {
        expect(findEnumCompleter('cast', '')!.values(DATA).has('speed')).toBe(true);
    });

    it('matches statistic', () => {
        expect(findEnumCompleter('statistic', '')!.values(DATA).has('jump')).toBe(true);
    });

    it('returns null for a command with no registered completer', () => {
        expect(findEnumCompleter('narrate', '')).toBeNull();
    });

    it('returns null when the prefix does not match a registered one', () => {
        expect(findEnumCompleter('playsound', 'volume')).toBeNull();
    });

    it('is keyed by lowercase command name', () => {
        expect(findEnumCompleter('PLAYSOUND', 'sound')).not.toBeNull();
    });
});

describe('COMMAND_VALUE_COMPLETERS', () => {
    it('registers every command the C# ByCommand table backs with ExtraData', () => {
        for (const name of ['modifyblock', 'showfake', 'playeffect', 'playsound', 'cast', 'statistic']) {
            expect(COMMAND_VALUE_COMPLETERS.has(name)).toBe(true);
        }
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run src/server/providers/argumentCompleters.test.ts`
Expected: FAIL — cannot resolve `./argumentCompleters`.

- [ ] **Step 3: Write the implementation**

Create `src/server/providers/argumentCompleters.ts`:

```ts
/**
 * Which command arguments take a value from a fixed Minecraft enum.
 * Ported from the ByCommand registrations in
 * DenizenLangServer/CommandTabCompletions.cs (static constructor, lines 46-96).
 *
 * Only the ExtraData-backed entries are here. The registrations that resolve
 * against workspace scripts (SuggestScriptByType) or the tag system need
 * machinery that does not exist yet and arrive in later phases.
 */

import { ExtraData } from '../metaDocs/extraData';

/** One `command + prefix -> enum` registration. */
export interface EnumCompleter {
    /** The argument prefix this applies to. `''` means a bare, unprefixed argument. */
    prefix: string;
    /** Human-readable name of the enum, shown in the completion detail. */
    label: string;
    /** The candidate values, drawn from the loaded enum data. */
    values: (data: ExtraData) => Set<string>;
}

function register(map: Map<string, EnumCompleter[]>, commands: string[], completer: EnumCompleter): void {
    for (const command of commands) {
        const existing = map.get(command);
        if (existing === undefined) {
            map.set(command, [completer]);
        }
        else {
            existing.push(completer);
        }
    }
}

function build(): Map<string, EnumCompleter[]> {
    const map = new Map<string, EnumCompleter[]>();
    register(map, ['modifyblock', 'showfake'], { prefix: '', label: 'Block Material', values: d => d.blocks });
    register(map, ['create', 'spawn', 'fakespawn'], { prefix: '', label: 'Entity Type', values: d => d.entities });
    register(map, ['disguise'], { prefix: 'as', label: 'Entity Type', values: d => d.entities });
    register(map, ['playeffect'], { prefix: 'effect', label: 'Particle Effect', values: d => new Set([...d.particles, ...d.effects]) });
    register(map, ['playsound'], { prefix: 'sound', label: 'Sound Enum', values: d => d.sounds });
    register(map, ['give', 'fakeitem', 'displayitem', 'drop', 'itemcooldown'], { prefix: '', label: 'Item', values: d => d.items });
    register(map, ['take'], { prefix: 'item', label: 'Item', values: d => d.items });
    register(map, ['cast'], { prefix: '', label: 'Potion Effect Type', values: d => d.potionEffects });
    register(map, ['statistic'], { prefix: '', label: 'Statistic', values: d => d.statistics });
    return map;
}

export const COMMAND_VALUE_COMPLETERS: Map<string, EnumCompleter[]> = build();

/** The enum backing `commandName`'s `argPrefix` argument, or null when there is none. */
export function findEnumCompleter(commandName: string, argPrefix: string): EnumCompleter | null {
    const completers = COMMAND_VALUE_COMPLETERS.get(commandName.toLowerCase());
    if (completers === undefined) {
        return null;
    }
    return completers.find(c => c.prefix === argPrefix.toLowerCase()) ?? null;
}
```

- [ ] **Step 4: Run the full suite**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS.

- [ ] **Step 5: Verify compilation**

Run: `node node_modules/typescript/bin/tsc -p ./ --skipLibCheck`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/server/providers/argumentCompleters.ts src/server/providers/argumentCompleters.test.ts
git commit -m "feat: register enum-backed command argument completers"
```

---

### Task 4: Serve enum values from the completion provider

Wires Tasks 1-3 together so typing `- playsound sound:` actually lists sounds.

**Files:**
- Modify: `src/server/providers/completionProvider.ts`
- Modify: `src/server/providers/completionProvider.test.ts`
- Modify: `src/server/server.ts`

**Interfaces:**
- Consumes: `parseCursorContext` (Task 1), `ExtraData`/`loadExtraData`/`createEmptyExtraData` (Task 2), `findEnumCompleter` (Task 3).
- Produces: `provideCompletions(docs: MetaDocs, extra: ExtraData, text: string, offset: number): CompletionItem[]` — note the added `extra` parameter.

- [ ] **Step 1: Write the failing test**

Append to `src/server/providers/completionProvider.test.ts`:

```ts
describe('enum-backed argument value completion', () => {
    const EXTRA = buildExtraData(parseFlatFds([
        'sounds:', '- BLOCK.STONE.STEP', '- BLOCK.STONE.BREAK', '- AMBIENT.CAVE',
        'blocks:', '- STONE', '- STONE_BRICKS',
        ''
    ].join('\n')));

    function playsoundDocs(): MetaDocs {
        return docsWith(makeCommand('playsound',
            'playsound [<location>|...] [sound:<name>] (volume:<#.#>)', 'Plays a sound.'));
    }

    it('offers sound names after the sound: prefix', () => {
        const text = '  - playsound <player.location> sound:block.stone.';
        const labels = provideCompletions(playsoundDocs(), EXTRA, text, text.length).map(i => i.label);
        expect(labels).toContain('block.stone.step');
        expect(labels).toContain('block.stone.break');
        expect(labels).not.toContain('ambient.cave');
    });

    it('offers every sound when nothing follows the prefix yet', () => {
        const text = '  - playsound sound:';
        const labels = provideCompletions(playsoundDocs(), EXTRA, text, text.length).map(i => i.label);
        expect(labels.sort()).toEqual(['ambient.cave', 'block.stone.break', 'block.stone.step']);
    });

    it('labels enum results with the enum name', () => {
        const text = '  - playsound sound:ambient';
        const item = provideCompletions(playsoundDocs(), EXTRA, text, text.length)[0];
        expect(item.kind).toBe(CompletionItemKind.Enum);
        expect(String((item.documentation as { value: string }).value)).toContain('Sound Enum');
    });

    it('still offers the command\'s own argument names when no colon is typed', () => {
        const text = '  - playsound vol';
        const labels = provideCompletions(playsoundDocs(), EXTRA, text, text.length).map(i => i.label);
        expect(labels).toContain('volume:');
    });

    it('offers nothing extra for a prefix with no registered enum', () => {
        const text = '  - playsound volume:0.';
        expect(provideCompletions(playsoundDocs(), EXTRA, text, text.length)).toEqual([]);
    });
});
```

Add to the file's existing imports: `import { buildExtraData, parseFlatFds } from '../metaDocs/extraData';`. Every pre-existing test in this file must be updated to pass `createEmptyExtraData()` as the new second argument — import that too. Do not change any pre-existing assertion.

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run src/server/providers/completionProvider.test.ts`
Expected: FAIL — `provideCompletions` does not accept an `extra` argument / enum results missing.

- [ ] **Step 3: Write the implementation**

In `src/server/providers/completionProvider.ts` add these imports:

```ts
import { ExtraData } from '../metaDocs/extraData';
import { findEnumCompleter } from './argumentCompleters';
```

Add this function above `provideCompletions`:

```ts
/** Values of the enum backing this command argument, filtered by what has been typed. */
export function completeEnumValues(extra: ExtraData, commandName: string, argPrefix: string, argValue: string): CompletionItem[] {
    const completer = findEnumCompleter(commandName, argPrefix);
    if (completer === null) {
        return [];
    }
    const results: CompletionItem[] = [];
    for (const value of completer.values(extra)) {
        if (value.startsWith(argValue)) {
            results.push({
                label: value,
                kind: CompletionItemKind.Enum,
                documentation: { kind: MarkupKind.Markdown, value: `**${completer.label}**: ${value}` }
            });
        }
    }
    return results;
}
```

Extend the `vscode-languageserver` import to include `MarkupKind`. Then replace `provideCompletions` with:

```ts
export function provideCompletions(docs: MetaDocs, extra: ExtraData, text: string, offset: number): CompletionItem[] {
    const ctx = parseCursorContext(text, offset);
    if (ctx === null) {
        return [];
    }
    if (ctx.typingName) {
        return completeCommandNames(docs, ctx.name);
    }
    // C# merges both sources rather than choosing one (TextDocumentService.cs:362-367
    // appends the ByCommand completer's output onto the argument-name results), and the
    // order matters: argument names first, enum values after. Returning only the enum
    // results would hide a command's own arguments behind any bare-prefix enum — e.g.
    // `- give q` would list quartz items but swallow `quantity:`.
    const command = docs.commands.get(ctx.name);
    const argResults = command === undefined ? [] : completeCommandArguments(command, ctx.argThusFar);
    return [...argResults, ...completeEnumValues(extra, ctx.name, ctx.argPrefix, ctx.argValue)];
}
```

- [ ] **Step 4: Wire the data into the server**

In `src/server/server.ts`:

Add imports:
```ts
import { ExtraData, createEmptyExtraData, loadExtraData } from './metaDocs/extraData';
```

Add the cache path helper next to `getMetaCacheFile`:
```ts
function getExtraDataCacheFile(): string {
    const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'DenizenVSCodeExtension', 'cache', 'minecraft.fds');
}
```

Add module state next to `loadedDocs`:
```ts
/** Minecraft enum data. Starts empty so completion degrades gracefully while loading. */
let loadedExtra: ExtraData = createEmptyExtraData();
```

The enum data is independent of the meta docs, so load it alongside rather than chained. Immediately after the existing `connection.workspace.getConfiguration(...)` chain inside `onInitialized`, add:

```ts
        loadExtraData({ cacheFile: getExtraDataCacheFile(), ttlMs: EXTRA_DATA_TTL_MS })
            .then(extra => {
                loadedExtra = extra;
                connection.console.log(`Minecraft enum data loaded: ${extra.sounds.size} sounds, ${extra.materials.size} materials, ${extra.entities.size} entities.`);
            })
            .catch(err => {
                connection.console.error(`Minecraft enum data load failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
            });
```

Add the constant next to `META_CACHE_TTL_MS`:
```ts
/** C# refreshes this document every 15 days (ExtraData.cs:51); match that. */
const EXTRA_DATA_TTL_MS = 15 * 24 * 60 * 60 * 1000;
```

Update the `onCompletion` handler's call to pass the data:
```ts
            return provideCompletions(loadedDocs, loadedExtra, doc.getText(), doc.offsetAt(params.position));
```

- [ ] **Step 5: Run the full suite**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS.

- [ ] **Step 6: Verify compilation**

Run: `node node_modules/typescript/bin/tsc -p ./ --skipLibCheck`
Expected: no output, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add src/server/providers/completionProvider.ts src/server/providers/completionProvider.test.ts src/server/server.ts
git commit -m "feat: complete command argument values from Minecraft enums"
```

---

### Task 5: Live end-to-end verification

**Files:**
- Create: `scripts/verify-phase2b1.js`

- [ ] **Step 1: Write the verification script**

Create `scripts/verify-phase2b1.js`:

```js
/**
 * Live verification for Phase 2B-1: loads real Denizen meta AND real Minecraft enum
 * data over the network, then exercises argument value completion against both.
 * Run with: node scripts/verify-phase2b1.js
 */
const path = require('path');
const os = require('os');
const { loadMetaDocs, DEFAULT_META_SOURCES } = require('../out/server/metaDocs/metaDocsManager');
const { loadExtraData } = require('../out/server/metaDocs/extraData');
const { provideCompletions } = require('../out/server/providers/completionProvider');

function check(label, condition, detail) {
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
    return condition ? 0 : 1;
}

Promise.all([
    loadMetaDocs({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2a-verify-cache.json'), ttlMs: 12 * 60 * 60 * 1000, sources: DEFAULT_META_SOURCES }),
    loadExtraData({ cacheFile: path.join(os.tmpdir(), 'denizen-phase2b1-verify.fds'), ttlMs: 15 * 24 * 60 * 60 * 1000 })
]).then(([docs, extra]) => {
    console.log(`Loaded ${docs.commands.size} commands, ${docs.loadErrors.length} meta error(s).`);
    console.log(`Enum data: ${extra.sounds.size} sounds, ${extra.materials.size} materials, ${extra.entities.size} entities, ${extra.items.size} items.`);
    let failures = 0;

    failures += check('sounds loaded', extra.sounds.size > 1000, `${extra.sounds.size}`);
    failures += check('block.stone.step present', extra.sounds.has('block.stone.step'));

    const soundText = '  - playsound <player.location> sound:block.stone.';
    const sounds = provideCompletions(docs, extra, soundText, soundText.length);
    failures += check('playsound sound: completes real sounds',
        sounds.length > 0 && sounds.every(i => i.label.startsWith('block.stone.')),
        `${sounds.length} item(s), e.g. ${sounds.slice(0, 3).map(i => i.label).join(', ')}`);

    const castText = '  - cast spe';
    const cast = provideCompletions(docs, extra, castText, castText.length);
    failures += check('cast completes potion effects',
        cast.some(i => i.label === 'speed'),
        `${cast.length} item(s): ${cast.slice(0, 5).map(i => i.label).join(', ')}`);

    const blockText = '  - modifyblock <player.location> stone_b';
    const blocks = provideCompletions(docs, extra, blockText, blockText.length);
    failures += check('modifyblock completes block materials',
        blocks.length > 0,
        `${blocks.length} item(s): ${blocks.slice(0, 3).map(i => i.label).join(', ')}`);

    const nameText = 'my_task:\n  type: task\n  script:\n  - narr';
    failures += check('command name completion still works',
        provideCompletions(docs, extra, nameText, nameText.length).some(i => i.label === 'narrate'));

    const argText = '  - narrate hello for';
    failures += check('command argument completion still works',
        provideCompletions(docs, extra, argText, argText.length).some(i => i.label === 'format:'));

    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}).catch(err => {
    console.error('Verification failed to run:', err);
    process.exit(1);
});
```

- [ ] **Step 2: Compile**

Run: `node node_modules/typescript/bin/tsc -p ./ --skipLibCheck`
Expected: no output, exit code 0.

- [ ] **Step 3: Run it**

Run: `node scripts/verify-phase2b1.js`
Expected: every line PASS, ending `ALL CHECKS PASSED`, exit 0. Needs network; allow up to two minutes on a cold cache.

Paste the complete output. **If any check FAILs, do not adjust the check** — investigate the provider, report what you found, and stop.

- [ ] **Step 4: Run the full test suite**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-phase2b1.js
git commit -m "test: add live verification for argument value completion"
```

## Manual acceptance (for the user)

1. Reload the window with `denizenscript.server.engine` set to `typescript`.
2. Type `- playsound <player.location> sound:` inside a `script:` block — real sound names should appear, narrowing as you type `block.stone.`.
3. Type `- cast ` — potion effect names should appear.
4. Type `- modifyblock <player.location> ` — block material names should appear.
5. Confirm `- narr` still completes `narrate`, and hovering `narrate` still shows its docs.

## Out of scope (later phases)

- Tag completion and the `ByTag` table — needs `TagHelper`/`SingleTag`/`TagTracer`. **Phase 2B-2.**
- Event completion and hover — needs `EventTools`/`ScriptEventCouldMatcher`. **Phase 2B-3.**
- `SuggestScriptByType` registrations (`run`, `inject`, `zap`, `narrate format:`) — need workspace script tracking. **Phase 2D.**
- Flag completion and go-to-definition for flags. **Phase 2D.**
- `do_hover_docs` / `do_tab_completes` honouring via `didChangeConfiguration`. **Phase 2B-2.**
