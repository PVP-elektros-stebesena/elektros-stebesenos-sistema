import { spotPriceSyncService } from './spotPriceSync.js';
import {
  SPOT_PRICE_PROVIDER_NAMES,
  type SpotPriceProviderName,
} from './spotPriceProvider.js';
import { BILLING_TIMEZONE, getBillingDateParts, zonedDateTimeToUtc } from './timezone.js';

const DEFAULT_BACKFILL_DAYS = 7;
const RETRY_DELAY_MS = 15 * 60_000;
const DEFAULT_PROVIDER: SpotPriceProviderName = SPOT_PRICE_PROVIDER_NAMES[0];

let dailyTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let nextRunAt: Date | null = null;
let retryCount = 0;
let activeProvider: SpotPriceProviderName = DEFAULT_PROVIDER;

function msUntilNextRun(now = new Date()): number {
  const parts = getBillingDateParts(now);
  let year = parts.year;
  let month = parts.month;
  let day = parts.day;

  const targetToday = zonedDateTimeToUtc(parts.year, parts.month, parts.day, 15, 30, 0);
  if (now.getTime() >= targetToday.getTime()) {
    const tomorrow = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
    year = tomorrow.getUTCFullYear();
    month = tomorrow.getUTCMonth() + 1;
    day = tomorrow.getUTCDate();
  }

  const next = zonedDateTimeToUtc(year, month, day, 15, 30, 0);
  nextRunAt = next;
  return Math.max(0, next.getTime() - now.getTime());
}

async function runScheduledSync(): Promise<void> {
  try {
    const result = await spotPriceSyncService.syncTomorrow('LT');
    retryCount = result.complete ? 0 : retryCount + 1;

    if (!result.complete && retryCount <= 6) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void runScheduledSync();
      }, RETRY_DELAY_MS);
      return;
    }
  } catch (error) {
    retryCount += 1;
    if (retryCount <= 6) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void runScheduledSync();
      }, RETRY_DELAY_MS);
      return;
    }
    console.error('[SpotPriceScheduler] Scheduled sync failed:', error);
  }

  scheduleNextRun();
}

function scheduleNextRun(): void {
  if (dailyTimer) {
    clearTimeout(dailyTimer);
  }

  const delay = msUntilNextRun();
  dailyTimer = setTimeout(() => {
    dailyTimer = null;
    retryCount = 0;
    void runScheduledSync();
  }, delay);
}

export async function startSpotPriceScheduler(backfillDays?: number): Promise<void> {
  if (dailyTimer || retryTimer) {
    return;
  }

  const days = Number.isFinite(backfillDays) ? Number(backfillDays) : DEFAULT_BACKFILL_DAYS;
  activeProvider = spotPriceSyncService.getProviderName();
  try {
    await spotPriceSyncService.backfillRecentDays(days, 'LT');
  } catch (error) {
    console.error('[SpotPriceScheduler] Startup backfill failed:', error);
  }

  scheduleNextRun();
  console.log(
    '[SpotPriceScheduler] Started for %s via %s, next run at %s',
    BILLING_TIMEZONE,
    activeProvider,
    nextRunAt?.toISOString() ?? 'unknown',
  );
}

export function stopSpotPriceScheduler(): void {
  if (dailyTimer) {
    clearTimeout(dailyTimer);
    dailyTimer = null;
  }

  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  nextRunAt = null;
  retryCount = 0;
}

export function getSpotPriceSchedulerStatus() {
  return {
    isRunning: dailyTimer !== null || retryTimer !== null,
    nextRun: nextRunAt?.toISOString() ?? null,
    retryCount,
    provider: activeProvider,
  };
}
