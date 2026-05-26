import prisma from '../lib/prisma.js';

export const USAGE_ANOMALY_SCOPE = 'PER_DEVICE' as const;

export const DEFAULT_USAGE_ANOMALY_SETTINGS = {
  enabled: true,
  baselineWeeks: 4,
  thresholdPct: 25,
  sustainedIntervals: 3,
  scope: USAGE_ANOMALY_SCOPE,
} as const;

const MIN_BASELINE_WEEKS = 1;
const MAX_BASELINE_WEEKS = 8;
const MIN_THRESHOLD_PCT = 5;
const MAX_THRESHOLD_PCT = 200;
const MIN_SUSTAINED_INTERVALS = 1;
const MAX_SUSTAINED_INTERVALS = 6;
const WEEK_MS = 7 * 24 * 3600_000;
const DETECTION_LOOKBACK_MS = 24 * 3600_000;
const EPSILON_KWH = 0.000001;
const BASELINE_AVG_KW_FLOOR = 0.8;

export interface UsageAnomalySettingsPayload {
  enabled: boolean;
  baselineWeeks: number;
  thresholdPct: number;
  sustainedIntervals: number;
  scope: typeof USAGE_ANOMALY_SCOPE;
}

export interface UsageAnomalySettingsUpdate {
  enabled?: boolean;
  baselineWeeks?: number;
  thresholdPct?: number;
  sustainedIntervals?: number;
  scope?: string;
}

interface CompletedUsageWindow {
  startsAt: Date;
  endsAt: Date;
  activePowerAvgTotal: number | null;
}

interface UsageComparison {
  startsAt: Date;
  endsAt: Date;
  observedKwh: number;
  baselineKwh: number;
  deltaPct: number;
  direction: 'HIGH' | 'LOW';
}

interface UsageEventInput {
  userId: number;
  deviceId: number;
  startsAt: Date;
  endsAt: Date;
  observedKwh: number;
  baselineKwh: number;
  deltaPct: number;
  scope: typeof USAGE_ANOMALY_SCOPE;
  explanation: string;
}

export interface UsageDetectionRunResult {
  tenantsProcessed: number;
  devicesProcessed: number;
  eventsPersisted: number;
}

export class UsageInsightsValidationError extends Error {
  readonly code = 'INVALID_USAGE_ANOMALY_SETTINGS';

  constructor(message: string) {
    super(message);
    this.name = 'UsageInsightsValidationError';
  }
}

function round(value: number, decimals: number = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function validateIntegerRange(
  value: number,
  fieldName: string,
  min: number,
  max: number,
): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new UsageInsightsValidationError(`${fieldName} must be an integer between ${min} and ${max}.`);
  }
}

function validateNumberRange(
  value: number,
  fieldName: string,
  min: number,
  max: number,
): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new UsageInsightsValidationError(`${fieldName} must be between ${min} and ${max}.`);
  }
}

function normalizeSettings(input: UsageAnomalySettingsUpdate): UsageAnomalySettingsPayload {
  const next = {
    ...DEFAULT_USAGE_ANOMALY_SETTINGS,
    ...input,
  };

  if (typeof next.enabled !== 'boolean') {
    throw new UsageInsightsValidationError('enabled must be a boolean.');
  }

  validateIntegerRange(next.baselineWeeks, 'baselineWeeks', MIN_BASELINE_WEEKS, MAX_BASELINE_WEEKS);
  validateNumberRange(next.thresholdPct, 'thresholdPct', MIN_THRESHOLD_PCT, MAX_THRESHOLD_PCT);
  validateIntegerRange(
    next.sustainedIntervals,
    'sustainedIntervals',
    MIN_SUSTAINED_INTERVALS,
    MAX_SUSTAINED_INTERVALS,
  );

  if (next.scope !== USAGE_ANOMALY_SCOPE) {
    throw new UsageInsightsValidationError(`scope must be ${USAGE_ANOMALY_SCOPE}.`);
  }

  return {
    enabled: next.enabled,
    baselineWeeks: next.baselineWeeks,
    thresholdPct: next.thresholdPct,
    sustainedIntervals: next.sustainedIntervals,
    scope: USAGE_ANOMALY_SCOPE,
  };
}

function toSettingsPayload(row: {
  enabled: boolean;
  baselineWeeks: number;
  thresholdPct: number;
  sustainedIntervals: number;
  scope: string;
}): UsageAnomalySettingsPayload {
  return {
    enabled: row.enabled,
    baselineWeeks: row.baselineWeeks,
    thresholdPct: row.thresholdPct,
    sustainedIntervals: row.sustainedIntervals,
    scope: row.scope === USAGE_ANOMALY_SCOPE ? USAGE_ANOMALY_SCOPE : USAGE_ANOMALY_SCOPE,
  };
}

function windowDurationHours(window: CompletedUsageWindow): number | null {
  const durationHours = (window.endsAt.getTime() - window.startsAt.getTime()) / 3600_000;
  if (durationHours <= 0) return null;

  return durationHours;
}

function windowUsageKwh(window: CompletedUsageWindow): number | null {
  if (window.activePowerAvgTotal == null) return null;

  const durationHours = windowDurationHours(window);
  if (durationHours == null) return null;

  return Math.max(0, window.activePowerAvgTotal) * durationHours;
}

function addWeeks(date: Date, weeks: number): Date {
  return new Date(date.getTime() + weeks * WEEK_MS);
}

function isContiguous(previous: UsageComparison, current: UsageComparison): boolean {
  return previous.endsAt.getTime() === current.startsAt.getTime();
}

function explanationForEvent(input: {
  observedKwh: number;
  baselineKwh: number;
  deltaPct: number;
  intervalCount: number;
}): string {
  const direction = input.deltaPct >= 0 ? 'higher' : 'lower';
  return `Usage was ${Math.abs(input.deltaPct).toFixed(1)}% ${direction} than the same-weekday baseline for ${input.intervalCount} interval(s): observed ${input.observedKwh.toFixed(3)} kWh vs baseline ${input.baselineKwh.toFixed(3)} kWh.`;
}

function buildEventFromStreak(
  userId: number,
  deviceId: number,
  scope: typeof USAGE_ANOMALY_SCOPE,
  streak: UsageComparison[],
): UsageEventInput {
  const observedKwh = streak.reduce((sum, item) => sum + item.observedKwh, 0);
  const baselineKwh = streak.reduce((sum, item) => sum + item.baselineKwh, 0);
  const deltaPct = baselineKwh > EPSILON_KWH
    ? ((observedKwh - baselineKwh) / baselineKwh) * 100
    : 0;

  const roundedObserved = round(observedKwh);
  const roundedBaseline = round(baselineKwh);
  const roundedDelta = round(deltaPct, 2);

  return {
    userId,
    deviceId,
    startsAt: streak[0]!.startsAt,
    endsAt: streak[streak.length - 1]!.endsAt,
    observedKwh: roundedObserved,
    baselineKwh: roundedBaseline,
    deltaPct: roundedDelta,
    scope,
    explanation: explanationForEvent({
      observedKwh: roundedObserved,
      baselineKwh: roundedBaseline,
      deltaPct: roundedDelta,
      intervalCount: streak.length,
    }),
  };
}

export class UsageInsightsService {
  async getOrCreateSettings(userId: number): Promise<UsageAnomalySettingsPayload> {
    const settings = await prisma.usageAnomalySetting.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        ...DEFAULT_USAGE_ANOMALY_SETTINGS,
      },
    });

    return toSettingsPayload(settings);
  }

  async updateSettings(
    userId: number,
    input: UsageAnomalySettingsUpdate,
  ): Promise<UsageAnomalySettingsPayload> {
    const current = await this.getOrCreateSettings(userId);
    const next = normalizeSettings({
      ...current,
      ...input,
    });

    const settings = await prisma.usageAnomalySetting.upsert({
      where: { userId },
      update: next,
      create: {
        userId,
        ...next,
      },
    });

    return toSettingsPayload(settings);
  }

  async listEvents(input: {
    userId: number;
    from?: Date;
    to?: Date;
    deviceId?: number;
    limit?: number;
  }) {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 1000);

    const events = await prisma.usageAnomalyEvent.findMany({
      where: {
        userId: input.userId,
        ...(input.deviceId ? { deviceId: input.deviceId } : {}),
        ...((input.from || input.to)
          ? {
              ...(input.from ? { endsAt: { gte: input.from } } : {}),
              ...(input.to ? { startsAt: { lte: input.to } } : {}),
            }
          : {}),
      },
      include: {
        device: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { startsAt: 'desc' },
      take: limit,
    });

    return events;
  }

  async runDetection(reference = new Date()): Promise<UsageDetectionRunResult> {
    await this.ensureDefaultSettingsForAllUsers();

    const settingsRows = await prisma.usageAnomalySetting.findMany({
      where: { enabled: true },
      orderBy: { userId: 'asc' },
    });

    let tenantsProcessed = 0;
    let devicesProcessed = 0;
    let eventsPersisted = 0;

    for (const row of settingsRows) {
      const settings = toSettingsPayload(row);
      const devices = await prisma.device.findMany({
        where: { userId: row.userId },
        select: { id: true },
        orderBy: { id: 'asc' },
      });

      tenantsProcessed += 1;

      for (const device of devices) {
        devicesProcessed += 1;
        eventsPersisted += await this.detectForDevice({
          userId: row.userId,
          deviceId: device.id,
          settings,
          reference,
        });
      }
    }

    return {
      tenantsProcessed,
      devicesProcessed,
      eventsPersisted,
    };
  }

  private async ensureDefaultSettingsForAllUsers(): Promise<void> {
    const users = await prisma.user.findMany({
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    for (const user of users) {
      await prisma.usageAnomalySetting.upsert({
        where: { userId: user.id },
        update: {},
        create: {
          userId: user.id,
          ...DEFAULT_USAGE_ANOMALY_SETTINGS,
        },
      });
    }
  }

  async detectForDevice(input: {
    userId: number;
    deviceId: number;
    settings: UsageAnomalySettingsPayload;
    reference?: Date;
  }): Promise<number> {
    if (!input.settings.enabled) return 0;

    const reference = input.reference ?? new Date();
    const windows = await prisma.aggregatedData.findMany({
      where: {
        deviceId: input.deviceId,
        startsAt: {
          gte: new Date(reference.getTime() - DETECTION_LOOKBACK_MS),
        },
        endsAt: {
          lte: reference,
        },
        activePowerAvgTotal: { not: null },
        sampleCount: { gt: 0 },
      },
      orderBy: { startsAt: 'asc' },
      select: {
        startsAt: true,
        endsAt: true,
        activePowerAvgTotal: true,
      },
    });

    let persisted = 0;
    let streak: UsageComparison[] = [];
    let skippedUncomparableWindow = false;

    const flushStreak = async () => {
      if (streak.length < input.settings.sustainedIntervals) {
        streak = [];
        return;
      }

      const event = buildEventFromStreak(
        input.userId,
        input.deviceId,
        input.settings.scope,
        streak,
      );
      await this.persistEvent(event, input.settings);
      persisted += 1;
      streak = [];
    };

    for (const window of windows) {
      const comparison = await this.compareWindow(input.deviceId, window, input.settings.baselineWeeks);

      if (!comparison) {
        skippedUncomparableWindow = true;
        continue;
      }

      if (Math.abs(comparison.deltaPct) < input.settings.thresholdPct) {
        skippedUncomparableWindow = false;
        await flushStreak();
        continue;
      }

      const previous = streak[streak.length - 1];
      if (
        previous
        && (
          previous.direction !== comparison.direction
          || (!skippedUncomparableWindow && !isContiguous(previous, comparison))
        )
      ) {
        await flushStreak();
      }

      streak.push(comparison);
      skippedUncomparableWindow = false;
    }

    await flushStreak();
    return persisted;
  }

  private async compareWindow(
    deviceId: number,
    window: CompletedUsageWindow,
    baselineWeeks: number,
  ): Promise<UsageComparison | null> {
    const observedKwh = windowUsageKwh(window);
    if (observedKwh == null) return null;

    const baselineValues: number[] = [];

    for (let week = 1; week <= baselineWeeks; week += 1) {
      const baselineWindow = await prisma.aggregatedData.findUnique({
        where: {
          deviceId_startsAt_endsAt: {
            deviceId,
            startsAt: addWeeks(window.startsAt, -week),
            endsAt: addWeeks(window.endsAt, -week),
          },
        },
        select: {
          startsAt: true,
          endsAt: true,
          activePowerAvgTotal: true,
        },
      });

      if (!baselineWindow) continue;

      const baselineKwh = windowUsageKwh(baselineWindow);
      if (baselineKwh != null) baselineValues.push(baselineKwh);
    }

    if (baselineValues.length === 0) return null;

    const baselineKwh = baselineValues.reduce((sum, value) => sum + value, 0) / baselineValues.length;
    const durationHours = windowDurationHours(window);
    if (durationHours == null) return null;

    const baselineAvgKw = baselineKwh / durationHours;
    if (baselineKwh <= EPSILON_KWH || baselineAvgKw < BASELINE_AVG_KW_FLOOR) return null;

    const deltaPct = ((observedKwh - baselineKwh) / baselineKwh) * 100;

    return {
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      observedKwh,
      baselineKwh,
      deltaPct,
      direction: deltaPct >= 0 ? 'HIGH' : 'LOW',
    };
  }

  private async recomputeEventMetrics(input: {
    deviceId: number;
    startsAt: Date;
    endsAt: Date;
    settings: UsageAnomalySettingsPayload;
    direction: UsageComparison['direction'];
  }): Promise<Pick<UsageEventInput, 'observedKwh' | 'baselineKwh' | 'deltaPct' | 'explanation'> | null> {
    const windows = await prisma.aggregatedData.findMany({
      where: {
        deviceId: input.deviceId,
        startsAt: { gte: input.startsAt },
        endsAt: { lte: input.endsAt },
        activePowerAvgTotal: { not: null },
        sampleCount: { gt: 0 },
      },
      orderBy: { startsAt: 'asc' },
      select: {
        startsAt: true,
        endsAt: true,
        activePowerAvgTotal: true,
      },
    });

    const comparisons: UsageComparison[] = [];

    for (const window of windows) {
      const comparison = await this.compareWindow(
        input.deviceId,
        window,
        input.settings.baselineWeeks,
      );

      if (!comparison) continue;
      if (Math.abs(comparison.deltaPct) < input.settings.thresholdPct) continue;
      if (comparison.direction !== input.direction) continue;

      comparisons.push(comparison);
    }

    if (comparisons.length === 0) return null;

    const observedKwh = comparisons.reduce((sum, item) => sum + item.observedKwh, 0);
    const baselineKwh = comparisons.reduce((sum, item) => sum + item.baselineKwh, 0);
    const deltaPct = baselineKwh > EPSILON_KWH
      ? ((observedKwh - baselineKwh) / baselineKwh) * 100
      : 0;

    const roundedObserved = round(observedKwh);
    const roundedBaseline = round(baselineKwh);
    const roundedDelta = round(deltaPct, 2);

    return {
      observedKwh: roundedObserved,
      baselineKwh: roundedBaseline,
      deltaPct: roundedDelta,
      explanation: explanationForEvent({
        observedKwh: roundedObserved,
        baselineKwh: roundedBaseline,
        deltaPct: roundedDelta,
        intervalCount: comparisons.length,
      }),
    };
  }

  private async persistEvent(
    input: UsageEventInput,
    settings: UsageAnomalySettingsPayload,
  ): Promise<void> {
    const existing = await prisma.usageAnomalyEvent.findFirst({
      where: {
        userId: input.userId,
        deviceId: input.deviceId,
        scope: input.scope,
        startsAt: { lte: input.endsAt },
        endsAt: { gte: input.startsAt },
      },
      orderBy: [
        { endsAt: 'desc' },
        { startsAt: 'asc' },
        { id: 'desc' },
      ],
    });

    const startsAt = existing
      ? new Date(Math.min(existing.startsAt.getTime(), input.startsAt.getTime()))
      : input.startsAt;
    const endsAt = existing
      ? new Date(Math.max(existing.endsAt.getTime(), input.endsAt.getTime()))
      : input.endsAt;

    if (existing) {
      const recomputed = await this.recomputeEventMetrics({
        deviceId: input.deviceId,
        startsAt,
        endsAt,
        settings,
        direction: input.deltaPct >= 0 ? 'HIGH' : 'LOW',
      });

      await prisma.usageAnomalyEvent.update({
        where: { id: existing.id },
        data: {
          startsAt,
          endsAt,
          observedKwh: recomputed?.observedKwh ?? input.observedKwh,
          baselineKwh: recomputed?.baselineKwh ?? input.baselineKwh,
          deltaPct: recomputed?.deltaPct ?? input.deltaPct,
          explanation: recomputed?.explanation ?? input.explanation,
        },
      });
      return;
    }

    await prisma.usageAnomalyEvent.create({
      data: {
        ...input,
        startsAt,
        endsAt,
      },
    });
  }
}

export const usageInsightsService = new UsageInsightsService();
