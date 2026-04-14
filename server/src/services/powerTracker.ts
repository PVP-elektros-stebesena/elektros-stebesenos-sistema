import type { EffectivePowerPolicy } from '../config/powerPolicy.js';
import {
  analysePowerReading,
  evaluatePowerPolicyBreaches,
  type PowerMetricName,
  type PowerPolicyBreach,
  type PowerReading,
  type PowerMetrics,
} from './powerAnalysis.js';

type ContinuousMetricName =
  | 'ACTIVE_POWER_TOTAL'
  | 'REACTIVE_POWER_TOTAL'
  | 'POWER_FACTOR'
  | 'PHASE_IMBALANCE';

type AnomalySeverity = 'WARNING' | 'CRITICAL';

interface OngoingState {
  ongoing: boolean;
  startedAt: Date | null;
  thresholdValue: number | null;
  observedMin: number;
  observedMax: number;
  observedSum: number;
  sampleCount: number;
  overloadDamage: number;
  lastOverloadRatio: number | null;
}

export interface DetectedPowerAnomaly {
  startedAt: Date;
  endedAt: Date | null;
  phase: 'ALL';
  type: string;
  severity: AnomalySeverity;
  metricName: PowerMetricName;
  thresholdValue: number | null;
  observedMin: number | null;
  observedMax: number | null;
  observedAvg: number | null;
  unit: string | null;
  description: string;
}

const CONTINUOUS_METRICS: Record<
  ContinuousMetricName,
  { type: string; severity: AnomalySeverity; unit: string }
> = {
  ACTIVE_POWER_TOTAL: {
    type: 'POWER_SPIKE',
    severity: 'CRITICAL',
    unit: 'kW',
  },
  REACTIVE_POWER_TOTAL: {
    type: 'REACTIVE_POWER_SPIKE',
    severity: 'WARNING',
    unit: 'kVAr',
  },
  POWER_FACTOR: {
    type: 'LOW_POWER_FACTOR',
    severity: 'WARNING',
    unit: '%',
  },
  PHASE_IMBALANCE: {
    type: 'PHASE_IMBALANCE',
    severity: 'WARNING',
    unit: '%',
  },
};

// Breaker curve calibrated to match:
// - 110% load -> 30s allowable
// - 150% load -> 2s allowable
const BREAKER_CURVE_K = 0.6256889158;
const BREAKER_CURVE_N = 1.6826061945;
const BREAKER_CURVE_MIN_DENOMINATOR = 1e-6;

function metricValue(metrics: PowerMetrics, metricName: ContinuousMetricName): number | null {
  if (metricName === 'ACTIVE_POWER_TOTAL') return metrics.activePowerTotalKw;
  if (metricName === 'REACTIVE_POWER_TOTAL') {
    return metrics.reactivePowerTotalKvar == null ? null : Math.abs(metrics.reactivePowerTotalKvar);
  }
  if (metricName === 'POWER_FACTOR') return metrics.powerFactor;
  return metrics.phaseImbalancePct;
}

function round(value: number | null, decimals: number = 4): number | null {
  if (value == null) return null;
  const m = 10 ** decimals;
  return Math.round(value * m) / m;
}

function createInitialState(): OngoingState {
  return {
    ongoing: false,
    startedAt: null,
    thresholdValue: null,
    observedMin: Infinity,
    observedMax: -Infinity,
    observedSum: 0,
    sampleCount: 0,
    overloadDamage: 0,
    lastOverloadRatio: null,
  };
}

function allowedOverloadDurationSeconds(overloadRatio: number): number {
  if (!Number.isFinite(overloadRatio) || overloadRatio <= 1) {
    return Number.POSITIVE_INFINITY;
  }

  const denominator = Math.max(overloadRatio - 1, BREAKER_CURVE_MIN_DENOMINATOR);
  return BREAKER_CURVE_K / (denominator ** BREAKER_CURVE_N);
}

export class PowerTracker {
  private states: Record<ContinuousMetricName, OngoingState> = {
    ACTIVE_POWER_TOTAL: createInitialState(),
    REACTIVE_POWER_TOTAL: createInitialState(),
    POWER_FACTOR: createInitialState(),
    PHASE_IMBALANCE: createInitialState(),
  };

  private previous: { timestamp: Date; activePowerTotalKw: number | null } | null = null;

  processReading(reading: PowerReading, policy: EffectivePowerPolicy): DetectedPowerAnomaly[] {
    const metrics = analysePowerReading(reading);
    const breaches = evaluatePowerPolicyBreaches(
      metrics,
      policy,
      reading.timestamp,
      this.previous ?? undefined,
    );
    const breachByMetric = new Map(breaches.map((breach) => [breach.metricName, breach]));
    const anomalies: DetectedPowerAnomaly[] = [];

    for (const metricName of Object.keys(CONTINUOUS_METRICS) as ContinuousMetricName[]) {
      const cfg = CONTINUOUS_METRICS[metricName];
      const state = this.states[metricName];
      const currentValue = metricValue(metrics, metricName);
      const breach = breachByMetric.get(metricName);

      if (metricName === 'ACTIVE_POWER_TOTAL') {
        anomalies.push(...this.processActivePowerMetric({
          reading,
          policy,
          currentValue,
          breach,
          state,
          cfg,
        }));
        continue;
      }

      if (breach && currentValue != null) {
        if (!state.ongoing) {
          state.ongoing = true;
          state.startedAt = reading.timestamp;
          state.thresholdValue = breach.thresholdValue;
          state.observedMin = currentValue;
          state.observedMax = currentValue;
          state.observedSum = currentValue;
          state.sampleCount = 1;

          anomalies.push({
            startedAt: reading.timestamp,
            endedAt: null,
            phase: 'ALL',
            type: cfg.type,
            severity: cfg.severity,
            metricName,
            thresholdValue: breach.thresholdValue,
            observedMin: round(currentValue),
            observedMax: round(currentValue),
            observedAvg: round(currentValue),
            unit: cfg.unit,
            description: `${cfg.type} started`,
          });
        } else {
          state.observedMin = Math.min(state.observedMin, currentValue);
          state.observedMax = Math.max(state.observedMax, currentValue);
          state.observedSum += currentValue;
          state.sampleCount += 1;
        }
        continue;
      }

      if (state.ongoing && state.startedAt) {
        const observedAvg =
          state.sampleCount > 0 ? state.observedSum / state.sampleCount : null;

        anomalies.push({
          startedAt: state.startedAt,
          endedAt: reading.timestamp,
          phase: 'ALL',
          type: cfg.type,
          severity: cfg.severity,
          metricName,
          thresholdValue: state.thresholdValue,
          observedMin: round(state.observedMin),
          observedMax: round(state.observedMax),
          observedAvg: round(observedAvg),
          unit: cfg.unit,
          description: `${cfg.type} resolved`,
        });
      }

      this.states[metricName] = createInitialState();
    }

    const rampBreach = breachByMetric.get('ACTIVE_POWER_RAMP');
    if (rampBreach) {
      anomalies.push({
        startedAt: this.previous?.timestamp ?? reading.timestamp,
        endedAt: reading.timestamp,
        phase: 'ALL',
        type: 'POWER_RAMP_RATE',
        severity: 'WARNING',
        metricName: 'ACTIVE_POWER_RAMP',
        thresholdValue: rampBreach.thresholdValue,
        observedMin: round(rampBreach.observedValue),
        observedMax: round(rampBreach.observedValue),
        observedAvg: round(rampBreach.observedValue),
        unit: 'kW',
        description: 'Active power ramp threshold exceeded',
      });
    }

    this.previous = {
      timestamp: reading.timestamp,
      activePowerTotalKw: metrics.activePowerTotalKw,
    };

    return anomalies;
  }

  reset(): void {
    for (const metricName of Object.keys(this.states) as ContinuousMetricName[]) {
      this.states[metricName] = createInitialState();
    }
    this.previous = null;
  }

  private processActivePowerMetric(input: {
    reading: PowerReading;
    policy: EffectivePowerPolicy;
    currentValue: number | null;
    breach: PowerPolicyBreach | undefined;
    state: OngoingState;
    cfg: { type: string; severity: AnomalySeverity; unit: string };
  }): DetectedPowerAnomaly[] {
    const {
      reading,
      policy,
      currentValue,
      breach,
      state,
      cfg,
    } = input;

    const anomalies: DetectedPowerAnomaly[] = [];
    const elapsedSeconds = this.previous
      ? Math.max(0, (reading.timestamp.getTime() - this.previous.timestamp.getTime()) / 1000)
      : 0;

    if (state.lastOverloadRatio != null && elapsedSeconds > 0) {
      const allowedSeconds = allowedOverloadDurationSeconds(state.lastOverloadRatio);
      if (Number.isFinite(allowedSeconds) && allowedSeconds > 0) {
        state.overloadDamage += elapsedSeconds / allowedSeconds;
      }
    }

    this.maybeStartActivePowerCritical(state, cfg, anomalies);

    if (breach && currentValue != null) {
      if (!state.startedAt) {
        state.startedAt = reading.timestamp;
        state.thresholdValue = breach.thresholdValue;
        state.observedMin = currentValue;
        state.observedMax = currentValue;
        state.observedSum = currentValue;
        state.sampleCount = 1;
        state.overloadDamage = 0;
      } else {
        state.observedMin = Math.min(state.observedMin, currentValue);
        state.observedMax = Math.max(state.observedMax, currentValue);
        state.observedSum += currentValue;
        state.sampleCount += 1;
      }

      const overloadRatio = currentValue / Math.max(policy.maxActivePowerKw, BREAKER_CURVE_MIN_DENOMINATOR);
      state.lastOverloadRatio = overloadRatio > 1 ? overloadRatio : null;

      this.maybeStartActivePowerCritical(state, cfg, anomalies);

      return anomalies;
    }

    state.lastOverloadRatio = null;

    if (state.ongoing && state.startedAt) {
      anomalies.push(
        this.createActivePowerAnomaly(
          state.startedAt,
          state,
          cfg,
          reading.timestamp,
          'POWER_SPIKE resolved',
        ),
      );
    }

    this.states.ACTIVE_POWER_TOTAL = createInitialState();
    return anomalies;
  }

  private maybeStartActivePowerCritical(
    state: OngoingState,
    cfg: { type: string; severity: AnomalySeverity; unit: string },
    anomalies: DetectedPowerAnomaly[],
  ): void {
    if (state.ongoing || !state.startedAt || state.overloadDamage < 1) {
      return;
    }

    anomalies.push(
      this.createActivePowerAnomaly(
        state.startedAt,
        state,
        cfg,
        null,
        'POWER_SPIKE started (breaker curve exceeded)',
      ),
    );
    state.ongoing = true;
  }

  private createActivePowerAnomaly(
    startedAt: Date,
    state: OngoingState,
    cfg: { type: string; severity: AnomalySeverity; unit: string },
    endedAt: Date | null,
    description: string,
  ): DetectedPowerAnomaly {
    const observedAvg = state.sampleCount > 0 ? state.observedSum / state.sampleCount : null;

    return {
      startedAt,
      endedAt,
      phase: 'ALL',
      type: cfg.type,
      severity: cfg.severity,
      metricName: 'ACTIVE_POWER_TOTAL',
      thresholdValue: state.thresholdValue,
      observedMin: round(state.observedMin),
      observedMax: round(state.observedMax),
      observedAvg: round(observedAvg),
      unit: cfg.unit,
      description,
    };
  }
}
