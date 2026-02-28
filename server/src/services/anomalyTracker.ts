import { PHASES, type Phase } from '../config/eso.js';
import {
  type VoltageReading,
  type DetectedAnomaly,
  getVoltageForPhase,
  isVoltageZero,
  isVoltageInBounds,
  createInterruptionAnomaly,
  createDeviationAnomaly,
} from './voltageAnalysis.js';

// Internal state per phase

interface InterruptionState {
  ongoing: boolean;
  startedAt: Date | null;
}

interface DeviationState {
  ongoing: boolean;
  startedAt: Date | null;
  voltageMin: number;
  voltageMax: number;
}

interface PhaseState {
  interruption: InterruptionState;
  deviation: DeviationState;
}

// Tracker class

/**
 * Stateful tracker that processes readings one-by-one and emits
 * DetectedAnomaly objects when anomalies start or resolve.
 *
 * Usage:
 *   const tracker = new AnomalyTracker();
 *   // on every poll:
 *   const newAnomalies = tracker.processReading(reading);
 *   // persist newAnomalies to DB
 */
export class AnomalyTracker {
  private state: Record<Phase, PhaseState>;

  constructor() {
    this.state = {} as Record<Phase, PhaseState>;
    for (const phase of PHASES) {
      this.state[phase] = {
        interruption: { ongoing: false, startedAt: null },
        deviation: { ongoing: false, startedAt: null, voltageMin: Infinity, voltageMax: -Infinity },
      };
    }
  }

  /**
   * Process a single reading. Returns an array of newly detected/resolved
   * anomalies (may be empty if nothing changed).
   */
  processReading(reading: VoltageReading): DetectedAnomaly[] {
    const anomalies: DetectedAnomaly[] = [];
    const now = reading.timestamp;

    for (const phase of PHASES) {
      const voltage = getVoltageForPhase(reading, phase);
      const phaseState = this.state[phase];

      // Interruption tracking
      if (isVoltageZero(voltage)) {
        // Voltage is gone
        if (!phaseState.interruption.ongoing) {
          phaseState.interruption.ongoing = true;
          phaseState.interruption.startedAt = now;
        }
        // Also resolve any open deviation - it turned into an interruption
        if (phaseState.deviation.ongoing && phaseState.deviation.startedAt) {
          // Close the deviation, the interruption tracker takes over
          phaseState.deviation.ongoing = false;
          phaseState.deviation.startedAt = null;
        }
      } else {
        // Voltage is present
        if (phaseState.interruption.ongoing && phaseState.interruption.startedAt) {
          // Just recovered - classify and emit
          const anomaly = createInterruptionAnomaly(
            phase,
            phaseState.interruption.startedAt,
            now,
            voltage,
          );
          anomalies.push(anomaly);

          phaseState.interruption.ongoing = false;
          phaseState.interruption.startedAt = null;
        }

        // Voltage deviation tracking
        if (!isVoltageInBounds(voltage)) {
          if (!phaseState.deviation.ongoing) {
            // New deviation starts
            phaseState.deviation.ongoing = true;
            phaseState.deviation.startedAt = now;
            phaseState.deviation.voltageMin = voltage;
            phaseState.deviation.voltageMax = voltage;

            anomalies.push(createDeviationAnomaly(phase, now, voltage));
          } else {
            // Ongoing deviation - track min/max
            phaseState.deviation.voltageMin = Math.min(phaseState.deviation.voltageMin, voltage);
            phaseState.deviation.voltageMax = Math.max(phaseState.deviation.voltageMax, voltage);
          }
        } else {
          // Voltage back in bounds - resolve open deviation
          if (phaseState.deviation.ongoing && phaseState.deviation.startedAt) {
            const durationSeconds =
              (now.getTime() - phaseState.deviation.startedAt.getTime()) / 1000;

            const resolved: DetectedAnomaly = {
              startedAt: phaseState.deviation.startedAt,
              endedAt: now,
              phase,
              type: 'VOLTAGE_DEVIATION',
              severity: 'WARNING',
              voltageMin: phaseState.deviation.voltageMin,
              voltageMax: phaseState.deviation.voltageMax,
              durationSeconds,
            };
            anomalies.push(resolved);

            phaseState.deviation.ongoing = false;
            phaseState.deviation.startedAt = null;
            phaseState.deviation.voltageMin = Infinity;
            phaseState.deviation.voltageMax = -Infinity;
          }
        }
      }
    }

    return anomalies;
  }

  /** Get all currently active (unresolved) anomalies. */
  getActiveAnomalies(): { phase: Phase; type: 'interruption' | 'deviation'; startedAt: Date }[] {
    const active: { phase: Phase; type: 'interruption' | 'deviation'; startedAt: Date }[] = [];

    for (const phase of PHASES) {
      const ps = this.state[phase];
      if (ps.interruption.ongoing && ps.interruption.startedAt) {
        active.push({ phase, type: 'interruption', startedAt: ps.interruption.startedAt });
      }
      if (ps.deviation.ongoing && ps.deviation.startedAt) {
        active.push({ phase, type: 'deviation', startedAt: ps.deviation.startedAt });
      }
    }

    return active;
  }

  /** Reset all tracking state. */
  reset(): void {
    for (const phase of PHASES) {
      this.state[phase] = {
        interruption: { ongoing: false, startedAt: null },
        deviation: { ongoing: false, startedAt: null, voltageMin: Infinity, voltageMax: -Infinity },
      };
    }
  }
}