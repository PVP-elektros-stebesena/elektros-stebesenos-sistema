import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import prisma from '../../lib/prisma.js';
import { hashPassword } from '../authService.js';
import { createBillingPeriod } from '../billingPeriodService.js';
import { createRenterAllocation } from '../renterAllocationService.js';

let landlordUserIds: number[] = [];
let deviceIds: number[] = [];

beforeEach(async () => {
  const user = await prisma.user.create({
    data: {
      email: `landlord-${Date.now()}-${Math.random()}@example.com`,
      passwordHash: await hashPassword('valid-password'),
    },
  });

  landlordUserIds = [user.id];

  const device = await prisma.device.create({
    data: {
      userId: user.id,
      name: 'Multi-tenant meter',
    },
  });

  deviceIds = [device.id];
});

afterEach(async () => {
  await prisma.renterAllocation.deleteMany();
  await prisma.billingPeriod.deleteMany();
  await prisma.device.deleteMany({ where: { id: { in: deviceIds } } });
  await prisma.renter.deleteMany({ where: { landlordUserId: { in: landlordUserIds } } });
  await prisma.authSession.deleteMany({ where: { userId: { in: landlordUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: landlordUserIds } } });

  landlordUserIds = [];
  deviceIds = [];
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('multi-tenant billing schema', () => {
  it('creates renters, allocations, and billing periods on top of existing devices', async () => {
    const landlordUserId = landlordUserIds[0]!;
    const deviceId = deviceIds[0]!;

    const renter = await prisma.renter.create({
      data: {
        landlordUserId,
        name: 'Tenant One',
        email: 'tenant.one@example.com',
      },
    });

    const allocation = await createRenterAllocation({
      landlordUserId,
      deviceId,
      renterId: renter.id,
      startsAt: new Date('2026-04-01T00:00:00.000Z'),
      endsAt: new Date('2026-05-01T00:00:00.000Z'),
    });

    const billingPeriod = await createBillingPeriod({
      deviceId,
      startsAt: new Date('2026-04-01T00:00:00.000Z'),
      endsAt: new Date('2026-05-01T00:00:00.000Z'),
    });

    expect(renter.landlordUserId).toBe(landlordUserId);
    expect(allocation.deviceId).toBe(deviceId);
    expect(billingPeriod.status).toBe('OPEN');
  });

  it('rejects duplicate active allocations for the same renter and device', async () => {
    const landlordUserId = landlordUserIds[0]!;
    const deviceId = deviceIds[0]!;

    const renter = await prisma.renter.create({
      data: {
        landlordUserId,
        name: 'Tenant Duplicate Guard',
      },
    });

    await createRenterAllocation({
      landlordUserId,
      deviceId,
      renterId: renter.id,
      startsAt: new Date('2026-04-01T00:00:00.000Z'),
      endsAt: null,
    });

    await expect(createRenterAllocation({
      landlordUserId,
      deviceId,
      renterId: renter.id,
      startsAt: new Date('2026-04-15T00:00:00.000Z'),
      endsAt: null,
    })).rejects.toMatchObject({ code: 'ALLOCATION_OVERLAP' });
  });

  it('rejects allocations that mix renters and devices from different landlords', async () => {
    const deviceId = deviceIds[0]!;

    const otherLandlord = await prisma.user.create({
      data: {
        email: `other-landlord-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: await hashPassword('valid-password'),
      },
    });
    landlordUserIds.push(otherLandlord.id);

    const foreignRenter = await prisma.renter.create({
      data: {
        landlordUserId: otherLandlord.id,
        name: 'Foreign Tenant',
      },
    });

    await expect(createRenterAllocation({
      landlordUserId: landlordUserIds[0]!,
      deviceId,
      renterId: foreignRenter.id,
      startsAt: new Date('2026-04-01T00:00:00.000Z'),
      endsAt: null,
    })).rejects.toMatchObject({ code: 'RENTER_NOT_OWNED' });
  });

  it('rejects overlapping allocations for different renters', async () => {
    const landlordUserId = landlordUserIds[0]!;
    const deviceId = deviceIds[0]!;

    const [renterOne, renterTwo] = await Promise.all([
      prisma.renter.create({
        data: {
          landlordUserId,
          name: 'Tenant A',
        },
      }),
      prisma.renter.create({
        data: {
          landlordUserId,
          name: 'Tenant B',
        },
      }),
    ]);

    await createRenterAllocation({
      landlordUserId,
      deviceId,
      renterId: renterOne.id,
      startsAt: new Date('2026-04-01T00:00:00.000Z'),
      endsAt: null,
    });

    await expect(createRenterAllocation({
      landlordUserId,
      deviceId,
      renterId: renterTwo.id,
      startsAt: new Date('2026-04-01T00:00:00.000Z'),
      endsAt: null,
    })).rejects.toMatchObject({ code: 'ALLOCATION_OVERLAP' });
  });

  it('rejects overlapping billing periods for the same device', async () => {
    const deviceId = deviceIds[0]!;

    await createBillingPeriod({
      deviceId,
      startsAt: new Date('2026-04-01T00:00:00.000Z'),
      endsAt: new Date('2026-05-01T00:00:00.000Z'),
    });

    await expect(createBillingPeriod({
      deviceId,
      startsAt: new Date('2026-04-15T00:00:00.000Z'),
      endsAt: new Date('2026-06-01T00:00:00.000Z'),
    })).rejects.toThrow();
  });
});
