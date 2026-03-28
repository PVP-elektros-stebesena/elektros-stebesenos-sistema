/**
 * Parses the raw P1 gateway JSON response (all string values)
 * into a typed object matching the Prisma Reading model fields.
 *
 * Also extracts the minimal VoltageReading needed by the analysis pipeline.
 */

import type { VoltageReading } from './voltageAnalysis.js';
import type { PowerReading } from './powerAnalysis.js';

/** All P1 fields mapped to Prisma Reading column names (sans deviceId / timestamp) */
export interface P1ReadingData {
  energyDelivered: number | null;
  energyReturned: number | null;
  reactiveEnergyDelivered: number | null;
  reactiveEnergyReturned: number | null;

  energyDeliveredTariff1: number | null;
  energyDeliveredTariff2: number | null;
  energyDeliveredTariff3: number | null;
  energyDeliveredTariff4: number | null;

  energyReturnedTariff1: number | null;
  energyReturnedTariff2: number | null;
  energyReturnedTariff3: number | null;
  energyReturnedTariff4: number | null;

  reactiveEnergyDeliveredTariff1: number | null;
  reactiveEnergyDeliveredTariff2: number | null;
  reactiveEnergyDeliveredTariff3: number | null;
  reactiveEnergyDeliveredTariff4: number | null;

  reactiveEnergyReturnedTariff1: number | null;
  reactiveEnergyReturnedTariff2: number | null;
  reactiveEnergyReturnedTariff3: number | null;
  reactiveEnergyReturnedTariff4: number | null;

  instantaneousVoltageL1: number | null;
  voltageL1: number | null;
  instantaneousCurrentL1: number | null;
  currentL1: number | null;

  instantaneousVoltageL2: number | null;
  voltageL2: number | null;
  instantaneousCurrentL2: number | null;
  currentL2: number | null;

  instantaneousVoltageL3: number | null;
  voltageL3: number | null;
  instantaneousCurrentL3: number | null;
  currentL3: number | null;

  instantaneousVoltage: number | null;
  instantaneousCurrent: number | null;
  instantaneousCurrentNeutral: number | null;
  currentNeutral: number | null;

  frequency: number | null;

  activeInstantaneousPowerDelivered: number | null;
  activeInstantaneousPowerDeliveredL1: number | null;
  activeInstantaneousPowerDeliveredL2: number | null;
  activeInstantaneousPowerDeliveredL3: number | null;

  activeInstantaneousPowerReturnedL1: number | null;
  activeInstantaneousPowerReturnedL2: number | null;
  activeInstantaneousPowerReturnedL3: number | null;

  reactiveInstantaneousPowerDeliveredL1: number | null;
  reactiveInstantaneousPowerDeliveredL2: number | null;
  reactiveInstantaneousPowerDeliveredL3: number | null;

  reactiveInstantaneousPowerReturnedL1: number | null;
  reactiveInstantaneousPowerReturnedL2: number | null;
  reactiveInstantaneousPowerReturnedL3: number | null;

  apparentInstantaneousPower: number | null;
  apparentInstantaneousPowerL1: number | null;
  apparentInstantaneousPowerL2: number | null;
  apparentInstantaneousPowerL3: number | null;

  powerDeliveredTotal: number | null;
  powerReturnedTotal: number | null;

  reactiveEnergyDeliveredCurrentPeriod: number | null;
  reactiveEnergyReturnedCurrentPeriod: number | null;

  powerDeliveredNetto: number | null;
}

// Mapping from P1 JSON key → Prisma Reading field name
const P1_KEY_MAP: Record<string, keyof P1ReadingData> = {
  EnergyDelivered: 'energyDelivered',
  EnergyReturned: 'energyReturned',
  ReactiveEnergyDelivered: 'reactiveEnergyDelivered',
  ReactiveEnergyReturned: 'reactiveEnergyReturned',

  EnergyDeliveredTariff1: 'energyDeliveredTariff1',
  EnergyDeliveredTariff2: 'energyDeliveredTariff2',
  EnergyDeliveredTariff3: 'energyDeliveredTariff3',
  EnergyDeliveredTariff4: 'energyDeliveredTariff4',

  EnergyReturnedTariff1: 'energyReturnedTariff1',
  EnergyReturnedTariff2: 'energyReturnedTariff2',
  EnergyReturnedTariff3: 'energyReturnedTariff3',
  EnergyReturnedTariff4: 'energyReturnedTariff4',

  ReactiveEnergyDeliveredTariff1: 'reactiveEnergyDeliveredTariff1',
  ReactiveEnergyDeliveredTariff2: 'reactiveEnergyDeliveredTariff2',
  ReactiveEnergyDeliveredTariff3: 'reactiveEnergyDeliveredTariff3',
  ReactiveEnergyDeliveredTariff4: 'reactiveEnergyDeliveredTariff4',

  ReactiveEnergyReturnedTariff1: 'reactiveEnergyReturnedTariff1',
  ReactiveEnergyReturnedTariff2: 'reactiveEnergyReturnedTariff2',
  ReactiveEnergyReturnedTariff3: 'reactiveEnergyReturnedTariff3',
  ReactiveEnergyReturnedTariff4: 'reactiveEnergyReturnedTariff4',

  InstantaneousVoltageL1: 'instantaneousVoltageL1',
  Voltage_l1: 'voltageL1',
  InstantaneousCurrentL1: 'instantaneousCurrentL1',
  Current_l1: 'currentL1',

  InstantaneousVoltageL2: 'instantaneousVoltageL2',
  Voltage_l2: 'voltageL2',
  InstantaneousCurrentL2: 'instantaneousCurrentL2',
  Current_l2: 'currentL2',

  InstantaneousVoltageL3: 'instantaneousVoltageL3',
  Voltage_l3: 'voltageL3',
  InstantaneousCurrentL3: 'instantaneousCurrentL3',
  Current_l3: 'currentL3',

  InstantaneousVoltage: 'instantaneousVoltage',
  InstantaneousCurrent: 'instantaneousCurrent',
  InstantaneousCurrentNeutral: 'instantaneousCurrentNeutral',
  CurrentNeutral: 'currentNeutral',

  Frequency: 'frequency',

  ActiveInstantaneousPowerDelivered: 'activeInstantaneousPowerDelivered',
  ActiveInstantaneousPowerDeliveredL1: 'activeInstantaneousPowerDeliveredL1',
  ActiveInstantaneousPowerDeliveredL2: 'activeInstantaneousPowerDeliveredL2',
  ActiveInstantaneousPowerDeliveredL3: 'activeInstantaneousPowerDeliveredL3',

  ActiveInstantaneousPowerReturnedL1: 'activeInstantaneousPowerReturnedL1',
  ActiveInstantaneousPowerReturnedL2: 'activeInstantaneousPowerReturnedL2',
  ActiveInstantaneousPowerReturnedL3: 'activeInstantaneousPowerReturnedL3',

  ReactiveInstantaneousPowerDeliveredL1: 'reactiveInstantaneousPowerDeliveredL1',
  ReactiveInstantaneousPowerDeliveredL2: 'reactiveInstantaneousPowerDeliveredL2',
  ReactiveInstantaneousPowerDeliveredL3: 'reactiveInstantaneousPowerDeliveredL3',

  ReactiveInstantaneousPowerReturnedL1: 'reactiveInstantaneousPowerReturnedL1',
  ReactiveInstantaneousPowerReturnedL2: 'reactiveInstantaneousPowerReturnedL2',
  ReactiveInstantaneousPowerReturnedL3: 'reactiveInstantaneousPowerReturnedL3',

  ApparentInstantaneousPower: 'apparentInstantaneousPower',
  ApparentInstantaneousPowerL1: 'apparentInstantaneousPowerL1',
  ApparentInstantaneousPowerL2: 'apparentInstantaneousPowerL2',
  ApparentInstantaneousPowerL3: 'apparentInstantaneousPowerL3',

  PowerDelivered_total: 'powerDeliveredTotal',
  PowerReturned_total: 'powerReturnedTotal',

  ReactiveEnergyDeliveredCurrentPeriod: 'reactiveEnergyDeliveredCurrentPeriod',
  ReactiveEnergyReturnedCurrentPeriod: 'reactiveEnergyReturnedCurrentPeriod',

  PowerDeliveredNetto: 'powerDeliveredNetto',
};

/** Parse a string value from P1 JSON, returning null for missing/invalid values */
function parseFloat(val: string | undefined): number | null {
  if (val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isNaN(n) ? null : n;
}

/**
 * Parse raw P1 gateway JSON (Record<string, string>) into typed reading data.
 */
export function parseP1Response(raw: Record<string, string>): P1ReadingData {
  const result = {} as P1ReadingData;

  // Initialise all fields to null
  for (const field of Object.values(P1_KEY_MAP)) {
    result[field] = null;
  }

  // Map known keys
  for (const [jsonKey, dbField] of Object.entries(P1_KEY_MAP)) {
    if (jsonKey in raw) {
      result[dbField] = parseFloat(raw[jsonKey]);
    }
  }

  return result;
}

/**
 * Extract the minimal VoltageReading needed by AnomalyTracker / WindowManager.
 * Falls back to Voltage_l* if InstantaneousVoltageL* is missing.
 */
export function toVoltageReading(data: P1ReadingData, timestamp: Date): VoltageReading {
  return {
    timestamp,
    voltage_l1: data.instantaneousVoltageL1 ?? data.voltageL1 ?? 0,
    voltage_l2: data.instantaneousVoltageL2 ?? data.voltageL2 ?? 0,
    voltage_l3: data.instantaneousVoltageL3 ?? data.voltageL3 ?? 0,
  };
}

function netPower(
  delivered: number | null,
  returned: number | null,
): number | null {
  if (delivered == null && returned == null) return null;
  return (delivered ?? 0) - (returned ?? 0);
}

/**
 * Extracts power-domain values used by the power analytics pipeline.
 */
export function toPowerReading(data: P1ReadingData, timestamp: Date): PowerReading {
  return {
    timestamp,
    activePowerTotalKw: netPower(
      data.powerDeliveredTotal ?? data.activeInstantaneousPowerDelivered,
      data.powerReturnedTotal,
    ),
    activePowerL1Kw: netPower(
      data.activeInstantaneousPowerDeliveredL1,
      data.activeInstantaneousPowerReturnedL1,
    ),
    activePowerL2Kw: netPower(
      data.activeInstantaneousPowerDeliveredL2,
      data.activeInstantaneousPowerReturnedL2,
    ),
    activePowerL3Kw: netPower(
      data.activeInstantaneousPowerDeliveredL3,
      data.activeInstantaneousPowerReturnedL3,
    ),
    reactivePowerL1Kvar: netPower(
      data.reactiveInstantaneousPowerDeliveredL1,
      data.reactiveInstantaneousPowerReturnedL1,
    ),
    reactivePowerL2Kvar: netPower(
      data.reactiveInstantaneousPowerDeliveredL2,
      data.reactiveInstantaneousPowerReturnedL2,
    ),
    reactivePowerL3Kvar: netPower(
      data.reactiveInstantaneousPowerDeliveredL3,
      data.reactiveInstantaneousPowerReturnedL3,
    ),
    apparentPowerTotalKva: data.apparentInstantaneousPower,
    apparentPowerL1Kva: data.apparentInstantaneousPowerL1,
    apparentPowerL2Kva: data.apparentInstantaneousPowerL2,
    apparentPowerL3Kva: data.apparentInstantaneousPowerL3,
  };
}
