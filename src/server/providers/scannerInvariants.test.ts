/**
 * Structural invariant fuzzer for the two line scanners that the next phase (tag parsing)
 * is about to extend: `splitTopLevelArguments` (./cursorContext) and `tokenizeSyntax`
 * (./signatureHelpProvider). Both are believed correct as of this writing — this file's
 * job is to build a regression net BEFORE that extension happens, not to find a bug today.
 *
 * Every defect these two scanners have hit so far — a naive space-split breaking on a
 * quoted argument, a bare `>` silently dropped, a bare `<` opening an unclosable depth and
 * swallowing the rest of the line, and a syntax tokeniser shredding a bracketed group that
 * contained a space — is a violation of the SAME underlying property: concatenating every
 * returned span's text, in order, must reproduce the input with exactly its separator
 * characters removed. That property is checked here as `assertReconstructs`.
 *
 * On the "separator" definition (see the docstring on `assertReconstructs` for why this
 * matters): a space is a separator only in certain scanner-specific states (outside quotes
 * and outside tag depth for `splitTopLevelArguments`; outside bracket depth for
 * `tokenizeSyntax`). That state is NOT something you can recover by asking "which
 * characters did the scanner's own output leave uncovered" — a scanner that over-consumes
 * (the historical "unclosable depth" bug) swallows a would-be separator INTO a span rather
 * than dropping it, so it never shows up as an uncovered character; a purely
 * output-derived check would miss it structurally, for any input, regardless of corpus
 * size. So this file tracks quote/depth state itself, in `argumentSeparatorMask` and
 * `syntaxSeparatorMask` below, as an INDEPENDENT ground truth to compare the scanners'
 * output against — independent meaning: a second, separate implementation of the same
 * documented rule (not an import of the scanner's internals), so that a future regression
 * in one copy doesn't silently also live in the other and go unnoticed.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { splitTopLevelArguments } from './cursorContext';
import { tokenizeSyntax } from './signatureHelpProvider';
import { buildMetaDocs } from '../metaDocs/metaDocsManager';
import { MetaBlock } from '../metaDocs/metaLoader';

/** The shape both scanners' span types share; only `start`/`end` are needed here. */
interface Span { start: number; end: number; }

// ---------------------------------------------------------------------------------------
// Independent reference separator classifiers.
//
// These deliberately mirror the RULES documented on the two scanners (not their code) as
// a second, separately-written implementation. `isValidTagFirstCharRef` in particular is a
// standalone copy of cursorContext.ts's `isValidTagFirstChar` — kept separate so that if a
// future edit to the scanner's copy drifts from the documented VALID_TAG_FIRST_CHAR rule,
// this oracle still reflects the rule and the mismatch surfaces as a test failure instead
// of silently traveling into both places at once.
// ---------------------------------------------------------------------------------------

function isValidTagFirstCharRef(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch === '&' || ch === '_' || ch === '[';
}

/** Ground truth for `splitTopLevelArguments`: mask[i] is true iff text[i] is a space outside quotes and outside tag depth. */
function argumentSeparatorMask(text: string): boolean[] {
    const mask: boolean[] = new Array(text.length).fill(false);
    let quote: string | null = null;
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        mask[i] = ch === ' ' && quote === null && depth === 0;
        if (mask[i]) {
            continue;
        }
        if (quote !== null) {
            if (ch === quote) {
                quote = null;
            }
            continue;
        }
        if (ch === '"' || ch === '\'') {
            quote = ch;
            continue;
        }
        if (ch === '<') {
            if (i + 1 < text.length && isValidTagFirstCharRef(text[i + 1])) {
                depth++;
            }
            continue;
        }
        if (ch === '>') {
            if (depth > 0) {
                depth--;
            }
            continue;
        }
    }
    return mask;
}

/** Ground truth for `tokenizeSyntax`: mask[i] is true iff syntax[i] is a space outside the shared []()<> depth. */
function syntaxSeparatorMask(syntax: string): boolean[] {
    const mask: boolean[] = new Array(syntax.length).fill(false);
    let depth = 0;
    for (let i = 0; i < syntax.length; i++) {
        const ch = syntax[i];
        mask[i] = ch === ' ' && depth === 0;
        if (mask[i]) {
            continue;
        }
        if (ch === '[' || ch === '(' || ch === '<') {
            depth++;
        }
        else if (ch === ']' || ch === ')' || ch === '>') {
            if (depth > 0) {
                depth--;
            }
        }
    }
    return mask;
}

/**
 * `tokenizeSyntax` deliberately drops the leading command-name token (see its doc
 * comment), so the reconstruction clause applies to the input with that token removed, not
 * the whole input. Rather than special-casing that in the assertion, fold it into the same
 * mask used for everything else: treat every character through the separator that ends the
 * first token as an ADDITIONAL forced-separator. That makes the standard reconstruction
 * check naturally require every span to start after the command name — exactly the
 * behaviour being relied on — without a separate code path.
 */
function withDroppedLeadingToken(mask: boolean[]): boolean[] {
    const n = mask.length;
    // Skip leading separators: tokenizeSyntax does not open a token until it sees the
    // first non-separator character, so leading whitespace is not itself "the command
    // name" — it just delays where the command name starts.
    let i = 0;
    while (i < n && mask[i]) {
        i++;
    }
    if (i === n) {
        // Nothing but separators (or an empty string): a token never opens, so nothing is
        // ever emitted, dropped or otherwise.
        return mask.map(() => true);
    }
    // [i, j) is the maximal run of non-separator characters starting at i — the command
    // name itself, exactly as tokenizeSyntax's tokenStart/flush bookkeeping would consume
    // it (depth-affected embedded spaces inside that run are already reflected in `mask`).
    let j = i;
    while (j < n && !mask[j]) {
        j++;
    }
    // Also drop the separator that ends the command name, if the string continues past it.
    const dropThrough = j === n ? n : j + 1;
    return mask.map((value, idx) => value || idx < dropThrough);
}

/**
 * Asserts the four structural invariants against a precomputed ground-truth separator
 * mask (see above) — never against the scanner's own output, which would make the
 * over-consumption class of bug invisible (see the file docstring).
 *
 * Uses plain conditionals rather than per-position `expect(...)` calls: with a
 * multi-thousand-input corpus, eagerly building a diagnostic message string (as `expect`'s
 * optional message argument does, on every call, pass or fail) for every character of
 * every input made the whole suite time out. Diagnostics are built lazily, only once a
 * check has actually failed.
 */
function assertReconstructs(input: string, spans: Span[], mask: boolean[]): void {
    const fail = (detail: string): never => {
        throw new Error(`Reconstruction invariant failed for input ${JSON.stringify(input)}: ${detail}`);
    };
    // Clause 1: every span is well-formed and in range.
    for (const span of spans) {
        if (!(span.start >= 0 && span.start < span.end && span.end <= input.length)) {
            fail(`clause 1: malformed span {start: ${span.start}, end: ${span.end}} (input.length ${input.length})`);
        }
    }
    // Clause 2: spans are strictly ordered and non-overlapping.
    for (let i = 1; i < spans.length; i++) {
        if (spans[i].start < spans[i - 1].end) {
            fail(`clause 2: span ${i} {start: ${spans[i].start}} overlaps span ${i - 1} {end: ${spans[i - 1].end}}`);
        }
    }
    // Clause 3: no span begins or ends on a separator character.
    for (const span of spans) {
        if (mask[span.start]) {
            fail(`clause 3: span {start: ${span.start}, end: ${span.end}} begins on a separator`);
        }
        if (mask[span.end - 1]) {
            fail(`clause 3: span {start: ${span.start}, end: ${span.end}} ends on a separator`);
        }
    }
    // Clause 4, the important one: reconstruction. Every masked (separator) position must
    // be uncovered by any span, and every unmasked (content) position must be covered by
    // exactly one.
    const covered: boolean[] = new Array(input.length).fill(false);
    for (const span of spans) {
        for (let i = span.start; i < span.end; i++) {
            covered[i] = true;
        }
    }
    for (let i = 0; i < input.length; i++) {
        if (covered[i] === mask[i]) {
            fail(`clause 4: position ${i} (${JSON.stringify(input[i])}) coverage was ${covered[i]}, expected ${!mask[i]}`);
        }
    }
    // Restated in the exact terms the brief uses: concatenating every span's text, in
    // order, reproduces the input with all separator characters removed.
    const actual = spans.map(span => input.substring(span.start, span.end)).join('');
    let expected = '';
    for (let i = 0; i < input.length; i++) {
        if (!mask[i]) {
            expected += input[i];
        }
    }
    if (actual !== expected) {
        fail(`clause 4: concatenated span text ${JSON.stringify(actual)} !== expected ${JSON.stringify(expected)}`);
    }
}

// ---------------------------------------------------------------------------------------
// Deterministic corpus. Alphabet covers every character class that has historically broken
// either scanner: letters and digits (tag-first-char boundaries), space (the separator
// itself), <>[]() (depth), "' (quotes), and the remaining characters the brief calls out
// (: | . / ~ & _ -).
// ---------------------------------------------------------------------------------------

const ALPHABET = ['a', 'z', 'A', 'Z', '0', '9', ' ', '<', '>', '[', ']', '(', ')', '"', '\'', ':', '|', '.', '/', '~', '&', '_', '-'];

/** All strings over ALPHABET up to `maxLength`, inclusive, exhaustively. */
function exhaustiveStrings(maxLength: number): string[] {
    let level = [''];
    const all: string[] = [''];
    for (let len = 1; len <= maxLength; len++) {
        const next: string[] = [];
        for (const prefix of level) {
            for (const ch of ALPHABET) {
                next.push(prefix + ch);
            }
        }
        all.push(...next);
        level = next;
    }
    return all;
}

/** Seeded PRNG (mulberry32) so the pseudo-random slice of the corpus — and any failure it turns up — is reproducible across runs. Never uses Math.random(). */
function mulberry32(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const RANDOM_SEED = 0xC0FFEE;
const RANDOM_COUNT = 2000;
const RANDOM_MIN_LENGTH = 4;
const RANDOM_MAX_LENGTH = 60;

function randomStrings(): string[] {
    const rng = mulberry32(RANDOM_SEED);
    const out: string[] = [];
    for (let i = 0; i < RANDOM_COUNT; i++) {
        const length = RANDOM_MIN_LENGTH + Math.floor(rng() * (RANDOM_MAX_LENGTH - RANDOM_MIN_LENGTH + 1));
        let s = '';
        for (let j = 0; j < length; j++) {
            s += ALPHABET[Math.floor(rng() * ALPHABET.length)];
        }
        out.push(s);
    }
    return out;
}

// Corpus size: exhaustive strings of length 0..3 over the 23-character ALPHABET above
// (23^0 + 23^1 + 23^2 + 23^3 = 1 + 23 + 529 + 12167 = 12720), plus 2000 pseudo-random
// strings of length 4..60, seeded from the fixed constant RANDOM_SEED (0xC0FFEE) via
// mulberry32 so the run is fully deterministic. 14720 inputs total, run through both
// scanners below.
const CORPUS = [...exhaustiveStrings(3), ...randomStrings()];

describe('splitTopLevelArguments structural invariants', () => {
    it(`reconstructs every one of the ${CORPUS.length} corpus inputs`, () => {
        for (const input of CORPUS) {
            const spans = splitTopLevelArguments(input);
            const mask = argumentSeparatorMask(input);
            assertReconstructs(input, spans, mask);
        }
    });
});

describe('tokenizeSyntax structural invariants', () => {
    it(`reconstructs every one of the ${CORPUS.length} corpus inputs, minus the dropped leading token`, () => {
        for (const input of CORPUS) {
            const spans = tokenizeSyntax(input);
            const mask = withDroppedLeadingToken(syntaxSeparatorMask(input));
            assertReconstructs(input, spans, mask);
        }
    });
});

// ---------------------------------------------------------------------------------------
// Optional live-corpus check: run the same invariant over every real @Syntax string from
// the local meta cache, if one is already on disk. Never downloads — unit tests must not
// hit the network — so this block is skipped entirely when the cache file is absent. Cache
// path mirrors getMetaCacheFile() in server.ts.
// ---------------------------------------------------------------------------------------

const META_CACHE_FILE = path.join(
    process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'),
    'DenizenVSCodeExtension', 'cache', 'meta-blocks-cache.json'
);

describe('tokenizeSyntax against real @Syntax values from the local meta cache', () => {
    if (!fs.existsSync(META_CACHE_FILE)) {
        it.skip(`no cached meta blocks at ${META_CACHE_FILE}; skipping rather than downloading`, () => { /* no-op */ });
        return;
    }
    it('reconstructs every real command syntax from the cached meta', () => {
        const blocks: MetaBlock[] = JSON.parse(fs.readFileSync(META_CACHE_FILE, 'utf-8'));
        const docs = buildMetaDocs(blocks);
        let checked = 0;
        for (const command of docs.commands.values()) {
            if (!command.syntax) {
                continue;
            }
            const spans = tokenizeSyntax(command.syntax);
            const mask = withDroppedLeadingToken(syntaxSeparatorMask(command.syntax));
            assertReconstructs(command.syntax, spans, mask);
            checked++;
        }
        expect(checked).toBeGreaterThan(0);
    });
});
