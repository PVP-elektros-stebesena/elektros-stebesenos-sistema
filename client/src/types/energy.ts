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

export type PowerProfilePreset =
  | 'APARTMENT_1P_5KW'
  | 'APARTMENT_1P_7KW'
  | 'HOUSE_3P_11KW'
  | 'HOUSE_3P_18KW'
  | 'SOLAR_PROSUMER_3P_22KW';

export type PricingMode = 'FIXED' | 'DYNAMIC';
export type GhostLoadMessageCode =
  | 'NO_BASELINE'
  | 'NO_ACTIVE_BILLING_PLAN'
  | 'FIXED_TARIFF_UNAVAILABLE'
  | 'DYNAMIC_CONFIG_INCOMPLETE'
  | 'SPOT_PRICE_UNAVAILABLE';

export interface BillingPlan {
  id?: number;
  pricingMode: PricingMode;
  effectiveFrom: string;
  effectiveTo: string | null;
  fixedRates: {
    t1: number | null;
    t2: number | null;
    t3: number | null;
    t4: number | null;
  } | null;
  dynamic: {
    provider: 'ELERING';
    zone: 'LT';
    spotAdderEurPerKwh: number;
  } | null;
  monthlyFixedFeeEur: number | null;
}

export interface EstimatedCostBreakdownItem {
  startsAt: string;
  endsAt: string;
  pricingMode: PricingMode | 'UNCONFIGURED';
  energyChargeEur: number;
  fixedFeesEur: number;
  totalEur: number;
  details: Record<string, unknown>;
}

export interface EstimatedCost {
  status: 'complete' | 'partial' | 'unavailable';
  currency: 'EUR';
  totalEur: number;
  energyChargeEur: number;
  fixedFeesEur: number;
  breakdown: EstimatedCostBreakdownItem[];
  missingCoveragePct: number;
}

export interface ReactivePenaltyEstimate {
  status: 'complete' | 'partial' | 'unavailable' | 'not_applicable';
  currency: 'EUR';
  totalEur: number | null;
  activeImportedKwh: number | null;
  reactiveConsumedKvarh: number | null;
  reactiveReturnedKvarh: number | null;
  allowedReactiveConsumedKvarh: number | null;
  chargeableReactiveConsumedKvarh: number | null;
  chargeableReactiveReturnedKvarh: number | null;
  rates: {
    allowedTanPhiRatio: number;
    targetPowerFactor: number;
    eligibleMinGridCapacityKw: number;
    consumedReactiveEurPerKvarh: number;
    returnedReactiveEurPerKvarh: number;
    effectiveFrom: string;
    sourceUrls: readonly string[];
  };
  formula: string;
  message: string;
}

export interface GhostLoadOverview {
  status: 'complete' | 'partial' | 'unavailable';
  currency: 'EUR';
  pricingMode: PricingMode | null;
  baselineDate: string | null;
  computedAt: string | null;
  sourceWindowStartsAt: string | null;
  sourceWindowEndsAt: string | null;
  baselinePowerKw: number | null;
  baselinePowerWatts: number | null;
  projectedDailyKwh: number | null;
  projectedMonthlyKwh: number | null;
  currentRateEurPerKwh: number | null;
  projectedMonthlyCostEur: number | null;
  messageCode: GhostLoadMessageCode | null;
  message: string | null;
}

export interface AppSettings {
  device_ip: string;
  mqtt_broker: string;
  mqtt_port: number;
  mqtt_topic: string;
  power_profile: PowerProfilePreset;
  max_grid_capacity_kw: number | null;
  poll_interval: number;
  timezone: string;
  dsmr_version: string;
  meter_serial: string;
  notifications_enabled: boolean;
  notification_channel: 'email' | 'sms' | 'push' | 'none'
  notification_target: string
  notify_solar_export_opportunity: boolean;
  pricing_mode: PricingMode;
  rate_t1: number | null;
  rate_t2: number | null;
  rate_t3: number | null;
  rate_t4: number | null;
  monthly_fixed_fee_eur: number | null;
  spot_adder_eur_per_kwh: number | null;
  high_usage_threshold: number;
  retain_days: number;
}

export type Page = 'currentData' | 'voltage' | 'power' | 'settings' | 'reports' | 'billing' | 'profile';
