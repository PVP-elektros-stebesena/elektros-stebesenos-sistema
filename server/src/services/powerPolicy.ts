import prisma from '../lib/prisma.js';
import {
  DEFAULT_POWER_POLICY,
  type EffectivePowerPolicy,
} from '../config/powerPolicy.js';

const CACHE_TTL_MS = 60_000;

const policyCache = new Map<number, { expiresAt: number; policy: EffectivePowerPolicy }>();

export function clearPowerPolicyCache(deviceId?: number): void {
  if (deviceId == null) {
    policyCache.clear();
    return;
  }
  policyCache.delete(deviceId);
}

export async function resolveEffectivePowerPolicy(
  deviceId: number,
  at: Date = new Date(),
): Promise<EffectivePowerPolicy> {
  const now = Date.now();
  const cached = policyCache.get(deviceId);
  if (cached && cached.expiresAt > now) {
    return cached.policy;
  }

  const override = await prisma.powerPolicyOverride.findFirst({
    where: {
      deviceId,
      enabled: true,
      effectiveFrom: { lte: at },
      OR: [
        { effectiveTo: null },
        { effectiveTo: { gte: at } },
      ],
    },
    orderBy: { effectiveFrom: 'desc' },
  });

  const policy: EffectivePowerPolicy = override
    ? {
        maxActivePowerKw: override.maxActivePowerKw ?? DEFAULT_POWER_POLICY.maxActivePowerKw,
        maxReactivePowerKvar:
          override.maxReactivePowerKvar ?? DEFAULT_POWER_POLICY.maxReactivePowerKvar,
        minPowerFactor: override.minPowerFactor ?? DEFAULT_POWER_POLICY.minPowerFactor,
        maxPhaseImbalancePct:
          override.maxPhaseImbalancePct ?? DEFAULT_POWER_POLICY.maxPhaseImbalancePct,
        maxRampKwPerMinute:
          override.maxRampKwPerMinute ?? DEFAULT_POWER_POLICY.maxRampKwPerMinute,
        source: 'device_override',
        policyVersion: override.policyVersion,
        effectiveFrom: override.effectiveFrom,
      }
    : DEFAULT_POWER_POLICY;

  policyCache.set(deviceId, { expiresAt: now + CACHE_TTL_MS, policy });
  return policy;
}
