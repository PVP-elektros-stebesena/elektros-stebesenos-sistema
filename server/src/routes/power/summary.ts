import type { FastifyInstance } from 'fastify';
import prisma from '../../lib/prisma.js';
import { buildPhaseImbalanceRecommendations } from '../../services/powerAnalysis.js';
import { resolveEffectivePowerPolicy } from '../../services/powerPolicy.js';
import { ensureAccessibleDevice, ownedDeviceRelationFilter } from '../deviceAccess.js';
import { parseOptionalDeviceId } from '../queryParsers.js';
import { RAW_READING_SELECT, type DeviceQuery, toPowerPayload } from './shared.js';

export function registerPowerSummaryRoute(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: DeviceQuery }>('/api/power/summary', async (req, reply) => {
    const parsedDeviceId = parseOptionalDeviceId(req.query.deviceId);
    if (!parsedDeviceId.ok) {
      return reply.code(parsedDeviceId.statusCode).send(parsedDeviceId.body);
    }

    const deviceId = parsedDeviceId.value;
    if (deviceId && !(await ensureAccessibleDevice(deviceId, req, reply))) {
      return;
    }

    const where = {
      ...(deviceId ? { deviceId } : {}),
      ...ownedDeviceRelationFilter(req),
    };

    const now = new Date();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      latest,
      readingCount,
      windowCount,
      breachWindowCount,
      anomalyCount,
      activeAnomalyCount,
      weekWindows,
    ] = await Promise.all([
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
        prisma.aggregatedData.findMany({
          where: {
            ...where,
            startsAt: { gte: weekStart, lte: now },
          },
          select: {
            powerImbalancePct: true,
            activePowerAvgL1: true,
            activePowerAvgL2: true,
            activePowerAvgL3: true,
          },
        }),
      ]);

    const policy = latest
      ? await resolveEffectivePowerPolicy(latest.deviceId, latest.timestamp)
      : null;

    const phaseRecommendations = buildPhaseImbalanceRecommendations(weekWindows, policy);

    return {
      has_data: latest != null,
      latest_timestamp: latest?.timestamp ?? null,
      latest_metrics: latest ? toPowerPayload(latest) : null,
      maxGridCapacityKw: policy?.maxGridCapacityKw ?? null,
      stats: {
        totalReadings: readingCount,
        totalPowerWindows: windowCount,
        policyBreachedWindows: breachWindowCount,
        totalPowerAnomalies: anomalyCount,
        activePowerAnomalies: activeAnomalyCount,
      },
      insights: {
        phaseRecommendations,
      },
      policy,
    };
  });
}
