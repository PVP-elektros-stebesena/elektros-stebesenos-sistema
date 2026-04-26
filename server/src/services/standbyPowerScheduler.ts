import { BILLING_TIMEZONE } from './timezone.js';
import { standbyPowerService } from './standbyPowerService.js';

let dailyTimer: ReturnType<typeof setTimeout> | null = null;
let nextRunAt: Date | null = null;

async function runScheduledAnalysis(): Promise<void> {
  try {
    const saved = await standbyPowerService.ensureLatestCompletedNightBaselines();
    console.log('[StandbyPowerScheduler] Backfilled %d standby baseline(s).', saved);
  } catch (error) {
    console.error('[StandbyPowerScheduler] Scheduled analysis failed:', error);
  }

  scheduleNextRun();
}

function scheduleNextRun(): void {
  if (dailyTimer) {
    clearTimeout(dailyTimer);
  }

  const next = standbyPowerService.getNextSchedulerRun();
  nextRunAt = next;
  const delayMs = Math.max(0, next.getTime() - Date.now());

  dailyTimer = setTimeout(() => {
    dailyTimer = null;
    void runScheduledAnalysis();
  }, delayMs);
}

export async function startStandbyPowerScheduler(): Promise<void> {
  if (dailyTimer) {
    return;
  }

  try {
    await standbyPowerService.ensureLatestCompletedNightBaselines();
  } catch (error) {
    console.error('[StandbyPowerScheduler] Startup backfill failed:', error);
  }

  scheduleNextRun();
  console.log(
    '[StandbyPowerScheduler] Started for %s, next run at %s',
    BILLING_TIMEZONE,
    nextRunAt?.toISOString() ?? 'unknown',
  );
}

export function stopStandbyPowerScheduler(): void {
  if (dailyTimer) {
    clearTimeout(dailyTimer);
    dailyTimer = null;
  }

  nextRunAt = null;
}

export function getStandbyPowerSchedulerStatus() {
  return {
    isRunning: dailyTimer != null,
    nextRun: nextRunAt?.toISOString() ?? null,
  };
}
