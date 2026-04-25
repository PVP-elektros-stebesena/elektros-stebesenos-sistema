import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import prisma from '../../lib/prisma.js';
import { standbyPowerService } from '../standbyPowerService.js';

let testDeviceId: number;

beforeEach(async () => {
  const device = await prisma.device.create({
    data: { name: 'StandbyServiceTestDevice', pollInterval: 10, isActive: true },
  });
  testDeviceId = device.id;
});

afterEach(async () => {
  await prisma.standbyBaseline.deleteMany({ where: { deviceId: testDeviceId } });
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

async function seedWindowReadings(
  deviceId: number,
  startsAt: Date,
  pollIntervalSeconds: number,
  sampleCount?: number,
): Promise<number> {
  const timestamps: Array<{ deviceId: number; timestamp: Date }> = [];
  const endsAt = new Date(startsAt.getTime() + (10 * 60_000));
  let cursor = startsAt.getTime();

  while (cursor < endsAt.getTime()) {
    timestamps.push({
      deviceId,
      timestamp: new Date(cursor),
    });

    if (sampleCount != null && timestamps.length >= sampleCount) {
      break;
    }

    cursor += pollIntervalSeconds * 1000;
  }

  if (timestamps.length > 0) {
    await prisma.reading.createMany({ data: timestamps });
  }

  return timestamps.length;
}

describe('StandbyPowerService', () => {
  it('derives completeness from the historical window cadence instead of the current device poll interval', async () => {
    const firstBillingDate = '2026-04-07';
    const firstRange = standbyPowerService.getStandbyNightRangeForDate(firstBillingDate);

    await seedWindowReadings(testDeviceId, firstRange.startsAt, 25, 23);
    await seedWindowReadings(testDeviceId, new Date(firstRange.startsAt.getTime() + (10 * 60_000)), 25);

    await prisma.device.update({
      where: { id: testDeviceId },
      data: { pollInterval: 5 },
    });

    await prisma.aggregatedData.createMany({
      data: [
        {
          deviceId: testDeviceId,
          startsAt: firstRange.startsAt,
          endsAt: new Date(firstRange.startsAt.getTime() + (10 * 60_000)),
          sampleCount: 23,
          activePowerAvgTotal: 0.09,
        },
        {
          deviceId: testDeviceId,
          startsAt: new Date(firstRange.startsAt.getTime() + (10 * 60_000)),
          endsAt: new Date(firstRange.startsAt.getTime() + (20 * 60_000)),
          sampleCount: 24,
          activePowerAvgTotal: 0.21,
        },
      ],
    });

    const firstBaseline = await standbyPowerService.analyzeAndSaveStandbyBaseline(testDeviceId, firstBillingDate);

    expect(firstBaseline).not.toBeNull();
    expect(firstBaseline?.baselinePowerKw).toBeCloseTo(0.21, 6);
    expect(firstBaseline?.sampleCount).toBe(24);

    const secondBillingDate = '2026-04-08';
    const secondRange = standbyPowerService.getStandbyNightRangeForDate(secondBillingDate);

    await seedWindowReadings(testDeviceId, secondRange.startsAt, 40, 14);
    await seedWindowReadings(testDeviceId, new Date(secondRange.startsAt.getTime() + (10 * 60_000)), 40);

    await prisma.device.update({
      where: { id: testDeviceId },
      data: { pollInterval: 60 },
    });

    await prisma.aggregatedData.createMany({
      data: [
        {
          deviceId: testDeviceId,
          startsAt: secondRange.startsAt,
          endsAt: new Date(secondRange.startsAt.getTime() + (10 * 60_000)),
          sampleCount: 14,
          activePowerAvgTotal: 0.07,
        },
        {
          deviceId: testDeviceId,
          startsAt: new Date(secondRange.startsAt.getTime() + (10 * 60_000)),
          endsAt: new Date(secondRange.startsAt.getTime() + (20 * 60_000)),
          sampleCount: 15,
          activePowerAvgTotal: 0.19,
        },
      ],
    });

    const secondBaseline = await standbyPowerService.analyzeAndSaveStandbyBaseline(testDeviceId, secondBillingDate);

    expect(secondBaseline).not.toBeNull();
    expect(secondBaseline?.baselinePowerKw).toBeCloseTo(0.19, 6);
    expect(secondBaseline?.sampleCount).toBe(15);
  });

  it('ignores incomplete 10-minute windows when selecting the nightly standby baseline', async () => {
    const billingDate = '2026-04-07';
    const range = standbyPowerService.getStandbyNightRangeForDate(billingDate);

    await seedWindowReadings(testDeviceId, range.startsAt, 10, 12);
    await seedWindowReadings(testDeviceId, new Date(range.startsAt.getTime() + (10 * 60_000)), 10);

    await prisma.aggregatedData.createMany({
      data: [
        {
          deviceId: testDeviceId,
          startsAt: range.startsAt,
          endsAt: new Date(range.startsAt.getTime() + (10 * 60_000)),
          sampleCount: 12,
          activePowerAvgTotal: 0.08,
        },
        {
          deviceId: testDeviceId,
          startsAt: new Date(range.startsAt.getTime() + (10 * 60_000)),
          endsAt: new Date(range.startsAt.getTime() + (20 * 60_000)),
          sampleCount: 60,
          activePowerAvgTotal: 0.22,
        },
      ],
    });

    const baseline = await standbyPowerService.analyzeAndSaveStandbyBaseline(testDeviceId, billingDate);

    expect(baseline).not.toBeNull();
    expect(baseline?.baselinePowerKw).toBeCloseTo(0.22, 6);
    expect(baseline?.sampleCount).toBe(60);
  });

  it('rejects a sparse quiet window when the rest of the night shows a denser historical cadence', async () => {
    const billingDate = '2026-04-07';
    const range = standbyPowerService.getStandbyNightRangeForDate(billingDate);

    await seedWindowReadings(testDeviceId, range.startsAt, 300);
    await seedWindowReadings(testDeviceId, new Date(range.startsAt.getTime() + (10 * 60_000)), 10);

    await prisma.aggregatedData.createMany({
      data: [
        {
          deviceId: testDeviceId,
          startsAt: range.startsAt,
          endsAt: new Date(range.startsAt.getTime() + (10 * 60_000)),
          sampleCount: 2,
          activePowerAvgTotal: 0.05,
        },
        {
          deviceId: testDeviceId,
          startsAt: new Date(range.startsAt.getTime() + (10 * 60_000)),
          endsAt: new Date(range.startsAt.getTime() + (20 * 60_000)),
          sampleCount: 60,
          activePowerAvgTotal: 0.22,
        },
      ],
    });

    const baseline = await standbyPowerService.analyzeAndSaveStandbyBaseline(testDeviceId, billingDate);

    expect(baseline).not.toBeNull();
    expect(baseline?.baselinePowerKw).toBeCloseTo(0.22, 6);
    expect(baseline?.sampleCount).toBe(60);
  });

  it('picks the quietest 10-minute power window only inside the 02:00-05:00 standby range', async () => {
    const billingDate = '2026-04-07';
    const range = standbyPowerService.getStandbyNightRangeForDate(billingDate);

    await seedWindowReadings(testDeviceId, new Date(range.startsAt.getTime() - (10 * 60_000)), 10);
    await seedWindowReadings(testDeviceId, range.startsAt, 10);
    await seedWindowReadings(testDeviceId, new Date(range.startsAt.getTime() + (10 * 60_000)), 10);
    await seedWindowReadings(testDeviceId, range.endsAt, 10);

    await prisma.aggregatedData.createMany({
      data: [
        {
          deviceId: testDeviceId,
          startsAt: new Date(range.startsAt.getTime() - (10 * 60_000)),
          endsAt: range.startsAt,
          sampleCount: 60,
          activePowerAvgTotal: 0.12,
        },
        {
          deviceId: testDeviceId,
          startsAt: range.startsAt,
          endsAt: new Date(range.startsAt.getTime() + (10 * 60_000)),
          sampleCount: 60,
          activePowerAvgTotal: 0.31,
        },
        {
          deviceId: testDeviceId,
          startsAt: new Date(range.startsAt.getTime() + (10 * 60_000)),
          endsAt: new Date(range.startsAt.getTime() + (20 * 60_000)),
          sampleCount: 60,
          activePowerAvgTotal: 0.25,
        },
        {
          deviceId: testDeviceId,
          startsAt: range.endsAt,
          endsAt: new Date(range.endsAt.getTime() + (10 * 60_000)),
          sampleCount: 60,
          activePowerAvgTotal: 0.1,
        },
      ],
    });

    const baseline = await standbyPowerService.analyzeAndSaveStandbyBaseline(testDeviceId, billingDate);

    expect(baseline).not.toBeNull();
    expect(baseline?.baselineDate).toBe(billingDate);
    expect(baseline?.baselinePowerKw).toBeCloseTo(0.25, 6);
    expect(baseline?.windowStartsAt.toISOString()).toBe(new Date(range.startsAt.getTime() + (10 * 60_000)).toISOString());
  });

  it('respects Europe/Vilnius completion boundaries when resolving the latest completed night', () => {
    expect(
      standbyPowerService.getLatestCompletedBillingDate(new Date('2026-04-07T01:30:00.000Z')),
    ).toBe('2026-04-06');

    expect(
      standbyPowerService.getLatestCompletedBillingDate(new Date('2026-04-07T02:30:00.000Z')),
    ).toBe('2026-04-07');
  });

  it('backfills the latest completed night only once when the nightly row is missing', async () => {
    const reference = new Date('2026-04-07T03:00:00.000Z');
    const billingDate = standbyPowerService.getLatestCompletedBillingDate(reference);
    const range = standbyPowerService.getStandbyNightRangeForDate(billingDate);

    await seedWindowReadings(testDeviceId, range.startsAt, 10);

    await prisma.aggregatedData.create({
      data: {
        deviceId: testDeviceId,
        startsAt: range.startsAt,
        endsAt: new Date(range.startsAt.getTime() + (10 * 60_000)),
        sampleCount: 60,
        activePowerAvgTotal: 0.22,
      },
    });

    const first = await standbyPowerService.ensureLatestCompletedNightBaselines(reference);
    const second = await standbyPowerService.ensureLatestCompletedNightBaselines(reference);
    const rows = await prisma.standbyBaseline.findMany({
      where: { deviceId: testDeviceId, baselineDate: billingDate },
    });

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.baselinePowerKw).toBeCloseTo(0.22, 6);
    expect(rows[0]?.sampleCount).toBe(60);
  });

  it('preserves a previously stored nightly baseline when the latest completed night already exists', async () => {
    const reference = new Date('2026-04-07T03:00:00.000Z');
    const billingDate = standbyPowerService.getLatestCompletedBillingDate(reference);
    const range = standbyPowerService.getStandbyNightRangeForDate(billingDate);

    await seedWindowReadings(testDeviceId, range.startsAt, 10);

    await prisma.standbyBaseline.create({
      data: {
        deviceId: testDeviceId,
        baselineDate: billingDate,
        baselinePowerKw: 0.27,
        windowStartsAt: range.startsAt,
        windowEndsAt: new Date(range.startsAt.getTime() + (10 * 60_000)),
        sampleCount: 60,
      },
    });

    await prisma.aggregatedData.create({
      data: {
        deviceId: testDeviceId,
        startsAt: range.startsAt,
        endsAt: new Date(range.startsAt.getTime() + (10 * 60_000)),
        sampleCount: 60,
        activePowerAvgTotal: 0.06,
      },
    });

    const updated = await standbyPowerService.ensureLatestCompletedNightBaselines(reference);
    const rows = await prisma.standbyBaseline.findMany({
      where: { deviceId: testDeviceId, baselineDate: billingDate },
    });

    expect(updated).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.baselinePowerKw).toBeCloseTo(0.27, 6);
    expect(rows[0]?.sampleCount).toBe(60);
  });

  it('returns a complete ghost-load overview for a fixed plan using the current tariff', async () => {
    await prisma.standbyBaseline.create({
      data: {
        deviceId: testDeviceId,
        baselineDate: '2026-04-06',
        baselinePowerKw: 0.25,
        windowStartsAt: new Date('2026-04-06T23:00:00.000Z'),
        windowEndsAt: new Date('2026-04-06T23:10:00.000Z'),
        sampleCount: 60,
      },
    });

    await prisma.billingPlan.create({
      data: {
        deviceId: testDeviceId,
        pricingMode: 'FIXED',
        effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
        rateT1: 0.2,
        rateT2: 0.11,
        monthlyFixedFeeEur: null,
      },
    });

    await prisma.reading.create({
      data: {
        deviceId: testDeviceId,
        timestamp: new Date('2026-04-07T06:00:00.000Z'),
        electricityTariff: 2,
      },
    });

    const overview = await standbyPowerService.getGhostLoadOverview(
      testDeviceId,
      new Date('2026-04-07T06:00:00.000Z'),
    );

    expect(overview.status).toBe('complete');
    expect(overview.pricingMode).toBe('FIXED');
    expect(overview.baselinePowerWatts).toBe(250);
    expect(overview.projectedDailyKwh).toBeCloseTo(6, 6);
    expect(overview.currentRateEurPerKwh).toBeCloseTo(0.11, 6);
    expect(overview.projectedMonthlyCostEur).toBeGreaterThan(0);
  });

  it('returns a partial ghost-load overview when dynamic pricing is active but the current spot rate is unavailable', async () => {
    await prisma.standbyBaseline.create({
      data: {
        deviceId: testDeviceId,
        baselineDate: '2026-04-06',
        baselinePowerKw: 0.18,
        windowStartsAt: new Date('2026-04-06T23:10:00.000Z'),
        windowEndsAt: new Date('2026-04-06T23:20:00.000Z'),
        sampleCount: 60,
      },
    });

    await prisma.billingPlan.create({
      data: {
        deviceId: testDeviceId,
        pricingMode: 'DYNAMIC',
        effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
        monthlyFixedFeeEur: null,
        spotProvider: 'ELERING',
        spotZone: 'LT',
        spotAdderEurPerKwh: 0.04,
      },
    });

    const overview = await standbyPowerService.getGhostLoadOverview(
      testDeviceId,
      new Date('2026-04-07T06:00:00.000Z'),
    );

    expect(overview.status).toBe('partial');
    expect(overview.pricingMode).toBe('DYNAMIC');
    expect(overview.baselinePowerWatts).toBe(180);
    expect(overview.currentRateEurPerKwh).toBeNull();
    expect(overview.projectedMonthlyCostEur).toBeNull();
    expect(overview.messageCode).toBe('SPOT_PRICE_UNAVAILABLE');
    expect(overview.message).toBe('Current spot pricing is unavailable right now.');
  });

  it('returns partial when a dynamic billing plan is missing the spot adder', async () => {
    await prisma.standbyBaseline.create({
      data: {
        deviceId: testDeviceId,
        baselineDate: '2026-04-06',
        baselinePowerKw: 0.14,
        windowStartsAt: new Date('2026-04-06T23:20:00.000Z'),
        windowEndsAt: new Date('2026-04-06T23:30:00.000Z'),
        sampleCount: 60,
      },
    });

    await prisma.billingPlan.create({
      data: {
        deviceId: testDeviceId,
        pricingMode: 'DYNAMIC',
        effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
        monthlyFixedFeeEur: null,
        spotProvider: 'ELERING',
        spotZone: 'LT',
        spotAdderEurPerKwh: null,
      },
    });

    await prisma.spotPrice.create({
      data: {
        provider: 'ELERING',
        zone: 'LT',
        startsAt: new Date('2026-04-07T06:00:00.000Z'),
        endsAt: new Date('2026-04-07T07:00:00.000Z'),
        resolutionMinutes: 60,
        priceEurPerMwh: 100,
      },
    });

    const overview = await standbyPowerService.getGhostLoadOverview(
      testDeviceId,
      new Date('2026-04-07T06:30:00.000Z'),
    );

    expect(overview.status).toBe('partial');
    expect(overview.pricingMode).toBe('DYNAMIC');
    expect(overview.currentRateEurPerKwh).toBeNull();
    expect(overview.projectedMonthlyCostEur).toBeNull();
    expect(overview.messageCode).toBe('DYNAMIC_CONFIG_INCOMPLETE');
    expect(overview.message).toBe('Dynamic pricing settings are incomplete for this device.');
  });

  it('returns an unavailable overview message when no standby baseline exists', async () => {
    const overview = await standbyPowerService.getGhostLoadOverview(
      testDeviceId,
      new Date('2026-04-07T06:00:00.000Z'),
    );

    expect(overview.status).toBe('unavailable');
    expect(overview.messageCode).toBe('NO_BASELINE');
    expect(overview.message).toBe('No standby baseline is available yet.');
  });
});
