import { describe, it, expect } from 'vitest';
import {
  isVoltageInBounds,
  isVoltageZero,
  analyseVoltage,
  analyseReading,
  calculateRms,
  getWindowStart,
  getWindowEnd,
  aggregateWindow,
  classifyInterruption,
  calculateWeeklyCompliance,
  type VoltageReading,
  type RmsWindowResult,
} from '../voltageAnalysis.js';

// isVoltageInBounds

describe('isVoltageInBounds', () => {
  it('returns true for voltage exactly at lower bound (220V)', () => {
    expect(isVoltageInBounds(220)).toBe(true);
  });

  it('returns true for voltage exactly at upper bound (240V)', () => {
    expect(isVoltageInBounds(240)).toBe(true);
  });

  it('returns true for nominal voltage (230V)', () => {
    expect(isVoltageInBounds(230)).toBe(true);
  });

  it('returns false for voltage below lower bound', () => {
    expect(isVoltageInBounds(219.9)).toBe(false);
  });

  it('returns false for voltage above upper bound', () => {
    expect(isVoltageInBounds(240.1)).toBe(false);
  });

  it('returns false for zero voltage', () => {
    expect(isVoltageInBounds(0)).toBe(false);
  });
});

// isVoltageZero

describe('isVoltageZero', () => {
  it('returns true for 0V', () => {
    expect(isVoltageZero(0)).toBe(true);
  });

  it('returns true for voltage below threshold (9V)', () => {
    expect(isVoltageZero(9)).toBe(true);
  });

  it('returns false for voltage at threshold (10V)', () => {
    expect(isVoltageZero(10)).toBe(false);
  });

  it('returns false for normal voltage', () => {
    expect(isVoltageZero(230)).toBe(false);
  });
});

// analyseVoltage

describe('analyseVoltage', () => {
  it('correctly analyses normal voltage', () => {
    const result = analyseVoltage(232.5, 'L1');
    expect(result.inBounds).toBe(true);
    expect(result.isZero).toBe(false);
    expect(result.deviation).toBeCloseTo(2.5);
    expect(result.nominal).toBe(230);
  });

  it('correctly analyses zero voltage', () => {
    const result = analyseVoltage(0, 'L2');
    expect(result.inBounds).toBe(false);
    expect(result.isZero).toBe(true);
    expect(result.phase).toBe('L2');
  });

  it('correctly analyses out-of-bounds voltage', () => {
    const result = analyseVoltage(245, 'L3');
    expect(result.inBounds).toBe(false);
    expect(result.isZero).toBe(false);
    expect(result.deviation).toBeCloseTo(15);
  });
});

// analyseReading

describe('analyseReading', () => {
  it('analyses all three phases', () => {
    const reading: VoltageReading = {
      timestamp: new Date(),
      voltage_l1: 230,
      voltage_l2: 0,
      voltage_l3: 250,
    };
    const results = analyseReading(reading);
    expect(results).toHaveLength(3);
    expect(results[0].inBounds).toBe(true);   // L1: 230
    expect(results[1].isZero).toBe(true);      // L2: 0
    expect(results[2].inBounds).toBe(false);   // L3: 250
  });
});

// calculateRms

describe('calculateRms', () => {
  it('returns 0 for empty array', () => {
    expect(calculateRms([])).toBe(0);
  });

  it('returns the value itself for a single sample', () => {
    expect(calculateRms([230])).toBeCloseTo(230);
  });

  it('calculates RMS correctly for uniform values', () => {
    // RMS of [230, 230, 230] = 230
    expect(calculateRms([230, 230, 230])).toBeCloseTo(230);
  });

  it('calculates RMS correctly for varying values', () => {
    // RMS of [220, 230, 240] = sqrt((220^2 + 230^2 + 240^2) / 3)
    const expected = Math.sqrt((220 ** 2 + 230 ** 2 + 240 ** 2) / 3);
    expect(calculateRms([220, 230, 240])).toBeCloseTo(expected);
  });

  it('RMS is always ≥ arithmetic mean for non-negative values', () => {
    const samples = [215, 225, 235, 245];
    const rms = calculateRms(samples);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(rms).toBeGreaterThanOrEqual(mean);
  });
});

// getWindowStart / getWindowEnd 

describe('getWindowStart', () => {
  it('floors to 10-minute boundary', () => {
    const d = new Date('2025-01-15T14:37:22Z');
    const ws = getWindowStart(d);
    expect(ws.getUTCMinutes()).toBe(30);
    expect(ws.getUTCSeconds()).toBe(0);
  });

  it('already on boundary stays the same', () => {
    const d = new Date('2025-01-15T14:40:00Z');
    const ws = getWindowStart(d);
    expect(ws.getUTCMinutes()).toBe(40);
  });

  it('handles midnight boundary', () => {
    const d = new Date('2025-01-15T00:03:00Z');
    const ws = getWindowStart(d);
    expect(ws.getUTCMinutes()).toBe(0);
    expect(ws.getUTCHours()).toBe(0);
  });
});

describe('getWindowEnd', () => {
  it('is exactly 10 minutes after start', () => {
    const ws = new Date('2025-01-15T14:30:00Z');
    const we = getWindowEnd(ws);
    expect(we.getTime() - ws.getTime()).toBe(600_000);
  });
});

// aggregateWindow

describe('aggregateWindow', () => {
  it('returns non-compliant for empty readings', () => {
    const ws = new Date('2025-01-15T14:30:00Z');
    const result = aggregateWindow([], ws);
    expect(result.sampleCount).toBe(0);
    expect(result.compliantL1).toBe(false);
  });

  it('returns compliant for all-normal readings', () => {
    const ws = new Date('2025-01-15T14:30:00Z');
    const readings: VoltageReading[] = Array.from({ length: 60 }, (_, i) => ({
      timestamp: new Date(ws.getTime() + i * 10_000),
      voltage_l1: 230,
      voltage_l2: 231,
      voltage_l3: 229,
    }));

    const result = aggregateWindow(readings, ws, 10);
    expect(result.sampleCount).toBe(60);
    expect(result.compliantL1).toBe(true);
    expect(result.compliantL2).toBe(true);
    expect(result.compliantL3).toBe(true);
    expect(result.outOfBoundsSecondsL1).toBe(0);
  });

  it('detects non-compliance when >5% is out of bounds', () => {
    const ws = new Date('2025-01-15T14:30:00Z');
    // 60 readings at 10s each = 600s window
    // 4 readings out of bounds = 40s > 30s threshold -> non-compliant
    const readings: VoltageReading[] = Array.from({ length: 60 }, (_, i) => ({
      timestamp: new Date(ws.getTime() + i * 10_000),
      voltage_l1: i < 4 ? 250 : 230,  // first 4 readings OOB
      voltage_l2: 230,
      voltage_l3: 230,
    }));

    const result = aggregateWindow(readings, ws, 10);
    expect(result.outOfBoundsSecondsL1).toBe(40);
    expect(result.compliantL1).toBe(false);
    expect(result.compliantL2).toBe(true);
  });

  it('marks compliant if exactly at 5% threshold', () => {
    const ws = new Date('2025-01-15T14:30:00Z');
    // 3 readings OOB x 10s = 30s = exactly 5% -> should be compliant (<= 30s)
    const readings: VoltageReading[] = Array.from({ length: 60 }, (_, i) => ({
      timestamp: new Date(ws.getTime() + i * 10_000),
      voltage_l1: i < 3 ? 250 : 230,
      voltage_l2: 230,
      voltage_l3: 230,
    }));

    const result = aggregateWindow(readings, ws, 10);
    expect(result.outOfBoundsSecondsL1).toBe(30);
    expect(result.compliantL1).toBe(true);
  });
});

// classifyInterruption

describe('classifyInterruption', () => {
  it('classifies >180s as LONG_INTERRUPTION / CRITICAL', () => {
    const result = classifyInterruption(181);
    expect(result.type).toBe('LONG_INTERRUPTION');
    expect(result.severity).toBe('CRITICAL');
  });

  it('classifies exactly 180s as SHORT_INTERRUPTION / WARNING', () => {
    const result = classifyInterruption(180);
    expect(result.type).toBe('SHORT_INTERRUPTION');
    expect(result.severity).toBe('WARNING');
  });

  it('classifies 10s as SHORT_INTERRUPTION / WARNING', () => {
    const result = classifyInterruption(10);
    expect(result.type).toBe('SHORT_INTERRUPTION');
    expect(result.severity).toBe('WARNING');
  });
});

// calculateWeeklyCompliance 

describe('calculateWeeklyCompliance', () => {
  const weekStart = new Date('2025-01-13T00:00:00Z'); // Monday

  it('returns non-compliant for empty windows', () => {
    const result = calculateWeeklyCompliance([], weekStart);
    expect(result.overallCompliant).toBe(false);
    expect(result.totalWindows).toBe(0);
  });

  it('returns compliant when all windows pass', () => {
    const windows: RmsWindowResult[] = Array.from({ length: 100 }, (_, i) => ({
      windowStart: new Date(weekStart.getTime() + i * 600_000),
      windowEnd: new Date(weekStart.getTime() + (i + 1) * 600_000),
      sampleCount: 60,
      rmsVoltageL1: 230,
      rmsVoltageL2: 230,
      rmsVoltageL3: 230,
      outOfBoundsSecondsL1: 0,
      outOfBoundsSecondsL2: 0,
      outOfBoundsSecondsL3: 0,
      compliantL1: true,
      compliantL2: true,
      compliantL3: true,
    }));

    const result = calculateWeeklyCompliance(windows, weekStart);
    expect(result.overallCompliant).toBe(true);
    expect(result.compliancePctL1).toBe(100);
  });

  it('returns non-compliant when <95% pass on one phase', () => {
    // 100 windows, 6 non-compliant on L1 = 94% -> fail
    const windows: RmsWindowResult[] = Array.from({ length: 100 }, (_, i) => ({
      windowStart: new Date(weekStart.getTime() + i * 600_000),
      windowEnd: new Date(weekStart.getTime() + (i + 1) * 600_000),
      sampleCount: 60,
      rmsVoltageL1: 230,
      rmsVoltageL2: 230,
      rmsVoltageL3: 230,
      outOfBoundsSecondsL1: 0,
      outOfBoundsSecondsL2: 0,
      outOfBoundsSecondsL3: 0,
      compliantL1: i >= 6, // first 6 fail
      compliantL2: true,
      compliantL3: true,
    }));

    const result = calculateWeeklyCompliance(windows, weekStart);
    expect(result.compliancePctL1).toBe(94);
    expect(result.overallCompliant).toBe(false);
  });

  it('returns compliant at exactly 95%', () => {
    // 100 windows, 5 non-compliant = 95% -> pass
    const windows: RmsWindowResult[] = Array.from({ length: 100 }, (_, i) => ({
      windowStart: new Date(weekStart.getTime() + i * 600_000),
      windowEnd: new Date(weekStart.getTime() + (i + 1) * 600_000),
      sampleCount: 60,
      rmsVoltageL1: 230,
      rmsVoltageL2: 230,
      rmsVoltageL3: 230,
      outOfBoundsSecondsL1: 0,
      outOfBoundsSecondsL2: 0,
      outOfBoundsSecondsL3: 0,
      compliantL1: i >= 5, // first 5 fail -> 95 pass
      compliantL2: true,
      compliantL3: true,
    }));

    const result = calculateWeeklyCompliance(windows, weekStart);
    expect(result.compliancePctL1).toBe(95);
    expect(result.overallCompliant).toBe(true);
  });
});