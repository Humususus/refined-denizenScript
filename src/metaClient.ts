// Restarting the language server when the meta sources change (R6). No `vscode` import, so the
// debounce and the serialization are unit-tested; extension.ts supplies the actual restart.
//
// Why a restart: the server reads its sources once, when it starts. Switching an add-on on the
// settings page used to need a window reload; now the client restarts the server, which revalidates
// every cached source (a 304 each) and downloads only what is new.

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };

const realTimers: Timers = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Debounces restart requests and never lets two restarts overlap. Three switches clicked within the
 * delay are one restart, after the last click; a request that arrives while a restart is running
 * queues exactly one more, run when it finishes (it may carry settings the running one missed).
 */
export class RestartScheduler {
    private timer: unknown = null;
    private busy = false;
    private chain: Promise<void> = Promise.resolve();
    private queued: Promise<void> | null = null;
    private queuedForce = false;

    constructor(
        private readonly restart: (force: boolean) => Promise<void>,
        private readonly delayMs: number,
        private readonly timers: Timers = realTimers,
    ) {}

    /** A setting changed: restart once things have been quiet for the delay. */
    request(): void {
        this.cancelTimer();
        this.timer = this.timers.set(() => {
            this.timer = null;
            void this.run(false);
        }, this.delayMs);
    }

    /** Restart at once (the Reinstall command passes `force` to clear the cache first). */
    now(force = false): Promise<void> {
        this.cancelTimer();
        return this.run(force);
    }

    private cancelTimer(): void {
        if (this.timer !== null) {
            this.timers.clear(this.timer);
            this.timer = null;
        }
    }

    private run(force: boolean): Promise<void> {
        if (!this.busy) {
            this.chain = this.exec(force);
            return this.chain;
        }
        this.queuedForce = this.queuedForce || force;
        if (this.queued === null) {
            this.queued = this.chain.then(() => {
                this.queued = null;
                const queuedForce = this.queuedForce;
                this.queuedForce = false;
                return this.exec(queuedForce);
            });
            this.chain = this.queued;
        }
        return this.queued;
    }

    private async exec(force: boolean): Promise<void> {
        this.busy = true;
        try {
            await this.restart(force);
        }
        catch {
            // A failed restart is reported by the caller's restart function; the queue goes on.
        }
        finally {
            this.busy = false;
        }
    }
}
