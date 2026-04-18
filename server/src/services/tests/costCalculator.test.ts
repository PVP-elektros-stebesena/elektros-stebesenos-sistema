import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import prisma from '../../lib/prisma.js';
import { costCalculatorService } from '../costCalculator.js';

let testDeviceId: number;

beforeEach(async () => {
  const device = await prisma.device.create({
    data: { name: 'CostCalculatorTestDevice', pollInterval: 10, isActive: true },
  });
  testDeviceId = device.id;
});

afterEach(async () => {
  await prisma.report.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.anomaly.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.aggregatedData.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.reading.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.billingPlan.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.spotPrice.deleteMany();
  await prisma.device.deleteMany({ where: { id: testDeviceId } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('CostCalculatorService', () => {
  it('calculates fixed-plan costs from tariff counters', async () => {
    await prisma.billingPlan.create({
      data: {
        deviceId: testDeviceId,
        pricingMode: 'FIXED',
        effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
        rateT1: 0.2,
        rateT2: 0.1,
        rateT3: null,
        rateT4: null,
        monthlyFixedFeeEur: null,
      },
    });

    await prisma.reading.createMany({
      data: [
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-01T00:00:00.000Z'),
          energyDelivered: 100,
          energyDeliveredTariff1: 50,
          energyDeliveredTariff2: 25,
          energyDeliveredTariff3: 0,
          energyDeliveredTariff4: 0,
        },
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-02T00:00:00.000Z'),
          energyDelivered: 103.5,
          energyDeliveredTariff1: 51,
          energyDeliveredTariff2: 27.5,
          energyDeliveredTariff3: 0,
          energyDeliveredTariff4: 0,
        },
      ],
    });

    const result = await costCalculatorService.calculateEstimatedCost(
      testDeviceId,
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-04-02T00:00:00.000Z'),
    );

    expect(result.status).toBe('complete');
    expect(result.energyChargeEur).toBeCloseTo(0.45, 6);
    expect(result.fixedFeesEur).toBe(0);
    expect(result.totalEur).toBeCloseTo(0.45, 6);
    expect(result.breakdown[0]?.pricingMode).toBe('FIXED');
  });

  it('interpolates fixed-plan tariff counters across sparse boundaries without leaking outside the range', async () => {
    await prisma.billingPlan.create({
      data: {
        deviceId: testDeviceId,
        pricingMode: 'FIXED',
        effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
        rateT1: 0.2,
        rateT2: null,
        rateT3: null,
        rateT4: null,
        monthlyFixedFeeEur: null,
      },
    });

    await prisma.reading.createMany({
      data: [
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-01T00:00:00.000Z'),
          energyDelivered: 100,
          energyDeliveredTariff1: 50,
        },
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-01T01:00:00.000Z'),
          energyDelivered: 104,
          energyDeliveredTariff1: 54,
        },
      ],
    });

    const result = await costCalculatorService.calculateEstimatedCost(
      testDeviceId,
      new Date('2026-04-01T00:15:00.000Z'),
      new Date('2026-04-01T00:45:00.000Z'),
    );

    expect(result.status).toBe('complete');
    expect(result.energyChargeEur).toBeCloseTo(0.4, 6);
    expect(result.totalEur).toBeCloseTo(0.4, 6);
    expect(result.missingCoveragePct).toBe(0);
    expect(result.breakdown[0]?.details).toMatchObject({
      tariffsKwh: { t1: 2, t2: 0, t3: 0, t4: 0 },
    });
  });

  it('marks fixed-plan estimates partial when segment boundaries are not fully covered by readings', async () => {
    await prisma.billingPlan.create({
      data: {
        deviceId: testDeviceId,
        pricingMode: 'FIXED',
        effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
        rateT1: 0.2,
        rateT2: null,
        rateT3: null,
        rateT4: null,
        monthlyFixedFeeEur: null,
      },
    });

    await prisma.reading.createMany({
      data: [
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-01T00:30:00.000Z'),
          energyDelivered: 100,
          energyDeliveredTariff1: 50,
        },
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-01T01:00:00.000Z'),
          energyDelivered: 102,
          energyDeliveredTariff1: 52,
        },
      ],
    });

    const result = await costCalculatorService.calculateEstimatedCost(
      testDeviceId,
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-04-01T01:00:00.000Z'),
    );

    expect(result.status).toBe('partial');
    expect(result.energyChargeEur).toBeCloseTo(0.4, 6);
    expect(result.missingCoveragePct).toBeCloseTo(50, 6);
    expect(result.breakdown[0]?.details).toMatchObject({
      tariffsKwh: { t1: 2, t2: 0, t3: 0, t4: 0 },
      coveredDurationPct: 50,
    });
  });

  it('still prorates fixed monthly fees when fixed-plan readings are unavailable', async () => {
    await prisma.billingPlan.create({
      data: {
        deviceId: testDeviceId,
        pricingMode: 'FIXED',
        effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
        rateT1: 0.2,
        rateT2: null,
        rateT3: null,
        rateT4: null,
        monthlyFixedFeeEur: 30,
      },
    });

    const result = await costCalculatorService.calculateEstimatedCost(
      testDeviceId,
      new Date('2026-04-10T00:00:00.000Z'),
      new Date('2026-04-20T00:00:00.000Z'),
    );

    expect(result.status).toBe('partial');
    expect(result.energyChargeEur).toBe(0);
    expect(result.fixedFeesEur).toBeCloseTo(10, 6);
    expect(result.totalEur).toBeCloseTo(10, 6);
  });

  it('treats zero-usage dynamic intervals as complete when coverage exists', async () => {
    await prisma.billingPlan.create({
      data: {
        deviceId: testDeviceId,
        pricingMode: 'DYNAMIC',
        effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
        monthlyFixedFeeEur: null,
        spotProvider: 'ELERING',
        spotZone: 'LT',
        spotAdderEurPerKwh: 0,
      },
    });

    await prisma.reading.createMany({
      data: [
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-01T00:00:00.000Z'),
          energyDelivered: 100,
        },
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-01T00:30:00.000Z'),
          energyDelivered: 100,
        },
      ],
    });

    await prisma.spotPrice.createMany({
      data: [
        {
          provider: 'ELERING',
          zone: 'LT',
          startsAt: new Date('2026-04-01T00:00:00.000Z'),
          endsAt: new Date('2026-04-01T00:15:00.000Z'),
          resolutionMinutes: 15,
          priceEurPerMwh: 100,
        },
        {
          provider: 'ELERING',
          zone: 'LT',
          startsAt: new Date('2026-04-01T00:15:00.000Z'),
          endsAt: new Date('2026-04-01T00:30:00.000Z'),
          resolutionMinutes: 15,
          priceEurPerMwh: 200,
        },
      ],
    });

    const result = await costCalculatorService.calculateEstimatedCost(
      testDeviceId,
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-04-01T00:30:00.000Z'),
    );

    expect(result.status).toBe('complete');
    expect(result.energyChargeEur).toBe(0);
    expect(result.totalEur).toBe(0);
    expect(result.missingCoveragePct).toBe(0);
  });

  it('still prorates fixed monthly fees when dynamic-plan readings are unavailable', async () => {
    await prisma.billingPlan.create({
      data: {
        deviceId: testDeviceId,
        pricingMode: 'DYNAMIC',
        effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
        monthlyFixedFeeEur: 31,
        spotProvider: 'ELERING',
        spotZone: 'LT',
        spotAdderEurPerKwh: 0,
      },
    });

    const result = await costCalculatorService.calculateEstimatedCost(
      testDeviceId,
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-04-16T00:00:00.000Z'),
    );

    expect(result.status).toBe('partial');
    expect(result.energyChargeEur).toBe(0);
    expect(result.fixedFeesEur).toBeCloseTo(15.5, 6);
    expect(result.totalEur).toBeCloseTo(15.5, 6);
  });

  it('calculates dynamic-plan costs from stored spot prices', async () => {
    await prisma.billingPlan.create({
      data: {
        deviceId: testDeviceId,
        pricingMode: 'DYNAMIC',
        effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
        monthlyFixedFeeEur: null,
        spotProvider: 'ELERING',
        spotZone: 'LT',
        spotAdderEurPerKwh: 0.05,
      },
    });

    await prisma.reading.createMany({
      data: [
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-01T00:00:00.000Z'),
          energyDelivered: 100,
        },
        {
          deviceId: testDeviceId,
          timestamp: new Date('2026-04-01T00:30:00.000Z'),
          energyDelivered: 102,
        },
      ],
    });

    await prisma.spotPrice.createMany({
      data: [
        {
          provider: 'ELERING',
          zone: 'LT',
          startsAt: new Date('2026-04-01T00:00:00.000Z'),
          endsAt: new Date('2026-04-01T00:15:00.000Z'),
          resolutionMinutes: 15,
          priceEurPerMwh: 100,
        },
        {
          provider: 'ELERING',
          zone: 'LT',
          startsAt: new Date('2026-04-01T00:15:00.000Z'),
          endsAt: new Date('2026-04-01T00:30:00.000Z'),
          resolutionMinutes: 15,
          priceEurPerMwh: 200,
        },
        {
          provider: 'OTHER_PROVIDER',
          zone: 'LT',
          startsAt: new Date('2026-04-01T00:00:00.000Z'),
          endsAt: new Date('2026-04-01T00:15:00.000Z'),
          resolutionMinutes: 15,
          priceEurPerMwh: 999,
        },
        {
          provider: 'ELERING',
          zone: 'EE',
          startsAt: new Date('2026-04-01T00:15:00.000Z'),
          endsAt: new Date('2026-04-01T00:30:00.000Z'),
          resolutionMinutes: 15,
          priceEurPerMwh: 999,
        },
      ],
    });

    const result = await costCalculatorService.calculateEstimatedCost(
      testDeviceId,
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-04-01T00:30:00.000Z'),
    );

    expect(result.status).toBe('complete');
    expect(result.energyChargeEur).toBeCloseTo(0.4, 6);
    expect(result.totalEur).toBeCloseTo(0.4, 6);
    expect(result.breakdown[0]?.pricingMode).toBe('DYNAMIC');
    expect(result.missingCoveragePct).toBe(0);
  });
});
