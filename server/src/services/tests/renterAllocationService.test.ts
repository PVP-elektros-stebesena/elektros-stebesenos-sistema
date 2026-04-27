import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import prisma from '../../lib/prisma.js';
import { hashPassword } from '../authService.js';
import {
  MultiTenantDomainError,
  createLandlordDeviceRecord,
  createRenter,
  createRenterAllocation,
  listRenterAllocationsForDevice,
} from '../renterAllocationService.js';

let landlordUserId = 0;
let deviceId = 0;
let createdUserIds: number[] = [];
let createdDeviceIds: number[] = [];

beforeEach(async () => {
  const user = await prisma.user.create({
    data: {
      email: `domain-landlord-${Date.now()}-${Math.random()}@example.com`,
      passwordHash: await hashPassword('valid-password'),
    },
  });

  landlordUserId = user.id;
  createdUserIds = [user.id];

  const device = await createLandlordDeviceRecord({
    landlordUserId,
    name: 'Domain model meter',
  });

  deviceId = device.id;
  createdDeviceIds = [device.id];
});

afterEach(async () => {
  await prisma.renterAllocation.deleteMany({ where: { deviceId: { in: createdDeviceIds } } });
  await prisma.billingPeriod.deleteMany({ where: { deviceId: { in: createdDeviceIds } } });
  await prisma.device.deleteMany({ where: { id: { in: createdDeviceIds } } });
  await prisma.renter.deleteMany({ where: { landlordUserId: { in: createdUserIds } } });
  await prisma.authSession.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

  landlordUserId = 0;
  deviceId = 0;
  createdUserIds = [];
  createdDeviceIds = [];
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('renter allocation domain model', () => {
  it('creates landlord device linked to the account', async () => {
    const device = await createLandlordDeviceRecord({
      landlordUserId,
      name: 'Second domain device',
    });

    createdDeviceIds.push(device.id);

    expect(device.userId).toBe(landlordUserId);
    expect(device.name).toBe('Second domain device');
  });

  it('creates renters and allocations with start/end dates', async () => {
    const renter = await createRenter({
      landlordUserId,
      name: 'Tenant One',
      email: 'tenant.one@example.com',
    });

    const allocation = await createRenterAllocation({
      landlordUserId,
      deviceId,
      renterId: renter.id,
      startsAt: '2026-04-01T00:00:00.000Z',
      endsAt: '2026-05-01T00:00:00.000Z',
    });

    expect(allocation.deviceId).toBe(deviceId);
    expect(allocation.renterId).toBe(renter.id);
    expect(allocation.startsAt).toBe('2026-04-01T00:00:00.000Z');
    expect(allocation.endsAt).toBe('2026-05-01T00:00:00.000Z');
  });

  it('allows multiple renters across consecutive periods and keeps history', async () => {
    const firstRenter = await createRenter({
      landlordUserId,
      name: 'Tenant A',
    });

    const secondRenter = await createRenter({
      landlordUserId,
      name: 'Tenant B',
    });

    await createRenterAllocation({
      landlordUserId,
      deviceId,
      renterId: firstRenter.id,
      startsAt: '2026-04-01T00:00:00.000Z',
      endsAt: '2026-05-01T00:00:00.000Z',
    });

    await createRenterAllocation({
      landlordUserId,
      deviceId,
      renterId: secondRenter.id,
      startsAt: '2026-05-01T00:00:00.000Z',
      endsAt: null,
    });

    const history = await listRenterAllocationsForDevice(deviceId, landlordUserId);

    expect(history).toHaveLength(2);
    expect(history[0]?.renter.name).toBe('Tenant A');
    expect(history[1]?.renter.name).toBe('Tenant B');
    expect(history[0]?.endsAt).toBe('2026-05-01T00:00:00.000Z');
    expect(history[1]?.endsAt).toBeNull();
  });

  it('prevents overlapping allocations for the same device period', async () => {
    const firstRenter = await createRenter({
      landlordUserId,
      name: 'Tenant Overlap 1',
    });

    const secondRenter = await createRenter({
      landlordUserId,
      name: 'Tenant Overlap 2',
    });

    await createRenterAllocation({
      landlordUserId,
      deviceId,
      renterId: firstRenter.id,
      startsAt: '2026-04-01T00:00:00.000Z',
      endsAt: '2026-05-01T00:00:00.000Z',
    });

    await expect(createRenterAllocation({
      landlordUserId,
      deviceId,
      renterId: secondRenter.id,
      startsAt: '2026-04-15T00:00:00.000Z',
      endsAt: '2026-05-15T00:00:00.000Z',
    })).rejects.toMatchObject({
      code: 'ALLOCATION_OVERLAP',
    } satisfies Partial<MultiTenantDomainError>);
  });

  it('rejects renter allocations with mixed landlord ownership', async () => {
    const foreignUser = await prisma.user.create({
      data: {
        email: `foreign-landlord-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: await hashPassword('valid-password'),
      },
    });
    createdUserIds.push(foreignUser.id);

    const foreignRenter = await createRenter({
      landlordUserId: foreignUser.id,
      name: 'Foreign Tenant',
    });

    await expect(createRenterAllocation({
      landlordUserId,
      deviceId,
      renterId: foreignRenter.id,
      startsAt: '2026-04-01T00:00:00.000Z',
      endsAt: null,
    })).rejects.toMatchObject({
      code: 'RENTER_NOT_OWNED',
    } satisfies Partial<MultiTenantDomainError>);
  });
});
