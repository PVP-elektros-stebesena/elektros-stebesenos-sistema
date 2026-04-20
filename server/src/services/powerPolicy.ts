import prisma from '../lib/prisma.js';
import {
  buildPresetPowerPolicy,
  getPowerProfileDefinition,
  type PowerProfilePreset,
  type EffectivePowerPolicy,
} from '../config/powerPolicy.js';

const CACHE_TTL_MS = 60_000;
const PROFILE_SYNC_POLICY_VERSION_PREFIX = 'preset-sync:';

const policyCache = new Map<number, { expiresAt: number; policy: EffectivePowerPolicy }>();

export function clearPowerPolicyCache(deviceId?: number): void {
  if (deviceId == null) {
    policyCache.clear();
    return;
  }
  policyCache.delete(deviceId);
}

function buildProfileSyncPolicyVersion(profile: PowerProfilePreset): string {
  return `${PROFILE_SYNC_POLICY_VERSION_PREFIX}${profile.toLowerCase()}-v1`;
}

function roundToSingleDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

export async function syncPowerProfileOverride(
  deviceId: number,
  profile: PowerProfilePreset,
  at: Date = new Date(),
): Promise<void> {
  const preset = getPowerProfileDefinition(profile);
  const policyVersion = buildProfileSyncPolicyVersion(profile);

  await prisma.$transaction(async (tx) => {
    await tx.powerPolicyOverride.updateMany({
      where: {
        deviceId,
        enabled: true,
        effectiveTo: null,
        policyVersion: {
          startsWith: PROFILE_SYNC_POLICY_VERSION_PREFIX,
          not: policyVersion,
        },
      },
      data: {
        enabled: false,
        effectiveTo: at,
      },
    });

    const existing = await tx.powerPolicyOverride.findFirst({
      where: {
        deviceId,
        enabled: true,
        effectiveTo: null,
        policyVersion,
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (existing) {
      await tx.powerPolicyOverride.update({
        where: { id: existing.id },
        data: {
          maxActivePowerKw: preset.criticalThreshold,
          maxReactivePowerKvar: preset.maxReactivePowerKvar,
          minPowerFactor: preset.minPowerFactor,
          maxPhaseImbalancePct: preset.maxPhaseImbalancePct,
          maxRampKwPerMinute: preset.maxRampKwPerMinute,
          enabled: true,
          effectiveTo: null,
        },
      });
      return;
    }

    await tx.powerPolicyOverride.create({
      data: {
        deviceId,
        maxActivePowerKw: preset.criticalThreshold,
        maxReactivePowerKvar: preset.maxReactivePowerKvar,
        minPowerFactor: preset.minPowerFactor,
        maxPhaseImbalancePct: preset.maxPhaseImbalancePct,
        maxRampKwPerMinute: preset.maxRampKwPerMinute,
        effectiveFrom: at,
        enabled: true,
        policyVersion,
      },
    });
  });
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

  const [device, override] = await Promise.all([
    prisma.device.findUnique({
      where: { id: deviceId },
      select: { powerProfile: true },
    }),
    prisma.powerPolicyOverride.findFirst({
      where: {
        deviceId,
        enabled: true,
        policyVersion: {
          not: {
            startsWith: PROFILE_SYNC_POLICY_VERSION_PREFIX,
          },
        },
        effectiveFrom: { lte: at },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: at } },
        ],
      },
      orderBy: { effectiveFrom: 'desc' },
    }),
  ]);

  const presetPolicy = buildPresetPowerPolicy(device?.powerProfile);
  const overrideCriticalThreshold = override?.maxActivePowerKw;
  const resolvedCriticalThreshold =
    overrideCriticalThreshold ?? presetPolicy.criticalThreshold;
  const resolvedWarningThreshold = overrideCriticalThreshold != null
    ? roundToSingleDecimal(resolvedCriticalThreshold * 0.9)
    : presetPolicy.warningThreshold;

  const policy: EffectivePowerPolicy = override
    ? {
        ...presetPolicy,
        warningThreshold: resolvedWarningThreshold,
        criticalThreshold: resolvedCriticalThreshold,
        maxReactivePowerKvar:
          override.maxReactivePowerKvar ?? presetPolicy.maxReactivePowerKvar,
        minPowerFactor: override.minPowerFactor ?? presetPolicy.minPowerFactor,
        maxPhaseImbalancePct:
          override.maxPhaseImbalancePct ?? presetPolicy.maxPhaseImbalancePct,
        maxRampKwPerMinute:
          override.maxRampKwPerMinute ?? presetPolicy.maxRampKwPerMinute,
        source: 'device_override',
        policyVersion: override.policyVersion,
        effectiveFrom: override.effectiveFrom,
      }
    : presetPolicy;

  policyCache.set(deviceId, { expiresAt: now + CACHE_TTL_MS, policy });
  return policy;
}
