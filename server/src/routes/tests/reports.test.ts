import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import prisma from '../../lib/prisma.js';
import { reportRoutes } from '../reports.js';
import { costCalculatorService } from '../../services/costCalculator.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(reportRoutes);
  await app.ready();
});

beforeEach(async () => {
  await prisma.report.deleteMany();
  await prisma.anomaly.deleteMany();
  await prisma.aggregatedData.deleteMany();
  await prisma.reading.deleteMany();
  await prisma.billingPlan.deleteMany();
  await prisma.spotPrice.deleteMany();
  await prisma.device.deleteMany();
});

afterAll(async () => {
  await prisma.report.deleteMany();
  await prisma.anomaly.deleteMany();
  await prisma.aggregatedData.deleteMany();
  await prisma.reading.deleteMany();
  await prisma.billingPlan.deleteMany();
  await prisma.spotPrice.deleteMany();
  await prisma.device.deleteMany();
  await prisma.$disconnect();
  await app.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('report routes estimatedCost', () => {
  it('includes estimatedCost on report list and detail responses', async () => {
    const device = await prisma.device.create({
      data: { name: 'Report billing device', pollInterval: 10, isActive: true },
    });

    await prisma.billingPlan.create({
      data: {
        deviceId: device.id,
        pricingMode: 'FIXED',
        effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
        rateT1: 0.2,
        rateT2: null,
        rateT3: null,
        rateT4: null,
        monthlyFixedFeeEur: null,
      },
    });

    await prisma.reading.createMany({
      data: [
        {
          deviceId: device.id,
          timestamp: new Date('2026-04-01T00:00:00.000Z'),
          energyDelivered: 100,
          energyDeliveredTariff1: 50,
        },
        {
          deviceId: device.id,
          timestamp: new Date('2026-04-02T00:00:00.000Z'),
          energyDelivered: 101.5,
          energyDeliveredTariff1: 51.5,
        },
      ],
    });

    const report = await prisma.report.create({
      data: {
        deviceId: device.id,
        reportUse: 'home',
        periodType: 'daily',
        startsAt: new Date('2026-04-01T00:00:00.000Z'),
        endsAt: new Date('2026-04-02T00:00:00.000Z'),
        totalWindows: 144,
        compliantWindowsL1: 144,
        compliantWindowsL2: 144,
        compliantWindowsL3: 144,
        compliancePctL1: 100,
        compliancePctL2: 100,
        compliancePctL3: 100,
        overallCompliant: true,
        healthScore: 'GREEN',
        powerHealthScore: 'GREEN',
        combinedHealthScore: 'GREEN',
        anomalySummary: '[]',
        totalAnomalies: 0,
        criticalCount: 0,
        warningCount: 0,
      },
    });

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/reports?deviceId=${device.id}&limit=5`,
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().data[0].estimatedCost.totalEur).toBeCloseTo(0.3, 6);
    expect(listRes.json().data[0].estimatedCost.status).toBe('complete');

    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/reports/${report.id}`,
    });
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json().estimatedCost.totalEur).toBeCloseTo(0.3, 6);
    expect(detailRes.json().estimatedCost.breakdown[0].pricingMode).toBe('FIXED');
  });

  it('returns unavailable estimatedCost in list and detail when calculation fails', async () => {
    const device = await prisma.device.create({
      data: { name: 'Report estimation fallback device', pollInterval: 10, isActive: true },
    });

    const report = await prisma.report.create({
      data: {
        deviceId: device.id,
        reportUse: 'home',
        periodType: 'daily',
        startsAt: new Date('2026-04-01T00:00:00.000Z'),
        endsAt: new Date('2026-04-02T00:00:00.000Z'),
        totalWindows: 144,
        compliantWindowsL1: 144,
        compliantWindowsL2: 144,
        compliantWindowsL3: 144,
        compliancePctL1: 100,
        compliancePctL2: 100,
        compliancePctL3: 100,
        overallCompliant: true,
        healthScore: 'GREEN',
        powerHealthScore: 'GREEN',
        combinedHealthScore: 'GREEN',
        anomalySummary: '[]',
        totalAnomalies: 0,
        criticalCount: 0,
        warningCount: 0,
      },
    });

    vi.spyOn(costCalculatorService, 'calculateEstimatedCost')
      .mockRejectedValueOnce(new Error('simulated list estimation failure'))
      .mockRejectedValueOnce(new Error('simulated detail estimation failure'));

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/reports?deviceId=${device.id}&limit=5`,
    });

    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().data[0].estimatedCost.status).toBe('unavailable');
    expect(listRes.json().data[0].estimatedCost.totalEur).toBe(0);
    expect(listRes.json().data[0].estimatedCost.missingCoveragePct).toBe(100);

    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/reports/${report.id}`,
    });

    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json().estimatedCost.status).toBe('unavailable');
    expect(detailRes.json().estimatedCost.totalEur).toBe(0);
    expect(detailRes.json().estimatedCost.missingCoveragePct).toBe(100);
  });
});
