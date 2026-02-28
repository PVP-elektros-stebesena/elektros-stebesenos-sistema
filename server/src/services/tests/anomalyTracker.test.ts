import { describe, it, expect, beforeEach } from 'vitest';
import { AnomalyTracker } from '../anomalyTracker.js';
import type { VoltageReading } from '../voltageAnalysis.js';

function makeReading(
  voltage: number,
  timestamp: Date,
  opts?: { l2?: number; l3?: number },
): VoltageReading {
  return {
    timestamp,
    voltage_l1: voltage,
    voltage_l2: opts?.l2 ?? 230,
    voltage_l3: opts?.l3 ?? 230,
  };
}

describe('AnomalyTracker', () => {
  let tracker: AnomalyTracker;

  beforeEach(() => {
    tracker = new AnomalyTracker();
  });

  it('emits no anomalies for normal readings', () => {
    const t = new Date('2025-01-15T14:00:00Z');
    const anomalies = tracker.processReading(makeReading(230, t));
    expect(anomalies).toHaveLength(0);
  });

  it('detects a short interruption (<= 3 min)', () => {
    const t0 = new Date('2025-01-15T14:00:00Z');
    const t1 = new Date('2025-01-15T14:00:10Z');
    const t2 = new Date('2025-01-15T14:02:50Z'); // 170s later - still short
    const t3 = new Date('2025-01-15T14:03:00Z'); // recovery at 180s - exactly short

    // Voltage drops
    tracker.processReading(makeReading(0, t0));
    tracker.processReading(makeReading(0, t1));
    tracker.processReading(makeReading(0, t2));

    // Voltage recovers
    const anomalies = tracker.processReading(makeReading(231, t3));

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].type).toBe('SHORT_INTERRUPTION');
    expect(anomalies[0].severity).toBe('WARNING');
    expect(anomalies[0].phase).toBe('L1');
    expect(anomalies[0].durationSeconds).toBe(180);
  });

  it('detects a long interruption (> 3 min)', () => {
    const t0 = new Date('2025-01-15T14:00:00Z');
    const t1 = new Date('2025-01-15T14:03:01Z'); // 181s later

    tracker.processReading(makeReading(0, t0));
    const anomalies = tracker.processReading(makeReading(232, t1));

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].type).toBe('LONG_INTERRUPTION');
    expect(anomalies[0].severity).toBe('CRITICAL');
  });

  it('detects voltage deviation start and resolution', () => {
    const t0 = new Date('2025-01-15T14:00:00Z');
    const t1 = new Date('2025-01-15T14:00:10Z');
    const t2 = new Date('2025-01-15T14:00:20Z');

    // Deviation starts (245V > 240V)
    const a1 = tracker.processReading(makeReading(245, t0));
    expect(a1).toHaveLength(1);
    expect(a1[0].type).toBe('VOLTAGE_DEVIATION');
    expect(a1[0].endedAt).toBeNull();

    // Still out of bounds - no new anomaly
    const a2 = tracker.processReading(makeReading(248, t1));
    expect(a2).toHaveLength(0);

    // Back in bounds - deviation resolved
    const a3 = tracker.processReading(makeReading(230, t2));
    expect(a3).toHaveLength(1);
    expect(a3[0].type).toBe('VOLTAGE_DEVIATION');
    expect(a3[0].endedAt).toEqual(t2);
    expect(a3[0].voltageMin).toBe(245);
    expect(a3[0].voltageMax).toBe(248);
  });

  it('tracks multiple phases independently', () => {
    const t0 = new Date('2025-01-15T14:00:00Z');
    const t1 = new Date('2025-01-15T14:00:10Z');

    // L1 normal, L2 zero, L3 high
    const a1 = tracker.processReading({
      timestamp: t0,
      voltage_l1: 230,
      voltage_l2: 0,
      voltage_l3: 250,
    });

    // L3 should have a deviation
    const l3deviation = a1.find((a) => a.phase === 'L3');
    expect(l3deviation?.type).toBe('VOLTAGE_DEVIATION');

    // Now recover both
    const a2 = tracker.processReading({
      timestamp: t1,
      voltage_l1: 230,
      voltage_l2: 229,
      voltage_l3: 230,
    });

    const l2interruption = a2.find((a) => a.phase === 'L2');
    expect(l2interruption?.type).toBe('SHORT_INTERRUPTION');

    const l3resolved = a2.find((a) => a.phase === 'L3');
    expect(l3resolved?.type).toBe('VOLTAGE_DEVIATION');
    expect(l3resolved?.endedAt).toEqual(t1);
  });

  it('reports active anomalies via getActiveAnomalies()', () => {
    const t0 = new Date('2025-01-15T14:00:00Z');

    tracker.processReading(makeReading(0, t0));
    const active = tracker.getActiveAnomalies();

    expect(active).toHaveLength(1);
    expect(active[0].phase).toBe('L1');
    expect(active[0].type).toBe('interruption');
  });

  it('reset() clears all state', () => {
    const t0 = new Date('2025-01-15T14:00:00Z');

    tracker.processReading(makeReading(0, t0));
    expect(tracker.getActiveAnomalies()).toHaveLength(1);

    tracker.reset();
    expect(tracker.getActiveAnomalies()).toHaveLength(0);
  });
});