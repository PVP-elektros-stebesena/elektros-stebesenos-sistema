import prisma from '../lib/prisma.js';

export type BillingPeriodDomainErrorCode = 'INVALID_DATE_RANGE' | 'BILLING_PERIOD_OVERLAP';

export class BillingPeriodDomainError extends Error {
  code: BillingPeriodDomainErrorCode;

  constructor(code: BillingPeriodDomainErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface CreateBillingPeriodInput {
  deviceId: number;
  startsAt: Date | string;
  endsAt: Date | string;
}

function normalizeRequiredDate(value: Date | string, fieldName: string): Date {
  const parsed = typeof value === 'string' ? new Date(value) : value;
  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
    throw new BillingPeriodDomainError('INVALID_DATE_RANGE', `${fieldName} must be a valid ISO datetime`);
  }

  return parsed;
}

function validateDateRange(startsAt: Date, endsAt: Date): void {
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new BillingPeriodDomainError('INVALID_DATE_RANGE', 'endsAt must be after startsAt');
  }
}

export async function createBillingPeriod(input: CreateBillingPeriodInput) {
  const startsAt = normalizeRequiredDate(input.startsAt, 'startsAt');
  const endsAt = normalizeRequiredDate(input.endsAt, 'endsAt');
  validateDateRange(startsAt, endsAt);

  return prisma.$transaction(async (tx) => {
    const overlap = await tx.billingPeriod.findFirst({
      where: {
        deviceId: input.deviceId,
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      select: { id: true },
    });

    if (overlap) {
      throw new BillingPeriodDomainError(
        'BILLING_PERIOD_OVERLAP',
        'Overlapping billing periods are not allowed for the same device',
      );
    }

    return tx.billingPeriod.create({
      data: {
        deviceId: input.deviceId,
        startsAt,
        endsAt,
      },
    });
  });
}
