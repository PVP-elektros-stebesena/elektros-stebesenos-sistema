import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import prisma from '../../lib/prisma.js';
import { usageInsightsRoutes } from '../usageInsights.js';

let app: FastifyInstance;
let ownerUserId: number;
let otherUserId: number;
let ownerDeviceId: number;
let otherDeviceId: number;

beforeAll(async () => {
  app = Fastify();
  app.addHook('onRequest', async (req) => {
    const rawUserId = req.headers['x-test-user-id'];
    if (typeof rawUserId !== 'string') return;

    const userId = Number(rawUserId);
    if (!Number.isSafeInteger(userId) || userId <= 0) return;

    req.authUser = {
      id: userId,
      email: `usage-route-${userId}@example.com`,
      username: `usage_route_${userId}`,
      displayName: `Usage Route ${userId}`,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      lastLoginAt: null,
    };
  });
  app.register(usageInsightsRoutes);
  await app.ready();
});

beforeEach(async () => {
  const [owner, other] = await Promise.all([
    prisma.user.create({
      data: {
        email: `usage-route-owner-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: 'test-hash',
      },
    }),
    prisma.user.create({
      data: {
        email: `usage-route-other-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: 'test-hash',
      },
    }),
  ]);

  ownerUserId = owner.id;
  otherUserId = other.id;

  const [ownerDevice, otherDevice] = await Promise.all([
    prisma.device.create({
      data: {
        userId: ownerUserId,
        name: 'Owner usage device',
      },
    }),
    prisma.device.create({
      data: {
        userId: otherUserId,
        name: 'Other usage device',
      },
    }),
  ]);

  ownerDeviceId = ownerDevice.id;
  otherDeviceId = otherDevice.id;
});

afterEach(async () => {
  await prisma.usageAnomalyEvent.deleteMany({
    where: { userId: { in: [ownerUserId, otherUserId] } },
  });
  await prisma.usageAnomalySetting.deleteMany({
    where: { userId: { in: [ownerUserId, otherUserId] } },
  });
  await prisma.device.deleteMany({ where: { id: { in: [ownerDeviceId, otherDeviceId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerUserId, otherUserId] } } });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

function authHeaders(userId = ownerUserId) {
  return { 'x-test-user-id': String(userId) };
}

function injectGet(url: string, userId = ownerUserId) {
  return app.inject({
    method: 'GET',
    url,
    headers: authHeaders(userId),
  });
}

function injectPut(url: string, payload: unknown, userId = ownerUserId) {
  return app.inject({
    method: 'PUT',
    url,
    headers: authHeaders(userId),
    payload: payload as Record<string, unknown>,
  });
}

describe('usage insights routes', () => {
  it('creates and returns default settings for the authenticated tenant', async () => {
    const res = await injectGet('/api/usage-insights/settings');
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({
      enabled: true,
      baselineWeeks: 4,
      thresholdPct: 25,
      sustainedIntervals: 3,
      scope: 'PER_DEVICE',
    });

    const persisted = await prisma.usageAnomalySetting.findUnique({
      where: { userId: ownerUserId },
    });
    expect(persisted).not.toBeNull();
  });

  it('validates and persists settings updates per tenant', async () => {
    const res = await injectPut('/api/usage-insights/settings', {
      enabled: false,
      baselineWeeks: 8,
      thresholdPct: 125,
      sustainedIntervals: 6,
      scope: 'PER_DEVICE',
    });

    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.enabled).toBe(false);
    expect(body.baselineWeeks).toBe(8);
    expect(body.thresholdPct).toBe(125);
    expect(body.sustainedIntervals).toBe(6);

    const persisted = await prisma.usageAnomalySetting.findUnique({
      where: { userId: ownerUserId },
    });
    expect(persisted?.enabled).toBe(false);
    expect(persisted?.baselineWeeks).toBe(8);
  });

  it('preserves existing settings when applying a partial update', async () => {
    await injectPut('/api/usage-insights/settings', {
      enabled: true,
      baselineWeeks: 8,
      thresholdPct: 125,
      sustainedIntervals: 6,
      scope: 'PER_DEVICE',
    });

    const res = await injectPut('/api/usage-insights/settings', {
      enabled: false,
    });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({
      enabled: false,
      baselineWeeks: 8,
      thresholdPct: 125,
      sustainedIntervals: 6,
      scope: 'PER_DEVICE',
    });

    const persisted = await prisma.usageAnomalySetting.findUnique({
      where: { userId: ownerUserId },
    });
    expect(persisted?.enabled).toBe(false);
    expect(persisted?.baselineWeeks).toBe(8);
    expect(persisted?.thresholdPct).toBe(125);
    expect(persisted?.sustainedIntervals).toBe(6);
  });

  it('rejects out-of-range settings values', async () => {
    const res = await injectPut('/api/usage-insights/settings', {
      enabled: true,
      baselineWeeks: 9,
      thresholdPct: 25,
      sustainedIntervals: 3,
      scope: 'PER_DEVICE',
    });

    expect(res.statusCode).toBe(400);
  });

  it('lists anomalies by date range and device filter', async () => {
    await prisma.usageAnomalyEvent.createMany({
      data: [
        {
          userId: ownerUserId,
          deviceId: ownerDeviceId,
          startsAt: new Date('2026-05-11T08:00:00.000Z'),
          endsAt: new Date('2026-05-11T08:20:00.000Z'),
          observedKwh: 2,
          baselineKwh: 1,
          deltaPct: 100,
          explanation: 'Usage was higher.',
          scope: 'PER_DEVICE',
        },
        {
          userId: ownerUserId,
          deviceId: ownerDeviceId,
          startsAt: new Date('2026-05-12T08:00:00.000Z'),
          endsAt: new Date('2026-05-12T08:20:00.000Z'),
          observedKwh: 2,
          baselineKwh: 1,
          deltaPct: 100,
          explanation: 'Usage was higher.',
          scope: 'PER_DEVICE',
        },
        {
          userId: otherUserId,
          deviceId: otherDeviceId,
          startsAt: new Date('2026-05-11T08:05:00.000Z'),
          endsAt: new Date('2026-05-11T08:25:00.000Z'),
          observedKwh: 4,
          baselineKwh: 1,
          deltaPct: 300,
          explanation: 'Foreign tenant event.',
          scope: 'PER_DEVICE',
        },
      ],
    });

    const res = await injectGet(
      `/api/usage-insights/anomalies?deviceId=${ownerDeviceId}&from=2026-05-11T00:00:00.000Z&to=2026-05-11T23:59:59.999Z&limit=5`,
    );
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.count).toBe(1);
    expect(body.data[0].deviceId).toBe(ownerDeviceId);
    expect(body.data[0].baselineKwh).toBe(1);
    expect(body.data[0].observedKwh).toBe(2);
    expect(body.data[0].deltaPct).toBe(100);
    expect(body.data[0].explanation).toBe('Usage was higher.');
  });

  it('includes anomalies that overlap the requested date range', async () => {
    await prisma.usageAnomalyEvent.createMany({
      data: [
        {
          userId: ownerUserId,
          deviceId: ownerDeviceId,
          startsAt: new Date('2026-05-11T07:50:00.000Z'),
          endsAt: new Date('2026-05-11T08:10:00.000Z'),
          observedKwh: 2,
          baselineKwh: 1,
          deltaPct: 100,
          explanation: 'Overlaps the requested range.',
          scope: 'PER_DEVICE',
        },
        {
          userId: ownerUserId,
          deviceId: ownerDeviceId,
          startsAt: new Date('2026-05-11T07:00:00.000Z'),
          endsAt: new Date('2026-05-11T07:20:00.000Z'),
          observedKwh: 2,
          baselineKwh: 1,
          deltaPct: 100,
          explanation: 'Ends before the requested range.',
          scope: 'PER_DEVICE',
        },
      ],
    });

    const res = await injectGet(
      '/api/usage-insights/anomalies?from=2026-05-11T08:00:00.000Z&to=2026-05-11T08:30:00.000Z',
    );
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.count).toBe(1);
    expect(body.data[0].explanation).toBe('Overlaps the requested range.');
  });

  it('does not expose another tenants device anomalies', async () => {
    await prisma.usageAnomalyEvent.create({
      data: {
        userId: ownerUserId,
        deviceId: ownerDeviceId,
        startsAt: new Date('2026-05-11T08:00:00.000Z'),
        endsAt: new Date('2026-05-11T08:20:00.000Z'),
        observedKwh: 2,
        baselineKwh: 1,
        deltaPct: 100,
        explanation: 'Owner event.',
        scope: 'PER_DEVICE',
      },
    });

    const foreignDeviceRes = await injectGet(
      `/api/usage-insights/anomalies?deviceId=${ownerDeviceId}`,
      otherUserId,
    );
    const ownListRes = await injectGet('/api/usage-insights/anomalies', otherUserId);

    expect(foreignDeviceRes.statusCode).toBe(404);
    expect(ownListRes.statusCode).toBe(200);
    expect(ownListRes.json().count).toBe(0);
  });
});
