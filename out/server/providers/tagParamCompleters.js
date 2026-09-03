"use strict";
/**
 * Completion candidates for the text inside a tag's square brackets, chosen from
 * the tag's *documented* parameter spec (e.g. `(<duration>)`, `true/false`,
 * `<mechanism>=<value>;...`) and whatever the user has typed so far.
 *
 * Ported from DenizenLangServer/CommandTabCompletions.cs: the `ByTag` registration
 * table (lines 80-95) and `CompleteGenericTagParam` (lines 137-202), plus the
 * helpers it leans on — `CompleteEnum` (:204-207), `SuggestMechanisms` (:209-212),
 * `SuggestMechPair` (:214-224) and `SuggestMechPairSet` (:226-229).
 *
 * Deliberately pure: data in, data out. It builds no `CompletionItem`s, imports
 * nothing from `vscode-languageserver`, and touches no I/O, so every branch is
 * unit-testable. Turning a `ParamCandidate` into an LSP item — kind, text edit,
 * range, full markdown documentation — belongs to the caller.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.completeTagParam = exports.normaliseDocParam = exports.TAG_PARAM_COMPLETERS = exports.completeMapKeys = exports.completeObjectTypeNames = exports.setCustomColorNames = exports.parseTextColorMap = void 0;
const frenetic_1 = require("../checker/frenetic");
// The one VALUE import from checker/: the inventory label list, which is a hardcoded constant in
// both languages rather than loaded data, transcribed once for Phase 2C-7's event validators.
// `eventValidators` pulls in `advancedMatcher` and `frenetic`, both of which are already
// dependency-free, so this keeps the no-require() property intact.
const eventValidators_1 = require("../checker/eventValidators");
/**
 * Script containers of the given type whose name starts with `typed`.
 * Port of `SuggestScriptByType` (CommandTabCompletions.cs:271-279).
 *
 * `type` null means "any type at all" -- that is the `<script>` registration (:82).
 *
 * NULL WORKSPACE MEANS OFFER NOTHING, matching the C#'s `WorkspaceData is null` guard (:273).
 * Before the first workspace scan there is no script index, and inventing one would offer names
 * that do not exist.
 *
 * The underscore rule is the C#'s (:278): a name beginning with `_` is private by convention, so
 * it is hidden UNLESS the user has already typed the underscore themselves.
 */
function suggestScriptByType(workspace, type, typed) {
    if (workspace === null) {
        return [];
    }
    const results = [];
    for (const script of workspace.scripts.values()) {
        if (type !== null && script.type !== type) {
            continue;
        }
        if (!typed.startsWith('_') && script.name.startsWith('_')) {
            continue;
        }
        if (script.name.startsWith(typed)) {
            results.push({ label: script.name, detail: script.name, kind: 'script', script });
        }
    }
    return results;
}
/** Text after the last `sep`; the whole string when absent (FreneticExtensions' `AfterLast`). */
function afterLast(text, sep) {
    const index = text.lastIndexOf(sep);
    return index === -1 ? text : text.substring(index + sep.length);
}
/**
 * The user's custom colour names, for the `<custom_color_name>` spec.
 *
 * MODULE STATE SET FROM OUTSIDE rather than read here, and that is deliberate. This file is pure
 * by contract -- data in, data out, no `vscode-languageserver` import and no I/O -- so it cannot
 * reach an LSP connection to ask for a setting. `server.ts` reads it and pushes the names in, the
 * same way it pushes the meta and the workspace data to everything else.
 *
 * A `let` rather than another parameter on `TagParamCompleter` because exactly one of the twenty
 * registrations wants it; widening the signature would make the other nineteen carry a parameter
 * they ignore.
 *
 * C# reaches the same data as `ClientConfiguration.TextColorMap.Keys` (CommandTabCompletions.cs:95)
 * -- a client setting held on the server. This port had no equivalent, which is why
 * `<custom_color_name>` was the last registered spec left unserved.
 */
let customColorNames = [];
/**
 * Parses the `denizenscript.theme_colors.text_color_map` setting into colour names.
 *
 * The setting is a comma-separated `name=#RRGGBB` list, and the CLIENT already parses it this way
 * for the inline `<&[name]>` decorations (extension.ts's `loadAllColors`). Only the names are kept
 * here: completion offers names, and the hex is the client's business.
 *
 * Malformed entries are skipped rather than rejected wholesale -- one typo in a long list should
 * cost that one colour, not all of them.
 */
function parseTextColorMap(setting) {
    if (!setting) {
        return [];
    }
    const names = [];
    for (const entry of setting.split(',')) {
        const pair = entry.split('=');
        if (pair.length !== 2) {
            continue;
        }
        const name = pair[0].trim().toLowerCase();
        if (name.length > 0 && !names.includes(name)) {
            names.push(name);
        }
    }
    return names;
}
exports.parseTextColorMap = parseTextColorMap;
/** Hands the parsed colour names to the completer. Called by server.ts when configuration arrives. */
function setCustomColorNames(names) {
    customColorNames = names;
}
exports.setCustomColorNames = setCustomColorNames;
/**
 * Object type names for `<ObjectTag.as[<type>]>`, in the short form.
 *
 * NO C# COUNTERPART -- a new completer, from the user's request of 2026-09-03. 23 of the 27 `as_*`
 * tags are deprecated in favour of `as[...]`, each deprecation naming its replacement verbatim
 * (`use as[entity]`, `use as[item]`, ...), so the tag is where the names are wanted.
 *
 * DERIVED FROM `docs.objectTypes`, NOT CURATED. The tag's own description settles the format:
 * "Type names can be of the long form, like ListTag, MapTag, ElementTag, ... or the short form,
 * like List, Map, Element, ... Type name input is not case-sensitive." So the short form is the
 * long one with `Tag` removed, and a Denizen release that adds an object type completes here the
 * same day.
 *
 * ONLY NAMES ENDING IN `Tag` ARE OFFERED. `docs.objectTypes` also holds the abstract markers
 * (`AreaObject`, `FlaggableObject`, `PropertyHolderObject`, `VectorObject`) and three lowercase tag
 * bases (`bungee`, `server`, `system`). None of those is a type an object can be converted TO, and
 * offering them would be offering conversions that cannot work.
 *
 * KNOWN UNDER-OFFER, deliberately: `as_custom`'s deprecation says `use as[custom]`, while stripping
 * `Tag` from `CustomObjectTag` gives `customobject`. The documented rule is the strip, so that is
 * what is offered; the shorter alias still works if typed. Offering a name the documentation does
 * not describe would be the worse mistake.
 */
function completeObjectTypeNames(docs, typed) {
    const results = [];
    for (const type of docs.objectTypes.values()) {
        if (!type.name.endsWith('Tag')) {
            continue;
        }
        const short = type.name.slice(0, -'Tag'.length).toLowerCase();
        if (short.startsWith(typed.toLowerCase())) {
            results.push({ label: short, detail: `**Object Type**: ${type.name}`, kind: 'enum' });
        }
    }
    return results;
}
exports.completeObjectTypeNames = completeObjectTypeNames;
/** Every enum value starting with `typed`. Port of `CompleteEnum` (:204-207). */
function completeEnum(values, label, typed) {
    const results = [];
    for (const value of values) {
        if (value.startsWith(typed)) {
            // C#'s `key == null ? null : new MarkupContent(...)` (:206) suppresses the
            // documentation entirely for a null key; an empty detail is this port's
            // equivalent. No ByTag registration actually passes null, but EnumCompleter
            // allows it, so the case is handled rather than assumed away.
            results.push({ label: value, detail: label === null ? '' : `**${label}**: ${value}`, kind: 'enum' });
        }
    }
    return results;
}
/**
 * Every mechanism whose name starts with `typed`, labelled with `suffix` appended.
 * Port of `SuggestMechanisms` (:209-212).
 *
 * C# also takes an `objectType` filter, but all four `ByTag` registrations that reach
 * this pass `null` (:91-94), so the filter is omitted rather than carried as dead code.
 * As in C#, two mechanisms on different object types that share a name both appear —
 * `<property-name>` is deliberately not scoped to one object type here.
 *
 * `detail` mirrors `DescribeMech`'s heading, `### {MechObject} Mechanism {MechName}`
 * (:368), condensed to one line; a caller wanting the full description can look the
 * mechanism back up by name.
 */
function suggestMechanisms(docs, typed, suffix) {
    const results = [];
    for (const mechanism of docs.mechanisms.values()) {
        if (mechanism.mechName.startsWith(typed)) {
            results.push({
                label: mechanism.mechName + suffix,
                detail: `**${mechanism.mechObject} Mechanism**: ${mechanism.mechName}`,
                kind: 'mechanism'
            });
        }
    }
    return results;
}
/** Port of `SuggestMechPair` (:214-224): once `=` is typed the value side is undocumented, so nothing is offered. */
function suggestMechPair(docs, typed) {
    if (typed.includes('=')) {
        return [];
    }
    return suggestMechanisms(docs, typed, '=');
}
/** Port of `SuggestMechPairSet` (:226-229): only the text after the last `;` names the mechanism being typed. */
function suggestMechPairSet(docs, typed) {
    return suggestMechPair(docs, afterLast(typed, ';'));
}
/**
 * Mechanism-name candidates for the keys of a `<map[...]>` written as an argument to `adjust`.
 *
 * NO C# COUNTERPART -- FEATURE-IDEAS.md idea 3, built on the user's ruling of 2026-09-01.
 *
 * WHY THIS IS NOT THE FEATURE NOTE'S DESIGN. That note assessed the request ("offer
 * `translation`, `interpolation_start`, `interpolation_duration` while typing inside a map tag")
 * and concluded the names "are not in Denizen's meta", so the list would have to be hand-curated
 * and would go stale. THAT ASSESSMENT WAS WRONG, and the meta says so: all three are documented
 * `EntityTag` properties, and a property is both a tag and a mechanism. Checked 2026-09-01 against
 * the live meta -- `entitytag.interpolation_start`, `entitytag.interpolation_duration`,
 * `entitytag.translation`, `entitytag.scale`. So the list is DERIVED, not curated, and cannot go
 * stale: a Denizen release that adds a display property makes it complete here the same day.
 *
 * WHY IT IS SCOPED TO `adjust`. A map's keys are arbitrary in the general case -- `<map[a=1;b=2]>`
 * holding data has nothing to do with mechanisms -- and the tag's own documented parameter is the
 * generic `(<map>)`, which is why the existing spec registry rightly offers nothing there.
 * `- adjust <object> <map[...]>` is the one shape where the keys ARE mechanism names. It is also
 * the form the user actually writes: `- adjust <[ent]> <map[...]>` is the commonest adjust in
 * their scripts, which is already recorded in commandSpecifics.ts's exemption for it.
 *
 * Not narrowed to the adjusted object's TYPE. Doing that means tracing `<[ent]>` back to a type,
 * which for a definition holding an entity is exactly the case the tag tracer cannot resolve; the
 * result would be an empty list precisely where the feature is wanted. Offering every object's
 * mechanisms matches what `SuggestMechanisms` already does for `<mechanism>=<value>;...` and what
 * the C# does there (:209-212), and the typed prefix narrows it immediately.
 */
function completeMapKeys(docs, typed) {
    return suggestMechPairSet(docs, typed);
}
exports.completeMapKeys = completeMapKeys;
/**
 * Registers an `ExtraData`-backed spec. Mirrors the `Register` overload that takes
 * `(options, enumKey)` and wraps it in `CompleteEnum` (:26-33); the raw-function
 * overload (:35-42) is what the mechanism entries below use directly.
 *
 * Reuses `argumentCompleters.ts`'s `EnumCompleter` shape so tag parameters and command
 * arguments describe an enum source exactly one way. `prefix` is `''` for every entry,
 * matching the `ByTag` registrations.
 */
function registerEnum(map, spec, completer) {
    map.set(spec, (_docs, extra, typed) => completeEnum(completer.values(extra), completer.label, typed));
}
function buildTagParamCompleters() {
    const map = new Map();
    // --- ExtraData-backed entries (CommandTabCompletions.cs:82-90) ---
    // Three of these are enum+script pairs in the C#, and since Phase 2D both halves are here:
    // <item> is SuggestItem (:261-267), which concatenates the item enum with the "item" AND
    // "book" script types; <entity_type> is SuggestEntityType (:251-259); <enchantment> is
    // SuggestEnchantmentType (:241-249).
    registerEnum(map, '<material>', { prefix: '', label: 'Material', values: d => d.materials });
    registerEnum(map, '<item>', { prefix: '', label: 'Item', values: d => d.items });
    registerEnum(map, '<statistic>', { prefix: '', label: 'Statistic', values: d => d.statistics });
    registerEnum(map, '<entity_type>', { prefix: '', label: 'Entity Type', values: d => d.entities });
    // :86 backs <effect> with Data.PotionEffects — not the particle `effects` set that
    // the playeffect command's `effect:` prefix uses (:57). Same word, different enum.
    registerEnum(map, '<effect>', { prefix: '', label: 'Potion Effect Type', values: d => d.potionEffects });
    registerEnum(map, '<biome>', { prefix: '', label: 'Biome', values: d => d.biomes });
    // :245 labels this enum "Enchantment Key", not "Enchantment".
    registerEnum(map, '<enchantment>', { prefix: '', label: 'Enchantment Key', values: d => d.enchantments });
    // CommandTabCompletions.cs:95, and the last registered spec this port left unserved. Backed by
    // the user's own `denizenscript.theme_colors.text_color_map`, pushed in by server.ts -- see
    // `customColorNames`. Two real tags use it: `<&[<custom_color_name>]>` and
    // `<ElementTag.custom_color[<custom_color_name>]>`, both verified against the live meta.
    map.set('<custom_color_name>', (_d, _e, typed) => customColorNames
        .filter(name => name.startsWith(typed))
        .map(name => ({ label: name, detail: `**Custom Color**: ${name}`, kind: 'enum' })));
    // --- Meta-backed entries (CommandTabCompletions.cs:91-94) ---
    map.set('<property-name>', (docs, _extra, typed) => suggestMechanisms(docs, typed, ''));
    map.set('<mechanism>=<value>', (docs, _extra, typed) => suggestMechPair(docs, typed));
    // The ";..." suffix survives normalisation (only "|..." is stripped), so this key is
    // reachable exactly as written — and only because the ByTag lookup runs before the
    // ';' branch, which would otherwise claim this spec and find nothing.
    map.set('<mechanism>=<value>;...', (docs, _extra, typed) => suggestMechPairSet(docs, typed));
    map.set('<property-map>', (docs, _extra, typed) => suggestMechPairSet(docs, typed));
    // --- Workspace-backed entries, unblocked by Phase 2D's WorkspaceTracker ---
    // Each of these needs the script index, which did not exist until the workspace scanner did.
    //
    // MEASURED REACH, so nobody has to re-derive it. Against the live meta, the three specs
    // registered immediately below are used by ZERO documented tags, so they cannot fire through
    // tag-parameter completion today -- they are registered because the C# registers them (:80-87)
    // and because a meta update can start using them at any time, not because they do anything
    // now. The four that follow ARE reachable, and were verified against the user's own workspace:
    // `<item[ham` offers their `hammer` item script beside the Minecraft item enum, and
    // `<inventory[my_inv` offers their `my_inventory` inventory script beside the labels.
    map.set('<procedure_script_name>', (_d, _e, typed, ws) => suggestScriptByType(ws, 'procedure', typed));
    // `null`, not a type name: <script> accepts a container of ANY type (:82).
    map.set('<script>', (_d, _e, typed, ws) => suggestScriptByType(ws, null, typed));
    map.set('<format_script>', (_d, _e, typed, ws) => suggestScriptByType(ws, 'format', typed));
    // SuggestInventoryType (:231-239). Its enum half is INVENTORY_MATCHERS -- a hardcoded C#
    // constant rather than minecraft.fds data, which is why this entry stayed unregistered for so
    // long. It was transcribed for Phase 2C-7's event validators, so both halves are available now
    // and the list has exactly one home.
    map.set('<inventory>', (_d, _e, typed, ws) => [
        ...completeEnum(eventValidators_1.INVENTORY_MATCHERS, 'Inventory Type', typed),
        ...suggestScriptByType(ws, 'inventory', typed)
    ]);
    // The script halves of the three enum entries above, wrapping rather than replacing them.
    const enumPlusScripts = (spec, ...types) => {
        const enumHalf = map.get(spec);
        map.set(spec, (docs, extra, typed, ws) => [
            ...enumHalf(docs, extra, typed, ws),
            ...types.flatMap(type => suggestScriptByType(ws, type, typed))
        ]);
    };
    enumPlusScripts('<item>', 'item', 'book');
    enumPlusScripts('<entity_type>', 'entity');
    enumPlusScripts('<enchantment>', 'enchantment');
    // --- Still deliberately not registered ---
    // <custom_color_name> (:95) reads ClientConfiguration.TextColorMap, which is not ported.
    return map;
}
/** The `ByTag` table (`CommandTabCompletions.cs:80-95`), minus the entries noted as unported above. */
exports.TAG_PARAM_COMPLETERS = buildTagParamCompleters();
/**
 * Strips the decoration off a documented parameter spec, leaving the bare spec that
 * the `ByTag` table and the branch tests below are written against.
 *
 * `CommandTabCompletions.cs:140` spells this as
 * `.Replace('(', ')').Replace('{', ')').Replace('}', ')').Replace(")", "").Replace("|...", "")`
 * — it folds `(`, `{` and `}` onto `)` and then deletes every `)`, a roundabout way of
 * deleting all four bracket characters. That effect is what is ported here.
 *
 * Note that only `|...` is deleted, never `;...`: `<mechanism>=<value>;...` passes through
 * unchanged, which is precisely why it can be registered as a `ByTag` key at :93.
 */
function normaliseDocParam(docParam) {
    return docParam.replace(/[(){}]/g, '').replace(/\|\.\.\./g, '');
}
exports.normaliseDocParam = normaliseDocParam;
/**
 * The values that could go where the user is typing inside a tag's brackets.
 *
 * `docParam` is the tag's documented parameter text and `typed` is the text already
 * entered for this parameter. `tag` is accepted because C# uses it to build each item's
 * documentation (`CompleteForTagPiece`, :131-135); this module produces no documentation,
 * so it is unused here and left to the caller.
 *
 * Port of `CompleteGenericTagParam` (:137-202). Returns an empty array — never throws —
 * for a spec it cannot serve.
 */
function completeTagParam(docs, extra, docParam, typed, tag, workspace = null) {
    return completeParam(docs, extra, docParam, '', typed, tag, workspace);
}
exports.completeTagParam = completeTagParam;
/**
 * `completeTagParam` with the `prefix` argument C# threads through the recursion
 * (:137, :158). It only ever decorates the option-list detail text at :187.
 */
function completeParam(docs, extra, docParam, prefix, typed, tag, workspace) {
    const results = [];
    const spec = normaliseDocParam(docParam);
    // Branch order is the C#'s: registered spec, then ';' pairs, then '/' options (:141,
    // :145, :174). It is observable — '<mechanism>=<value>;...' and 'size=true/false;name=<x>'
    // each match two branches and give different answers depending on which wins.
    const registered = exports.TAG_PARAM_COMPLETERS.get(spec);
    if (registered !== undefined) {
        return registered(docs, extra, typed, workspace);
    }
    if (spec.includes(';')) {
        const docPairs = spec.split(';');
        // A ';' spec that is not entirely `key=value` pairs is not a pair list at all, so
        // the branch declines and control falls through to the '/' branch (:148).
        if (docPairs.every(p => p.includes('='))) {
            const givenPairs = typed.split(';');
            const lastArg = givenPairs[givenPairs.length - 1];
            if (lastArg.includes('=')) {
                // The key is settled; complete its value against that key's own spec (:152-159).
                const expected = (0, frenetic_1.before)(lastArg, '=');
                const docMatch = docPairs.find(p => (0, frenetic_1.before)(p, '=') === expected);
                if (docMatch !== undefined) {
                    return completeParam(docs, extra, (0, frenetic_1.after)(docMatch, '='), `${expected}=`, (0, frenetic_1.after)(lastArg, '='), tag, workspace);
                }
                return results;
            }
            // Still naming a key: offer the documented keys not already supplied (:162-170).
            const givenKeys = new Set(givenPairs.filter(s => s.includes('=')).map(s => (0, frenetic_1.before)(s, '=')));
            for (const docPair of docPairs) {
                const key = (0, frenetic_1.before)(docPair, '=');
                const value = (0, frenetic_1.after)(docPair, '=');
                if (!givenKeys.has(key) && key.startsWith(lastArg)) {
                    results.push({ label: key, detail: `**${key}**=\`${value}\``, kind: 'tagPiece' });
                }
            }
            return results;
        }
    }
    if (spec.includes('/')) {
        let optionSpec = spec;
        // Unwrap one level of <...>, but only when nothing inside is itself a placeholder:
        // '<blocks/entities>' is a wrapped option list, whereas '<entity>/<material>' is two
        // placeholders and must keep its brackets so the two tests below can recognise them (:176-179).
        if (optionSpec.startsWith('<') && optionSpec.endsWith('>') && !optionSpec.substring(1, optionSpec.length - 1).includes('<')) {
            optionSpec = optionSpec.substring(1, optionSpec.length - 1);
        }
        const parts = optionSpec.split('/');
        for (const option of parts) {
            if (!option.includes('<')) {
                if (option.startsWith(typed)) {
                    // :187 — the whole option list, with the candidate bolded, behind the
                    // recursion prefix so a nested list reads as e.g. 'size=**true** / false'.
                    results.push({ label: option, detail: prefix + parts.map(p => p === option ? `**${p}**` : p).join(' / '), kind: 'tagPiece' });
                }
            }
            else if (option === '<entity>') {
                results.push(...completeEnum(extra.entities, 'Entity Type', typed));
            }
            else if (option === '<material>') {
                results.push(...completeEnum(extra.materials, 'Material', typed));
            }
            // Any other placeholder contributes nothing: C# has exactly these two special
            // cases (:190-197) and silently drops the rest.
        }
        return results;
    }
    return results;
}
//# sourceMappingURL=tagParamCompleters.js.map