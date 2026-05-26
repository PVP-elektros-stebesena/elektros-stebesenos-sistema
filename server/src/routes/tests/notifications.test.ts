import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import prisma from '../../lib/prisma.js';
import { notificationRoutes } from '../notifications.js';

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
      email: `notification-user-${userId}@example.com`,
      username: `notification_user_${userId}`,
      displayName: `Notification User ${userId}`,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      lastLoginAt: null,
    };
  });
  app.register(notificationRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  const [owner, other] = await Promise.all([
    prisma.user.create({
      data: {
        email: `notification-owner-${Date.now()}@example.com`,
        username: `notification_owner_${Date.now()}`,
        passwordHash: 'test-hash',
      },
    }),
    prisma.user.create({
      data: {
        email: `notification-other-${Date.now()}@example.com`,
        username: `notification_other_${Date.now()}`,
        passwordHash: 'test-hash',
      },
    }),
  ]);

  ownerId = owner.id;
  otherId = other.id;

  const [ownerDevice, otherDevice] = await Promise.all([
    prisma.device.create({
      data: { name: 'NotifyOwnerDevice', userId: ownerId, pollInterval: 10, isActive: true },
    }),
    prisma.device.create({
      data: { name: 'NotifyOtherDevice', userId: otherId, pollInterval: 10, isActive: true },
    }),
  ]);

  ownerDeviceId = ownerDevice.id;
  otherDeviceId = otherDevice.id;
});

afterEach(async () => {
  await prisma.notificationEventToggle.deleteMany();
  await prisma.device.deleteMany({ where: { id: { in: [ownerDeviceId, otherDeviceId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
});

describe('notification routes device access', () => {
  it('blocks event listing for devices owned by another user', async () => {
    const ownerHeaders = { 'x-test-user-id': String(ownerId) };
    const res = await app.inject({
      method: 'GET',
      url: `/api/notifications/events?deviceId=${otherDeviceId}`,
      headers: ownerHeaders,
    });

    expect(res.statusCode).toBe(404);
  });

  it('blocks event updates for devices owned by another user', async () => {
    const ownerHeaders = { 'x-test-user-id': String(ownerId) };
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/notifications/events/REPORT_GENERATED',
      headers: ownerHeaders,
      payload: {
        enabled: false,
        deviceId: otherDeviceId,
      },
    });

    expect(res.statusCode).toBe(404);
  });

  it('allows event updates for the owner device', async () => {
    const ownerHeaders = { 'x-test-user-id': String(ownerId) };
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/notifications/events/REPORT_GENERATED',
      headers: ownerHeaders,
      payload: {
        enabled: false,
        deviceId: ownerDeviceId,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.deviceId).toBe(ownerDeviceId);
  });
});
