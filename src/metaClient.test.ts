import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RestartScheduler } from './metaClient';

/** A restart that stays "running" until the test resolves it. */
function controllableRestart() {
    const pending: (() => void)[] = [];
    let running = 0;
    let maxRunning = 0;
    const restart = vi.fn(() => new Promise<void>(resolve => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        pending.push(() => { running--; resolve(); });
    }));
    return { restart, finishOne: () => pending.shift()!(), maxRunning: () => maxRunning };
}

describe('RestartScheduler', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    // Review Focus 3: three add-on switches clicked within a second are one restart.
    it('turns several requests within the delay into one restart, after the last', async () => {
        const restart = vi.fn(async () => undefined);
        const scheduler = new RestartScheduler(restart, 1500);
        scheduler.request();
        await vi.advanceTimersByTimeAsync(1000);
        scheduler.request();
        await vi.advanceTimersByTimeAsync(1000);
        scheduler.request();
        await vi.advanceTimersByTimeAsync(1499);
        expect(restart).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(restart).toHaveBeenCalledTimes(1);
    });

    it('never runs two restarts at once, and runs one more after a request made during a restart', async () => {
        const c = controllableRestart();
        const scheduler = new RestartScheduler(c.restart, 100);
        scheduler.request();
        await vi.advanceTimersByTimeAsync(100);
        expect(c.restart).toHaveBeenCalledTimes(1);
        scheduler.request();
        scheduler.request();
        await vi.advanceTimersByTimeAsync(500);
        expect(c.restart).toHaveBeenCalledTimes(1);
        c.finishOne();
        await vi.advanceTimersByTimeAsync(0);
        expect(c.restart).toHaveBeenCalledTimes(2);
        c.finishOne();
        await vi.advanceTimersByTimeAsync(500);
        expect(c.restart).toHaveBeenCalledTimes(2);
        expect(c.maxRunning()).toBe(1);
    });

    it('now() restarts without waiting for the delay, and cancels a pending request', async () => {
        const restart = vi.fn(async () => undefined);
        const scheduler = new RestartScheduler(restart, 1500);
        scheduler.request();
        await scheduler.now();
        expect(restart).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(2000);
        expect(restart).toHaveBeenCalledTimes(1);
    });

    it('passes the forced flag through, and a failed restart does not wedge the queue', async () => {
        const restart = vi.fn(async (force: boolean) => { if (!force) { throw new Error('boom'); } });
        const scheduler = new RestartScheduler(restart, 100);
        scheduler.request();
        await vi.advanceTimersByTimeAsync(100);
        await scheduler.now(true);
        expect(restart.mock.calls.map(c => c[0])).toEqual([false, true]);
    });
});
