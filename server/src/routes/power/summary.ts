import type { FastifyInstance } from 'fastify';
import prisma from '../../lib/prisma.js';
import { resolveEffectivePowerPolicy } from '../../services/powerPolicy.js';
import { parseOptionalDeviceId } from '../queryParsers.js';
import { RAW_READING_SELECT, type DeviceQuery, toPowerPayload } from './shared.js';

export function registerPowerSummaryRoute(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: DeviceQuery }>('/api/power/summary', async (req, reply) => {
    const parsedDeviceId = parseOptionalDeviceId(req.query.deviceId);
    if (!parsedDeviceId.ok) {
      return reply.code(parsedDeviceId.statusCode).send(parsedDeviceId.body);
    }

    const deviceId = parsedDeviceId.value;
    const where = deviceId ? { deviceId } : {};

    const [latest, readingCount, windowCount, breachWindowCount, anomalyCount, activeAnomalyCount] =
      await Promise.all([
        prisma.reading.findFirst({
          where,
          orderBy: { timestamp: 'desc' },
          select: RAW_READING_SELECT,
        }),
        prisma.reading.count({ where }),
        prisma.aggregatedData.count({
          where: {
            ...where,
            OR: [
              { activePowerAvgTotal: { not: null } },
              { reactivePowerAvgTotal: { not: null } },
              { apparentPowerAvgTotal: { not: null } },
            ],
          },
        }),
        prisma.aggregatedData.count({
          where: {
            ...where,
            powerPolicyBreached: true,
          },
        }),
        prisma.anomaly.count({
          where: {
            ...where,
            metricDomain: 'POWER',
          },
        }),
        prisma.anomaly.count({
          where: {
            ...where,
            metricDomain: 'POWER',
            endsAt: null,
          },
        }),
      ]);

    const policy = latest
      ? await resolveEffectivePowerPolicy(latest.deviceId, latest.timestamp)
      : null;

    return {
      has_data: latest != null,
      latest_timestamp: latest?.timestamp ?? null,
      latest_metrics: latest ? toPowerPayload(latest) : null,
      stats: {
        totalReadings: readingCount,
        totalPowerWindows: windowCount,
        policyBreachedWindows: breachWindowCount,
        totalPowerAnomalies: anomalyCount,
        activePowerAnomalies: activeAnomalyCount,
      },
      policy,
    };
  });
}
