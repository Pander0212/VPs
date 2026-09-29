// One-at-a-time queue for AI utility calls, with timeouts. Never blocks the chat:
// callers get a promise; failures resolve to an error object instead of throwing into ST.

let chain = Promise.resolve();
let pending = 0;
const watchers = new Set();

function notify() {
    for (const fn of watchers) { try { fn(pending); } catch { /* ignore */ } }
}

export function onQueueChange(fn) { watchers.add(fn); return () => watchers.delete(fn); }
export function queueSize() { return pending; }

export function withTimeout(promise, ms, label = 'AI call') {
    let timer;
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms); }),
    ]);
}

/**
 * Enqueue an async job. Resolves with the job result, rejects with its error.
 * @template T
 * @param {() => Promise<T>} job
 * @param {{timeoutMs?: number, label?: string}} [opts]
 * @returns {Promise<T>}
 */
export function enqueue(job, { timeoutMs = 60000, label = 'AI call' } = {}) {
    pending++;
    notify();
    const run = chain.then(() => withTimeout(Promise.resolve().then(job), timeoutMs, label));
    chain = run.catch(() => undefined).finally(() => { pending--; notify(); });
    return run;
}
