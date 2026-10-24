// Timing for the performance baseline (`denizenscript.debug.performance`). Kept free of any
// `vscode` import so it can be unit-tested; extension.ts owns the setting and the report command.
//
// DISABLED MEANS FREE. The recorder sits on every keystroke's path, so with the setting off a
// timed call is one boolean check and the original function -- the clock is not even read.

export class PerfRecorder {
    enabled = false;
    private readonly samples = new Map<string, number[]>();
    private readonly gauges = new Map<string, number>();
    /** Labels timed with `timeAsync`: their time includes awaits, which block nothing. */
    private readonly asyncLabels = new Set<string>();

    constructor(private readonly now: () => number = () => performance.now()) {}

    /** Runs `fn`, recording how long it took under `label`. Returns or rethrows exactly as `fn` does. */
    time<T>(label: string, fn: () => T): T {
        if (!this.enabled) {
            return fn();
        }
        const start = this.now();
        try {
            return fn();
        }
        finally {
            this.record(label, this.now() - start);
        }
    }

    /** Like `time`, but measures until the promise settles rather than until the first `await`. */
    async timeAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
        if (!this.enabled) {
            return fn();
        }
        this.asyncLabels.add(label);
        const start = this.now();
        try {
            return await fn();
        }
        finally {
            this.record(label, this.now() - start);
        }
    }

    record(label: string, ms: number): void {
        if (!this.enabled) {
            return;
        }
        let list = this.samples.get(label);
        if (list === undefined) {
            list = [];
            this.samples.set(label, list);
        }
        list.push(ms);
    }

    /** A value that is a size rather than a duration, e.g. how many ranges were decorated. Last write wins. */
    gauge(label: string, value: number): void {
        if (this.enabled) {
            this.gauges.set(label, value);
        }
    }

    reset(): void {
        this.samples.clear();
        this.gauges.clear();
        this.asyncLabels.clear();
    }

    /** One fixed-width row per label, slowest total first, then the gauges. */
    report(): string {
        if (this.samples.size === 0 && this.gauges.size === 0) {
            return 'Denizen performance: no samples (is denizenscript.debug.performance on?)';
        }
        const rows = [...this.samples].map(([label, list]) => {
            const sorted = [...list].sort((a, b) => a - b);
            const total = sorted.reduce((sum, ms) => sum + ms, 0);
            // Nearest-rank percentile: the smallest sample with at least 95% of samples at or below it.
            const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
            return { label, count: sorted.length, total, mean: total / sorted.length, p95, max: sorted[sorted.length - 1] };
        }).sort((a, b) => b.total - a.total);
        const width = Math.max(5, ...rows.map(r => r.label.length), ...[...this.gauges.keys()].map(k => k.length));
        const num = (n: number) => n.toFixed(1).padStart(10);
        const lines = ['Denizen performance (ms)', `${'label'.padEnd(width)}  ${'count'.padStart(7)}${'total'.padStart(10)}${'mean'.padStart(10)}${'p95'.padStart(10)}${'max'.padStart(10)}`];
        for (const r of rows) {
            // Wall-clock rows sit in the same table as blocking ones, so say which is which: an
            // async row's time is mostly waiting on the language server, which freezes nothing.
            const note = this.asyncLabels.has(r.label) ? '  (async, incl. waits)' : '';
            lines.push(`${r.label.padEnd(width)}  ${String(r.count).padStart(7)}${num(r.total)}${num(r.mean)}${num(r.p95)}${num(r.max)}${note}`);
        }
        if (this.gauges.size > 0) {
            lines.push('', 'gauges (last value)');
            for (const [label, value] of this.gauges) {
                lines.push(`${label.padEnd(width)}  ${String(value).padStart(7)}`);
            }
        }
        return lines.join('\n');
    }
}

/** The extension's single recorder; `enabled` follows `denizenscript.debug.performance`. */
export const perf = new PerfRecorder();
