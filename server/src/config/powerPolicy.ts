export enum PowerProfilePreset {
  APARTMENT_1P_5KW = 'APARTMENT_1P_5KW',
  APARTMENT_1P_7KW = 'APARTMENT_1P_7KW',
  HOUSE_3P_11KW = 'HOUSE_3P_11KW',
  HOUSE_3P_18KW = 'HOUSE_3P_18KW',
  SOLAR_PROSUMER_3P_22KW = 'SOLAR_PROSUMER_3P_22KW',
}

export const POWER_PROFILE_PRESET_VALUES = [
  PowerProfilePreset.APARTMENT_1P_5KW,
  PowerProfilePreset.APARTMENT_1P_7KW,
  PowerProfilePreset.HOUSE_3P_11KW,
  PowerProfilePreset.HOUSE_3P_18KW,
  PowerProfilePreset.SOLAR_PROSUMER_3P_22KW,
] as const;

export interface PowerPolicyThresholds {
  maxActivePowerKw: number;
  maxReactivePowerKvar: number;
  minPowerFactor: number;
  maxPhaseImbalancePct: number;
  maxRampKwPerMinute: number;
}

export interface PowerProfileDefinition extends PowerPolicyThresholds {
  profile: PowerProfilePreset;
  label: string;
  phaseCount: 1 | 3;
  contractPowerKw: number;
  perPhaseCurrentLimitAmps: number;
  targetPowerFactor: number;
  policyVersion: string;
}

export interface EffectivePowerPolicy extends PowerProfileDefinition {
  source: 'profile_preset' | 'device_override';
  effectiveFrom: Date;
}

export const DEFAULT_POWER_PROFILE = PowerProfilePreset.HOUSE_3P_11KW;

const PROFILE_EFFECTIVE_FROM = new Date('2026-04-06T00:00:00.000Z');
const PF_BASELINE_FOR_REACTIVE_LIMIT = 0.9;
const PHASE_IMBALANCE_BASELINE_PCT = 2;

function roundToSingleDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function calculateReactiveLimitKvar(contractPowerKw: number): number {
  const angle = Math.acos(PF_BASELINE_FOR_REACTIVE_LIMIT);
  return roundToSingleDecimal(contractPowerKw * Math.tan(angle));
}

function calculateRampLimitKwPerMinute(contractPowerKw: number): number {
  return roundToSingleDecimal(contractPowerKw <= 11 ? contractPowerKw * 0.1 : 1.5);
}

function definePreset(input: {
  profile: PowerProfilePreset;
  label: string;
  phaseCount: 1 | 3;
  contractPowerKw: number;
  perPhaseCurrentLimitAmps: number;
  targetPowerFactor: number;
  minPowerFactor: number;
}): PowerProfileDefinition {
  return {
    ...input,
    maxActivePowerKw: input.contractPowerKw,
    maxReactivePowerKvar: calculateReactiveLimitKvar(input.contractPowerKw),
    maxPhaseImbalancePct: PHASE_IMBALANCE_BASELINE_PCT,
    maxRampKwPerMinute: calculateRampLimitKwPerMinute(input.contractPowerKw),
    policyVersion: `${input.profile.toLowerCase()}-v1`,
  };
}

export const POWER_PROFILE_PRESETS: Record<PowerProfilePreset, PowerProfileDefinition> = {
  [PowerProfilePreset.APARTMENT_1P_5KW]: definePreset({
    profile: PowerProfilePreset.APARTMENT_1P_5KW,
    label: '1-Phase Apartment',
    phaseCount: 1,
    contractPowerKw: 5,
    perPhaseCurrentLimitAmps: 25,
    targetPowerFactor: 0.95,
    minPowerFactor: 0.9,
  }),
  [PowerProfilePreset.APARTMENT_1P_7KW]: definePreset({
    profile: PowerProfilePreset.APARTMENT_1P_7KW,
    label: '1-Phase Apartment Plus',
    phaseCount: 1,
    contractPowerKw: 7,
    perPhaseCurrentLimitAmps: 32,
    targetPowerFactor: 0.95,
    minPowerFactor: 0.9,
  }),
  [PowerProfilePreset.HOUSE_3P_11KW]: definePreset({
    profile: PowerProfilePreset.HOUSE_3P_11KW,
    label: '11kW 3-Phase House',
    phaseCount: 3,
    contractPowerKw: 11,
    perPhaseCurrentLimitAmps: 16,
    targetPowerFactor: 0.95,
    minPowerFactor: 0.9,
  }),
  [PowerProfilePreset.HOUSE_3P_18KW]: definePreset({
    profile: PowerProfilePreset.HOUSE_3P_18KW,
    label: '18kW 3-Phase House',
    phaseCount: 3,
    contractPowerKw: 18,
    perPhaseCurrentLimitAmps: 25,
    targetPowerFactor: 0.95,
    minPowerFactor: 0.9,
  }),
  [PowerProfilePreset.SOLAR_PROSUMER_3P_22KW]: definePreset({
    profile: PowerProfilePreset.SOLAR_PROSUMER_3P_22KW,
    label: 'Solar Prosumer',
    phaseCount: 3,
    contractPowerKw: 22,
    perPhaseCurrentLimitAmps: 32,
    targetPowerFactor: 0.9,
    minPowerFactor: 0.8,
  }),
};

export function isPowerProfilePreset(value: unknown): value is PowerProfilePreset {
  return typeof value === 'string'
    && (POWER_PROFILE_PRESET_VALUES as readonly string[]).includes(value);
}

export function getPowerProfileDefinition(
  profile: PowerProfilePreset | string | null | undefined,
): PowerProfileDefinition {
  const resolvedProfile = isPowerProfilePreset(profile)
    ? profile
    : DEFAULT_POWER_PROFILE;

  return POWER_PROFILE_PRESETS[resolvedProfile];
}

export function buildPresetPowerPolicy(
  profile: PowerProfilePreset | string | null | undefined,
): EffectivePowerPolicy {
  return {
    ...getPowerProfileDefinition(profile),
    source: 'profile_preset',
    effectiveFrom: PROFILE_EFFECTIVE_FROM,
  };
}

export const DEFAULT_POWER_POLICY: EffectivePowerPolicy =
  buildPresetPowerPolicy(DEFAULT_POWER_PROFILE);
