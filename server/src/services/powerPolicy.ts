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
          maxActivePowerKw: preset.maxActivePowerKw,
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
        maxActivePowerKw: preset.maxActivePowerKw,
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

  const policy: EffectivePowerPolicy = override
    ? {
        ...presetPolicy,
        maxActivePowerKw: override.maxActivePowerKw ?? presetPolicy.maxActivePowerKw,
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
