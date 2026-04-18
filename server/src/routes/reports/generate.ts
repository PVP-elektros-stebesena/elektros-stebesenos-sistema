import type { FastifyInstance } from 'fastify';
import prisma from '../../lib/prisma.js';
import { notificationService } from '../../services/notificationService.js';
import { buildReportInsights } from '../../services/reportInsights.js';
import { buildPowerQualityAssessment } from '../../services/reportQuality.js';
import { costCalculatorService } from '../../services/costCalculator.js';
import type { EstimatedCostResult } from '../../services/costCalculator.js';
import {
  generateReport,
  resolvePresetPeriodRange,
  saveReport,
  type PeriodType,
  type ReportUse,
} from '../../services/reportGenerator.js';
import { parseDateOrDefault } from '../queryParsers.js';
import { parseCustomRange, unavailableEstimatedCost } from './shared.js';

export function registerReportGenerateRoute(fastify: FastifyInstance): void {
  fastify.post<{
    Body: {
      deviceId: number;
      reportUse: ReportUse;
      periodType: PeriodType;
      date?: string;
      startDate?: string;
      endDate?: string;
    };
  }>('/api/reports/generate', async (req, reply) => {
    const { deviceId, reportUse, periodType, date: dateStr, startDate, endDate } = req.body;

    if (!deviceId || !periodType || !reportUse) {
      return reply.code(400).send({
        error: 'MISSING_FIELDS',
        message: 'deviceId, reportUse and periodType are required',
      });
    }

    if (!['home', 'technical', 'solar'].includes(reportUse)) {
      return reply.code(400).send({
        error: 'INVALID_REPORT_USE',
        message: 'reportUse must be one of: home, technical, solar',
      });
    }

    if (!['daily', 'weekly', 'biweekly', 'monthly', 'custom'].includes(periodType)) {
      return reply.code(400).send({
        error: 'INVALID_PERIOD',
        message: 'periodType must be one of: daily, weekly, biweekly, monthly, custom',
      });
    }

    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) {
      return reply.code(404).send({
        error: 'DEVICE_NOT_FOUND',
        message: `Device ${deviceId} not found`,
      });
    }

    const parsedTargetDate = parseDateOrDefault(dateStr, new Date(), 'date');
    if (!parsedTargetDate.ok) {
      return reply.code(parsedTargetDate.statusCode).send(parsedTargetDate.body);
    }

    const targetDate = parsedTargetDate.value;
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

    const report = await generateReport(deviceId, reportUse, periodType, startsAt, endsAt);
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
    let estimatedCost: EstimatedCostResult;
    try {
      estimatedCost = await costCalculatorService.calculateEstimatedCost(deviceId, startsAt, endsAt);
    } catch (error) {
      req.log.error(
        { err: error, deviceId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
        'Failed to calculate estimated report cost',
      );
      estimatedCost = unavailableEstimatedCost(startsAt, endsAt, 'Estimated cost calculation failed.');
    }

    return {
      message: `${reportUse} ${periodType} report generated successfully`,
      report: {
        deviceId: report.deviceId,
        reportUse: report.reportUse,
        periodType: report.periodType,
        startsAt: report.startsAt,
        endsAt: report.endsAt,
        healthScore: report.healthScore,
        powerHealthScore: report.powerHealthScore,
        combinedHealthScore: report.combinedHealthScore,
        compliancePctL1: report.compliance.compliancePctL1,
        compliancePctL2: report.compliance.compliancePctL2,
        compliancePctL3: report.compliance.compliancePctL3,
        overallCompliant: report.compliance.overallCompliant,
        totalAnomalies: report.totalAnomalies,
        criticalCount: report.criticalCount,
        warningCount: report.warningCount,
        insights,
        powerQuality,
        estimatedCost,
      },
    };
  });
}
