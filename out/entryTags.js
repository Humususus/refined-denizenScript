"use strict";
// Completion data for Denizen's `<entry[save_name].…>` tags.
//
// WHY THIS TABLE IS HARDCODED. Entry sub-tags are documented PER COMMAND, inside each command's
// `tags:` meta block, because what `<entry[x].…>` resolves to depends on which command saved the
// entry: `spawn` gives `spawned_entity`, `webget` gives `status`/`result`/`failed`, `sql` gives
// `result_list`. There are ZERO tags in the meta whose base is `entry`, so a tag-index lookup
// finds nothing -- which is exactly why `<entry[123].spawned_entity>` was never offered.
//
// This module is client-side and has no access to the loaded meta (the language server owns it),
// and it must work on the DEFAULT csharp engine, not just the TypeScript one. So the table is
// generated from live meta and embedded, the same approach the DenizenM tables in extension.ts
// already take. Regenerate it when Denizen adds commands or entry tags.
//
// No `vscode` import on purpose: this stays a pure function of its inputs so it can be unit
// tested, same as ./mutedDiagnostics.
Object.defineProperty(exports, "__esModule", { value: true });
exports.entryTagsFor = exports.findSaveEntries = exports.ALL_ENTRY_TAG_NAMES = exports.ENTRY_TAGS_BY_COMMAND = void 0;
// GENERATED from live Denizen meta on 2026-08-25.
// 32 commands, 46 distinct entry tag names.
exports.ENTRY_TAGS_BY_COMMAND = new Map([
    ["adjust", ["result", "result_list"]],
    ["bossbar", ["bar_uuid"]],
    ["bungeetag", ["result"]],
    ["clickable", ["command", "id"]],
    ["create", ["created_npc"]],
    ["customevent", ["any_ran", "was_cancelled", "determination_list"]],
    ["debug", ["submitted"]],
    ["discordcommand", ["command"]],
    ["discordcreatechannel", ["channel"]],
    ["discordcreatethread", ["created_thread"]],
    ["discordinteraction", ["command"]],
    ["discordmessage", ["message"]],
    ["displayitem", ["dropped"]],
    ["drop", ["dropped_entities", "dropped_entity"]],
    ["execute", ["output"]],
    ["fakespawn", ["faked_entity"]],
    ["filecopy", ["success"]],
    ["fileread", ["data"]],
    ["firework", ["launched_firework"]],
    ["give", ["leftover_items"]],
    ["map", ["created_map"]],
    ["mongo", ["result", "inserted_id", "ok", "upserted_id", "updated_count"]],
    ["mount", ["mounted_entities"]],
    ["mythicspawn", ["spawned_mythicmob"]],
    ["push", ["pushed_entities"]],
    ["random", ["possibilities", "selected"]],
    ["redis", ["result"]],
    ["run", ["created_queue"]],
    ["shoot", ["shot_entity", "shot_entities", "hit_entities", "location"]],
    ["spawn", ["spawned_entities", "spawned_entity"]],
    ["sql", ["result_list", "result_map", "affected_rows"]],
    ["webget", ["failed", "result", "result_binary", "result_headers", "status", "time_ran"]],
]);
exports.ALL_ENTRY_TAG_NAMES = ["affected_rows", "any_ran", "bar_uuid", "channel", "command", "created_map", "created_npc", "created_queue", "created_thread", "data", "determination_list", "dropped", "dropped_entities", "dropped_entity", "failed", "faked_entity", "hit_entities", "id", "inserted_id", "launched_firework", "leftover_items", "location", "message", "mounted_entities", "ok", "output", "possibilities", "pushed_entities", "result", "result_binary", "result_headers", "result_list", "result_map", "selected", "shot_entities", "shot_entity", "spawned_entities", "spawned_entity", "spawned_mythicmob", "status", "submitted", "success", "time_ran", "updated_count", "upserted_id", "was_cancelled"];
/**
 * Finds every `save:<name>` written above `uptoLine`, and which command wrote it.
 *
 * Scans upward from the cursor and stops at the first line with NO indentation, which is the
 * start of the enclosing container. An entry saved in a different container is not in scope, and
 * offering it would be worse than offering nothing -- the same reasoning `getContainerDefines`
 * in extension.ts uses for `- define`.
 *
 * `save:` may carry a tag (`save:<[name]>`), in which case the real name is unknowable; such
 * entries are skipped rather than offered as a literal.
 */
function findSaveEntries(lines, uptoLine) {
    const found = [];
    const seen = new Set();
    for (let i = Math.min(uptoLine, lines.length - 1); i >= 0; i--) {
        const line = lines[i];
        const trimmed = line.trim();
        if (i < uptoLine && trimmed.length > 0 && !line.startsWith(' ') && !line.startsWith('\t')) {
            // A container title. Everything above belongs to a different script.
            break;
        }
        if (!trimmed.startsWith('- ')) {
            continue;
        }
        const body = trimmed.substring(2).trim();
        const spaceIndex = body.indexOf(' ');
        if (spaceIndex < 0) {
            continue;
        }
        const command = body.substring(0, spaceIndex).toLowerCase().replace(/^[~^]/, '');
        // `save:` up to the next space -- a save name cannot contain one.
        const match = /(?:^|\s)save:([^\s]+)/i.exec(body);
        if (match === null) {
            continue;
        }
        const name = match[1].toLowerCase();
        if (name.includes('<')) {
            // Built from a tag; the literal text is not a name anyone can write.
            continue;
        }
        if (!seen.has(name)) {
            seen.add(name);
            found.push({ name, command });
        }
    }
    return found;
}
exports.findSaveEntries = findSaveEntries;
/**
 * The entry sub-tag names to offer for `<entry[name].…>`.
 *
 * Narrowed to the command that actually saved `name` when that is known, which is the whole
 * point: after `- spawn zombie save:123`, `<entry[123].` should offer `spawned_entity` and
 * `spawned_entities` and nothing else. Falls back to every documented entry tag when the entry
 * cannot be traced, because offering 46 names beats offering the 1871 general tag parts that
 * contain none of the right answers.
 */
function entryTagsFor(entryName, saved) {
    const match = saved.find(e => e.name === entryName.toLowerCase());
    if (match !== undefined) {
        const tags = exports.ENTRY_TAGS_BY_COMMAND.get(match.command);
        if (tags !== undefined) {
            return tags;
        }
    }
    return exports.ALL_ENTRY_TAG_NAMES;
}
exports.entryTagsFor = entryTagsFor;
//# sourceMappingURL=entryTags.js.map