import { ESO } from '../config/eso.js';

/**
 * Scenario definitions for the mock P1 gateway.
 *
 * Each scenario produces per-phase voltage/current/power values
 * that simulate real-world grid conditions - from normal operation
 * to ESO-defined anomalies.
 */

export type ScenarioName =
  | 'normal'
  | 'voltage-sag'
  | 'voltage-swell'
  | 'short-interruption'
  | 'long-interruption'
  | 'phase-l1-drop'
  | 'phase-l2-swell'
  | 'brownout'
  | 'fluctuating'
  | 'borderline'
  | 'recovery'
  | 'custom';

export interface PhaseValues {
  voltage: number;
  current: number;
  powerDelivered: number;
  powerReturned: number;
}

export interface ScenarioOutput {
  l1: PhaseValues;
  l2: PhaseValues;
  l3: PhaseValues;
  frequency: number;
}

export interface ScenarioConfig {
  name: ScenarioName;
  description: string;
  /** Duration hint in seconds (how long this scenario typically lasts) */
  durationHint: number;
  /** Generate values for the current tick */
  generate: (tickIndex: number) => ScenarioOutput;
}

// Helpers

/** Random float in [min, max] */
function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Small realistic noise +-jitter volts around a base value */
function noise(base: number, jitter: number = 1.5): number {
  return base + rand(-jitter, jitter);
}

/** Calculate realistic current/power from voltage */
function derivePhase(voltage: number, loadAmps: number = 5): PhaseValues {
  const current = voltage > ESO.VOLTAGE_ZERO_THRESHOLD ? rand(loadAmps * 0.5, loadAmps * 1.5) : 0;
  return {
    voltage: +voltage.toFixed(3),
    current: +current.toFixed(3),
    powerDelivered: +(voltage * current / 1000).toFixed(3), // kW
    powerReturned: 0,
  };
}

/** Build output from 3 voltage values */
function fromVoltages(v1: number, v2: number, v3: number, freq: number = 50): ScenarioOutput {
  return {
    l1: derivePhase(v1),
    l2: derivePhase(v2),
    l3: derivePhase(v3),
    frequency: +noise(freq, 0.05).toFixed(3),
  };
}

// Scenario implementations

const normal: ScenarioConfig = {
  name: 'normal',
  description: 'Normal grid operation. Voltage ~230V ±2V per phase.',
  durationHint: 600,
  generate: () => fromVoltages(noise(230, 2), noise(230, 2), noise(230, 2)),
};

const voltageSag: ScenarioConfig = {
  name: 'voltage-sag',
  description: 'All phases drop to ~210-215V (below ESO 220V min).',
  durationHint: 120,
  generate: () => fromVoltages(noise(212, 3), noise(213, 3), noise(211, 3)),
};

const voltageSwell: ScenarioConfig = {
  name: 'voltage-swell',
  description: 'All phases rise to ~245-250V (above ESO 240V max).',
  durationHint: 120,
  generate: () => fromVoltages(noise(247, 3), noise(246, 3), noise(248, 3)),
};

const shortInterruption: ScenarioConfig = {
  name: 'short-interruption',
  description: 'Complete supply loss for ~60 seconds, then recovery.',
  durationHint: 90,
  generate: (tick) => {
    if (tick < 6) {
      // ~60s of zero voltage (at 10s poll interval)
      return fromVoltages(0, 0, 0);
    }
    // Recovery with slight instability
    return fromVoltages(noise(225, 5), noise(226, 5), noise(224, 5));
  },
};

const longInterruption: ScenarioConfig = {
  name: 'long-interruption',
  description: 'Complete supply loss for >3 minutes (ESO long interruption).',
  durationHint: 300,
  generate: (tick) => {
    if (tick < 24) {
      // ~240s = 4 minutes of zero voltage
      return fromVoltages(0, 0, 0);
    }
    // Slow recovery
    const progress = Math.min((tick - 24) / 6, 1);
    const v = 180 + progress * 50;
    return fromVoltages(noise(v, 3), noise(v, 3), noise(v, 3));
  },
};

const phaseL1Drop: ScenarioConfig = {
  name: 'phase-l1-drop',
  description: 'Only L1 drops to ~200V. L2 and L3 remain normal.',
  durationHint: 180,
  generate: () => fromVoltages(noise(200, 3), noise(230, 2), noise(231, 2)),
};

const phaseL2Swell: ScenarioConfig = {
  name: 'phase-l2-swell',
  description: 'Only L2 rises to ~250V. L1 and L3 remain normal.',
  durationHint: 180,
  generate: () => fromVoltages(noise(230, 2), noise(250, 3), noise(229, 2)),
};

const brownout: ScenarioConfig = {
  name: 'brownout',
  description: 'Gradual voltage decline from 230V down to 200V over time.',
  durationHint: 300,
  generate: (tick) => {
    const drop = Math.min(tick * 1, 30); // 1V per tick, max 30V drop
    const base = 230 - drop;
    return fromVoltages(noise(base, 2), noise(base, 2), noise(base + 1, 2));
  },
};

const fluctuating: ScenarioConfig = {
  name: 'fluctuating',
  description: 'Voltage oscillates between 215V and 245V with a sine pattern.',
  durationHint: 600,
  generate: (tick) => {
    const wave = Math.sin(tick * 0.3) * 15; // +-15V oscillation
    const base = 230 + wave;
    return fromVoltages(
      noise(base, 1),
      noise(base + 2, 1),  // L2 slightly offset
      noise(base - 1, 1),  // L3 slightly offset
    );
  },
};

const borderline: ScenarioConfig = {
  name: 'borderline',
  description: 'Voltage hovers right at ESO bounds (219-221V), crossing in and out.',
  durationHint: 600,
  generate: (tick) => {
    // Slowly oscillates around the 220V lower bound
    const wave = Math.sin(tick * 0.2) * 2;
    const base = 220 + wave;
    return fromVoltages(noise(base, 0.5), noise(230, 2), noise(230, 2));
  },
};

const recovery: ScenarioConfig = {
  name: 'recovery',
  description: 'Simulates power returning after an outage - ramps from 0V to 230V.',
  durationHint: 120,
  generate: (tick) => {
    const progress = Math.min(tick / 12, 1); // 12 ticks (~120s) to full recovery
    const v = progress * 230;
    return fromVoltages(noise(v, v > 50 ? 3 : 0), noise(v, v > 50 ? 3 : 0), noise(v, v > 50 ? 3 : 0));
  },
};

// Registry

export const SCENARIOS: Record<ScenarioName, ScenarioConfig> = {
  'normal': normal,
  'voltage-sag': voltageSag,
  'voltage-swell': voltageSwell,
  'short-interruption': shortInterruption,
  'long-interruption': longInterruption,
  'phase-l1-drop': phaseL1Drop,
  'phase-l2-swell': phaseL2Swell,
  'brownout': brownout,
  'fluctuating': fluctuating,
  'borderline': borderline,
  'recovery': recovery,
  'custom': {
    name: 'custom',
    description: 'User-defined fixed voltage values.',
    durationHint: 0,
    generate: () => fromVoltages(230, 230, 230), // overridden at runtime
  },
};

export const SCENARIO_NAMES = Object.keys(SCENARIOS) as ScenarioName[];
