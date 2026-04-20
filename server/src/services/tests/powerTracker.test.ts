import { beforeEach, describe, expect, it } from 'vitest';
import { buildPresetPowerPolicy } from '../../config/powerPolicy.js';
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

describe('PowerTracker breaker curve handling', () => {
  let tracker: PowerTracker;
  const policy = buildPresetPowerPolicy('HOUSE_3P_11KW');

  beforeEach(() => {
    tracker = new PowerTracker();
  });

  function getPowerSpikeAnomalies(readingsAnomalies: ReturnType<PowerTracker['processReading']>) {
    return readingsAnomalies.filter((anomaly) => anomaly.type === 'POWER_SPIKE');
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
});
