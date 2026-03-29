import { describe, expect, it } from 'vitest';
import { DEFAULT_POWER_POLICY } from '../../config/powerPolicy.js';
import {
  aggregatePowerWindow,
  analysePowerReading,
  evaluatePowerPolicyBreaches,
  type PowerReading,
} from '../powerAnalysis.js';

function makeReading(
  overrides: Partial<PowerReading> = {},
  timestamp: string = '2026-03-27T10:00:00.000Z',
): PowerReading {
  return {
    timestamp: new Date(timestamp),
    activePowerTotalKw: null,
    activePowerL1Kw: 2,
    activePowerL2Kw: 2,
    activePowerL3Kw: 2,
    reactivePowerL1Kvar: 1,
    reactivePowerL2Kvar: 1,
    reactivePowerL3Kvar: 1,
    apparentPowerTotalKva: null,
    apparentPowerL1Kva: 2.5,
    apparentPowerL2Kva: 2.5,
    apparentPowerL3Kva: 2.5,
    ...overrides,
  };
}

describe('analysePowerReading', () => {
  it('derives totals, power factor, and imbalance from phase values when totals are missing', () => {
    const metrics = analysePowerReading(makeReading({
      activePowerL1Kw: 2,
      activePowerL2Kw: 3,
      activePowerL3Kw: 4,
      reactivePowerL1Kvar: 0.5,
      reactivePowerL2Kvar: 0.75,
      reactivePowerL3Kvar: 1,
      apparentPowerL1Kva: 2.5,
      apparentPowerL2Kva: 3.5,
      apparentPowerL3Kva: 4.5,
    }));

    expect(metrics.activePowerTotalKw).toBe(9);
    expect(metrics.reactivePowerTotalKvar).toBe(2.25);
    expect(metrics.apparentPowerTotalKva).toBe(10.5);
    expect(metrics.powerFactor).toBeCloseTo(0.8571, 4);
    expect(metrics.phaseImbalancePct).toBeCloseTo(33.3333, 4);
  });
});

describe('evaluatePowerPolicyBreaches', () => {
  it('detects active, reactive, power-factor, phase-imbalance, and ramp breaches', () => {
    const current = analysePowerReading(makeReading({
      activePowerTotalKw: 15,
      activePowerL1Kw: 8,
      activePowerL2Kw: 4,
      activePowerL3Kw: 3,
      reactivePowerL1Kvar: 4,
      reactivePowerL2Kvar: 3,
      reactivePowerL3Kvar: 2,
      apparentPowerTotalKva: 20,
    }, '2026-03-27T10:01:00.000Z'));

    const breaches = evaluatePowerPolicyBreaches(
      current,
      DEFAULT_POWER_POLICY,
      new Date('2026-03-27T10:01:00.000Z'),
      {
        timestamp: new Date('2026-03-27T10:00:00.000Z'),
        activePowerTotalKw: 3,
      },
    );

    expect(breaches).toEqual(expect.arrayContaining([
      expect.objectContaining({ metricName: 'ACTIVE_POWER_TOTAL', observedValue: 15 }),
      expect.objectContaining({ metricName: 'REACTIVE_POWER_TOTAL', observedValue: 9 }),
      expect.objectContaining({ metricName: 'POWER_FACTOR', observedValue: 0.75 }),
      expect.objectContaining({ metricName: 'PHASE_IMBALANCE' }),
      expect.objectContaining({ metricName: 'ACTIVE_POWER_RAMP', observedValue: 12 }),
    ]));
    expect(breaches).toHaveLength(5);
  });
});

describe('aggregatePowerWindow', () => {
  it('aggregates averages and flags breached windows when any sample breaks policy', () => {
    const windowStart = new Date('2026-03-27T10:00:00.000Z');
    const result = aggregatePowerWindow([
      makeReading({
        activePowerTotalKw: 3,
        activePowerL1Kw: 1,
        activePowerL2Kw: 1,
        activePowerL3Kw: 1,
        reactivePowerL1Kvar: 0.3,
        reactivePowerL2Kvar: 0.3,
        reactivePowerL3Kvar: 0.3,
        apparentPowerTotalKva: 3.3,
      }, '2026-03-27T10:00:00.000Z'),
      makeReading({
        activePowerTotalKw: 15,
        activePowerL1Kw: 8,
        activePowerL2Kw: 4,
        activePowerL3Kw: 3,
        reactivePowerL1Kvar: 4,
        reactivePowerL2Kvar: 3,
        reactivePowerL3Kvar: 2,
        apparentPowerTotalKva: 20,
      }, '2026-03-27T10:01:00.000Z'),
    ], windowStart, DEFAULT_POWER_POLICY);

    expect(result.windowStart).toEqual(windowStart);
    expect(result.sampleCount).toBe(2);
    expect(result.activePowerAvgTotal).toBe(9);
    expect(result.activePowerMaxTotal).toBe(15);
    expect(result.reactivePowerAvgTotal).toBe(4.95);
    expect(result.apparentPowerAvgTotal).toBe(11.65);
    expect(result.powerFactorAvg).toBeCloseTo(0.8295, 4);
    expect(result.activePowerAvgL1).toBe(4.5);
    expect(result.powerImbalancePct).toBe(30);
    expect(result.powerPolicyBreached).toBe(true);
  });
});
