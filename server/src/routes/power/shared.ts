import { analysePowerReading } from '../../services/powerAnalysis.js';
import { toPowerReading, type P1ReadingData } from '../../services/p1Parser.js';

export interface DeviceQuery {
  deviceId?: string;
}

export interface TimeRangeQuery extends DeviceQuery {
  from?: string;
  to?: string;
}

export interface HistoryQuery extends TimeRangeQuery {
  points?: string;
  interval?: string;
}

export interface AnomalyQuery extends TimeRangeQuery {
  type?: string;
  metricName?: string;
  phase?: string;
  limit?: string;
}

function mapReadingToP1ReadingData(row: {
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
}): P1ReadingData {
  return { ...row };
}

export const RAW_READING_SELECT = {
  deviceId: true,
  timestamp: true,
  energyDelivered: true,
  energyReturned: true,
  reactiveEnergyDelivered: true,
  reactiveEnergyReturned: true,
  energyDeliveredTariff1: true,
  energyDeliveredTariff2: true,
  energyDeliveredTariff3: true,
  energyDeliveredTariff4: true,
  energyReturnedTariff1: true,
  energyReturnedTariff2: true,
  energyReturnedTariff3: true,
  energyReturnedTariff4: true,
  reactiveEnergyDeliveredTariff1: true,
  reactiveEnergyDeliveredTariff2: true,
  reactiveEnergyDeliveredTariff3: true,
  reactiveEnergyDeliveredTariff4: true,
  reactiveEnergyReturnedTariff1: true,
  reactiveEnergyReturnedTariff2: true,
  reactiveEnergyReturnedTariff3: true,
  reactiveEnergyReturnedTariff4: true,
  instantaneousVoltageL1: true,
  voltageL1: true,
  instantaneousCurrentL1: true,
  currentL1: true,
  instantaneousVoltageL2: true,
  voltageL2: true,
  instantaneousCurrentL2: true,
  currentL2: true,
  instantaneousVoltageL3: true,
  voltageL3: true,
  instantaneousCurrentL3: true,
  currentL3: true,
  instantaneousVoltage: true,
  instantaneousCurrent: true,
  instantaneousCurrentNeutral: true,
  currentNeutral: true,
  frequency: true,
  activeInstantaneousPowerDelivered: true,
  activeInstantaneousPowerDeliveredL1: true,
  activeInstantaneousPowerDeliveredL2: true,
  activeInstantaneousPowerDeliveredL3: true,
  activeInstantaneousPowerReturnedL1: true,
  activeInstantaneousPowerReturnedL2: true,
  activeInstantaneousPowerReturnedL3: true,
  reactiveInstantaneousPowerDeliveredL1: true,
  reactiveInstantaneousPowerDeliveredL2: true,
  reactiveInstantaneousPowerDeliveredL3: true,
  reactiveInstantaneousPowerReturnedL1: true,
  reactiveInstantaneousPowerReturnedL2: true,
  reactiveInstantaneousPowerReturnedL3: true,
  apparentInstantaneousPower: true,
  apparentInstantaneousPowerL1: true,
  apparentInstantaneousPowerL2: true,
  apparentInstantaneousPowerL3: true,
  powerDeliveredTotal: true,
  powerReturnedTotal: true,
  reactiveEnergyDeliveredCurrentPeriod: true,
  reactiveEnergyReturnedCurrentPeriod: true,
  powerDeliveredNetto: true,
} as const;

export function downsample<T>(items: T[], maxPoints: number): T[] {
  if (items.length <= maxPoints) return items;
  if (maxPoints <= 1) return [items[items.length - 1]!];

  const step = (items.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, index) => (
    items[Math.round(index * step)]!
  ));
}

export function toPowerPayload(row: {
  deviceId: number;
  timestamp: Date;
} & P1ReadingData) {
  const powerReading = toPowerReading(mapReadingToP1ReadingData(row), row.timestamp);
  const metrics = analysePowerReading(powerReading);
  return {
    deviceId: row.deviceId,
    timestamp: row.timestamp,
    activePowerTotalKw: metrics.activePowerTotalKw,
    reactivePowerTotalKvar: metrics.reactivePowerTotalKvar,
    apparentPowerTotalKva: metrics.apparentPowerTotalKva,
    powerFactor: metrics.powerFactor,
    phaseImbalancePct: metrics.phaseImbalancePct,
    activePowerL1Kw: metrics.activePowerL1Kw,
    activePowerL2Kw: metrics.activePowerL2Kw,
    activePowerL3Kw: metrics.activePowerL3Kw,
    reactivePowerL1Kvar: metrics.reactivePowerL1Kvar,
    reactivePowerL2Kvar: metrics.reactivePowerL2Kvar,
    reactivePowerL3Kvar: metrics.reactivePowerL3Kvar,
  };
}
