import { ESO } from '../config/eso.js';
import prisma from '../lib/prisma.js';
import { resolveEffectivePowerPolicy } from './powerPolicy.js';

export type ReactivePenaltyStatus = 'complete' | 'partial' | 'unavailable' | 'not_applicable';

export interface ReactivePenaltyEstimate {
  status: ReactivePenaltyStatus;
  currency: 'EUR';
  totalEur: number | null;
  activeImportedKwh: number | null;
  reactiveConsumedKvarh: number | null;
  reactiveReturnedKvarh: number | null;
  allowedReactiveConsumedKvarh: number | null;
  chargeableReactiveConsumedKvarh: number | null;
  chargeableReactiveReturnedKvarh: number | null;
  rates: {
    allowedTanPhiRatio: number;
    targetPowerFactor: number;
    eligibleMinGridCapacityKw: number;
    consumedReactiveEurPerKvarh: number;
    returnedReactiveEurPerKvarh: number;
    effectiveFrom: string;
    sourceUrls: readonly string[];
  };
  formula: string;
  message: string;
}

type CounterField = 'energyDelivered' | 'reactiveEnergyDelivered' | 'reactiveEnergyReturned';

interface ReactiveReading {
  timestamp: Date;
  energyDelivered: number | null;
  reactiveEnergyDelivered: number | null;
  reactiveEnergyReturned: number | null;
}

interface ReactiveCoverageWindow {
  startsAt: Date;
  endsAt: Date;
  sampleCount: number;
}

interface CounterDeltaResult {
  value: number;
  validSegmentCount: number;
  missingSegmentCount: number;
  resetSegmentCount: number;
}

const REACTIVE = ESO.REACTIVE_PENALTY;
const WINDOW_MS = ESO.WINDOW_MINUTES * 60_000;
const MIN_COVERAGE_TOLERANCE_MS = 60_000;
const MIN_GAP_THRESHOLD_MS = 30_000;
const GAP_THRESHOLD_MULTIPLIER = 2.5;
const WINDOW_CONTIGUITY_TOLERANCE_MS = 1_000;

function round(value: number, decimals = 3): number {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

function baseEstimate(
  status: ReactivePenaltyStatus,
  message: string,
  values: Partial<Omit<ReactivePenaltyEstimate, 'status' | 'currency' | 'rates' | 'formula' | 'message'>> = {},
): ReactivePenaltyEstimate {
  return {
    status,
    currency: REACTIVE.CURRENCY,
    totalEur: values.totalEur ?? null,
    activeImportedKwh: values.activeImportedKwh ?? null,
    reactiveConsumedKvarh: values.reactiveConsumedKvarh ?? null,
    reactiveReturnedKvarh: values.reactiveReturnedKvarh ?? null,
    allowedReactiveConsumedKvarh: values.allowedReactiveConsumedKvarh ?? null,
    chargeableReactiveConsumedKvarh: values.chargeableReactiveConsumedKvarh ?? null,
    chargeableReactiveReturnedKvarh: values.chargeableReactiveReturnedKvarh ?? null,
    rates: {
      allowedTanPhiRatio: REACTIVE.ALLOWED_TAN_PHI_RATIO,
      targetPowerFactor: REACTIVE.TARGET_POWER_FACTOR,
      eligibleMinGridCapacityKw: REACTIVE.ELIGIBLE_MIN_GRID_CAPACITY_KW,
      consumedReactiveEurPerKvarh: REACTIVE.CONSUMED_REACTIVE_EUR_PER_KVARH,
      returnedReactiveEurPerKvarh: REACTIVE.RETURNED_REACTIVE_EUR_PER_KVARH,
      effectiveFrom: REACTIVE.EFFECTIVE_FROM,
      sourceUrls: REACTIVE.SOURCE_URLS,
    },
    formula:
      'max(reactiveConsumedKvarh - activeImportedKwh * allowedTanPhiRatio, 0) * consumedRate + reactiveReturnedKvarh * returnedRate',
    message,
  };
}

export function unavailableReactivePenaltyEstimate(message: string): ReactivePenaltyEstimate {
  return baseEstimate('unavailable', message);
}

function notApplicableReactivePenaltyEstimate(): ReactivePenaltyEstimate {
  return baseEstimate(
    'not_applicable',
    `Reactive energy penalty estimates apply to commercial connections at or above ${REACTIVE.ELIGIBLE_MIN_GRID_CAPACITY_KW} kW.`,
  );
}

function calculateCounterDelta(readings: ReactiveReading[], field: CounterField): CounterDeltaResult {
  const result: CounterDeltaResult = {
    value: 0,
    validSegmentCount: 0,
    missingSegmentCount: 0,
    resetSegmentCount: 0,
  };

  for (let i = 1; i < readings.length; i++) {
    const previous = readings[i - 1]?.[field] ?? null;
    const current = readings[i]?.[field] ?? null;

    if (previous == null || current == null) {
      result.missingSegmentCount += 1;
      continue;
    }

    const delta = current - previous;
    if (delta < 0) {
      result.resetSegmentCount += 1;
      continue;
    }

    result.value += delta;
    result.validSegmentCount += 1;
  }

  result.value = round(result.value);
  return result;
}

function hasIncompleteSegments(delta: CounterDeltaResult): boolean {
  return delta.missingSegmentCount > 0 || delta.resetSegmentCount > 0;
}

function positiveReadingGapsMs(readings: ReactiveReading[]): number[] {
  const gapsMs: number[] = [];

  for (let i = 1; i < readings.length; i++) {
    const previousTimestamp = readings[i - 1]?.timestamp.getTime();
    const currentTimestamp = readings[i]?.timestamp.getTime();
    if (previousTimestamp == null || currentTimestamp == null) continue;

    const gapMs = currentTimestamp - previousTimestamp;
    if (gapMs > 0) gapsMs.push(gapMs);
  }

  return gapsMs;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    const left = sorted[middle - 1];
    const right = sorted[middle];
    if (left == null || right == null) return null;
    return (left + right) / 2;
  }

  return sorted[middle] ?? null;
}

function resolveCadenceGapThresholdMs(readings: ReactiveReading[]): number | null {
  const gapsMs = positiveReadingGapsMs(readings);
  if (gapsMs.length < 2) return null;

  const typicalGapMs = median(gapsMs);
  if (typicalGapMs == null) return null;

  const cappedTypicalGapMs = Math.min(typicalGapMs, WINDOW_MS);
  return Math.max(MIN_GAP_THRESHOLD_MS, cappedTypicalGapMs * GAP_THRESHOLD_MULTIPLIER);
}

function hasUnexpectedReadingGaps(readings: ReactiveReading[]): boolean {
  const gapThresholdMs = resolveCadenceGapThresholdMs(readings);
  if (gapThresholdMs == null) return false;

  for (const gapMs of positiveReadingGapsMs(readings)) {
    if (gapMs > gapThresholdMs) return true;
  }

  return false;
}

function resolveCoverageToleranceMs(readings: ReactiveReading[]): number {
  const typicalGapMs = median(positiveReadingGapsMs(readings));
  if (typicalGapMs == null) return 0;

  const dynamicToleranceMs = typicalGapMs * 2;
  return Math.max(
    MIN_COVERAGE_TOLERANCE_MS,
    Math.min(Math.round(dynamicToleranceMs), WINDOW_MS),
  );
}

function hasCompleteWindowCoverage(
  windows: ReactiveCoverageWindow[],
  startsAt: Date,
  endsAt: Date,
): boolean | null {
  if (windows.length === 0) return null;

  const first = windows[0];
  const last = windows[windows.length - 1];
  if (!first || !last) return null;

  const coversStart = first.startsAt.getTime() <= startsAt.getTime() + WINDOW_MS;
  const coversEnd = last.endsAt.getTime() >= endsAt.getTime() - WINDOW_MS;
  if (!coversStart || !coversEnd) return false;

  for (let i = 0; i < windows.length; i++) {
    const current = windows[i];
    if (!current || current.sampleCount <= 0) return false;

    if (i === windows.length - 1) continue;

    const next = windows[i + 1];
    if (!next) continue;

    if (next.startsAt.getTime() - current.endsAt.getTime() > WINDOW_CONTIGUITY_TOLERANCE_MS) {
      return false;
    }
  }

  return true;
}

function resolveStatus(input: {
  readings: ReactiveReading[];
  windows: ReactiveCoverageWindow[];
  startsAt: Date;
  endsAt: Date;
  active: CounterDeltaResult;
  reactiveConsumed: CounterDeltaResult;
  reactiveReturned: CounterDeltaResult;
}): ReactivePenaltyStatus {
  if (input.active.validSegmentCount === 0) return 'unavailable';

  if (
    input.reactiveConsumed.validSegmentCount === 0 &&
    input.reactiveReturned.validSegmentCount === 0
  ) {
    return 'unavailable';
  }

  const first = input.readings[0];
  const last = input.readings[input.readings.length - 1];
  const boundaryToleranceMs = resolveCoverageToleranceMs(input.readings);
  const rawRangeCovered = !!first && !!last
    && first.timestamp.getTime() <= input.startsAt.getTime() + boundaryToleranceMs
    && last.timestamp.getTime() >= input.endsAt.getTime() - boundaryToleranceMs;
  const windowRangeCovered = hasCompleteWindowCoverage(input.windows, input.startsAt, input.endsAt);
  const rangeCovered = windowRangeCovered ?? rawRangeCovered;
  const hasUnexpectedGaps = hasUnexpectedReadingGaps(input.readings);

  if (
    !rangeCovered ||
    hasUnexpectedGaps ||
    hasIncompleteSegments(input.active) ||
    hasIncompleteSegments(input.reactiveConsumed) ||
    hasIncompleteSegments(input.reactiveReturned)
  ) {
    return 'partial';
  }

  return 'complete';
}

export function buildReactivePenaltyEstimateFromReadings(input: {
  readings: ReactiveReading[];
  windows?: ReactiveCoverageWindow[];
  startsAt: Date;
  endsAt: Date;
  maxGridCapacityKw: number | null;
}): ReactivePenaltyEstimate {
  if (
    input.maxGridCapacityKw == null ||
    input.maxGridCapacityKw < REACTIVE.ELIGIBLE_MIN_GRID_CAPACITY_KW
  ) {
    return notApplicableReactivePenaltyEstimate();
  }

  if (input.readings.length < 2) {
    return baseEstimate(
      'unavailable',
      'At least two readings in the selected period are required to estimate reactive energy penalties.',
    );
  }

  const active = calculateCounterDelta(input.readings, 'energyDelivered');
  const reactiveConsumed = calculateCounterDelta(input.readings, 'reactiveEnergyDelivered');
  const reactiveReturned = calculateCounterDelta(input.readings, 'reactiveEnergyReturned');
  const status = resolveStatus({
    readings: input.readings,
    windows: input.windows ?? [],
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    active,
    reactiveConsumed,
    reactiveReturned,
  });

  if (status === 'unavailable') {
    return baseEstimate(
      'unavailable',
      'Reactive penalty estimate is unavailable because active or reactive energy counters are missing.',
    );
  }

  const activeImportedKwh = active.value;
  const reactiveConsumedKvarh = reactiveConsumed.validSegmentCount > 0 ? reactiveConsumed.value : 0;
  const reactiveReturnedKvarh = reactiveReturned.validSegmentCount > 0 ? reactiveReturned.value : 0;
  const allowedReactiveConsumedKvarh = round(activeImportedKwh * REACTIVE.ALLOWED_TAN_PHI_RATIO);
  const chargeableReactiveConsumedKvarh = round(
    Math.max(reactiveConsumedKvarh - allowedReactiveConsumedKvarh, 0),
  );
  const chargeableReactiveReturnedKvarh = round(reactiveReturnedKvarh);
  const totalEur = round(
    (chargeableReactiveConsumedKvarh * REACTIVE.CONSUMED_REACTIVE_EUR_PER_KVARH) +
      (chargeableReactiveReturnedKvarh * REACTIVE.RETURNED_REACTIVE_EUR_PER_KVARH),
    2,
  );

  return baseEstimate(
    status,
    status === 'complete'
      ? 'Reactive penalty estimate is complete for the selected period.'
      : 'Reactive penalty estimate is partial because the selected period is not fully covered or some counter segments were skipped.',
    {
      totalEur,
      activeImportedKwh,
      reactiveConsumedKvarh,
      reactiveReturnedKvarh,
      allowedReactiveConsumedKvarh,
      chargeableReactiveConsumedKvarh,
      chargeableReactiveReturnedKvarh,
    },
  );
}

export class ReactivePenaltyEstimatorService {
  async estimateForDevice(
    deviceId: number,
    startsAt: Date,
    endsAt: Date,
    options?: { readings?: ReactiveReading[]; windows?: ReactiveCoverageWindow[] },
  ): Promise<ReactivePenaltyEstimate> {
    const policy = await resolveEffectivePowerPolicy(deviceId, startsAt);
    const gridCapacityKw = Number.isFinite(policy.maxGridCapacityKw)
      ? policy.maxGridCapacityKw
      : null;

    if (
      gridCapacityKw == null ||
      gridCapacityKw < REACTIVE.ELIGIBLE_MIN_GRID_CAPACITY_KW
    ) {
      return notApplicableReactivePenaltyEstimate();
    }

    const [readings, windows] = await Promise.all([
      options?.readings
        ? Promise.resolve(options.readings)
        : prisma.reading.findMany({
          where: {
            deviceId,
            timestamp: { gte: startsAt, lte: endsAt },
          },
          orderBy: { timestamp: 'asc' },
          select: {
            timestamp: true,
            energyDelivered: true,
            reactiveEnergyDelivered: true,
            reactiveEnergyReturned: true,
          },
        }),
      options?.windows
        ? Promise.resolve(options.windows)
        : prisma.aggregatedData.findMany({
          where: {
            deviceId,
            startsAt: { gte: startsAt },
            endsAt: { lte: endsAt },
          },
          orderBy: { startsAt: 'asc' },
          select: {
            startsAt: true,
            endsAt: true,
            sampleCount: true,
          },
        }),
    ]);

    return buildReactivePenaltyEstimateFromReadings({
      readings,
      windows,
      startsAt,
      endsAt,
      maxGridCapacityKw: gridCapacityKw,
    });
  }
}

export const reactivePenaltyEstimatorService = new ReactivePenaltyEstimatorService();
