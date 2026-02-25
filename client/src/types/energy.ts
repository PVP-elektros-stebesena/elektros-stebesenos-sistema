export interface LiveData {
  timestamp: Date;
  power_delivered: number;
  power_returned: number;
  gas_flow: number;
  voltage_l1: number;
  voltage_l2: number;
  voltage_l3: number;
  current_l1: number;
  current_l2: number;
  current_l3: number;
  power_l1: number;
  power_l2: number;
  power_l3: number;
  tariff: 1 | 2;
  total_t1_import: number;
  total_t2_import: number;
  total_t1_export: number;
  total_t2_export: number;
  total_gas: number;
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
  high_usage_threshold: number;
  retain_days: number;
}

export type Page = 'dashboard' | 'history' | 'settings';