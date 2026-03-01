import { describe, it, expect } from 'vitest';
import { toP1Response } from '../p1Response.js';
import type { ScenarioOutput } from '../scenarios.js';

const sampleOutput: ScenarioOutput = {
  l1: { voltage: 231.5, current: 5.2, powerDelivered: 1.204, powerReturned: 0 },
  l2: { voltage: 229.0, current: 4.8, powerDelivered: 1.099, powerReturned: 0 },
  l3: { voltage: 232.0, current: 5.5, powerDelivered: 1.276, powerReturned: 0 },
  frequency: 50.01,
};

describe('toP1Response', () => {
  it('returns all string values (matching real gateway format)', () => {
    const response = toP1Response(sampleOutput);
    for (const [key, val] of Object.entries(response)) {
      expect(typeof val).toBe('string');
    }
  });

  it('maps voltage values correctly', () => {
    const response = toP1Response(sampleOutput);
    expect(response.InstantaneousVoltageL1).toBe('231.500');
    expect(response.Voltage_l1).toBe('231.500');
    expect(response.InstantaneousVoltageL2).toBe('229.000');
    expect(response.InstantaneousVoltageL3).toBe('232.000');
  });

  it('maps current values correctly', () => {
    const response = toP1Response(sampleOutput);
    expect(response.InstantaneousCurrentL1).toBe('5.200');
    expect(response.Current_l2).toBe('4.800');
  });

  it('maps frequency correctly', () => {
    const response = toP1Response(sampleOutput);
    expect(response.Frequency).toBe('50.010');
  });

  it('calculates total power', () => {
    const response = toP1Response(sampleOutput);
    const expected = (1.204 + 1.099 + 1.276).toFixed(3);
    expect(response.PowerDelivered_total).toBe(expected);
  });

  it('includes gateway metadata', () => {
    const response = toP1Response(sampleOutput);
    expect(response.mac_address).toBe('78_42_1C_6D_1D_DC');
    expect(response.gateway_model).toContain('smartgateways');
    expect(response.Equipment_Id).toBe('MOCK-P1-METER-001');
  });

  it('handles zero voltage (interruption)', () => {
    const zeroOutput: ScenarioOutput = {
      l1: { voltage: 0, current: 0, powerDelivered: 0, powerReturned: 0 },
      l2: { voltage: 0, current: 0, powerDelivered: 0, powerReturned: 0 },
      l3: { voltage: 0, current: 0, powerDelivered: 0, powerReturned: 0 },
      frequency: 0,
    };
    const response = toP1Response(zeroOutput);
    expect(response.InstantaneousVoltageL1).toBe('0.000');
    expect(response.PowerDelivered_total).toBe('0.000');
  });
});
