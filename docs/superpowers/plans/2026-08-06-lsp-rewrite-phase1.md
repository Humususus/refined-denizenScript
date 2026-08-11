# LSP Rewrite Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript LSP server skeleton that downloads and parses Denizen's `<--[...]-->` meta documentation from the official source repos into an in-memory `MetaDocs` structure, cached to disk, and wire it into the VS Code client behind an opt-in setting — with zero user-facing features yet (that's Phase 2+).

**Architecture:** A new `src/server/` tree hosts a `vscode-languageserver`-based LSP server that runs in-process (IPC transport) instead of spawning the existing .NET server. Meta loading is split into three pure layers: `metaLoader.ts` (network download + zip/comment extraction, source-agnostic text processing), `metaObjectFactory.ts` (turns parsed `@key value` blocks into typed `MetaObject` instances), and `metaDocsManager.ts` (orchestration + disk caching). The existing C# server (`activateLanguageServer` in `src/extension.ts`) is left untouched and remains the default; a new `denizenscript.server.engine` setting (default `"csharp"`) opts a user into the new server.

**Tech Stack:** TypeScript (existing `tsc` compile, no bundler), `vscode-languageserver`/`vscode-languageserver-textdocument` (already a dependency), `adm-zip` (new dependency, for reading GitHub archive zips), Node's built-in `https` module for downloads (matches the existing pattern already used in `src/extension.ts` for `downloadFile`/`githubGetJson`), `vitest` (new dev dependency, this repo currently has zero automated tests).

## Global Constraints

- Work happens on the existing branch `feature/typescript-lsp-rewrite` (already checked out) — do not create a new branch.
- Commit after every task step group (per task), and push to `origin` after each commit (`git push origin feature/typescript-lsp-rewrite`) — per the user's stated working conditions in `LSP_REWRITE_PLAN.md`.
- The existing C# server and its activation path (`activateLanguageServer`, `server/DenizenLangServer.*`) must keep working exactly as before — this phase is strictly additive. Default behavior for existing users must not change.
- No hardcoded snippets are added in this phase (that's explicitly Phase 3+ / a separate concern already flagged in `LSP_REWRITE_PLAN.md`).
- Follow the existing code style already present in `src/extension.ts`: 4-space indent, `let`/`const`, explicit return types on exported functions, `camelCase` functions, PascalCase classes/interfaces.
- Phase 1 explicitly does **not** port: `PostCheck` cross-reference validation, `BuildSearchables`/`SearchHelper` weighted fuzzy-search indexing, `TagHelper.Parse`/`SingleTag` tag-syntax parsing, `ScriptEventCouldMatcher`/`EventTools.ParseMatchers` event-argument matching, `ExtraData` Minecraft data-value matcher functions (blocks/items/entities matching), and the beginner's-guide HTML scraper (`ReadGuides`, gated off by default in the C# version too via `LoadGuideData = false`). These support search/diagnostics/completion features that belong to later phases (`ContextAnalyzer`, `CompletionProvider`, `DiagnosticProvider`) per `LSP_REWRITE_PLAN.md`. Porting them now would be premature — nothing in Phase 1 consumes them.
- `MetaExtension` merging (patching an already-loaded object's fields with an extension block's values) **is** ported in this phase, since skipping it would leave the final `MetaDocs` data incomplete/incorrect for objects that use `<--[extension]-->` blocks.

---

## File Structure

```
extension/
├── package.json                                  [MODIFY] add adm-zip dep, vitest devDep, test script, new setting
├── src/
│   ├── extension.ts                               [MODIFY] add activateTsLanguageServer(), wire into activate()
│   ├── serverEngineSelector.ts                     [NEW] pure engine-choice logic (no vscode import → unit-testable)
│   ├── serverEngineSelector.test.ts                [NEW]
│   └── server/
│       ├── server.ts                               [NEW] LSP server entry point (createServer(), stdio/IPC bootstrap)
│       └── metaDocs/
│           ├── metaTypes.ts                        [MODIFY] MetaObject base class + 10 subclasses + MetaDocs container
│           ├── metaTypes.test.ts                    [NEW]
│           ├── metaLoader.ts                        [NEW] download + zip/comment extraction + block splitting
│           ├── metaLoader.test.ts                   [NEW]
│           ├── metaObjectFactory.ts                 [NEW] block → MetaObject construction/dispatch
│           ├── metaObjectFactory.test.ts            [NEW]
│           ├── metaDocsManager.ts                   [NEW] orchestration + disk cache with TTL
│           └── metaDocsManager.test.ts              [NEW]
```

Each meta-processing file has exactly one responsibility: `metaLoader` never knows what a `MetaObject` is (pure text/bytes in, block records out); `metaObjectFactory` never touches the network or disk; `metaDocsManager` composes the two and owns caching. This mirrors the C# source's separation (`MetaDocsLoader` vs `MetaObjects/*` vs cache handling in `ExtraData`/session setup) but as three focused files instead of fourteen, since TS doesn't need one-class-per-file the way the C# codebase does.

---

### Task 1: Test runner setup

**Files:**
- Modify: `package.json`
- Create: `src/server/metaDocs/.gitkeep` (placeholder so the directory exists in git before other tasks populate it — actually skip this, Task 3 creates a real file there immediately; no gitkeep needed)
- Create: `vitest.config.ts`
- Test: `src/smoke.test.ts`

**Interfaces:**
- Produces: a working `npm test` command that all later tasks' tests run under.

- [ ] **Step 1: Add vitest and adm-zip to package.json**

Edit `package.json`. In `"dependencies"`, add `"adm-zip": "^0.5.16"` (alphabetical order among existing deps):

```json
"dependencies": {
    "adm-zip": "^0.5.16",
    "vscode-languageclient": "^7.0.0",
    "vscode-languageserver": "^10.1.0",
    "vscode-languageserver-textdocument": "^1.0.12",
    "yaml": "^2.9.0"
},
```

In `"devDependencies"`, add `"@types/adm-zip": "^0.5.7"` and `"vitest": "^3.0.5"`:

```json
"devDependencies": {
    "@types/adm-zip": "^0.5.7",
    "@types/node": "^16.7.7",
    "@types/vscode": "^1.34.0",
    "@vscode/vsce": "^2.15.0",
    "typescript": "^4.9.5",
    "vitest": "^3.0.5"
},
```

In `"scripts"`, add a `test` entry:

```json
"scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./ --skipLibCheck",
    "package": "vsce package",
    "test": "vitest run"
},
```

- [ ] **Step 2: Install the new packages**

Run: `npm install`
Expected: `adm-zip`, `@types/adm-zip`, and `vitest` appear under `node_modules`, `package-lock.json` is updated. No errors.

- [ ] **Step 3: Add a vitest config**

Create `vitest.config.ts` at the extension root:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
        environment: 'node'
    }
});
```

- [ ] **Step 4: Write a smoke test**

Create `src/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('test runner smoke test', () => {
    it('runs and can assert', () => {
        expect(1 + 1).toBe(2);
    });
});
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `npm test`
Expected: 1 test file, 1 test, PASS.

- [ ] **Step 6: Commit and push**

```bash
git add package.json package-lock.json vitest.config.ts src/smoke.test.ts
git commit -m "chore: add vitest test runner and adm-zip dependency"
git push origin feature/typescript-lsp-rewrite
```

---

### Task 2: Meta object model (`metaTypes.ts`)

Replaces the existing stub (which has the wrong meta source URL and only plain interfaces, no behavior) with real classes ported from `SharpDenizenTools/MetaObjects/*.cs` and `MetaHandlers/MetaDocs.cs`. Scope: fields + `applyValue`/`addTo` only (see Global Constraints for what's excluded).

**Files:**
- Modify: `src/server/metaDocs/metaTypes.ts` (full rewrite)
- Test: `src/server/metaDocs/metaTypes.test.ts`

**Interfaces:**
- Produces: `MetaObject` (abstract base), `MetaCommand`, `MetaTag`, `MetaEvent`, `MetaMechanism`, `MetaProperty`, `MetaAction`, `MetaLanguage`, `MetaObjectType`, `MetaGuidePage`, `MetaExtension` classes — each with `applyValue(key: string, value: string): boolean` and `addTo(docs: MetaDocs): void`. `MetaDocs` interface (the container). `createEmptyMetaDocs(): MetaDocs`. `cleanTag(text: string): string` (standalone, used by both `MetaTag` and `MetaProperty`).
- Consumes: nothing (leaf module).

- [ ] **Step 1: Write failing tests for the base class and container**

Create `src/server/metaDocs/metaTypes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MetaCommand, MetaTag, MetaEvent, MetaMechanism, MetaProperty, MetaAction, MetaLanguage, MetaObjectType, createEmptyMetaDocs, cleanTag } from './metaTypes';

describe('createEmptyMetaDocs', () => {
    it('creates empty maps for every meta type', () => {
        const docs = createEmptyMetaDocs();
        expect(docs.commands.size).toBe(0);
        expect(docs.tags.size).toBe(0);
        expect(docs.events.size).toBe(0);
        expect(docs.mechanisms.size).toBe(0);
        expect(docs.properties.size).toBe(0);
        expect(docs.actions.size).toBe(0);
        expect(docs.languages.size).toBe(0);
        expect(docs.objectTypes.size).toBe(0);
        expect(docs.guidePages.size).toBe(0);
        expect(docs.extensions.size).toBe(0);
        expect(docs.loadErrors).toEqual([]);
    });
});

describe('MetaObject base applyValue', () => {
    it('applies group, warning, plugin, deprecated, synonyms', () => {
        const cmd = new MetaCommand();
        expect(cmd.applyValue('group', 'Player')).toBe(true);
        expect(cmd.group).toBe('Player');
        expect(cmd.applyValue('warning', 'be careful')).toBe(true);
        expect(cmd.warnings).toEqual(['be careful']);
        expect(cmd.applyValue('plugin', 'Denizen')).toBe(true);
        expect(cmd.plugin).toBe('Denizen');
        expect(cmd.applyValue('deprecated', 'use foo instead')).toBe(true);
        expect(cmd.deprecated).toBe('use foo instead');
        expect(cmd.applyValue('synonyms', 'alias1, Alias2 ,alias3')).toBe(true);
        expect(cmd.synonyms).toEqual(['alias1', 'alias2', 'alias3']);
    });

    it('rejects unknown keys by returning false', () => {
        const cmd = new MetaCommand();
        expect(cmd.applyValue('not_a_real_key', 'x')).toBe(false);
    });
});

describe('MetaCommand', () => {
    it('parses name, required, maximum, syntax, short, description, tags, usage, guide', () => {
        const cmd = new MetaCommand();
        cmd.applyValue('name', 'narrate');
        cmd.applyValue('required', '1');
        cmd.applyValue('maximum', '3');
        cmd.applyValue('syntax', 'narrate [<text>] (targets:<player>|...)');
        cmd.applyValue('short', 'Sends a message.');
        cmd.applyValue('description', 'Narrates text to the target(s).');
        cmd.applyValue('tags', '<player.name>\n<npc.name>');
        cmd.applyValue('usage', 'narrate "Hello world"');
        cmd.applyValue('guide', 'https://guide.denizenscript.com/x');
        expect(cmd.name).toBe('narrate');
        expect(cmd.cleanName).toBe('narrate');
        expect(cmd.required).toBe(1);
        expect(cmd.maximum).toBe(3);
        expect(cmd.tags).toEqual(['<player.name>', '<npc.name>']);
        expect(cmd.usages).toEqual(['narrate "Hello world"']);
        expect(cmd.guide).toBe('https://guide.denizenscript.com/x');
    });

    it('treats maximum -1 as unlimited', () => {
        const cmd = new MetaCommand();
        cmd.applyValue('maximum', '-1');
        expect(cmd.maximum).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('registers itself into docs.commands by clean name on addTo', () => {
        const docs = createEmptyMetaDocs();
        const cmd = new MetaCommand();
        cmd.applyValue('name', 'Narrate');
        cmd.addTo(docs);
        expect(docs.commands.get('narrate')).toBe(cmd);
    });
});

describe('cleanTag', () => {
    it('strips angle brackets and bracketed parameters', () => {
        expect(cleanTag('<player.flag[my_flag].value>')).toBe('player.flag.value');
        expect(cleanTag('<npc.name>')).toBe('npc.name');
    });
});

describe('MetaTag', () => {
    it('parses attribute into cleanedName/beforeDot/afterDotCleaned', () => {
        const tag = new MetaTag();
        tag.applyValue('attribute', '<PlayerTag.name>');
        tag.applyValue('returns', 'ElementTag');
        tag.applyValue('description', 'Returns the name.');
        expect(tag.name).toBe('<PlayerTag.name>');
        expect(tag.cleanName).toBe('playertag.name');
        expect(tag.beforeDot).toBe('PlayerTag');
        expect(tag.afterDotCleaned).toBe('name');
        expect(tag.returns).toBe('ElementTag');
    });

    it('defaults beforeDot to Base when there is no dot', () => {
        const tag = new MetaTag();
        tag.applyValue('attribute', '<player>');
        expect(tag.beforeDot).toBe('Base');
    });

    it('registers into docs.tags on addTo', () => {
        const docs = createEmptyMetaDocs();
        const tag = new MetaTag();
        tag.applyValue('attribute', '<PlayerTag.name>');
        tag.addTo(docs);
        expect(docs.tags.get('playertag.name')).toBe(tag);
    });
});

describe('MetaEvent', () => {
    it('parses events into events/cleanEvents/overlyCleanedEvents and tracks switches', () => {
        const evt = new MetaEvent();
        evt.applyValue('events', 'player breaks <block>\nplayer breaks block');
        evt.applyValue('triggers', 'when a player breaks a block');
        evt.applyValue('switch', 'material:<material> the block material\ncancelled:<boolean> whether the event is cancelled');
        evt.applyValue('cancellable', 'true');
        expect(evt.events).toEqual(['player breaks <block>', 'player breaks block']);
        expect(evt.name).toBe('player breaks <block>');
        expect(evt.cleanEvents.length).toBe(2);
        expect(evt.switchNames.has('material')).toBe(true);
        expect(evt.switchNames.has('cancelled')).toBe(true);
        expect(evt.cancellable).toBe(true);
    });

    it('registers into docs.events by first clean event name', () => {
        const docs = createEmptyMetaDocs();
        const evt = new MetaEvent();
        evt.applyValue('events', 'player breaks block');
        evt.applyValue('triggers', 'x');
        evt.addTo(docs);
        expect(docs.events.get('player breaks block')).toBe(evt);
    });
});

describe('MetaMechanism', () => {
    it('builds fullName from object + name on addTo', () => {
        const docs = createEmptyMetaDocs();
        const mech = new MetaMechanism();
        mech.applyValue('object', 'PlayerTag');
        mech.applyValue('name', 'money');
        mech.applyValue('input', 'ElementTag(Decimal)');
        mech.applyValue('description', 'Sets the player money.');
        mech.addTo(docs);
        expect(mech.fullName).toBe('PlayerTag.money');
        expect(docs.mechanisms.get('playertag.money')).toBe(mech);
    });
});

describe('MetaProperty', () => {
    it('generates a synthetic MetaMechanism and MetaTag on addTo', () => {
        const docs = createEmptyMetaDocs();
        const prop = new MetaProperty();
        prop.applyValue('object', 'ItemTag');
        prop.applyValue('name', 'display');
        prop.applyValue('input', 'ElementTag');
        prop.applyValue('description', 'Controls the display name.');
        prop.addTo(docs);
        expect(docs.mechanisms.get('itemtag.display')).toBeDefined();
        expect(docs.properties.get('itemtag.display')).toBe(prop);
        const generatedTag = [...docs.tags.values()].find(t => t.cleanName === 'itemtag.display');
        expect(generatedTag).toBeDefined();
        expect(generatedTag!.returns).toBe('ElementTag');
    });
});

describe('MetaAction', () => {
    it('parses actions list', () => {
        const action = new MetaAction();
        action.applyValue('actions', 'wins game\nloses game');
        expect(action.actions).toEqual(['wins game', 'loses game']);
        expect(action.cleanActions).toEqual(['wins game', 'loses game']);
    });
});

describe('MetaLanguage', () => {
    it('parses name and description', () => {
        const lang = new MetaLanguage();
        lang.applyValue('name', 'Player Flags');
        lang.applyValue('description', 'Explains player flags.');
        expect(lang.name).toBe('Player Flags');
        expect(lang.description).toBe('Explains player flags.');
    });
});

describe('MetaObjectType', () => {
    it('parses core object type fields', () => {
        const type = new MetaObjectType();
        type.applyValue('name', 'PlayerTag');
        type.applyValue('prefix', 'player');
        type.applyValue('base', 'EntityTag');
        type.applyValue('format', 'player@<uuid>');
        type.applyValue('description', 'Represents a player.');
        type.applyValue('implements', 'FlaggableObject, Adjustable');
        expect(type.typeName).toBe('PlayerTag');
        expect(type.prefix).toBe('player');
        expect(type.implementsNames).toEqual(['FlaggableObject', 'Adjustable']);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/metaDocs/metaTypes.test.ts`
Expected: FAIL — `metaTypes.ts` doesn't export any of these yet (or exports the old stub shape).

- [ ] **Step 3: Write the implementation**

Replace the full contents of `src/server/metaDocs/metaTypes.ts`:

```ts
/**
 * Meta documentation object model.
 * Ported from SharpDenizenTools/MetaObjects/*.cs and MetaHandlers/MetaDocs.cs.
 * Deliberately excludes PostCheck validation and BuildSearchables fuzzy-search
 * indexing (see Global Constraints in the Phase 1 plan) — those belong to
 * later phases that actually consume them.
 */

export interface MetaType {
    name: string;
    webPath: string | null;
}

export const META_TYPE_COMMAND: MetaType = { name: 'Command', webPath: 'Commands' };
export const META_TYPE_MECHANISM: MetaType = { name: 'Mechanism', webPath: 'Mechanisms' };
export const META_TYPE_EVENT: MetaType = { name: 'Event', webPath: 'Events' };
export const META_TYPE_ACTION: MetaType = { name: 'Action', webPath: 'Actions' };
export const META_TYPE_LANGUAGE: MetaType = { name: 'Language', webPath: 'Languages' };
export const META_TYPE_TAG: MetaType = { name: 'Tag', webPath: 'Tags' };
export const META_TYPE_OBJECT: MetaType = { name: 'ObjectType', webPath: 'ObjectTypes' };
export const META_TYPE_PROPERTY: MetaType = { name: 'Property', webPath: 'Properties' };
export const META_TYPE_GUIDEPAGE: MetaType = { name: 'GuidePage', webPath: null };
export const META_TYPE_EXTENSION: MetaType = { name: 'Extension', webPath: null };

/** Strips tag structural symbols (`<`, `>`, and bracketed parameters) for searchable/clean comparison. */
export function cleanTag(text: string): string {
    let cleaned = '';
    let skipping = false;
    for (const c of text) {
        if (c === '<' || c === '>') {
            continue;
        }
        if (c === '[') {
            skipping = true;
            continue;
        }
        if (c === ']') {
            skipping = false;
            continue;
        }
        if (skipping) {
            continue;
        }
        cleaned += c;
    }
    return cleaned;
}

/** Strips structural symbols from an event name for a searchable "overly cleaned" form. Skips `(optional)` words entirely. */
function overCleanEvent(evt: string): string {
    const parts = evt.toLowerCase().split(' ');
    const kept: string[] = [];
    for (const part of parts) {
        if (part.startsWith('(') && part.endsWith(')')) {
            continue;
        }
        kept.push(part.replace(/[<>'()]/g, ''));
    }
    return kept.join(' ').trim();
}

export abstract class MetaObject {
    type: MetaType | null = null;
    group: string | null = null;
    warnings: string[] = [];
    plugin: string | null = null;
    sourceFile: string = '';
    deprecated: string | null = null;
    synonyms: string[] = [];
    rawValues: Map<string, string[]> = new Map();

    abstract get name(): string;

    get cleanName(): string {
        return this.name.toLowerCase();
    }

    applyValue(key: string, value: string): boolean {
        switch (key) {
            case 'group':
                this.group = value;
                return true;
            case 'warning':
                this.warnings.push(value);
                return true;
            case 'plugin':
                this.plugin = value;
                return true;
            case 'deprecated':
                this.deprecated = value;
                return true;
            case 'synonyms':
                this.synonyms.push(...value.split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0));
                return true;
            default:
                return false;
        }
    }

    abstract addTo(docs: MetaDocs): void;
}

export class MetaCommand extends MetaObject {
    commandName: string = '';
    required: number = 0;
    maximum: number = Number.MAX_SAFE_INTEGER;
    syntax: string = '';
    short: string = '';
    description: string = '';
    tags: string[] = [];
    usages: string[] = [];
    guide: string = '';

    get name(): string {
        return this.commandName;
    }

    applyValue(key: string, value: string): boolean {
        switch (key) {
            case 'name':
                this.commandName = value;
                return true;
            case 'required': {
                const n = parseInt(value, 10);
                if (isNaN(n)) {
                    return false;
                }
                this.required = n;
                return true;
            }
            case 'maximum': {
                const n = parseInt(value, 10);
                if (isNaN(n)) {
                    return false;
                }
                this.maximum = n === -1 ? Number.MAX_SAFE_INTEGER : n;
                return true;
            }
            case 'syntax':
                this.syntax = value;
                return true;
            case 'short':
                this.short = value;
                return true;
            case 'description':
                this.description = value;
                return true;
            case 'tags':
                this.tags = value.split('\n').filter(s => s.length > 0);
                return true;
            case 'usage':
                this.usages.push(value);
                return true;
            case 'guide':
                this.guide = value;
                return true;
            default:
                return super.applyValue(key, value);
        }
    }

    addTo(docs: MetaDocs): void {
        docs.commands.set(this.cleanName, this);
    }
}

export class MetaTag extends MetaObject {
    tagFull: string = '';
    cleanedName: string = '';
    beforeDot: string = '';
    afterDotCleaned: string = '';
    returns: string = '';
    description: string = '';
    mechanism: string = '';
    examples: string[] = [];

    get name(): string {
        return this.tagFull;
    }

    get cleanName(): string {
        return this.cleanedName;
    }

    applyValue(key: string, value: string): boolean {
        switch (key) {
            case 'attribute': {
                this.tagFull = value;
                let cleaned = cleanTag(this.tagFull);
                if (cleaned.includes('.') && !cleaned.startsWith('&')) {
                    this.beforeDot = cleaned.substring(0, cleaned.indexOf('.'));
                }
                else {
                    this.beforeDot = 'Base';
                }
                cleaned = cleaned.toLowerCase();
                this.cleanedName = cleaned;
                const dotIndex = cleaned.indexOf('.');
                this.afterDotCleaned = dotIndex >= 0 ? cleaned.substring(dotIndex + 1) : '';
                return true;
            }
            case 'returns':
                this.returns = value;
                return true;
            case 'description':
                this.description = value;
                return true;
            case 'mechanism':
                this.mechanism = value;
                return true;
            case 'example':
                this.examples.push(value);
                return true;
            default:
                return super.applyValue(key, value);
        }
    }

    addTo(docs: MetaDocs): void {
        docs.tags.set(this.cleanName, this);
    }
}

export class MetaEvent extends MetaObject {
    events: string[] = [];
    cleanEvents: string[] = [];
    overlyCleanedEvents: string[] = [];
    switches: string[] = [];
    switchNames: Set<string> = new Set();
    triggers: string = '';
    context: string[] = [];
    determinations: string[] = [];
    player: string = '';
    npc: string = '';
    cancellable: boolean = false;
    hasLocation: boolean = false;
    examples: string[] = [];

    get name(): string {
        return this.events[0] ?? '';
    }

    get cleanName(): string {
        return this.cleanEvents[0] ?? '';
    }

    applyValue(key: string, value: string): boolean {
        switch (key) {
            case 'events':
                this.events = value.split('\n').filter(s => s.length > 0);
                this.cleanEvents = this.events.map(s => s.toLowerCase().replace(/[<>'()]/g, ''));
                this.overlyCleanedEvents = this.events.map(overCleanEvent);
                return true;
            case 'triggers':
                this.triggers = value;
                return true;
            case 'player':
                this.player = value;
                return true;
            case 'npc':
                this.npc = value;
                return true;
            case 'switch':
                for (const switchLine of value.split('\n').filter(s => s.length > 0)) {
                    this.switches.push(switchLine);
                    const beforeSpace = switchLine.split(' ')[0];
                    const switchName = beforeSpace.split(':')[0].toLowerCase();
                    this.switchNames.add(switchName);
                }
                return true;
            case 'context':
                this.context = value.split('\n').filter(s => s.length > 0);
                return true;
            case 'determine':
                this.determinations = value.split('\n').filter(s => s.length > 0);
                return true;
            case 'cancellable':
                this.cancellable = value.trim().toLowerCase() === 'true';
                return true;
            case 'location':
                this.hasLocation = value.trim().toLowerCase() === 'true';
                return true;
            case 'example':
                this.examples.push(value);
                return true;
            default:
                return super.applyValue(key, value);
        }
    }

    addTo(docs: MetaDocs): void {
        docs.events.set(this.cleanName, this);
    }
}

export class MetaMechanism extends MetaObject {
    fullName: string = '';
    mechObject: string = '';
    mechName: string = '';
    input: string = '';
    description: string = '';
    tags: string[] = [];
    examples: string[] = [];

    get name(): string {
        return this.fullName;
    }

    applyValue(key: string, value: string): boolean {
        switch (key) {
            case 'object':
                this.mechObject = value;
                return true;
            case 'name':
                this.mechName = value;
                return true;
            case 'input':
                this.input = value;
                return true;
            case 'description':
                this.description = value;
                return true;
            case 'tags':
                this.tags = value.split('\n').filter(s => s.length > 0);
                return true;
            case 'example':
                this.examples.push(value);
                return true;
            default:
                return super.applyValue(key, value);
        }
    }

    addTo(docs: MetaDocs): void {
        this.fullName = `${this.mechObject}.${this.mechName}`;
        docs.mechanisms.set(this.cleanName, this);
    }
}

export class MetaProperty extends MetaObject {
    fullName: string = '';
    propObject: string = '';
    propName: string = '';
    input: string = '';
    description: string = '';
    mechanismDescription: string = '';
    tagDescription: string = '';
    tagExamples: string[] = [];
    mechanismExamples: string[] = [];

    get name(): string {
        return this.fullName;
    }

    applyValue(key: string, value: string): boolean {
        switch (key) {
            case 'object':
                this.propObject = value;
                return true;
            case 'name':
                this.propName = value;
                return true;
            case 'input':
                this.input = value;
                return true;
            case 'description':
                this.description = value;
                return true;
            case 'example':
                this.tagExamples.push(value);
                this.mechanismExamples.push(value);
                return true;
            case 'tag-example':
                this.tagExamples.push(value);
                return true;
            case 'mechanism-example':
                this.mechanismExamples.push(value);
                return true;
            case 'tag':
                this.tagDescription = '\n' + value;
                return true;
            case 'mechanism':
                this.mechanismDescription = '\n' + value;
                return true;
            default:
                return super.applyValue(key, value);
        }
    }

    addTo(docs: MetaDocs): void {
        this.fullName = `${this.propObject}.${this.propName}`;
        docs.properties.set(this.cleanName, this);
        const asTag = `<${this.fullName}>`;
        const cleanedTag = cleanTag(asTag);
        const hasControls = this.description.startsWith('Controls');
        const cleanedDescription = hasControls ? this.description.substring('Controls'.length) : this.description;

        const mech = new MetaMechanism();
        mech.type = META_TYPE_MECHANISM;
        mech.mechName = this.propName;
        mech.mechObject = this.propObject;
        mech.input = this.input;
        mech.description = '(Property) ' + (hasControls ? 'Sets' : '') + cleanedDescription + this.mechanismDescription;
        mech.group = this.group ?? 'Properties';
        mech.warnings = this.warnings;
        mech.examples = this.mechanismExamples;
        mech.plugin = this.plugin;
        mech.sourceFile = this.sourceFile;
        mech.deprecated = this.deprecated;
        mech.synonyms = this.synonyms;
        mech.tags = [asTag];
        mech.addTo(docs);

        const tag = new MetaTag();
        tag.type = META_TYPE_TAG;
        tag.tagFull = asTag;
        tag.cleanedName = cleanedTag.toLowerCase();
        tag.beforeDot = cleanedTag.includes('.') ? cleanedTag.substring(0, cleanedTag.indexOf('.')) : 'Base';
        const cleanedTagLower = cleanedTag.toLowerCase();
        const dotIdx = cleanedTagLower.indexOf('.');
        tag.afterDotCleaned = dotIdx >= 0 ? cleanedTagLower.substring(dotIdx + 1) : '';
        tag.returns = this.input;
        tag.description = '(Property) ' + (hasControls ? 'Returns' : '') + cleanedDescription + this.tagDescription;
        tag.mechanism = this.fullName;
        tag.examples = this.tagExamples;
        tag.group = this.group ?? 'Properties';
        tag.warnings = this.warnings;
        tag.plugin = this.plugin;
        tag.sourceFile = this.sourceFile;
        tag.deprecated = this.deprecated;
        tag.synonyms = this.synonyms;
        tag.addTo(docs);
    }
}

export class MetaAction extends MetaObject {
    actions: string[] = [];
    cleanActions: string[] = [];
    triggers: string = '';
    context: string[] = [];
    determinations: string[] = [];

    get name(): string {
        return this.actions[0] ?? '';
    }

    get cleanName(): string {
        return this.cleanActions[0] ?? '';
    }

    applyValue(key: string, value: string): boolean {
        switch (key) {
            case 'actions':
                this.actions = value.split('\n').filter(s => s.length > 0);
                this.cleanActions = this.actions.map(s => s.toLowerCase());
                return true;
            case 'triggers':
                this.triggers = value;
                return true;
            case 'context':
                this.context = value.split('\n').filter(s => s.length > 0);
                return true;
            case 'determine':
                this.determinations = value.split('\n').filter(s => s.length > 0);
                return true;
            default:
                return super.applyValue(key, value);
        }
    }

    addTo(docs: MetaDocs): void {
        docs.actions.set(this.cleanName, this);
    }
}

export class MetaLanguage extends MetaObject {
    langName: string = '';
    description: string = '';

    get name(): string {
        return this.langName;
    }

    applyValue(key: string, value: string): boolean {
        switch (key) {
            case 'name':
                this.langName = value;
                return true;
            case 'description':
                this.description = value;
                return true;
            default:
                return super.applyValue(key, value);
        }
    }

    addTo(docs: MetaDocs): void {
        docs.languages.set(this.cleanName, this);
    }
}

export class MetaObjectType extends MetaObject {
    typeName: string = '';
    prefix: string = '';
    baseTypeName: string = '';
    format: string = '';
    description: string = '';
    implementsNames: string[] = [];
    generatedExampleTagBase: string | null = null;
    generatedExampleAdjust: string | null = null;
    exampleValues: string[] = [];
    matchable: string | null = null;

    get name(): string {
        return this.typeName;
    }

    get cleanName(): string {
        return this.typeName.toLowerCase();
    }

    applyValue(key: string, value: string): boolean {
        switch (key) {
            case 'name':
                this.typeName = value;
                return true;
            case 'prefix':
                this.prefix = value.toLowerCase();
                return true;
            case 'base':
                this.baseTypeName = value;
                return true;
            case 'format':
                this.format = value;
                return true;
            case 'description':
                this.description = value;
                return true;
            case 'implements':
                this.implementsNames = value.replace(/ /g, '').split(',');
                return true;
            case 'exampletagbase':
                this.generatedExampleTagBase = value;
                if (this.generatedExampleAdjust === null) {
                    this.generatedExampleAdjust = `<${this.generatedExampleTagBase}>`;
                }
                return true;
            case 'exampleadjustobject':
                this.generatedExampleAdjust = value;
                return true;
            case 'examplevalues':
                this.exampleValues = value.replace(/ /g, '').split(',');
                return true;
            case 'matchable':
                this.matchable = value;
                return true;
            default:
                return super.applyValue(key, value);
        }
    }

    addTo(docs: MetaDocs): void {
        docs.objectTypes.set(this.cleanName, this);
    }
}

export class MetaGuidePage extends MetaObject {
    pageName: string = '';
    url: string = '';
    isSubPage: boolean = false;

    get name(): string {
        return this.pageName;
    }

    addTo(docs: MetaDocs): void {
        docs.guidePages.set(this.cleanName, this);
    }
}

export class MetaExtension extends MetaObject {
    extensionName: string = '';
    extendType: string = '';
    extendName: string = '';
    includeExisting: boolean = true;

    get name(): string {
        return this.extensionName;
    }

    applyValue(key: string, value: string): boolean {
        switch (key) {
            case 'target_type':
                this.extendType = value;
                return true;
            case 'target_name':
                this.extendName = value;
                return true;
            case 'name':
                this.extensionName = value;
                return true;
            case 'include_existing':
                this.includeExisting = value.trim().toLowerCase() === 'true';
                return true;
            default:
                return true;
        }
    }

    addTo(docs: MetaDocs): void {
        docs.extensions.set(this.cleanName, this);
    }
}

export interface MetaDocs {
    commands: Map<string, MetaCommand>;
    mechanisms: Map<string, MetaMechanism>;
    tags: Map<string, MetaTag>;
    objectTypes: Map<string, MetaObjectType>;
    properties: Map<string, MetaProperty>;
    events: Map<string, MetaEvent>;
    actions: Map<string, MetaAction>;
    languages: Map<string, MetaLanguage>;
    guidePages: Map<string, MetaGuidePage>;
    extensions: Map<string, MetaExtension>;
    loadErrors: string[];
}

export function createEmptyMetaDocs(): MetaDocs {
    return {
        commands: new Map(),
        mechanisms: new Map(),
        tags: new Map(),
        objectTypes: new Map(),
        properties: new Map(),
        events: new Map(),
        actions: new Map(),
        languages: new Map(),
        guidePages: new Map(),
        extensions: new Map(),
        loadErrors: []
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/metaDocs/metaTypes.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Compile to catch type errors**

Run: `npm run compile`
Expected: no TypeScript errors.

- [ ] **Step 6: Commit and push**

```bash
git add src/server/metaDocs/metaTypes.ts src/server/metaDocs/metaTypes.test.ts
git commit -m "feat: port MetaObject class hierarchy from SharpDenizenTools"
git push origin feature/typescript-lsp-rewrite
```

---

### Task 3: Meta source download + block extraction (`metaLoader.ts`)

Ports `MetaDocsLoader.DownloadData`, `ReadLines`, `SeparateDataLines`, `LoadDataFromLines` (the block-splitting half only — object construction is Task 4), and `GetCorrectURL`. Pure text/bytes processing — no knowledge of `MetaObject`.

**Files:**
- Create: `src/server/metaDocs/metaLoader.ts`
- Test: `src/server/metaDocs/metaLoader.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `downloadBinary(url: string): Promise<Buffer>`, `extractJavaCommentLines(zipBuffer: Buffer): Array<[number, string, string]>` (line number, file path, comment text), `getCorrectUrl(webSource: string, file: string, line: number): string`, `MetaBlock` interface `{ objectType: string; url: string; data: string[] }`, `extractMetaBlocks(websrc: string, lines: Array<[number, string, string]>, loadErrors: string[]): MetaBlock[]`.

- [ ] **Step 1: Write failing tests**

Create `src/server/metaDocs/metaLoader.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { extractJavaCommentLines, getCorrectUrl, extractMetaBlocks } from './metaLoader';

describe('extractJavaCommentLines', () => {
    it('extracts trimmed // comment lines from .java entries only', () => {
        const zip = new AdmZip();
        zip.addFile('repo-dev/src/Foo.java', Buffer.from(
            'public class Foo {\n' +
            '    // <--[command]\n' +
            '    // @Name foo\n' +
            '    // -->\n' +
            '    int x = 1; // not a doc comment start but still starts with //\n' +
            '}\n'
        ));
        zip.addFile('repo-dev/README.md', Buffer.from('// this should be ignored, not a .java file\n'));
        const zipBuffer = zip.toBuffer();

        const lines = extractJavaCommentLines(zipBuffer);
        const texts = lines.map(l => l[2]);
        expect(texts).toContain('<--[command]');
        expect(texts).toContain('@Name foo');
        expect(texts).toContain('-->');
        expect(texts).not.toContain('this should be ignored, not a .java file');
        for (const [, file] of lines) {
            expect(file).toBe('repo-dev/src/Foo.java');
        }
    });

    it('produces an empty comment for a bare // line', () => {
        const zip = new AdmZip();
        zip.addFile('r/A.java', Buffer.from('//\n// text\n'));
        const lines = extractJavaCommentLines(zip.toBuffer());
        expect(lines[0][2]).toBe('');
        expect(lines[1][2]).toBe('text');
    });
});

describe('getCorrectUrl', () => {
    it('builds a github blob link for github archive sources', () => {
        const url = getCorrectUrl('https://github.com/DenizenScript/Denizen/archive/dev.zip', 'Denizen-dev/src/Foo.java', 42);
        expect(url).toBe('https://github.com/DenizenScript/Denizen/blob/dev/src/Foo.java#L42');
    });

    it('falls back to a plain description for non-github sources', () => {
        const url = getCorrectUrl('https://example.com/data.txt', 'data.txt', 5);
        expect(url).toBe('Web source https://example.com/data.txt file data.txt line 5');
    });
});

describe('extractMetaBlocks', () => {
    it('splits <--[type] ... --> blocks into objectType + data lines', () => {
        const lines: Array<[number, string, string]> = [
            [1, 'F.java', '<--[command]'],
            [2, 'F.java', '@Name narrate'],
            [3, 'F.java', '@Short Sends a message.'],
            [4, 'F.java', '-->'],
            [5, 'F.java', 'not part of any block'],
            [6, 'F.java', '<--[tag]'],
            [7, 'F.java', '@attribute <player.name>'],
            [8, 'F.java', '-->']
        ];
        const errors: string[] = [];
        const blocks = extractMetaBlocks('https://github.com/DenizenScript/Denizen/archive/dev.zip', lines, errors);
        expect(blocks.length).toBe(2);
        expect(blocks[0].objectType).toBe('command');
        expect(blocks[0].data).toEqual(['@Name narrate', '@Short Sends a message.', '@end_meta']);
        expect(blocks[1].objectType).toBe('tag');
        expect(blocks[1].data).toEqual(['@attribute <player.name>', '@end_meta']);
        expect(errors).toEqual([]);
    });

    it('records an error and skips a block that never closes', () => {
        const lines: Array<[number, string, string]> = [
            [1, 'A.java', '<--[command]'],
            [2, 'A.java', '@Name foo'],
            [3, 'B.java', 'this belongs to a different file']
        ];
        const errors: string[] = [];
        const blocks = extractMetaBlocks('src', lines, errors);
        expect(blocks.length).toBe(0);
        expect(errors.length).toBe(1);
    });

    it('records an error for a nested block start', () => {
        const lines: Array<[number, string, string]> = [
            [1, 'A.java', '<--[command]'],
            [2, 'A.java', '<--[tag]'],
            [3, 'A.java', '-->']
        ];
        const errors: string[] = [];
        const blocks = extractMetaBlocks('src', lines, errors);
        expect(errors.length).toBe(1);
    });

    it('records an error for a stray <-- that is not a valid start', () => {
        const lines: Array<[number, string, string]> = [[1, 'A.java', '<-- not valid']];
        const errors: string[] = [];
        extractMetaBlocks('src', lines, errors);
        expect(errors.length).toBe(1);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/metaDocs/metaLoader.test.ts`
Expected: FAIL — `metaLoader.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/server/metaDocs/metaLoader.ts`:

```ts
/**
 * Meta source loading: downloading source archives and splitting their
 * `<--[type] ... -->` doc comments into raw blocks. Ported from
 * SharpDenizenTools/MetaHandlers/MetaDocsLoader.cs. Pure text/bytes
 * processing — has no knowledge of MetaObject classes.
 */

import * as https from 'https';
import AdmZip from 'adm-zip';

/** Downloads a URL's raw bytes, following redirects, matching the pattern already used in src/extension.ts's downloadFile(). */
export function downloadBinary(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: { 'User-Agent': 'DenizenMetaScanner/1.0' }
        }, response => {
            if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                downloadBinary(response.headers.location).then(resolve, reject);
                return;
            }
            if (response.statusCode !== 200) {
                reject(new Error(`Source download returned HTTP ${response.statusCode} for ${url}`));
                response.resume();
                return;
            }
            const chunks: Buffer[] = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
    });
}

/** Extracts trimmed `//`-prefixed comment lines from every `.java` file entry in a zip archive. Returns tuples of (1-based line number, entry path, comment text with the `//` and one following space stripped). */
export function extractJavaCommentLines(zipBuffer: Buffer): Array<[number, string, string]> {
    const zip = new AdmZip(zipBuffer);
    const result: Array<[number, string, string]> = [];
    for (const entry of zip.getEntries()) {
        if (entry.isDirectory || !entry.entryName.endsWith('.java')) {
            continue;
        }
        const content = entry.getData().toString('utf-8');
        const rawLines = content.split('\n');
        for (let i = 0; i < rawLines.length; i++) {
            const trimmed = rawLines[i].trim().replace(/\r/g, '');
            if (trimmed.startsWith('//')) {
                const text = trimmed.length === '//'.length ? '' : trimmed.substring('// '.length);
                result.push([i + 1, entry.entryName, text]);
            }
        }
    }
    return result;
}

/** Builds a human/browser-friendly URL pointing at the source line, when the source was a GitHub archive zip. */
export function getCorrectUrl(webSource: string, file: string, line: number): string {
    if (webSource.startsWith('https://github')) {
        const base = webSource.substring(0, webSource.length - '.zip'.length).replace('/archive/', '/blob/');
        const afterFirstSlash = file.substring(file.indexOf('/') + 1);
        return `${base}/${afterFirstSlash}#L${line}`;
    }
    return `Web source ${webSource} file ${file} line ${line}`;
}

export interface MetaBlock {
    objectType: string;
    url: string;
    data: string[];
}

/** Splits comment lines into `<--[type] ... -->` blocks. On success, `data` ends with a synthetic `@end_meta` sentinel line, matching the C# LoadDataFromLines behavior that callers (the `@key` parser in metaObjectFactory.ts) depend on to terminate the final key/value pair. */
export function extractMetaBlocks(websrc: string, lines: Array<[number, string, string]>, loadErrors: string[]): MetaBlock[] {
    const blocks: MetaBlock[] = [];
    for (let i = 0; i < lines.length; i++) {
        const [lineNum, file, line] = lines[i];
        if (line.startsWith('<--[') && line.endsWith(']')) {
            const objectType = line.substring('<--['.length, line.length - ']'.length);
            const objectData: string[] = [];
            let closed = false;
            let broken = false;
            for (i++; i < lines.length; i++) {
                const [, curFile, curLine] = lines[i];
                if (curLine === '-->') {
                    closed = true;
                    break;
                }
                else if (curLine.startsWith('<--[')) {
                    loadErrors.push(`While processing ${file} at line ${i + 1} found the start of a meta block, while still processing the previous meta block.`);
                    broken = true;
                    break;
                }
                else if (curFile !== file) {
                    loadErrors.push(`While processing ${file} was not able to find the end of an object's documentation!`);
                    broken = true;
                    break;
                }
                objectData.push(curLine);
            }
            if (broken || !closed) {
                continue;
            }
            objectData.push('@end_meta');
            blocks.push({ objectType, url: getCorrectUrl(websrc, file, lineNum), data: objectData });
        }
        else if (line.startsWith('<--')) {
            loadErrors.push(`While processing ${file} at line ${i + 1} found the '<--' meta starter, but not a valid meta start.`);
        }
    }
    return blocks;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/metaDocs/metaLoader.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Compile**

Run: `npm run compile`
Expected: no TypeScript errors.

- [ ] **Step 6: Commit and push**

```bash
git add src/server/metaDocs/metaLoader.ts src/server/metaDocs/metaLoader.test.ts
git commit -m "feat: port meta source download and block extraction"
git push origin feature/typescript-lsp-rewrite
```

---

### Task 4: Block → MetaObject dispatch (`metaObjectFactory.ts`)

Ports `MetaDocsLoader.LoadInObject` (the `@key value` accumulator) plus the `MetaTypesData` registry concept from `MetaDocs.cs`'s constructor — as a plain lookup table instead of the C# generic `MetaTypeData<T>` record, since TS doesn't need that indirection.

**Files:**
- Create: `src/server/metaDocs/metaObjectFactory.ts`
- Test: `src/server/metaDocs/metaObjectFactory.test.ts`

**Interfaces:**
- Consumes: `MetaObject`, `MetaCommand`, `MetaTag`, `MetaEvent`, `MetaMechanism`, `MetaProperty`, `MetaAction`, `MetaLanguage`, `MetaObjectType`, `MetaGuidePage`, `MetaExtension` from `./metaTypes` (Task 2). `MetaBlock` from `./metaLoader` (Task 3, type-only usage).
- Produces: `createMetaObjectForType(objectType: string): MetaObject | undefined`, `loadInObject(objectType: string, url: string, objectData: string[], loadErrors: string[]): MetaObject | undefined`.

- [ ] **Step 1: Write failing tests**

Create `src/server/metaDocs/metaObjectFactory.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createMetaObjectForType, loadInObject } from './metaObjectFactory';
import { MetaCommand, MetaTag } from './metaTypes';

describe('createMetaObjectForType', () => {
    it('creates the right subclass for each known type name (case-insensitive)', () => {
        expect(createMetaObjectForType('command')).toBeInstanceOf(MetaCommand);
        expect(createMetaObjectForType('Command')).toBeInstanceOf(MetaCommand);
        expect(createMetaObjectForType('tag')).toBeInstanceOf(MetaTag);
    });

    it('returns undefined for an unknown type name', () => {
        expect(createMetaObjectForType('not_a_real_type')).toBeUndefined();
    });
});

describe('loadInObject', () => {
    it('parses @key value pairs, joining multi-line continuations, into a MetaCommand', () => {
        const errors: string[] = [];
        const obj = loadInObject('command', 'https://example.com#L1', [
            '@Name narrate',
            '@Short Sends a message.',
            '@Description Narrates text',
            'across multiple lines',
            'of description.',
            '@Tags',
            '<player.name>',
            '<npc.name>',
            '@end_meta'
        ], errors) as MetaCommand;
        expect(errors).toEqual([]);
        expect(obj).toBeInstanceOf(MetaCommand);
        expect(obj.commandName).toBe('narrate');
        expect(obj.short).toBe('Sends a message.');
        expect(obj.description).toBe('Narrates text\nacross multiple lines\nof description.');
        expect(obj.tags).toEqual(['<player.name>', '<npc.name>']);
        expect(obj.sourceFile).toBe('https://example.com#L1');
    });

    it('records an error for an unknown object type and returns undefined', () => {
        const errors: string[] = [];
        const obj = loadInObject('not_a_real_type', 'src', ['@Name x', '@end_meta'], errors);
        expect(obj).toBeUndefined();
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain('unknown meta type');
    });

    it('records an error when a key/value pair cannot be applied', () => {
        const errors: string[] = [];
        loadInObject('command', 'src', ['@Required not_a_number', '@end_meta'], errors);
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("could not apply key 'Required'");
    });

    it('stops processing once @end_meta is reached', () => {
        const errors: string[] = [];
        const obj = loadInObject('command', 'src', ['@Name foo', '@end_meta', '@Short ignored'], errors) as MetaCommand;
        expect(obj.short).toBe('');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/metaDocs/metaObjectFactory.test.ts`
Expected: FAIL — `metaObjectFactory.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/server/metaDocs/metaObjectFactory.ts`:

```ts
/**
 * Turns a raw meta block (object type name + `@key value` comment lines,
 * see metaLoader.ts) into a populated MetaObject instance. Ported from
 * SharpDenizenTools/MetaHandlers/MetaDocsLoader.cs's LoadInObject, plus the
 * MetaTypesData registry concept from MetaDocs.cs's constructor.
 */

import {
    MetaObject, MetaCommand, MetaTag, MetaEvent, MetaMechanism, MetaProperty,
    MetaAction, MetaLanguage, MetaObjectType, MetaGuidePage, MetaExtension,
    META_TYPE_COMMAND, META_TYPE_TAG, META_TYPE_EVENT, META_TYPE_MECHANISM, META_TYPE_PROPERTY,
    META_TYPE_ACTION, META_TYPE_LANGUAGE, META_TYPE_OBJECT, META_TYPE_GUIDEPAGE, META_TYPE_EXTENSION
} from './metaTypes';

const TYPE_FACTORIES: Record<string, () => MetaObject> = {
    command: () => Object.assign(new MetaCommand(), { type: META_TYPE_COMMAND }),
    tag: () => Object.assign(new MetaTag(), { type: META_TYPE_TAG }),
    event: () => Object.assign(new MetaEvent(), { type: META_TYPE_EVENT }),
    mechanism: () => Object.assign(new MetaMechanism(), { type: META_TYPE_MECHANISM }),
    property: () => Object.assign(new MetaProperty(), { type: META_TYPE_PROPERTY }),
    action: () => Object.assign(new MetaAction(), { type: META_TYPE_ACTION }),
    language: () => Object.assign(new MetaLanguage(), { type: META_TYPE_LANGUAGE }),
    objecttype: () => Object.assign(new MetaObjectType(), { type: META_TYPE_OBJECT }),
    guidepage: () => Object.assign(new MetaGuidePage(), { type: META_TYPE_GUIDEPAGE }),
    extension: () => Object.assign(new MetaExtension(), { type: META_TYPE_EXTENSION })
};

/** Creates a new, empty MetaObject subclass instance for the given meta type name (case-insensitive), or undefined if the type name isn't recognized. */
export function createMetaObjectForType(objectType: string): MetaObject | undefined {
    const factory = TYPE_FACTORIES[objectType.toLowerCase()];
    return factory ? factory() : undefined;
}

/** Parses `@key value` lines (with non-`@` lines treated as continuations of the previous value, joined with `\n`) and applies them to a freshly created MetaObject. Stops at a bare `@end_meta` line. Appends human-readable messages to `loadErrors` on any failure, matching MetaDocsLoader.LoadInObject's error strings. */
export function loadInObject(objectType: string, url: string, objectData: string[], loadErrors: string[]): MetaObject | undefined {
    const obj = createMetaObjectForType(objectType);
    if (!obj) {
        loadErrors.push(`While processing ${url} found unknown meta type '${objectType}'.`);
        return undefined;
    }
    obj.sourceFile = url;
    let curKey: string | null = null;
    let curValue: string | null = null;
    const flush = (): boolean => {
        if (curKey === null || curValue === null) {
            return true;
        }
        const cleanKey = curKey.toLowerCase();
        const cleanValue = curValue.trim();
        if (!obj.applyValue(cleanKey, cleanValue)) {
            loadErrors.push(`While processing ${url} in object type '${objectType}' for '${obj.name}' could not apply key '${curKey}' with value '${curValue}'.`);
        }
        else {
            const existing = obj.rawValues.get(cleanKey) ?? [];
            existing.push(cleanValue);
            obj.rawValues.set(cleanKey, existing);
        }
        return true;
    };
    for (const line of objectData) {
        if (line.startsWith('@')) {
            flush();
            curKey = null;
            curValue = null;
            const space = line.indexOf(' ');
            if (space === -1) {
                curKey = line.substring(1);
                if (curKey === 'end_meta') {
                    break;
                }
                continue;
            }
            curKey = line.substring(1, space);
            curValue = line.substring(space + 1);
        }
        else {
            curValue = (curValue ?? '') + '\n' + line;
        }
    }
    flush();
    return obj;
}
```

Note: `loadInObject` only constructs and populates the object — it deliberately does **not** call `obj.addTo(docs)`. Registration into a real `MetaDocs` is the caller's responsibility (`metaDocsManager.ts`, Task 5), since this function never receives a real `MetaDocs` instance to register into.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/metaDocs/metaObjectFactory.test.ts`
Expected: all tests PASS (none of the tests in this task assert on docs registration — that's covered in Task 5's tests, where `addTo` is called explicitly by `metaDocsManager`).

- [ ] **Step 5: Compile**

Run: `npm run compile`
Expected: no TypeScript errors.

- [ ] **Step 6: Commit and push**

```bash
git add src/server/metaDocs/metaObjectFactory.ts src/server/metaDocs/metaObjectFactory.test.ts
git commit -m "feat: port meta block key/value parsing and type dispatch"
git push origin feature/typescript-lsp-rewrite
```

---

### Task 5: Orchestration and disk cache (`metaDocsManager.ts`)

Ports the overall `MetaDocsLoader.DownloadAll` flow (minus guide scraping, which stays off), plus `MetaExtension`'s `PostCheck` merge behavior, plus a disk-cache layer modeled on `ExtraData.Load`'s TTL-file-cache pattern. The cache stores the *extracted blocks* (the expensive network+zip step), not the constructed `MetaDocs` — objects are always rebuilt fresh from blocks (cheap, no serialization concerns since `MetaObject` instances have methods).

**Files:**
- Create: `src/server/metaDocs/metaDocsManager.ts`
- Test: `src/server/metaDocs/metaDocsManager.test.ts`

**Interfaces:**
- Consumes: `MetaBlock`, `downloadBinary`, `extractJavaCommentLines`, `extractMetaBlocks` from `./metaLoader` (Task 3). `loadInObject` from `./metaObjectFactory` (Task 4). `MetaDocs`, `createEmptyMetaDocs`, `MetaExtension` from `./metaTypes` (Task 2).
- Produces: `DEFAULT_META_SOURCES: string[]`, `downloadAllBlocks(sources: string[]): Promise<{ blocks: MetaBlock[]; loadErrors: string[] }>`, `buildMetaDocs(blocks: MetaBlock[]): MetaDocs`, `applyExtensions(docs: MetaDocs): void`, `loadMetaDocs(options: { cacheFile: string; ttlMs: number; forceRefresh?: boolean; sources?: string[] }): Promise<MetaDocs>`.

- [ ] **Step 1: Write failing tests**

Create `src/server/metaDocs/metaDocsManager.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildMetaDocs, applyExtensions, loadMetaDocs, DEFAULT_META_SOURCES } from './metaDocsManager';
import type { MetaBlock } from './metaLoader';

describe('DEFAULT_META_SOURCES', () => {
    it('points at the real Denizen source repos, not a nonexistent meta.zip', () => {
        expect(DEFAULT_META_SOURCES).toContain('https://github.com/DenizenScript/Denizen/archive/dev.zip');
        expect(DEFAULT_META_SOURCES).toContain('https://github.com/DenizenScript/Denizen-Core/archive/master.zip');
        expect(DEFAULT_META_SOURCES.some(s => s.includes('meta.zip'))).toBe(false);
    });
});

describe('buildMetaDocs', () => {
    it('constructs a populated MetaDocs from parsed blocks', () => {
        const blocks: MetaBlock[] = [
            { objectType: 'command', url: 'src#L1', data: ['@Name narrate', '@Short x', '@end_meta'] },
            { objectType: 'tag', url: 'src#L2', data: ['@attribute <PlayerTag.name>', '@returns ElementTag', '@end_meta'] }
        ];
        const docs = buildMetaDocs(blocks);
        expect(docs.commands.get('narrate')).toBeDefined();
        expect(docs.tags.get('playertag.name')).toBeDefined();
        expect(docs.loadErrors).toEqual([]);
    });

    it('collects errors for unparsable blocks without throwing', () => {
        const blocks: MetaBlock[] = [
            { objectType: 'not_a_type', url: 'src#L1', data: ['@Name x', '@end_meta'] }
        ];
        const docs = buildMetaDocs(blocks);
        expect(docs.loadErrors.length).toBe(1);
    });
});

describe('applyExtensions', () => {
    it('merges an extension block onto its target object', () => {
        const blocks: MetaBlock[] = [
            { objectType: 'command', url: 'src#L1', data: ['@Name narrate', '@Short original', '@end_meta'] },
            { objectType: 'extension', url: 'src#L2', data: ['@target_type command', '@target_name narrate', '@name narrate ext', '@Short extended', '@end_meta'] }
        ];
        const docs = buildMetaDocs(blocks);
        applyExtensions(docs);
        expect(docs.commands.get('narrate')!.short).toBe('original\n\nextended');
    });

    it('records an error when the extension target type is unknown', () => {
        const blocks: MetaBlock[] = [
            { objectType: 'extension', url: 'src#L1', data: ['@target_type not_a_type', '@target_name x', '@name ext', '@end_meta'] }
        ];
        const docs = buildMetaDocs(blocks);
        applyExtensions(docs);
        expect(docs.loadErrors.some(e => e.includes('invalid target meta type'))).toBe(true);
    });

    it('records an error when the extension target name does not exist', () => {
        const blocks: MetaBlock[] = [
            { objectType: 'extension', url: 'src#L1', data: ['@target_type command', '@target_name does_not_exist', '@name ext', '@end_meta'] }
        ];
        const docs = buildMetaDocs(blocks);
        applyExtensions(docs);
        expect(docs.loadErrors.some(e => e.includes('invalid target meta name'))).toBe(true);
    });
});

describe('loadMetaDocs caching', () => {
    let tmpDir: string;
    let cacheFile: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-meta-cache-'));
        cacheFile = path.join(tmpDir, 'meta-blocks-cache.json');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('downloads and writes the cache file when none exists', async () => {
        const fakeBlocks: MetaBlock[] = [{ objectType: 'command', url: 's#L1', data: ['@Name foo', '@end_meta'] }];
        const downloadSpy = vi.fn(async () => ({ blocks: fakeBlocks, loadErrors: [] as string[] }));
        const docs = await loadMetaDocs({ cacheFile, ttlMs: 1000 * 60, sources: ['https://example.com/x.zip'], downloadFn: downloadSpy });
        expect(downloadSpy).toHaveBeenCalledTimes(1);
        expect(docs.commands.get('foo')).toBeDefined();
        expect(fs.existsSync(cacheFile)).toBe(true);
    });

    it('reuses the cache file within the TTL window instead of downloading again', async () => {
        const fakeBlocks: MetaBlock[] = [{ objectType: 'command', url: 's#L1', data: ['@Name foo', '@end_meta'] }];
        fs.writeFileSync(cacheFile, JSON.stringify(fakeBlocks));
        const downloadSpy = vi.fn(async () => ({ blocks: [] as MetaBlock[], loadErrors: [] as string[] }));
        const docs = await loadMetaDocs({ cacheFile, ttlMs: 1000 * 60 * 60, sources: ['https://example.com/x.zip'], downloadFn: downloadSpy });
        expect(downloadSpy).not.toHaveBeenCalled();
        expect(docs.commands.get('foo')).toBeDefined();
    });

    it('re-downloads when the cache file is older than the TTL', async () => {
        fs.writeFileSync(cacheFile, JSON.stringify([]));
        const oldTime = new Date(Date.now() - 1000 * 60 * 60 * 24);
        fs.utimesSync(cacheFile, oldTime, oldTime);
        const fakeBlocks: MetaBlock[] = [{ objectType: 'command', url: 's#L1', data: ['@Name fresh', '@end_meta'] }];
        const downloadSpy = vi.fn(async () => ({ blocks: fakeBlocks, loadErrors: [] as string[] }));
        const docs = await loadMetaDocs({ cacheFile, ttlMs: 1000 * 60, sources: ['https://example.com/x.zip'], downloadFn: downloadSpy });
        expect(downloadSpy).toHaveBeenCalledTimes(1);
        expect(docs.commands.get('fresh')).toBeDefined();
    });

    it('re-downloads when forceRefresh is true even if the cache is fresh', async () => {
        fs.writeFileSync(cacheFile, JSON.stringify([]));
        const fakeBlocks: MetaBlock[] = [{ objectType: 'command', url: 's#L1', data: ['@Name forced', '@end_meta'] }];
        const downloadSpy = vi.fn(async () => ({ blocks: fakeBlocks, loadErrors: [] as string[] }));
        const docs = await loadMetaDocs({ cacheFile, ttlMs: 1000 * 60 * 60, forceRefresh: true, sources: ['https://example.com/x.zip'], downloadFn: downloadSpy });
        expect(downloadSpy).toHaveBeenCalledTimes(1);
        expect(docs.commands.get('forced')).toBeDefined();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/metaDocs/metaDocsManager.test.ts`
Expected: FAIL — `metaDocsManager.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/server/metaDocs/metaDocsManager.ts`:

```ts
/**
 * Orchestrates meta loading: downloads all source archives, extracts and
 * parses their doc blocks into a MetaDocs, applies MetaExtension merges,
 * and caches the extracted blocks to disk with a TTL. Ported from
 * SharpDenizenTools/MetaHandlers/MetaDocsLoader.cs's DownloadAll and
 * MetaExtension.cs's PostCheck merge logic; caching follows the pattern
 * used by ExtraData.Load's file-based TTL cache.
 */

import * as fs from 'fs';
import * as path from 'path';
import { downloadBinary, extractJavaCommentLines, extractMetaBlocks, MetaBlock } from './metaLoader';
import { loadInObject } from './metaObjectFactory';
import { MetaDocs, createEmptyMetaDocs } from './metaTypes';

export const DEFAULT_META_SOURCES: string[] = [
    'https://github.com/DenizenScript/Denizen/archive/dev.zip',
    'https://github.com/DenizenScript/Denizen-Core/archive/master.zip',
    'https://github.com/DenizenScript/Depenizen/archive/master.zip',
    'https://github.com/DenizenScript/dDiscordBot/archive/master.zip'
];

/** Downloads every source in parallel and extracts their raw meta blocks. A failure downloading one source is recorded as a load error and does not prevent the others from succeeding. */
export async function downloadAllBlocks(sources: string[]): Promise<{ blocks: MetaBlock[]; loadErrors: string[] }> {
    const loadErrors: string[] = [];
    const allBlocks: MetaBlock[] = [];
    await Promise.all(sources.map(async src => {
        try {
            const data = await downloadBinary(src);
            const lines = extractJavaCommentLines(data);
            const blocks = extractMetaBlocks(src, lines, loadErrors);
            allBlocks.push(...blocks);
        }
        catch (ex) {
            loadErrors.push(`Source download error for ${src}: ${ex instanceof Error ? ex.message : String(ex)}`);
        }
    }));
    return { blocks: allBlocks, loadErrors };
}

/** Constructs a fresh MetaDocs by parsing and registering every block. Does not apply extensions — call applyExtensions() afterward if extension merging is needed. */
export function buildMetaDocs(blocks: MetaBlock[]): MetaDocs {
    const docs = createEmptyMetaDocs();
    for (const block of blocks) {
        const obj = loadInObject(block.objectType, block.url, block.data, docs.loadErrors);
        if (obj) {
            obj.addTo(docs);
        }
    }
    return docs;
}

/** Looks up a MetaObject by (type name, clean name) across every registry in docs. Returns undefined if the type name or the object name is unknown. */
function findTarget(docs: MetaDocs, extendType: string, extendName: string) {
    const type = extendType.toLowerCase();
    const name = extendName.toLowerCase();
    switch (type) {
        case 'command': return docs.commands.get(name);
        case 'mechanism': return docs.mechanisms.get(name);
        case 'tag': return docs.tags.get(name);
        case 'objecttype': return docs.objectTypes.get(name);
        case 'property': return docs.properties.get(name);
        case 'event': return docs.events.get(name);
        case 'action': return docs.actions.get(name);
        case 'language': return docs.languages.get(name);
        case 'guidepage': return docs.guidePages.get(name);
        default: return undefined;
    }
}

const KNOWN_EXTEND_TYPES = new Set(['command', 'mechanism', 'tag', 'objecttype', 'property', 'event', 'action', 'language', 'guidepage']);

/** Merges every registered MetaExtension's raw key/value pairs onto its target object, matching MetaExtension.cs's PostCheck. Must run after buildMetaDocs() has registered all non-extension objects. */
export function applyExtensions(docs: MetaDocs): void {
    for (const ext of docs.extensions.values()) {
        if (!ext.extendType || !ext.extendName || !ext.extensionName) {
            docs.loadErrors.push(`Extension is missing a required target_type, target_name, or name value.`);
            continue;
        }
        if (!KNOWN_EXTEND_TYPES.has(ext.extendType.toLowerCase())) {
            docs.loadErrors.push(`Extension '${ext.extensionName}' has invalid target meta type to extend: ${ext.extendType}.`);
            continue;
        }
        const target = findTarget(docs, ext.extendType, ext.extendName);
        if (!target) {
            docs.loadErrors.push(`Extension '${ext.extensionName}' has invalid target meta name to extend: ${ext.extendName}.`);
            continue;
        }
        const skipKeys = new Set(['target_type', 'target_name', 'name', 'include_existing']);
        for (const [key, values] of ext.rawValues) {
            if (skipKeys.has(key)) {
                continue;
            }
            const currentValues = ext.includeExisting ? target.rawValues.get(key) : undefined;
            const currentValue = currentValues && currentValues.length > 0 ? currentValues[currentValues.length - 1] : null;
            for (const value of values) {
                const newValue = currentValue !== null ? currentValue + '\n\n' + value : value;
                if (!target.applyValue(key, newValue)) {
                    docs.loadErrors.push(`Extension '${ext.extensionName}' could not extend ${ext.extendType} meta '${ext.extendName}', key/value pair '${key}' -> '${value}' is invalid.`);
                }
                else {
                    const existing = target.rawValues.get(key) ?? [];
                    existing.push(newValue);
                    target.rawValues.set(key, existing);
                }
            }
        }
    }
}

export interface LoadMetaDocsOptions {
    cacheFile: string;
    ttlMs: number;
    forceRefresh?: boolean;
    sources?: string[];
    /** Injectable for testing; defaults to the real network downloadAllBlocks(). */
    downloadFn?: (sources: string[]) => Promise<{ blocks: MetaBlock[]; loadErrors: string[] }>;
}

/** Loads MetaDocs, using a disk-cached copy of the extracted blocks when it exists and is within ttlMs, otherwise re-downloading and refreshing the cache. */
export async function loadMetaDocs(options: LoadMetaDocsOptions): Promise<MetaDocs> {
    const sources = options.sources ?? DEFAULT_META_SOURCES;
    const download = options.downloadFn ?? downloadAllBlocks;
    let blocks: MetaBlock[] | null = null;
    if (!options.forceRefresh && fs.existsSync(options.cacheFile)) {
        const age = Date.now() - fs.statSync(options.cacheFile).mtimeMs;
        if (age < options.ttlMs) {
            try {
                blocks = JSON.parse(fs.readFileSync(options.cacheFile, 'utf-8'));
            }
            catch {
                blocks = null;
            }
        }
    }
    let loadErrors: string[] = [];
    if (blocks === null) {
        const result = await download(sources);
        blocks = result.blocks;
        loadErrors = result.loadErrors;
        fs.mkdirSync(path.dirname(options.cacheFile), { recursive: true });
        fs.writeFileSync(options.cacheFile, JSON.stringify(blocks));
    }
    const docs = buildMetaDocs(blocks);
    docs.loadErrors.push(...loadErrors);
    applyExtensions(docs);
    return docs;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/metaDocs/metaDocsManager.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Compile**

Run: `npm run compile`
Expected: no TypeScript errors.

- [ ] **Step 6: Commit and push**

```bash
git add src/server/metaDocs/metaDocsManager.ts src/server/metaDocs/metaDocsManager.test.ts
git commit -m "feat: add meta loading orchestration, extension merging, and disk cache"
git push origin feature/typescript-lsp-rewrite
```

---

### Task 6: LSP server skeleton (`server.ts`)

**Files:**
- Create: `src/server/server.ts`

**Interfaces:**
- Consumes: `loadMetaDocs`, `DEFAULT_META_SOURCES` from `./metaDocs/metaDocsManager` (Task 5).
- Produces: `createServer(): Connection` (exported for testability), plus a `require.main === module` bootstrap that calls `.listen()` when run directly as the compiled entry point.

No automated test for this task: `vscode-languageserver`'s `Connection` communicates over `process.stdin`/`process.stdout` (or IPC when spawned by the client), which isn't meaningfully unit-testable without a real client on the other end. `createServer()` is still factored out as a plain function (not run at import time) so it *could* be tested later once Phase 2 adds real request handlers worth asserting on. Verification for this task is the manual end-to-end check in Task 8.

- [ ] **Step 1: Write the server**

Create `src/server/server.ts`:

```ts
/**
 * TypeScript LSP server entry point. Phase 1 scope: connect, load meta
 * documentation, and log a summary — no completion/hover/diagnostics yet
 * (those are later phases per LSP_REWRITE_PLAN.md).
 */

import * as os from 'os';
import * as path from 'path';
import {
    createConnection, ProposedFeatures, TextDocuments, TextDocumentSyncKind,
    InitializeParams, InitializeResult, Connection
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { loadMetaDocs, DEFAULT_META_SOURCES } from './metaDocs/metaDocsManager';

const META_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function getMetaCacheFile(): string {
    const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'DenizenVSCodeExtension', 'cache', 'meta-blocks-cache.json');
}

export function createServer(): Connection {
    const connection = createConnection(ProposedFeatures.all);
    const documents = new TextDocuments(TextDocument);

    connection.onInitialize((_params: InitializeParams): InitializeResult => {
        return {
            capabilities: {
                textDocumentSync: TextDocumentSyncKind.Incremental
            }
        };
    });

    connection.onInitialized(() => {
        loadMetaDocs({ cacheFile: getMetaCacheFile(), ttlMs: META_CACHE_TTL_MS, sources: DEFAULT_META_SOURCES })
            .then(docs => {
                connection.console.log(
                    `Denizen meta loaded: ${docs.commands.size} commands, ${docs.tags.size} tags, ` +
                    `${docs.events.size} events, ${docs.mechanisms.size} mechanisms, ${docs.properties.size} properties, ` +
                    `${docs.actions.size} actions, ${docs.languages.size} languages, ${docs.objectTypes.size} object types. ` +
                    `${docs.loadErrors.length} load error(s).`
                );
                for (const err of docs.loadErrors.slice(0, 20)) {
                    connection.console.warn(`Meta load error: ${err}`);
                }
            })
            .catch(err => {
                connection.console.error(`Denizen meta load failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
            });
    });

    documents.listen(connection);
    return connection;
}

if (require.main === module) {
    createServer().listen();
}
```

- [ ] **Step 2: Compile**

Run: `npm run compile`
Expected: no TypeScript errors, and `out/server/server.js` now exists.

- [ ] **Step 3: Commit and push**

```bash
git add src/server/server.ts
git commit -m "feat: add TypeScript LSP server skeleton"
git push origin feature/typescript-lsp-rewrite
```

---

### Task 7: Client wiring behind an opt-in setting

**Files:**
- Create: `src/serverEngineSelector.ts`
- Test: `src/serverEngineSelector.test.ts`
- Modify: `src/extension.ts:41` (near `activateLanguageServer`) and `src/extension.ts:2739` (`activate()`)
- Modify: `package.json` (add the `denizenscript.server.engine` setting)

**Interfaces:**
- Produces: `shouldUseTypeScriptServer(engineSetting: string | undefined | null): boolean` (pure, no `vscode` import so it's unit-testable — `extension.ts` imports `vscode` at module scope, which only resolves inside the Extension Host, so this decision logic must live outside that file to be testable).

- [ ] **Step 1: Write the failing test**

Create `src/serverEngineSelector.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldUseTypeScriptServer } from './serverEngineSelector';

describe('shouldUseTypeScriptServer', () => {
    it('returns true only for the exact string "typescript"', () => {
        expect(shouldUseTypeScriptServer('typescript')).toBe(true);
    });

    it('returns false for "csharp", undefined, null, or garbage values', () => {
        expect(shouldUseTypeScriptServer('csharp')).toBe(false);
        expect(shouldUseTypeScriptServer(undefined)).toBe(false);
        expect(shouldUseTypeScriptServer(null)).toBe(false);
        expect(shouldUseTypeScriptServer('TypeScript')).toBe(false);
        expect(shouldUseTypeScriptServer('')).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/serverEngineSelector.test.ts`
Expected: FAIL — `serverEngineSelector.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/serverEngineSelector.ts`:

```ts
/**
 * Decides which Denizen language server engine to run. Kept free of any
 * `vscode` import (unlike extension.ts) so it can be unit-tested with
 * vitest outside the Extension Host.
 */

export type ServerEngine = 'csharp' | 'typescript';

export function shouldUseTypeScriptServer(engineSetting: string | undefined | null): boolean {
    return engineSetting === 'typescript';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/serverEngineSelector.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the setting to package.json**

Edit `package.json`. Inside `"contributes"."configuration"."properties"`, add (placed right after `"denizenscript.header_symbols"` for visibility, matching the file's existing property ordering by topic):

```json
"denizenscript.server.engine": {
    "type": "string",
    "enum": ["csharp", "typescript"],
    "enumDescriptions": [
        "The existing stable .NET language server.",
        "Experimental TypeScript rewrite. Phase 1: loads meta documentation only — no completions, hover, or diagnostics yet."
    ],
    "default": "csharp",
    "description": "Which Denizen language server engine to use."
},
```

- [ ] **Step 6: Wire the client in extension.ts**

In `src/extension.ts`, add this import alongside the existing ones at the top of the file:

```ts
import { shouldUseTypeScriptServer } from './serverEngineSelector';
```

Add a new function immediately after `activateLanguageServer` (after line 74, the closing `}` of that function):

```ts
function activateTsLanguageServer(context: vscode.ExtensionContext) {
    let serverModule : string = context.asAbsolutePath(path.join("out", "server", "server.js"));
    if (!fs.existsSync(serverModule)) {
        outputChannel.appendLine("TypeScript language server module not found at " + serverModule);
        return;
    }
    let serverOptions: languageClientNode.ServerOptions = {
        run: { module: serverModule, transport: languageClientNode.TransportKind.ipc },
        debug: { module: serverModule, transport: languageClientNode.TransportKind.ipc, options: { execArgv: ["--nolazy", "--inspect=6019"] } }
    }
    let clientOptions: languageClient.LanguageClientOptions = {
        documentSelector: ["denizenscript"],
        synchronize: {
            configurationSection: "denizenscript",
        }
    }
    let client = new languageClientNode.LanguageClient("DenizenTsLangServer", "Denizen Language Server (TypeScript)", serverOptions, clientOptions);
    let disposable = client.start();
    context.subscriptions.push(disposable);
}
```

Replace the first two lines of `activate()` (currently `let path : string = await activateDotNet();` and `activateLanguageServer(context, path);`, around line 2740-2741):

```ts
export async function activate(context: vscode.ExtensionContext) {
    if (shouldUseTypeScriptServer(configuration.get("denizenscript.server.engine"))) {
        activateTsLanguageServer(context);
    }
    else {
        let path : string = await activateDotNet();
        activateLanguageServer(context, path);
    }
    activateHighlighter(context);
```

(leave the remaining lines of `activate()` — `activateUpdateChecks(context);` onward — exactly as they are.)

- [ ] **Step 7: Compile**

Run: `npm run compile`
Expected: no TypeScript errors.

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: every test across all tasks so far PASSes.

- [ ] **Step 9: Commit and push**

```bash
git add src/extension.ts src/serverEngineSelector.ts src/serverEngineSelector.test.ts package.json
git commit -m "feat: wire TypeScript LSP server behind opt-in denizenscript.server.engine setting"
git push origin feature/typescript-lsp-rewrite
```

---

### Task 8: Manual end-to-end verification

Not automatable (requires a live VS Code Extension Development Host and real network access to GitHub). This is the "verify meta loading works" checkpoint from `LSP_REWRITE_PLAN.md`'s Phase 1 goal.

**Files:** none (verification only).

- [ ] **Step 1: Launch the Extension Development Host**

In VS Code, open the `extension/` folder and press F5 (or run "Debug: Start Debugging"). Wait for the new "Extension Development Host" window to open.

- [ ] **Step 2: Switch to the TypeScript engine**

In the Extension Development Host window, open Settings, search for `denizenscript.server.engine`, and set it to `typescript`. Reload the window (Ctrl+Shift+P → "Developer: Reload Window").

- [ ] **Step 3: Open a `.dsc` file and check the output channel**

Open any `.dsc` file (or create one). Open the "Output" panel and select "Denizen Language Server (TypeScript)" from the dropdown (this is the LSP trace channel `vscode-languageclient` creates automatically from the client name passed to `LanguageClient`, distinct from the extension's own "Denizen" channel).

Expected: within a few seconds to ~1 minute (first run downloads ~4 GitHub archives), a log line like:
```
Denizen meta loaded: 480 commands, 2100 tags, 650 events, 900 mechanisms, ... . 0 load error(s).
```
Nonzero counts for commands/tags/events confirm the download → zip extraction → comment parsing → block splitting → object construction pipeline works end-to-end against real data. A `load error(s)` count under roughly 1% of total objects is acceptable (matches expected noise in the real C# server's `LoadErrors`, e.g. from any hand-authored meta blocks with formatting quirks); a large or 100% error count means something upstream broke and should be investigated before starting Phase 2.

- [ ] **Step 4: Confirm the cache file was written**

Check that `%LOCALAPPDATA%\DenizenVSCodeExtension\cache\meta-blocks-cache.json` now exists and is non-empty (several MB).

- [ ] **Step 5: Confirm the C# server still works by default**

Reload the Extension Development Host with `denizenscript.server.engine` back at its default (unset / `csharp`). Confirm the original "Denizen" output channel still shows the existing .NET server behavior (hover/completion on a `.dsc` file still works as before). This confirms Global Constraints' "existing C# server must keep working" requirement.

- [ ] **Step 6: Note the outcome**

No commit needed for this task (verification only). If any step fails, stop and report back before proceeding to Phase 2 — do not paper over a broken meta pipeline by starting completion/hover work on top of it.

---

## What's next (Phase 2, not in this plan)

Once Task 8 passes: `ScriptChecker`/diagnostics, `WorkspaceTracker`, `HoverProvider`, and a basic (non-context-aware) `CompletionProvider`, per `LSP_REWRITE_PLAN.md`'s existing Phase 2 section. That's a separate plan — bring it back through `superpowers:writing-plans` once Phase 1 is verified working.
