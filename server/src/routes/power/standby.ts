import type { FastifyInstance } from 'fastify';
import prisma from '../../lib/prisma.js';
import { parseRequiredDeviceId } from '../queryParsers.js';
import { standbyPowerService } from '../../services/standbyPowerService.js';

interface DeviceQuery {
  deviceId?: string;
}

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

export function registerPowerStandbyRoute(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: DeviceQuery }>('/api/power/standby', async (req, reply) => {
    const parsedDeviceId = parseRequiredDeviceId(req.query.deviceId);
    if (!parsedDeviceId.ok) {
      return reply.code(parsedDeviceId.statusCode).send(parsedDeviceId.body);
    }

    const deviceId = parsedDeviceId.value;
    const device = await findAccessibleDevice(deviceId, req);

    if (!device) {
      return reply.code(404).send({
        error: 'NOT_FOUND',
        message: `Device ${deviceId} not found`,
      });
    }

    return standbyPowerService.getGhostLoadOverview(deviceId);
  });
}
