import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import prisma from '../../lib/prisma.js';
import { powerRoutes } from '../power.js';
import { clearPowerPolicyCache } from '../../services/powerPolicy.js';

let app: FastifyInstance;
let testDeviceId: number;
let ownerUserId: number;
let otherUserId: number;

beforeAll(async () => {
  app = Fastify();
  app.addHook('onRequest', async (req) => {
    const rawUserId = req.headers['x-test-user-id'];
    if (typeof rawUserId !== 'string') {
      return;
    }

    const userId = Number(rawUserId);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return;
    }

    req.authUser = {
      id: userId,
      email: `user${userId}@example.com`,
      username: `user${userId}`,
      displayName: `User ${userId}`,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      lastLoginAt: null,
    };
  });
  app.register(powerRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  clearPowerPolicyCache();
  const [owner, other] = await Promise.all([
    prisma.user.create({
      data: {
        email: `power-owner-${Date.now()}-${Math.random()}@example.com`,
        username: `power_owner_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
        passwordHash: 'test-hash',
      },
    }),
    prisma.user.create({
      data: {
        email: `power-other-${Date.now()}-${Math.random()}@example.com`,
        username: `power_other_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
        passwordHash: 'test-hash',
      },
    }),
  ]);
  ownerUserId = owner.id;
  otherUserId = other.id;

  const device = await prisma.device.create({
    data: { name: 'PowerTestDevice', pollInterval: 10, isActive: true },
  });
  testDeviceId = device.id;
});

afterEach(async () => {
  await prisma.standbyBaseline.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.powerPolicyOverride.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.anomaly.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.aggregatedData.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.reading.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.device.deleteMany({ where: { id: testDeviceId } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerUserId, otherUserId] } } });
});

function injectGet(url: string, headers?: Record<string, string>) {
  return app.inject({ method: 'GET', url, headers });
}

describe('GET /api/power/latest', () => {
  it('returns 503 when no data exists', async () => {
    const res = await injectGet(`/api/power/latest?deviceId=${testDeviceId}`);
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('NO_DATA');
  });

  it('returns latest power metrics and policy', async () => {
    await prisma.reading.create({
      data: {
        deviceId: testDeviceId,
        timestamp: new Date('2026-03-26T09:00:00Z'),
        powerDeliveredTotal: 4.2,
        powerReturnedTotal: 0.3,
        activeInstantaneousPowerDeliveredL1: 1.4,
        activeInstantaneousPowerDeliveredL2: 1.3,
        activeInstantaneousPowerDeliveredL3: 1.5,
        apparentInstantaneousPower: 4.5,
      },
    });

    const res = await injectGet(`/api/power/latest?deviceId=${testDeviceId}`);
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.deviceId).toBe(testDeviceId);
    expect(body.activePowerTotalKw).toBeCloseTo(3.9);
    expect(body.apparentPowerTotalKva).toBe(4.5);
    expect(body.powerFactor).toBeGreaterThan(0.8);
    expect(body.policy).toBeDefined();
    expect(Array.isArray(body.breaches)).toBe(true);
  });

  it('derives power factor and imbalance when the meter reports zero apparent power', async () => {
    await prisma.reading.create({
      data: {
        deviceId: testDeviceId,
        timestamp: new Date('2026-04-15T12:17:58Z'),
        activeInstantaneousPowerDelivered: 2.559,
        activeInstantaneousPowerDeliveredL1: 0,
        activeInstantaneousPowerDeliveredL2: 0,
        activeInstantaneousPowerDeliveredL3: 0,
        activeInstantaneousPowerReturnedL1: 0.799,
        activeInstantaneousPowerReturnedL2: 0.915,
        activeInstantaneousPowerReturnedL3: 0.845,
        reactiveInstantaneousPowerDeliveredL1: 0,
        reactiveInstantaneousPowerDeliveredL2: 0,
        reactiveInstantaneousPowerDeliveredL3: 0,
        reactiveInstantaneousPowerReturnedL1: 0.085,
        reactiveInstantaneousPowerReturnedL2: 0.03,
        reactiveInstantaneousPowerReturnedL3: 0.015,
        apparentInstantaneousPower: 0,
        apparentInstantaneousPowerL1: 0,
        apparentInstantaneousPowerL2: 0,
        apparentInstantaneousPowerL3: 0,
        powerDeliveredTotal: 0,
        powerReturnedTotal: 2.559,
      },
    });

    const res = await injectGet(`/api/power/latest?deviceId=${testDeviceId}`);
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.apparentPowerTotalKva).toBeCloseTo(2.5623, 4);
    expect(body.powerFactor).toBeCloseTo(0.9987, 4);
    expect(body.phaseImbalancePct).toBeCloseTo(7.2685, 4);
  });

  it('includes ramp-rate breaches for commercial-scale devices when a previous reading exists', async () => {
    await prisma.device.update({
      where: { id: testDeviceId },
      data: { powerProfile: 'COMMERCIAL_3P_30KW' },
    });
    clearPowerPolicyCache(testDeviceId);

    await prisma.reading.createMany({
      data: [
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-03-26T08:59:00Z'),
          powerDeliveredTotal: 2,
          activeInstantaneousPowerDeliveredL1: 0.7,
          activeInstantaneousPowerDeliveredL2: 0.7,
          activeInstantaneousPowerDeliveredL3: 0.6,
          apparentInstantaneousPower: 2.2,
        },
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-03-26T09:00:00Z'),
          powerDeliveredTotal: 12,
          activeInstantaneousPowerDeliveredL1: 4,
          activeInstantaneousPowerDeliveredL2: 4,
          activeInstantaneousPowerDeliveredL3: 4,
          apparentInstantaneousPower: 13,
        },
      ],
    });

    const res = await injectGet(`/api/power/latest?deviceId=${testDeviceId}`);
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.breaches).toEqual(expect.arrayContaining([
      expect.objectContaining({ metricName: 'ACTIVE_POWER_RAMP' }),
    ]));
  });
});

describe('GET /api/power/history', () => {
  it('returns 10-minute aggregated power windows', async () => {
    await prisma.aggregatedData.create({
      data: {
        deviceId: testDeviceId,
        startsAt: new Date('2026-03-26T08:55:00Z'),
        endsAt: new Date('2026-03-26T09:05:00Z'),
        sampleCount: 60,
        activePowerAvgTotal: 2.7,
        activePowerMaxTotal: 3.8,
        reactivePowerAvgTotal: 0.4,
        powerFactorAvg: 0.91,
        powerImbalancePct: 4.2,
        powerPolicyBreached: false,
      },
    });

    await prisma.aggregatedData.create({
      data: {
        deviceId: testDeviceId,
        startsAt: new Date('2026-03-26T09:00:00Z'),
        endsAt: new Date('2026-03-26T09:10:00Z'),
        sampleCount: 60,
        activePowerAvgTotal: 3.1,
        activePowerMaxTotal: 4.2,
        reactivePowerAvgTotal: 0.6,
        powerFactorAvg: 0.94,
        powerImbalancePct: 8.5,
        powerPolicyBreached: false,
      },
    });

    const res = await injectGet(
      `/api/power/history?deviceId=${testDeviceId}&from=2026-03-26T09:00:00Z&to=2026-03-26T09:20:00Z&interval=10min`,
    );
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.interval).toBe('10min');
    expect(body.count).toBe(2);
    expect(body.data[0].activePowerAvgTotal).toBe(2.7);
    expect(body.data[1].activePowerAvgTotal).toBe(3.1);
    expect(body.data[1].powerFactorAvg).toBe(0.94);
  });

  it('respects the points limit in raw history downsampling', async () => {
    const base = new Date('2026-03-26T09:00:00Z');

    for (let i = 0; i < 20; i++) {
      await prisma.reading.create({
        data: {
          deviceId: testDeviceId,
          timestamp: new Date(base.getTime() + i * 10_000),
          powerDeliveredTotal: 2 + i * 0.1,
          activeInstantaneousPowerDeliveredL1: 0.7,
          activeInstantaneousPowerDeliveredL2: 0.7,
          activeInstantaneousPowerDeliveredL3: 0.6,
          apparentInstantaneousPower: 2.5,
        },
      });
    }

    const res = await injectGet(
      `/api/power/history?deviceId=${testDeviceId}&from=2026-03-26T09:00:00Z&to=2026-03-26T09:05:00Z&points=5&interval=raw`,
    );
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.interval).toBe('raw');
    expect(body.count).toBe(5);
  });
});

describe('GET /api/power/grid-compliance', () => {
  it('returns 400 when deviceId is missing', async () => {
    const res = await injectGet('/api/power/grid-compliance');

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('MISSING_DEVICE_ID');
  });

  it('rejects ranges longer than 62 days', async () => {
    const res = await injectGet(
      `/api/power/grid-compliance?deviceId=${testDeviceId}&from=2026-01-01T00:00:00Z&to=2026-04-01T00:00:00Z`,
    );

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('RANGE_TOO_LONG');
  });

  it('returns penalty estimate and flags low power factor windows for a commercial device', async () => {
    await prisma.device.update({
      where: { id: testDeviceId },
      data: { maxGridCapacityKw: 50 },
    });

    await prisma.aggregatedData.createMany({
      data: [
        {
          deviceId: testDeviceId,
          startsAt: new Date('2026-04-01T08:55:00.000Z'),
          endsAt: new Date('2026-04-01T09:05:00.000Z'),
          sampleCount: 60,
          reactivePowerAvgTotal: 0.4,
          powerFactorAvg: 0.97,
        },
        {
          deviceId: testDeviceId,
          startsAt: new Date('2026-04-01T09:00:00.000Z'),
          endsAt: new Date('2026-04-01T09:10:00.000Z'),
          sampleCount: 60,
          reactivePowerAvgTotal: 1.2,
          powerFactorAvg: 0.94,
        },
        {
          deviceId: testDeviceId,
          startsAt: new Date('2026-04-01T09:10:00.000Z'),
          endsAt: new Date('2026-04-01T09:20:00.000Z'),
          sampleCount: 60,
          reactivePowerAvgTotal: 0.7,
          powerFactorAvg: 0.98,
        },
      ],
    });

    await prisma.reading.createMany({
      data: [
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-01T09:00:00.000Z'),
          energyDelivered: 100,
          reactiveEnergyDelivered: 20,
          reactiveEnergyReturned: 5,
        },
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-01T09:09:00.000Z'),
          energyDelivered: 110,
          reactiveEnergyDelivered: 30,
          reactiveEnergyReturned: 8,
        },
      ],
    });

    const res = await injectGet(
      `/api/power/grid-compliance?deviceId=${testDeviceId}&from=2026-04-01T09:00:00Z&to=2026-04-01T09:20:00Z`,
    );
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.penaltyEstimate.status).toBe('complete');
    expect(body.penaltyEstimate.reactiveReturnedKvarh).toBe(3);
    expect(body.summary.lowPowerFactorWindowCount).toBe(1);
    expect(body.data).toHaveLength(3);
    expect(body.data[0]).toMatchObject({
      timestamp: '2026-04-01T08:55:00.000Z',
      reactivePowerTotalKvar: 0.4,
      powerFactor: 0.97,
      lowPowerFactor: false,
    });
    expect(body.data[1]).toMatchObject({
      reactivePowerTotalKvar: 1.2,
      reactiveEnergyReturnedKvarh: 3,
      powerFactor: 0.94,
      lowPowerFactor: true,
    });
    expect(body.data[2].lowPowerFactor).toBe(false);
  });
});

describe('GET /api/power/summary', () => {
  it('returns phase imbalance recommendations for consistently heavy phase', async () => {
    const now = new Date();
    const windowStarts = [
      new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000),
      new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
      new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
    ];

    await prisma.aggregatedData.createMany({
      data: windowStarts.map((startsAt) => ({
        deviceId: testDeviceId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 10 * 60 * 1000),
        sampleCount: 60,
        powerImbalancePct: 42,
        activePowerAvgL1: 7.0,
        activePowerAvgL2: 2.1,
        activePowerAvgL3: 1.4,
      })),
    });

    const res = await injectGet(`/api/power/summary?deviceId=${testDeviceId}`);
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.insights.phaseRecommendations.length).toBe(1);
    expect(body.insights.phaseRecommendations[0]).toContain('Phase L1 carries');
  });

  it('skips phase imbalance recommendations for single-phase profiles', async () => {
    await prisma.device.update({
      where: { id: testDeviceId },
      data: { powerProfile: 'APARTMENT_1P_5KW' },
    });
    await prisma.reading.create({
      data: {
        deviceId: testDeviceId,
        timestamp: new Date(),
        powerDeliveredTotal: 4,
      },
    });

    const now = new Date();
    const windowStarts = [
      new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000),
      new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
      new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
    ];

    await prisma.aggregatedData.createMany({
      data: windowStarts.map((startsAt) => ({
        deviceId: testDeviceId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 10 * 60 * 1000),
        sampleCount: 60,
        powerImbalancePct: 60,
        activePowerAvgL1: 4.0,
        activePowerAvgL2: 0,
        activePowerAvgL3: 0,
      })),
    });

    const res = await injectGet(`/api/power/summary?deviceId=${testDeviceId}`);
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.policy.phaseCount).toBe(1);
    expect(body.insights.phaseRecommendations).toEqual([]);
  });

  it('uses the selected profile threshold for phase imbalance recommendations', async () => {
    await prisma.device.update({
      where: { id: testDeviceId },
      data: { powerProfile: 'SOLAR_PROSUMER_3P_22KW' },
    });
    await prisma.reading.create({
      data: {
        deviceId: testDeviceId,
        timestamp: new Date(),
        powerDeliveredTotal: 6,
      },
    });

    const now = new Date();
    const windowStarts = [
      new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000),
      new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
      new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
    ];

    await prisma.aggregatedData.createMany({
      data: windowStarts.map((startsAt) => ({
        deviceId: testDeviceId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 10 * 60 * 1000),
        sampleCount: 60,
        powerImbalancePct: 32,
        activePowerAvgL1: 4.0,
        activePowerAvgL2: 1.2,
        activePowerAvgL3: 0.8,
      })),
    });

    const res = await injectGet(`/api/power/summary?deviceId=${testDeviceId}`);
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.policy.maxPhaseImbalancePct).toBe(35);
    expect(body.insights.phaseRecommendations).toEqual([]);
  });
});

describe('GET /api/power/solar-summary', () => {
  it('returns daily import/export totals and current export status', async () => {
    const now = new Date();
    const t0 = new Date(now.getTime() - 30 * 60 * 1000);
    const t1 = new Date(now.getTime() - 10 * 60 * 1000);

    await prisma.reading.createMany({
      data: [
        {
          deviceId: testDeviceId,
          timestamp: t0,
          energyDelivered: 100,
          energyReturned: 20,
          powerDeliveredTotal: 0,
          powerReturnedTotal: 3.1,
        },
        {
          deviceId: testDeviceId,
          timestamp: t1,
          energyDelivered: 104,
          energyReturned: 26,
          powerDeliveredTotal: 0,
          powerReturnedTotal: 3.3,
        },
      ],
    });

    const res = await injectGet(`/api/power/solar-summary?deviceId=${testDeviceId}&days=1`);
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.count).toBe(1);
    expect(body.totals.importedKwh).toBe(4);
    expect(body.totals.exportedKwh).toBe(6);
    expect(body.totals.selfConsumptionRatioPct).toBe(40);
    expect(body.currentExport.exporting).toBe(true);
    expect(body.currentExport.opportunity).toBe(true);
  });
});

describe('GET /api/power/anomalies', () => {
  it('returns only power-domain anomalies', async () => {
    await prisma.anomaly.createMany({
      data: [
        {
          deviceId: testDeviceId,
          startsAt: new Date('2026-03-26T08:00:00Z'),
          endsAt: new Date('2026-03-26T08:01:00Z'),
          phase: 'ALL',
          type: 'POWER_SPIKE',
          severity: 2,
          metricDomain: 'POWER',
          metricName: 'ACTIVE_POWER_TOTAL',
          thresholdValue: 12,
          observedMax: 14.4,
          unit: 'kW',
        },
        {
          deviceId: testDeviceId,
          startsAt: new Date('2026-03-26T08:05:00Z'),
          endsAt: new Date('2026-03-26T08:06:00Z'),
          phase: 'L1',
          type: 'VOLTAGE_DEVIATION',
          severity: 1,
          metricDomain: 'VOLTAGE',
        },
      ],
    });

    const res = await injectGet(`/api/power/anomalies?deviceId=${testDeviceId}`);
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.count).toBe(1);
    expect(body.data[0].metricDomain).toBe('POWER');
  });

  it('applies both from and to bounds together', async () => {
    await prisma.anomaly.createMany({
      data: [
        {
          deviceId: testDeviceId,
          startsAt: new Date('2026-03-26T07:59:00Z'),
          endsAt: new Date('2026-03-26T08:00:00Z'),
          phase: 'ALL',
          type: 'POWER_SPIKE',
          severity: 2,
          metricDomain: 'POWER',
        },
        {
          deviceId: testDeviceId,
          startsAt: new Date('2026-03-26T08:30:00Z'),
          endsAt: new Date('2026-03-26T08:31:00Z'),
          phase: 'ALL',
          type: 'POWER_SPIKE',
          severity: 2,
          metricDomain: 'POWER',
        },
        {
          deviceId: testDeviceId,
          startsAt: new Date('2026-03-26T09:01:00Z'),
          endsAt: new Date('2026-03-26T09:02:00Z'),
          phase: 'ALL',
          type: 'POWER_SPIKE',
          severity: 2,
          metricDomain: 'POWER',
        },
      ],
    });

    const res = await injectGet(
      `/api/power/anomalies?deviceId=${testDeviceId}&from=2026-03-26T08:00:00Z&to=2026-03-26T09:00:00Z`,
    );
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.count).toBe(2);
    expect(body.data.map((item: { startsAt: string }) => item.startsAt)).toEqual([
      '2026-03-26T08:30:00.000Z',
      '2026-03-26T07:59:00.000Z',
    ]);
  });
});

describe('GET /api/power/policy', () => {
  it('returns the selected preset policy when no override exists', async () => {
    await prisma.device.update({
      where: { id: testDeviceId },
      data: { powerProfile: 'SOLAR_PROSUMER_3P_22KW' },
    });

    const res = await injectGet(`/api/power/policy?deviceId=${testDeviceId}`);
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.policy.source).toBe('profile_preset');
    expect(body.policy.profile).toBe('SOLAR_PROSUMER_3P_22KW');
    expect(body.policy.warningThreshold).toBe(19.8);
    expect(body.policy.criticalThreshold).toBe(22);
    expect(body.policy.perPhaseCurrentLimitAmps).toBe(32);
    expect(body.policy.targetPowerFactor).toBe(0.9);
  });

  it('returns effective override policy when configured', async () => {
    await prisma.powerPolicyOverride.create({
      data: {
        deviceId: testDeviceId,
        maxActivePowerKw: 9,
        minPowerFactor: 0.92,
        enabled: true,
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        policyVersion: 'override-v1',
      },
    });

    const res = await injectGet(`/api/power/policy?deviceId=${testDeviceId}`);
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.policy.source).toBe('device_override');
    expect(body.policy.profile).toBe('HOUSE_3P_11KW');
    expect(body.policy.warningThreshold).toBe(8.1);
    expect(body.policy.criticalThreshold).toBe(9);
    expect(body.policy.minPowerFactor).toBe(0.92);
  });
});

describe('GET /api/power/standby', () => {
  it('returns 400 when deviceId is missing', async () => {
    const res = await injectGet('/api/power/standby');

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'MISSING_DEVICE_ID',
      message: 'deviceId query parameter is required',
    });
  });

  it('returns a complete ghost-load overview when a standby baseline and fixed tariff are available', async () => {
    await prisma.standbyBaseline.create({
      data: {
        deviceId: testDeviceId,
        baselineDate: '2026-04-06',
        baselinePowerKw: 0.25,
        windowStartsAt: new Date('2026-04-06T23:00:00.000Z'),
        windowEndsAt: new Date('2026-04-06T23:10:00.000Z'),
        sampleCount: 60,
      },
    });

    await prisma.billingPlan.create({
      data: {
        deviceId: testDeviceId,
        pricingMode: 'FIXED',
        effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
        rateT1: 0.12,
        rateT2: 0.21,
        monthlyFixedFeeEur: null,
      },
    });

    await prisma.reading.create({
      data: {
        deviceId: testDeviceId,
        timestamp: new Date('2026-04-07T06:00:00.000Z'),
        electricityTariff: 1,
      },
    });

    const res = await injectGet(`/api/power/standby?deviceId=${testDeviceId}`);
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.status).toBe('complete');
    expect(body.baselineDate).toBe('2026-04-06');
    expect(body.baselinePowerWatts).toBe(250);
    expect(body.projectedDailyKwh).toBeCloseTo(6, 6);
    expect(body.currentRateEurPerKwh).toBeCloseTo(0.12, 6);
    expect(body.projectedMonthlyCostEur).toBeGreaterThan(0);
  });

  it('returns unavailable when no standby baseline exists for the device', async () => {
    const res = await injectGet(`/api/power/standby?deviceId=${testDeviceId}`);
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.status).toBe('unavailable');
    expect(body.baselineDate).toBeNull();
    expect(body.baselinePowerKw).toBeNull();
    expect(body.projectedMonthlyCostEur).toBeNull();
    expect(body.messageCode).toBe('NO_BASELINE');
    expect(body.message).toBe('No standby baseline is available yet.');
  });

  it('returns 404 when the requested device belongs to a different authenticated user', async () => {
    await prisma.device.update({
      where: { id: testDeviceId },
      data: { userId: ownerUserId },
    });

    const res = await injectGet(
      `/api/power/standby?deviceId=${testDeviceId}`,
      { 'x-test-user-id': String(otherUserId) },
    );

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NOT_FOUND');
  });

  it('returns the standby overview when the authenticated user owns the device', async () => {
    await prisma.device.update({
      where: { id: testDeviceId },
      data: { userId: ownerUserId },
    });

    await prisma.standbyBaseline.create({
      data: {
        deviceId: testDeviceId,
        baselineDate: '2026-04-06',
        baselinePowerKw: 0.19,
        windowStartsAt: new Date('2026-04-06T23:10:00.000Z'),
        windowEndsAt: new Date('2026-04-06T23:20:00.000Z'),
        sampleCount: 60,
      },
    });

    const res = await injectGet(
      `/api/power/standby?deviceId=${testDeviceId}`,
      { 'x-test-user-id': String(ownerUserId) },
    );

    expect(res.statusCode).toBe(200);
    expect(res.json().baselinePowerWatts).toBe(190);
  });
});
