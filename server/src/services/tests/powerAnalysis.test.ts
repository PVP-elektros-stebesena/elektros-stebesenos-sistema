import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POWER_POLICY,
  PowerProfilePreset,
  buildPresetPowerPolicy,
} from '../../config/powerPolicy.js';
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

  it('returns zero imbalance for low-load phase values', () => {
    const metrics = analysePowerReading(makeReading({
      activePowerL1Kw: 0.2,
      activePowerL2Kw: 0.3,
      activePowerL3Kw: 0.25,
      apparentPowerL1Kva: 0.3,
      apparentPowerL2Kva: 0.4,
      apparentPowerL3Kva: 0.35,
    }));

    expect(metrics.phaseImbalancePct).toBe(0);
  });

  it('derives apparent power and power factor from active and reactive totals when apparent power is zero', () => {
    const metrics = analysePowerReading(makeReading({
      activePowerTotalKw: -2.559,
      activePowerL1Kw: -0.799,
      activePowerL2Kw: -0.915,
      activePowerL3Kw: -0.845,
      reactivePowerL1Kvar: -0.085,
      reactivePowerL2Kvar: -0.03,
      reactivePowerL3Kvar: -0.015,
      apparentPowerTotalKva: 0,
      apparentPowerL1Kva: 0,
      apparentPowerL2Kva: 0,
      apparentPowerL3Kva: 0,
    }));

    expect(metrics.apparentPowerTotalKva).toBeCloseTo(2.5623, 4);
    expect(metrics.powerFactor).toBeCloseTo(0.9987, 4);
    expect(metrics.phaseImbalancePct).toBeCloseTo(7.2685, 4);
  });
});

describe('evaluatePowerPolicyBreaches', () => {
  it('detects active, reactive, and phase-imbalance breaches for home-scale policies', () => {
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
      expect.objectContaining({
        metricName: 'ACTIVE_POWER_TOTAL',
        observedValue: 15,
        severity: 'CRITICAL',
        thresholdValue: DEFAULT_POWER_POLICY.criticalThreshold,
      }),
      expect.objectContaining({ metricName: 'REACTIVE_POWER_TOTAL', observedValue: 9, severity: 'WARNING' }),
      expect.objectContaining({ metricName: 'PHASE_IMBALANCE', severity: 'WARNING' }),
    ]));
    expect(breaches).toHaveLength(3);
    expect(breaches.some((breach) => breach.metricName === 'POWER_FACTOR')).toBe(false);
    expect(breaches.some((breach) => breach.metricName === 'ACTIVE_POWER_RAMP')).toBe(false);
  });

  it('uses a higher phase-imbalance load gate for household and prosumer profiles', () => {
    const current = analysePowerReading(makeReading({
      activePowerTotalKw: 1.3,
      activePowerL1Kw: 1.1,
      activePowerL2Kw: 0.1,
      activePowerL3Kw: 0.1,
      reactivePowerL1Kvar: 0,
      reactivePowerL2Kvar: 0,
      reactivePowerL3Kvar: 0,
      apparentPowerTotalKva: 1.3,
    }, '2026-03-27T10:01:00.000Z'));

    expect(current.phaseImbalancePct).toBeGreaterThan(DEFAULT_POWER_POLICY.maxPhaseImbalancePct);
    expect(evaluatePowerPolicyBreaches(
      current,
      DEFAULT_POWER_POLICY,
      new Date('2026-03-27T10:01:00.000Z'),
    )).toEqual([]);

    const commercialPolicy = buildPresetPowerPolicy(PowerProfilePreset.COMMERCIAL_3P_30KW);
    expect(evaluatePowerPolicyBreaches(
      current,
      commercialPolicy,
      new Date('2026-03-27T10:01:00.000Z'),
    )).toEqual([
      expect.objectContaining({
        metricName: 'PHASE_IMBALANCE',
        severity: 'WARNING',
      }),
    ]);
  });

  it('does not flag borderline prosumer export imbalance under the solar profile threshold', () => {
    const current = analysePowerReading(makeReading({
      activePowerTotalKw: -3.919,
      activePowerL1Kw: -1.495,
      activePowerL2Kw: -1.521,
      activePowerL3Kw: -0.903,
      reactivePowerL1Kvar: 0,
      reactivePowerL2Kvar: 0,
      reactivePowerL3Kvar: 0,
      apparentPowerTotalKva: 4,
    }, '2026-05-23T08:17:29.000Z'));

    const homeBreaches = evaluatePowerPolicyBreaches(
      current,
      DEFAULT_POWER_POLICY,
      new Date('2026-05-23T08:17:29.000Z'),
    );
    const solarBreaches = evaluatePowerPolicyBreaches(
      current,
      buildPresetPowerPolicy(PowerProfilePreset.SOLAR_PROSUMER_3P_22KW),
      new Date('2026-05-23T08:17:29.000Z'),
    );

    expect(current.phaseImbalancePct).toBeCloseTo(30.8752, 4);
    expect(homeBreaches).toEqual([
      expect.objectContaining({ metricName: 'PHASE_IMBALANCE' }),
    ]);
    expect(solarBreaches).toEqual([]);
  });

  it('does not flag normal home phase imbalance below one phase share of the contract', () => {
    const current = analysePowerReading(makeReading({
      activePowerTotalKw: 3,
      activePowerL1Kw: 3,
      activePowerL2Kw: 0,
      activePowerL3Kw: 0,
      reactivePowerL1Kvar: 0,
      reactivePowerL2Kvar: 0,
      reactivePowerL3Kvar: 0,
      apparentPowerTotalKva: 3,
    }, '2026-03-27T10:01:00.000Z'));

    const breaches = evaluatePowerPolicyBreaches(
      current,
      DEFAULT_POWER_POLICY,
      new Date('2026-03-27T10:01:00.000Z'),
    );

    expect(current.phaseImbalancePct).toBeGreaterThan(DEFAULT_POWER_POLICY.maxPhaseImbalancePct);
    expect(breaches.some((breach) => breach.metricName === 'PHASE_IMBALANCE')).toBe(false);
  });

  it('does not flag home phase imbalance when the authoritative total load is idle-level', () => {
    const current = analysePowerReading(makeReading({
      activePowerTotalKw: 0.003,
      activePowerL1Kw: 2,
      activePowerL2Kw: 1,
      activePowerL3Kw: 0,
      reactivePowerL1Kvar: 0,
      reactivePowerL2Kvar: 0,
      reactivePowerL3Kvar: 0,
      apparentPowerTotalKva: 0.003,
      apparentPowerL1Kva: 2,
      apparentPowerL2Kva: 1,
      apparentPowerL3Kva: 0,
    }, '2026-03-27T10:01:00.000Z'));

    const breaches = evaluatePowerPolicyBreaches(
      current,
      DEFAULT_POWER_POLICY,
      new Date('2026-03-27T10:01:00.000Z'),
    );

    expect(current.phaseImbalancePct).toBeGreaterThan(DEFAULT_POWER_POLICY.maxPhaseImbalancePct);
    expect(breaches.some((breach) => breach.metricName === 'PHASE_IMBALANCE')).toBe(false);
  });

  it('flags home phase imbalance once load exceeds one phase share of the contract', () => {
    const current = analysePowerReading(makeReading({
      activePowerTotalKw: 4.2,
      activePowerL1Kw: 4.2,
      activePowerL2Kw: 0,
      activePowerL3Kw: 0,
      reactivePowerL1Kvar: 0,
      reactivePowerL2Kvar: 0,
      reactivePowerL3Kvar: 0,
      apparentPowerTotalKva: 4.2,
    }, '2026-03-27T10:01:00.000Z'));

    const breaches = evaluatePowerPolicyBreaches(
      current,
      DEFAULT_POWER_POLICY,
      new Date('2026-03-27T10:01:00.000Z'),
    );

    expect(breaches).toEqual(expect.arrayContaining([
      expect.objectContaining({ metricName: 'PHASE_IMBALANCE', severity: 'WARNING' }),
    ]));
  });

  it('detects low power factor only for commercial-scale policies', () => {
    const commercialPolicy = buildPresetPowerPolicy(PowerProfilePreset.COMMERCIAL_3P_30KW);
    const current = analysePowerReading(makeReading({
      activePowerTotalKw: 6,
      activePowerL1Kw: 2,
      activePowerL2Kw: 2,
      activePowerL3Kw: 2,
      reactivePowerL1Kvar: 0,
      reactivePowerL2Kvar: 0,
      reactivePowerL3Kvar: 0,
      apparentPowerTotalKva: 8,
    }, '2026-03-27T10:01:00.000Z'));

    const breaches = evaluatePowerPolicyBreaches(
      current,
      commercialPolicy,
      new Date('2026-03-27T10:01:00.000Z'),
    );

    expect(breaches).toEqual([
      expect.objectContaining({
        metricName: 'POWER_FACTOR',
        observedValue: 0.75,
        severity: 'WARNING',
      }),
    ]);
  });

  it('ignores low power factor and ramp rate for home-scale policies', () => {
    const current = analysePowerReading(makeReading({
      activePowerTotalKw: 8,
      activePowerL1Kw: 3,
      activePowerL2Kw: 3,
      activePowerL3Kw: 2,
      reactivePowerL1Kvar: 0,
      reactivePowerL2Kvar: 0,
      reactivePowerL3Kvar: 0,
      apparentPowerTotalKva: 11,
    }, '2026-03-27T10:01:00.000Z'));

    const breaches = evaluatePowerPolicyBreaches(
      current,
      DEFAULT_POWER_POLICY,
      new Date('2026-03-27T10:01:00.000Z'),
      {
        timestamp: new Date('2026-03-27T10:00:00.000Z'),
        activePowerTotalKw: 1,
      },
    );

    expect(breaches).toEqual([]);
  });

  it('detects ramp-rate breaches only for commercial-scale policies', () => {
    const commercialPolicy = buildPresetPowerPolicy(PowerProfilePreset.COMMERCIAL_3P_30KW);
    const current = analysePowerReading(makeReading({
      activePowerTotalKw: 15,
      activePowerL1Kw: 5,
      activePowerL2Kw: 5,
      activePowerL3Kw: 5,
      reactivePowerL1Kvar: 0,
      reactivePowerL2Kvar: 0,
      reactivePowerL3Kvar: 0,
      apparentPowerTotalKva: 15,
    }, '2026-03-27T10:01:00.000Z'));

    const breaches = evaluatePowerPolicyBreaches(
      current,
      commercialPolicy,
      new Date('2026-03-27T10:01:00.000Z'),
      {
        timestamp: new Date('2026-03-27T10:00:00.000Z'),
        activePowerTotalKw: 3,
      },
    );

    expect(breaches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metricName: 'ACTIVE_POWER_RAMP',
        observedValue: 12,
        severity: 'WARNING',
      }),
    ]));
  });

  it('does not flag phase imbalance for single-phase profiles', () => {
    const singlePhasePolicy = buildPresetPowerPolicy(PowerProfilePreset.APARTMENT_1P_5KW);
    const current = analysePowerReading(makeReading({
      activePowerTotalKw: 4.4,
      activePowerL1Kw: 4.4,
      activePowerL2Kw: 0,
      activePowerL3Kw: 0,
      reactivePowerL1Kvar: 0,
      reactivePowerL2Kvar: 0,
      reactivePowerL3Kvar: 0,
      apparentPowerTotalKva: 4.4,
    }, '2026-03-27T10:01:00.000Z'));

    const breaches = evaluatePowerPolicyBreaches(
      current,
      singlePhasePolicy,
      new Date('2026-03-27T10:01:00.000Z'),
    );

    expect(breaches).toEqual([]);
    expect(current.phaseImbalancePct).toBeGreaterThan(singlePhasePolicy.maxPhaseImbalancePct);
  });

  it('marks active power above warning threshold as warning', () => {
    const current = analysePowerReading(makeReading({
      activePowerTotalKw: 10.2,
      activePowerL1Kw: 3.4,
      activePowerL2Kw: 3.4,
      activePowerL3Kw: 3.4,
      reactivePowerL1Kvar: 0,
      reactivePowerL2Kvar: 0,
      reactivePowerL3Kvar: 0,
      apparentPowerTotalKva: 10.2,
    }, '2026-03-27T10:01:00.000Z'));

    const breaches = evaluatePowerPolicyBreaches(
      current,
      DEFAULT_POWER_POLICY,
      new Date('2026-03-27T10:01:00.000Z'),
    );

    expect(breaches).toEqual([
      expect.objectContaining({
        metricName: 'ACTIVE_POWER_TOTAL',
        severity: 'WARNING',
        thresholdValue: DEFAULT_POWER_POLICY.warningThreshold,
        observedValue: 10.2,
      }),
    ]);
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
