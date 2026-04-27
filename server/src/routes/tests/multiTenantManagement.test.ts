import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import prisma from '../../lib/prisma.js';
import { settingsRoutes } from '../settings.js';

let app: FastifyInstance;
let ownerUserId: number;
let otherUserId: number;
let ownerDeviceId: number;

beforeAll(async () => {
  app = Fastify();
  app.addHook('onRequest', async (req) => {
    const rawUserId = req.headers['x-test-user-id'];
    if (typeof rawUserId !== 'string') return;

    const userId = Number(rawUserId);
    if (!Number.isSafeInteger(userId) || userId <= 0) return;

    req.authUser = {
      id: userId,
      email: `user${userId}@example.com`,
      username: `user${userId}`,
      displayName: `User ${userId}`,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      lastLoginAt: null,
    };
  });

  app.register(settingsRoutes);
  await app.ready();
});

beforeEach(async () => {
  const [owner, other] = await Promise.all([
    prisma.user.create({
      data: {
        email: `tenant-owner-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: 'test-hash',
      },
    }),
    prisma.user.create({
      data: {
        email: `tenant-other-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: 'test-hash',
      },
    }),
  ]);

  ownerUserId = owner.id;
  otherUserId = other.id;

  const device = await prisma.device.create({
    data: {
      userId: owner.id,
      name: 'Owner tenant device',
      pollInterval: 10,
      isActive: true,
    },
  });

  ownerDeviceId = device.id;
});

afterEach(async () => {
  await prisma.renterAllocation.deleteMany();
  await prisma.billingPeriod.deleteMany();
  await prisma.anomaly.deleteMany();
  await prisma.aggregatedData.deleteMany();
  await prisma.reading.deleteMany();
  await prisma.powerPolicyOverride.deleteMany();
  await prisma.billingPlan.deleteMany();
  await prisma.device.deleteMany({ where: { userId: { in: [ownerUserId, otherUserId] } } });
  await prisma.renter.deleteMany({ where: { landlordUserId: { in: [ownerUserId, otherUserId] } } });
  await prisma.authSession.deleteMany({ where: { userId: { in: [ownerUserId, otherUserId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerUserId, otherUserId] } } });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

function inject(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  userId: number,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: {
      'x-test-user-id': String(userId),
    },
    ...(payload ? { payload: payload as Record<string, unknown> } : {}),
  });
}

describe('multi-tenant management endpoints', () => {
  it('keeps device CRUD scoped to owning landlord', async () => {
    const createRes = await inject('POST', '/api/settings', ownerUserId, {
      name: 'Scoped device',
    });

    expect(createRes.statusCode).toBe(201);
    const createdId = createRes.json().id as number;

    const ownerList = await inject('GET', '/api/settings', ownerUserId);
    expect(ownerList.statusCode).toBe(200);
    expect(ownerList.json().some((d: { id: number }) => d.id === createdId)).toBe(true);

    const otherPatch = await inject('PATCH', `/api/settings/${createdId}`, otherUserId, {
      name: 'Not allowed',
    });
    expect(otherPatch.statusCode).toBe(404);
    expect(otherPatch.json().error).toBe('NOT_FOUND');
  });

  it('supports renter CRUD for the owning landlord', async () => {
    const createRes = await inject('POST', '/api/settings/renters', ownerUserId, {
      name: 'Tenant A',
      email: 'tenant.a@example.com',
    });

    expect(createRes.statusCode).toBe(201);
    const renterId = createRes.json().id as number;

    const listRes = await inject('GET', '/api/settings/renters', ownerUserId);
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json()).toHaveLength(1);

    const patchRes = await inject('PATCH', `/api/settings/renters/${renterId}`, ownerUserId, {
      name: 'Tenant A Updated',
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().name).toBe('Tenant A Updated');

    const deleteRes = await inject('DELETE', `/api/settings/renters/${renterId}`, ownerUserId);
    expect(deleteRes.statusCode).toBe(204);
  });

  it('supports renter allocation timeline CRUD on landlord devices', async () => {
    const renterRes = await inject('POST', '/api/settings/renters', ownerUserId, {
      name: 'Timeline Tenant',
    });
    const renterId = renterRes.json().id as number;

    const createAllocationRes = await inject(
      'POST',
      `/api/settings/${ownerDeviceId}/renter-allocations`,
      ownerUserId,
      {
        renterId,
        startsAt: '2026-04-01T00:00:00.000Z',
        endsAt: '2026-05-01T00:00:00.000Z',
      },
    );

    expect(createAllocationRes.statusCode).toBe(201);
    const allocationId = createAllocationRes.json().id as number;

    const listRes = await inject('GET', `/api/settings/${ownerDeviceId}/renter-allocations`, ownerUserId);
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json()).toHaveLength(1);

    const patchRes = await inject(
      'PATCH',
      `/api/settings/${ownerDeviceId}/renter-allocations/${allocationId}`,
      ownerUserId,
      {
        endsAt: '2026-05-15T00:00:00.000Z',
      },
    );

    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().endsAt).toBe('2026-05-15T00:00:00.000Z');

    const deleteRes = await inject(
      'DELETE',
      `/api/settings/${ownerDeviceId}/renter-allocations/${allocationId}`,
      ownerUserId,
    );

    expect(deleteRes.statusCode).toBe(204);
  });

  it('rejects invalid date ranges and overlapping allocations', async () => {
    const firstRenterRes = await inject('POST', '/api/settings/renters', ownerUserId, { name: 'A' });
    const secondRenterRes = await inject('POST', '/api/settings/renters', ownerUserId, { name: 'B' });
    const firstRenterId = firstRenterRes.json().id as number;
    const secondRenterId = secondRenterRes.json().id as number;

    const invalidRange = await inject(
      'POST',
      `/api/settings/${ownerDeviceId}/renter-allocations`,
      ownerUserId,
      {
        renterId: firstRenterId,
        startsAt: '2026-05-01T00:00:00.000Z',
        endsAt: '2026-04-01T00:00:00.000Z',
      },
    );

    expect(invalidRange.statusCode).toBe(400);
    expect(invalidRange.json().error).toBe('INVALID_DATE_RANGE');

    const firstAllocation = await inject(
      'POST',
      `/api/settings/${ownerDeviceId}/renter-allocations`,
      ownerUserId,
      {
        renterId: firstRenterId,
        startsAt: '2026-04-01T00:00:00.000Z',
        endsAt: '2026-05-01T00:00:00.000Z',
      },
    );
    expect(firstAllocation.statusCode).toBe(201);

    const overlap = await inject(
      'POST',
      `/api/settings/${ownerDeviceId}/renter-allocations`,
      ownerUserId,
      {
        renterId: secondRenterId,
        startsAt: '2026-04-15T00:00:00.000Z',
        endsAt: '2026-05-15T00:00:00.000Z',
      },
    );

    expect(overlap.statusCode).toBe(400);
    expect(overlap.json().error).toBe('ALLOCATION_OVERLAP');
  });

  it('prevents non-owning landlords from managing renter allocations', async () => {
    const renterRes = await inject('POST', '/api/settings/renters', ownerUserId, {
      name: 'Protected Tenant',
    });
    const renterId = renterRes.json().id as number;

    const createByOther = await inject(
      'POST',
      `/api/settings/${ownerDeviceId}/renter-allocations`,
      otherUserId,
      {
        renterId,
        startsAt: '2026-04-01T00:00:00.000Z',
        endsAt: null,
      },
    );

    expect(createByOther.statusCode).toBe(404);
    expect(createByOther.json().error).toBe('NOT_FOUND');
  });

  it('blocks renter deletion when allocation history exists', async () => {
    const renterRes = await inject('POST', '/api/settings/renters', ownerUserId, {
      name: 'Historic Tenant',
    });
    const renterId = renterRes.json().id as number;

    await inject(
      'POST',
      `/api/settings/${ownerDeviceId}/renter-allocations`,
      ownerUserId,
      {
        renterId,
        startsAt: '2026-04-01T00:00:00.000Z',
        endsAt: '2026-05-01T00:00:00.000Z',
      },
    );

    const deleteRenterRes = await inject('DELETE', `/api/settings/renters/${renterId}`, ownerUserId);
    expect(deleteRenterRes.statusCode).toBe(409);
    expect(deleteRenterRes.json().error).toBe('RENTER_IN_USE');
  });
});
