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

  it('allows short 150% spikes without alerting', () => {
    const t0 = new Date('2026-04-12T10:00:00Z');
    const t1 = new Date('2026-04-12T10:00:01Z');

    const a1 = getPowerSpikeAnomalies(tracker.processReading(makeReading(16.5, t0), policy));
    const a2 = getPowerSpikeAnomalies(tracker.processReading(makeReading(8, t1), policy));

    expect(a1).toHaveLength(0);
    expect(a2).toHaveLength(0);
  });

  it('triggers critical only after sustained overload on breaker curve', () => {
    const t0 = new Date('2026-04-12T10:00:00Z');
    const t1 = new Date('2026-04-12T10:00:01Z');
    const t2 = new Date('2026-04-12T10:00:02Z');
    expect(getPowerSpikeAnomalies(tracker.processReading(makeReading(16.5, t0), policy))).toHaveLength(0);
    expect(getPowerSpikeAnomalies(tracker.processReading(makeReading(16.5, t1), policy))).toHaveLength(0);

    const t3 = new Date('2026-04-12T10:00:03Z');
    const t4 = new Date('2026-04-12T10:00:04Z');

    const started = getPowerSpikeAnomalies(tracker.processReading(makeReading(16.5, t2), policy));
    expect(started).toHaveLength(0);

    const criticalStarted = getPowerSpikeAnomalies(tracker.processReading(makeReading(16.5, t3), policy));
    expect(criticalStarted).toHaveLength(1);
    expect(criticalStarted[0]).toEqual(expect.objectContaining({
      type: 'POWER_SPIKE',
      severity: 'CRITICAL',
      metricName: 'ACTIVE_POWER_TOTAL',
      startedAt: t0,
      endedAt: null,
    }));

    const resolved = getPowerSpikeAnomalies(tracker.processReading(makeReading(9, t4), policy));
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toEqual(expect.objectContaining({
      type: 'POWER_SPIKE',
      severity: 'CRITICAL',
      metricName: 'ACTIVE_POWER_TOTAL',
      startedAt: t0,
      endedAt: t4,
    }));
  });

  it('respects ~30s allowance around 110% load', () => {
    const t0 = new Date('2026-04-12T10:00:00Z');
    const t10 = new Date('2026-04-12T10:00:10Z');
    const t20 = new Date('2026-04-12T10:00:20Z');
    const t30 = new Date('2026-04-12T10:00:30Z');
    const t40 = new Date('2026-04-12T10:00:40Z');
    const t50 = new Date('2026-04-12T10:00:50Z');

    expect(getPowerSpikeAnomalies(tracker.processReading(makeReading(12.1, t0), policy))).toHaveLength(0);
    expect(getPowerSpikeAnomalies(tracker.processReading(makeReading(12.1, t10), policy))).toHaveLength(0);
    expect(getPowerSpikeAnomalies(tracker.processReading(makeReading(12.1, t20), policy))).toHaveLength(0);

    const stillAllowed = getPowerSpikeAnomalies(tracker.processReading(makeReading(12.1, t30), policy));
    expect(stillAllowed).toHaveLength(0);

    const started = getPowerSpikeAnomalies(tracker.processReading(makeReading(12.1, t40), policy));
    expect(started).toHaveLength(1);
    expect(started[0]).toEqual(expect.objectContaining({
      type: 'POWER_SPIKE',
      severity: 'CRITICAL',
      metricName: 'ACTIVE_POWER_TOTAL',
      startedAt: t0,
      endedAt: null,
    }));

    const resolved = getPowerSpikeAnomalies(tracker.processReading(makeReading(8, t50), policy));
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toEqual(expect.objectContaining({
      type: 'POWER_SPIKE',
      severity: 'CRITICAL',
      metricName: 'ACTIVE_POWER_TOTAL',
      startedAt: t0,
      endedAt: t50,
    }));
  });
});
