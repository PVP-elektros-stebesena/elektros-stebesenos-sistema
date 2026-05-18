import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import prisma from '../../lib/prisma.js';
import { clearPowerPolicyCache } from '../powerPolicy.js';
import { reactivePenaltyEstimatorService } from '../reactivePenaltyEstimator.js';

let testDeviceId: number;

beforeEach(async () => {
  const device = await prisma.device.create({
    data: {
      name: 'ReactivePenaltyTestDevice',
      pollInterval: 10,
      isActive: true,
      maxGridCapacityKw: 50,
    },
  });
  testDeviceId = device.id;
});

afterEach(async () => {
  clearPowerPolicyCache(testDeviceId);
  await prisma.report.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.anomaly.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.aggregatedData.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.reading.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.powerPolicyOverride.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.device.deleteMany({ where: { id: testDeviceId } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createBoundaryReadings(input: {
  startActive: number;
  endActive: number;
  startReactiveConsumed: number;
  endReactiveConsumed: number;
  startReactiveReturned: number;
  endReactiveReturned: number;
}) {
  await prisma.reading.createMany({
    data: [
      {
        deviceId: testDeviceId,
        timestamp: new Date('2026-04-01T00:00:00.000Z'),
        energyDelivered: input.startActive,
        reactiveEnergyDelivered: input.startReactiveConsumed,
        reactiveEnergyReturned: input.startReactiveReturned,
      },
      {
        deviceId: testDeviceId,
        timestamp: new Date('2026-04-02T00:00:00.000Z'),
        energyDelivered: input.endActive,
        reactiveEnergyDelivered: input.endReactiveConsumed,
        reactiveEnergyReturned: input.endReactiveReturned,
      },
    ],
  });
}

describe('ReactivePenaltyEstimatorService', () => {
  it('marks estimate complete when boundary gaps are within tolerance', async () => {
    await prisma.reading.createMany({
      data: [
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-01T00:01:00.000Z'),
          energyDelivered: 100,
          reactiveEnergyDelivered: 20,
          reactiveEnergyReturned: 5,
        },
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-01T00:11:00.000Z'),
          energyDelivered: 112,
          reactiveEnergyDelivered: 28,
          reactiveEnergyReturned: 6,
        },
      ],
    });

    const result = await reactivePenaltyEstimatorService.estimateForDevice(
      testDeviceId,
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-04-01T00:12:00.000Z'),
    );

    expect(result.status).toBe('complete');
  });

  it('marks estimate partial when there are unexpected large gaps between readings', async () => {
    await prisma.reading.createMany({
      data: [
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-01T00:00:00.000Z'),
          energyDelivered: 100,
          reactiveEnergyDelivered: 20,
          reactiveEnergyReturned: 5,
        },
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-01T00:10:00.000Z'),
          energyDelivered: 110,
          reactiveEnergyDelivered: 25,
          reactiveEnergyReturned: 6,
        },
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-01T02:00:00.000Z'),
          energyDelivered: 130,
          reactiveEnergyDelivered: 35,
          reactiveEnergyReturned: 8,
        },
      ],
    });

    const result = await reactivePenaltyEstimatorService.estimateForDevice(
      testDeviceId,
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-04-01T02:00:00.000Z'),
    );

    expect(result.status).toBe('partial');
    expect(result.activeImportedKwh).toBe(30);
  });

  it('marks estimate partial when aggregated 10-minute windows have coverage gaps', async () => {
    await prisma.reading.createMany({
      data: [
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-01T00:00:00.000Z'),
          energyDelivered: 100,
          reactiveEnergyDelivered: 20,
          reactiveEnergyReturned: 5,
        },
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-01T00:10:00.000Z'),
          energyDelivered: 110,
          reactiveEnergyDelivered: 25,
          reactiveEnergyReturned: 6,
        },
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-01T00:30:00.000Z'),
          energyDelivered: 130,
          reactiveEnergyDelivered: 35,
          reactiveEnergyReturned: 8,
        },
      ],
    });

    await prisma.aggregatedData.createMany({
      data: [
        {
          deviceId: testDeviceId,
          startsAt: new Date('2026-04-01T00:00:00.000Z'),
          endsAt: new Date('2026-04-01T00:10:00.000Z'),
          sampleCount: 60,
          reactivePowerAvgTotal: 1.1,
          powerFactorAvg: 0.97,
        },
        {
          deviceId: testDeviceId,
          startsAt: new Date('2026-04-01T00:20:00.000Z'),
          endsAt: new Date('2026-04-01T00:30:00.000Z'),
          sampleCount: 60,
          reactivePowerAvgTotal: 1.2,
          powerFactorAvg: 0.96,
        },
      ],
    });

    const result = await reactivePenaltyEstimatorService.estimateForDevice(
      testDeviceId,
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-04-01T00:30:00.000Z'),
    );

    expect(result.status).toBe('partial');
  });

  it('returns no penalty when consumed reactive energy is within tan phi allowance', async () => {
    await createBoundaryReadings({
      startActive: 100,
      endActive: 200,
      startReactiveConsumed: 20,
      endReactiveConsumed: 55,
      startReactiveReturned: 5,
      endReactiveReturned: 5,
    });

    const result = await reactivePenaltyEstimatorService.estimateForDevice(
      testDeviceId,
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-04-02T00:00:00.000Z'),
    );

    expect(result.status).toBe('complete');
    expect(result.allowedReactiveConsumedKvarh).toBe(40);
    expect(result.chargeableReactiveConsumedKvarh).toBe(0);
    expect(result.totalEur).toBe(0);
  });

  it('calculates consumed reactive excess penalty', async () => {
    await createBoundaryReadings({
      startActive: 100,
      endActive: 200,
      startReactiveConsumed: 20,
      endReactiveConsumed: 90,
      startReactiveReturned: 5,
      endReactiveReturned: 5,
    });

    const result = await reactivePenaltyEstimatorService.estimateForDevice(
      testDeviceId,
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-04-02T00:00:00.000Z'),
    );

    expect(result.chargeableReactiveConsumedKvarh).toBe(30);
    expect(result.totalEur).toBeCloseTo(0.6, 6);
  });

  it('calculates returned reactive energy penalty', async () => {
    await createBoundaryReadings({
      startActive: 100,
      endActive: 200,
      startReactiveConsumed: 20,
      endReactiveConsumed: 45,
      startReactiveReturned: 5,
      endReactiveReturned: 15,
    });

    const result = await reactivePenaltyEstimatorService.estimateForDevice(
      testDeviceId,
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-04-02T00:00:00.000Z'),
    );

    expect(result.chargeableReactiveReturnedKvarh).toBe(10);
    expect(result.totalEur).toBeCloseTo(0.4, 6);
  });

  it('combines consumed and returned reactive penalties', async () => {
    await createBoundaryReadings({
      startActive: 100,
      endActive: 200,
      startReactiveConsumed: 20,
      endReactiveConsumed: 90,
      startReactiveReturned: 5,
      endReactiveReturned: 15,
    });

    const result = await reactivePenaltyEstimatorService.estimateForDevice(
      testDeviceId,
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-04-02T00:00:00.000Z'),
    );

    expect(result.chargeableReactiveConsumedKvarh).toBe(30);
    expect(result.chargeableReactiveReturnedKvarh).toBe(10);
    expect(result.totalEur).toBeCloseTo(1, 6);
  });

  it('ignores negative deltas from meter resets and marks the estimate partial', async () => {
    await prisma.reading.createMany({
      data: [
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-01T00:00:00.000Z'),
          energyDelivered: 100,
          reactiveEnergyDelivered: 20,
          reactiveEnergyReturned: 5,
        },
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-01T12:00:00.000Z'),
          energyDelivered: 120,
          reactiveEnergyDelivered: 50,
          reactiveEnergyReturned: 9,
        },
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-02T00:00:00.000Z'),
          energyDelivered: 110,
          reactiveEnergyDelivered: 10,
          reactiveEnergyReturned: 1,
        },
      ],
    });

    const result = await reactivePenaltyEstimatorService.estimateForDevice(
      testDeviceId,
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-04-02T00:00:00.000Z'),
    );

    expect(result.status).toBe('partial');
    expect(result.activeImportedKwh).toBe(20);
    expect(result.reactiveConsumedKvarh).toBe(30);
  });

  it('returns unavailable when there is insufficient data', async () => {
    await prisma.reading.create({
      data: {
        deviceId: testDeviceId,
        timestamp: new Date('2026-04-01T00:00:00.000Z'),
        energyDelivered: 100,
        reactiveEnergyDelivered: 20,
        reactiveEnergyReturned: 5,
      },
    });

    const result = await reactivePenaltyEstimatorService.estimateForDevice(
      testDeviceId,
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-04-02T00:00:00.000Z'),
    );

    expect(result.status).toBe('unavailable');
    expect(result.totalEur).toBeNull();
  });

  it('returns not applicable below the commercial capacity threshold', async () => {
    await prisma.device.update({
      where: { id: testDeviceId },
      data: { maxGridCapacityKw: 11 },
    });
    clearPowerPolicyCache(testDeviceId);

    const result = await reactivePenaltyEstimatorService.estimateForDevice(
      testDeviceId,
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-04-02T00:00:00.000Z'),
    );

    expect(result.status).toBe('not_applicable');
    expect(result.message).toContain('30 kW');
  });
});
