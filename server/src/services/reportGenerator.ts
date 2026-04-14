/**
 * Report Generator Service
 *
 * Compiles stored aggregated windows and anomalies into
 * LST EN 50160 compliance reports for a given device and date range.
 */

import prisma from '../lib/prisma.js';
import type { RmsWindowResult, WeeklyComplianceResult } from './voltageAnalysis.js';
import { calculateWeeklyCompliance } from './voltageAnalysis.js';

// ── Types ──────────────────────────────────────────────────────

export type HealthScore = 'GREEN' | 'YELLOW' | 'RED';
export type PeriodType = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'custom';
export type ReportUse = 'home' | 'technical' | 'solar';

export interface PeriodRange {
  startsAt: Date;
  endsAt: Date;
}

export interface AnomalySummaryRow {
  id?: number;
  type: string;
  phase: string;
  durationSeconds: number | null;
  minVoltage: number | null;
  maxVoltage: number | null;
  startsAt: string;
  endsAt: string | null;
  severity: string;
  metricDomain?: 'VOLTAGE' | 'POWER';
  metricName?: string | null;
}

export interface GeneratedReport {
  deviceId: number;
  reportUse: ReportUse;
  periodType: PeriodType;
  startsAt: Date;
  endsAt: Date;
  compliance: WeeklyComplianceResult;
  healthScore: HealthScore;
  powerHealthScore: HealthScore;
  combinedHealthScore: HealthScore;
  anomalies: AnomalySummaryRow[];
  totalAnomalies: number;
  criticalCount: number;
  warningCount: number;
}

const POWER_ANOMALY_TYPES = new Set([
  'POWER_SPIKE',
  'REACTIVE_POWER_SPIKE',
  'LOW_POWER_FACTOR',
  'PHASE_IMBALANCE',
  'POWER_RAMP_RATE',
]);

function isPowerAnomalyType(type: string): boolean {
  return POWER_ANOMALY_TYPES.has(type);
}

export function computePowerHealthScore(
  anomalies: { type: string; severity: string }[],
): HealthScore {
  const powerAnomalies = anomalies.filter((anomaly) => isPowerAnomalyType(anomaly.type));
  if (powerAnomalies.some((anomaly) => anomaly.severity === 'CRITICAL')) return 'RED';
  if (powerAnomalies.some((anomaly) => anomaly.severity === 'WARNING')) return 'YELLOW';
  return 'GREEN';
}

export function computeCombinedHealthScore(
  voltageHealthScore: HealthScore,
  powerHealthScore: HealthScore,
): HealthScore {
  if (voltageHealthScore === 'RED' || powerHealthScore === 'RED') return 'RED';
  if (voltageHealthScore === 'YELLOW' || powerHealthScore === 'YELLOW') return 'YELLOW';
  return 'GREEN';
}

// ── Helpers ────────────────────────────────────────────────────

const SEVERITY_LABEL: Record<number, string> = { 1: 'WARNING', 2: 'CRITICAL' };

function toRmsWindow(row: {
  startsAt: Date;
  endsAt: Date;
  sampleCount: number;
  voltageL1: number | null;
  voltageL2: number | null;
  voltageL3: number | null;
  outOfBoundsSecondsL1: number;
  outOfBoundsSecondsL2: number;
  outOfBoundsSecondsL3: number;
  compliantL1: boolean;
  compliantL2: boolean;
  compliantL3: boolean;
}): RmsWindowResult {
  return {
    windowStart: row.startsAt,
    windowEnd: row.endsAt,
    sampleCount: row.sampleCount,
    rmsVoltageL1: row.voltageL1 ?? 0,
    rmsVoltageL2: row.voltageL2 ?? 0,
    rmsVoltageL3: row.voltageL3 ?? 0,
    outOfBoundsSecondsL1: row.outOfBoundsSecondsL1,
    outOfBoundsSecondsL2: row.outOfBoundsSecondsL2,
    outOfBoundsSecondsL3: row.outOfBoundsSecondsL3,
    compliantL1: row.compliantL1,
    compliantL2: row.compliantL2,
    compliantL3: row.compliantL3,
  };
}

/**
 * Determine health score per acceptance criteria:
 * - RED:    any phase < 90% OR any LONG_INTERRUPTION (CRITICAL)
 * - YELLOW: any phase 90-95% OR any WARNING anomalies
 * - GREEN:  all phases >= 95% AND zero CRITICAL anomalies
 */
export function computeHealthScore(
  compliance: WeeklyComplianceResult,
  anomalies: { type: string; severity: string }[],
): HealthScore {
  const pcts = [
    compliance.compliancePctL1,
    compliance.compliancePctL2,
    compliance.compliancePctL3,
  ];

  const hasLongInterruption = anomalies.some((a) => a.type === 'LONG_INTERRUPTION');
  const hasCritical = anomalies.some((a) => a.severity === 'CRITICAL');
  const hasWarning = anomalies.some((a) => a.severity === 'WARNING');
  const minPct = Math.min(...pcts);

  if (minPct < 90 || hasLongInterruption) return 'RED';
  if (minPct < 95 || hasWarning) return 'YELLOW';
  if (hasCritical) return 'YELLOW';

  return 'GREEN';
}

// ── Week boundary helpers ──────────────────────────────────────

export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

export function getMonthEnd(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0, 0);
}

function getDayStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getIsoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export function resolvePresetPeriodRange(
  periodType: Exclude<PeriodType, 'custom'>,
  referenceDate: Date,
): PeriodRange {
  if (periodType === 'daily') {
    const startsAt = getDayStart(referenceDate);
    const endsAt = new Date(startsAt.getTime() + 24 * 3600_000);
    return { startsAt, endsAt };
  }

  if (periodType === 'weekly') {
    const startsAt = getWeekStart(referenceDate);
    const endsAt = new Date(startsAt.getTime() + 7 * 24 * 3600_000);
    return { startsAt, endsAt };
  }

  if (periodType === 'biweekly') {
    const weekStart = getWeekStart(referenceDate);
    const weekNum = getIsoWeekNumber(weekStart);
    const startsAt = new Date(weekStart);
    if (weekNum % 2 !== 0) {
      startsAt.setDate(startsAt.getDate() - 7);
    }
    const endsAt = new Date(startsAt);
    endsAt.setDate(startsAt.getDate() + 14);
    return { startsAt, endsAt };
  }

  const startsAt = getMonthStart(referenceDate);
  const endsAt = getMonthEnd(referenceDate);
  return { startsAt, endsAt };
}

// ── Core report generation ─────────────────────────────────────

export async function generateReport(
  deviceId: number,
  reportUse: ReportUse,
  periodType: PeriodType,
  startsAt: Date,
  endsAt: Date,
): Promise<GeneratedReport> {
  const windowRows = await prisma.aggregatedData.findMany({
    where: {
      deviceId,
      startsAt: { gte: startsAt },
      endsAt: { lte: endsAt },
    },
    orderBy: { startsAt: 'asc' },
  });

  const windows = windowRows.map(toRmsWindow);

  const compliance = calculateWeeklyCompliance(windows, startsAt);
  compliance.weekEnd = endsAt;

  const anomalyRows = await prisma.anomaly.findMany({
    where: {
      deviceId,
      metricDomain: { in: ['VOLTAGE', 'POWER'] },
      startsAt: { gte: startsAt, lt: endsAt },
    },
    orderBy: { startsAt: 'asc' },
  });

  const anomalies: AnomalySummaryRow[] = anomalyRows.map((a) => ({
    id: a.id,
    type: a.type,
    phase: a.phase,
    durationSeconds: a.duration,
    minVoltage: a.minVoltage,
    maxVoltage: a.maxVoltage,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt?.toISOString() ?? null,
    severity: SEVERITY_LABEL[a.severity] ?? 'WARNING',
    metricDomain: a.metricDomain as 'VOLTAGE' | 'POWER',
    metricName: a.metricName,
  }));

  const criticalCount = anomalies.filter((a) => a.severity === 'CRITICAL').length;
  const warningCount = anomalies.filter((a) => a.severity === 'WARNING').length;
  const healthScore = computeHealthScore(
    compliance,
    anomalies.filter((a) => a.metricDomain === 'VOLTAGE' || a.metricDomain == null),
  );
  const powerHealthScore = computePowerHealthScore(anomalies);
  const combinedHealthScore = computeCombinedHealthScore(healthScore, powerHealthScore);

  return {
    deviceId,
    reportUse,
    periodType,
    startsAt,
    endsAt,
    compliance,
    healthScore,
    powerHealthScore,
    combinedHealthScore,
    anomalies,
    totalAnomalies: anomalies.length,
    criticalCount,
    warningCount,
  };
}

export async function saveReport(report: GeneratedReport) {
  return prisma.report.upsert({
    where: {
      deviceId_reportUse_periodType_startsAt_endsAt: {
        deviceId: report.deviceId,
        reportUse: report.reportUse,
        periodType: report.periodType,
        startsAt: report.startsAt,
        endsAt: report.endsAt,
      },
    },
    update: {
      reportUse: report.reportUse,
      totalWindows: report.compliance.totalWindows,
      compliantWindowsL1: report.compliance.compliantWindowsL1,
      compliantWindowsL2: report.compliance.compliantWindowsL2,
      compliantWindowsL3: report.compliance.compliantWindowsL3,
      compliancePctL1: report.compliance.compliancePctL1,
      compliancePctL2: report.compliance.compliancePctL2,
      compliancePctL3: report.compliance.compliancePctL3,
      overallCompliant: report.compliance.overallCompliant,
      healthScore: report.healthScore,
      powerHealthScore: report.powerHealthScore,
      combinedHealthScore: report.combinedHealthScore,
      anomalySummary: JSON.stringify(report.anomalies),
      totalAnomalies: report.totalAnomalies,
      criticalCount: report.criticalCount,
      warningCount: report.warningCount,
      createdAt: new Date(),
    },
    create: {
      deviceId: report.deviceId,
      reportUse: report.reportUse,
      periodType: report.periodType,
      startsAt: report.startsAt,
      endsAt: report.endsAt,
      totalWindows: report.compliance.totalWindows,
      compliantWindowsL1: report.compliance.compliantWindowsL1,
      compliantWindowsL2: report.compliance.compliantWindowsL2,
      compliantWindowsL3: report.compliance.compliantWindowsL3,
      compliancePctL1: report.compliance.compliancePctL1,
      compliancePctL2: report.compliance.compliancePctL2,
      compliancePctL3: report.compliance.compliancePctL3,
      overallCompliant: report.compliance.overallCompliant,
      healthScore: report.healthScore,
      powerHealthScore: report.powerHealthScore,
      combinedHealthScore: report.combinedHealthScore,
      anomalySummary: JSON.stringify(report.anomalies),
      totalAnomalies: report.totalAnomalies,
      criticalCount: report.criticalCount,
      warningCount: report.warningCount,
    },
  });
}

export async function generateWeeklyReport(
  deviceId: number,
  reportUse: ReportUse,
  weekDate?: Date,
): Promise<GeneratedReport> {
  const d = weekDate ?? new Date();
  const startsAt = getWeekStart(d);
  const endsAt = new Date(startsAt.getTime() + 7 * 24 * 3600_000);

  const report = await generateReport(deviceId, reportUse, 'weekly', startsAt, endsAt);
  await saveReport(report);
  return report;
}

export async function generateMonthlyReport(
  deviceId: number,
  reportUse: ReportUse,
  monthDate?: Date,
): Promise<GeneratedReport> {
  const d = monthDate ?? new Date();
  const startsAt = getMonthStart(d);
  const endsAt = getMonthEnd(d);

  const report = await generateReport(deviceId, reportUse, 'monthly', startsAt, endsAt);
  await saveReport(report);
  return report;
}

export async function generateAllWeeklyReports(
  reportUse: ReportUse = 'technical',
): Promise<GeneratedReport[]> {
  const lastWeek = new Date(Date.now() - 7 * 24 * 3600_000);

  const devices = await prisma.device.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  const reports: GeneratedReport[] = [];

  for (const device of devices) {
    try {
      const report = await generateWeeklyReport(device.id, reportUse, lastWeek);
      reports.push(report);
      console.log(
        '[ReportGenerator] Weekly report for device %d: %s (%s)',
        device.id,
        report.healthScore,
        report.reportUse,
      );
    } catch (err) {
      console.error(`[ReportGenerator] Failed for device ${device.id}:`, err);
    }
  }

  return reports;
}
