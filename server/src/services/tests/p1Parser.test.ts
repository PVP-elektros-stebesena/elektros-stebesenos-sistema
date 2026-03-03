import { describe, it, expect } from 'vitest';
import { parseP1Response, toVoltageReading } from '../p1Parser.js';

/** Minimal P1 gateway response fixture */
function makeRawP1(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    mac_address: '78_42_1C_6D_1D_DC',
    gateway_model: 'smartgateways_smartmeter_gateway_sweden_version-b',
    startup_time: '2026-02-28T14:27:45Z',
    firmware_running: '2024053001',
    firmware_available: '2026022501',
    firmware_update_available: 'true',
    wifi_rssi: '-32',
    mqtt_configured: 'false',
    Equipment_Id: '',
    GasEquipment_Id: '',
    EnergyDelivered: '123.456',
    EnergyReturned: '78.901',
    ReactiveEnergyDelivered: '0.000',
    ReactiveEnergyReturned: '0.000',
    EnergyDeliveredTariff1: '50.000',
    EnergyDeliveredTariff2: '30.000',
    EnergyDeliveredTariff3: '20.000',
    EnergyDeliveredTariff4: '23.456',
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
    InstantaneousVoltageL1: '231.500',
    Voltage_l1: '231.500',
    InstantaneousCurrentL1: '2.100',
    Current_l1: '2.100',
    InstantaneousVoltageL2: '229.800',
    Voltage_l2: '229.800',
    InstantaneousCurrentL2: '1.900',
    Current_l2: '1.900',
    InstantaneousVoltageL3: '230.200',
    Voltage_l3: '230.200',
    InstantaneousCurrentL3: '0.500',
    Current_l3: '0.500',
    InstantaneousVoltage: '231.500',
    InstantaneousCurrent: '4.500',
    InstantaneousCurrentNeutral: '0.000',
    CurrentNeutral: '0.000',
    Frequency: '50.010',
    ActiveInstantaneousPowerDelivered: '1.035',
    ActiveInstantaneousPowerDeliveredL1: '0.486',
    ActiveInstantaneousPowerDeliveredL2: '0.437',
    ActiveInstantaneousPowerDeliveredL3: '0.115',
    ActiveInstantaneousPowerReturnedL1: '0.000',
    ActiveInstantaneousPowerReturnedL2: '0.000',
    ActiveInstantaneousPowerReturnedL3: '0.000',
    ReactiveInstantaneousPowerDeliveredL1: '0.000',
    ReactiveInstantaneousPowerDeliveredL2: '0.000',
    ReactiveInstantaneousPowerDeliveredL3: '0.000',
    ReactiveInstantaneousPowerReturnedL1: '0.000',
    ReactiveInstantaneousPowerReturnedL2: '0.000',
    ReactiveInstantaneousPowerReturnedL3: '0.000',
    ApparentInstantaneousPower: '1.035',
    ApparentInstantaneousPowerL1: '0.486',
    ApparentInstantaneousPowerL2: '0.437',
    ApparentInstantaneousPowerL3: '0.115',
    PowerDelivered_total: '1.035',
    PowerReturned_total: '0.000',
    ReactiveEnergyDeliveredCurrentPeriod: '0.000',
    ReactiveEnergyReturnedCurrentPeriod: '0.000',
    PowerDeliveredNetto: '1.035',
    ...overrides,
  };
}

describe('parseP1Response', () => {
  it('parses all numeric fields from the P1 JSON', () => {
    const raw = makeRawP1();
    const parsed = parseP1Response(raw);

    expect(parsed.energyDelivered).toBe(123.456);
    expect(parsed.energyReturned).toBe(78.901);
    expect(parsed.instantaneousVoltageL1).toBe(231.5);
    expect(parsed.voltageL2).toBe(229.8);
    expect(parsed.voltageL3).toBe(230.2);
    expect(parsed.frequency).toBe(50.01);
    expect(parsed.powerDeliveredTotal).toBe(1.035);
    expect(parsed.powerDeliveredNetto).toBe(1.035);
  });

  it('parses tariff fields correctly', () => {
    const raw = makeRawP1();
    const parsed = parseP1Response(raw);

    expect(parsed.energyDeliveredTariff1).toBe(50);
    expect(parsed.energyDeliveredTariff2).toBe(30);
    expect(parsed.energyDeliveredTariff3).toBe(20);
    expect(parsed.energyDeliveredTariff4).toBe(23.456);
  });

  it('returns null for missing keys', () => {
    const raw = makeRawP1();
    // Remove a key
    delete raw.Frequency;
    const parsed = parseP1Response(raw);
    expect(parsed.frequency).toBeNull();
  });

  it('returns null for empty string values', () => {
    const raw = makeRawP1({ Frequency: '' });
    const parsed = parseP1Response(raw);
    expect(parsed.frequency).toBeNull();
  });

  it('returns null for non-numeric values', () => {
    const raw = makeRawP1({ Frequency: 'not_a_number' });
    const parsed = parseP1Response(raw);
    expect(parsed.frequency).toBeNull();
  });

  it('ignores non-numeric gateway metadata keys', () => {
    const raw = makeRawP1();
    const parsed = parseP1Response(raw);
    // mac_address, gateway_model, etc. are not in the mapping
    expect(Object.keys(parsed)).not.toContain('mac_address');
    expect(Object.keys(parsed)).not.toContain('gateway_model');
  });
});

describe('toVoltageReading', () => {
  it('extracts voltage from InstantaneousVoltage fields', () => {
    const parsed = parseP1Response(makeRawP1());
    const ts = new Date('2026-03-03T10:00:00Z');
    const reading = toVoltageReading(parsed, ts);

    expect(reading.timestamp).toEqual(ts);
    expect(reading.voltage_l1).toBe(231.5);
    expect(reading.voltage_l2).toBe(229.8);
    expect(reading.voltage_l3).toBe(230.2);
  });

  it('falls back to Voltage_l* when InstantaneousVoltageL* is missing', () => {
    const raw = makeRawP1();
    delete raw.InstantaneousVoltageL1;
    delete raw.InstantaneousVoltageL2;
    delete raw.InstantaneousVoltageL3;

    const parsed = parseP1Response(raw);
    const reading = toVoltageReading(parsed, new Date());

    expect(reading.voltage_l1).toBe(231.5); // from Voltage_l1
    expect(reading.voltage_l2).toBe(229.8);
    expect(reading.voltage_l3).toBe(230.2);
  });

  it('defaults to 0 when no voltage fields are present', () => {
    const raw = makeRawP1();
    delete raw.InstantaneousVoltageL1;
    delete raw.Voltage_l1;

    const parsed = parseP1Response(raw);
    const reading = toVoltageReading(parsed, new Date());

    expect(reading.voltage_l1).toBe(0);
  });
});
