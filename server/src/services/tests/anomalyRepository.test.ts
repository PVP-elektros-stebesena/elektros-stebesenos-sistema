import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import prisma from '../../lib/prisma.js';
import { AnomalyRepository } from '../anomalyRepository.js';
import type { DetectedPowerAnomaly } from '../powerTracker.js';
import type { DetectedAnomaly } from '../voltageAnalysis.js';

let deviceId: number;

beforeEach(async () => {
  const device = await prisma.device.create({
    data: {
      name: 'Anomaly repository test device',
      isActive: true,
    },
  });
  deviceId = device.id;
});

afterEach(async () => {
  await prisma.anomaly.deleteMany({ where: { deviceId } });
  await prisma.device.deleteMany({ where: { id: deviceId } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

function voltageDeviation(overrides: Partial<DetectedAnomaly> = {}): DetectedAnomaly {
  return {
    startedAt: new Date('2026-05-21T10:00:00.000Z'),
    endedAt: null,
    phase: 'L1',
    type: 'VOLTAGE_DEVIATION',
    severity: 'WARNING',
    voltageMin: 256,
    voltageMax: 256,
    durationSeconds: null,
    ...overrides,
  };
}

function phaseImbalance(overrides: Partial<DetectedPowerAnomaly> = {}): DetectedPowerAnomaly {
  return {
    startedAt: new Date('2026-05-21T10:00:00.000Z'),
    endedAt: null,
    phase: 'ALL',
    type: 'PHASE_IMBALANCE',
    severity: 'WARNING',
    metricName: 'PHASE_IMBALANCE',
    thresholdValue: 30,
    observedMin: 33,
    observedMax: 33,
    observedAvg: 33,
    unit: '%',
    description: 'PHASE_IMBALANCE started',
    ...overrides,
  };
}

describe('AnomalyRepository voltage persistence', () => {
  it('updates the active voltage anomaly when the deviation resolves', async () => {
    const repository = new AnomalyRepository();
    const startedAt = new Date('2026-05-21T10:00:00.000Z');
    const endedAt = new Date('2026-05-21T10:02:00.000Z');

    await repository.persistVoltageAnomalies(deviceId, [
      voltageDeviation({ startedAt, voltageMin: 256, voltageMax: 256 }),
    ]);
    await repository.persistVoltageAnomalies(deviceId, [
      voltageDeviation({
        startedAt,
        endedAt,
        voltageMin: 256,
        voltageMax: 258,
        durationSeconds: 120,
      }),
    ]);

    const rows = await prisma.anomaly.findMany({ where: { deviceId } });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.startsAt).toEqual(startedAt);
    expect(rows[0]?.endsAt).toEqual(endedAt);
    expect(rows[0]?.duration).toBe(120);
    expect(rows[0]?.maxVoltage).toBe(258);
  });
});

describe('AnomalyRepository power persistence', () => {
  it('updates the active power anomaly when it resolves', async () => {
    const repository = new AnomalyRepository();
    const startedAt = new Date('2026-05-21T10:00:00.000Z');
    const endedAt = new Date('2026-05-21T10:05:00.000Z');

    await repository.persistPowerAnomalies(deviceId, [
      phaseImbalance({ startedAt, observedMin: 33, observedMax: 35, observedAvg: 34 }),
    ]);
    await repository.persistPowerAnomalies(deviceId, [
      phaseImbalance({
        startedAt,
        endedAt,
        observedMin: 33,
        observedMax: 38,
        observedAvg: 35,
        description: 'PHASE_IMBALANCE resolved',
      }),
    ]);

    const rows = await prisma.anomaly.findMany({ where: { deviceId } });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.startsAt).toEqual(startedAt);
    expect(rows[0]?.endsAt).toEqual(endedAt);
    expect(rows[0]?.duration).toBe(300);
    expect(rows[0]?.observedMax).toBe(38);
  });
});