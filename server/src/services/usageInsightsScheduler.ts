import { usageInsightsService } from './usageInsightsService.js';

const USAGE_INSIGHTS_INTERVAL_MS = 10 * 60_000;

let usageInsightsTimer: ReturnType<typeof setInterval> | null = null;
let nextRunAt: Date | null = null;
let usageInsightsRunInFlight = false;

async function runScheduledUsageDetection(): Promise<void> {
  if (usageInsightsRunInFlight) {
    console.warn('[UsageInsightsScheduler] Previous detection run is still in progress; skipping this tick.');
    nextRunAt = new Date(Date.now() + USAGE_INSIGHTS_INTERVAL_MS);
    return;
  }

  usageInsightsRunInFlight = true;

  try {
    const result = await usageInsightsService.runDetection();
    console.log(
      '[UsageInsightsScheduler] Processed %d tenant(s), %d device(s), persisted %d event(s).',
      result.tenantsProcessed,
      result.devicesProcessed,
      result.eventsPersisted,
    );
  } catch (error) {
    console.error('[UsageInsightsScheduler] Detection failed:', error);
  } finally {
    usageInsightsRunInFlight = false;
    nextRunAt = new Date(Date.now() + USAGE_INSIGHTS_INTERVAL_MS);
  }
}

export function startUsageInsightsScheduler(): void {
  if (usageInsightsTimer) {
    return;
  }

  nextRunAt = new Date(Date.now() + USAGE_INSIGHTS_INTERVAL_MS);

  void runScheduledUsageDetection();
  usageInsightsTimer = setInterval(() => {
    void runScheduledUsageDetection();
  }, USAGE_INSIGHTS_INTERVAL_MS);

  console.log('[UsageInsightsScheduler] Started, next run at %s', nextRunAt.toISOString());
}

export function stopUsageInsightsScheduler(): void {
  if (usageInsightsTimer) {
    clearInterval(usageInsightsTimer);
    usageInsightsTimer = null;
  }

  nextRunAt = null;
}

export function getUsageInsightsSchedulerStatus() {
  return {
    isRunning: usageInsightsTimer != null,
    isRunInFlight: usageInsightsRunInFlight,
    nextRun: nextRunAt?.toISOString() ?? null,
  };
}
