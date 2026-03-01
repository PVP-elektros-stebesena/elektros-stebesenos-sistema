import { describe, it, expect } from 'vitest';
import {
  SCENARIOS,
  SCENARIO_NAMES,
  type ScenarioName,
  type ScenarioOutput,
} from '../scenarios.js';
import { ESO } from '../../config/eso.js';

describe('Scenario registry', () => {
  it('has all expected scenarios', () => {
    const expected: ScenarioName[] = [
      'normal', 'voltage-sag', 'voltage-swell',
      'short-interruption', 'long-interruption',
      'phase-l1-drop', 'phase-l2-swell',
      'brownout', 'fluctuating', 'borderline',
      'recovery', 'custom',
    ];
    for (const name of expected) {
      expect(SCENARIOS[name]).toBeDefined();
    }
  });

  it('SCENARIO_NAMES matches SCENARIOS keys', () => {
    expect(SCENARIO_NAMES.sort()).toEqual(Object.keys(SCENARIOS).sort());
  });
});

function validateOutput(output: ScenarioOutput) {
  expect(output.l1).toBeDefined();
  expect(output.l2).toBeDefined();
  expect(output.l3).toBeDefined();
  expect(output.frequency).toBeGreaterThan(0);

  for (const phase of [output.l1, output.l2, output.l3]) {
    expect(phase.voltage).toBeGreaterThanOrEqual(0);
    expect(phase.current).toBeGreaterThanOrEqual(0);
    expect(typeof phase.powerDelivered).toBe('number');
    expect(typeof phase.powerReturned).toBe('number');
  }
}

describe('normal scenario', () => {
  const scenario = SCENARIOS['normal'];

  it('generates voltages near 230V', () => {
    for (let i = 0; i < 20; i++) {
      const output = scenario.generate(i);
      validateOutput(output);
      expect(output.l1.voltage).toBeGreaterThan(225);
      expect(output.l1.voltage).toBeLessThan(235);
      expect(output.l2.voltage).toBeGreaterThan(225);
      expect(output.l2.voltage).toBeLessThan(235);
      expect(output.l3.voltage).toBeGreaterThan(225);
      expect(output.l3.voltage).toBeLessThan(235);
    }
  });

  it('generates frequency near 50Hz', () => {
    const output = scenario.generate(0);
    expect(output.frequency).toBeGreaterThan(49.9);
    expect(output.frequency).toBeLessThan(50.1);
  });
});

describe('voltage-sag scenario', () => {
  const scenario = SCENARIOS['voltage-sag'];

  it('generates voltages below ESO minimum (220V)', () => {
    for (let i = 0; i < 10; i++) {
      const output = scenario.generate(i);
      validateOutput(output);
      // All phases should be below 220V (with some noise tolerance)
      expect(output.l1.voltage).toBeLessThan(ESO.VOLTAGE_MIN_1PH);
      expect(output.l2.voltage).toBeLessThan(ESO.VOLTAGE_MIN_1PH);
    }
  });
});

describe('voltage-swell scenario', () => {
  const scenario = SCENARIOS['voltage-swell'];

  it('generates voltages above ESO maximum (240V)', () => {
    for (let i = 0; i < 10; i++) {
      const output = scenario.generate(i);
      validateOutput(output);
      expect(output.l1.voltage).toBeGreaterThan(ESO.VOLTAGE_MAX_1PH);
    }
  });
});

describe('short-interruption scenario', () => {
  const scenario = SCENARIOS['short-interruption'];

  it('produces zero voltage for initial ticks', () => {
    for (let i = 0; i < 6; i++) {
      const output = scenario.generate(i);
      expect(output.l1.voltage).toBe(0);
      expect(output.l2.voltage).toBe(0);
      expect(output.l3.voltage).toBe(0);
    }
  });

  it('recovers after interruption', () => {
    const output = scenario.generate(6);
    expect(output.l1.voltage).toBeGreaterThan(ESO.VOLTAGE_ZERO_THRESHOLD);
  });
});

describe('long-interruption scenario', () => {
  const scenario = SCENARIOS['long-interruption'];

  it('produces zero voltage for >18 ticks (>180s at 10s interval)', () => {
    for (let i = 0; i < 24; i++) {
      const output = scenario.generate(i);
      expect(output.l1.voltage).toBe(0);
      expect(output.l2.voltage).toBe(0);
      expect(output.l3.voltage).toBe(0);
    }
  });

  it('starts recovering after tick 24', () => {
    const output = scenario.generate(30);
    expect(output.l1.voltage).toBeGreaterThan(0);
  });
});

describe('phase-l1-drop scenario', () => {
  const scenario = SCENARIOS['phase-l1-drop'];

  it('L1 is low while L2 and L3 are normal', () => {
    for (let i = 0; i < 5; i++) {
      const output = scenario.generate(i);
      expect(output.l1.voltage).toBeLessThan(ESO.VOLTAGE_MIN_1PH);
      expect(output.l2.voltage).toBeGreaterThan(ESO.VOLTAGE_MIN_1PH);
      expect(output.l3.voltage).toBeGreaterThan(ESO.VOLTAGE_MIN_1PH);
    }
  });
});

describe('brownout scenario', () => {
  const scenario = SCENARIOS['brownout'];

  it('voltage decreases over time', () => {
    const first = scenario.generate(0);
    const later = scenario.generate(20);
    expect(later.l1.voltage).toBeLessThan(first.l1.voltage);
  });
});

describe('fluctuating scenario', () => {
  const scenario = SCENARIOS['fluctuating'];

  it('produces varying voltages across ticks', () => {
    const voltages: number[] = [];
    for (let i = 0; i < 30; i++) {
      voltages.push(scenario.generate(i).l1.voltage);
    }
    const min = Math.min(...voltages);
    const max = Math.max(...voltages);
    // Should have meaningful range (sine wave +-15V)
    expect(max - min).toBeGreaterThan(10);
  });
});

describe('recovery scenario', () => {
  const scenario = SCENARIOS['recovery'];

  it('starts near zero and ramps up to ~230V', () => {
    const start = scenario.generate(0);
    expect(start.l1.voltage).toBeLessThan(50);

    const end = scenario.generate(12);
    expect(end.l1.voltage).toBeGreaterThan(200);
  });
});
