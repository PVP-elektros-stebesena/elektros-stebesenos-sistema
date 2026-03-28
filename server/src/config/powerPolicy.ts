export interface PowerPolicyThresholds {
  maxActivePowerKw: number;
  maxReactivePowerKvar: number;
  minPowerFactor: number;
  maxPhaseImbalancePct: number;
  maxRampKwPerMinute: number;
}

export interface EffectivePowerPolicy extends PowerPolicyThresholds {
  source: 'default' | 'device_override';
  policyVersion: string;
  effectiveFrom: Date;
}

export const DEFAULT_POWER_POLICY: EffectivePowerPolicy = {
  maxActivePowerKw: 12,
  maxReactivePowerKvar: 8,
  minPowerFactor: 0.9,
  maxPhaseImbalancePct: 25,
  maxRampKwPerMinute: 6,
  source: 'default',
  policyVersion: 'default-v1',
  effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
};
