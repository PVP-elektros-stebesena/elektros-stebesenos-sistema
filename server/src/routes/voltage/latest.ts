import type { FastifyInstance } from 'fastify';
import { ESO } from '../../config/eso.js';
import prisma from '../../lib/prisma.js';
import { analyseVoltage } from '../../services/voltageAnalysis.js';
import { parseOptionalDeviceId } from '../queryParsers.js';
import type { DeviceQuery } from './shared.js';

export function registerVoltageLatestRoute(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: DeviceQuery }>('/api/voltage/latest', async (req, reply) => {
    const parsedDeviceId = parseOptionalDeviceId(req.query.deviceId);
    if (!parsedDeviceId.ok) {
      return reply.code(parsedDeviceId.statusCode).send(parsedDeviceId.body);
    }
    const deviceId = parsedDeviceId.value;

    const reading = await prisma.reading.findFirst({
      where: deviceId ? { deviceId } : undefined,
      orderBy: { timestamp: 'desc' },
    });

    if (!reading) {
      return reply.code(503).send({
        error: 'NO_DATA',
        message: 'No voltage readings received yet',
      });
    }

    const vL1 = reading.voltageL1 ?? reading.instantaneousVoltageL1 ?? 0;
    const vL2 = reading.voltageL2 ?? reading.instantaneousVoltageL2 ?? 0;
    const vL3 = reading.voltageL3 ?? reading.instantaneousVoltageL3 ?? 0;

    const phases = [
      analyseVoltage(vL1, 'L1'),
      analyseVoltage(vL2, 'L2'),
      analyseVoltage(vL3, 'L3'),
    ];

    return {
      deviceId: reading.deviceId,
      timestamp: reading.timestamp,
      phases,
      bounds: {
        nominal: ESO.NOMINAL_VOLTAGE_1PH,
        tolerance: ESO.VOLTAGE_TOLERANCE,
        min: ESO.VOLTAGE_MIN_1PH,
        max: ESO.VOLTAGE_MAX_1PH,
      },
    };
  });
}
