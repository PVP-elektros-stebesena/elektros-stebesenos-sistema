/**
 * Report Generator Service
 *
 * Compiles stored aggregated windows and anomalies into
 * LST EN 50160 compliance reports for a given device and date range.
 *
 * Health-score logic:
 *   GREEN  — compliance >= 95% on all phases AND zero CRITICAL anomalies
 *   YELLOW — compliance 90-95% on any phase OR any WARNING deviations present
 *   RED    — compliance < 90% on any phase OR any LONG_INTERRUPTION (CRITICAL)
 */

import prisma from '../lib/prisma.js';
import { ESO } from '../config/eso.js';
import type { RmsWindowResult, WeeklyComplianceResult } from './voltageAnalysis.js';
import { calculateWeeklyCompliance } from './voltageAnalysis.js';

// ── Types ──────────────────────────────────────────────────────

export type HealthScore = 'GREEN' | 'YELLOW' | 'RED';
export type PeriodType = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'custom';

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
}

export interface GeneratedReport {
  deviceId: number;
  periodType: PeriodType;
  startsAt: Date;
  endsAt: Date;
  compliance: WeeklyComplianceResult;
  healthScore: HealthScore;
  anomalies: AnomalySummaryRow[];
  totalAnomalies: number;
  criticalCount: number;
  warningCount: number;
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

  const hasLongInterruption = anomalies.some(
    (a) => a.type === 'LONG_INTERRUPTION',
  );
  const hasCritical = anomalies.some((a) => a.severity === 'CRITICAL');
  const hasWarning = anomalies.some((a) => a.severity === 'WARNING');
  const minPct = Math.min(...pcts);

  // RED conditions
  if (minPct < 90 || hasLongInterruption) return 'RED';

  // YELLOW conditions
  if (minPct < 95 || hasWarning) return 'YELLOW';

  // GREEN: all phases >= 95% AND no CRITICAL anomalies
  if (hasCritical) return 'YELLOW';

  return 'GREEN';
}

// ── Week boundary helpers ──────────────────────────────────────

/** Get the Monday 00:00 of the week containing `date` */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Get the first day of the month containing `date` */
export function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

/** Get the first day of the next month */
export function getMonthEnd(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0, 0);
}

/** Start of day in local time */
function getDayStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** ISO week number (1-53) */
function getIsoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/** Resolve deterministic report ranges for preset period types.*/
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

/**
 * Generate a report for a specific device and date range.
 * Does NOT persist — call `saveReport()` separately.
 */
export async function generateReport(
  deviceId: number,
  periodType: PeriodType,
  startsAt: Date,
  endsAt: Date,
): Promise<GeneratedReport> {
  // 1. Fetch aggregated windows
  const windowRows = await prisma.aggregatedData.findMany({
    where: {
      deviceId,
      startsAt: { gte: startsAt },
      endsAt: { lte: endsAt },
    },
    orderBy: { startsAt: 'asc' },
  });

  const windows = windowRows.map(toRmsWindow);

  // 2. Calculate compliance using existing helper
  const compliance = calculateWeeklyCompliance(windows, startsAt);
  // Override weekEnd to match our actual period end
  compliance.weekEnd = endsAt;

  // 3. Fetch anomalies for the period
  const anomalyRows = await prisma.anomaly.findMany({
    where: {
      deviceId,
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
  }));

  const criticalCount = anomalies.filter((a) => a.severity === 'CRITICAL').length;
  const warningCount = anomalies.filter((a) => a.severity === 'WARNING').length;

  // 4. Compute health score
  const healthScore = computeHealthScore(compliance, anomalies);

  return {
    deviceId,
    periodType,
    startsAt,
    endsAt,
    compliance,
    healthScore,
    anomalies,
    totalAnomalies: anomalies.length,
    criticalCount,
    warningCount,
  };
}

/**
 * Persist a generated report to the database.
 * Uses upsert to avoid duplicates if re-generated.
 */
export async function saveReport(report: GeneratedReport) {
  return prisma.report.upsert({
    where: {
      deviceId_periodType_startsAt_endsAt: {
        deviceId: report.deviceId,
        periodType: report.periodType,
        startsAt: report.startsAt,
        endsAt: report.endsAt,
      },
    },
    update: {
      totalWindows: report.compliance.totalWindows,
      compliantWindowsL1: report.compliance.compliantWindowsL1,
      compliantWindowsL2: report.compliance.compliantWindowsL2,
      compliantWindowsL3: report.compliance.compliantWindowsL3,
      compliancePctL1: report.compliance.compliancePctL1,
      compliancePctL2: report.compliance.compliancePctL2,
      compliancePctL3: report.compliance.compliancePctL3,
      overallCompliant: report.compliance.overallCompliant,
      healthScore: report.healthScore,
      anomalySummary: JSON.stringify(report.anomalies),
      totalAnomalies: report.totalAnomalies,
      criticalCount: report.criticalCount,
      warningCount: report.warningCount,
      createdAt: new Date(),
    },
    create: {
      deviceId: report.deviceId,
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
      anomalySummary: JSON.stringify(report.anomalies),
      totalAnomalies: report.totalAnomalies,
      criticalCount: report.criticalCount,
      warningCount: report.warningCount,
    },
  });
}

/**
 * Generate AND persist a weekly report for one device.
 * `weekDate` — any date within the target week.
 */
export async function generateWeeklyReport(
  deviceId: number,
  weekDate?: Date,
): Promise<GeneratedReport> {
  const d = weekDate ?? new Date();
  const startsAt = getWeekStart(d);
  const endsAt = new Date(startsAt.getTime() + 7 * 24 * 3600_000);

  const report = await generateReport(deviceId, 'weekly', startsAt, endsAt);
  await saveReport(report);
  return report;
}

/**
 * Generate AND persist a monthly report for one device.
 * `monthDate` — any date within the target month.
 */
export async function generateMonthlyReport(
  deviceId: number,
  monthDate?: Date,
): Promise<GeneratedReport> {
  const d = monthDate ?? new Date();
  const startsAt = getMonthStart(d);
  const endsAt = getMonthEnd(d);

  const report = await generateReport(deviceId, 'monthly', startsAt, endsAt);
  await saveReport(report);
  return report;
}

/**
 * Cron handler: generate weekly reports for ALL active devices.
 * Called every Monday at 00:01 for the previous week.
 */
export async function generateAllWeeklyReports(): Promise<GeneratedReport[]> {
  const lastWeek = new Date(Date.now() - 7 * 24 * 3600_000);

  const devices = await prisma.device.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  const reports: GeneratedReport[] = [];

  for (const device of devices) {
      try {
        const report = await generateWeeklyReport(device.id, lastWeek);
        reports.push(report);
        console.log(
          '[ReportGenerator] Weekly report for device %d: %s (compliance L1=%s%% L2=%s%% L3=%s%%)',
          device.id,
          report.healthScore,
          report.compliance.compliancePctL1,
          report.compliance.compliancePctL2,
          report.compliance.compliancePctL3,
        );
      } catch (err) {
        console.error(`[ReportGenerator] Failed for device ${device.id}:`, err);
      }
  }

  return reports;
}
