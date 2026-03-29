import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DevicePoller } from '../devicePoller.js';

// ── Mock Prisma ─────────────────────────────────────────────────────

vi.mock('../../lib/prisma.js', () => {
  return {
    default: {
      device: {
        findMany: vi.fn(),
      },
      powerPolicyOverride: {
        findFirst: vi.fn(),
      },
      reading: {
        create: vi.fn(),
      },
      anomaly: {
        create: vi.fn(),
      },
      aggregatedData: {
        upsert: vi.fn(),
      },
    },
  };
});

// Import the mocked module after vi.mock
import prisma from '../../lib/prisma.js';

const mockPrisma = prisma as unknown as {
  device: { findMany: ReturnType<typeof vi.fn> };
  powerPolicyOverride: { findFirst: ReturnType<typeof vi.fn> };
  reading: { create: ReturnType<typeof vi.fn> };
  anomaly: { create: ReturnType<typeof vi.fn> };
  aggregatedData: { upsert: ReturnType<typeof vi.fn> };
};

// ── Helpers ─────────────────────────────────────────────────────────

function makeP1Json(
  voltageL1 = 230,
  voltageL2 = 230,
  voltageL3 = 230,
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    mac_address: '78_42_1C_6D_1D_DC',
    gateway_model: 'test',
    EnergyDelivered: '100.000',
    EnergyReturned: '0.000',
    ReactiveEnergyDelivered: '0.000',
    ReactiveEnergyReturned: '0.000',
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
    InstantaneousVoltageL1: voltageL1.toFixed(3),
    Voltage_l1: voltageL1.toFixed(3),
    InstantaneousCurrentL1: '1.000',
    Current_l1: '1.000',
    InstantaneousVoltageL2: voltageL2.toFixed(3),
    Voltage_l2: voltageL2.toFixed(3),
    InstantaneousCurrentL2: '1.000',
    Current_l2: '1.000',
    InstantaneousVoltageL3: voltageL3.toFixed(3),
    Voltage_l3: voltageL3.toFixed(3),
    InstantaneousCurrentL3: '1.000',
    Current_l3: '1.000',
    InstantaneousVoltage: voltageL1.toFixed(3),
    InstantaneousCurrent: '3.000',
    InstantaneousCurrentNeutral: '0.000',
    CurrentNeutral: '0.000',
    Frequency: '50.000',
    ActiveInstantaneousPowerDelivered: '0.690',
    ActiveInstantaneousPowerDeliveredL1: '0.230',
    ActiveInstantaneousPowerDeliveredL2: '0.230',
    ActiveInstantaneousPowerDeliveredL3: '0.230',
    ActiveInstantaneousPowerReturnedL1: '0.000',
    ActiveInstantaneousPowerReturnedL2: '0.000',
    ActiveInstantaneousPowerReturnedL3: '0.000',
    ReactiveInstantaneousPowerDeliveredL1: '0.000',
    ReactiveInstantaneousPowerDeliveredL2: '0.000',
    ReactiveInstantaneousPowerDeliveredL3: '0.000',
    ReactiveInstantaneousPowerReturnedL1: '0.000',
    ReactiveInstantaneousPowerReturnedL2: '0.000',
    ReactiveInstantaneousPowerReturnedL3: '0.000',
    ApparentInstantaneousPower: '0.690',
    ApparentInstantaneousPowerL1: '0.230',
    ApparentInstantaneousPowerL2: '0.230',
    ApparentInstantaneousPowerL3: '0.230',
    PowerDelivered_total: '0.690',
    PowerReturned_total: '0.000',
    ReactiveEnergyDeliveredCurrentPeriod: '0.000',
    ReactiveEnergyReturnedCurrentPeriod: '0.000',
    PowerDeliveredNetto: '0.690',
    ...overrides,
  };
}

function makeFetchFn(json: Record<string, string>): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(json),
  }) as unknown as typeof fetch;
}

function makeFetchFnFailing(status = 500): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({}),
  }) as unknown as typeof fetch;
}

// ── Tests ───────────────────────────────────────────────────────────

describe('DevicePoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockPrisma.powerPolicyOverride.findFirst.mockResolvedValue(null);
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  it('starts polling active devices and saves readings', async () => {
    const fetchFn = makeFetchFn(makeP1Json(231));

    mockPrisma.device.findMany.mockResolvedValue([
      { id: 1, name: 'Test', deviceIp: 'http://192.168.1.100/smartmeter/api/read', pollInterval: 10, isActive: true },
    ]);
    mockPrisma.reading.create.mockResolvedValue({});

    const poller = new DevicePoller({ syncIntervalMs: 3_600_000, fetchFn });
    await poller.start();

    // The initial poll happens immediately
    // Wait for the initial poll's promises to flush
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(mockPrisma.reading.create).toHaveBeenCalledTimes(1);

    const createCall = mockPrisma.reading.create.mock.calls[0][0];
    expect(createCall.data.deviceId).toBe(1);
    expect(createCall.data.instantaneousVoltageL1).toBe(231);

    await poller.stop();
  });

  it('handles HTTP errors gracefully without crashing', async () => {
    const fetchFn = makeFetchFnFailing(503);

    mockPrisma.device.findMany.mockResolvedValue([
      { id: 1, name: 'Test', deviceIp: 'http://192.168.1.100/smartmeter/api/read', pollInterval: 10, isActive: true },
    ]);

    const poller = new DevicePoller({ syncIntervalMs: 3_600_000, fetchFn });
    await poller.start();
    await vi.advanceTimersByTimeAsync(0);

    // Should not have saved anything
    expect(mockPrisma.reading.create).not.toHaveBeenCalled();

    await poller.stop();
  });

  it('detects anomalies and persists them', async () => {
    // First poll normal, then voltage drops to 0
    let callCount = 0;
    const fetchFn = vi.fn().mockImplementation(() => {
      callCount++;
      const voltage = callCount === 1 ? 0 : 230; // First call: interruption, second: recovery
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(makeP1Json(voltage)),
      });
    }) as unknown as typeof fetch;

    mockPrisma.device.findMany.mockResolvedValue([
      { id: 1, name: 'Test', deviceIp: 'http://192.168.1.100/smartmeter/api/read', pollInterval: 10, isActive: true },
    ]);
    mockPrisma.reading.create.mockResolvedValue({});
    mockPrisma.anomaly.create.mockResolvedValue({});

    const poller = new DevicePoller({ syncIntervalMs: 3_600_000, fetchFn });
    await poller.start();
    await vi.advanceTimersByTimeAsync(0);

    // Advance timer to trigger second poll
    await vi.advanceTimersByTimeAsync(10_000);

    // On recovery (2nd poll), AnomalyTracker should emit a SHORT_INTERRUPTION
    // for all three phases (all were 0 on first poll)
    expect(mockPrisma.anomaly.create).toHaveBeenCalled();

    await poller.stop();
  });

  it('persists power anomalies when policy thresholds are exceeded', async () => {
    vi.setSystemTime(new Date('2026-03-27T10:00:00Z'));

    const fetchFn = makeFetchFn(
      makeP1Json(230, 230, 230, {
        ActiveInstantaneousPowerDelivered: '15.000',
        PowerDelivered_total: '15.000',
        ApparentInstantaneousPower: '16.000',
        ActiveInstantaneousPowerDeliveredL1: '5.000',
        ActiveInstantaneousPowerDeliveredL2: '5.000',
        ActiveInstantaneousPowerDeliveredL3: '5.000',
        ApparentInstantaneousPowerL1: '5.333',
        ApparentInstantaneousPowerL2: '5.333',
        ApparentInstantaneousPowerL3: '5.334',
      }),
    );

    mockPrisma.device.findMany.mockResolvedValue([
      { id: 1, name: 'Test', deviceIp: 'http://192.168.1.100/smartmeter/api/read', pollInterval: 10, isActive: true },
    ]);
    mockPrisma.reading.create.mockResolvedValue({});
    mockPrisma.anomaly.create.mockResolvedValue({});

    const poller = new DevicePoller({ syncIntervalMs: 3_600_000, fetchFn });
    await poller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockPrisma.anomaly.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metricDomain: 'POWER',
          metricName: 'ACTIVE_POWER_TOTAL',
          type: 'POWER_SPIKE',
          thresholdValue: 12,
        }),
      }),
    );

    await poller.stop();
  });

  it('persists power aggregate fields when a power window closes', async () => {
    vi.setSystemTime(new Date('2026-03-27T10:39:50Z'));

    const fetchFn = makeFetchFn(makeP1Json(230, 230, 230, {
      ActiveInstantaneousPowerDelivered: '3.600',
      PowerDelivered_total: '3.600',
      ApparentInstantaneousPower: '4.000',
      ActiveInstantaneousPowerDeliveredL1: '1.200',
      ActiveInstantaneousPowerDeliveredL2: '1.200',
      ActiveInstantaneousPowerDeliveredL3: '1.200',
      ApparentInstantaneousPowerL1: '1.333',
      ApparentInstantaneousPowerL2: '1.333',
      ApparentInstantaneousPowerL3: '1.334',
    }));

    mockPrisma.device.findMany.mockResolvedValue([
      { id: 1, name: 'Test', deviceIp: 'http://192.168.1.100/smartmeter/api/read', pollInterval: 10, isActive: true },
    ]);
    mockPrisma.reading.create.mockResolvedValue({});
    mockPrisma.aggregatedData.upsert.mockResolvedValue({});

    const poller = new DevicePoller({ syncIntervalMs: 3_600_000, fetchFn });
    await poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(
      mockPrisma.aggregatedData.upsert.mock.calls.some(([call]) =>
        call.update?.activePowerAvgTotal === 3.6 &&
        call.update?.activePowerMaxTotal === 3.6 &&
        call.update?.powerFactorAvg === 0.9,
      ),
    ).toBe(true);

    await poller.stop();
  });

  it('stops polling removed devices on sync', async () => {
    const fetchFn = makeFetchFn(makeP1Json());

    // First sync: device present
    mockPrisma.device.findMany.mockResolvedValueOnce([
      { id: 1, name: 'Test', deviceIp: 'http://192.168.1.100/smartmeter/api/read', pollInterval: 10, isActive: true },
    ]);
    mockPrisma.reading.create.mockResolvedValue({});

    const poller = new DevicePoller({ syncIntervalMs: 60_000, fetchFn });
    await poller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(poller.getStatus()).toHaveLength(1);

    // Second sync: device removed
    mockPrisma.device.findMany.mockResolvedValueOnce([]);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(poller.getStatus()).toHaveLength(0);

    await poller.stop();
  });

  it('skips devices without deviceIp', async () => {
    const fetchFn = makeFetchFn(makeP1Json());

    mockPrisma.device.findMany.mockResolvedValue([
      { id: 1, name: 'MQTT-only', deviceIp: null, pollInterval: 10, isActive: true },
    ]);

    const poller = new DevicePoller({ syncIntervalMs: 3_600_000, fetchFn });
    await poller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchFn).not.toHaveBeenCalled();
    expect(poller.getStatus()).toHaveLength(0);

    await poller.stop();
  });

  it('reports status of polled devices', async () => {
    const fetchFn = makeFetchFn(makeP1Json());

    mockPrisma.device.findMany.mockResolvedValue([
      { id: 1, name: 'D1', deviceIp: 'http://10.0.0.1/smartmeter/api/read', pollInterval: 5, isActive: true },
      { id: 2, name: 'D2', deviceIp: 'http://10.0.0.2/smartmeter/api/read', pollInterval: 15, isActive: true },
    ]);
    mockPrisma.reading.create.mockResolvedValue({});

    const poller = new DevicePoller({ syncIntervalMs: 3_600_000, fetchFn });
    await poller.start();
    await vi.advanceTimersByTimeAsync(0);

    const status = poller.getStatus();
    expect(status).toHaveLength(2);
    expect(status[0]).toMatchObject({
      deviceId: 1,
      mode: 'http',
      deviceIp: 'http://10.0.0.1/smartmeter/api/read',
      pollInterval: 5,
    });
    expect(status[1]).toMatchObject({
      deviceId: 2,
      mode: 'http',
      deviceIp: 'http://10.0.0.2/smartmeter/api/read',
      pollInterval: 15,
    });

    await poller.stop();
  });
});
