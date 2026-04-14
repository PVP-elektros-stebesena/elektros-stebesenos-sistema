import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import prisma from '../../lib/prisma.js';
import { buildReportInsights } from '../reportInsights.js';
import {
  saveReport,
  type GeneratedReport,
} from '../reportGenerator.js';

let testDeviceId: number;

beforeEach(async () => {
  const device = await prisma.device.create({
    data: { name: 'ReportInsightsTestDevice', pollInterval: 10, isActive: true },
  });
  testDeviceId = device.id;
});

afterEach(async () => {
  await prisma.report.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.anomaly.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.aggregatedData.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.reading.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.device.deleteMany({ where: { id: testDeviceId } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('buildReportInsights', () => {
  it('includes power summary and anomaly distributions in generated insights', async () => {
    await prisma.reading.createMany({
      data: [
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-01T00:00:00.000Z'),
          energyDelivered: 100,
          energyReturned: 20,
        },
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-01T12:00:00.000Z'),
          energyDelivered: 106,
          energyReturned: 21,
        },
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-01T23:50:00.000Z'),
          energyDelivered: 112,
          energyReturned: 22,
        },
      ],
    });

    const insights = await buildReportInsights(
      testDeviceId,
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-04-02T00:00:00.000Z'),
      [
        {
          type: 'POWER_SPIKE',
          phase: 'ALL',
          durationSeconds: 60,
          minVoltage: null,
          maxVoltage: null,
          startsAt: '2026-04-01T08:00:00.000Z',
          endsAt: '2026-04-01T08:01:00.000Z',
          severity: 'CRITICAL',
          metricDomain: 'POWER',
          metricName: 'ACTIVE_POWER_TOTAL',
        },
        {
          type: 'LOW_POWER_FACTOR',
          phase: 'ALL',
          durationSeconds: 120,
          minVoltage: null,
          maxVoltage: null,
          startsAt: '2026-04-01T10:00:00.000Z',
          endsAt: '2026-04-01T10:02:00.000Z',
          severity: 'WARNING',
          metricDomain: 'POWER',
          metricName: 'POWER_FACTOR',
        },
        {
          type: 'UNDER_VOLTAGE',
          phase: 'L1',
          durationSeconds: 180,
          minVoltage: 205,
          maxVoltage: 214,
          startsAt: '2026-04-01T15:00:00.000Z',
          endsAt: '2026-04-01T15:03:00.000Z',
          severity: 'WARNING',
          metricDomain: 'VOLTAGE',
          metricName: null,
        },
      ],
    );

    expect(insights.totalPowerAnomalies).toBe(2);
    expect(insights.powerAnomalyTypeDistribution).toEqual([
      { type: 'POWER_SPIKE', count: 1 },
      { type: 'LOW_POWER_FACTOR', count: 1 },
    ]);
    expect(insights.anomalyTypeDistribution).toEqual([
      { type: 'POWER_SPIKE', count: 1 },
      { type: 'LOW_POWER_FACTOR', count: 1 },
      { type: 'UNDER_VOLTAGE', count: 1 },
    ]);
    expect(insights.narrative).toContain('Power-related observations included 2 anomalies');
  });
});

describe('saveReport', () => {
  it('persists power and combined health scores with the report', async () => {
    const report: GeneratedReport = {
      deviceId: testDeviceId,
      reportUse: 'technical',
      periodType: 'weekly',
      startsAt: new Date('2026-04-07T00:00:00.000Z'),
      endsAt: new Date('2026-04-14T00:00:00.000Z'),
      compliance: {
        weekStart: new Date('2026-04-07T00:00:00.000Z'),
        weekEnd: new Date('2026-04-14T00:00:00.000Z'),
        totalWindows: 1008,
        compliantWindowsL1: 1008,
        compliantWindowsL2: 1008,
        compliantWindowsL3: 1008,
        compliancePctL1: 100,
        compliancePctL2: 100,
        compliancePctL3: 100,
        overallCompliant: true,
      },
      healthScore: 'GREEN',
      powerHealthScore: 'RED',
      combinedHealthScore: 'RED',
      anomalies: [
        {
          type: 'POWER_SPIKE',
          phase: 'ALL',
          durationSeconds: 60,
          minVoltage: null,
          maxVoltage: null,
          startsAt: '2026-04-10T12:00:00.000Z',
          endsAt: '2026-04-10T12:01:00.000Z',
          severity: 'CRITICAL',
          metricDomain: 'POWER',
          metricName: 'ACTIVE_POWER_TOTAL',
        },
      ],
      totalAnomalies: 1,
      criticalCount: 1,
      warningCount: 0,
    };

    await saveReport(report);

    const stored = await prisma.report.findUniqueOrThrow({
      where: {
        deviceId_reportUse_periodType_startsAt_endsAt: {
          deviceId: testDeviceId,
          reportUse: 'technical',
          periodType: 'weekly',
          startsAt: new Date('2026-04-07T00:00:00.000Z'),
          endsAt: new Date('2026-04-14T00:00:00.000Z'),
        },
      },
    });

    expect(stored.powerHealthScore).toBe('RED');
    expect(stored.combinedHealthScore).toBe('RED');
  });
});
