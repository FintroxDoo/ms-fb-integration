import { Logger } from '@nestjs/common';
import { AxiosError } from 'axios';

const logger = new Logger('retry');

// Cap on how long we'll honor a server-provided Retry-After (defensive against
// a bogus huge value stalling a whole backfill).
const MAX_RETRY_AFTER_MS = 60_000;

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  label?: string;
  // Injectable for tests; defaults to real setTimeout-based sleep.
  sleepFn?: (ms: number) => Promise<void>;
}

/** HTTP status codes worth retrying (transient). 4xx (except 429) are not. */
function isRetryableStatus(status?: number): boolean {
  if (status === undefined) return true; // network error / no response
  if (status === 429) return true;
  return status >= 500 && status < 600;
}

function statusOf(err: unknown): number | undefined {
  if (err instanceof AxiosError) return err.response?.status;
  return undefined;
}

/**
 * Parse a `Retry-After` header (seconds or HTTP-date) into milliseconds.
 * Returns undefined when absent/unparseable so the caller falls back to
 * exponential backoff.
 */
function retryAfterMs(err: unknown, now: number): number | undefined {
  if (!(err instanceof AxiosError)) return undefined;
  const raw = err.response?.headers?.['retry-after'];
  if (raw === undefined || raw === null) return undefined;
  const value = Array.isArray(raw) ? raw[0] : String(raw);
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn`, retrying only transient failures (5xx / 429 / network) with
 * exponential backoff. On 429 we honor a `Retry-After` header when present
 * (capped). 4xx errors throw immediately — they signal bad data.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 4;
  const baseDelay = opts.baseDelayMs ?? 500;
  const label = opts.label ?? 'request';
  const doSleep = opts.sleepFn ?? sleep;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const status = statusOf(err);
      if (attempt >= retries || !isRetryableStatus(status)) {
        throw err;
      }
      const retryAfter =
        status === 429 ? retryAfterMs(err, Date.now()) : undefined;
      const delay =
        retryAfter !== undefined
          ? Math.min(retryAfter, MAX_RETRY_AFTER_MS)
          : baseDelay * 2 ** attempt;
      attempt += 1;
      logger.warn(
        `${label} failed (status=${status ?? 'network'}); retry ${attempt}/${retries} in ${delay}ms`,
      );
      await doSleep(delay);
    }
  }
}
