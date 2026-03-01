import { type ScenarioOutput } from './scenarios.js';

/**
 * Converts a ScenarioOutput into the full P1 gateway JSON response format.
 *
 * This mirrors the exact shape returned by the real SmartGateway REST API
 * at /smartmeter/api/read - all fields are strings, matching the actual device.
 */
export function toP1Response(output: ScenarioOutput): Record<string, string> {
  const { l1, l2, l3, frequency } = output;

  const totalPowerDelivered = l1.powerDelivered + l2.powerDelivered + l3.powerDelivered;
  const totalPowerReturned = l1.powerReturned + l2.powerReturned + l3.powerReturned;

  return {
    // Gateway metadata (static mock values)
    mac_address: '78_42_1C_6D_1D_DC',
    gateway_model: 'smartgateways_smartmeter_gateway_sweden_version-b',
    startup_time: '2026-02-23T09:37:54Z',
    firmware_running: '2024053001',
    firmware_available: '2026022501',
    firmware_update_available: 'true',
    wifi_rssi: '-33',
    mqtt_configured: 'false',

    // Meter IDs
    Equipment_Id: 'MOCK-P1-METER-001',
    GasEquipment_Id: '',

    // Energy totals (cumulative, slowly incrementing)
    EnergyDelivered: '0.000',
    EnergyReturned: '0.000',
    ReactiveEnergyDelivered: '0.000',
    ReactiveEnergyReturned: '0.000',

    // Tariff energy
    EnergyDeliveredTariff1: '0.000',
    EnergyDeliveredTariff2: '0.000',
    EnergyDeliveredTariff3: '0.000',
    EnergyDeliveredTariff4: '0.000',
    EnergyReturnedTariff1: '0.000',
    EnergyReturnedTariff2: '0.000',
    EnergyReturnedTariff3: '0.000',
    EnergyReturnedTariff4: '0.000',
    ReactiveEnergyDeliveredTariff1: '0.000',
    ReactiveEnergyDeliveredTariff2: '0.000',
    ReactiveEnergyDeliveredTariff3: '0.000',
    ReactiveEnergyDeliveredTariff4: '0.000',
    ReactiveEnergyReturnedTariff1: '0.000',
    ReactiveEnergyReturnedTariff2: '0.000',
    ReactiveEnergyReturnedTariff3: '0.000',
    ReactiveEnergyReturnedTariff4: '0.000',

    // Instantaneous voltage per phase (the key fields for voltage analysis)
    InstantaneousVoltageL1: l1.voltage.toFixed(3),
    Voltage_l1: l1.voltage.toFixed(3),
    InstantaneousVoltageL2: l2.voltage.toFixed(3),
    Voltage_l2: l2.voltage.toFixed(3),
    InstantaneousVoltageL3: l3.voltage.toFixed(3),
    Voltage_l3: l3.voltage.toFixed(3),

    // Instantaneous current per phase
    InstantaneousCurrentL1: l1.current.toFixed(3),
    Current_l1: l1.current.toFixed(3),
    InstantaneousCurrentL2: l2.current.toFixed(3),
    Current_l2: l2.current.toFixed(3),
    InstantaneousCurrentL3: l3.current.toFixed(3),
    Current_l3: l3.current.toFixed(3),

    // Aggregate instantaneous values
    InstantaneousVoltage: l1.voltage.toFixed(3),
    InstantaneousCurrent: (l1.current + l2.current + l3.current).toFixed(3),
    InstantaneousCurrentNeutral: '0.000',
    CurrentNeutral: '0.000',

    // Frequency
    Frequency: frequency.toFixed(3),

    // Active power per phase
    ActiveInstantaneousPowerDelivered: totalPowerDelivered.toFixed(3),
    ActiveInstantaneousPowerDeliveredL1: l1.powerDelivered.toFixed(3),
    ActiveInstantaneousPowerDeliveredL2: l2.powerDelivered.toFixed(3),
    ActiveInstantaneousPowerDeliveredL3: l3.powerDelivered.toFixed(3),
    ActiveInstantaneousPowerReturnedL1: l1.powerReturned.toFixed(3),
    ActiveInstantaneousPowerReturnedL2: l2.powerReturned.toFixed(3),
    ActiveInstantaneousPowerReturnedL3: l3.powerReturned.toFixed(3),

    // Reactive power (zeroed for simplicity)
    ReactiveInstantaneousPowerDeliveredL1: '0.000',
    ReactiveInstantaneousPowerDeliveredL2: '0.000',
    ReactiveInstantaneousPowerDeliveredL3: '0.000',
    ReactiveInstantaneousPowerReturnedL1: '0.000',
    ReactiveInstantaneousPowerReturnedL2: '0.000',
    ReactiveInstantaneousPowerReturnedL3: '0.000',

    // Apparent power
    ApparentInstantaneousPower: totalPowerDelivered.toFixed(3),
    ApparentInstantaneousPowerL1: l1.powerDelivered.toFixed(3),
    ApparentInstantaneousPowerL2: l2.powerDelivered.toFixed(3),
    ApparentInstantaneousPowerL3: l3.powerDelivered.toFixed(3),

    // Totals
    PowerDelivered_total: totalPowerDelivered.toFixed(3),
    PowerReturned_total: totalPowerReturned.toFixed(3),
    ReactiveEnergyDeliveredCurrentPeriod: '0.000',
    ReactiveEnergyReturnedCurrentPeriod: '0.000',
    PowerDeliveredNetto: (totalPowerDelivered - totalPowerReturned).toFixed(3),
  };
}
