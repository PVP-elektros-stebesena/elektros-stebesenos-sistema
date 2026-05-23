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

const OVER_CAPACITY_WARNING_THRESHOLD_RATIO = 0.95;
const OVER_CAPACITY_WARNING_DURATION_MS = 3 * 60 * 1000;
const OVER_CAPACITY_WARNING_TYPE = 'OVER_CAPACITY_WARNING';
const HOME_PHASE_IMBALANCE_WARNING_DURATION_MS = 60 * 1000;
const COMMERCIAL_PHASE_IMBALANCE_WARNING_DURATION_MS = 30 * 1000;

interface OngoingState {
  ongoing: boolean;
  triggered: boolean;
  startedAt: Date | null;
  severity: AnomalySeverity | null;
  thresholdValue: number | null;
  observedMin: number;
  observedMax: number;
  observedSum: number;
  sampleCount: number;
}

type OverCapacityState = OngoingState;

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

export interface DetectedExportOpportunity {
  startedAt: Date;
  detectedAt: Date;
  exportPowerKw: number;
  thresholdKw: number;
  sustainedMinutes: number;
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

const EXPORT_OPPORTUNITY_THRESHOLD_KW = 2.5;
const EXPORT_OPPORTUNITY_SUSTAINED_MS = 5 * 60 * 1000;

function metricValue(metrics: PowerMetrics, metricName: ContinuousMetricName): number | null {
  if (metricName === 'ACTIVE_POWER_TOTAL') return metrics.activePowerTotalKw;
  if (metricName === 'REACTIVE_POWER_TOTAL') {
    return metrics.reactivePowerTotalKvar == null ? null : Math.abs(metrics.reactivePowerTotalKvar);
  }
  if (metricName === 'POWER_FACTOR') return metrics.powerFactor;
  return metrics.phaseImbalancePct;
}

function phaseImbalanceWarningDurationMs(policy: EffectivePowerPolicy): number {
  return policy.category === 'COMMERCIAL'
    ? COMMERCIAL_PHASE_IMBALANCE_WARNING_DURATION_MS
    : HOME_PHASE_IMBALANCE_WARNING_DURATION_MS;
}

function round(value: number | null, decimals: number = 4): number | null {
  if (value == null) return null;
  const m = 10 ** decimals;
  return Math.round(value * m) / m;
}

function createInitialState(): OngoingState {
  return {
    ongoing: false,
    triggered: false,
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

  private overCapacityState: OverCapacityState = this.createInitialOverCapacityState();

  private previous: { timestamp: Date; activePowerTotalKw: number | null } | null = null;

  private exportOpportunity: {
    startedAt: Date | null;
    notified: boolean;
    peakExportKw: number;
  } = {
    startedAt: null,
    notified: false,
    peakExportKw: 0,
  };

  private pendingExportOpportunities: DetectedExportOpportunity[] = [];
  private phaseImbalanceSamples: Array<{ t: number; v: number }> = [];

  processReading(reading: PowerReading, policy: EffectivePowerPolicy): DetectedPowerAnomaly[] {
    const metrics = analysePowerReading(reading);
    this.trackExportOpportunity(reading.timestamp, metrics.activePowerTotalKw);
    const breaches = evaluatePowerPolicyBreaches(
      metrics,
      policy,
      reading.timestamp,
      this.previous ?? undefined,
    );
    const breachByMetric = new Map(breaches.map((breach) => [breach.metricName, breach]));
    const anomalies: DetectedPowerAnomaly[] = [];

    anomalies.push(...this.processOverCapacityWarning(metrics.activePowerTotalKw, reading.timestamp, policy));

    for (const metricName of Object.keys(CONTINUOUS_METRICS) as ContinuousMetricName[]) {
      const cfg = CONTINUOUS_METRICS[metricName];
      const state = this.states[metricName];
      let currentValue = metricValue(metrics, metricName);
      if (metricName === 'PHASE_IMBALANCE') {
        currentValue = this.getSmoothedPhaseImbalance(metrics.phaseImbalancePct, reading.timestamp, policy);
      }
      const breach = breachByMetric.get(metricName);
      const nextSeverity = breach?.severity ?? cfg.defaultSeverity;
      const debounceMs = this.continuousMetricDebounceMs(metricName, policy);

      if (breach && currentValue != null) {
        if (!state.ongoing) {
          this.startState(
            state,
            reading.timestamp,
            breach.thresholdValue,
            nextSeverity,
            currentValue,
            debounceMs === 0,
          );

          if (state.triggered) {
            anomalies.push(this.createAnomaly({
              metricName,
              startedAt: reading.timestamp,
              endedAt: null,
              cfg,
              state,
              description: `${cfg.type} started`,
            }));
          }
          continue;
        }

        if (state.severity !== nextSeverity) {
          if (state.triggered) {
            anomalies.push(this.createAnomaly({
              metricName,
              startedAt: state.startedAt ?? reading.timestamp,
              endedAt: reading.timestamp,
              cfg,
              state,
              description: `${cfg.type} resolved`,
            }));
          }

          this.startState(
            state,
            reading.timestamp,
            breach.thresholdValue,
            nextSeverity,
            currentValue,
            debounceMs === 0,
          );

          if (state.triggered) {
            anomalies.push(this.createAnomaly({
              metricName,
              startedAt: reading.timestamp,
              endedAt: null,
              cfg,
              state,
              description: `${cfg.type} started`,
            }));
          }
          continue;
        }

        state.observedMin = Math.min(state.observedMin, currentValue);
        state.observedMax = Math.max(state.observedMax, currentValue);
        state.observedSum += currentValue;
        state.sampleCount += 1;

        if (
          !state.triggered &&
          state.startedAt &&
          reading.timestamp.getTime() - state.startedAt.getTime() >= debounceMs
        ) {
          state.triggered = true;
          anomalies.push(this.createAnomaly({
            metricName,
            startedAt: state.startedAt,
            endedAt: null,
            cfg,
            state,
            description: `${cfg.type} started`,
          }));
        }
        continue;
      }

      if (state.ongoing && state.startedAt && state.triggered) {
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

  private smoothingWindowMs(policy: EffectivePowerPolicy): number {
    return policy.category === 'COMMERCIAL' ? 15_000 : 30_000;
  }

  private getSmoothedPhaseImbalance(
    sampleValue: number | null,
    timestamp: Date,
    policy: EffectivePowerPolicy,
  ): number | null {
    const t = timestamp.getTime();
    const windowMs = this.smoothingWindowMs(policy);

    if (sampleValue != null) {
      this.phaseImbalanceSamples.push({ t, v: sampleValue });
    }

    // drop old samples
    const cutoff = t - windowMs;
    while (this.phaseImbalanceSamples.length > 0 && this.phaseImbalanceSamples[0].t < cutoff) {
      this.phaseImbalanceSamples.shift();
    }

    const values = this.phaseImbalanceSamples.map((s) => s.v).filter((v): v is number => v != null);
    if (values.length === 0) return null;

    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    if (values.length % 2 === 1) return values[mid];
    return (values[mid - 1] + values[mid]) / 2;
  }

  drainExportOpportunities(): DetectedExportOpportunity[] {
    const opportunities = this.pendingExportOpportunities;
    this.pendingExportOpportunities = [];
    return opportunities;
  }

  reset(): void {
    for (const metricName of Object.keys(this.states) as ContinuousMetricName[]) {
      this.states[metricName] = createInitialState();
    }
    this.overCapacityState = this.createInitialOverCapacityState();
    this.previous = null;
    this.exportOpportunity = {
      startedAt: null,
      notified: false,
      peakExportKw: 0,
    };
    this.pendingExportOpportunities = [];
  }

  private trackExportOpportunity(timestamp: Date, activePowerTotalKw: number | null): void {
    const exportPowerKw = activePowerTotalKw != null && activePowerTotalKw < 0
      ? Math.abs(activePowerTotalKw)
      : 0;

    if (exportPowerKw <= EXPORT_OPPORTUNITY_THRESHOLD_KW) {
      this.exportOpportunity = {
        startedAt: null,
        notified: false,
        peakExportKw: 0,
      };
      return;
    }

    if (!this.exportOpportunity.startedAt) {
      this.exportOpportunity = {
        startedAt: timestamp,
        notified: false,
        peakExportKw: exportPowerKw,
      };
      return;
    }

    this.exportOpportunity.peakExportKw = Math.max(this.exportOpportunity.peakExportKw, exportPowerKw);
    const sustainedMs = timestamp.getTime() - this.exportOpportunity.startedAt.getTime();

    if (this.exportOpportunity.notified || sustainedMs < EXPORT_OPPORTUNITY_SUSTAINED_MS) {
      return;
    }

    this.exportOpportunity.notified = true;
    this.pendingExportOpportunities.push({
      startedAt: this.exportOpportunity.startedAt,
      detectedAt: timestamp,
      exportPowerKw: round(this.exportOpportunity.peakExportKw, 3) ?? exportPowerKw,
      thresholdKw: EXPORT_OPPORTUNITY_THRESHOLD_KW,
      sustainedMinutes: EXPORT_OPPORTUNITY_SUSTAINED_MS / 60_000,
    });
  }

  private createInitialOverCapacityState(): OverCapacityState {
    return {
      ...createInitialState(),
      triggered: false,
    };
  }

  private continuousMetricDebounceMs(
    metricName: ContinuousMetricName,
    policy: EffectivePowerPolicy,
  ): number {
    if (metricName === 'PHASE_IMBALANCE') {
      return phaseImbalanceWarningDurationMs(policy);
    }
    return 0;
  }

  private processOverCapacityWarning(
    activePowerTotalKw: number | null,
    timestamp: Date,
    policy: EffectivePowerPolicy,
  ): DetectedPowerAnomaly[] {
    const thresholdValue = policy.maxGridCapacityKw * OVER_CAPACITY_WARNING_THRESHOLD_RATIO;
    const state = this.overCapacityState;

    if (activePowerTotalKw == null || activePowerTotalKw <= thresholdValue) {
      if (state.ongoing && state.startedAt && state.triggered) {
        const resolved = this.createAnomaly({
          metricName: 'ACTIVE_POWER_TOTAL',
          startedAt: state.startedAt,
          endedAt: timestamp,
          cfg: {
            type: OVER_CAPACITY_WARNING_TYPE,
            defaultSeverity: 'WARNING',
            unit: 'kW',
          },
          state,
          description: 'Over-capacity warning resolved',
        });

        this.overCapacityState = this.createInitialOverCapacityState();
        return [resolved];
      }

      if (state.ongoing) {
        this.overCapacityState = this.createInitialOverCapacityState();
      }

      return [];
    }

    if (!state.ongoing) {
      this.startState(state, timestamp, thresholdValue, 'WARNING', activePowerTotalKw, false);
      this.overCapacityState = state;
      return [];
    }

    state.observedMin = Math.min(state.observedMin, activePowerTotalKw);
    state.observedMax = Math.max(state.observedMax, activePowerTotalKw);
    state.observedSum += activePowerTotalKw;
    state.sampleCount += 1;

    if (
      !state.triggered &&
      state.startedAt &&
      timestamp.getTime() - state.startedAt.getTime() > OVER_CAPACITY_WARNING_DURATION_MS
    ) {
      state.triggered = true;
      this.overCapacityState = state;

      return [this.createAnomaly({
        metricName: 'ACTIVE_POWER_TOTAL',
        startedAt: state.startedAt,
        endedAt: null,
        cfg: {
          type: OVER_CAPACITY_WARNING_TYPE,
          defaultSeverity: 'WARNING',
          unit: 'kW',
        },
        state,
        description: 'Over-capacity warning started',
      })];
    }

    this.overCapacityState = state;
    return [];
  }

  private startState(
    state: OngoingState,
    timestamp: Date,
    thresholdValue: number,
    severity: AnomalySeverity,
    currentValue: number,
    triggered: boolean = true,
  ): void {
    state.ongoing = true;
    state.triggered = triggered;
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
