// Tests for Part B of CheckAllContainers (ScriptChecker.cs:1146-1319) -- the per-type special
// checks for `command`, `assignment` and `world`.
//
// SEPARATE FROM containerChecks.test.ts because these need meta and that file deliberately runs
// without it. Two of the three branches here consult `checker.meta`, and the world branch also
// needs the event could-matchers, which are built by `linkEventMatchers` from the Minecraft enum
// data -- so the fixture below assembles a miniature but complete meta rather than using none.
//
// Every test names the mutant it is there to kill.

import { describe, expect, it } from 'vitest';
import { ScriptChecker } from './scriptChecker';
import { linkEventMatchers } from '../metaDocs/metaLinker';
import { MetaDocs, MetaEvent, MetaAction, MetaCommand, MetaDataValue, createEmptyMetaDocs } from '../metaDocs/metaTypes';
import { createEmptyExtraData, ExtraData } from '../metaDocs/extraData';
import type { ScriptWarning } from './scriptWarnings';

function extraFixture(): ExtraData {
    const extra = createEmptyExtraData();
    extra.blocks.add('stone');
    extra.items.add('stick');
    extra.entities.add('zombie');
    for (const v of [...extra.blocks, ...extra.items, ...extra.entities]) {
        extra.all.add(v);
        extra.materials.add(v);
    }
    return extra;
}

/**
 * A miniature meta: two events, two actions, one command, and both data value sets.
 *
 * `narrate` is here only to keep the command layer quiet -- the bodies of these fixtures have to
 * contain SOMETHING, and an undocumented command would add `unknown_command` to every expectation.
 */
function metaFixture(): MetaDocs {
    const docs = createEmptyMetaDocs();

    // A player event, cancellable, with a known location and one documented switch.
    const breaks = new MetaEvent();
    breaks.applyValue('events', 'player breaks <block>');
    breaks.applyValue('player', 'When the player breaks a block.');
    breaks.applyValue('cancellable', 'true');
    breaks.applyValue('location', 'true');
    breaks.applyValue('switch', 'my_switch:value to only fire sometimes');
    breaks.addTo(docs);

    // A bare event with no player, no NPC, no location and no switches -- the foil for every
    // "only supported on events that have ..." message.
    const serverStart = new MetaEvent();
    serverStart.applyValue('events', 'server start');
    serverStart.addTo(docs);

    // An NPC event, so `assigned` has somewhere valid to land.
    const npcEvent = new MetaEvent();
    npcEvent.applyValue('events', 'npc completes navigation');
    npcEvent.applyValue('npc', 'When the NPC finishes moving.');
    npcEvent.addTo(docs);

    const spawn = new MetaAction();
    spawn.applyValue('actions', 'spawn');
    spawn.addTo(docs);

    // The reason MetaAction carries a regex at all: this never matches by exact name.
    const proximity = new MetaAction();
    proximity.applyValue('actions', '<entity> enter proximity');
    proximity.addTo(docs);

    const narrate = new MetaCommand();
    narrate.applyValue('name', 'narrate');
    narrate.applyValue('syntax', 'narrate [<text>]');
    narrate.addTo(docs);

    const globals = new MetaDataValue();
    globals.applyValue('name', 'global_switches');
    globals.applyValue('values', 'server_flagged,bukkit_priority');
    globals.addTo(docs);

    const notSwitches = new MetaDataValue();
    notSwitches.applyValue('name', 'not_switches');
    notSwitches.applyValue('values', 'item_flagged,regex');
    notSwitches.addTo(docs);

    linkEventMatchers(docs, extraFixture());
    return docs;
}

/** Runs the checker over a script with the fixture meta attached. */
function run(script: string, docs: MetaDocs | null = metaFixture()): ScriptChecker {
    const checker = new ScriptChecker(script);
    checker.meta = docs;
    checker.extraData = extraFixture();
    checker.run();
    return checker;
}

/**
 * Every DIAGNOSTIC. `infos` excluded since Phase 2D -- see the matching note in
 * containerChecks.test.ts. The fixture's "completely clean script" assertion below is about what
 * the user would see, and every file carries `stat_*` infos.
 */
function all(checker: ScriptChecker): ScriptWarning[] {
    return [...checker.errors, ...checker.warnings, ...checker.minorWarnings];
}

function keys(checker: ScriptChecker): string[] {
    return all(checker).map(w => w.warningUniqueKey);
}

function find(checker: ScriptChecker, key: string): ScriptWarning | undefined {
    return all(checker).find(w => w.warningUniqueKey === key);
}

/** A world script with the given event keys, each given a one-command body. */
function world(...events: string[]): string {
    const lines = ['my_world_script:', '    type: world', '    events:'];
    for (const evt of events) {
        lines.push(`        ${evt}:`, '        - narrate hi');
    }
    return lines.join('\n');
}

/** An assignment script with the given action keys. */
function assignment(...actions: string[]): string {
    const lines = ['my_assignment_script:', '    type: assignment', '    actions:'];
    for (const act of actions) {
        lines.push(`        ${act}:`, '        - narrate hi');
    }
    return lines.join('\n');
}

describe('the fixture itself', () => {
    it('produces a completely clean script, so every expectation below is about Part B', () => {
        // If this ever fails, the noise it names is polluting every other test in the file.
        expect(keys(run(world('on player breaks stone')))).toEqual([]);
        expect(keys(run(assignment('on spawn')))).toEqual([]);
    });

    it('built could-matchers for every fixture event', () => {
        const docs = metaFixture();
        for (const evt of docs.events.values()) {
            expect(evt.couldMatchers.length).toBeGreaterThan(0);
        }
    });
});

describe('command scripts (ScriptChecker.cs:1146-1165)', () => {
    function command(...extra: string[]): string {
        return ['my_command_script:', '    type: command', '    name: mycmd', '    description: does a thing',
            ...extra, '    script:', '    - narrate hi'].join('\n');
    }

    it('reports command_script_usage when usage does not match name', () => {
        // MUTANT: delete the branch, or compare against the script title instead of the name key.
        expect(keys(run(command('    usage: /othercmd stuff')))).toContain('command_script_usage');
    });

    it('accepts a usage that is the name followed by arguments', () => {
        expect(keys(run(command('    usage: /mycmd stuff')))).not.toContain('command_script_usage');
    });

    it('accepts a usage that is EXACTLY the name, with no arguments', () => {
        // ScriptChecker.cs:1152's second disjunct. A command taking no arguments has no trailing
        // space, so a prefix-only test would reject it.
        // MUTANT: drop the `usageString.text !== '/' + name` half.
        expect(keys(run(command('    usage: /mycmd')))).not.toContain('command_script_usage');
    });

    it('rejects a usage that merely starts with the name as a prefix of a longer word', () => {
        // The trailing space in the prefix is what stops `/mycmdextra` passing.
        // MUTANT: drop the space from the startsWith test.
        expect(keys(run(command('    usage: /mycmdextra stuff')))).toContain('command_script_usage');
    });

    it('says nothing about usage when there is no usage key', () => {
        expect(keys(run(command()))).not.toContain('command_script_usage');
    });

    it('reports command_script_aliasname when an alias repeats the name', () => {
        // MUTANT: delete the branch.
        const checker = run(command('    usage: /mycmd', '    aliases:', '    - mycmd'));
        expect(keys(checker)).toContain('command_script_aliasname');
    });

    it('accepts aliases that differ from the name', () => {
        const checker = run(command('    usage: /mycmd', '    aliases:', '    - mc', '    - command'));
        expect(keys(checker)).not.toContain('command_script_aliasname');
    });

    it('finds a repeated alias anywhere in the list, and reports it at ITS line', () => {
        // MUTANT: checking only aliasList[0].
        const checker = run(command('    usage: /mycmd', '    aliases:', '    - mc', '    - mycmd'));
        const warning = find(checker, 'command_script_aliasname')!;
        expect(warning).toBeDefined();
        // Line 7, zero-indexed: title 0, type 1, name 2, description 3, usage 4, `aliases:` 5,
        // `- mc` 6, `- mycmd` 7. Reported at the offending alias, not at the aliases key.
        expect(warning.line).toBe(7);
    });

    it('reports usage at the USAGE line, not the container line', () => {
        // MUTANT: reporting at script.lineNumber.
        const checker = run(command('    usage: /othercmd'));
        expect(find(checker, 'command_script_usage')!.line).toBe(4);
    });

    it('reports usage as a MINOR warning and aliasname as a full warning', () => {
        // ScriptChecker.cs:1154 uses MinorWarnings, :1161 uses Warnings. Severity is what decides
        // whether the user sees an Information or a Warning underline.
        // MUTANT: swapping the two lists.
        const usage = run(command('    usage: /othercmd'));
        expect(usage.minorWarnings.map(w => w.warningUniqueKey)).toContain('command_script_usage');
        const alias = run(command('    usage: /mycmd', '    aliases:', '    - mycmd'));
        expect(alias.warnings.map(w => w.warningUniqueKey)).toContain('command_script_aliasname');
    });
});

describe('assignment scripts (ScriptChecker.cs:1166-1198)', () => {
    it('accepts a documented action', () => {
        expect(keys(run(assignment('on spawn')))).not.toContain('action_missing');
    });

    it('reports action_missing for an undocumented action', () => {
        // MUTANT: delete the branch.
        expect(keys(run(assignment('on totally nonexistent action')))).toContain('action_missing');
    });

    it('accepts an action that only the REGEX can match', () => {
        // `on zombie enter proximity` is not a key in docs.actions -- the documented name is
        // `on <entity> enter proximity`. The regex fallback is the only thing that resolves it.
        // MUTANT: delete the regex loop, leaving only the exact-name lookup.
        expect(keys(run(assignment('on zombie enter proximity')))).not.toContain('action_missing');
    });

    it('reports action_object_notation for a raw object in an action line', () => {
        // MUTANT: delete the branch.
        expect(keys(run(assignment('on e@zombie spawn')))).toContain('action_object_notation');
    });

    it('underlines the object notation itself, not the whole line', () => {
        // ScriptChecker.cs:1177 uses `Warn` with an explicit range, NOT `warnScript`.
        // MUTANT: routing this through warnScript, which would span the whole line and prefix the
        // message with the script name.
        const checker = run(assignment('on e@zombie spawn'));
        const warning = find(checker, 'action_object_notation')!;
        expect(warning.customMessageForm).not.toContain('In script');
        expect(warning.endChar - warning.startChar).toBeLessThan('on e@zombie spawn'.length);
    });

    it('spans from the FIRST @ to the LAST when a line has several', () => {
        // ScriptChecker.cs:1175-1176 is a raw IndexOf/LastIndexOf pair.
        // MUTANT: using lastIndexOf for the start, or indexOf for the end.
        // In `on e@zombie hits e@player` the two '@' are at indices 4 and 18, so the range spans
        // 14 characters -- from the first '@' to the last, both included in neither end's letter.
        const line = 'on e@zombie hits e@player';
        const warning = find(run(assignment(line)), 'action_object_notation')!;
        expect(warning.endChar - warning.startChar).toBe(line.lastIndexOf('@') - line.indexOf('@'));
        expect(warning.endChar - warning.startChar).toBe(14);
    });

    it('produces a ZERO-WIDTH range when the line has only one @', () => {
        // Unlike the event branch, which goes through `containsObjectNotation` and always spans at
        // least the letter before the '@', this branch takes IndexOf and LastIndexOf of the SAME
        // single character -- so start and end coincide. That is the C#'s behaviour, and the
        // difference between the two branches is real rather than a porting slip.
        // MUTANT: "fixing" this to `end + 1`, which would diverge from the C# highlight.
        const warning = find(run(assignment('on e@zombie spawn')), 'action_object_notation')!;
        expect(warning.startChar).toBe(warning.endChar);
    });

    it('says nothing at all when there is no actions key', () => {
        const checker = run('my_assignment_script:\n    type: assignment\n    interact scripts:\n    - 10 my_interact');
        expect(keys(checker)).not.toContain('action_missing');
    });

    it('checks EVERY action key, not just the first', () => {
        // MUTANT: `break` after the first iteration.
        const checker = run(assignment('on spawn', 'on another nonexistent thing'));
        expect(keys(checker).filter(k => k === 'action_missing').length).toBe(1);
    });
});

describe('world scripts: event resolution (ScriptChecker.cs:1199-1268)', () => {
    it('accepts a documented event', () => {
        expect(keys(run(world('on player breaks stone')))).not.toContain('event_missing');
    });

    it('reports event_missing for an event that matches nothing', () => {
        // MUTANT: delete the branch, or default matchedEvent to something non-null.
        expect(keys(run(world('on totally nonexistent event thing')))).toContain('event_missing');
    });

    it('gives the PARTIAL-match message when only a prefix matches', () => {
        // ScriptChecker.cs:1266. Same warning key, different message -- so one ignorewarning
        // silences both, which is what a user who wants them gone expects.
        // MUTANT: delete the partial-match rescan, which would leave the plain message.
        // `player breaks` matches the first two words of `player breaks <block>` and stops there.
        const checker = run(world('on player breaks'));
        const warning = find(checker, 'event_missing')!;
        expect(warning).toBeDefined();
        expect(warning.customMessageForm).toContain('partial match');
        expect(warning.customMessageForm).toContain('player breaks <block>');
    });

    it('uses the plain message when not even a prefix matches', () => {
        // MUTANT: always using the partial-match message.
        const warning = find(run(world('on totally nonexistent event thing')), 'event_missing')!;
        expect(warning.customMessageForm).not.toContain('partial match');
    });

    it('strips an "on " prefix before matching', () => {
        expect(keys(run(world('on server start')))).not.toContain('event_missing');
    });

    it('strips an "after " prefix before matching', () => {
        // MUTANT: dropping the `after ` case, which would make every `after` event unfindable.
        expect(keys(run(world('after server start')))).not.toContain('event_missing');
    });

    it('matches an event line with NO prefix at all', () => {
        // The third arm of the C#'s nested ternary strips nothing.
        // MUTANT: unconditionally stripping three characters.
        expect(keys(run(world('server start')))).not.toContain('event_missing');
    });

    it('reports event_object_notation for a raw object in an event line', () => {
        // MUTANT: delete the branch.
        expect(keys(run(world('on player breaks e@zombie')))).toContain('event_object_notation');
    });

    it('underlines the object notation itself, not the whole line', () => {
        // ScriptChecker.cs:1213 uses `Warn` with an explicit range, like the action case.
        const warning = find(run(world('on player breaks e@zombie')), 'event_object_notation')!;
        expect(warning.customMessageForm).not.toContain('In script');
        expect(warning.startChar).toBeLessThan(warning.endChar);
    });

    it('does not treat a not_switches word as a switch', () => {
        // `item_flagged:cool` must stay part of the event line. If it were split off as a switch,
        // the remaining line would be a different event -- and, here, still a valid one, so the
        // observable effect is the SWITCH warning that would follow.
        // MUTANT: dropping the not_switches test in separateSwitches.
        expect(keys(run(world('on player breaks item_flagged:cool')))).not.toContain('unknown_switch');
    });

    it('checks EVERY event key, not just the first', () => {
        const checker = run(world('on player breaks stone', 'on nonsense event here'));
        expect(keys(checker).filter(k => k === 'event_missing').length).toBe(1);
    });
});

describe('world scripts: switch checking (ScriptChecker.cs:1271-1315)', () => {
    it("accepts 'true' and 'false' for cancelled, in any case", () => {
        expect(keys(run(world('on player breaks stone cancelled:true')))).not.toContain('bad_switch_value');
        expect(keys(run(world('on player breaks stone ignorecancelled:FALSE')))).not.toContain('bad_switch_value');
    });

    it('reports bad_switch_value for a non-boolean cancelled', () => {
        // MUTANT: delete the branch.
        expect(keys(run(world('on player breaks stone cancelled:maybe')))).toContain('bad_switch_value');
    });

    it('accepts a decimal number for priority and chance', () => {
        expect(keys(run(world('on player breaks stone priority:5')))).not.toContain('bad_switch_value');
        expect(keys(run(world('on player breaks stone priority:-1.5')))).not.toContain('bad_switch_value');
        expect(keys(run(world('on player breaks stone chance:0.25')))).not.toContain('bad_switch_value');
    });

    it('reports bad_switch_value for a non-numeric priority', () => {
        expect(keys(run(world('on player breaks stone priority:high')))).toContain('bad_switch_value');
    });

    it('rejects the values Number() would wrongly accept', () => {
        // The reason parsesAsDouble is a regex and not `!isNaN(Number(v))`: Number('0x10') is 16
        // and Number('Infinity') is Infinity, neither of which double.TryParse accepts. Accepting
        // them would silence a real warning.
        // MUTANT: parsesAsDouble -> `!isNaN(Number(text))`.
        expect(keys(run(world('on player breaks stone priority:0x10')))).toContain('bad_switch_value');
        expect(keys(run(world('on player breaks stone priority:Infinity')))).toContain('bad_switch_value');
    });

    it('rejects an empty priority value', () => {
        // Number('') is 0. MUTANT: dropping the empty-string guard in parsesAsDouble.
        expect(keys(run(world('on player breaks stone priority:')))).toContain('bad_switch_value');
    });

    it('accepts exponent notation, which .NET does', () => {
        expect(keys(run(world('on player breaks stone priority:1.5e3')))).not.toContain('bad_switch_value');
    });

    it('accepts in/location_flagged on an event with a known location', () => {
        expect(keys(run(world('on player breaks stone in:myworld')))).not.toContain('unknown_switch');
    });

    it('reports unknown_switch for in/location_flagged on an event without a location', () => {
        // MUTANT: delete the branch, or read a different flag.
        const checker = run(world('on server start in:myworld'));
        expect(keys(checker)).toContain('unknown_switch');
        expect(find(checker, 'unknown_switch')!.customMessageForm).toContain('known location');
    });

    it('accepts flagged/permission on an event with a linked player', () => {
        expect(keys(run(world('on player breaks stone flagged:cool')))).not.toContain('unknown_switch');
        expect(keys(run(world('on player breaks stone permission:my.perm')))).not.toContain('unknown_switch');
    });

    it('reports unknown_switch for flagged on an event without a player', () => {
        const checker = run(world('on server start flagged:cool'));
        expect(find(checker, 'unknown_switch')!.customMessageForm).toContain('linked player');
    });

    it('accepts assigned on an event with a linked NPC', () => {
        expect(keys(run(world('on npc completes navigation assigned:bob')))).not.toContain('unknown_switch');
    });

    it('reports unknown_switch for assigned on an event without an NPC', () => {
        const checker = run(world('on server start assigned:bob'));
        expect(find(checker, 'unknown_switch')!.customMessageForm).toContain('linked NPC');
    });

    it("accepts a switch the event documents itself", () => {
        expect(keys(run(world('on player breaks stone my_switch:yes')))).not.toContain('unknown_switch');
    });

    it('accepts a switch from the global_switches data set', () => {
        // MUTANT: hardcoding the global switch list instead of reading the meta data.
        expect(keys(run(world('on player breaks stone server_flagged:x')))).not.toContain('unknown_switch');
    });

    it('reports unknown_switch for a switch nobody recognises', () => {
        const checker = run(world('on player breaks stone nonsense_switch:x'));
        expect(find(checker, 'unknown_switch')!.customMessageForm).toContain('unrecognized');
    });

    it('checks EVERY switch on the line, not just the first', () => {
        // The VALID switch comes first, so a loop that stopped after one switch would report
        // nothing at all here.
        // MUTANT: `break`/`return` after the first switch.
        const checker = run(world('on player breaks stone my_switch:ok nonsense_switch:x'));
        expect(keys(checker)).toContain('unknown_switch');
    });

    it('collapses two bad switches on ONE line into a single warning', () => {
        // Not a Part B behaviour but the collector's: `warn` dedupes per (list, line, key), which
        // ScriptChecker.cs:162-168 does too. Worth pinning here because the test above would
        // otherwise read as if it were counting, and a future reader comparing against the C#
        // loop would expect two.
        const checker = run(world('on server start assigned:bob flagged:cool'));
        expect(keys(checker).filter(k => k === 'unknown_switch').length).toBe(1);
    });

    it('does not check switches at all when the event did not resolve', () => {
        // ScriptChecker.cs:1269's else -- the switch loop is in the MATCHED branch. Reporting
        // switch problems against an event that does not exist would be noise on top of noise.
        // MUTANT: moving the switch loop out of the else.
        const checker = run(world('on nonsense event here nonsense_switch:x'));
        expect(keys(checker)).toContain('event_missing');
        expect(keys(checker)).not.toContain('unknown_switch');
    });
});

describe('cold start: meta is null', () => {
    it('reports nothing from the assignment branch', () => {
        // NULL META IS A REAL STATE: diagnostics run from the first keystroke while the meta is
        // still downloading. Reporting every action as missing for those seconds would be worse
        // than reporting nothing.
        // MUTANT: dropping the null guard -- which would also throw, not merely over-report.
        expect(keys(run(assignment('on totally nonexistent action'), null))).not.toContain('action_missing');
    });

    it('reports nothing from the world branch', () => {
        expect(keys(run(world('on totally nonexistent event thing'), null))).not.toContain('event_missing');
    });

    it('still reports object notation, which needs no meta', () => {
        // ScriptChecker.cs:1206-1215 runs BEFORE the meta is consulted, so this one check survives
        // a cold start. MUTANT: moving the null guard above it.
        expect(keys(run(world('on player breaks e@zombie'), null))).toContain('event_object_notation');
    });

    it('still runs the whole command branch, which never needed meta', () => {
        const script = ['my_command_script:', '    type: command', '    name: mycmd', '    description: d',
            '    usage: /othercmd', '    script:', '    - narrate hi'].join('\n');
        expect(keys(run(script, null))).toContain('command_script_usage');
    });
});

describe('gaps the mutation audit found', () => {
    it('resolves an action documented WITH an "on " prefix by exact name', () => {
        // ScriptChecker.cs:1179 strips `on ` and puts it back, so the lookup is against the full
        // documented name. No action in the live meta is named that way -- 0 of 50 -- which is why
        // this needs a purpose-built fixture: without one the round-trip is unobservable and the
        // mutant that deletes it survives.
        // MUTANT CAUGHT: dropping `actionName = 'on ' + actionName`.
        const docs = metaFixture();
        const odd = new MetaAction();
        odd.applyValue('actions', 'on custom thing');
        odd.addTo(docs);
        expect(keys(run(assignment('on custom thing'), docs))).not.toContain('action_missing');
    });

    it('searches for a full match, not a merely plausible one', () => {
        // ScriptChecker.cs:1225 passes precise=false. Flipping it to true makes `<block>` demand a
        // name that is actually in the enum data, so an unknown block would stop resolving.
        // MUTANT CAUGHT: tryMatch(parts, false, true).
        expect(keys(run(world('on player breaks some_custom_block')))).not.toContain('event_missing');
    });

    it('reports bad_switch_value for a non-numeric CHANCE, not just priority', () => {
        // MUTANT CAUGHT: dropping `chance` from the numeric pair -- it would fall through to the
        // catch-all and be reported as an unknown switch instead of a bad value.
        const checker = run(world('on player breaks stone chance:high'));
        expect(keys(checker)).toContain('bad_switch_value');
        expect(find(checker, 'bad_switch_value')!.customMessageForm).toContain('chance');
    });

    it('reports unknown_switch for LOCATION_FLAGGED on an event without a location', () => {
        // MUTANT CAUGHT: dropping `location_flagged` from the location pair.
        const checker = run(world('on server start location_flagged:x'));
        expect(find(checker, 'unknown_switch')!.customMessageForm).toContain('known location');
    });

    it('reports unknown_switch for PERMISSION on an event without a player', () => {
        // MUTANT CAUGHT: dropping `permission` from the player pair.
        const checker = run(world('on server start permission:my.perm'));
        expect(find(checker, 'unknown_switch')!.customMessageForm).toContain('linked player');
    });

    it('does not THROW when the event fails to resolve but carries switches', () => {
        // The `return` after event_missing is what keeps `matchedEvent` from being read while
        // null. Without it the switch loop dereferences null, the per-container try/catch turns
        // that into `exception_internal`, and the user gets an internal error instead of a
        // useful message -- which the earlier "not.toContain('unknown_switch')" test would happily
        // let through.
        // MUTANT CAUGHT: removing the early return.
        const checker = run(world('on nonsense event here nonsense_switch:x'));
        expect(keys(checker)).not.toContain('exception_internal');
    });

    it('does not THROW on a cold start with an assignment script', () => {
        // Same shape: without the null guard, `checker.meta.actions` throws and the container's
        // whole diagnostic set is replaced by `exception_internal`.
        // MUTANT CAUGHT: removing the meta null guard in the assignment branch.
        expect(keys(run(assignment('on totally nonexistent action'), null))).not.toContain('exception_internal');
    });

    it('does not THROW on a cold start with a world script', () => {
        // MUTANT CAUGHT: removing the meta null guard in the world branch.
        expect(keys(run(world('on totally nonexistent event thing'), null))).not.toContain('exception_internal');
    });
});

describe('choosing between events that all match (ScriptChecker.cs:1221-1249)', () => {
    // These need TWO events that both accept the same line, which the main fixture deliberately
    // does not have. A `<'a'> <'b'> <'c'>` format matches any three words at the weakest possible
    // score (1 per word), so it is the reliable foil for a literal format scoring 10.

    /** Labelled event FIRST, literal event second. Which one wins is the whole question. */
    function twoEvents(labelledHasPlayer: boolean, literalHasPlayer: boolean, labelledHasLocation: boolean): MetaDocs {
        const docs = createEmptyMetaDocs();
        const labelled = new MetaEvent();
        labelled.applyValue('events', "<'a'> <'b'> <'c'>");
        if (labelledHasPlayer) {
            labelled.applyValue('player', 'Has a player.');
        }
        if (labelledHasLocation) {
            labelled.applyValue('location', 'true');
        }
        else {
            // Documents `in` as its OWN switch while having no location -- so isValidSwitch says
            // yes but the switch loop's own hasLocation test says no. That gap is what makes the
            // choice between the two events observable.
            labelled.applyValue('switch', 'in:x pretend this is supported');
        }
        labelled.addTo(docs);
        const literal = new MetaEvent();
        literal.applyValue('events', 'player breaks stone');
        literal.applyValue('location', 'true');
        if (literalHasPlayer) {
            literal.applyValue('player', 'Has a player.');
        }
        literal.addTo(docs);
        const narrate = new MetaCommand();
        narrate.applyValue('name', 'narrate');
        narrate.applyValue('syntax', 'narrate [<text>]');
        narrate.addTo(docs);
        linkEventMatchers(docs, extraFixture());
        return docs;
    }

    it('prefers the higher-scoring matcher over the one found first', () => {
        // The labelled event is found first and accepts the switch, so `matchedSwitches` is already
        // true when the literal event comes along -- meaning the rescue arm cannot save it and the
        // SCORE comparison is the only thing that can promote it. The literal event has a real
        // location; the labelled one only claims to support `in`.
        // MUTANT CAUGHT: `if (matched === null)` -- dropping isBetterMatchThan.
        const checker = run(world('on player breaks stone in:myworld'), twoEvents(true, true, false));
        expect(keys(checker)).not.toContain('unknown_switch');
    });

    it('keeps a switch-valid match rather than a better match whose switches fail', () => {
        // The mirror case. The labelled event accepts `flagged` (it has a player); the literal
        // event scores higher but has none. Real behaviour keeps the labelled one, because the
        // inner `allSwitchesValid` test gates the promotion.
        // MUTANT CAUGHT: assigning unconditionally inside the isBetterMatchThan branch, and
        // `allSwitchesValid` hardcoded to true.
        const checker = run(world('on player breaks stone flagged:x'), twoEvents(true, false, true));
        expect(keys(checker)).not.toContain('unknown_switch');
    });

    it('promotes a worse matcher that accepts the switches over a better one that does not', () => {
        // ScriptChecker.cs:1241-1246, the arm that reads like a bug: a matcher that scored LOWER
        // still wins if it is the first whose switches all check out.
        //
        // REACHING IT NEEDS THE BETTER EVENT FIRST. With the worse one first, the better one is
        // promoted by the ordinary `isBetterMatchThan` branch and this arm never runs -- which is
        // exactly why the first version of this test left the mutant alive. So: literal (better,
        // no player) first, labelled (worse, has player) second, and a `flagged` switch only the
        // second accepts.
        // MUTANT CAUGHT: deleting the rescue arm.
        const docs = createEmptyMetaDocs();
        const literal = new MetaEvent();
        literal.applyValue('events', 'player breaks stone');
        literal.applyValue('location', 'true');
        literal.addTo(docs);
        const labelled = new MetaEvent();
        labelled.applyValue('events', "<'a'> <'b'> <'c'>");
        labelled.applyValue('player', 'Has a player.');
        labelled.addTo(docs);
        const narrate = new MetaCommand();
        narrate.applyValue('name', 'narrate');
        narrate.applyValue('syntax', 'narrate [<text>]');
        narrate.addTo(docs);
        linkEventMatchers(docs, extraFixture());
        expect(keys(run(world('on player breaks stone flagged:x'), docs))).not.toContain('unknown_switch');
    });

    it('requires EVERY switch to be valid, not merely one of them', () => {
        // `allSwitchesValid` is `All`, not `Any`. With `some`, the labelled event would be accepted
        // on the strength of `flagged` alone and kept, and the reported problem would be the NPC
        // one. With `every`, neither event accepts both switches, and the better one wins.
        // MUTANT CAUGHT: switches.every -> switches.some.
        const checker = run(world('on player breaks stone flagged:x assigned:y'), twoEvents(true, false, true));
        expect(find(checker, 'unknown_switch')!.customMessageForm).toContain('linked player');
    });
});
