import { Logger } from '@nestjs/common';
import { AxiosError } from 'axios';

const logger = new Logger('retry');

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  label?: string;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn`, retrying only transient failures (5xx / 429 / network) with
 * exponential backoff. 4xx errors throw immediately — they signal bad data.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 4;
  const baseDelay = opts.baseDelayMs ?? 500;
  const label = opts.label ?? 'request';

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const status = statusOf(err);
      if (attempt >= retries || !isRetryableStatus(status)) {
        throw err;
      }
      const delay = baseDelay * 2 ** attempt;
      attempt += 1;
      logger.warn(
        `${label} failed (status=${status ?? 'network'}); retry ${attempt}/${retries} in ${delay}ms`,
      );
      await sleep(delay);
    }
  }
}
