import { describe, it, expect } from 'vitest';
import { matchEventLine, contextNamesForEvent } from './eventLineMatch';
import { MetaDocs, MetaEvent, createEmptyMetaDocs } from '../metaDocs/metaTypes';
import { linkEventMatchers } from '../metaDocs/metaLinker';
import { createEmptyExtraData } from '../metaDocs/extraData';

/**
 * Shared by event hover and <context.[...]> completion narrowing, user requests 2026-09-03.
 * Deliberately a SIBLING of containerChecks.ts's checkOneEventLine, not a reuse of it: that
 * function also carries switch-validity preference logic that diagnostics need and this does not.
 */
function docsFixture(): MetaDocs {
    const docs = createEmptyMetaDocs();
    const breaks = new MetaEvent();
    breaks.applyValue('events', 'player breaks <block>');
    breaks.applyValue('player', 'x');
    breaks.applyValue('context', '<context.location> LocationTag x\n<context.material> MaterialTag x');
    breaks.addTo(docs);

    const joins = new MetaEvent();
    joins.applyValue('events', 'player joins');
    joins.applyValue('player', 'x');
    joins.addTo(docs);

    linkEventMatchers(docs, createEmptyExtraData());
    return docs;
}

describe('matchEventLine', () => {
    it('matches a plain "on" line', () => {
        const docs = docsFixture();
        expect(matchEventLine(docs, '    on player joins:')?.cleanName).toBe('player joins');
    });

    it('matches an "after" line the same way', () => {
        const docs = docsFixture();
        expect(matchEventLine(docs, '    after player joins:')?.cleanName).toBe('player joins');
    });

    it('resolves the fill-in against a real block name', () => {
        // .name is the raw first `events` line ("<block>" and all); .cleanName strips <>'() --
        // confirmed against MetaEvent.applyValue's 'events' case.
        const docs = docsFixture();
        expect(matchEventLine(docs, '    on player breaks stone:')?.name).toBe('player breaks <block>');
    });

    it('strips a switch before matching', () => {
        // MUTANT CAUGHT: matching the raw text including "priority:5" would never find "player
        // joins" as a could-matcher word.
        const docs = docsFixture();
        expect(matchEventLine(docs, '    on player joins priority:5:')?.cleanName).toBe('player joins');
    });

    it('is case-insensitive', () => {
        const docs = docsFixture();
        expect(matchEventLine(docs, '    On Player Joins:')?.cleanName).toBe('player joins');
    });

    it('returns null for a command line', () => {
        const docs = docsFixture();
        expect(matchEventLine(docs, '    - narrate "hi"')).toBeNull();
    });

    it('returns null for "on"/"after" with nothing after it', () => {
        expect(matchEventLine(docsFixture(), '    on :')).toBeNull();
        expect(matchEventLine(docsFixture(), '    on')).toBeNull();
    });

    it('returns null for a line missing its trailing colon', () => {
        expect(matchEventLine(docsFixture(), '    on player joins')).toBeNull();
    });

    it('returns null for a line sharing no words with anything documented', () => {
        expect(matchEventLine(docsFixture(), '    on something entirely undocumented happens:')).toBeNull();
    });

    it('returns null rather than a PARTIAL match for an incomplete-but-prefix-matching line', () => {
        // "player" alone is a valid PREFIX of both "player breaks <block>" and "player joins" --
        // exactly the shape containerChecks.ts's fallback exists for, to give a diagnostic
        // somewhere to point at. Hover and completion have no such excuse: showing the wrong
        // event's documentation, or a random event's context tags, is worse than showing none.
        // MUTANT CAUGHT: passing allowPartial=true to tryMatch.
        expect(matchEventLine(docsFixture(), '    on player:')).toBeNull();
    });

    it('returns null when there are no events in the meta at all', () => {
        expect(matchEventLine(createEmptyMetaDocs(), '    on player joins:')).toBeNull();
    });
});

/**
 * `<context.[...]>` narrowing, user request 2026-09-03: "в <context. выводится все теги а не
 * только те что в ивенте" -- completion offered every documented tag instead of just this event's.
 *
 * The line format and every number in these comments is measured against the live meta
 * 2026-09-03, not invented: `<context.name> returns ...`, 667 events, 2001 lines, 444 distinct
 * names, zero containing a dot.
 */
describe('contextNamesForEvent', () => {
    function eventWithContext(...lines: string[]): MetaEvent {
        const evt = new MetaEvent();
        evt.applyValue('events', 'some event');
        evt.applyValue('context', lines.join('\n'));
        return evt;
    }

    it('extracts the name from the real meta\'s documented shape', () => {
        const evt = eventWithContext('<context.location> returns the LocationTag of the dispenser.');
        expect(contextNamesForEvent(evt)).toEqual(['location']);
    });

    it('extracts several names in the order they are documented', () => {
        const evt = eventWithContext(
            '<context.entity> returns the EntityTag that will be added.',
            '<context.location> returns the LocationTag that the entity will be added at.'
        );
        expect(contextNamesForEvent(evt)).toEqual(['entity', 'location']);
    });

    it('skips a wrapped continuation line that does not start with <context.', () => {
        // The real meta's own shape: a long description wraps onto its own line with no
        // "<context." prefix at all. MUTANT CAUGHT: extracting a name from every line regardless.
        const evt = eventWithContext(
            '<context.cause> returns an ElementTag of the cause.',
            'Reasons include DISTANCE, HOLDER_GONE, PLAYER_UNLEASH, and UNKNOWN'
        );
        expect(contextNamesForEvent(evt)).toEqual(['cause']);
    });

    it('excludes the "(key)" wildcard notation', () => {
        // Real syntax on events whose context is an arbitrary caller-supplied map -- "(key)" means
        // "any name", not a literal one to offer.
        const evt = eventWithContext('<context.(key)> returns the value of the input data key, if available.');
        expect(contextNamesForEvent(evt)).toEqual([]);
    });

    it('deduplicates a name documented twice', () => {
        const evt = eventWithContext(
            '<context.item> returns the ItemTag involved.',
            '<context.item> may also be null in some cases.'
        );
        expect(contextNamesForEvent(evt)).toEqual(['item']);
    });

    it('is case-insensitive but returns lower case, matching every other tag part in this codebase', () => {
        const evt = eventWithContext('<Context.Location> returns the LocationTag.');
        expect(contextNamesForEvent(evt)).toEqual(['location']);
    });

    it('returns an empty list for an event with no @context at all', () => {
        const evt = new MetaEvent();
        evt.applyValue('events', 'server start');
        expect(contextNamesForEvent(evt)).toEqual([]);
    });
});
