import type { EffectivePowerPolicy } from '../config/powerPolicy.js';
import {
  analysePowerReading,
  evaluatePowerPolicyBreaches,
  type PowerMetricName,
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
  severity: AnomalySeverity | null;
  thresholdValue: number | null;
  observedMin: number;
  observedMax: number;
  observedSum: number;
  sampleCount: number;
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
  { type: string; defaultSeverity: AnomalySeverity; unit: string }
> = {
  ACTIVE_POWER_TOTAL: {
    type: 'POWER_SPIKE',
    defaultSeverity: 'WARNING',
    unit: 'kW',
  },
  REACTIVE_POWER_TOTAL: {
    type: 'REACTIVE_POWER_SPIKE',
    defaultSeverity: 'WARNING',
    unit: 'kVAr',
  },
  POWER_FACTOR: {
    type: 'LOW_POWER_FACTOR',
    defaultSeverity: 'WARNING',
    unit: '%',
  },
  PHASE_IMBALANCE: {
    type: 'PHASE_IMBALANCE',
    defaultSeverity: 'WARNING',
    unit: '%',
  },
};

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
    severity: null,
    thresholdValue: null,
    observedMin: Infinity,
    observedMax: -Infinity,
    observedSum: 0,
    sampleCount: 0,
  };
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
      const nextSeverity = breach?.severity ?? cfg.defaultSeverity;

      if (breach && currentValue != null) {
        if (!state.ongoing) {
          this.startState(state, reading.timestamp, breach.thresholdValue, nextSeverity, currentValue);

          anomalies.push(this.createAnomaly({
            metricName,
            startedAt: reading.timestamp,
            endedAt: null,
            cfg,
            state,
            description: `${cfg.type} started`,
          }));
          continue;
        }

        if (state.severity !== nextSeverity) {
          anomalies.push(this.createAnomaly({
            metricName,
            startedAt: state.startedAt ?? reading.timestamp,
            endedAt: reading.timestamp,
            cfg,
            state,
            description: `${cfg.type} resolved`,
          }));

          this.startState(state, reading.timestamp, breach.thresholdValue, nextSeverity, currentValue);

          anomalies.push(this.createAnomaly({
            metricName,
            startedAt: reading.timestamp,
            endedAt: null,
            cfg,
            state,
            description: `${cfg.type} started`,
          }));
          continue;
        }

        state.observedMin = Math.min(state.observedMin, currentValue);
        state.observedMax = Math.max(state.observedMax, currentValue);
        state.observedSum += currentValue;
        state.sampleCount += 1;
        continue;
      }

      if (state.ongoing && state.startedAt) {
        anomalies.push(this.createAnomaly({
          metricName,
          startedAt: state.startedAt,
          endedAt: reading.timestamp,
          cfg,
          state,
          description: `${cfg.type} resolved`,
        }));
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
        severity: rampBreach.severity,
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
  private startState(
    state: OngoingState,
    timestamp: Date,
    thresholdValue: number,
    severity: AnomalySeverity,
    currentValue: number,
  ): void {
    state.ongoing = true;
    state.startedAt = timestamp;
    state.severity = severity;
    state.thresholdValue = thresholdValue;
    state.observedMin = currentValue;
    state.observedMax = currentValue;
    state.observedSum = currentValue;
    state.sampleCount = 1;
  }

  private createAnomaly(input: {
    metricName: ContinuousMetricName;
    startedAt: Date;
    endedAt: Date | null;
    cfg: { type: string; defaultSeverity: AnomalySeverity; unit: string };
    state: OngoingState;
    description: string;
  }): DetectedPowerAnomaly {
    const {
      metricName,
      startedAt,
      endedAt,
      cfg,
      state,
      description,
    } = input;

    const observedAvg = state.sampleCount > 0 ? state.observedSum / state.sampleCount : null;

    return {
      startedAt,
      endedAt,
      phase: 'ALL',
      type: cfg.type,
      severity: state.severity ?? cfg.defaultSeverity,
      metricName,
      thresholdValue: state.thresholdValue,
      observedMin: round(state.observedMin),
      observedMax: round(state.observedMax),
      observedAvg: round(observedAvg),
      unit: cfg.unit,
      description,
    };
  }
}
