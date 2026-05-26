import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import prisma from '../../lib/prisma.js';
import { billingReportRoutes } from '../billingReports.js';

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
      email: `billing-user-${userId}@example.com`,
      username: `billing_user_${userId}`,
      displayName: `Billing User ${userId}`,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      lastLoginAt: null,
    };
  });

  await app.register(billingReportRoutes);
  await app.ready();
});

beforeEach(async () => {
  await prisma.billingReport.deleteMany();
  await prisma.renterAllocation.deleteMany();
  await prisma.renter.deleteMany();
  await prisma.device.deleteMany();
  await prisma.user.deleteMany({ where: { email: { contains: 'billing-scope-' } } });
});

afterAll(async () => {
  await prisma.billingReport.deleteMany();
  await prisma.renterAllocation.deleteMany();
  await prisma.renter.deleteMany();
  await prisma.device.deleteMany();
  await prisma.user.deleteMany({ where: { email: { contains: 'billing-scope-' } } });
  await app.close();
  await prisma.$disconnect();
});

describe('GET /api/billing-reports', () => {
  it('returns device reports for all renters when renterId is omitted', async () => {
    const owner = await prisma.user.create({
      data: {
        email: `billing-scope-owner-${Date.now()}@example.com`,
        passwordHash: 'test-hash',
      },
    });

    const device = await prisma.device.create({
      data: {
        name: 'Billing device',
        userId: owner.id,
        pollInterval: 10,
        isActive: true,
      },
    });

    const renter = await prisma.renter.create({
      data: {
        landlordUserId: owner.id,
        name: 'Tenant One',
      },
    });

    const startsAt = new Date('2026-05-01T00:00:00.000Z');
    const endsAt = new Date('2026-05-31T23:59:59.999Z');

    const sharedPayload = {
      deviceId: device.id,
      startsAt,
      endsAt,
      totalKwh: 42,
      unallocatedKwh: 0,
      reportJson: JSON.stringify({ deviceId: device.id }),
    };

    const [generalReport, renterReport] = await Promise.all([
      prisma.billingReport.create({
        data: {
          ...sharedPayload,
          renterId: null,
        },
      }),
      prisma.billingReport.create({
        data: {
          ...sharedPayload,
          renterId: renter.id,
        },
      }),
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/billing-reports?deviceId=${device.id}`,
      headers: { 'x-test-user-id': String(owner.id) },
    });

    expect(res.statusCode).toBe(200);

    const body = res.json() as Array<{ id: number }>;
    const ids = body.map((row) => row.id);
    expect(ids).toContain(generalReport.id);
    expect(ids).toContain(renterReport.id);
    expect(body).toHaveLength(2);
  });

  it('returns only renter-specific reports when renterId is provided', async () => {
    const owner = await prisma.user.create({
      data: {
        email: `billing-scope-owner-${Date.now()}@example.com`,
        passwordHash: 'test-hash',
      },
    });

    const device = await prisma.device.create({
      data: {
        name: 'Billing device scoped',
        userId: owner.id,
        pollInterval: 10,
        isActive: true,
      },
    });

    const [renterOne, renterTwo] = await Promise.all([
      prisma.renter.create({
        data: {
          landlordUserId: owner.id,
          name: 'Tenant One',
        },
      }),
      prisma.renter.create({
        data: {
          landlordUserId: owner.id,
          name: 'Tenant Two',
        },
      }),
    ]);

    const startsAt = new Date('2026-05-01T00:00:00.000Z');
    const endsAt = new Date('2026-05-31T23:59:59.999Z');

    const sharedPayload = {
      deviceId: device.id,
      startsAt,
      endsAt,
      totalKwh: 42,
      unallocatedKwh: 0,
      reportJson: JSON.stringify({ deviceId: device.id }),
    };

    const [targetReport, otherReport] = await Promise.all([
      prisma.billingReport.create({
        data: {
          ...sharedPayload,
          renterId: renterOne.id,
        },
      }),
      prisma.billingReport.create({
        data: {
          ...sharedPayload,
          renterId: renterTwo.id,
        },
      }),
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/billing-reports?deviceId=${device.id}&renterId=${renterOne.id}`,
      headers: { 'x-test-user-id': String(owner.id) },
    });

    expect(res.statusCode).toBe(200);

    const body = res.json() as Array<{ id: number }>;
    expect(body).toHaveLength(1);
    expect(body[0]?.id).toBe(targetReport.id);
    expect(body[0]?.id).not.toBe(otherReport.id);
  });

  it('returns 400 when renterId is not a positive integer', async () => {
    const owner = await prisma.user.create({
      data: {
        email: `billing-scope-owner-${Date.now()}@example.com`,
        passwordHash: 'test-hash',
      },
    });

    const device = await prisma.device.create({
      data: {
        name: 'Billing invalid renter id',
        userId: owner.id,
        pollInterval: 10,
        isActive: true,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/billing-reports?deviceId=${device.id}&renterId=abc`,
      headers: { 'x-test-user-id': String(owner.id) },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'VALIDATION',
      message: 'renterId must be a positive integer.',
    });
  });
});
