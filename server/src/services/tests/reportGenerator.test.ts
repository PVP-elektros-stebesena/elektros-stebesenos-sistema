import { describe, it, expect } from 'vitest';
import {
  computeHealthScore,
  getWeekStart,
  getMonthStart,
  getMonthEnd,
  resolvePresetPeriodRange,
  type HealthScore,
} from '../reportGenerator.js';
import type { WeeklyComplianceResult } from '../voltageAnalysis.js';

// Helper to build a compliance object

function makeCompliance(pctL1: number, pctL2: number, pctL3: number): WeeklyComplianceResult {
  const weekStart = new Date('2026-02-23T00:00:00Z');
  return {
    weekStart,
    weekEnd: new Date(weekStart.getTime() + 7 * 24 * 3600_000),
    totalWindows: 1008,
    compliantWindowsL1: Math.round((pctL1 / 100) * 1008),
    compliantWindowsL2: Math.round((pctL2 / 100) * 1008),
    compliantWindowsL3: Math.round((pctL3 / 100) * 1008),
    compliancePctL1: pctL1,
    compliancePctL2: pctL2,
    compliancePctL3: pctL3,
    overallCompliant: pctL1 >= 95 && pctL2 >= 95 && pctL3 >= 95,
  };
}

// computeHealthScore

describe('computeHealthScore', () => {
  it('returns GREEN when all phases >= 95% and no anomalies', () => {
    const compliance = makeCompliance(98, 97, 96);
    expect(computeHealthScore(compliance, [])).toBe('GREEN');
  });

  it('returns YELLOW when any phase is between 90-95%', () => {
    const compliance = makeCompliance(93, 97, 96);
    expect(computeHealthScore(compliance, [])).toBe('YELLOW');
  });

  it('returns YELLOW when compliance >= 95% but WARNING anomalies present', () => {
    const compliance = makeCompliance(98, 97, 96);
    const anomalies = [{ type: 'VOLTAGE_DEVIATION', severity: 'WARNING' }];
    expect(computeHealthScore(compliance, anomalies)).toBe('YELLOW');
  });

  it('returns RED when any phase < 90%', () => {
    const compliance = makeCompliance(88, 97, 96);
    expect(computeHealthScore(compliance, [])).toBe('RED');
  });

  it('returns RED when LONG_INTERRUPTION present regardless of compliance', () => {
    const compliance = makeCompliance(98, 97, 96);
    const anomalies = [{ type: 'LONG_INTERRUPTION', severity: 'CRITICAL' }];
    expect(computeHealthScore(compliance, anomalies)).toBe('RED');
  });

  it('returns RED when compliance < 90% AND anomalies present', () => {
    const compliance = makeCompliance(85, 85, 85);
    const anomalies = [{ type: 'LONG_INTERRUPTION', severity: 'CRITICAL' }];
    expect(computeHealthScore(compliance, anomalies)).toBe('RED');
  });

  it('returns YELLOW for CRITICAL anomalies without LONG_INTERRUPTION at good compliance', () => {
    // e.g. a SHORT_INTERRUPTION that is CRITICAL-ish - but per current logic,
    // SHORT_INTERRUPTION is severity=WARNING. Teest with a hypothetical CRITICAL non-LONG
    const compliance = makeCompliance(98, 97, 96);
    const anomalies = [{ type: 'SHORT_INTERRUPTION', severity: 'CRITICAL' }];
    expect(computeHealthScore(compliance, anomalies)).toBe('YELLOW');
  });

  it('returns GREEN at exactly 95% with no anomalies', () => {
    const compliance = makeCompliance(95, 95, 95);
    expect(computeHealthScore(compliance, [])).toBe('GREEN');
  });

  it('returns RED at exactly 89.99% on one phase', () => {
    const compliance = makeCompliance(89.99, 97, 96);
    expect(computeHealthScore(compliance, [])).toBe('RED');
  });
});

// getWeekStart 

describe('getWeekStart', () => {
  it('returns Monday 00:00 for a Wednesday', () => {
    // 2026-03-04 is a Wednesday
    const result = getWeekStart(new Date('2026-03-04T14:30:00'));
    expect(result.getDay()).toBe(1); // Monday
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
  });

  it('returns same Monday for a Monday', () => {
    // 2026-03-02 is a Monday
    const result = getWeekStart(new Date('2026-03-02T10:00:00'));
    expect(result.getDate()).toBe(2);
    expect(result.getDay()).toBe(1);
  });

  it('returns previous Monday for a Sunday', () => {
    // 2026-03-01 is a Sunday
    const result = getWeekStart(new Date('2026-03-01T10:00:00'));
    expect(result.getDay()).toBe(1); // Monday
    expect(result.getDate()).toBe(23); // Feb 23
  });
});

// getMonthStart / getMonthEnd

describe('getMonthStart', () => {
  it('returns first day of month at midnight', () => {
    const result = getMonthStart(new Date('2026-03-15T12:34:56'));
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(2); // March = 2
    expect(result.getDate()).toBe(1);
    expect(result.getHours()).toBe(0);
  });
});

describe('getMonthEnd', () => {
  it('returns first day of next month', () => {
    const result = getMonthEnd(new Date('2026-03-15T12:34:56'));
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(3); // April = 3
    expect(result.getDate()).toBe(1);
  });

  it('handles December → January correctly', () => {
    const result = getMonthEnd(new Date('2026-12-15T12:34:56'));
    expect(result.getFullYear()).toBe(2027);
    expect(result.getMonth()).toBe(0); // January = 0
    expect(result.getDate()).toBe(1);
  });
});

describe('resolvePresetPeriodRange', () => {
  const reference = new Date('2026-03-10T12:00:00Z');

  it('resolves daily range as a calendar day bucket', () => {
    const result = resolvePresetPeriodRange('daily', reference);
    expect(result.startsAt.getHours()).toBe(0);
    expect(result.startsAt.getMinutes()).toBe(0);
    expect(result.startsAt.getSeconds()).toBe(0);
    expect(result.startsAt.getMilliseconds()).toBe(0);
    expect(result.endsAt.getTime() - result.startsAt.getTime()).toBe(24 * 3600_000);
    expect(reference.getTime()).toBeGreaterThanOrEqual(result.startsAt.getTime());
    expect(reference.getTime()).toBeLessThan(result.endsAt.getTime());
  });

  it('resolves weekly range as Monday-Sunday bucket', () => {
    const result = resolvePresetPeriodRange('weekly', reference);
    expect(result.startsAt.getDay()).toBe(1);
    expect(result.endsAt.getTime() - result.startsAt.getTime()).toBe(7 * 24 * 3600_000);
    expect(reference.getTime()).toBeGreaterThanOrEqual(result.startsAt.getTime());
    expect(reference.getTime()).toBeLessThan(result.endsAt.getTime());
  });

  it('resolves biweekly range as deterministic two-week bucket', () => {
    const result = resolvePresetPeriodRange('biweekly', reference);
    expect(result.startsAt.getDay()).toBe(1);
    expect(result.endsAt.getTime() - result.startsAt.getTime()).toBe(14 * 24 * 3600_000);
    expect(reference.getTime()).toBeGreaterThanOrEqual(result.startsAt.getTime());
    expect(reference.getTime()).toBeLessThan(result.endsAt.getTime());
  });

  it('resolves monthly range as calendar month bucket', () => {
    const result = resolvePresetPeriodRange('monthly', reference);
    expect(result.startsAt.getDate()).toBe(1);
    expect(result.startsAt.getHours()).toBe(0);
    expect(result.endsAt.getDate()).toBe(1);
    expect(result.endsAt.getTime()).toBeGreaterThan(result.startsAt.getTime());
    expect(reference.getTime()).toBeGreaterThanOrEqual(result.startsAt.getTime());
    expect(reference.getTime()).toBeLessThan(result.endsAt.getTime());
  });
});
