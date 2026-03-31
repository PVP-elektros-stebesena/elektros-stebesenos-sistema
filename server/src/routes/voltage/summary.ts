import type { FastifyInstance } from 'fastify';
import { ESO } from '../../config/eso.js';
import prisma from '../../lib/prisma.js';
import { parseOptionalDeviceId } from '../queryParsers.js';
import { getWeekBounds, type DeviceQuery } from './shared.js';

export function registerVoltageSummaryRoute(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: DeviceQuery }>('/api/voltage/summary', async (req, reply) => {
    const parsedDeviceId = parseOptionalDeviceId(req.query.deviceId);
    if (!parsedDeviceId.ok) {
      return reply.code(parsedDeviceId.statusCode).send(parsedDeviceId.body);
    }

    const deviceId = parsedDeviceId.value;
    const where = deviceId ? { deviceId } : {};

    const [latestReading, readingCount, windowCount, anomalyCount, activeAnomalyCount] =
      await Promise.all([
        prisma.reading.findFirst({ where, orderBy: { timestamp: 'desc' } }),
        prisma.reading.count({ where }),
        prisma.aggregatedData.count({ where }),
        prisma.anomaly.count({ where: { ...where, metricDomain: 'VOLTAGE' } }),
        prisma.anomaly.count({ where: { ...where, metricDomain: 'VOLTAGE', endsAt: null } }),
      ]);

    const { weekStart, weekEnd } = getWeekBounds(new Date());

    const weekWindows = await prisma.aggregatedData.findMany({
      where: { ...where, startsAt: { gte: weekStart, lt: weekEnd } },
    });

    const total = weekWindows.length;
    const cL1 = weekWindows.filter((w) => w.compliantL1).length;
    const cL2 = weekWindows.filter((w) => w.compliantL2).length;
    const cL3 = weekWindows.filter((w) => w.compliantL3).length;
    const pL1 = total > 0 ? +((cL1 / total) * 100).toFixed(2) : 0;
    const pL2 = total > 0 ? +((cL2 / total) * 100).toFixed(2) : 0;
    const pL3 = total > 0 ? +((cL3 / total) * 100).toFixed(2) : 0;

    return {
      has_data: latestReading !== null,
      latest_timestamp: latestReading?.timestamp ?? null,
      stats: {
        totalReadings: readingCount,
        totalWindows: windowCount,
        totalAnomalies: anomalyCount,
        activeAnomalies: activeAnomalyCount,
      },
      weekly_compliance: {
        pct_l1: pL1,
        pct_l2: pL2,
        pct_l3: pL3,
        overall_compliant:
          pL1 >= ESO.WEEKLY_COMPLIANCE_PCT &&
          pL2 >= ESO.WEEKLY_COMPLIANCE_PCT &&
          pL3 >= ESO.WEEKLY_COMPLIANCE_PCT,
      },
      bounds: {
        nominal: ESO.NOMINAL_VOLTAGE_1PH,
        min: ESO.VOLTAGE_MIN_1PH,
        max: ESO.VOLTAGE_MAX_1PH,
      },
    };
  });
}
