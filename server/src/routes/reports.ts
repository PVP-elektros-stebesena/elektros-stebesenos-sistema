import type { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma.js';
import {
  generateReport,
  resolvePresetPeriodRange,
  saveReport,
  type PeriodType,
} from '../services/reportGenerator.js';
import { buildReportInsights } from '../services/reportInsights.js';
import { buildPowerQualityAssessment } from '../services/reportQuality.js';
import {
  startReportScheduler,
  stopReportScheduler,
  getSchedulerStatus,
} from '../services/reportScheduler.js';
import { notificationService } from '../services/notificationService.js';

type RawAnomalySummaryRow = {
  id?: number;
  type: string;
  phase: string;
  durationSeconds: number | null;
  minVoltage: number | null;
  maxVoltage: number | null;
  startsAt: string;
  endsAt: string | null;
  severity: string;
};

type ContextChartPoint = {
  timestamp: string;
  voltage: number | null;
  voltageL1: number | null;
  voltageL2: number | null;
  voltageL3: number | null;
  powerKw: number | null;
};

// Query helpers

function parseDeviceId(val: string | undefined): number | undefined {
  if (!val) return undefined;
  const n = parseInt(val, 10);
  return Number.isNaN(n) ? undefined : n;
}

function parseDate(val: string | undefined, fallback: Date): Date {
  if (!val) return fallback;
  const d = new Date(val);
  return isNaN(d.getTime()) ? fallback : d;
}

const MAX_CUSTOM_RANGE_DAYS = 62;
const MS_PER_DAY = 24 * 3600_000;
const CONTEXT_PADDING_MS = 30 * 60 * 1000;
const MAX_CONTEXT_POINTS = 360;

function toSeverityLabel(severity: number): string {
  return severity >= 2 ? 'CRITICAL' : 'WARNING';
}

function pickVoltageByPhase(
  phase: string,
  row: { voltageL1: number | null; voltageL2: number | null; voltageL3: number | null },
): number | null {
  if (phase === 'L1') return row.voltageL1;
  if (phase === 'L2') return row.voltageL2;
  if (phase === 'L3') return row.voltageL3;
  if (phase === 'ALL') {
    const values = [row.voltageL1, row.voltageL2, row.voltageL3]
      .filter((val): val is number => val != null);
    if (values.length === 0) return null;
    return +(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3);
  }
  return row.voltageL1 ?? row.voltageL2 ?? row.voltageL3;
}

function pickTotalPowerKw(row: {
  activeInstantaneousPowerDelivered: number | null;
  powerDeliveredTotal: number | null;
  activeInstantaneousPowerDeliveredL1: number | null;
  activeInstantaneousPowerDeliveredL2: number | null;
  activeInstantaneousPowerDeliveredL3: number | null;
}): number | null {
  const directTotal = row.activeInstantaneousPowerDelivered ?? row.powerDeliveredTotal;
  if (directTotal != null) return +(directTotal / 1000).toFixed(4);

  const phaseValues = [
    row.activeInstantaneousPowerDeliveredL1,
    row.activeInstantaneousPowerDeliveredL2,
    row.activeInstantaneousPowerDeliveredL3,
  ].filter((val): val is number => val != null);

  if (phaseValues.length === 0) return null;
  return +(phaseValues.reduce((sum, value) => sum + value, 0) / 1000).toFixed(4);
}

function downsampleContextPoints(points: ContextChartPoint[]): ContextChartPoint[] {
  if (points.length <= MAX_CONTEXT_POINTS) return points;

  const keepIndexes = new Set<number>();
  const step = Math.ceil(points.length / MAX_CONTEXT_POINTS);
  for (let i = 0; i < points.length; i += step) {
    keepIndexes.add(i);
  }

  keepIndexes.add(0);
  keepIndexes.add(points.length - 1);

  let minVoltageIndex: number | null = null;
  let maxVoltageIndex: number | null = null;
  let minVoltage = Infinity;
  let maxVoltage = -Infinity;

  points.forEach((point, index) => {
    if (point.voltage == null) return;
    if (point.voltage < minVoltage) {
      minVoltage = point.voltage;
      minVoltageIndex = index;
    }
    if (point.voltage > maxVoltage) {
      maxVoltage = point.voltage;
      maxVoltageIndex = index;
    }
  });

  if (minVoltageIndex != null) keepIndexes.add(minVoltageIndex);
  if (maxVoltageIndex != null) keepIndexes.add(maxVoltageIndex);

  return [...keepIndexes]
    .sort((a, b) => a - b)
    .map((index) => points[index]);
}

function isValidDate(value: string | undefined): value is string {
  if (!value) return false;
  return !Number.isNaN(new Date(value).getTime());
}

function parseCustomRange(startDate?: string, endDate?: string): {
  startsAt: Date;
  endsAt: Date;
} | { error: { code: string; message: string } } {
  if (!isValidDate(startDate) || !isValidDate(endDate)) {
    return {
      error: {
        code: 'INVALID_CUSTOM_RANGE',
        message: 'Custom period requires valid startDate and endDate',
      },
    };
  }

  const startsAt = new Date(startDate);
  const endsAt = new Date(endDate);

  if (endsAt <= startsAt) {
    return {
      error: {
        code: 'INVALID_CUSTOM_RANGE',
        message: 'endDate must be later than startDate',
      },
    };
  }

  const now = new Date();
  if (endsAt.getTime() > now.getTime()) {
    // Allow selecting "today" while report is generated before midnight.
    endsAt.setTime(now.getTime());
  }

  const rangeDays = (endsAt.getTime() - startsAt.getTime()) / MS_PER_DAY;
  if (rangeDays > MAX_CUSTOM_RANGE_DAYS) {
    return {
      error: {
        code: 'CUSTOM_RANGE_TOO_LONG',
        message: `Custom period must be at most ${MAX_CUSTOM_RANGE_DAYS} days`,
      },
    };
  }

  return { startsAt, endsAt };
}

// Plugin

export async function reportRoutes(fastify: FastifyInstance): Promise<void> {

  //  GET /api/anomalies/:id/context
  //  Returns 30 min before and 30 min after anomaly for on-demand charting
  fastify.get<{ Params: { id: string } }>('/api/anomalies/:id/context', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'Anomaly ID must be a number' });
    }

    const anomaly = await prisma.anomaly.findUnique({
      where: { id },
      select: {
        id: true,
        deviceId: true,
        phase: true,
        type: true,
        startsAt: true,
        endsAt: true,
        minVoltage: true,
        maxVoltage: true,
      },
    });

    if (!anomaly) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Anomaly not found' });
    }

    const anomalyEndsAt = anomaly.endsAt ?? anomaly.startsAt;
    const contextStartsAt = new Date(anomaly.startsAt.getTime() - CONTEXT_PADDING_MS);
    const contextEndsAt = new Date(anomalyEndsAt.getTime() + CONTEXT_PADDING_MS);

    const readings = await prisma.reading.findMany({
      where: {
        deviceId: anomaly.deviceId,
        timestamp: {
          gte: contextStartsAt,
          lte: contextEndsAt,
        },
      },
      orderBy: { timestamp: 'asc' },
      select: {
        timestamp: true,
        voltageL1: true,
        voltageL2: true,
        voltageL3: true,
        activeInstantaneousPowerDelivered: true,
        powerDeliveredTotal: true,
        activeInstantaneousPowerDeliveredL1: true,
        activeInstantaneousPowerDeliveredL2: true,
        activeInstantaneousPowerDeliveredL3: true,
      },
    });

    const rawPoints: ContextChartPoint[] = readings.map((row) => ({
      timestamp: row.timestamp.toISOString(),
      voltage: pickVoltageByPhase(anomaly.phase, row),
      voltageL1: row.voltageL1,
      voltageL2: row.voltageL2,
      voltageL3: row.voltageL3,
      powerKw: pickTotalPowerKw(row),
    }));

    const points = downsampleContextPoints(rawPoints);

    return {
      anomaly: {
        id: anomaly.id,
        deviceId: anomaly.deviceId,
        phase: anomaly.phase,
        type: anomaly.type,
        startsAt: anomaly.startsAt.toISOString(),
        endsAt: anomalyEndsAt.toISOString(),
        minVoltage: anomaly.minVoltage,
        maxVoltage: anomaly.maxVoltage,
      },
      context: {
        startsAt: contextStartsAt.toISOString(),
        endsAt: contextEndsAt.toISOString(),
        rawPointCount: rawPoints.length,
        returnedPointCount: points.length,
        downsampled: points.length < rawPoints.length,
      },
      points,
    };
  });

  //  GET /api/reports/scheduler/status
  //  Get current status of background report generation
  fastify.get('/api/reports/scheduler/status', async () => {
    return getSchedulerStatus();
  });

  //  POST /api/reports/scheduler/start
  //  Start background report generation
  fastify.post('/api/reports/scheduler/start', async () => {
    startReportScheduler();
    return getSchedulerStatus();
  });

  //  POST /api/reports/scheduler/stop
  //  Stop background report generation
  fastify.post('/api/reports/scheduler/stop', async () => {
    stopReportScheduler();
    return { message: 'Scheduler stopped', ...getSchedulerStatus() };
  });

  //  GET /api/reports?deviceId=&periodType=&limit=
  //  List stored reports
  fastify.get<{
    Querystring: { deviceId?: string; periodType?: string; limit?: string };
  }>('/api/reports', async (req) => {
    const deviceId = parseDeviceId(req.query.deviceId);
    const periodType = req.query.periodType as PeriodType | undefined;
    const limit = Math.min(parseInt(req.query.limit ?? '20', 10) || 20, 100);

    const reports = await prisma.report.findMany({
      where: {
        ...(deviceId ? { deviceId } : {}),
        ...(periodType ? { periodType } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { device: { select: { id: true, name: true } } },
    });

    return {
      count: reports.length,
      data: reports.map((r) => ({
        id: r.id,
        deviceId: r.deviceId,
        deviceName: r.device.name,
        periodType: r.periodType,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        healthScore: r.healthScore,
        totalWindows: r.totalWindows,
        compliancePctL1: r.compliancePctL1,
        compliancePctL2: r.compliancePctL2,
        compliancePctL3: r.compliancePctL3,
        overallCompliant: r.overallCompliant,
        totalAnomalies: r.totalAnomalies,
        criticalCount: r.criticalCount,
        warningCount: r.warningCount,
        createdAt: r.createdAt,
      })),
    };
  });

  //  GET /api/reports/:id
  //  Full report detail including anomaly summary
  fastify.get<{ Params: { id: string } }>('/api/reports/:id', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'Report ID must be a number' });
    }

    const report = await prisma.report.findUnique({
      where: { id },
      include: { device: { select: { id: true, name: true } } },
    });

    if (!report) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Report not found' });
    }

    let anomalySummary: RawAnomalySummaryRow[] = [];
    try {
      const parsed = JSON.parse(report.anomalySummary) as RawAnomalySummaryRow[];
      anomalySummary = Array.isArray(parsed) ? parsed : [];
    } catch { /* empty */ }

    const anomaliesInRange = await prisma.anomaly.findMany({
      where: {
        deviceId: report.deviceId,
        startsAt: { gte: report.startsAt, lte: report.endsAt },
      },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        phase: true,
        type: true,
        severity: true,
        minVoltage: true,
        maxVoltage: true,
        duration: true,
      },
    });

    const usedIds = new Set<number>();
    const enrichedAnomalySummary = anomalySummary.map((summaryRow) => {
      if (summaryRow.id != null) {
        usedIds.add(summaryRow.id);
        return summaryRow;
      }

      const matched = anomaliesInRange.find((row) => {
        if (usedIds.has(row.id)) return false;
        if (row.type !== summaryRow.type || row.phase !== summaryRow.phase) return false;
        if (row.startsAt.toISOString() !== summaryRow.startsAt) return false;

        const rowEndsAt = row.endsAt?.toISOString() ?? null;
        if (rowEndsAt !== summaryRow.endsAt) return false;
        if ((row.duration ?? null) !== summaryRow.durationSeconds) return false;
        if ((row.minVoltage ?? null) !== summaryRow.minVoltage) return false;
        if ((row.maxVoltage ?? null) !== summaryRow.maxVoltage) return false;
        return toSeverityLabel(row.severity) === summaryRow.severity;
      });

      if (matched) {
        usedIds.add(matched.id);
        return { ...summaryRow, id: matched.id };
      }

      return summaryRow;
    });

    const insights = await buildReportInsights(
      report.deviceId,
      report.startsAt,
      report.endsAt,
      enrichedAnomalySummary,
    );

    const powerQuality = buildPowerQualityAssessment(
      {
        compliancePctL1: report.compliancePctL1,
        compliancePctL2: report.compliancePctL2,
        compliancePctL3: report.compliancePctL3,
        overallCompliant: report.overallCompliant,
      },
      enrichedAnomalySummary,
    );

    return {
      id: report.id,
      deviceId: report.deviceId,
      deviceName: report.device.name,
      periodType: report.periodType,
      startsAt: report.startsAt,
      endsAt: report.endsAt,
      healthScore: report.healthScore,
      compliance: {
        totalWindows: report.totalWindows,
        compliantWindowsL1: report.compliantWindowsL1,
        compliantWindowsL2: report.compliantWindowsL2,
        compliantWindowsL3: report.compliantWindowsL3,
        compliancePctL1: report.compliancePctL1,
        compliancePctL2: report.compliancePctL2,
        compliancePctL3: report.compliancePctL3,
        overallCompliant: report.overallCompliant,
      },
      anomalySummary: enrichedAnomalySummary,
      insights,
      powerQuality,
      totalAnomalies: report.totalAnomalies,
      criticalCount: report.criticalCount,
      warningCount: report.warningCount,
      createdAt: report.createdAt,
    };
  });

  //  POST /api/reports/generate
  //  Manually trigger report generation
  //  Body: {
  //    deviceId: number,
  //    periodType: "daily"|"weekly"|"biweekly"|"monthly"|"custom",
  //    date?: string,
  //    startDate?: string,
  //    endDate?: string
  //  }
  fastify.post<{
    Body: {
      deviceId: number;
      periodType: PeriodType;
      date?: string;
      startDate?: string;
      endDate?: string;
    };
  }>('/api/reports/generate', async (req, reply) => {
    const { deviceId, periodType, date: dateStr, startDate, endDate } = req.body;

    if (!deviceId || !periodType) {
      return reply.code(400).send({
        error: 'MISSING_FIELDS',
        message: 'deviceId and periodType are required',
      });
    }

    if (!['daily', 'weekly', 'biweekly', 'monthly', 'custom'].includes(periodType)) {
      return reply.code(400).send({
        error: 'INVALID_PERIOD',
        message: 'periodType must be one of: daily, weekly, biweekly, monthly, custom',
      });
    }

    // Verify device exists
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) {
      return reply.code(404).send({
        error: 'DEVICE_NOT_FOUND',
        message: `Device ${deviceId} not found`,
      });
    }

    const targetDate = dateStr ? parseDate(dateStr, new Date()) : new Date();
    let startsAt: Date;
    let endsAt: Date;

    if (periodType === 'custom') {
      const parsed = parseCustomRange(startDate, endDate);
      if ('error' in parsed) {
        return reply.code(400).send({
          error: parsed.error.code,
          message: parsed.error.message,
        });
      }
      startsAt = parsed.startsAt;
      endsAt = parsed.endsAt;
    } else {
      const range = resolvePresetPeriodRange(periodType, targetDate);
      startsAt = range.startsAt;
      endsAt = range.endsAt;
    }

    if (startsAt >= endsAt) {
      return reply.code(400).send({
        error: 'INVALID_PERIOD_RANGE',
        message: 'Resolved report range is invalid',
      });
    }

    const report = await generateReport(deviceId, periodType, startsAt, endsAt);
    await saveReport(report);

    await notificationService.notifyReportGenerated({
      deviceId: report.deviceId,
      periodType: report.periodType,
      startsAt: report.startsAt,
      endsAt: report.endsAt,
      healthScore: report.healthScore,
      totalAnomalies: report.totalAnomalies,
    });

    const insights = await buildReportInsights(deviceId, startsAt, endsAt, report.anomalies);
    const powerQuality = buildPowerQualityAssessment(
      {
        compliancePctL1: report.compliance.compliancePctL1,
        compliancePctL2: report.compliance.compliancePctL2,
        compliancePctL3: report.compliance.compliancePctL3,
        overallCompliant: report.compliance.overallCompliant,
      },
      report.anomalies,
    );

    return {
      message: `${periodType} report generated successfully`,
      report: {
        deviceId: report.deviceId,
        periodType: report.periodType,
        startsAt: report.startsAt,
        endsAt: report.endsAt,
        healthScore: report.healthScore,
        compliancePctL1: report.compliance.compliancePctL1,
        compliancePctL2: report.compliance.compliancePctL2,
        compliancePctL3: report.compliance.compliancePctL3,
        overallCompliant: report.compliance.overallCompliant,
        totalAnomalies: report.totalAnomalies,
        criticalCount: report.criticalCount,
        warningCount: report.warningCount,
        insights,
        powerQuality,
      },
    };
  });
}
