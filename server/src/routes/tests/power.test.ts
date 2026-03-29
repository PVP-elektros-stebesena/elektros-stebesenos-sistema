import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import prisma from '../../lib/prisma.js';
import { powerRoutes } from '../power.js';

let app: FastifyInstance;
let testDeviceId: number;

beforeAll(async () => {
  app = Fastify();
  app.register(powerRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  const device = await prisma.device.create({
    data: { name: 'PowerTestDevice', pollInterval: 10, isActive: true },
  });
  testDeviceId = device.id;
});

afterEach(async () => {
  await prisma.powerPolicyOverride.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.anomaly.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.aggregatedData.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.reading.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.device.deleteMany({ where: { id: testDeviceId } });
});

function injectGet(url: string) {
  return app.inject({ method: 'GET', url });
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

  it('includes ramp-rate breaches when a previous reading exists', async () => {
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
    expect(body.count).toBe(1);
    expect(body.data[0].activePowerAvgTotal).toBe(3.1);
    expect(body.data[0].powerFactorAvg).toBe(0.94);
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
    expect(body.count).toBe(1);
    expect(body.data[0].startsAt).toBe('2026-03-26T08:30:00.000Z');
  });
});

describe('GET /api/power/policy', () => {
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
    expect(body.policy.maxActivePowerKw).toBe(9);
    expect(body.policy.minPowerFactor).toBe(0.92);
  });
});
