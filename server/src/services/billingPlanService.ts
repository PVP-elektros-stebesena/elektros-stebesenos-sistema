import prisma from '../lib/prisma.js';
import type { SpotPriceProviderName, SpotPriceZone } from './spotPriceProvider.js';

export type PricingMode = 'FIXED' | 'DYNAMIC';
export type SpotProvider = SpotPriceProviderName;
export type SpotZone = SpotPriceZone;

export interface BillingPlanPayload {
  pricingMode: PricingMode;
  effectiveFrom: string;
  fixedRates?: {
    t1: number | null;
    t2: number | null;
    t3: number | null;
    t4: number | null;
  };
  dynamic?: {
    provider: SpotProvider;
    zone: SpotZone;
    spotAdderEurPerKwh: number;
  };
  monthlyFixedFeeEur: number | null;
}

export interface BillingPlanResponse {
  id: number;
  pricingMode: PricingMode;
  effectiveFrom: string;
  effectiveTo: string | null;
  fixedRates: {
    t1: number | null;
    t2: number | null;
    t3: number | null;
    t4: number | null;
  } | null;
  dynamic: {
    provider: SpotProvider;
    zone: SpotZone;
    spotAdderEurPerKwh: number;
  } | null;
  monthlyFixedFeeEur: number | null;
}

type BillingPlanRow = Awaited<ReturnType<typeof prisma.billingPlan.findFirst>>;

function toBillingPlanResponse(row: NonNullable<BillingPlanRow>): BillingPlanResponse {
  const pricingMode = row.pricingMode as PricingMode;
  return {
    id: row.id,
    pricingMode,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
    fixedRates: pricingMode === 'FIXED'
      ? {
          t1: row.rateT1,
          t2: row.rateT2,
          t3: row.rateT3,
          t4: row.rateT4,
        }
      : null,
    dynamic: pricingMode === 'DYNAMIC' && row.spotProvider && row.spotZone && row.spotAdderEurPerKwh != null
      ? {
          provider: row.spotProvider as SpotProvider,
          zone: row.spotZone as SpotZone,
          spotAdderEurPerKwh: row.spotAdderEurPerKwh,
        }
      : null,
    monthlyFixedFeeEur: row.monthlyFixedFeeEur,
  };
}

export async function getActiveBillingPlan(
  deviceId: number,
  at = new Date(),
): Promise<BillingPlanResponse | null> {
  const plan = await prisma.billingPlan.findFirst({
    where: {
      deviceId,
      effectiveFrom: { lte: at },
      OR: [
        { effectiveTo: null },
        { effectiveTo: { gt: at } },
      ],
    },
    orderBy: { effectiveFrom: 'desc' },
  });

  return plan ? toBillingPlanResponse(plan) : null;
}

export async function getActiveBillingPlansByDeviceIds(
  deviceIds: number[],
  at = new Date(),
): Promise<Map<number, BillingPlanResponse>> {
  if (deviceIds.length === 0) return new Map();

  const plans = await prisma.billingPlan.findMany({
    where: {
      deviceId: { in: deviceIds },
      effectiveFrom: { lte: at },
      OR: [
        { effectiveTo: null },
        { effectiveTo: { gt: at } },
      ],
    },
    orderBy: [
      { deviceId: 'asc' },
      { effectiveFrom: 'desc' },
    ],
  });

  const result = new Map<number, BillingPlanResponse>();
  for (const plan of plans) {
    if (!result.has(plan.deviceId)) {
      result.set(plan.deviceId, toBillingPlanResponse(plan));
    }
  }
  return result;
}

export async function listBillingPlans(deviceId: number): Promise<BillingPlanResponse[]> {
  const plans = await prisma.billingPlan.findMany({
    where: { deviceId },
    orderBy: { effectiveFrom: 'desc' },
  });

  return plans.map((plan) => toBillingPlanResponse(plan));
}

export async function saveBillingPlan(
  deviceId: number,
  payload: BillingPlanPayload,
): Promise<BillingPlanResponse> {
  const effectiveFrom = new Date(payload.effectiveFrom);

  const created = await prisma.$transaction(async (tx) => {
    const existingPlans = await tx.billingPlan.findMany({
      where: { deviceId },
      orderBy: { effectiveFrom: 'asc' },
    });

    const replacement = existingPlans.find(
      (plan) => plan.effectiveFrom.getTime() === effectiveFrom.getTime(),
    );
    const nextPlan = existingPlans.find(
      (plan) => plan.effectiveFrom.getTime() > effectiveFrom.getTime(),
    );

    if (replacement) {
      await tx.billingPlan.delete({
        where: { id: replacement.id },
      });
    }

    await tx.billingPlan.updateMany({
      where: {
        deviceId,
        effectiveFrom: { lt: effectiveFrom },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gt: effectiveFrom } },
        ],
      },
        data: {
          effectiveTo: effectiveFrom,
        },
      });

    if (nextPlan) {
      await tx.billingPlan.updateMany({
        where: {
          deviceId,
          effectiveFrom: { gt: effectiveFrom, lt: nextPlan.effectiveFrom },
        },
        data: {
          effectiveTo: nextPlan.effectiveFrom,
        },
      });
    }

    return tx.billingPlan.create({
      data: {
        deviceId,
        pricingMode: payload.pricingMode,
        effectiveFrom,
        effectiveTo: nextPlan?.effectiveFrom ?? null,
        rateT1: payload.pricingMode === 'FIXED' ? payload.fixedRates?.t1 ?? null : null,
        rateT2: payload.pricingMode === 'FIXED' ? payload.fixedRates?.t2 ?? null : null,
        rateT3: payload.pricingMode === 'FIXED' ? payload.fixedRates?.t3 ?? null : null,
        rateT4: payload.pricingMode === 'FIXED' ? payload.fixedRates?.t4 ?? null : null,
        monthlyFixedFeeEur: payload.monthlyFixedFeeEur,
        spotProvider: payload.pricingMode === 'DYNAMIC' ? payload.dynamic?.provider ?? null : null,
        spotZone: payload.pricingMode === 'DYNAMIC' ? payload.dynamic?.zone ?? null : null,
        spotAdderEurPerKwh: payload.pricingMode === 'DYNAMIC'
          ? payload.dynamic?.spotAdderEurPerKwh ?? null
          : null,
      },
    });
  });

  return toBillingPlanResponse(created);
}
