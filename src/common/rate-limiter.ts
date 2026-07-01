/**
 * Proactive token-bucket-style rate limiter. Spaces grants so callers never
 * exceed `perMinute` requests/min, regardless of concurrency — this keeps us
 * under UpFlow's 600/min cap and avoids 429 storms during large backfills.
 *
 * The scheduling math runs synchronously before any await, so concurrent
 * `acquire()` callers each reserve a distinct, correctly-spaced slot.
 *
 * `now`/`sleep` are injectable for deterministic unit tests.
 */
export interface RateLimiterDeps {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class RateLimiter {
  private readonly intervalMs: number;
  private nextAt = 0;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(perMinute: number, deps: RateLimiterDeps = {}) {
    this.intervalMs = perMinute > 0 ? 60_000 / perMinute : 0;
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Resolve once this caller is cleared to make a request. */
  async acquire(): Promise<void> {
    if (this.intervalMs <= 0) return; // disabled (perMinute <= 0)
    const now = this.now();
    const scheduled = Math.max(now, this.nextAt);
    this.nextAt = scheduled + this.intervalMs;
    const wait = scheduled - now;
    if (wait > 0) await this.sleep(wait);
  }
}
