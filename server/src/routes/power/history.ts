import type { FastifyInstance } from 'fastify';
import prisma from '../../lib/prisma.js';
import { ensureAccessibleDevice, ownedDeviceRelationFilter } from '../deviceAccess.js';
import {
  parseDateOrDefault,
  parseOptionalDeviceId,
  validateAscendingRange,
} from '../queryParsers.js';
import { downsample, RAW_READING_SELECT, type HistoryQuery, toPowerPayload } from './shared.js';

export function registerPowerHistoryRoute(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: HistoryQuery }>('/api/power/history', async (req, reply) => {
    const now = new Date();

    const parsedFrom = parseDateOrDefault(req.query.from, new Date(now.getTime() - 3600_000), 'from');
    if (!parsedFrom.ok) {
      return reply.code(parsedFrom.statusCode).send(parsedFrom.body);
    }

    const parsedTo = parseDateOrDefault(req.query.to, now, 'to');
    if (!parsedTo.ok) {
      return reply.code(parsedTo.statusCode).send(parsedTo.body);
    }

    const parsedDeviceId = parseOptionalDeviceId(req.query.deviceId);
    if (!parsedDeviceId.ok) {
      return reply.code(parsedDeviceId.statusCode).send(parsedDeviceId.body);
    }

    const from = parsedFrom.value;
    const to = parsedTo.value;
    const deviceId = parsedDeviceId.value;
    if (deviceId && !(await ensureAccessibleDevice(deviceId, req, reply))) {
      return;
    }

    const deviceScope = {
      ...(deviceId ? { deviceId } : {}),
      ...ownedDeviceRelationFilter(req),
    };
    const maxPoints = Math.min(parseInt(req.query.points ?? '500', 10) || 500, 5000);
    const interval = req.query.interval ?? 'raw';

    const validRange = validateAscendingRange(from, to);
    if (!validRange.ok) {
      return reply.code(validRange.statusCode).send(validRange.body);
    }

    if (interval === '10min') {
      const windows = await prisma.aggregatedData.findMany({
        where: {
          ...deviceScope,
          startsAt: { gte: from },
          endsAt: { lte: to },
        },
        orderBy: { startsAt: 'asc' },
      });

      return {
        interval: '10min',
        from,
        to,
        count: windows.length,
        data: windows.map((w) => ({
          deviceId: w.deviceId,
          timestamp: w.startsAt,
          windowEnd: w.endsAt,
          sampleCount: w.sampleCount,
          activePowerAvgTotal: w.activePowerAvgTotal,
          activePowerMaxTotal: w.activePowerMaxTotal,
          reactivePowerAvgTotal: w.reactivePowerAvgTotal,
          reactivePowerMaxTotal: w.reactivePowerMaxTotal,
          apparentPowerAvgTotal: w.apparentPowerAvgTotal,
          apparentPowerMaxTotal: w.apparentPowerMaxTotal,
          powerFactorAvg: w.powerFactorAvg,
          activePowerAvgL1: w.activePowerAvgL1,
          activePowerAvgL2: w.activePowerAvgL2,
          activePowerAvgL3: w.activePowerAvgL3,
          reactivePowerAvgL1: w.reactivePowerAvgL1,
          reactivePowerAvgL2: w.reactivePowerAvgL2,
          reactivePowerAvgL3: w.reactivePowerAvgL3,
          powerImbalancePct: w.powerImbalancePct,
          powerPolicyBreached: w.powerPolicyBreached,
        })),
      };
    }

    const rows = await prisma.reading.findMany({
      where: {
        ...deviceScope,
        timestamp: { gte: from, lte: to },
      },
      orderBy: { timestamp: 'asc' },
      select: RAW_READING_SELECT,
    });

    const data = downsample(rows, maxPoints).map((row) => toPowerPayload(row));

    return {
      interval: 'raw',
      from,
      to,
      count: data.length,
      data,
    };
  });
}
