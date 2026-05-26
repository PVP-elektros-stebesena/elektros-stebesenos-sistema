import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import prisma from '../../lib/prisma.js';
import { exportRoutes } from '../exports.js';

let app: FastifyInstance;
let ownerId: number;
let otherId: number;
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
      email: `export-user-${userId}@example.com`,
      username: `export_user_${userId}`,
      displayName: `Export User ${userId}`,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      lastLoginAt: null,
    };
  });
  await app.register(exportRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  const [owner, other] = await Promise.all([
    prisma.user.create({
      data: {
        email: `export-owner-${Date.now()}@example.com`,
        username: `export_owner_${Date.now()}`,
        passwordHash: 'test-hash',
      },
    }),
    prisma.user.create({
      data: {
        email: `export-other-${Date.now()}@example.com`,
        username: `export_other_${Date.now()}`,
        passwordHash: 'test-hash',
      },
    }),
  ]);

  ownerId = owner.id;
  otherId = other.id;

  const [ownerDevice, otherDevice] = await Promise.all([
    prisma.device.create({
      data: { name: 'ExportOwnerDevice', userId: ownerId, pollInterval: 10, isActive: true },
    }),
    prisma.device.create({
      data: { name: 'ExportOtherDevice', userId: otherId, pollInterval: 10, isActive: true },
    }),
  ]);

  ownerDeviceId = ownerDevice.id;
  otherDeviceId = otherDevice.id;
});

afterEach(async () => {
  await prisma.reading.deleteMany({ where: { deviceId: { in: [ownerDeviceId, otherDeviceId] } } });
  await prisma.device.deleteMany({ where: { id: { in: [ownerDeviceId, otherDeviceId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
});

describe('export routes device access', () => {
  it('blocks export requests for devices owned by another user', async () => {
    const ownerHeaders = { 'x-test-user-id': String(ownerId) };
    const res = await app.inject({
      method: 'GET',
      url: `/api/exports/readings?deviceId=${otherDeviceId}` +
        '&from=2026-04-01T00:00:00.000Z&to=2026-04-02T00:00:00.000Z&format=csv',
      headers: ownerHeaders,
    });

    expect(res.statusCode).toBe(404);
  });

  it('allows export requests for the owner device', async () => {
    const ownerHeaders = { 'x-test-user-id': String(ownerId) };

    await prisma.reading.create({
      data: {
        deviceId: ownerDeviceId,
        timestamp: new Date('2026-04-01T00:00:00.000Z'),
        energyDelivered: 10,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/exports/readings?deviceId=${ownerDeviceId}` +
        '&from=2026-04-01T00:00:00.000Z&to=2026-04-01T00:10:00.000Z&format=csv',
      headers: ownerHeaders,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
  });
});
