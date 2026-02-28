import { ESO, type Phase, type AnomalyType, type Severity, PHASES } from '../config/eso.js';

// Input types

/** A single instantaneous reading from the P1 gateway */
export interface VoltageReading {
  timestamp: Date;
  voltage_l1: number;
  voltage_l2: number;
  voltage_l3: number;
}

// Output types 

export interface VoltageBoundsResult {
  phase: Phase;
  voltage: number;
  nominal: number;
  min: number;
  max: number;
  deviation: number;
  inBounds: boolean;
  isZero: boolean;
}

export interface RmsWindowResult {
  windowStart: Date;
  windowEnd: Date;
  sampleCount: number;
  rmsVoltageL1: number;
  rmsVoltageL2: number;
  rmsVoltageL3: number;
  outOfBoundsSecondsL1: number;
  outOfBoundsSecondsL2: number;
  outOfBoundsSecondsL3: number;
  compliantL1: boolean;
  compliantL2: boolean;
  compliantL3: boolean;
}

export interface DetectedAnomaly {
  startedAt: Date;
  endedAt: Date | null;
  phase: Phase;
  type: AnomalyType;
  severity: Severity;
  voltageMin: number | null;
  voltageMax: number | null;
  durationSeconds: number | null;
}

export interface WeeklyComplianceResult {
  weekStart: Date;
  weekEnd: Date;
  totalWindows: number;
  compliantWindowsL1: number;
  compliantWindowsL2: number;
  compliantWindowsL3: number;
  compliancePctL1: number;
  compliancePctL2: number;
  compliancePctL3: number;
  overallCompliant: boolean;
}

// Pure helper functions

/** Check if a single voltage value is within ESO bounds [220V, 240V] */
export function isVoltageInBounds(voltage: number): boolean {
  return voltage >= ESO.VOLTAGE_MIN_1PH && voltage <= ESO.VOLTAGE_MAX_1PH;
}

/** Check if voltage represents a supply interruption (essentially zero) */
export function isVoltageZero(voltage: number): boolean {
  return voltage < ESO.VOLTAGE_ZERO_THRESHOLD;
}

/** Extract voltage for a specific phase from a reading */
export function getVoltageForPhase(reading: VoltageReading, phase: Phase): number {
  switch (phase) {
    case 'L1': return reading.voltage_l1;
    case 'L2': return reading.voltage_l2;
    case 'L3': return reading.voltage_l3;
  }
}

/** Analyse a single voltage value against ESO bounds */
export function analyseVoltage(voltage: number, phase: Phase): VoltageBoundsResult {
  return {
    phase,
    voltage,
    nominal: ESO.NOMINAL_VOLTAGE_1PH,
    min: ESO.VOLTAGE_MIN_1PH,
    max: ESO.VOLTAGE_MAX_1PH,
    deviation: voltage - ESO.NOMINAL_VOLTAGE_1PH,
    inBounds: isVoltageInBounds(voltage),
    isZero: isVoltageZero(voltage),
  };
}

/** Analyse all three phases of a reading at once */
export function analyseReading(reading: VoltageReading): VoltageBoundsResult[] {
  return PHASES.map((phase) =>
    analyseVoltage(getVoltageForPhase(reading, phase), phase)
  );
}

// RMS calculation 

/**
 * Calculate RMS (Root Mean Square) voltage from an array of samples.
 *
 * Formula: V_rms = sqrt( (1/N) * Σ(Vi^2) )
 *
 * This is the standard measurement method per ESO requirements.
 */
export function calculateRms(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sumOfSquares = samples.reduce((sum, v) => sum + v * v, 0);
  return Math.sqrt(sumOfSquares / samples.length);
}

// 10-minute window aggregation

/**
 * Get the start of the 10-minute window that contains `date`.
 * E.g. 14:37:22 -> 14:30:00, 14:42:05 -> 14:40:00
 */
export function getWindowStart(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  d.setMinutes(
    Math.floor(d.getMinutes() / ESO.WINDOW_MINUTES) * ESO.WINDOW_MINUTES
  );
  return d;
}

/** Get the end of a 10-minute window given its start */
export function getWindowEnd(windowStart: Date): Date {
  return new Date(windowStart.getTime() + ESO.WINDOW_SECONDS * 1000);
}

/**
 * Aggregate a batch of readings into a 10-minute RMS window result.
 *
 * @param readings   - All readings within the 10-minute window
 * @param windowStart - Start of the window
 * @param pollIntervalSeconds - How often readings are taken (default 10s).
 *                              Used to estimate out-of-bounds duration.
 */
export function aggregateWindow(
  readings: VoltageReading[],
  windowStart: Date,
  pollIntervalSeconds: number = 10,
): RmsWindowResult {
  const windowEnd = getWindowEnd(windowStart);

  if (readings.length === 0) {
    return {
      windowStart,
      windowEnd,
      sampleCount: 0,
      rmsVoltageL1: 0,
      rmsVoltageL2: 0,
      rmsVoltageL3: 0,
      outOfBoundsSecondsL1: ESO.WINDOW_SECONDS,
      outOfBoundsSecondsL2: ESO.WINDOW_SECONDS,
      outOfBoundsSecondsL3: ESO.WINDOW_SECONDS,
      compliantL1: false,
      compliantL2: false,
      compliantL3: false,
    };
  }

  // Collect per-phase voltage arrays
  const l1Samples = readings.map((r) => r.voltage_l1);
  const l2Samples = readings.map((r) => r.voltage_l2);
  const l3Samples = readings.map((r) => r.voltage_l3);

  // RMS per phase
  const rmsL1 = calculateRms(l1Samples);
  const rmsL2 = calculateRms(l2Samples);
  const rmsL3 = calculateRms(l3Samples);

  // Count out-of-bounds time:
  // Each reading represents ~pollIntervalSeconds of real time
  let oobL1 = 0;
  let oobL2 = 0;
  let oobL3 = 0;

  for (const r of readings) {
    if (!isVoltageInBounds(r.voltage_l1)) oobL1 += pollIntervalSeconds;
    if (!isVoltageInBounds(r.voltage_l2)) oobL2 += pollIntervalSeconds;
    if (!isVoltageInBounds(r.voltage_l3)) oobL3 += pollIntervalSeconds;
  }

  // Compliant if out-of-bounds <= 5% of window (<= 30s out of 600s)
  const maxOob = ESO.WINDOW_OOB_MAX_SECONDS;

  return {
    windowStart,
    windowEnd,
    sampleCount: readings.length,
    rmsVoltageL1: +rmsL1.toFixed(3),
    rmsVoltageL2: +rmsL2.toFixed(3),
    rmsVoltageL3: +rmsL3.toFixed(3),
    outOfBoundsSecondsL1: oobL1,
    outOfBoundsSecondsL2: oobL2,
    outOfBoundsSecondsL3: oobL3,
    compliantL1: oobL1 <= maxOob,
    compliantL2: oobL2 <= maxOob,
    compliantL3: oobL3 <= maxOob,
  };
}

// Anomaly classification 

/**
 * Classify a voltage interruption by its duration.
 *
 * - Long interruption:  voltage = 0 for > 180 seconds (3 minutes)
 * - Short interruption: voltage = 0 for <= 180 seconds
 */
export function classifyInterruption(durationSeconds: number): {
  type: AnomalyType;
  severity: Severity;
} {
  if (durationSeconds > ESO.LONG_INTERRUPTION_SECONDS) {
    return { type: 'LONG_INTERRUPTION', severity: 'CRITICAL' };
  }
  return { type: 'SHORT_INTERRUPTION', severity: 'WARNING' };
}

/**
 * Build a DetectedAnomaly object for a supply interruption
 * that has just ended (voltage recovered).
 */
export function createInterruptionAnomaly(
  phase: Phase,
  startedAt: Date,
  endedAt: Date,
  recoveryVoltage: number,
): DetectedAnomaly {
  const durationSeconds = (endedAt.getTime() - startedAt.getTime()) / 1000;
  const { type, severity } = classifyInterruption(durationSeconds);

  return {
    startedAt,
    endedAt,
    phase,
    type,
    severity,
    voltageMin: 0,
    voltageMax: recoveryVoltage,
    durationSeconds,
  };
}

/**
 * Build a DetectedAnomaly for a voltage deviation (non-zero, out of bounds).
 */
export function createDeviationAnomaly(
  phase: Phase,
  startedAt: Date,
  voltage: number,
): DetectedAnomaly {
  return {
    startedAt,
    endedAt: null,
    phase,
    type: 'VOLTAGE_DEVIATION',
    severity: 'WARNING',
    voltageMin: voltage,
    voltageMax: voltage,
    durationSeconds: null,
  };
}

// Weekly compliance (ESO 95% rule)

/**
 * Calculate weekly compliance from an array of 10-minute window results.
 *
 * Per ESO: >= 95% of windows must have RMS voltage within [220V, 240V].
 */
export function calculateWeeklyCompliance(
  windows: RmsWindowResult[],
  weekStart: Date,
): WeeklyComplianceResult {
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3600 * 1000);
  const total = windows.length;

  if (total === 0) {
    return {
      weekStart,
      weekEnd,
      totalWindows: 0,
      compliantWindowsL1: 0,
      compliantWindowsL2: 0,
      compliantWindowsL3: 0,
      compliancePctL1: 0,
      compliancePctL2: 0,
      compliancePctL3: 0,
      overallCompliant: false,
    };
  }

  const compliantL1 = windows.filter((w) => w.compliantL1).length;
  const compliantL2 = windows.filter((w) => w.compliantL2).length;
  const compliantL3 = windows.filter((w) => w.compliantL3).length;

  const pctL1 = (compliantL1 / total) * 100;
  const pctL2 = (compliantL2 / total) * 100;
  const pctL3 = (compliantL3 / total) * 100;

  return {
    weekStart,
    weekEnd,
    totalWindows: total,
    compliantWindowsL1: compliantL1,
    compliantWindowsL2: compliantL2,
    compliantWindowsL3: compliantL3,
    compliancePctL1: +pctL1.toFixed(2),
    compliancePctL2: +pctL2.toFixed(2),
    compliancePctL3: +pctL3.toFixed(2),
    overallCompliant:
      pctL1 >= ESO.WEEKLY_COMPLIANCE_PCT &&
      pctL2 >= ESO.WEEKLY_COMPLIANCE_PCT &&
      pctL3 >= ESO.WEEKLY_COMPLIANCE_PCT,
  };
}