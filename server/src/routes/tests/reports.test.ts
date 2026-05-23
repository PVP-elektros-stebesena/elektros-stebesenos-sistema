import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import prisma from '../../lib/prisma.js';
import { reportRoutes } from '../reports.js';
import { costCalculatorService } from '../../services/costCalculator.js';
import { clearPowerPolicyCache } from '../../services/powerPolicy.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.addHook('onRequest', async (req) => {
    const rawUserId = req.headers['x-test-user-id'];
    if (typeof rawUserId !== 'string') return;

    const userId = Number(rawUserId);
    if (!Number.isSafeInteger(userId) || userId <= 0) return;

    req.authUser = {
      id: userId,
      email: `report-user-${userId}@example.com`,
      username: `report_user_${userId}`,
      displayName: `Report User ${userId}`,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      lastLoginAt: null,
    };
  });
  await app.register(reportRoutes);
  await app.ready();
});

beforeEach(async () => {
  clearPowerPolicyCache();
  await prisma.report.deleteMany();
  await prisma.anomaly.deleteMany();
  await prisma.aggregatedData.deleteMany();
  await prisma.reading.deleteMany();
  await prisma.billingPlan.deleteMany();
  await prisma.spotPrice.deleteMany();
  await prisma.device.deleteMany();
  await prisma.user.deleteMany({ where: { email: { contains: 'report-scope-' } } });
});

afterAll(async () => {
  await prisma.report.deleteMany();
  await prisma.anomaly.deleteMany();
  await prisma.aggregatedData.deleteMany();
  await prisma.reading.deleteMany();
  await prisma.billingPlan.deleteMany();
  await prisma.spotPrice.deleteMany();
  await prisma.device.deleteMany();
  await prisma.user.deleteMany({ where: { email: { contains: 'report-scope-' } } });
  await prisma.$disconnect();
  await app.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('report routes estimatedCost', () => {
  it('scopes report list, detail, and generation to the authenticated user devices', async () => {
    const [owner, other] = await Promise.all([
      prisma.user.create({
        data: {
          email: `report-scope-owner-${Date.now()}@example.com`,
          passwordHash: 'test-hash',
        },
      }),
      prisma.user.create({
        data: {
          email: `report-scope-other-${Date.now()}@example.com`,
          passwordHash: 'test-hash',
        },
      }),
    ]);

    const [ownerDevice, otherDevice] = await Promise.all([
      prisma.device.create({
        data: { name: 'Owner report device', userId: owner.id, pollInterval: 10, isActive: true },
      }),
      prisma.device.create({
        data: { name: 'Other report device', userId: other.id, pollInterval: 10, isActive: true },
      }),
    ]);

    const reportPayload = {
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
    };

    const [ownerReport, otherReport] = await Promise.all([
      prisma.report.create({ data: { ...reportPayload, deviceId: ownerDevice.id } }),
      prisma.report.create({ data: { ...reportPayload, deviceId: otherDevice.id } }),
    ]);

    const ownerHeaders = { 'x-test-user-id': String(owner.id) };
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/reports?limit=10',
      headers: ownerHeaders,
    });

    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().data.map((item: { id: number }) => item.id)).toEqual([ownerReport.id]);

    const otherDetailRes = await app.inject({
      method: 'GET',
      url: `/api/reports/${otherReport.id}`,
      headers: ownerHeaders,
    });
    expect(otherDetailRes.statusCode).toBe(404);

    const generateOtherRes = await app.inject({
      method: 'POST',
      url: '/api/reports/generate',
      headers: ownerHeaders,
      payload: {
        deviceId: otherDevice.id,
        reportUse: 'home',
        periodType: 'custom',
        startDate: '2026-04-01T00:00:00.000Z',
        endDate: '2026-04-02T00:00:00.000Z',
      },
    });
    expect(generateOtherRes.statusCode).toBe(404);
  });

  it('includes estimatedCost on report list and detail responses', async () => {
    const device = await prisma.device.create({
      data: {
        name: 'Report billing device',
        pollInterval: 10,
        isActive: true,
        maxGridCapacityKw: 50,
      },
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
          reactiveEnergyDelivered: 5,
          reactiveEnergyReturned: 1,
        },
        {
          deviceId: device.id,
          timestamp: new Date('2026-04-02T00:00:00.000Z'),
          energyDelivered: 101.5,
          energyDeliveredTariff1: 51.5,
          reactiveEnergyDelivered: 7,
          reactiveEnergyReturned: 3,
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
    expect(detailRes.json().reactivePenalty.status).toBe('complete');
    expect(detailRes.json().reactivePenalty.totalEur).toBeCloseTo(0.11, 6);
    expect(detailRes.json().reactivePenalty.chargeableReactiveReturnedKvarh).toBe(2);
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
