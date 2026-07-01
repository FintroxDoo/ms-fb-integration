import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  it('spaces grants by the configured interval', async () => {
    const sleeps: number[] = [];
    // 60/min -> 1000ms interval. Freeze time so waits are deterministic.
    const limiter = new RateLimiter(60, {
      now: () => 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await limiter.acquire(); // slot at t=0, no wait
    await limiter.acquire(); // slot at t=1000 -> wait 1000
    await limiter.acquire(); // slot at t=2000 -> wait 2000

    expect(sleeps).toEqual([1000, 2000]);
  });

  it('does not wait when calls are already spaced out', async () => {
    const sleeps: number[] = [];
    let clock = 0;
    const limiter = new RateLimiter(60, {
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await limiter.acquire(); // reserves up to t=1000
    clock = 5000; // caller arrives well after the slot
    await limiter.acquire();

    expect(sleeps).toEqual([]); // no throttling needed
  });

  it('is disabled when perMinute <= 0', async () => {
    const sleeps: number[] = [];
    const limiter = new RateLimiter(0, {
      now: () => 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await limiter.acquire();
    await limiter.acquire();

    expect(sleeps).toEqual([]);
  });
});
