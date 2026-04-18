import { parseOptionalDate, validateAscendingRange } from '../queryParsers.js';
import type { EstimatedCostResult } from '../../services/costCalculator.js';

export type RawAnomalySummaryRow = {
  id?: number;
  type: string;
  phase: string;
  durationSeconds: number | null;
  minVoltage: number | null;
  maxVoltage: number | null;
  startsAt: string;
  endsAt: string | null;
  severity: string;
  metricDomain?: 'VOLTAGE' | 'POWER';
  metricName?: string | null;
};

export type ContextChartPoint = {
  timestamp: string;
  voltage: number | null;
  voltageL1: number | null;
  voltageL2: number | null;
  voltageL3: number | null;
  powerKw: number | null;
};

const MAX_CUSTOM_RANGE_DAYS = 62;
const MS_PER_DAY = 24 * 3600_000;
export const CONTEXT_PADDING_MS = 30 * 60 * 1000;
export const MAX_CONTEXT_POINTS = 360;

export function toSeverityLabel(severity: number): string {
  return severity >= 2 ? 'CRITICAL' : 'WARNING';
}

export function pickVoltageByPhase(
  phase: string,
  row: { voltageL1: number | null; voltageL2: number | null; voltageL3: number | null },
): number | null {
  if (phase === 'L1') return row.voltageL1;
  if (phase === 'L2') return row.voltageL2;
  if (phase === 'L3') return row.voltageL3;
  if (phase === 'ALL') {
    const values = [row.voltageL1, row.voltageL2, row.voltageL3].filter(
      (val): val is number => val != null,
    );
    if (values.length === 0) return null;
    return +(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3);
  }
  return row.voltageL1 ?? row.voltageL2 ?? row.voltageL3;
}

export function normalizePhaseVoltages(row: {
  instantaneousVoltageL1: number | null;
  instantaneousVoltageL2: number | null;
  instantaneousVoltageL3: number | null;
  voltageL1: number | null;
  voltageL2: number | null;
  voltageL3: number | null;
}): { voltageL1: number | null; voltageL2: number | null; voltageL3: number | null } {
  return {
    voltageL1: row.instantaneousVoltageL1 ?? row.voltageL1,
    voltageL2: row.instantaneousVoltageL2 ?? row.voltageL2,
    voltageL3: row.instantaneousVoltageL3 ?? row.voltageL3,
  };
}

export function pickTotalPowerKw(row: {
  activeInstantaneousPowerDelivered: number | null;
  powerDeliveredTotal: number | null;
  activeInstantaneousPowerDeliveredL1: number | null;
  activeInstantaneousPowerDeliveredL2: number | null;
  activeInstantaneousPowerDeliveredL3: number | null;
}): number | null {
  const directTotal = row.activeInstantaneousPowerDelivered ?? row.powerDeliveredTotal;
  if (directTotal != null) return +(directTotal / 1000).toFixed(4);

  const phaseValues = [
    row.activeInstantaneousPowerDeliveredL1,
    row.activeInstantaneousPowerDeliveredL2,
    row.activeInstantaneousPowerDeliveredL3,
  ].filter((val): val is number => val != null);

  if (phaseValues.length === 0) return null;
  return +(phaseValues.reduce((sum, value) => sum + value, 0) / 1000).toFixed(4);
}

export function downsampleContextPoints(
  points: ContextChartPoint[],
  anomalyStartsAt?: Date,
  anomalyEndsAt?: Date,
): ContextChartPoint[] {
  if (points.length <= MAX_CONTEXT_POINTS) return points;

  const keepIndexes = new Set<number>();
  const step = Math.ceil(points.length / MAX_CONTEXT_POINTS);
  for (let i = 0; i < points.length; i += step) keepIndexes.add(i);

  keepIndexes.add(0);
  keepIndexes.add(points.length - 1);

  const addNearestIndex = (target: Date | undefined) => {
    if (!target) return;
    const targetMs = target.getTime();
    let nearestIndex = 0;
    let nearestDiff = Infinity;

    points.forEach((point, index) => {
      const diff = Math.abs(new Date(point.timestamp).getTime() - targetMs);
      if (diff < nearestDiff) {
        nearestDiff = diff;
        nearestIndex = index;
      }
    });

    keepIndexes.add(nearestIndex);
  };

  addNearestIndex(anomalyStartsAt);
  addNearestIndex(anomalyEndsAt);

  let minVoltageIndex: number | null = null;
  let maxVoltageIndex: number | null = null;
  let minVoltage = Infinity;
  let maxVoltage = -Infinity;
  let minPowerIndex: number | null = null;
  let maxPowerIndex: number | null = null;
  let minPower = Infinity;
  let maxPower = -Infinity;

  points.forEach((point, index) => {
    if (point.voltage != null && point.voltage < minVoltage) {
      minVoltage = point.voltage;
      minVoltageIndex = index;
    }
    if (point.voltage != null && point.voltage > maxVoltage) {
      maxVoltage = point.voltage;
      maxVoltageIndex = index;
    }
    if (point.powerKw != null && point.powerKw < minPower) {
      minPower = point.powerKw;
      minPowerIndex = index;
    }
    if (point.powerKw != null && point.powerKw > maxPower) {
      maxPower = point.powerKw;
      maxPowerIndex = index;
    }
  });

  if (minVoltageIndex != null) keepIndexes.add(minVoltageIndex);
  if (maxVoltageIndex != null) keepIndexes.add(maxVoltageIndex);
  if (minPowerIndex != null) keepIndexes.add(minPowerIndex);
  if (maxPowerIndex != null) keepIndexes.add(maxPowerIndex);

  return [...keepIndexes].sort((a, b) => a - b).map((index) => points[index]);
}

export function unavailableEstimatedCost(
  startsAt: Date,
  endsAt: Date,
  message = 'Estimated cost is unavailable.',
): EstimatedCostResult {
  return {
    status: 'unavailable',
    currency: 'EUR',
    totalEur: 0,
    energyChargeEur: 0,
    fixedFeesEur: 0,
    breakdown: [
      {
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        pricingMode: 'UNCONFIGURED',
        energyChargeEur: 0,
        fixedFeesEur: 0,
        totalEur: 0,
        details: {
          message,
        },
      },
    ],
    missingCoveragePct: 100,
  };
}

export function parseCustomRange(startDate?: string, endDate?: string):
  | { startsAt: Date; endsAt: Date }
  | { error: { code: string; message: string } } {
  const parsedStart = parseOptionalDate(startDate, 'startDate');
  if (!parsedStart.ok || !parsedStart.value) {
    return {
      error: {
        code: 'INVALID_CUSTOM_RANGE',
        message: 'Custom period requires valid startDate and endDate',
      },
    };
  }

  const parsedEnd = parseOptionalDate(endDate, 'endDate');
  if (!parsedEnd.ok || !parsedEnd.value) {
    return {
      error: {
        code: 'INVALID_CUSTOM_RANGE',
        message: 'Custom period requires valid startDate and endDate',
      },
    };
  }

  const startsAt = parsedStart.value;
  const endsAt = parsedEnd.value;

  const validRange = validateAscendingRange(startsAt, endsAt, 'startDate', 'endDate');
  if (!validRange.ok) {
    return {
      error: {
        code: 'INVALID_CUSTOM_RANGE',
        message: 'endDate must be later than startDate',
      },
    };
  }

  const now = new Date();
  if (endsAt.getTime() > now.getTime()) {
    endsAt.setTime(now.getTime());
  }

  const rangeDays = (endsAt.getTime() - startsAt.getTime()) / MS_PER_DAY;
  if (rangeDays > MAX_CUSTOM_RANGE_DAYS) {
    return {
      error: {
        code: 'CUSTOM_RANGE_TOO_LONG',
        message: `Custom period must be at most ${MAX_CUSTOM_RANGE_DAYS} days`,
      },
    };
  }

  return { startsAt, endsAt };
}
