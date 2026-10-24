import { describe, it, expect } from 'vitest';
import { PerfRecorder } from './perfStats';

describe('PerfRecorder', () => {
    it('records nothing and never reads the clock when disabled', () => {
        let reads = 0;
        const r = new PerfRecorder(() => { reads++; return 0; });
        expect(r.time('a', () => 42)).toBe(42);
        expect(reads).toBe(0);
        expect(r.report()).toContain('no samples');
    });

    it('passes the return value through and records the duration', () => {
        const ticks = [0, 5];
        const r = new PerfRecorder(() => ticks.shift()!);
        r.enabled = true;
        expect(r.time('a', () => 'x')).toBe('x');
        expect(r.report()).toMatch(/a\s+1\s+5\.0/);
    });

    it('rethrows and still records when the timed function throws', () => {
        const ticks = [0, 3];
        const r = new PerfRecorder(() => ticks.shift()!);
        r.enabled = true;
        expect(() => r.time('boom', () => { throw new Error('e'); })).toThrow('e');
        expect(r.report()).toMatch(/boom\s+1\s+3\.0/);
    });

    it('timeAsync measures until the promise settles, not until the first await', async () => {
        let t = 0;
        const r = new PerfRecorder(() => t);
        r.enabled = true;
        const p = r.timeAsync('async', async () => { await Promise.resolve(); t = 9; return 1; });
        expect(await p).toBe(1);
        expect(r.report()).toMatch(/async\s+1\s+9\.0/);
    });

    it('reports count, total, mean, p95 and max, sorted by total descending', () => {
        const r = new PerfRecorder();
        r.enabled = true;
        for (const ms of [1, 2, 3, 4, 100]) {
            r.record('slow', ms);
        }
        r.record('fast', 1);
        const lines = r.report().split('\n');
        expect(lines.findIndex(l => l.startsWith('slow'))).toBeLessThan(lines.findIndex(l => l.startsWith('fast')));
        expect(r.report()).toMatch(/slow\s+5\s+110\.0\s+22\.0\s+100\.0\s+100\.0/);
    });

    it('marks timeAsync rows as wall-clock, so waiting on the server is not read as blocking work', async () => {
        const r = new PerfRecorder();
        r.enabled = true;
        await r.timeAsync('hints', async () => 1);
        r.time('sync', () => 1);
        const lines = r.report().split('\n');
        expect(lines.find(l => l.startsWith('hints'))).toContain('(async, incl. waits)');
        expect(lines.find(l => l.startsWith('sync'))).not.toContain('async');
    });

    it('reports the last value of each gauge', () => {
        const r = new PerfRecorder();
        r.enabled = true;
        r.gauge('decorations', 10);
        r.gauge('decorations', 25);
        expect(r.report()).toMatch(/decorations\s+25/);
    });

    it('reset clears samples and gauges', () => {
        const r = new PerfRecorder();
        r.enabled = true;
        r.record('a', 1);
        r.gauge('g', 1);
        r.reset();
        expect(r.report()).toContain('no samples');
    });
});
