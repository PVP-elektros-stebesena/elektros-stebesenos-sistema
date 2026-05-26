import type { FastifyInstance } from 'fastify';
import { ESO } from '../../config/eso.js';
import prisma from '../../lib/prisma.js';
import { ensureAccessibleDevice, ownedDeviceRelationFilter } from '../deviceAccess.js';
import {
  parseDateOrDefault,
  parseOptionalDeviceId,
  validateAscendingRange,
} from '../queryParsers.js';
import type { HistoryQuery } from './shared.js';

export function registerVoltageHistoryRoute(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: HistoryQuery }>('/api/voltage/history', async (req, reply) => {
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
          AND: [
            { startsAt: { lte: to } },
            { endsAt: { gte: from } },
          ],
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
          voltage_l1: w.voltageL1,
          voltage_l2: w.voltageL2,
          voltage_l3: w.voltageL3,
          compliant_l1: w.compliantL1,
          compliant_l2: w.compliantL2,
          compliant_l3: w.compliantL3,
          oob_seconds_l1: w.outOfBoundsSecondsL1,
          oob_seconds_l2: w.outOfBoundsSecondsL2,
          oob_seconds_l3: w.outOfBoundsSecondsL3,
        })),
        bounds: {
          nominal: ESO.NOMINAL_VOLTAGE_1PH,
          min: ESO.VOLTAGE_MIN_1PH,
          max: ESO.VOLTAGE_MAX_1PH,
        },
      };
    }

    if (interval === 'latest') {
      const readings = await prisma.reading.findMany({
        where: deviceScope,
        orderBy: { timestamp: 'desc' },
        take: maxPoints,
        select: {
          deviceId: true,
          timestamp: true,
          voltageL1: true,
          voltageL2: true,
          voltageL3: true,
          instantaneousVoltageL1: true,
          instantaneousVoltageL2: true,
          instantaneousVoltageL3: true,
        },
      });

      readings.reverse();

      return {
        interval: 'latest',
        count: readings.length,
        data: readings.map((r) => ({
          deviceId: r.deviceId,
          timestamp: r.timestamp,
          voltage_l1: r.voltageL1 ?? r.instantaneousVoltageL1 ?? 0,
          voltage_l2: r.voltageL2 ?? r.instantaneousVoltageL2 ?? 0,
          voltage_l3: r.voltageL3 ?? r.instantaneousVoltageL3 ?? 0,
        })),
        bounds: {
          nominal: ESO.NOMINAL_VOLTAGE_1PH,
          min: ESO.VOLTAGE_MIN_1PH,
          max: ESO.VOLTAGE_MAX_1PH,
        },
      };
    }

    const readings = await prisma.reading.findMany({
      where: {
        ...deviceScope,
        timestamp: { gte: from, lte: to },
      },
      orderBy: { timestamp: 'asc' },
      select: {
        deviceId: true,
        timestamp: true,
        voltageL1: true,
        voltageL2: true,
        voltageL3: true,
        instantaneousVoltageL1: true,
        instantaneousVoltageL2: true,
        instantaneousVoltageL3: true,
      },
    });

    let data = readings;
    if (readings.length > maxPoints) {
      if (maxPoints <= 1) {
        data = [readings[readings.length - 1]];
      } else {
        const step = (readings.length - 1) / (maxPoints - 1);
        data = Array.from({ length: maxPoints }, (_, index) => readings[Math.round(index * step)]);
      }
    }

    return {
      interval: 'raw',
      from,
      to,
      count: data.length,
      data: data.map((r) => ({
        deviceId: r.deviceId,
        timestamp: r.timestamp,
        voltage_l1: r.voltageL1 ?? r.instantaneousVoltageL1 ?? 0,
        voltage_l2: r.voltageL2 ?? r.instantaneousVoltageL2 ?? 0,
        voltage_l3: r.voltageL3 ?? r.instantaneousVoltageL3 ?? 0,
      })),
      bounds: {
        nominal: ESO.NOMINAL_VOLTAGE_1PH,
        min: ESO.VOLTAGE_MIN_1PH,
        max: ESO.VOLTAGE_MAX_1PH,
      },
    };
  });
}
