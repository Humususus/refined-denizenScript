// Offline evaluation of Denizen's arithmetic tags, for showing what a nested expression works out
// to without running the server. No `vscode` import, so every branch is unit-testable -- the same
// split the other client-side features use.
//
// FEATURE-IDEAS.md idea 4. The note there flagged one real blocker and it has NOT gone away:
//
//   DENIZEN'S EXACT NUMERIC REPRESENTATION IS NOT KNOWABLE FROM ANYTHING THIS REPO HAS. The meta
//   documents what each tag DOES ("returns the element plus a number") and never how it is
//   represented, and the C# language server -- the only Denizen source in reach -- does no
//   arithmetic at all. So whether the server computes in `double` or in `BigDecimal` cannot be
//   checked here, and those disagree: 0.1 + 0.2 is 0.30000000000000004 in one and 0.3 in the other.
//
// The answer is not to guess quietly. Everything below computes in IEEE doubles, which is what
// Java's `double` is, and every result carries `rounded`: true when the displayed number is not
// the exact double. A caller that shows the rounded form and says so is honest; one that prints a
// bare number and implies the server agrees is the "worse than no panel" the note warned about.
//
// The other boundary is the easy one: anything touching server state -- `<player...>`,
// `<server...>`, flags, definitions -- cannot be evaluated offline, and is reported as a named
// INPUT for the caller to supply rather than being guessed at.

import { parseTag } from './server/providers/tagHelper';

/** What an expression came to. */
export type MathResult =
    /** Fully evaluated. */
    | { kind: 'value'; value: number; display: string; rounded: boolean }
    /** Evaluable, but only once these are supplied. Names are as written, e.g. `t`, `player.health`. */
    | { kind: 'needs-input'; inputs: string[] }
    /** Not an arithmetic expression this can work with. */
    | { kind: 'unsupported'; reason: string };

/** Operations taking one argument, e.g. `.add[2]`. */
const BINARY: Record<string, (a: number, b: number) => number> = {
    add: (a, b) => a + b,
    sub: (a, b) => a - b,
    mul: (a, b) => a * b,
    div: (a, b) => a / b,
    mod: (a, b) => a % b,
    power: (a, b) => a ** b,
    max: (a, b) => Math.max(a, b),
    min: (a, b) => Math.min(a, b),
    // `log[base]`, not natural log -- `ln` is the separate tag below.
    log: (a, b) => Math.log(a) / Math.log(b),
    // "Rounds a decimal to the specified place. For example, 0.12345 .round_to[3] returns 0.123."
    round_to: (a, b) => {
        const factor = 10 ** b;
        return Math.round(a * factor) / factor;
    },
    // "Rounds a decimal to the specified precision. 0.12345 .round_to_precision[0.005] -> 0.125."
    round_to_precision: (a, b) => Math.round(a / b) * b,
    round_up_to_precision: (a, b) => Math.ceil(a / b) * b,
    round_down_to_precision: (a, b) => Math.floor(a / b) * b,
    // "Interprets the element to be a Y value and the input to be an X value (<Y.atan2[X]>)."
    atan2: (a, b) => Math.atan2(a, b),
    // The `_int` family is documented as "special-case Java Long Integer logic", and the meta says
    // of add_int outright: "Don't use this, just use add". Implemented for completeness, with the
    // truncation that integer division means; the magnitudes a script uses are far inside the
    // range where a double represents integers exactly.
    add_int: (a, b) => Math.trunc(a) + Math.trunc(b),
    sub_int: (a, b) => Math.trunc(a) - Math.trunc(b),
    mul_int: (a, b) => Math.trunc(a) * Math.trunc(b),
    div_int: (a, b) => Math.trunc(Math.trunc(a) / Math.trunc(b))
};

/** Operations taking no argument, e.g. `.abs`. */
const UNARY: Record<string, (a: number) => number> = {
    abs: a => Math.abs(a),
    sqrt: a => Math.sqrt(a),
    ln: a => Math.log(a),
    // Java's Math.round and JavaScript's both round half UP, so these agree.
    round: a => Math.round(a),
    round_up: a => Math.ceil(a),
    round_down: a => Math.floor(a),
    // "Rounds towards zero", which is Math.trunc rather than either of the two above.
    truncate: a => Math.trunc(a),
    // RADIANS, on the meta's own word: "Returns the cosine of the input radian angle", and the
    // inverse three "in radians". Worth stating because the corpus contains `<[t].mul[90]>.cos`,
    // which reads like degrees and is not -- getting this backwards would produce confidently
    // wrong numbers, the one outcome this feature must avoid.
    sin: a => Math.sin(a),
    cos: a => Math.cos(a),
    tan: a => Math.tan(a),
    asin: a => Math.asin(a),
    acos: a => Math.acos(a),
    atan: a => Math.atan(a),
    to_degrees: a => a * 180 / Math.PI,
    to_radians: a => a * Math.PI / 180,
    // "Should only be used for small values (generally: less than 20)". Beyond that a double
    // cannot hold the result exactly, so it is refused rather than returning a number that looks
    // precise and is not; a negative or fractional input has no factorial at all.
    factorial: a => {
        if (!Number.isInteger(a) || a < 0 || a > 20) {
            return NaN;
        }
        let result = 1;
        for (let i = 2; i <= a; i++) {
            result *= i;
        }
        return result;
    }
};

/** Every arithmetic tag this understands, for callers that want to test before evaluating. */
export const SUPPORTED_OPERATIONS: ReadonlySet<string> =
    new Set([...Object.keys(BINARY), ...Object.keys(UNARY)]);

/**
 * How a number is shown.
 *
 * Twelve significant digits, trailing zeros trimmed. That is enough to collapse the classic
 * double artefact (0.30000000000000004 becomes 0.3, which is what a BigDecimal server would print)
 * without inventing precision. `rounded` says whether anything was lost, so the caller can show
 * the exact double alongside rather than hiding the difference.
 */
export function formatNumber(value: number): { display: string; rounded: boolean } {
    if (!Number.isFinite(value)) {
        return { display: String(value), rounded: false };
    }
    if (Number.isInteger(value) && Math.abs(value) < 1e15) {
        return { display: String(value), rounded: false };
    }
    const trimmed = Number(value.toPrecision(12));
    return { display: String(trimmed), rounded: trimmed !== value };
}

/** Strips one layer of `<...>` from a tag written as an argument, or returns null. */
function unwrapTag(text: string): string | null {
    const trimmed = text.trim();
    return trimmed.startsWith('<') && trimmed.endsWith('>')
        ? trimmed.slice(1, -1)
        : null;
}

/**
 * Resolves one operand: a literal number, a nested tag, or something only the server knows.
 *
 * `inputs` collects the names of everything unresolvable, so a caller can ask for all of them at
 * once rather than one round trip per missing value.
 */
function operand(text: string, supplied: ReadonlyMap<string, number>, inputs: string[]): number | null {
    const trimmed = text.trim();
    const literal = Number(trimmed);
    if (trimmed.length > 0 && Number.isFinite(literal)) {
        return literal;
    }
    const inner = unwrapTag(trimmed);
    if (inner === null) {
        // Not a number and not a tag: a bare word, which no arithmetic tag accepts.
        return null;
    }
    const nested = evaluateParsed(inner, supplied, inputs);
    return nested;
}

/**
 * Evaluates tag text (no surrounding `<>`), accumulating unresolved names into `inputs`.
 *
 * Returns null when the expression cannot be evaluated -- either because an input is missing (in
 * which case `inputs` has grown) or because it is not arithmetic at all.
 */
function evaluateParsed(tagText: string, supplied: ReadonlyMap<string, number>, inputs: string[]): number | null {
    const parsed = parseTag(tagText, () => { /* parse complaints are not this feature's business */ });
    if (parsed.parts.length === 0) {
        return null;
    }
    const base = parsed.parts[0];
    if (base.text === 'element' && base.parameter !== null) {
        // The one base that is a literal rather than something to ask about.
        return applyChain(operand(base.parameter, supplied, inputs), parsed.parts.slice(1), supplied, inputs);
    }
    // EVERYTHING UP TO THE FIRST ARITHMETIC OPERATION IS ONE VALUE, and asking for it in pieces
    // would be asking for things that are not values. `<player.health.add[5]>` needs the health,
    // not a `player`; `<[members].size.div[3]>` needs the SIZE, not the list -- an earlier version
    // asked for `members` here and would then have choked on `.size` no matter what was typed,
    // promising an evaluation it could not deliver.
    const opIndex = parsed.parts.findIndex(p => SUPPORTED_OPERATIONS.has(p.text));
    const head = opIndex === -1 ? parsed.parts : parsed.parts.slice(0, opIndex);
    if (head.length === 0) {
        return null;
    }
    return applyChain(named(describeParts(head), supplied, inputs), parsed.parts.slice(head.length), supplied, inputs);
}

/**
 * Renders tag parts back into the text they came from, for use as an input's name.
 *
 * A definition part has empty text and carries its name as the parameter, so it renders as
 * `[name]` -- which is how it is written in the script, and therefore what the user will
 * recognise when asked for it.
 */
function describeParts(parts: { text: string; parameter: string | null }[]): string {
    return parts
        .map(p => p.parameter === null ? p.text : `${p.text}[${p.parameter}]`)
        .join('.');
}

/** Looks up a supplied value, or records the name as still needed. */
function named(name: string, supplied: ReadonlyMap<string, number>, inputs: string[]): number | null {
    const value = supplied.get(name);
    if (value !== undefined) {
        return value;
    }
    if (!inputs.includes(name)) {
        inputs.push(name);
    }
    return null;
}

/** Applies each remaining part as an operation. Returns null the moment one is not arithmetic. */
function applyChain(start: number | null, parts: { text: string; parameter: string | null }[],
    supplied: ReadonlyMap<string, number>, inputs: string[]): number | null {
    let current = start;
    for (const part of parts) {
        const unary = UNARY[part.text];
        if (unary !== undefined && part.parameter === null) {
            current = current === null ? null : unary(current);
            continue;
        }
        const binary = BINARY[part.text];
        if (binary !== undefined && part.parameter !== null) {
            // The argument is resolved EVEN WHEN the left side is already unknown, so one pass
            // collects every missing input rather than stopping at the first.
            const right = operand(part.parameter, supplied, inputs);
            current = current === null || right === null ? null : binary(current, right);
            continue;
        }
        return null;
    }
    return current;
}

/**
 * Evaluates a Denizen arithmetic expression.
 *
 * `tagText` may be written with or without its surrounding `<>`. `supplied` provides values for
 * anything the server would have to answer -- definitions and object tags -- keyed by the names a
 * previous `needs-input` result reported.
 */
export function evaluateMathTag(tagText: string, supplied: ReadonlyMap<string, number> = new Map()): MathResult {
    const inner = unwrapTag(tagText) ?? tagText.trim();
    if (inner.length === 0) {
        return { kind: 'unsupported', reason: 'Empty expression.' };
    }
    // NO ARITHMETIC ANYWHERE MEANS THIS IS NOT AN ARITHMETIC EXPRESSION, which is a different
    // answer from "I need a value for it". Without this gate `<player.name>` came back as
    // `needs-input: ['player.name']` -- the server-state branch below would dutifully offer to
    // evaluate a name if only the user typed a number for it, which is nonsense.
    if (!looksArithmetic(inner)) {
        return { kind: 'unsupported', reason: 'Not an arithmetic expression this can evaluate offline.' };
    }
    const inputs: string[] = [];
    const value = evaluateParsed(inner, supplied, inputs);
    if (value === null) {
        if (inputs.length > 0) {
            return { kind: 'needs-input', inputs };
        }
        return { kind: 'unsupported', reason: 'Not an arithmetic expression this can evaluate offline.' };
    }
    if (Number.isNaN(value)) {
        // `sqrt` of a negative is documented as null, and `log` of one is NaN. Either way there is
        // no number to show, and printing "NaN" would suggest the server prints that too.
        return { kind: 'unsupported', reason: 'Undefined for these values (Denizen returns null).' };
    }
    const { display, rounded } = formatNumber(value);
    return { kind: 'value', value, display, rounded };
}

/**
 * Whether `tagText` looks like something worth offering to evaluate.
 *
 * Used to decide whether to show anything at all: a tag with no arithmetic in it is not a failed
 * evaluation, it is simply not this feature's business, and saying nothing is the right answer.
 */
export function looksArithmetic(tagText: string): boolean {
    const inner = unwrapTag(tagText) ?? tagText.trim();
    const parsed = parseTag(inner, () => { /* ignored */ });
    return parsed.parts.some(p => SUPPORTED_OPERATIONS.has(p.text));
}
