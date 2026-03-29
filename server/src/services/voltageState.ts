import prisma from '../lib/prisma.js';
import type {
  VoltageReading,
  RmsWindowResult,
  DetectedAnomaly,
  WeeklyComplianceResult,
} from './voltageAnalysis.js';
import { calculateWeeklyCompliance } from './voltageAnalysis.js';

/**
 * Prisma-backed voltage data store.
 *
 * Provides the same read API as the old in-memory VoltageState,
 * but queries the database populated by DevicePoller.
 */

/** Map a DB AggregatedData row → RmsWindowResult */
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

const SEVERITY_LABEL: Record<number, string> = { 1: 'WARNING', 2: 'CRITICAL' };

function toDetectedAnomaly(row: {
  startsAt: Date;
  endsAt: Date | null;
  phase: string;
  type: string;
  severity: number;
  minVoltage: number | null;
  maxVoltage: number | null;
  duration: number | null;
}): DetectedAnomaly {
  return {
    startedAt: row.startsAt,
    endedAt: row.endsAt,
    phase: row.phase as DetectedAnomaly['phase'],
    type: row.type as DetectedAnomaly['type'],
    severity: (SEVERITY_LABEL[row.severity] ?? 'WARNING') as DetectedAnomaly['severity'],
    voltageMin: row.minVoltage,
    voltageMax: row.maxVoltage,
    durationSeconds: row.duration,
  };
}

class VoltageState {
  /** Most recent reading from DB */
  async getLatest(deviceId?: number): Promise<VoltageReading | null> {
    const row = await prisma.reading.findFirst({
      where: deviceId ? { deviceId } : undefined,
      orderBy: { timestamp: 'desc' },
    });

    if (!row) return null;

    return {
      timestamp: row.timestamp,
      voltage_l1: row.voltageL1 ?? row.instantaneousVoltageL1 ?? 0,
      voltage_l2: row.voltageL2 ?? row.instantaneousVoltageL2 ?? 0,
      voltage_l3: row.voltageL3 ?? row.instantaneousVoltageL3 ?? 0,
    };
  }

  /** All completed 10-min windows, optionally filtered */
  async getWindows(opts?: {
    deviceId?: number;
    from?: Date;
    to?: Date;
  }): Promise<RmsWindowResult[]> {
    const rows = await prisma.aggregatedData.findMany({
      where: {
        ...(opts?.deviceId ? { deviceId: opts.deviceId } : {}),
        ...(opts?.from ? { startsAt: { gte: opts.from } } : {}),
        ...(opts?.to ? { endsAt: { lte: opts.to } } : {}),
      },
      orderBy: { startsAt: 'asc' },
    });

    return rows.map(toRmsWindow);
  }

  /** All detected anomalies, optionally filtered */
  async getAnomalies(opts?: {
    deviceId?: number;
    type?: string;
    phase?: string;
    from?: Date;
    to?: Date;
  }): Promise<DetectedAnomaly[]> {
    const rows = await prisma.anomaly.findMany({
      where: {
        metricDomain: 'VOLTAGE',
        ...(opts?.deviceId ? { deviceId: opts.deviceId } : {}),
        ...(opts?.type ? { type: opts.type } : {}),
        ...(opts?.phase ? { phase: opts.phase } : {}),
        ...(opts?.from ? { startsAt: { gte: opts.from } } : {}),
        ...(opts?.to ? { startsAt: { lte: opts.to } } : {}),
      },
      orderBy: { startsAt: 'desc' },
    });

    return rows.map(toDetectedAnomaly);
  }

  /** Weekly compliance for the week containing `date` */
  async getWeeklyCompliance(
    date?: Date,
    deviceId?: number,
  ): Promise<WeeklyComplianceResult> {
    const d = date ?? new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const weekStart = new Date(d);
    weekStart.setDate(diff);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3600_000);

    const windows = await this.getWindows({
      deviceId,
      from: weekStart,
      to: weekEnd,
    });

    return calculateWeeklyCompliance(windows, weekStart);
  }

  /** Total counts for summary */
  async getStats(deviceId?: number) {
    const where = deviceId ? { deviceId } : {};

    const [totalReadings, totalWindows, totalAnomalies, activeAnomalies] =
      await Promise.all([
        prisma.reading.count({ where }),
        prisma.aggregatedData.count({ where }),
        prisma.anomaly.count({ where: { ...where, metricDomain: 'VOLTAGE' } }),
        prisma.anomaly.count({ where: { ...where, metricDomain: 'VOLTAGE', endsAt: null } }),
      ]);

    return { totalReadings, totalWindows, totalAnomalies, activeAnomalies };
  }
}

/** Singleton — import from routes and services */
export const voltageState = new VoltageState();