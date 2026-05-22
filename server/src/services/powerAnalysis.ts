import { getWindowEnd } from './voltageAnalysis.js';
import { ESO } from '../config/eso.js';
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
  severity: 'WARNING' | 'CRITICAL';
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

export interface PhaseImbalanceWindow {
  powerImbalancePct: number | null;
  activePowerAvgL1: number | null;
  activePowerAvgL2: number | null;
  activePowerAvgL3: number | null;
}

const EPS = 1e-6;
const PHASE_IMBALANCE_THRESHOLD_PCT = 30;
const MIN_PHASE_IMBALANCE_WINDOWS = 3;

function isCommercialScalePolicy(policy: EffectivePowerPolicy): boolean {
  return policy.category === 'COMMERCIAL' ||
    policy.maxGridCapacityKw >= ESO.REACTIVE_PENALTY.ELIGIBLE_MIN_GRID_CAPACITY_KW;
}

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

function resolveHeaviestPhase(window: PhaseImbalanceWindow): {
  phase: 'L1' | 'L2' | 'L3';
  sharePct: number;
} | null {
  const l1 = window.activePowerAvgL1;
  const l2 = window.activePowerAvgL2;
  const l3 = window.activePowerAvgL3;

  if (l1 == null || l2 == null || l3 == null) return null;

  const absL1 = Math.abs(l1);
  const absL2 = Math.abs(l2);
  const absL3 = Math.abs(l3);
  const total = absL1 + absL2 + absL3;

  if (total <= EPS) return null;

  const maxValue = Math.max(absL1, absL2, absL3);

  const isTie = [absL1, absL2, absL3]
    .filter((value) => Math.abs(value - maxValue) <= EPS).length > 1;

  if (isTie) return null;

  const phase = maxValue === absL1 ? 'L1' : maxValue === absL2 ? 'L2' : 'L3';
  const sharePct = (maxValue / total) * 100;

  return { phase, sharePct };
}

function round(value: number | null, decimals: number = 4): number | null {
  if (value == null) return null;
  const m = 10 ** decimals;
  return Math.round(value * m) / m;
}

const MIN_PHASE_IMBALANCE_TOTAL_ACTIVE_POWER_KW = 1.0;
const HOME_PHASE_IMBALANCE_MIN_LOAD_SHARE = 1 / 3;

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

  const total = values.reduce((sum, value) => sum + value, 0);
  if (total < MIN_PHASE_IMBALANCE_TOTAL_ACTIVE_POWER_KW) {
    return 0;
  }

  const totalDeviation = values
    .map((value) => Math.abs(value - avg))
    .reduce((sum, value) => sum + value, 0);

  const imbalancePct = (totalDeviation / 2 / avg) * 100;
  return imbalancePct;
}

function phaseActivePowerTotalKw(metrics: PowerMetrics): number | null {
  const phaseValues = [
    metrics.activePowerL1Kw,
    metrics.activePowerL2Kw,
    metrics.activePowerL3Kw,
  ].filter((value): value is number => value != null);

  if (phaseValues.length < 2) return null;
  return phaseValues.reduce((sum, value) => sum + Math.abs(value), 0);
}

function phaseImbalanceAlertLoadKw(metrics: PowerMetrics, policy: EffectivePowerPolicy): number | null {
  if (policy.category === 'HOME' && metrics.activePowerTotalKw != null) {
    return Math.abs(metrics.activePowerTotalKw);
  }

  return phaseActivePowerTotalKw(metrics) ??
    (metrics.activePowerTotalKw == null ? null : Math.abs(metrics.activePowerTotalKw));
}

function phaseImbalanceMinAlertLoadKw(policy: EffectivePowerPolicy): number {
  if (policy.category !== 'HOME') return MIN_PHASE_IMBALANCE_TOTAL_ACTIVE_POWER_KW;

  return Math.max(
    MIN_PHASE_IMBALANCE_TOTAL_ACTIVE_POWER_KW,
    policy.maxGridCapacityKw * HOME_PHASE_IMBALANCE_MIN_LOAD_SHARE,
  );
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

  const derivedApparentPowerTotalKva = (
    activePowerTotalKw != null &&
    reactivePowerTotalKvar != null
  )
    ? Math.sqrt((activePowerTotalKw ** 2) + (reactivePowerTotalKvar ** 2))
    : null;

  const resolvedApparentPowerTotalKva = (
    apparentPowerTotalKva != null &&
    Math.abs(apparentPowerTotalKva) > EPS
  )
    ? apparentPowerTotalKva
    : derivedApparentPowerTotalKva;

  const powerFactor = (
    activePowerTotalKw != null &&
    resolvedApparentPowerTotalKva != null &&
    Math.abs(resolvedApparentPowerTotalKva) > EPS
  )
    ? Math.min(1, Math.abs(activePowerTotalKw) / Math.abs(resolvedApparentPowerTotalKva))
    : null;

  return {
    activePowerTotalKw,
    reactivePowerTotalKvar,
    apparentPowerTotalKva: resolvedApparentPowerTotalKva,
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
    metrics.activePowerTotalKw > policy.criticalThreshold
  ) {
    breaches.push({
      metricName: 'ACTIVE_POWER_TOTAL',
      severity: 'CRITICAL',
      thresholdValue: policy.criticalThreshold,
      observedValue: metrics.activePowerTotalKw,
      unit: 'kW',
    });
  } else if (
    metrics.activePowerTotalKw != null &&
    metrics.activePowerTotalKw > policy.warningThreshold
  ) {
    breaches.push({
      metricName: 'ACTIVE_POWER_TOTAL',
      severity: 'WARNING',
      thresholdValue: policy.warningThreshold,
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
      severity: 'WARNING',
      thresholdValue: policy.maxReactivePowerKvar,
      observedValue: Math.abs(metrics.reactivePowerTotalKvar),
      unit: 'kVAr',
    });
  }

  if (
    metrics.powerFactor != null &&
    metrics.powerFactor < policy.minPowerFactor &&
    isCommercialScalePolicy(policy)
  ) {
    breaches.push({
      metricName: 'POWER_FACTOR',
      severity: 'WARNING',
      thresholdValue: policy.minPowerFactor,
      observedValue: metrics.powerFactor,
      unit: '%',
    });
  }

  if (
    policy.phaseCount === 3 &&
    metrics.phaseImbalancePct != null &&
    metrics.phaseImbalancePct > policy.maxPhaseImbalancePct &&
    (phaseImbalanceAlertLoadKw(metrics, policy) ?? 0) >= phaseImbalanceMinAlertLoadKw(policy)
  ) {
    breaches.push({
      metricName: 'PHASE_IMBALANCE',
      severity: 'WARNING',
      thresholdValue: policy.maxPhaseImbalancePct,
      observedValue: metrics.phaseImbalancePct,
      unit: '%',
    });
  }

  if (
    isCommercialScalePolicy(policy) &&
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
          severity: 'WARNING',
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

export function buildPhaseImbalanceRecommendations(
  windows: PhaseImbalanceWindow[],
  policy?: Pick<EffectivePowerPolicy, 'phaseCount' | 'maxPhaseImbalancePct'> | null,
): string[] {
  if (policy?.phaseCount != null && policy.phaseCount !== 3) return [];

  const withImbalance = windows.filter((window) => window.powerImbalancePct != null);
  if (withImbalance.length < MIN_PHASE_IMBALANCE_WINDOWS) return [];

  const thresholdPct = policy?.maxPhaseImbalancePct ?? PHASE_IMBALANCE_THRESHOLD_PCT;
  const consistentlyImbalanced = withImbalance.every((window) =>
    (window.powerImbalancePct ?? 0) > thresholdPct,
  );

  if (!consistentlyImbalanced) return [];

  const heaviest = withImbalance.map(resolveHeaviestPhase);
  if (heaviest.some((value) => value == null)) return [];

  const resolved = heaviest.filter((value): value is NonNullable<typeof value> => value != null);
  if (resolved.length < MIN_PHASE_IMBALANCE_WINDOWS) return [];

  const dominantPhase = resolved[0]?.phase;
  if (!dominantPhase) return [];

  const samePhase = resolved.every((value) => value.phase === dominantPhase);
  if (!samePhase) return [];

  const averageSharePct = resolved.reduce((sum, value) => sum + value.sharePct, 0) / resolved.length;
  const roundedSharePct = Math.round(averageSharePct);

  const alternatePhases = dominantPhase === 'L1'
    ? 'L2 or L3'
    : dominantPhase === 'L2'
      ? 'L1 or L3'
      : 'L1 or L2';

  return [
    `Phase ${dominantPhase} carries ${roundedSharePct}% of your load. Consider moving single-phase appliances to ${alternatePhases}.`,
  ];
}
