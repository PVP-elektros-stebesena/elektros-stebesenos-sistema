export interface LiveData {
  timestamp: string;
  deviceId: number;

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

export interface DailyPoint {
  date: string;
  import: number;
  export: number;
  gas: number;
  cost: number;
}

export interface TimeSeriesPoint {
  time: string;
  value: number;
}

export interface AppSettings {
  device_ip: string;
  mqtt_broker: string;
  mqtt_port: number;
  mqtt_topic: string;
  poll_interval: number;
  timezone: string;
  dsmr_version: string;
  meter_serial: string;
  notifications_enabled: boolean;
  notification_channel: 'email' | 'sms' | 'push' | 'none'
  notification_target: string
  high_usage_threshold: number;
  retain_days: number;
}

export type Page = 'currentData' | 'voltage' | 'settings' | 'reports';