import prisma from '../lib/prisma.js';

const FAR_FUTURE_DATE = new Date('9999-12-31T23:59:59.999Z');

export type MultiTenantDomainErrorCode =
  | 'DEVICE_NOT_FOUND'
  | 'DEVICE_NOT_OWNED'
  | 'RENTER_NOT_FOUND'
  | 'RENTER_NOT_OWNED'
  | 'RENTER_IN_USE'
  | 'ALLOCATION_NOT_FOUND'
  | 'INVALID_DATE_RANGE'
  | 'ALLOCATION_OVERLAP';

export class MultiTenantDomainError extends Error {
  code: MultiTenantDomainErrorCode;

  constructor(code: MultiTenantDomainErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface CreateLandlordDeviceInput {
  landlordUserId: number;
  name: string;
  deviceIp?: string | null;
  mqttBroker?: string | null;
  mqttPort?: number | null;
  mqttTopic?: string | null;
}

export interface CreateRenterInput {
  landlordUserId: number;
  name: string;
  email?: string | null;
}

export interface UpdateRenterInput {
  renterId: number;
  landlordUserId: number;
  name?: string;
  email?: string | null;
}

export interface CreateRenterAllocationInput {
  deviceId: number;
  renterId: number;
  startsAt: Date | string;
  endsAt?: Date | string | null;
  landlordUserId?: number;
}

export interface UpdateRenterAllocationInput {
  allocationId: number;
  deviceId: number;
  renterId?: number;
  startsAt?: Date | string;
  endsAt?: Date | string | null;
  landlordUserId?: number;
}

export interface RenterSummary {
  id: number;
  landlordUserId: number;
  name: string;
  email: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RenterAllocationSummary {
  id: number;
  deviceId: number;
  renterId: number;
  startsAt: string;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
  renter: {
    id: number;
    landlordUserId: number;
    name: string;
    email: string | null;
  };
}

export interface DeleteRenterAllocationInput {
  allocationId: number;
  deviceId?: number;
  landlordUserId?: number;
}

function normalizeRequiredDate(value: Date | string, fieldName: string): Date {
  const parsed = typeof value === 'string' ? new Date(value) : value;
  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
    throw new MultiTenantDomainError('INVALID_DATE_RANGE', `${fieldName} must be a valid ISO datetime`);
  }

  return parsed;
}

function normalizeOptionalDate(value: Date | string | null | undefined, fieldName: string): Date | null {
  if (value == null) return null;
  const parsed = typeof value === 'string' ? new Date(value) : value;
  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
    throw new MultiTenantDomainError('INVALID_DATE_RANGE', `${fieldName} must be a valid ISO datetime`);
  }

  return parsed;
}

function validateDateRange(startsAt: Date, endsAt: Date | null): void {
  if (endsAt != null && endsAt.getTime() <= startsAt.getTime()) {
    throw new MultiTenantDomainError('INVALID_DATE_RANGE', 'endsAt must be after startsAt');
  }
}

function toRenterSummary(row: {
  id: number;
  landlordUserId: number;
  name: string;
  email: string | null;
  createdAt: Date;
  updatedAt: Date;
}): RenterSummary {
  return {
    id: row.id,
    landlordUserId: row.landlordUserId,
    name: row.name,
    email: row.email,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAllocationSummary(row: {
  id: number;
  deviceId: number;
  renterId: number;
  startsAt: Date;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  renter: {
    id: number;
    landlordUserId: number;
    name: string;
    email: string | null;
  };
}): RenterAllocationSummary {
  return {
    id: row.id,
    deviceId: row.deviceId,
    renterId: row.renterId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    renter: {
      id: row.renter.id,
      landlordUserId: row.renter.landlordUserId,
      name: row.renter.name,
      email: row.renter.email,
    },
  };
}

export async function createLandlordDeviceRecord(
  input: CreateLandlordDeviceInput,
): Promise<{ id: number; userId: number | null; name: string }> {
  const created = await prisma.device.create({
    data: {
      userId: input.landlordUserId,
      name: input.name.trim(),
      deviceIp: input.deviceIp ?? null,
      mqttBroker: input.mqttBroker ?? null,
      mqttPort: input.mqttPort ?? null,
      mqttTopic: input.mqttTopic ?? null,
    },
    select: {
      id: true,
      userId: true,
      name: true,
    },
  });

  return created;
}

export async function createRenter(input: CreateRenterInput): Promise<RenterSummary> {
  const created = await prisma.renter.create({
    data: {
      landlordUserId: input.landlordUserId,
      name: input.name.trim(),
      email: input.email?.trim() || null,
    },
  });

  return toRenterSummary(created);
}

export async function updateRenter(input: UpdateRenterInput): Promise<RenterSummary> {
  const renter = await prisma.renter.findUnique({
    where: { id: input.renterId },
    select: {
      id: true,
      landlordUserId: true,
    },
  });

  if (!renter) {
    throw new MultiTenantDomainError('RENTER_NOT_FOUND', `Renter ${input.renterId} not found`);
  }

  if (renter.landlordUserId !== input.landlordUserId) {
    throw new MultiTenantDomainError(
      'RENTER_NOT_OWNED',
      `Renter ${input.renterId} is not owned by landlord ${input.landlordUserId}`,
    );
  }

  const updated = await prisma.renter.update({
    where: { id: input.renterId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.email !== undefined ? { email: input.email?.trim() || null } : {}),
    },
  });

  return toRenterSummary(updated);
}

export async function deleteRenter(renterId: number, landlordUserId: number): Promise<void> {
  const renter = await prisma.renter.findUnique({
    where: { id: renterId },
    select: {
      id: true,
      landlordUserId: true,
    },
  });

  if (!renter) {
    throw new MultiTenantDomainError('RENTER_NOT_FOUND', `Renter ${renterId} not found`);
  }

  if (renter.landlordUserId !== landlordUserId) {
    throw new MultiTenantDomainError(
      'RENTER_NOT_OWNED',
      `Renter ${renterId} is not owned by landlord ${landlordUserId}`,
    );
  }

  const activeAllocations = await prisma.renterAllocation.count({
    where: { renterId },
  });

  if (activeAllocations > 0) {
    throw new MultiTenantDomainError(
      'RENTER_IN_USE',
      'Renter has allocation history and cannot be deleted',
    );
  }

  await prisma.renter.delete({ where: { id: renterId } });
}

export async function listRentersForLandlord(landlordUserId: number): Promise<RenterSummary[]> {
  const rows = await prisma.renter.findMany({
    where: { landlordUserId },
    orderBy: [
      { name: 'asc' },
      { id: 'asc' },
    ],
  });

  return rows.map(toRenterSummary);
}

export async function createRenterAllocation(
  input: CreateRenterAllocationInput,
): Promise<RenterAllocationSummary> {
  const startsAt = normalizeRequiredDate(input.startsAt, 'startsAt');
  const endsAt = normalizeOptionalDate(input.endsAt, 'endsAt');
  validateDateRange(startsAt, endsAt);

  const created = await prisma.$transaction(async (tx) => {
    const device = await tx.device.findUnique({
      where: { id: input.deviceId },
      select: {
        id: true,
        userId: true,
      },
    });

    if (!device) {
      throw new MultiTenantDomainError('DEVICE_NOT_FOUND', `Device ${input.deviceId} not found`);
    }

    if (input.landlordUserId != null && device.userId !== input.landlordUserId) {
      throw new MultiTenantDomainError(
        'DEVICE_NOT_OWNED',
        `Device ${input.deviceId} is not owned by landlord ${input.landlordUserId}`,
      );
    }

    const renter = await tx.renter.findUnique({
      where: { id: input.renterId },
      select: {
        id: true,
        landlordUserId: true,
      },
    });

    if (!renter) {
      throw new MultiTenantDomainError('RENTER_NOT_FOUND', `Renter ${input.renterId} not found`);
    }

    if (input.landlordUserId != null && renter.landlordUserId !== input.landlordUserId) {
      throw new MultiTenantDomainError(
        'RENTER_NOT_OWNED',
        `Renter ${input.renterId} is not owned by landlord ${input.landlordUserId}`,
      );
    }

    if (device.userId != null && renter.landlordUserId !== device.userId) {
      throw new MultiTenantDomainError(
        'RENTER_NOT_OWNED',
        'Renter must belong to the same landlord as the device',
      );
    }

    const effectiveEnd = endsAt ?? FAR_FUTURE_DATE;
    const overlap = await tx.renterAllocation.findFirst({
      where: {
        deviceId: input.deviceId,
        startsAt: { lt: effectiveEnd },
        OR: [
          { endsAt: null },
          { endsAt: { gt: startsAt } },
        ],
      },
      select: {
        id: true,
      },
    });

    if (overlap) {
      throw new MultiTenantDomainError(
        'ALLOCATION_OVERLAP',
        'Overlapping renter allocations are not allowed for the same device period',
      );
    }

    return tx.renterAllocation.create({
      data: {
        deviceId: input.deviceId,
        renterId: input.renterId,
        startsAt,
        endsAt,
      },
      include: {
        renter: {
          select: {
            id: true,
            landlordUserId: true,
            name: true,
            email: true,
          },
        },
      },
    });
  });

  return toAllocationSummary(created);
}

export async function updateRenterAllocation(
  input: UpdateRenterAllocationInput,
): Promise<RenterAllocationSummary> {
  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.renterAllocation.findUnique({
      where: { id: input.allocationId },
      select: {
        id: true,
        deviceId: true,
        renterId: true,
        startsAt: true,
        endsAt: true,
      },
    });

    if (!existing || existing.deviceId !== input.deviceId) {
      throw new MultiTenantDomainError('ALLOCATION_NOT_FOUND', `Allocation ${input.allocationId} not found`);
    }

    const startsAt = input.startsAt !== undefined
      ? normalizeRequiredDate(input.startsAt, 'startsAt')
      : existing.startsAt;
    const endsAt = input.endsAt !== undefined
      ? normalizeOptionalDate(input.endsAt, 'endsAt')
      : existing.endsAt;
    const renterId = input.renterId ?? existing.renterId;

    validateDateRange(startsAt, endsAt);

    const device = await tx.device.findUnique({
      where: { id: existing.deviceId },
      select: {
        id: true,
        userId: true,
      },
    });

    if (!device) {
      throw new MultiTenantDomainError('DEVICE_NOT_FOUND', `Device ${existing.deviceId} not found`);
    }

    if (input.landlordUserId != null && device.userId !== input.landlordUserId) {
      throw new MultiTenantDomainError(
        'DEVICE_NOT_OWNED',
        `Device ${existing.deviceId} is not owned by landlord ${input.landlordUserId}`,
      );
    }

    const renter = await tx.renter.findUnique({
      where: { id: renterId },
      select: {
        id: true,
        landlordUserId: true,
      },
    });

    if (!renter) {
      throw new MultiTenantDomainError('RENTER_NOT_FOUND', `Renter ${renterId} not found`);
    }

    if (input.landlordUserId != null && renter.landlordUserId !== input.landlordUserId) {
      throw new MultiTenantDomainError(
        'RENTER_NOT_OWNED',
        `Renter ${renterId} is not owned by landlord ${input.landlordUserId}`,
      );
    }

    if (device.userId != null && renter.landlordUserId !== device.userId) {
      throw new MultiTenantDomainError(
        'RENTER_NOT_OWNED',
        'Renter must belong to the same landlord as the device',
      );
    }

    const effectiveEnd = endsAt ?? FAR_FUTURE_DATE;
    const overlap = await tx.renterAllocation.findFirst({
      where: {
        deviceId: existing.deviceId,
        id: { not: existing.id },
        startsAt: { lt: effectiveEnd },
        OR: [
          { endsAt: null },
          { endsAt: { gt: startsAt } },
        ],
      },
      select: {
        id: true,
      },
    });

    if (overlap) {
      throw new MultiTenantDomainError(
        'ALLOCATION_OVERLAP',
        'Overlapping renter allocations are not allowed for the same device period',
      );
    }

    return tx.renterAllocation.update({
      where: { id: existing.id },
      data: {
        renterId,
        startsAt,
        endsAt,
      },
      include: {
        renter: {
          select: {
            id: true,
            landlordUserId: true,
            name: true,
            email: true,
          },
        },
      },
    });
  });

  return toAllocationSummary(updated);
}

export async function listRenterAllocationsForDevice(
  deviceId: number,
  landlordUserId?: number,
): Promise<RenterAllocationSummary[]> {
  if (landlordUserId != null) {
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      select: { id: true, userId: true },
    });

    if (!device) {
      throw new MultiTenantDomainError('DEVICE_NOT_FOUND', `Device ${deviceId} not found`);
    }

    if (device.userId !== landlordUserId) {
      throw new MultiTenantDomainError(
        'DEVICE_NOT_OWNED',
        `Device ${deviceId} is not owned by landlord ${landlordUserId}`,
      );
    }
  }

  const rows = await prisma.renterAllocation.findMany({
    where: { deviceId },
    orderBy: [
      { startsAt: 'asc' },
      { id: 'asc' },
    ],
    include: {
      renter: {
        select: {
          id: true,
          landlordUserId: true,
          name: true,
          email: true,
        },
      },
    },
  });

  return rows.map(toAllocationSummary);
}

export async function deleteRenterAllocation(input: DeleteRenterAllocationInput): Promise<void> {
  const existing = await prisma.renterAllocation.findUnique({
    where: { id: input.allocationId },
    select: {
      id: true,
      deviceId: true,
    },
  });

  if (!existing || (input.deviceId != null && existing.deviceId !== input.deviceId)) {
    throw new MultiTenantDomainError('ALLOCATION_NOT_FOUND', `Allocation ${input.allocationId} not found`);
  }

  if (input.landlordUserId != null) {
    const device = await prisma.device.findUnique({
      where: { id: existing.deviceId },
      select: {
        id: true,
        userId: true,
      },
    });

    if (!device) {
      throw new MultiTenantDomainError('DEVICE_NOT_FOUND', `Device ${existing.deviceId} not found`);
    }

    if (device.userId !== input.landlordUserId) {
      throw new MultiTenantDomainError(
        'DEVICE_NOT_OWNED',
        `Device ${existing.deviceId} is not owned by landlord ${input.landlordUserId}`,
      );
    }
  }

  await prisma.renterAllocation.delete({ where: { id: existing.id } });
}
