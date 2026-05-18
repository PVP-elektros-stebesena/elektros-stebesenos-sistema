import type { FastifyInstance } from 'fastify';
import { ESO } from '../../config/eso.js';
import prisma from '../../lib/prisma.js';
import { reactivePenaltyEstimatorService } from '../../services/reactivePenaltyEstimator.js';
import {
  parseDateOrDefault,
  parseRequiredDeviceId,
  validateAscendingRange,
} from '../queryParsers.js';

interface GridComplianceQuery {
  deviceId?: string;
  from?: string;
  to?: string;
}

const MAX_RANGE_DAYS = 62;
const WINDOW_MS = ESO.WINDOW_MINUTES * 60_000;
const MS_PER_DAY = 24 * 3600_000;

function deviceOwnerFilter(req: { authUser?: { id: number } }): { userId?: number } {
  return req.authUser ? { userId: req.authUser.id } : {};
}

async function findAccessibleDevice(id: number, req: { authUser?: { id: number } }) {
  return prisma.device.findFirst({
    where: {
      id,
      ...deviceOwnerFilter(req),
    },
    select: { id: true },
  });
}

function round(value: number, decimals = 3): number {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

function tanPhiFromPowerFactor(powerFactor: number | null): number | null {
  if (powerFactor == null || powerFactor <= 0 || powerFactor > 1) return null;
  return round(Math.sqrt(Math.max(0, 1 - powerFactor ** 2)) / powerFactor, 4);
}

function windowStartKey(timestamp: Date): string {
  return new Date(Math.floor(timestamp.getTime() / WINDOW_MS) * WINDOW_MS).toISOString();
}

export function registerPowerGridComplianceRoute(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: GridComplianceQuery }>('/api/power/grid-compliance', async (req, reply) => {
    const parsedDeviceId = parseRequiredDeviceId(req.query.deviceId);
    if (!parsedDeviceId.ok) {
      return reply.code(parsedDeviceId.statusCode).send(parsedDeviceId.body);
    }

    const now = new Date();
    const parsedFrom = parseDateOrDefault(req.query.from, new Date(now.getTime() - 30 * MS_PER_DAY), 'from');
    if (!parsedFrom.ok) {
      return reply.code(parsedFrom.statusCode).send(parsedFrom.body);
    }

    const parsedTo = parseDateOrDefault(req.query.to, now, 'to');
    if (!parsedTo.ok) {
      return reply.code(parsedTo.statusCode).send(parsedTo.body);
    }

    const deviceId = parsedDeviceId.value;
    const from = parsedFrom.value;
    const to = parsedTo.value;

    const validRange = validateAscendingRange(from, to);
    if (!validRange.ok) {
      return reply.code(validRange.statusCode).send(validRange.body);
    }

    if ((to.getTime() - from.getTime()) / MS_PER_DAY > MAX_RANGE_DAYS) {
      return reply.code(400).send({
        error: 'RANGE_TOO_LONG',
        message: `Grid compliance range cannot exceed ${MAX_RANGE_DAYS} days`,
      });
    }

    const device = await findAccessibleDevice(deviceId, req);
    if (!device) {
      return reply.code(404).send({
        error: 'NOT_FOUND',
        message: `Device ${deviceId} not found`,
      });
    }

    const [windows, readings] = await Promise.all([
      prisma.aggregatedData.findMany({
        where: {
          deviceId,
          startsAt: { gte: from },
          endsAt: { lte: to },
        },
        orderBy: { startsAt: 'asc' },
        select: {
          startsAt: true,
          endsAt: true,
          sampleCount: true,
          reactivePowerAvgTotal: true,
          powerFactorAvg: true,
        },
      }),
      prisma.reading.findMany({
        where: {
          deviceId,
          timestamp: { gte: from, lte: to },
        },
        orderBy: { timestamp: 'asc' },
        select: {
          timestamp: true,
          energyDelivered: true,
          reactiveEnergyDelivered: true,
          reactiveEnergyReturned: true,
        },
      }),
    ]);
    const penaltyEstimate = await reactivePenaltyEstimatorService.estimateForDevice(
      deviceId,
      from,
      to,
      { readings, windows },
    );

    const returnedByWindow = new Map<string, number>();
    for (let i = 1; i < readings.length; i++) {
      const previous = readings[i - 1]?.reactiveEnergyReturned ?? null;
      const current = readings[i]?.reactiveEnergyReturned ?? null;
      const windowTimestamp = readings[i - 1]?.timestamp;
      if (previous == null || current == null || !windowTimestamp) continue;

      const delta = current - previous;
      if (delta < 0) continue;

      const key = windowStartKey(windowTimestamp);
      returnedByWindow.set(key, round((returnedByWindow.get(key) ?? 0) + delta));
    }

    const powerFactorValues = windows
      .map((window) => window.powerFactorAvg)
      .filter((value): value is number => value != null);
    const lowPowerFactorWindowCount = powerFactorValues
      .filter((value) => value < ESO.REACTIVE_PENALTY.TARGET_POWER_FACTOR)
      .length;

    const data = windows.map((window) => {
      const powerFactor = window.powerFactorAvg;
      return {
        timestamp: window.startsAt.toISOString(),
        windowEnd: window.endsAt.toISOString(),
        sampleCount: window.sampleCount,
        reactivePowerTotalKvar: window.reactivePowerAvgTotal,
        reactiveEnergyReturnedKvarh: returnedByWindow.get(windowStartKey(window.startsAt)) ?? 0,
        powerFactor,
        tanPhi: tanPhiFromPowerFactor(powerFactor),
        lowPowerFactor:
          powerFactor != null && powerFactor < ESO.REACTIVE_PENALTY.TARGET_POWER_FACTOR,
      };
    });

    return {
      deviceId,
      from: from.toISOString(),
      to: to.toISOString(),
      targetPowerFactor: ESO.REACTIVE_PENALTY.TARGET_POWER_FACTOR,
      allowedTanPhiRatio: ESO.REACTIVE_PENALTY.ALLOWED_TAN_PHI_RATIO,
      penaltyEstimate,
      summary: {
        totalWindows: windows.length,
        lowPowerFactorWindowCount,
        lowPowerFactorWindowPct: powerFactorValues.length > 0
          ? round((lowPowerFactorWindowCount / powerFactorValues.length) * 100, 2)
          : null,
        averagePowerFactor: powerFactorValues.length > 0
          ? round(powerFactorValues.reduce((sum, value) => sum + value, 0) / powerFactorValues.length, 4)
          : null,
        minPowerFactor: powerFactorValues.length > 0
          ? round(Math.min(...powerFactorValues), 4)
          : null,
        reactiveEnergyReturnedKvarh: round([...returnedByWindow.values()].reduce((sum, value) => sum + value, 0)),
      },
      data,
    };
  });
}
