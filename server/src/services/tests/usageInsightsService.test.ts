import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import prisma from '../../lib/prisma.js';
import {
  DEFAULT_USAGE_ANOMALY_SETTINGS,
  USAGE_ANOMALY_SCOPE,
  usageInsightsService,
  type UsageAnomalySettingsPayload,
} from '../usageInsightsService.js';

let userId: number;
let deviceId: number;

beforeEach(async () => {
  const user = await prisma.user.create({
    data: {
      email: `usage-service-${Date.now()}-${Math.random()}@example.com`,
      passwordHash: 'test-hash',
    },
  });
  userId = user.id;

  const device = await prisma.device.create({
    data: {
      userId,
      name: 'Usage insights test device',
      isActive: true,
    },
  });
  deviceId = device.id;
});

afterEach(async () => {
  await prisma.usageAnomalyEvent.deleteMany({ where: { userId } });
  await prisma.usageAnomalySetting.deleteMany({ where: { userId } });
  await prisma.aggregatedData.deleteMany({ where: { deviceId } });
  await prisma.device.deleteMany({ where: { id: deviceId } });
  await prisma.user.deleteMany({ where: { id: userId } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

function settings(overrides: Partial<UsageAnomalySettingsPayload> = {}): UsageAnomalySettingsPayload {
  return {
    ...DEFAULT_USAGE_ANOMALY_SETTINGS,
    ...overrides,
    scope: USAGE_ANOMALY_SCOPE,
  };
}

async function seedWindow(startsAt: Date, activePowerAvgTotal: number): Promise<void> {
  await prisma.aggregatedData.create({
    data: {
      deviceId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 10 * 60_000),
      sampleCount: 60,
      activePowerAvgTotal,
    },
  });
}

async function seedBaselineFor(
  startsAt: Date,
  activePowerAvgTotal: number,
  weeksBack = 1,
): Promise<void> {
  await seedWindow(
    new Date(startsAt.getTime() - weeksBack * 7 * 24 * 3600_000),
    activePowerAvgTotal,
  );
}

describe('UsageInsightsService detection', () => {
  it('creates default settings for tenants during scheduled detection', async () => {
    await prisma.usageAnomalySetting.deleteMany({ where: { userId } });

    const result = await usageInsightsService.runDetection(new Date('2026-05-11T11:00:00.000Z'));
    const setting = await prisma.usageAnomalySetting.findUnique({ where: { userId } });

    expect(result.tenantsProcessed).toBeGreaterThanOrEqual(1);
    expect(setting).toMatchObject({
      enabled: true,
      baselineWeeks: 4,
      thresholdPct: 25,
      sustainedIntervals: 3,
      scope: 'PER_DEVICE',
    });
  });

  it('uses same weekday windows across the configured baseline weeks', async () => {
    const startsAt = new Date('2026-05-11T10:00:00.000Z');

    await seedBaselineFor(startsAt, 1, 1);
    await seedBaselineFor(startsAt, 3, 2);
    await seedWindow(new Date('2026-05-10T10:00:00.000Z'), 20);
    await seedWindow(startsAt, 6);

    const persisted = await usageInsightsService.detectForDevice({
      userId,
      deviceId,
      settings: settings({
        baselineWeeks: 2,
        thresholdPct: 50,
        sustainedIntervals: 1,
      }),
      reference: new Date('2026-05-11T11:00:00.000Z'),
    });

    const event = await prisma.usageAnomalyEvent.findFirst({ where: { userId, deviceId } });

    expect(persisted).toBe(1);
    expect(event).not.toBeNull();
    expect(event?.observedKwh).toBeCloseTo(1, 4);
    expect(event?.baselineKwh).toBeCloseTo(0.3333, 4);
    expect(event?.deltaPct).toBeCloseTo(200, 2);
  });

  it('skips windows when no same-weekday baseline exists', async () => {
    const startsAt = new Date('2026-05-11T10:00:00.000Z');
    await seedWindow(startsAt, 6);

    const persisted = await usageInsightsService.detectForDevice({
      userId,
      deviceId,
      settings: settings({
        baselineWeeks: 2,
        thresholdPct: 50,
        sustainedIntervals: 1,
      }),
      reference: new Date('2026-05-11T11:00:00.000Z'),
    });

    const count = await prisma.usageAnomalyEvent.count({ where: { userId, deviceId } });

    expect(persisted).toBe(0);
    expect(count).toBe(0);
  });

  it('skips high percentage deltas when the baseline load is too low', async () => {
    const startsAt = new Date('2026-05-11T10:00:00.000Z');

    for (let index = 0; index < 3; index += 1) {
      const intervalStartsAt = new Date(startsAt.getTime() + index * 10 * 60_000);
      await seedBaselineFor(intervalStartsAt, 0.5);
      await seedWindow(intervalStartsAt, 3);
    }

    const persisted = await usageInsightsService.detectForDevice({
      userId,
      deviceId,
      settings: settings({
        baselineWeeks: 1,
        thresholdPct: 50,
        sustainedIntervals: 3,
      }),
      reference: new Date('2026-05-11T11:00:00.000Z'),
    });

    const count = await prisma.usageAnomalyEvent.count({ where: { userId, deviceId } });

    expect(persisted).toBe(0);
    expect(count).toBe(0);
  });

  it('does not break a sustained streak when an intermediate window has no baseline', async () => {
    const startsAt = new Date('2026-05-11T10:00:00.000Z');
    const missingBaselineStartsAt = new Date(startsAt.getTime() + 10 * 60_000);
    const nextStartsAt = new Date(startsAt.getTime() + 20 * 60_000);

    await seedBaselineFor(startsAt, 1);
    await seedBaselineFor(nextStartsAt, 1);
    await seedWindow(startsAt, 4);
    await seedWindow(missingBaselineStartsAt, 6);
    await seedWindow(nextStartsAt, 5);

    const persisted = await usageInsightsService.detectForDevice({
      userId,
      deviceId,
      settings: settings({
        baselineWeeks: 1,
        thresholdPct: 50,
        sustainedIntervals: 2,
      }),
      reference: new Date('2026-05-11T11:00:00.000Z'),
    });

    const events = await prisma.usageAnomalyEvent.findMany({ where: { userId, deviceId } });

    expect(persisted).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]?.startsAt.toISOString()).toBe(startsAt.toISOString());
    expect(events[0]?.endsAt.toISOString()).toBe(new Date(nextStartsAt.getTime() + 10 * 60_000).toISOString());
    expect(events[0]?.observedKwh).toBeCloseTo(1.5, 4);
    expect(events[0]?.baselineKwh).toBeCloseTo(0.3333, 4);
  });

  it('does not create an event until sustained intervals are exceeded', async () => {
    const startsAt = new Date('2026-05-11T10:00:00.000Z');
    const nextStartsAt = new Date(startsAt.getTime() + 10 * 60_000);

    await seedBaselineFor(startsAt, 1);
    await seedBaselineFor(nextStartsAt, 1);
    await seedWindow(startsAt, 6);
    await seedWindow(nextStartsAt, 1.1);

    const persisted = await usageInsightsService.detectForDevice({
      userId,
      deviceId,
      settings: settings({
        baselineWeeks: 1,
        thresholdPct: 50,
        sustainedIntervals: 2,
      }),
      reference: new Date('2026-05-11T11:00:00.000Z'),
    });

    const count = await prisma.usageAnomalyEvent.count({ where: { userId, deviceId } });

    expect(persisted).toBe(0);
    expect(count).toBe(0);
  });

  it('persists one event for consecutive high-usage intervals', async () => {
    const startsAt = new Date('2026-05-11T10:00:00.000Z');
    const nextStartsAt = new Date(startsAt.getTime() + 10 * 60_000);

    await seedBaselineFor(startsAt, 1);
    await seedBaselineFor(nextStartsAt, 1);
    await seedWindow(startsAt, 4);
    await seedWindow(nextStartsAt, 5);

    const persisted = await usageInsightsService.detectForDevice({
      userId,
      deviceId,
      settings: settings({
        baselineWeeks: 1,
        thresholdPct: 50,
        sustainedIntervals: 2,
      }),
      reference: new Date('2026-05-11T11:00:00.000Z'),
    });

    const events = await prisma.usageAnomalyEvent.findMany({ where: { userId, deviceId } });

    expect(persisted).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]?.startsAt.toISOString()).toBe(startsAt.toISOString());
    expect(events[0]?.endsAt.toISOString()).toBe(new Date(nextStartsAt.getTime() + 10 * 60_000).toISOString());
    expect(events[0]?.observedKwh).toBeCloseTo(1.5, 4);
    expect(events[0]?.baselineKwh).toBeCloseTo(0.3333, 4);
    expect(events[0]?.explanation).toContain('higher');
  });

  it('updates an existing rolling anomaly instead of creating a new 10-minute shifted row', async () => {
    const intervalMs = 10 * 60_000;
    const firstReference = new Date('2026-05-24T02:30:00.000Z');
    const firstWindowStart = new Date(firstReference.getTime() - 24 * 60 * 60_000);

    for (let index = 0; index < 144; index += 1) {
      const windowStart = new Date(firstWindowStart.getTime() + index * intervalMs);
      await seedBaselineFor(windowStart, 1);
      await seedWindow(windowStart, 6);
    }

    const firstPersisted = await usageInsightsService.detectForDevice({
      userId,
      deviceId,
      settings: settings({
        baselineWeeks: 1,
        thresholdPct: 50,
        sustainedIntervals: 3,
      }),
      reference: firstReference,
    });

    await seedBaselineFor(firstReference, 1);
    await seedWindow(firstReference, 6);

    const secondPersisted = await usageInsightsService.detectForDevice({
      userId,
      deviceId,
      settings: settings({
        baselineWeeks: 1,
        thresholdPct: 50,
        sustainedIntervals: 3,
      }),
      reference: new Date(firstReference.getTime() + intervalMs),
    });

    const events = await prisma.usageAnomalyEvent.findMany({
      where: { userId, deviceId },
      orderBy: { startsAt: 'asc' },
    });

    expect(firstPersisted).toBe(1);
    expect(secondPersisted).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]?.startsAt.toISOString()).toBe(firstWindowStart.toISOString());
    expect(events[0]?.endsAt.toISOString()).toBe(new Date(firstReference.getTime() + intervalMs).toISOString());
  });

  it('persists lower-usage anomaly explanations for sustained negative deltas', async () => {
    const startsAt = new Date('2026-05-11T10:00:00.000Z');
    const nextStartsAt = new Date(startsAt.getTime() + 10 * 60_000);

    await seedBaselineFor(startsAt, 4);
    await seedBaselineFor(nextStartsAt, 4);
    await seedWindow(startsAt, 1);
    await seedWindow(nextStartsAt, 1);

    const persisted = await usageInsightsService.detectForDevice({
      userId,
      deviceId,
      settings: settings({
        baselineWeeks: 1,
        thresholdPct: 50,
        sustainedIntervals: 2,
      }),
      reference: new Date('2026-05-11T11:00:00.000Z'),
    });

    const event = await prisma.usageAnomalyEvent.findFirst({ where: { userId, deviceId } });

    expect(persisted).toBe(1);
    expect(event).not.toBeNull();
    expect(event?.deltaPct).toBeCloseTo(-75, 2);
    expect(event?.explanation).toContain('lower');
  });
});
