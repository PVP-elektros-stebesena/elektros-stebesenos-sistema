import type { FastifyInstance } from 'fastify';
import prisma from '../../lib/prisma.js';
import { ensureAccessibleDevice, ownedDeviceRelationFilter } from '../deviceAccess.js';
import { parseOptionalDeviceId } from '../queryParsers.js';
import type { DeviceQuery } from './shared.js';

export function registerVoltageLiveRoute(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: DeviceQuery }>('/api/live/raw', async (req, reply) => {
    const parsedDeviceId = parseOptionalDeviceId(req.query.deviceId);
    if (!parsedDeviceId.ok) {
      return reply.code(parsedDeviceId.statusCode).send(parsedDeviceId.body);
    }

    const deviceId = parsedDeviceId.value;
    if (deviceId && !(await ensureAccessibleDevice(deviceId, req, reply))) {
      return;
    }

    const reading = await prisma.reading.findFirst({
      where: {
        ...(deviceId ? { deviceId } : {}),
        ...ownedDeviceRelationFilter(req),
      },
      orderBy: { timestamp: 'desc' },
    });

    if (!reading) {
      return reply.code(503).send({
        error: 'NO_DATA',
        message: 'No readings received yet',
      });
    }

    return reading;
  });
}
