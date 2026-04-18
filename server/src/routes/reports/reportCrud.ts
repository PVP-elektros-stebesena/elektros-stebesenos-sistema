import type { FastifyInstance } from 'fastify';
import prisma from '../../lib/prisma.js';
import { buildReportInsights } from '../../services/reportInsights.js';
import { buildPowerQualityAssessment } from '../../services/reportQuality.js';
import {
  computeCombinedHealthScore,
  computePowerHealthScore,
} from '../../services/reportGenerator.js';
import { costCalculatorService } from '../../services/costCalculator.js';
import type { EstimatedCostResult } from '../../services/costCalculator.js';
import type { HealthScore, PeriodType, ReportUse } from '../../services/reportGenerator.js';
import { parseOptionalDeviceId } from '../queryParsers.js';
import {
  toSeverityLabel,
  unavailableEstimatedCost,
  type RawAnomalySummaryRow,
} from './shared.js';

export function registerReportCrudRoutes(fastify: FastifyInstance): void {
  fastify.get<{
    Querystring: { deviceId?: string; periodType?: string; limit?: string; reportUse?: string };
  }>('/api/reports', async (req, reply) => {
    const parsedDeviceId = parseOptionalDeviceId(req.query.deviceId);
    if (!parsedDeviceId.ok) {
      return reply.code(parsedDeviceId.statusCode).send(parsedDeviceId.body);
    }

    const deviceId = parsedDeviceId.value;
    const periodType = req.query.periodType as PeriodType | undefined;
    const reportUse = req.query.reportUse as ReportUse | undefined;
    const limit = Math.min(parseInt(req.query.limit ?? '20', 10) || 20, 100);

    const reports = await prisma.report.findMany({
      where: {
        ...(deviceId ? { deviceId } : {}),
        ...(periodType ? { periodType } : {}),
        ...(reportUse ? { reportUse } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { device: { select: { id: true, name: true } } },
    });

    const estimatedCosts = await Promise.all(
      reports.map(async (report) => {
        try {
          return await costCalculatorService.calculateEstimatedCost(
            report.deviceId,
            report.startsAt,
            report.endsAt,
          );
        } catch (error) {
          req.log.error(
            {
              err: error,
              reportId: report.id,
              deviceId: report.deviceId,
              startsAt: report.startsAt.toISOString(),
              endsAt: report.endsAt.toISOString(),
            },
            'Failed to calculate estimated report cost for list item',
          );

          return unavailableEstimatedCost(
            report.startsAt,
            report.endsAt,
            'Estimated cost calculation failed.',
          );
        }
      }),
    );

    return {
      count: reports.length,
      data: reports.map((r, index) => ({
        ...(() => {
          let anomalySummary: RawAnomalySummaryRow[] = [];
          try {
            const parsed = JSON.parse(r.anomalySummary) as RawAnomalySummaryRow[];
            anomalySummary = Array.isArray(parsed) ? parsed : [];
          } catch {}

          const powerHealthScore = (r.powerHealthScore as HealthScore | null)
            ?? computePowerHealthScore(anomalySummary);
          const combinedHealthScore = r.combinedHealthScore
            ?? computeCombinedHealthScore(r.healthScore as HealthScore, powerHealthScore);

          return {
            powerHealthScore,
            combinedHealthScore,
          };
        })(),
        id: r.id,
        deviceId: r.deviceId,
        deviceName: r.device.name,
        reportUse: r.reportUse,
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
        estimatedCost: estimatedCosts[index],
      })),
    };
  });

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
    } catch {}

    const anomaliesInRange = await prisma.anomaly.findMany({
      where: {
        deviceId: report.deviceId,
        metricDomain: 'VOLTAGE',
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

    const powerHealthScore = computePowerHealthScore(enrichedAnomalySummary);
    const combinedHealthScore = computeCombinedHealthScore(report.healthScore as HealthScore, powerHealthScore);
    let estimatedCost: EstimatedCostResult;
    try {
      estimatedCost = await costCalculatorService.calculateEstimatedCost(
        report.deviceId,
        report.startsAt,
        report.endsAt,
      );
    } catch (error) {
      req.log.error(
        {
          err: error,
          reportId: report.id,
          deviceId: report.deviceId,
          startsAt: report.startsAt.toISOString(),
          endsAt: report.endsAt.toISOString(),
        },
        'Failed to calculate estimated report cost for detail view',
      );
      estimatedCost = unavailableEstimatedCost(
        report.startsAt,
        report.endsAt,
        'Estimated cost calculation failed.',
      );
    }

    return {
      id: report.id,
      deviceId: report.deviceId,
      deviceName: report.device.name,
      reportUse: report.reportUse,
      periodType: report.periodType,
      startsAt: report.startsAt,
      endsAt: report.endsAt,
      healthScore: report.healthScore,
      powerHealthScore,
      combinedHealthScore,
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
      estimatedCost,
    };
  });
}
