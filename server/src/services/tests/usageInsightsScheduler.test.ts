import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usageInsightsService } from '../usageInsightsService.js';
import {
  getUsageInsightsSchedulerStatus,
  startUsageInsightsScheduler,
  stopUsageInsightsScheduler,
} from '../usageInsightsScheduler.js';

vi.mock('../usageInsightsService.js', () => ({
  usageInsightsService: {
    runDetection: vi.fn(),
  },
}));

const intervalMs = 10 * 60_000;
const detectionResult = {
  tenantsProcessed: 1,
  devicesProcessed: 1,
  eventsPersisted: 0,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

describe('Usage insights scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T10:00:00.000Z'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    stopUsageInsightsScheduler();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('skips interval ticks while a detection run is still in flight', async () => {
    const firstRun = deferred<typeof detectionResult>();
    const runDetection = vi.mocked(usageInsightsService.runDetection);
    runDetection.mockReturnValueOnce(firstRun.promise);
    runDetection.mockResolvedValue(detectionResult);

    startUsageInsightsScheduler();

    expect(runDetection).toHaveBeenCalledTimes(1);
    expect(getUsageInsightsSchedulerStatus().isRunInFlight).toBe(true);

    await vi.advanceTimersByTimeAsync(intervalMs);

    expect(runDetection).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      '[UsageInsightsScheduler] Previous detection run is still in progress; skipping this tick.',
    );

    firstRun.resolve(detectionResult);
    await Promise.resolve();
    await Promise.resolve();

    expect(getUsageInsightsSchedulerStatus().isRunInFlight).toBe(false);

    await vi.advanceTimersByTimeAsync(intervalMs);

    expect(runDetection).toHaveBeenCalledTimes(2);
  });
});
