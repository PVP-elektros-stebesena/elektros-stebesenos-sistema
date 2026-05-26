import { beforeEach, describe, expect, it } from 'vitest';
import { PowerProfilePreset, buildPresetPowerPolicy } from '../../config/powerPolicy.js';
import { PowerTracker } from '../powerTracker.js';
import type { PowerReading } from '../powerAnalysis.js';

function makeReading(activePowerTotalKw: number | null, timestamp: Date): PowerReading {
  return {
    timestamp,
    activePowerTotalKw,
    activePowerL1Kw: null,
    activePowerL2Kw: null,
    activePowerL3Kw: null,
    reactivePowerL1Kvar: null,
    reactivePowerL2Kvar: null,
    reactivePowerL3Kvar: null,
    apparentPowerTotalKva: activePowerTotalKw == null ? null : Math.abs(activePowerTotalKw) + 0.1,
    apparentPowerL1Kva: null,
    apparentPowerL2Kva: null,
    apparentPowerL3Kva: null,
  };
}

function makePhaseReading(
  activePowerL1Kw: number,
  activePowerL2Kw: number,
  activePowerL3Kw: number,
  timestamp: Date,
): PowerReading {
  const activePowerTotalKw = activePowerL1Kw + activePowerL2Kw + activePowerL3Kw;
  return {
    timestamp,
    activePowerTotalKw,
    activePowerL1Kw,
    activePowerL2Kw,
    activePowerL3Kw,
    reactivePowerL1Kvar: 0,
    reactivePowerL2Kvar: 0,
    reactivePowerL3Kvar: 0,
    apparentPowerTotalKva: Math.abs(activePowerTotalKw),
    apparentPowerL1Kva: Math.abs(activePowerL1Kw),
    apparentPowerL2Kva: Math.abs(activePowerL2Kw),
    apparentPowerL3Kva: Math.abs(activePowerL3Kw),
  };
}

describe('PowerTracker breaker curve handling', () => {
  let tracker: PowerTracker;
  const policy = buildPresetPowerPolicy('HOUSE_3P_11KW');

  beforeEach(() => {
    tracker = new PowerTracker();
  });

  function getPowerSpikeAnomalies(readingsAnomalies: ReturnType<PowerTracker['processReading']>) {
    return readingsAnomalies.filter((anomaly) => anomaly.type === 'POWER_SPIKE');
  }

  function getOverCapacityWarnings(readingsAnomalies: ReturnType<PowerTracker['processReading']>) {
    return readingsAnomalies.filter((anomaly) => anomaly.type === 'OVER_CAPACITY_WARNING');
  }

  function getPhaseImbalanceWarnings(readingsAnomalies: ReturnType<PowerTracker['processReading']>) {
    return readingsAnomalies.filter((anomaly) => anomaly.type === 'PHASE_IMBALANCE');
  }

  it('starts warning anomaly when active power exceeds warning threshold', () => {
    const t0 = new Date('2026-04-12T10:00:00Z');
    const t1 = new Date('2026-04-12T10:00:10Z');

    const started = getPowerSpikeAnomalies(tracker.processReading(makeReading(10.5, t0), policy));
    expect(started).toHaveLength(1);
    expect(started[0]).toEqual(expect.objectContaining({
      type: 'POWER_SPIKE',
      severity: 'WARNING',
      metricName: 'ACTIVE_POWER_TOTAL',
      startedAt: t0,
      endedAt: null,
    }));

    const resolved = getPowerSpikeAnomalies(tracker.processReading(makeReading(8.5, t1), policy));
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toEqual(expect.objectContaining({
      type: 'POWER_SPIKE',
      severity: 'WARNING',
      metricName: 'ACTIVE_POWER_TOTAL',
      startedAt: t0,
      endedAt: t1,
    }));
  });

  it('escalates from warning to critical when critical threshold is crossed', () => {
    const t0 = new Date('2026-04-12T10:00:00Z');
    const t1 = new Date('2026-04-12T10:00:01Z');
    const t2 = new Date('2026-04-12T10:00:02Z');
    expect(getPowerSpikeAnomalies(tracker.processReading(makeReading(10.4, t0), policy))).toHaveLength(1);
    expect(getPowerSpikeAnomalies(tracker.processReading(makeReading(10.6, t1), policy))).toHaveLength(0);

    const t4 = new Date('2026-04-12T10:00:04Z');

    const transitioned = getPowerSpikeAnomalies(tracker.processReading(makeReading(12, t2), policy));
    expect(transitioned).toHaveLength(2);
    expect(transitioned[0]).toEqual(expect.objectContaining({
      severity: 'WARNING',
      startedAt: t0,
      endedAt: t2,
    }));
    expect(transitioned[1]).toEqual(expect.objectContaining({
      severity: 'CRITICAL',
      startedAt: t2,
      endedAt: null,
    }));

    const resolved = getPowerSpikeAnomalies(tracker.processReading(makeReading(8.8, t4), policy));
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toEqual(expect.objectContaining({
      type: 'POWER_SPIKE',
      severity: 'CRITICAL',
      metricName: 'ACTIVE_POWER_TOTAL',
      startedAt: t2,
      endedAt: t4,
    }));
  });

  it('emits export opportunity after sustained negative active power', () => {
    const t0 = new Date('2026-04-12T10:00:00Z');
    const t1 = new Date('2026-04-12T10:04:59Z');
    const t2 = new Date('2026-04-12T10:05:00Z');

    tracker.processReading(makeReading(-2.8, t0), policy);
    tracker.processReading(makeReading(-3.1, t1), policy);
    expect(tracker.drainExportOpportunities()).toHaveLength(0);

    tracker.processReading(makeReading(-3.4, t2), policy);
    const opportunities = tracker.drainExportOpportunities();

    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toEqual(expect.objectContaining({
      startedAt: t0,
      detectedAt: t2,
      exportPowerKw: 3.4,
      thresholdKw: 2.5,
      sustainedMinutes: 5,
    }));

    tracker.processReading(makeReading(-3.2, new Date('2026-04-12T10:06:00Z')), policy);
    expect(tracker.drainExportOpportunities()).toHaveLength(0);
  });

  it('triggers an over-capacity warning only after sustained load above 95% of capacity', () => {
    const t0 = new Date('2026-04-12T10:00:00Z');
    const t1 = new Date('2026-04-12T10:01:00Z');
    const t2 = new Date('2026-04-12T10:02:00Z');
    const t3 = new Date('2026-04-12T10:03:01Z');
    const t4 = new Date('2026-04-12T10:04:00Z');

    expect(getOverCapacityWarnings(tracker.processReading(makeReading(10.6, t0), policy))).toHaveLength(0);
    expect(getOverCapacityWarnings(tracker.processReading(makeReading(10.7, t1), policy))).toHaveLength(0);
    expect(getOverCapacityWarnings(tracker.processReading(makeReading(10.8, t2), policy))).toHaveLength(0);

    const started = getOverCapacityWarnings(tracker.processReading(makeReading(10.9, t3), policy));
    expect(started).toHaveLength(1);
    expect(started[0]).toEqual(expect.objectContaining({
      type: 'OVER_CAPACITY_WARNING',
      severity: 'WARNING',
      metricName: 'ACTIVE_POWER_TOTAL',
      startedAt: t0,
      endedAt: null,
    }));

    const resolved = getOverCapacityWarnings(tracker.processReading(makeReading(8.8, t4), policy));
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toEqual(expect.objectContaining({
      type: 'OVER_CAPACITY_WARNING',
      severity: 'WARNING',
      metricName: 'ACTIVE_POWER_TOTAL',
      startedAt: t0,
      endedAt: t4,
    }));
  });

  it('debounces phase imbalance warnings for household profiles', () => {
    const t0 = new Date('2026-04-12T10:00:00Z');
    const t1 = new Date('2026-04-12T10:00:30Z');
    const t2 = new Date('2026-04-12T10:01:00Z');
    const t3 = new Date('2026-04-12T10:01:10Z');

    expect(getPhaseImbalanceWarnings(
      tracker.processReading(makePhaseReading(4, 0.2, 0.2, t0), policy),
    )).toHaveLength(0);
    expect(getPhaseImbalanceWarnings(
      tracker.processReading(makePhaseReading(4, 0.2, 0.2, t1), policy),
    )).toHaveLength(0);

    const started = getPhaseImbalanceWarnings(
      tracker.processReading(makePhaseReading(4, 0.2, 0.2, t2), policy),
    );
    expect(started).toHaveLength(1);
    expect(started[0]).toEqual(expect.objectContaining({
      type: 'PHASE_IMBALANCE',
      severity: 'WARNING',
      metricName: 'PHASE_IMBALANCE',
      startedAt: t0,
      endedAt: null,
    }));

    const resolved = getPhaseImbalanceWarnings(
      tracker.processReading(makePhaseReading(1, 1, 1, t3), policy),
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toEqual(expect.objectContaining({
      type: 'PHASE_IMBALANCE',
      startedAt: t0,
      endedAt: t3,
    }));
  });

  it('does not emit phase imbalance if household load normalizes before debounce', () => {
    const t0 = new Date('2026-04-12T10:00:00Z');
    const t1 = new Date('2026-04-12T10:00:30Z');

    expect(getPhaseImbalanceWarnings(
      tracker.processReading(makePhaseReading(4, 0.2, 0.2, t0), policy),
    )).toHaveLength(0);
    expect(getPhaseImbalanceWarnings(
      tracker.processReading(makePhaseReading(1, 1, 1, t1), policy),
    )).toHaveLength(0);
  });

  it('uses a shorter phase imbalance debounce for commercial profiles', () => {
    const commercialPolicy = buildPresetPowerPolicy(PowerProfilePreset.COMMERCIAL_3P_30KW);
    const t0 = new Date('2026-04-12T10:00:00Z');
    const t1 = new Date('2026-04-12T10:00:29Z');
    const t2 = new Date('2026-04-12T10:00:30Z');

    expect(getPhaseImbalanceWarnings(
      tracker.processReading(makePhaseReading(4, 0.2, 0.2, t0), commercialPolicy),
    )).toHaveLength(0);
    expect(getPhaseImbalanceWarnings(
      tracker.processReading(makePhaseReading(4, 0.2, 0.2, t1), commercialPolicy),
    )).toHaveLength(0);

    const started = getPhaseImbalanceWarnings(
      tracker.processReading(makePhaseReading(4, 0.2, 0.2, t2), commercialPolicy),
    );
    expect(started).toHaveLength(1);
    expect(started[0]).toEqual(expect.objectContaining({
      type: 'PHASE_IMBALANCE',
      startedAt: t0,
      endedAt: null,
    }));
  });

  it('does not emit false phase-imbalance start when an out-of-order normal sample arrives', () => {
    const t0 = new Date('2026-04-12T10:00:00Z');
    const t1 = new Date('2026-04-12T10:00:40Z');
    const tLate = new Date('2026-04-12T10:00:20Z');

    expect(getPhaseImbalanceWarnings(
      tracker.processReading(makePhaseReading(4, 0.2, 0.2, t0), policy),
    )).toHaveLength(0);
    expect(getPhaseImbalanceWarnings(
      tracker.processReading(makePhaseReading(4, 0.2, 0.2, t1), policy),
    )).toHaveLength(0);

    const outOfOrderNormal = getPhaseImbalanceWarnings(
      tracker.processReading(makePhaseReading(1, 1, 1, tLate), policy),
    );
    expect(outOfOrderNormal).toHaveLength(0);
  });
});
