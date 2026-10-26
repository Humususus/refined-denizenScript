"use strict";
// Restarting the language server when the meta sources change (R6). No `vscode` import, so the
// debounce and the serialization are unit-tested; extension.ts supplies the actual restart.
//
// Why a restart: the server reads its sources once, when it starts. Switching an add-on on the
// settings page used to need a window reload; now the client restarts the server, which revalidates
// every cached source (a 304 each) and downloads only what is new.
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RestartScheduler = exports.waitForStatus = exports.restartSequence = void 0;
/**
 * One restart: stop the old server, optionally clear the meta cache, start a new one. The new server
 * is started whatever happens before it -- a stop that throws, or a cache folder Windows will not
 * delete (EBUSY from an antivirus) -- because the alternative is a window with no language server
 * until it is reloaded (final review, R6).
 */
function restartSequence(steps, clearCache) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield steps.stop();
        }
        catch (err) {
            steps.log(`Stopping the Denizen language server failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (clearCache) {
            try {
                steps.clearCache();
            }
            catch (err) {
                steps.log(`Clearing the meta cache failed, so cached sources are revalidated instead of re-downloaded: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        steps.start();
    });
}
exports.restartSequence = restartSequence;
/**
 * Resolves true on the next status, false after `timeoutMs` -- so a load that never reports (the
 * server failed to start, or its load threw) cannot leave a spinner or a disabled button forever.
 */
function waitForStatus(subscribe, timeoutMs, timers = realTimers) {
    return new Promise(resolve => {
        let settled = false;
        let subscription = null;
        const finish = (ok) => {
            if (settled) {
                return;
            }
            settled = true;
            timers.clear(timer);
            subscription === null || subscription === void 0 ? void 0 : subscription.dispose();
            resolve(ok);
        };
        const timer = timers.set(() => finish(false), timeoutMs);
        subscription = subscribe(() => finish(true));
        if (settled) {
            subscription.dispose();
        }
    });
}
exports.waitForStatus = waitForStatus;
const realTimers = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: handle => clearTimeout(handle),
};
/**
 * Debounces restart requests and never lets two restarts overlap. Three switches clicked within the
 * delay are one restart, after the last click; a request that arrives while a restart is running
 * queues exactly one more, run when it finishes (it may carry settings the running one missed).
 */
class RestartScheduler {
    constructor(restart, delayMs, timers = realTimers) {
        this.restart = restart;
        this.delayMs = delayMs;
        this.timers = timers;
        this.timer = null;
        this.busy = false;
        this.chain = Promise.resolve();
        this.queued = null;
        this.queuedForce = false;
    }
    /** A setting changed: restart once things have been quiet for the delay. */
    request() {
        this.cancelTimer();
        this.timer = this.timers.set(() => {
            this.timer = null;
            void this.run(false);
        }, this.delayMs);
    }
    /** Restart at once (the Reinstall command passes `force` to clear the cache first). */
    now(force = false) {
        this.cancelTimer();
        return this.run(force);
    }
    cancelTimer() {
        if (this.timer !== null) {
            this.timers.clear(this.timer);
            this.timer = null;
        }
    }
    run(force) {
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
    exec(force) {
        return __awaiter(this, void 0, void 0, function* () {
            this.busy = true;
            try {
                yield this.restart(force);
            }
            catch (_a) {
                // A failed restart is reported by the caller's restart function; the queue goes on.
            }
            finally {
                this.busy = false;
            }
        });
    }
}
exports.RestartScheduler = RestartScheduler;
//# sourceMappingURL=metaClient.js.map