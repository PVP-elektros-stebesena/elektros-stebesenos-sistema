import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POWER_PROFILE,
  POWER_PROFILE_PRESETS,
  PowerProfilePreset,
  buildPresetPowerPolicy,
} from '../../config/powerPolicy.js';

describe('power profile presets', () => {
  it('defines the expected research-backed preset library', () => {
    expect(Object.keys(POWER_PROFILE_PRESETS)).toHaveLength(5);

    expect(POWER_PROFILE_PRESETS[PowerProfilePreset.APARTMENT_1P_5KW]).toMatchObject({
      contractPowerKw: 5,
      perPhaseCurrentLimitAmps: 25,
      targetPowerFactor: 0.95,
    });

    expect(POWER_PROFILE_PRESETS[PowerProfilePreset.HOUSE_3P_11KW]).toMatchObject({
      contractPowerKw: 11,
      perPhaseCurrentLimitAmps: 16,
      targetPowerFactor: 0.95,
    });

    expect(POWER_PROFILE_PRESETS[PowerProfilePreset.SOLAR_PROSUMER_3P_22KW]).toMatchObject({
      contractPowerKw: 22,
      perPhaseCurrentLimitAmps: 32,
      targetPowerFactor: 0.9,
      minPowerFactor: 0.8,
    });
  });

  it('builds the default policy from the default preset', () => {
    const policy = buildPresetPowerPolicy(DEFAULT_POWER_PROFILE);

    expect(policy.source).toBe('profile_preset');
    expect(policy.profile).toBe(DEFAULT_POWER_PROFILE);
    expect(policy.maxActivePowerKw).toBe(11);
    expect(policy.perPhaseCurrentLimitAmps).toBe(16);
  });
});
