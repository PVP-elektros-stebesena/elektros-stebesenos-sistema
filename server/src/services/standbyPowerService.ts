import prisma from '../lib/prisma.js';
import type { PricingMode } from './billingPlanService.js';
import { addDaysToDateString, formatBillingDate, getBillingDateParts, zonedDateTimeToUtc } from './timezone.js';

const NIGHT_START_HOUR = 2;
const NIGHT_END_HOUR = 5;
const WINDOW_MS = 10 * 60_000;

export type StandbyOverviewStatus = 'complete' | 'partial' | 'unavailable';
export type GhostLoadMessageCode =
  | 'NO_BASELINE'
  | 'NO_ACTIVE_BILLING_PLAN'
  | 'FIXED_TARIFF_UNAVAILABLE'
  | 'DYNAMIC_CONFIG_INCOMPLETE'
  | 'SPOT_PRICE_UNAVAILABLE';

export interface GhostLoadOverview {
  status: StandbyOverviewStatus;
  currency: 'EUR';
  pricingMode: PricingMode | null;
  baselineDate: string | null;
  computedAt: string | null;
  sourceWindowStartsAt: string | null;
  sourceWindowEndsAt: string | null;
  baselinePowerKw: number | null;
  baselinePowerWatts: number | null;
  projectedDailyKwh: number | null;
  projectedMonthlyKwh: number | null;
  currentRateEurPerKwh: number | null;
  projectedMonthlyCostEur: number | null;
  messageCode: GhostLoadMessageCode | null;
  message: string | null;
}

type BillingPlanRow = Awaited<ReturnType<typeof prisma.billingPlan.findFirst>>;

function messageForCode(code: GhostLoadMessageCode): string {
  if (code === 'NO_BASELINE') return 'No standby baseline is available yet.';
  if (code === 'NO_ACTIVE_BILLING_PLAN') return 'No active billing plan is configured for this device.';
  if (code === 'FIXED_TARIFF_UNAVAILABLE') return 'Current fixed-tariff pricing is unavailable for this device.';
  if (code === 'DYNAMIC_CONFIG_INCOMPLETE') return 'Dynamic pricing settings are incomplete for this device.';
  return 'Current spot pricing is unavailable right now.';
}

function roundValue(value: number, decimals: number): number {
  return +value.toFixed(decimals);
}

function getStandbyNightRange(billingDate: string): { startsAt: Date; endsAt: Date } {
  const [year, month, day] = billingDate.split('-').map((value) => parseInt(value, 10));
  return {
    startsAt: zonedDateTimeToUtc(year, month, day, NIGHT_START_HOUR, 0, 0),
    endsAt: zonedDateTimeToUtc(year, month, day, NIGHT_END_HOUR, 0, 0),
  };
}

function getNextBillingDate(date: string): string {
  return addDaysToDateString(date, 1);
}

function getLatestCompletedBillingDate(reference = new Date()): string {
  const parts = getBillingDateParts(reference);
  const todayBillingDate = formatBillingDate(reference);
  const todayNightEndsAt = zonedDateTimeToUtc(parts.year, parts.month, parts.day, NIGHT_END_HOUR, 0, 0);

  if (reference.getTime() >= todayNightEndsAt.getTime()) {
    return todayBillingDate;
  }

  return addDaysToDateString(todayBillingDate, -1);
}

function isTenMinuteWindow(startsAt: Date, endsAt: Date): boolean {
  return endsAt.getTime() - startsAt.getTime() === WINDOW_MS;
}

function inferHistoricalPollIntervalMs(readings: Date[]): number | null {
  const intervalCounts = new Map<number, number>();

  for (let index = 1; index < readings.length; index += 1) {
    const intervalMs = readings[index]!.getTime() - readings[index - 1]!.getTime();
    if (intervalMs <= 0) continue;

    const roundedIntervalMs = Math.round(intervalMs / 1000) * 1000;
    intervalCounts.set(roundedIntervalMs, (intervalCounts.get(roundedIntervalMs) ?? 0) + 1);
  }

  let bestIntervalMs: number | null = null;
  let bestCount = -1;
  for (const [intervalMs, count] of intervalCounts.entries()) {
    if (count > bestCount || (count === bestCount && (bestIntervalMs == null || intervalMs < bestIntervalMs))) {
      bestIntervalMs = intervalMs;
      bestCount = count;
    }
  }

  return bestIntervalMs;
}

function readingsForWindow(allReadings: Date[], startsAt: Date, endsAt: Date): Date[] {
  return allReadings.filter((timestamp) => (
    timestamp.getTime() >= startsAt.getTime()
    && timestamp.getTime() < endsAt.getTime()
  ));
}

function isHistoricallyCompleteWindow(
  readings: Date[],
  startsAt: Date,
  endsAt: Date,
  sampleCount: number,
  historicalPollIntervalMs: number | null,
): boolean {
  if (!isTenMinuteWindow(startsAt, endsAt) || readings.length < 2) {
    return false;
  }

  if (historicalPollIntervalMs == null || historicalPollIntervalMs <= 0) {
    return false;
  }

  const firstReadingAt = readings[0]!.getTime();
  const lastReadingAt = readings[readings.length - 1]!.getTime();
  const expectedSampleCount = Math.max(1, Math.floor(WINDOW_MS / historicalPollIntervalMs));
  const coversWindowStart = firstReadingAt - startsAt.getTime() <= historicalPollIntervalMs;
  const coversWindowEnd = endsAt.getTime() - lastReadingAt <= historicalPollIntervalMs;

  return coversWindowStart
    && coversWindowEnd
    && readings.length >= expectedSampleCount
    && sampleCount >= expectedSampleCount;
}

function daysInCurrentBillingMonth(reference = new Date()): number {
  const parts = getBillingDateParts(reference);
  const monthStart = zonedDateTimeToUtc(parts.year, parts.month, 1, 0, 0, 0);
  const nextMonthStart = parts.month === 12
    ? zonedDateTimeToUtc(parts.year + 1, 1, 1, 0, 0, 0)
    : zonedDateTimeToUtc(parts.year, parts.month + 1, 1, 0, 0, 0);

  return Math.round((nextMonthStart.getTime() - monthStart.getTime()) / (24 * 3600_000));
}

async function resolveActiveBillingPlan(deviceId: number, at: Date): Promise<NonNullable<BillingPlanRow> | null> {
  const plan = await prisma.billingPlan.findFirst({
    where: {
      deviceId,
      effectiveFrom: { lte: at },
      OR: [
        { effectiveTo: null },
        { effectiveTo: { gt: at } },
      ],
    },
    orderBy: { effectiveFrom: 'desc' },
  });

  return plan ?? null;
}

async function resolveCurrentRate(
  deviceId: number,
  at: Date,
): Promise<{ pricingMode: PricingMode | null; currentRateEurPerKwh: number | null; messageCode: GhostLoadMessageCode | null }> {
  const plan = await resolveActiveBillingPlan(deviceId, at);
  if (!plan) {
    return {
      pricingMode: null,
      currentRateEurPerKwh: null,
      messageCode: 'NO_ACTIVE_BILLING_PLAN',
    };
  }

  const pricingMode = plan.pricingMode as PricingMode;
  const spotProvider = plan.spotProvider;
  const spotZone = plan.spotZone;
  const spotAdderEurPerKwh = plan.spotAdderEurPerKwh;

  if (pricingMode === 'FIXED') {
    const latestReading = await prisma.reading.findFirst({
      where: {
        deviceId,
        timestamp: { lte: at },
      },
      orderBy: { timestamp: 'desc' },
      select: {
        electricityTariff: true,
      },
    });

    const tariff = latestReading?.electricityTariff;
    const currentRate = tariff === 1
      ? plan.rateT1
      : tariff === 2
        ? plan.rateT2
        : tariff === 3
          ? plan.rateT3
          : tariff === 4
            ? plan.rateT4
            : null;

    if (tariff == null || currentRate == null) {
      return {
        pricingMode,
        currentRateEurPerKwh: null,
        messageCode: 'FIXED_TARIFF_UNAVAILABLE',
      };
    }

    return {
      pricingMode,
      currentRateEurPerKwh: currentRate,
      messageCode: null,
    };
  }

  if (!spotProvider || !spotZone || spotAdderEurPerKwh == null) {
    return {
      pricingMode,
      currentRateEurPerKwh: null,
      messageCode: 'DYNAMIC_CONFIG_INCOMPLETE',
    };
  }

  const spotPrice = await prisma.spotPrice.findFirst({
    where: {
      provider: spotProvider,
      zone: spotZone,
      startsAt: { lte: at },
      endsAt: { gt: at },
    },
    orderBy: { startsAt: 'desc' },
  });

  if (!spotPrice) {
    return {
      pricingMode,
      currentRateEurPerKwh: null,
      messageCode: 'SPOT_PRICE_UNAVAILABLE',
    };
  }

  return {
    pricingMode,
    currentRateEurPerKwh: roundValue((spotPrice.priceEurPerMwh / 1000) + spotAdderEurPerKwh, 6),
    messageCode: null,
  };
}

export class StandbyPowerService {
  getLatestCompletedBillingDate(reference = new Date()): string {
    return getLatestCompletedBillingDate(reference);
  }

  getStandbyNightRangeForDate(billingDate: string): { startsAt: Date; endsAt: Date } {
    return getStandbyNightRange(billingDate);
  }

  async analyzeAndSaveStandbyBaseline(
    deviceId: number,
    billingDate = getLatestCompletedBillingDate(),
  ) {
    const { startsAt, endsAt } = getStandbyNightRange(billingDate);
    const candidateWindows = await prisma.aggregatedData.findMany({
      where: {
        deviceId,
        startsAt: { gte: startsAt },
        endsAt: { lte: endsAt },
        activePowerAvgTotal: {
          not: null,
          gte: 0,
        },
        sampleCount: { gt: 0 },
      },
      orderBy: [
        { activePowerAvgTotal: 'asc' },
        { startsAt: 'asc' },
      ],
    });

    const allNightReadings = await prisma.reading.findMany({
      where: {
        deviceId,
        timestamp: {
          gte: startsAt,
          lt: endsAt,
        },
      },
      orderBy: { timestamp: 'asc' },
      select: { timestamp: true },
    });
    const allNightTimestamps = allNightReadings.map((reading) => reading.timestamp);
    const historicalPollIntervalMs = inferHistoricalPollIntervalMs(allNightTimestamps);

    const quietestWindow = candidateWindows.find((window) => (
      isHistoricallyCompleteWindow(
        readingsForWindow(
          allNightTimestamps,
          window.startsAt,
          window.endsAt,
        ),
        window.startsAt,
        window.endsAt,
        window.sampleCount,
        historicalPollIntervalMs,
      )
    )) ?? null;

    if (!quietestWindow || quietestWindow.activePowerAvgTotal == null) {
      return null;
    }

    return prisma.standbyBaseline.upsert({
      where: {
        deviceId_baselineDate: {
          deviceId,
          baselineDate: billingDate,
        },
      },
      update: {
        baselinePowerKw: quietestWindow.activePowerAvgTotal,
        windowStartsAt: quietestWindow.startsAt,
        windowEndsAt: quietestWindow.endsAt,
        sampleCount: quietestWindow.sampleCount,
        computedAt: new Date(),
      },
      create: {
        deviceId,
        baselineDate: billingDate,
        baselinePowerKw: quietestWindow.activePowerAvgTotal,
        windowStartsAt: quietestWindow.startsAt,
        windowEndsAt: quietestWindow.endsAt,
        sampleCount: quietestWindow.sampleCount,
      },
    });
  }

  async ensureLatestCompletedNightBaselines(reference = new Date()): Promise<number> {
    const billingDate = getLatestCompletedBillingDate(reference);
    const devices = await prisma.device.findMany({
      where: {
        isActive: true,
        standbyBaselines: {
          none: { baselineDate: billingDate },
        },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    let created = 0;
    for (const device of devices) {
      const baseline = await this.analyzeAndSaveStandbyBaseline(device.id, billingDate);
      if (baseline) {
        created += 1;
      }
    }

    return created;
  }

  async getGhostLoadOverview(
    deviceId: number,
    at = new Date(),
  ): Promise<GhostLoadOverview> {
    const latestCompletedBaselineDate = getLatestCompletedBillingDate(at);
    const baseline = await prisma.standbyBaseline.findFirst({
      where: {
        deviceId,
        baselineDate: { lte: latestCompletedBaselineDate },
      },
      orderBy: [
        { baselineDate: 'desc' },
        { computedAt: 'desc' },
      ],
    });

    if (!baseline) {
      const messageCode: GhostLoadMessageCode = 'NO_BASELINE';
      return {
        status: 'unavailable',
        currency: 'EUR',
        pricingMode: null,
        baselineDate: null,
        computedAt: null,
        sourceWindowStartsAt: null,
        sourceWindowEndsAt: null,
        baselinePowerKw: null,
        baselinePowerWatts: null,
        projectedDailyKwh: null,
        projectedMonthlyKwh: null,
        currentRateEurPerKwh: null,
        projectedMonthlyCostEur: null,
        messageCode,
        message: messageForCode(messageCode),
      };
    }

    const baselinePowerKw = roundValue(baseline.baselinePowerKw, 6);
    const baselinePowerWatts = Math.round(baselinePowerKw * 1000);
    const projectedDailyKwh = roundValue(baselinePowerKw * 24, 3);
    const projectedMonthlyKwh = roundValue(projectedDailyKwh * daysInCurrentBillingMonth(at), 3);
    const currentRate = await resolveCurrentRate(deviceId, at);

    if (currentRate.currentRateEurPerKwh == null) {
      const messageCode = currentRate.messageCode;
      return {
        status: 'partial',
        currency: 'EUR',
        pricingMode: currentRate.pricingMode,
        baselineDate: baseline.baselineDate,
        computedAt: baseline.computedAt.toISOString(),
        sourceWindowStartsAt: baseline.windowStartsAt.toISOString(),
        sourceWindowEndsAt: baseline.windowEndsAt.toISOString(),
        baselinePowerKw,
        baselinePowerWatts,
        projectedDailyKwh,
        projectedMonthlyKwh,
        currentRateEurPerKwh: null,
        projectedMonthlyCostEur: null,
        messageCode,
        message: messageCode ? messageForCode(messageCode) : null,
      };
    }

    const projectedMonthlyCostEur = roundValue(projectedMonthlyKwh * currentRate.currentRateEurPerKwh, 4);

    return {
      status: 'complete',
      currency: 'EUR',
      pricingMode: currentRate.pricingMode,
      baselineDate: baseline.baselineDate,
      computedAt: baseline.computedAt.toISOString(),
      sourceWindowStartsAt: baseline.windowStartsAt.toISOString(),
      sourceWindowEndsAt: baseline.windowEndsAt.toISOString(),
      baselinePowerKw,
      baselinePowerWatts,
      projectedDailyKwh,
      projectedMonthlyKwh,
      currentRateEurPerKwh: currentRate.currentRateEurPerKwh,
      projectedMonthlyCostEur,
      messageCode: null,
      message: null,
    };
  }

  getNextAnalysisBillingDate(reference = new Date()): string {
    return getNextBillingDate(getLatestCompletedBillingDate(reference));
  }

  getNextSchedulerRun(reference = new Date()): Date {
    const parts = getBillingDateParts(reference);
    let year = parts.year;
    let month = parts.month;
    let day = parts.day;

    const targetToday = zonedDateTimeToUtc(parts.year, parts.month, parts.day, NIGHT_END_HOUR, 5, 0);
    if (reference.getTime() >= targetToday.getTime()) {
      const tomorrow = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
      year = tomorrow.getUTCFullYear();
      month = tomorrow.getUTCMonth() + 1;
      day = tomorrow.getUTCDate();
    }

    return zonedDateTimeToUtc(year, month, day, NIGHT_END_HOUR, 5, 0);
  }

  isTenMinuteWindow(startsAt: Date, endsAt: Date): boolean {
    return isTenMinuteWindow(startsAt, endsAt);
  }
}

export const standbyPowerService = new StandbyPowerService();
