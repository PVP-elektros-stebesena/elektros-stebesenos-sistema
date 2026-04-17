import prisma from '../lib/prisma.js';
import type { PricingMode } from './billingPlanService.js';
import {
  isSpotPriceProviderName,
  isSpotPriceZone,
  type SpotPriceProviderName,
  type SpotPriceZone,
} from './spotPriceProvider.js';
import { getBillingDateParts, zonedDateTimeToUtc } from './timezone.js';

export type EstimatedCostStatus = 'complete' | 'partial' | 'unavailable';

export interface EstimatedCostBreakdownItem {
  startsAt: string;
  endsAt: string;
  pricingMode: PricingMode | 'UNCONFIGURED';
  energyChargeEur: number;
  fixedFeesEur: number;
  totalEur: number;
  details: Record<string, unknown>;
}

export interface EstimatedCostResult {
  status: EstimatedCostStatus;
  currency: 'EUR';
  totalEur: number;
  energyChargeEur: number;
  fixedFeesEur: number;
  breakdown: EstimatedCostBreakdownItem[];
  missingCoveragePct: number;
}

type BillingPlanRow = Awaited<ReturnType<typeof prisma.billingPlan.findMany>>[number];

type ReadingBoundaryRow = {
  timestamp: Date;
  energyDelivered: number | null;
  energyDeliveredTariff1: number | null;
  energyDeliveredTariff2: number | null;
  energyDeliveredTariff3: number | null;
  energyDeliveredTariff4: number | null;
};

type SpotPriceRow = {
  provider: SpotPriceProviderName;
  zone: SpotPriceZone;
  startsAt: Date;
  endsAt: Date;
  priceEurPerMwh: number;
};

const READING_SELECT = {
  timestamp: true,
  energyDelivered: true,
  energyDeliveredTariff1: true,
  energyDeliveredTariff2: true,
  energyDeliveredTariff3: true,
  energyDeliveredTariff4: true,
} as const;

function roundCurrency(value: number): number {
  return +value.toFixed(4);
}

function safeDelta(start: number | null, end: number | null): number {
  if (start == null || end == null || end < start) return 0;
  return +(end - start).toFixed(6);
}

function overlapMs(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min(aEnd.getTime(), bEnd.getTime());
  return Math.max(0, end - start);
}

function findReadingAtOrBefore(
  readings: ReadingBoundaryRow[],
  target: Date,
): ReadingBoundaryRow | null {
  for (let i = readings.length - 1; i >= 0; i -= 1) {
    if (readings[i]!.timestamp.getTime() <= target.getTime()) {
      return readings[i]!;
    }
  }
  return null;
}

function findReadingAtOrAfter(
  readings: ReadingBoundaryRow[],
  target: Date,
): ReadingBoundaryRow | null {
  return readings.find((reading) => reading.timestamp.getTime() >= target.getTime()) ?? null;
}

function buildReadingSequence(
  readings: ReadingBoundaryRow[],
  startsAt: Date,
  endsAt: Date,
): ReadingBoundaryRow[] {
  const relevantReadings = readings.filter((reading) => (
    reading.timestamp.getTime() >= startsAt.getTime() && reading.timestamp.getTime() <= endsAt.getTime()
  ));
  const startBoundary = findReadingAtOrBefore(readings, startsAt);
  const endBoundary = findReadingAtOrAfter(readings, endsAt);

  return [
    startBoundary,
    ...relevantReadings,
    endBoundary,
  ].filter((reading): reading is ReadingBoundaryRow => reading != null)
    .filter((reading, index, arr) => index === 0 || reading.timestamp.getTime() !== arr[index - 1]!.timestamp.getTime());
}

function nextMonthStart(date: Date): Date {
  const parts = getBillingDateParts(date);
  const nextMonth = parts.month === 12 ? 1 : parts.month + 1;
  const nextYear = parts.month === 12 ? parts.year + 1 : parts.year;
  return zonedDateTimeToUtc(nextYear, nextMonth, 1, 0, 0, 0);
}

function monthStart(date: Date): Date {
  const parts = getBillingDateParts(date);
  return zonedDateTimeToUtc(parts.year, parts.month, 1, 0, 0, 0);
}

function prorateMonthlyFixedFee(
  startsAt: Date,
  endsAt: Date,
  monthlyFixedFeeEur: number | null,
): number {
  if (monthlyFixedFeeEur == null || monthlyFixedFeeEur === 0) return 0;

  let cursor = new Date(startsAt);
  let total = 0;

  while (cursor < endsAt) {
    const currentMonthStart = monthStart(cursor);
    const currentMonthEnd = nextMonthStart(cursor);
    const sliceEnd = new Date(Math.min(currentMonthEnd.getTime(), endsAt.getTime()));
    const coveredMs = sliceEnd.getTime() - cursor.getTime();
    const monthMs = currentMonthEnd.getTime() - currentMonthStart.getTime();
    total += (coveredMs / monthMs) * monthlyFixedFeeEur;
    cursor = sliceEnd;
  }

  return roundCurrency(total);
}

function buildSegments(
  plans: BillingPlanRow[],
  startsAt: Date,
  endsAt: Date,
): Array<{ startsAt: Date; endsAt: Date; plan: BillingPlanRow | null }> {
  if (plans.length === 0) {
    return [{ startsAt, endsAt, plan: null }];
  }

  const boundaries = new Set<number>([startsAt.getTime(), endsAt.getTime()]);
  for (const plan of plans) {
    if (plan.effectiveFrom.getTime() > startsAt.getTime() && plan.effectiveFrom.getTime() < endsAt.getTime()) {
      boundaries.add(plan.effectiveFrom.getTime());
    }
    if (plan.effectiveTo && plan.effectiveTo.getTime() > startsAt.getTime() && plan.effectiveTo.getTime() < endsAt.getTime()) {
      boundaries.add(plan.effectiveTo.getTime());
    }
  }

  const sorted = [...boundaries].sort((a, b) => a - b);
  const segments: Array<{ startsAt: Date; endsAt: Date; plan: BillingPlanRow | null }> = [];

  for (let i = 1; i < sorted.length; i += 1) {
    const segmentStart = new Date(sorted[i - 1]!);
    const segmentEnd = new Date(sorted[i]!);
    if (segmentEnd.getTime() <= segmentStart.getTime()) continue;

    const plan = plans.find((candidate) =>
      candidate.effectiveFrom.getTime() <= segmentStart.getTime()
      && (candidate.effectiveTo == null || candidate.effectiveTo.getTime() > segmentStart.getTime()),
    ) ?? null;

    segments.push({ startsAt: segmentStart, endsAt: segmentEnd, plan });
  }

  return segments;
}

async function loadReadings(
  deviceId: number,
  startsAt: Date,
  endsAt: Date,
): Promise<ReadingBoundaryRow[]> {
  const [beforeStart, inRange, afterEnd] = await Promise.all([
    prisma.reading.findFirst({
      where: { deviceId, timestamp: { lt: startsAt } },
      orderBy: { timestamp: 'desc' },
      select: READING_SELECT,
    }),
    prisma.reading.findMany({
      where: { deviceId, timestamp: { gte: startsAt, lte: endsAt } },
      orderBy: { timestamp: 'asc' },
      select: READING_SELECT,
    }),
    prisma.reading.findFirst({
      where: { deviceId, timestamp: { gt: endsAt } },
      orderBy: { timestamp: 'asc' },
      select: READING_SELECT,
    }),
  ]);

  const rows = [beforeStart, ...inRange, afterEnd].filter(
    (row): row is ReadingBoundaryRow => row != null,
  );

  return rows.filter((row, index) => (
    index === 0 || row.timestamp.getTime() !== rows[index - 1]!.timestamp.getTime()
  ));
}

async function loadSpotPrices(
  startsAt: Date,
  endsAt: Date,
  providerZones: Array<{ provider: SpotPriceProviderName; zone: SpotPriceZone }>,
): Promise<SpotPriceRow[]> {
  if (providerZones.length === 0) {
    return [];
  }

  const rows = await prisma.spotPrice.findMany({
    where: {
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      OR: providerZones.map(({ provider, zone }) => ({
        provider,
        zone,
      })),
    },
    orderBy: { startsAt: 'asc' },
    select: {
      provider: true,
      zone: true,
      startsAt: true,
      endsAt: true,
      priceEurPerMwh: true,
    },
  });

  return rows.flatMap((row) => (
    isSpotPriceProviderName(row.provider) && isSpotPriceZone(row.zone)
      ? [{
          provider: row.provider,
          zone: row.zone,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          priceEurPerMwh: row.priceEurPerMwh,
        }]
      : []
  ));
}

function calculateFixedSegment(
  plan: BillingPlanRow,
  readings: ReadingBoundaryRow[],
  startsAt: Date,
  endsAt: Date,
): { item: EstimatedCostBreakdownItem; partial: boolean; missingPortion: number } {
  const sequence = buildReadingSequence(readings, startsAt, endsAt);
  const segmentDurationMs = endsAt.getTime() - startsAt.getTime();
  const fixedFeesEur = prorateMonthlyFixedFee(startsAt, endsAt, plan.monthlyFixedFeeEur);

  if (sequence.length < 2 || segmentDurationMs <= 0) {
    return {
      item: {
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        pricingMode: 'FIXED',
        energyChargeEur: 0,
        fixedFeesEur,
        totalEur: fixedFeesEur,
        details: {
          fixedRates: {
            t1: plan.rateT1,
            t2: plan.rateT2,
            t3: plan.rateT3,
            t4: plan.rateT4,
          },
          unavailable: true,
        },
      },
      partial: true,
      missingPortion: 1,
    };
  }

  let t1Kwh = 0;
  let t2Kwh = 0;
  let t3Kwh = 0;
  let t4Kwh = 0;
  let coveredMs = 0;

  for (let i = 1; i < sequence.length; i += 1) {
    const previous = sequence[i - 1]!;
    const current = sequence[i]!;
    const pairStart = new Date(Math.max(previous.timestamp.getTime(), startsAt.getTime()));
    const pairEnd = new Date(Math.min(current.timestamp.getTime(), endsAt.getTime()));

    if (pairEnd.getTime() <= pairStart.getTime()) continue;

    const pairDurationMs = current.timestamp.getTime() - previous.timestamp.getTime();
    if (pairDurationMs <= 0) continue;

    const overlapRatio = (pairEnd.getTime() - pairStart.getTime()) / pairDurationMs;
    t1Kwh += safeDelta(previous.energyDeliveredTariff1, current.energyDeliveredTariff1) * overlapRatio;
    t2Kwh += safeDelta(previous.energyDeliveredTariff2, current.energyDeliveredTariff2) * overlapRatio;
    t3Kwh += safeDelta(previous.energyDeliveredTariff3, current.energyDeliveredTariff3) * overlapRatio;
    t4Kwh += safeDelta(previous.energyDeliveredTariff4, current.energyDeliveredTariff4) * overlapRatio;
    coveredMs += pairEnd.getTime() - pairStart.getTime();
  }

  t1Kwh = +t1Kwh.toFixed(6);
  t2Kwh = +t2Kwh.toFixed(6);
  t3Kwh = +t3Kwh.toFixed(6);
  t4Kwh = +t4Kwh.toFixed(6);

  const energyChargeEur = roundCurrency(
    (t1Kwh * (plan.rateT1 ?? 0))
    + (t2Kwh * (plan.rateT2 ?? 0))
    + (t3Kwh * (plan.rateT3 ?? 0))
    + (t4Kwh * (plan.rateT4 ?? 0)),
  );
  const totalEur = roundCurrency(energyChargeEur + fixedFeesEur);
  const configured = [plan.rateT1, plan.rateT2, plan.rateT3, plan.rateT4, plan.monthlyFixedFeeEur]
    .some((value) => value != null);
  const missingPortion = !configured
    ? 1
    : Math.max(0, 1 - (coveredMs / segmentDurationMs));

  return {
    item: {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      pricingMode: 'FIXED',
      energyChargeEur,
      fixedFeesEur,
      totalEur,
      details: {
        tariffsKwh: { t1: t1Kwh, t2: t2Kwh, t3: t3Kwh, t4: t4Kwh },
        fixedRates: {
          t1: plan.rateT1,
          t2: plan.rateT2,
          t3: plan.rateT3,
          t4: plan.rateT4,
        },
        coveredDurationPct: roundCurrency((coveredMs / segmentDurationMs) * 100),
        monthlyFixedFeeEur: plan.monthlyFixedFeeEur,
      },
    },
    partial: missingPortion > 0 || !configured,
    missingPortion,
  };
}

function calculateDynamicSegment(
  plan: BillingPlanRow,
  readings: ReadingBoundaryRow[],
  spotPrices: SpotPriceRow[],
  startsAt: Date,
  endsAt: Date,
): { item: EstimatedCostBreakdownItem; partial: boolean; missingPortion: number } {
  const fixedFeesEur = prorateMonthlyFixedFee(startsAt, endsAt, plan.monthlyFixedFeeEur);

  if (!plan.spotProvider || !plan.spotZone) {
    return {
      item: {
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        pricingMode: 'DYNAMIC',
        energyChargeEur: 0,
        fixedFeesEur,
        totalEur: fixedFeesEur,
        details: {
          provider: plan.spotProvider,
          zone: plan.spotZone,
          spotAdderEurPerKwh: plan.spotAdderEurPerKwh,
          unavailable: true,
        },
      },
      partial: true,
      missingPortion: 1,
    };
  }

  const matchingSpotPrices = spotPrices.filter((spotPrice) => (
    spotPrice.provider === plan.spotProvider && spotPrice.zone === plan.spotZone
  ));

  const sequence = buildReadingSequence(readings, startsAt, endsAt);

  if (sequence.length < 2) {
    return {
      item: {
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        pricingMode: 'DYNAMIC',
        energyChargeEur: 0,
        fixedFeesEur,
        totalEur: fixedFeesEur,
        details: {
          provider: plan.spotProvider,
          zone: plan.spotZone,
          spotAdderEurPerKwh: plan.spotAdderEurPerKwh,
          unavailable: true,
        },
      },
      partial: true,
      missingPortion: 1,
    };
  }

  let coveredEnergyKwh = 0;
  let missingEnergyKwh = 0;
  let energyChargeEur = 0;

  for (let i = 1; i < sequence.length; i += 1) {
    const previous = sequence[i - 1]!;
    const current = sequence[i]!;
    const pairStart = new Date(Math.max(previous.timestamp.getTime(), startsAt.getTime()));
    const pairEnd = new Date(Math.min(current.timestamp.getTime(), endsAt.getTime()));

    if (pairEnd.getTime() <= pairStart.getTime()) continue;

    const pairDurationMs = current.timestamp.getTime() - previous.timestamp.getTime();
    if (pairDurationMs <= 0) continue;

    const deliveredDeltaKwh = safeDelta(previous.energyDelivered, current.energyDelivered);
    const overlappingPairMs = pairEnd.getTime() - pairStart.getTime();
    const pairSegmentKwh = deliveredDeltaKwh * (overlappingPairMs / pairDurationMs);
    let pairCoveredMs = 0;

    for (const spotPrice of matchingSpotPrices) {
      const priceOverlapMs = overlapMs(pairStart, pairEnd, spotPrice.startsAt, spotPrice.endsAt);
      if (priceOverlapMs <= 0) continue;

      pairCoveredMs += priceOverlapMs;
      const coveredKwh = pairSegmentKwh * (priceOverlapMs / overlappingPairMs);
      const effectiveRateEurPerKwh = (spotPrice.priceEurPerMwh / 1000) + (plan.spotAdderEurPerKwh ?? 0);
      energyChargeEur += coveredKwh * effectiveRateEurPerKwh;
      coveredEnergyKwh += coveredKwh;
    }

    if (pairCoveredMs < overlappingPairMs) {
      missingEnergyKwh += pairSegmentKwh * ((overlappingPairMs - pairCoveredMs) / overlappingPairMs);
    }
  }

  const roundedEnergyCharge = roundCurrency(energyChargeEur);
  const totalEur = roundCurrency(roundedEnergyCharge + fixedFeesEur);
  const totalEnergyConsidered = coveredEnergyKwh + missingEnergyKwh;
  const missingPortion = totalEnergyConsidered > 0 ? (missingEnergyKwh / totalEnergyConsidered) : 0;

  return {
    item: {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      pricingMode: 'DYNAMIC',
      energyChargeEur: roundedEnergyCharge,
      fixedFeesEur,
      totalEur,
      details: {
        provider: plan.spotProvider,
        zone: plan.spotZone,
        spotAdderEurPerKwh: plan.spotAdderEurPerKwh,
        coveredEnergyKwh: +coveredEnergyKwh.toFixed(6),
        missingEnergyKwh: +missingEnergyKwh.toFixed(6),
      },
    },
    partial: missingPortion > 0,
    missingPortion,
  };
}

export class CostCalculatorService {
  async calculateEstimatedCost(
    deviceId: number,
    startsAt: Date,
    endsAt: Date,
  ): Promise<EstimatedCostResult> {
    const plans = await prisma.billingPlan.findMany({
      where: {
        deviceId,
        effectiveFrom: { lt: endsAt },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gt: startsAt } },
        ],
      },
      orderBy: { effectiveFrom: 'asc' },
    });

    const segments = buildSegments(plans, startsAt, endsAt);
    const readings = await loadReadings(deviceId, startsAt, endsAt);
    const spotPriceKeys = plans
      .filter((plan): plan is BillingPlanRow & { spotProvider: SpotPriceProviderName; spotZone: SpotPriceZone } => (
        plan.pricingMode === 'DYNAMIC' && plan.spotProvider != null && plan.spotZone != null
      ))
      .map((plan) => ({
        provider: plan.spotProvider,
        zone: plan.spotZone,
      }))
      .filter((key, index, all) => (
        all.findIndex((candidate) => candidate.provider === key.provider && candidate.zone === key.zone) === index
      ));
    const spotPrices = await loadSpotPrices(startsAt, endsAt, spotPriceKeys);

    let energyChargeEur = 0;
    let fixedFeesEur = 0;
    let coveredPortionAccumulator = 0;
    const breakdown: EstimatedCostBreakdownItem[] = [];
    let hasAnyConfiguredSegment = false;
    let partial = false;

    for (const segment of segments) {
      const durationMs = segment.endsAt.getTime() - segment.startsAt.getTime();
      if (durationMs <= 0) continue;

      if (!segment.plan) {
        partial = true;
        breakdown.push({
          startsAt: segment.startsAt.toISOString(),
          endsAt: segment.endsAt.toISOString(),
          pricingMode: 'UNCONFIGURED',
          energyChargeEur: 0,
          fixedFeesEur: 0,
          totalEur: 0,
          details: {
            message: 'No billing plan configured for this interval.',
          },
        });
        continue;
      }

      const result = segment.plan.pricingMode === 'FIXED'
        ? calculateFixedSegment(segment.plan, readings, segment.startsAt, segment.endsAt)
        : calculateDynamicSegment(segment.plan, readings, spotPrices, segment.startsAt, segment.endsAt);

      if (segment.plan.pricingMode === 'FIXED') {
        hasAnyConfiguredSegment ||= [segment.plan.rateT1, segment.plan.rateT2, segment.plan.rateT3, segment.plan.rateT4, segment.plan.monthlyFixedFeeEur]
          .some((value) => value != null);
      } else {
        hasAnyConfiguredSegment ||= segment.plan.spotProvider != null && segment.plan.spotZone != null;
      }

      if (result.partial) {
        partial = true;
      }

      const segmentCoverage = 1 - result.missingPortion;
      coveredPortionAccumulator += (durationMs / (endsAt.getTime() - startsAt.getTime())) * segmentCoverage;
      energyChargeEur += result.item.energyChargeEur;
      fixedFeesEur += result.item.fixedFeesEur;
      breakdown.push(result.item);
    }

    const totalEur = roundCurrency(energyChargeEur + fixedFeesEur);
    const missingCoveragePct = roundCurrency(Math.max(0, 100 - (coveredPortionAccumulator * 100)));

    if (!hasAnyConfiguredSegment || breakdown.length === 0) {
      return {
        status: 'unavailable',
        currency: 'EUR',
        totalEur: 0,
        energyChargeEur: 0,
        fixedFeesEur: 0,
        breakdown,
        missingCoveragePct: 100,
      };
    }

    return {
      status: partial || missingCoveragePct > 0 ? 'partial' : 'complete',
      currency: 'EUR',
      totalEur,
      energyChargeEur: roundCurrency(energyChargeEur),
      fixedFeesEur: roundCurrency(fixedFeesEur),
      breakdown,
      missingCoveragePct,
    };
  }
}

export const costCalculatorService = new CostCalculatorService();
