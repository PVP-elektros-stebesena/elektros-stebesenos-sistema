import type { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma.js';
import {
  generateWeeklyReport,
  generateMonthlyReport,
  type PeriodType,
} from '../services/reportGenerator.js';
import {
  startReportScheduler,
  stopReportScheduler,
  getSchedulerStatus,
} from '../services/reportScheduler.js';

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

// Plugin

export async function reportRoutes(fastify: FastifyInstance): Promise<void> {

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

    let anomalySummary = [];
    try {
      anomalySummary = JSON.parse(report.anomalySummary);
    } catch { /* empty */ }

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
      anomalySummary,
      totalAnomalies: report.totalAnomalies,
      criticalCount: report.criticalCount,
      warningCount: report.warningCount,
      createdAt: report.createdAt,
    };
  });

  //  POST /api/reports/generate
  //  Manually trigger report generation
  //  Body: { deviceId: number, periodType: "weekly"|"monthly", date?: string }
  fastify.post<{
    Body: { deviceId: number; periodType: PeriodType; date?: string };
  }>('/api/reports/generate', async (req, reply) => {
    const { deviceId, periodType, date: dateStr } = req.body;

    if (!deviceId || !periodType) {
      return reply.code(400).send({
        error: 'MISSING_FIELDS',
        message: 'deviceId and periodType are required',
      });
    }

    if (periodType !== 'weekly' && periodType !== 'monthly') {
      return reply.code(400).send({
        error: 'INVALID_PERIOD',
        message: 'periodType must be "weekly" or "monthly"',
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

    const report =
      periodType === 'weekly'
        ? await generateWeeklyReport(deviceId, targetDate)
        : await generateMonthlyReport(deviceId, targetDate);

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
      },
    };
  });
}
