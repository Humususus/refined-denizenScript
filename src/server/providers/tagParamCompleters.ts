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

import { MetaDocs, MetaTag } from '../metaDocs/metaTypes';
import { ExtraData } from '../metaDocs/extraData';
import { EnumCompleter } from './argumentCompleters';

/**
 * One suggested value for a tag parameter.
 *
 * `label` is the text to insert. `detail` is a short markdown line describing the
 * candidate, corresponding to the string C# feeds into a completion item's
 * *documentation*: the "input option" line of `CompleteForTagPiece` (:133) for
 * option/key candidates, and `CompleteEnum`'s `**{key}**: {value}` (:206) for enum
 * candidates. C#'s own `detail` field is always just the label again (see the
 * `CompletionItem` constructions at :134, :206, :211), so mirroring that would carry
 * no information; this carries the descriptive text instead.
 */
export interface ParamCandidate { label: string; detail: string; }

/**
 * A registered handler for one exact documented parameter spec — the port of
 * `CommandTabCompletions.ByPrefix[""]` for a `ByTag` entry. `ByTag` registrations
 * all use the empty prefix (:80-95), so the prefix dimension collapses away here.
 */
export type TagParamCompleter = (docs: MetaDocs, extra: ExtraData, typed: string) => ParamCandidate[];

/** Text before the first `sep`; the whole string when absent (FreneticExtensions' `Before`). */
function before(text: string, sep: string): string {
    const index = text.indexOf(sep);
    return index === -1 ? text : text.substring(0, index);
}

/** Text after the first `sep`; the whole string when absent (FreneticExtensions' `After`). */
function after(text: string, sep: string): string {
    const index = text.indexOf(sep);
    return index === -1 ? text : text.substring(index + sep.length);
}

/** Text after the last `sep`; the whole string when absent (FreneticExtensions' `AfterLast`). */
function afterLast(text: string, sep: string): string {
    const index = text.lastIndexOf(sep);
    return index === -1 ? text : text.substring(index + sep.length);
}

/** Every enum value starting with `typed`. Port of `CompleteEnum` (:204-207). */
function completeEnum(values: Set<string>, label: string | null, typed: string): ParamCandidate[] {
    const results: ParamCandidate[] = [];
    for (const value of values) {
        if (value.startsWith(typed)) {
            // C#'s `key == null ? null : new MarkupContent(...)` (:206) suppresses the
            // documentation entirely for a null key; an empty detail is this port's
            // equivalent. No ByTag registration actually passes null, but EnumCompleter
            // allows it, so the case is handled rather than assumed away.
            results.push({ label: value, detail: label === null ? '' : `**${label}**: ${value}` });
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
function suggestMechanisms(docs: MetaDocs, typed: string, suffix: string): ParamCandidate[] {
    const results: ParamCandidate[] = [];
    for (const mechanism of docs.mechanisms.values()) {
        if (mechanism.mechName.startsWith(typed)) {
            results.push({
                label: mechanism.mechName + suffix,
                detail: `**${mechanism.mechObject} Mechanism**: ${mechanism.mechName}`
            });
        }
    }
    return results;
}

/** Port of `SuggestMechPair` (:214-224): once `=` is typed the value side is undocumented, so nothing is offered. */
function suggestMechPair(docs: MetaDocs, typed: string): ParamCandidate[] {
    if (typed.includes('=')) {
        return [];
    }
    return suggestMechanisms(docs, typed, '=');
}

/** Port of `SuggestMechPairSet` (:226-229): only the text after the last `;` names the mechanism being typed. */
function suggestMechPairSet(docs: MetaDocs, typed: string): ParamCandidate[] {
    return suggestMechPair(docs, afterLast(typed, ';'));
}

/**
 * Registers an `ExtraData`-backed spec. Mirrors the `Register` overload that takes
 * `(options, enumKey)` and wraps it in `CompleteEnum` (:26-33); the raw-function
 * overload (:35-42) is what the mechanism entries below use directly.
 *
 * Reuses `argumentCompleters.ts`'s `EnumCompleter` shape so tag parameters and command
 * arguments describe an enum source exactly one way. `prefix` is `''` for every entry,
 * matching the `ByTag` registrations.
 */
function registerEnum(map: Map<string, TagParamCompleter>, spec: string, completer: EnumCompleter): void {
    map.set(spec, (_docs, extra, typed) => completeEnum(completer.values(extra), completer.label, typed));
}

function buildTagParamCompleters(): Map<string, TagParamCompleter> {
    const map = new Map<string, TagParamCompleter>();
    // --- ExtraData-backed entries (CommandTabCompletions.cs:82-90) ---
    // The C# handlers for <item>, <entity_type>, <enchantment> and <inventory> each
    // concatenate CompleteEnum with SuggestScriptByType (:241-270), so those four also
    // suggest matching workspace script containers. Only the enum half is ported here;
    // the script half needs WorkspaceTracker and arrives with Phase 2D, at which point
    // these entries gain a second source rather than being replaced.
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
    // --- Meta-backed entries (CommandTabCompletions.cs:91-94) ---
    map.set('<property-name>', (docs, _extra, typed) => suggestMechanisms(docs, typed, ''));
    map.set('<mechanism>=<value>', (docs, _extra, typed) => suggestMechPair(docs, typed));
    // The ";..." suffix survives normalisation (only "|..." is stripped), so this key is
    // reachable exactly as written — and only because the ByTag lookup runs before the
    // ';' branch, which would otherwise claim this spec and find nothing.
    map.set('<mechanism>=<value>;...', (docs, _extra, typed) => suggestMechPairSet(docs, typed));
    map.set('<property-map>', (docs, _extra, typed) => suggestMechPairSet(docs, typed));
    // --- Deliberately not registered ---
    // <script> (:81), <procedure_script_name> (:80) and <format_script> (:87) all resolve
    // through SuggestScriptByType, which needs WorkspaceTracker's script index: Phase 2D.
    // <inventory> (:90) is CompleteEnum(ExtraData.InventoryMatchers) + a script lookup, and
    // InventoryMatchers is a hardcoded C# constant (SharpDenizenTools ExtraData.cs:226-234)
    // that this port's ExtraData does not expose — it is not part of the minecraft.fds data.
    // <custom_color_name> (:95) reads ClientConfiguration.TextColorMap, which is not ported.
    return map;
}

/** The `ByTag` table (`CommandTabCompletions.cs:80-95`), minus the entries noted as unported above. */
export const TAG_PARAM_COMPLETERS: Map<string, TagParamCompleter> = buildTagParamCompleters();

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
export function normaliseDocParam(docParam: string): string {
    return docParam.replace(/[(){}]/g, '').replace(/\|\.\.\./g, '');
}

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
export function completeTagParam(docs: MetaDocs, extra: ExtraData, docParam: string, typed: string, tag: MetaTag): ParamCandidate[] {
    return completeParam(docs, extra, docParam, '', typed, tag);
}

/**
 * `completeTagParam` with the `prefix` argument C# threads through the recursion
 * (:137, :158). It only ever decorates the option-list detail text at :187.
 */
function completeParam(docs: MetaDocs, extra: ExtraData, docParam: string, prefix: string, typed: string, tag: MetaTag): ParamCandidate[] {
    const results: ParamCandidate[] = [];
    const spec = normaliseDocParam(docParam);
    // Branch order is the C#'s: registered spec, then ';' pairs, then '/' options (:141,
    // :145, :174). It is observable — '<mechanism>=<value>;...' and 'size=true/false;name=<x>'
    // each match two branches and give different answers depending on which wins.
    const registered = TAG_PARAM_COMPLETERS.get(spec);
    if (registered !== undefined) {
        return registered(docs, extra, typed);
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
                const expected = before(lastArg, '=');
                const docMatch = docPairs.find(p => before(p, '=') === expected);
                if (docMatch !== undefined) {
                    return completeParam(docs, extra, after(docMatch, '='), `${expected}=`, after(lastArg, '='), tag);
                }
                return results;
            }
            // Still naming a key: offer the documented keys not already supplied (:162-170).
            const givenKeys = new Set(givenPairs.filter(s => s.includes('=')).map(s => before(s, '=')));
            for (const docPair of docPairs) {
                const key = before(docPair, '=');
                const value = after(docPair, '=');
                if (!givenKeys.has(key) && key.startsWith(lastArg)) {
                    results.push({ label: key, detail: `**${key}**=\`${value}\`` });
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
                    results.push({ label: option, detail: prefix + parts.map(p => p === option ? `**${p}**` : p).join(' / ') });
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
