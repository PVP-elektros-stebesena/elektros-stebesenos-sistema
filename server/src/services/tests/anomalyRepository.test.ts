import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import prisma from '../../lib/prisma.js';
import { AnomalyRepository } from '../anomalyRepository.js';
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