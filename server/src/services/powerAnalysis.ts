import { getWindowEnd } from './voltageAnalysis.js';
import type { EffectivePowerPolicy } from '../config/powerPolicy.js';

export type PowerMetricName =
  | 'ACTIVE_POWER_TOTAL'
  | 'REACTIVE_POWER_TOTAL'
  | 'POWER_FACTOR'
  | 'PHASE_IMBALANCE'
  | 'ACTIVE_POWER_RAMP';

export interface PowerReading {
  timestamp: Date;
  activePowerTotalKw: number | null;
  activePowerL1Kw: number | null;
  activePowerL2Kw: number | null;
  activePowerL3Kw: number | null;
  reactivePowerL1Kvar: number | null;
  reactivePowerL2Kvar: number | null;
  reactivePowerL3Kvar: number | null;
  apparentPowerTotalKva: number | null;
  apparentPowerL1Kva: number | null;
  apparentPowerL2Kva: number | null;
  apparentPowerL3Kva: number | null;
}

export interface PowerMetrics {
  activePowerTotalKw: number | null;
  reactivePowerTotalKvar: number | null;
  apparentPowerTotalKva: number | null;
  powerFactor: number | null;
  phaseImbalancePct: number | null;
  activePowerL1Kw: number | null;
  activePowerL2Kw: number | null;
  activePowerL3Kw: number | null;
  reactivePowerL1Kvar: number | null;
  reactivePowerL2Kvar: number | null;
  reactivePowerL3Kvar: number | null;
}

export interface PowerPolicyBreach {
  metricName: PowerMetricName;
  thresholdValue: number;
  observedValue: number;
  unit: 'kW' | 'kVAr' | '%';
}

export interface PowerWindowResult {
  windowStart: Date;
  windowEnd: Date;
  sampleCount: number;
  activePowerAvgTotal: number | null;
  activePowerMaxTotal: number | null;
  reactivePowerAvgTotal: number | null;
  reactivePowerMaxTotal: number | null;
  apparentPowerAvgTotal: number | null;
  apparentPowerMaxTotal: number | null;
  powerFactorAvg: number | null;
  activePowerAvgL1: number | null;
  activePowerAvgL2: number | null;
  activePowerAvgL3: number | null;
  reactivePowerAvgL1: number | null;
  reactivePowerAvgL2: number | null;
  reactivePowerAvgL3: number | null;
  powerImbalancePct: number | null;
  powerPolicyBreached: boolean;
}

const EPS = 1e-6;

function sumNullable(values: Array<number | null>): number | null {
  const filtered = values.filter((v): v is number => v != null);
  if (filtered.length === 0) return null;
  return filtered.reduce((sum, value) => sum + value, 0);
}

function avgNullable(values: Array<number | null>): number | null {
  const filtered = values.filter((v): v is number => v != null);
  if (filtered.length === 0) return null;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function maxNullable(values: Array<number | null>): number | null {
  const filtered = values.filter((v): v is number => v != null);
  if (filtered.length === 0) return null;
  return Math.max(...filtered);
}

function round(value: number | null, decimals: number = 4): number | null {
  if (value == null) return null;
  const m = 10 ** decimals;
  return Math.round(value * m) / m;
}

function computePhaseImbalancePct(
  activePowerL1Kw: number | null,
  activePowerL2Kw: number | null,
  activePowerL3Kw: number | null,
): number | null {
  const values = [activePowerL1Kw, activePowerL2Kw, activePowerL3Kw]
    .filter((v): v is number => v != null)
    .map((v) => Math.abs(v));

  if (values.length < 2) return null;

  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (avg <= EPS) return 0;

  const maxDelta = Math.max(...values.map((value) => Math.abs(value - avg)));
  return (maxDelta / avg) * 100;
}

export function analysePowerReading(reading: PowerReading): PowerMetrics {
  const reactivePowerTotalKvar = sumNullable([
    reading.reactivePowerL1Kvar,
    reading.reactivePowerL2Kvar,
    reading.reactivePowerL3Kvar,
  ]);

  const activePowerTotalKw = reading.activePowerTotalKw ?? sumNullable([
    reading.activePowerL1Kw,
    reading.activePowerL2Kw,
    reading.activePowerL3Kw,
  ]);

  const apparentPowerTotalKva = reading.apparentPowerTotalKva ?? sumNullable([
    reading.apparentPowerL1Kva,
    reading.apparentPowerL2Kva,
    reading.apparentPowerL3Kva,
  ]);

  const powerFactor = (
    activePowerTotalKw != null &&
    apparentPowerTotalKva != null &&
    Math.abs(apparentPowerTotalKva) > EPS
  )
    ? Math.min(1, Math.abs(activePowerTotalKw) / Math.abs(apparentPowerTotalKva))
    : null;

  return {
    activePowerTotalKw,
    reactivePowerTotalKvar,
    apparentPowerTotalKva,
    powerFactor,
    phaseImbalancePct: computePhaseImbalancePct(
      reading.activePowerL1Kw,
      reading.activePowerL2Kw,
      reading.activePowerL3Kw,
    ),
    activePowerL1Kw: reading.activePowerL1Kw,
    activePowerL2Kw: reading.activePowerL2Kw,
    activePowerL3Kw: reading.activePowerL3Kw,
    reactivePowerL1Kvar: reading.reactivePowerL1Kvar,
    reactivePowerL2Kvar: reading.reactivePowerL2Kvar,
    reactivePowerL3Kvar: reading.reactivePowerL3Kvar,
  };
}

export function evaluatePowerPolicyBreaches(
  metrics: PowerMetrics,
  policy: EffectivePowerPolicy,
  currentTimestamp: Date,
  previous?: {
    timestamp: Date;
    activePowerTotalKw: number | null;
  },
): PowerPolicyBreach[] {
  const breaches: PowerPolicyBreach[] = [];

  if (
    metrics.activePowerTotalKw != null &&
    metrics.activePowerTotalKw > policy.maxActivePowerKw
  ) {
    breaches.push({
      metricName: 'ACTIVE_POWER_TOTAL',
      thresholdValue: policy.maxActivePowerKw,
      observedValue: metrics.activePowerTotalKw,
      unit: 'kW',
    });
  }

  if (
    metrics.reactivePowerTotalKvar != null &&
    Math.abs(metrics.reactivePowerTotalKvar) > policy.maxReactivePowerKvar
  ) {
    breaches.push({
      metricName: 'REACTIVE_POWER_TOTAL',
      thresholdValue: policy.maxReactivePowerKvar,
      observedValue: Math.abs(metrics.reactivePowerTotalKvar),
      unit: 'kVAr',
    });
  }

  if (
    metrics.powerFactor != null &&
    metrics.powerFactor < policy.minPowerFactor
  ) {
    breaches.push({
      metricName: 'POWER_FACTOR',
      thresholdValue: policy.minPowerFactor,
      observedValue: metrics.powerFactor,
      unit: '%',
    });
  }

  if (
    metrics.phaseImbalancePct != null &&
    metrics.phaseImbalancePct > policy.maxPhaseImbalancePct
  ) {
    breaches.push({
      metricName: 'PHASE_IMBALANCE',
      thresholdValue: policy.maxPhaseImbalancePct,
      observedValue: metrics.phaseImbalancePct,
      unit: '%',
    });
  }

  if (
    previous?.activePowerTotalKw != null &&
    metrics.activePowerTotalKw != null
  ) {
    const elapsedMinutes = (
      currentTimestamp.getTime() - previous.timestamp.getTime()
    ) / 60_000;

    if (elapsedMinutes > 0) {
      const rampKwPerMinute =
        Math.abs(metrics.activePowerTotalKw - previous.activePowerTotalKw) / elapsedMinutes;

      if (rampKwPerMinute > policy.maxRampKwPerMinute) {
        breaches.push({
          metricName: 'ACTIVE_POWER_RAMP',
          thresholdValue: policy.maxRampKwPerMinute,
          observedValue: rampKwPerMinute,
          unit: 'kW',
        });
      }
    }
  }

  return breaches;
}

export function aggregatePowerWindow(
  readings: PowerReading[],
  windowStart: Date,
  policy: EffectivePowerPolicy,
): PowerWindowResult {
  const windowEnd = getWindowEnd(windowStart);
  if (readings.length === 0) {
    return {
      windowStart,
      windowEnd,
      sampleCount: 0,
      activePowerAvgTotal: null,
      activePowerMaxTotal: null,
      reactivePowerAvgTotal: null,
      reactivePowerMaxTotal: null,
      apparentPowerAvgTotal: null,
      apparentPowerMaxTotal: null,
      powerFactorAvg: null,
      activePowerAvgL1: null,
      activePowerAvgL2: null,
      activePowerAvgL3: null,
      reactivePowerAvgL1: null,
      reactivePowerAvgL2: null,
      reactivePowerAvgL3: null,
      powerImbalancePct: null,
      powerPolicyBreached: false,
    };
  }

  const metrics = readings.map((reading) => analysePowerReading(reading));
  let hasPolicyBreach = false;
  let previous: { timestamp: Date; activePowerTotalKw: number | null } | undefined;

  readings.forEach((reading, index) => {
    const currentMetrics = metrics[index];
    const breaches = evaluatePowerPolicyBreaches(
      currentMetrics,
      policy,
      reading.timestamp,
      previous,
    );
    if (breaches.length > 0) hasPolicyBreach = true;

    previous = {
      timestamp: reading.timestamp,
      activePowerTotalKw: currentMetrics.activePowerTotalKw,
    };
  });

  return {
    windowStart,
    windowEnd,
    sampleCount: readings.length,
    activePowerAvgTotal: round(avgNullable(metrics.map((m) => m.activePowerTotalKw))),
    activePowerMaxTotal: round(maxNullable(metrics.map((m) => m.activePowerTotalKw))),
    reactivePowerAvgTotal: round(avgNullable(metrics.map((m) => m.reactivePowerTotalKvar))),
    reactivePowerMaxTotal: round(maxNullable(metrics.map((m) => m.reactivePowerTotalKvar))),
    apparentPowerAvgTotal: round(avgNullable(metrics.map((m) => m.apparentPowerTotalKva))),
    apparentPowerMaxTotal: round(maxNullable(metrics.map((m) => m.apparentPowerTotalKva))),
    powerFactorAvg: round(avgNullable(metrics.map((m) => m.powerFactor))),
    activePowerAvgL1: round(avgNullable(metrics.map((m) => m.activePowerL1Kw))),
    activePowerAvgL2: round(avgNullable(metrics.map((m) => m.activePowerL2Kw))),
    activePowerAvgL3: round(avgNullable(metrics.map((m) => m.activePowerL3Kw))),
    reactivePowerAvgL1: round(avgNullable(metrics.map((m) => m.reactivePowerL1Kvar))),
    reactivePowerAvgL2: round(avgNullable(metrics.map((m) => m.reactivePowerL2Kvar))),
    reactivePowerAvgL3: round(avgNullable(metrics.map((m) => m.reactivePowerL3Kvar))),
    powerImbalancePct: round(avgNullable(metrics.map((m) => m.phaseImbalancePct))),
    powerPolicyBreached: hasPolicyBreach,
  };
}
