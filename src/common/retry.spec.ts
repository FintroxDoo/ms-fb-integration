import { AxiosError } from 'axios';
import { withRetry } from './retry';

function axiosError(
  status: number,
  headers: Record<string, string> = {},
): AxiosError {
  return new AxiosError('boom', 'ERR', undefined, undefined, {
    status,
    headers,
    data: {},
    statusText: '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: {} as any,
  });
}

describe('withRetry', () => {
  const noSleep = jest.fn().mockResolvedValue(undefined);
  beforeEach(() => noSleep.mockClear());

  it('retries 429 with exponential backoff then succeeds', async () => {
    const sleeps: number[] = [];
    const fn = jest
      .fn()
      .mockRejectedValueOnce(axiosError(429))
      .mockRejectedValueOnce(axiosError(429))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, {
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([500, 1000]); // base*2^0, base*2^1
  });

  it('honors a Retry-After header (seconds) on 429', async () => {
    const sleeps: number[] = [];
    const fn = jest
      .fn()
      .mockRejectedValueOnce(axiosError(429, { 'retry-after': '2' }))
      .mockResolvedValue('ok');

    await withRetry(fn, {
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(sleeps).toEqual([2000]);
  });

  it('does not retry 4xx (other than 429)', async () => {
    const fn = jest.fn().mockRejectedValue(axiosError(400));

    await expect(withRetry(fn, { sleepFn: noSleep })).rejects.toBeInstanceOf(
      AxiosError,
    );
    expect(fn).toHaveBeenCalledTimes(1);
    expect(noSleep).not.toHaveBeenCalled();
  });

  it('retries 5xx', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(axiosError(503))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { sleepFn: noSleep });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after exhausting retries', async () => {
    const fn = jest.fn().mockRejectedValue(axiosError(429));

    await expect(
      withRetry(fn, { retries: 2, sleepFn: noSleep }),
    ).rejects.toBeInstanceOf(AxiosError);
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
