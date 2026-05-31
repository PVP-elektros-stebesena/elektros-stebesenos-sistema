import type { FastifyInstance } from 'fastify';
import prisma from '../../lib/prisma.js';
import { ensureAccessibleDevice, ownedDeviceRelationFilter } from '../deviceAccess.js';
import {
  parseOptionalDate,
  parseOptionalDeviceId,
  validateAscendingRange,
} from '../queryParsers.js';
import type { AnomalyQuery, DeviceQuery } from './shared.js';

export function registerPowerAnomaliesRoute(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: AnomalyQuery }>('/api/power/anomalies', async (req, reply) => {
    const now = new Date();

    const parsedFrom = parseOptionalDate(req.query.from, 'from');
    if (!parsedFrom.ok) {
      return reply.code(parsedFrom.statusCode).send(parsedFrom.body);
    }

    const parsedTo = parseOptionalDate(req.query.to, 'to');
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

    const limit = Math.min(parseInt(req.query.limit ?? '100', 10) || 100, 1000);

    const rangeFrom = from ?? new Date(0);
    const rangeTo = to ?? now;
    const validRange = validateAscendingRange(rangeFrom, rangeTo);
    if (!validRange.ok) {
      return reply.code(validRange.statusCode).send(validRange.body);
    }

    const anomalies = await prisma.anomaly.findMany({
      where: {
        metricDomain: 'POWER',
        ...(deviceId ? { deviceId } : {}),
        ...ownedDeviceRelationFilter(req),
        ...(req.query.type ? { type: req.query.type } : {}),
        ...(req.query.metricName ? { metricName: req.query.metricName } : {}),
        ...(req.query.phase ? { phase: req.query.phase } : {}),
        ...((from || to)
          ? {
              AND: [
                ...(to ? [{ startsAt: { lte: to } }] : []),
                ...(from ? [{ OR: [{ endsAt: null }, { endsAt: { gte: from } }] }] : []),
              ],
            }
          : {}),
      },
      orderBy: { startsAt: 'desc' },
      take: limit,
    });

    return {
      count: anomalies.length,
      data: anomalies,
    };
  });

  fastify.get<{ Querystring: DeviceQuery }>('/api/power/anomalies/active', async (req, reply) => {
    const parsedDeviceId = parseOptionalDeviceId(req.query.deviceId);
    if (!parsedDeviceId.ok) {
      return reply.code(parsedDeviceId.statusCode).send(parsedDeviceId.body);
    }

    const deviceId = parsedDeviceId.value;
    if (deviceId && !(await ensureAccessibleDevice(deviceId, req, reply))) {
      return;
    }

    const active = await prisma.anomaly.findMany({
      where: {
        metricDomain: 'POWER',
        ...(deviceId ? { deviceId } : {}),
        ...ownedDeviceRelationFilter(req),
        endsAt: null,
      },
      orderBy: { startsAt: 'desc' },
    });

    return {
      count: active.length,
      data: active,
    };
  });
}
