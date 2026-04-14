import type { FastifyInstance } from 'fastify';
import prisma from '../../lib/prisma.js';
import { evaluatePowerPolicyBreaches } from '../../services/powerAnalysis.js';
import { resolveEffectivePowerPolicy } from '../../services/powerPolicy.js';
import { parseOptionalDeviceId } from '../queryParsers.js';
import { RAW_READING_SELECT, type DeviceQuery, toPowerPayload } from './shared.js';

export function registerPowerLatestRoute(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: DeviceQuery }>('/api/power/latest', async (req, reply) => {
    const parsedDeviceId = parseOptionalDeviceId(req.query.deviceId);
    if (!parsedDeviceId.ok) {
      return reply.code(parsedDeviceId.statusCode).send(parsedDeviceId.body);
    }
    const deviceId = parsedDeviceId.value;

    const latestRows = await prisma.reading.findMany({
      where: deviceId ? { deviceId } : undefined,
      orderBy: { timestamp: 'desc' },
      select: RAW_READING_SELECT,
      take: 2,
    });
    const latest = latestRows[0];

    if (!latest) {
      return reply.code(503).send({
        error: 'NO_DATA',
        message: 'No power readings received yet',
      });
    }

    const payload = toPowerPayload(latest);
    const policy = await resolveEffectivePowerPolicy(latest.deviceId, latest.timestamp);
    const previous = latestRows[1]
      ? toPowerPayload(latestRows[1])
      : null;

    const breaches = evaluatePowerPolicyBreaches(
      {
        activePowerTotalKw: payload.activePowerTotalKw,
        reactivePowerTotalKvar: payload.reactivePowerTotalKvar,
        apparentPowerTotalKva: payload.apparentPowerTotalKva,
        powerFactor: payload.powerFactor,
        phaseImbalancePct: payload.phaseImbalancePct,
        activePowerL1Kw: payload.activePowerL1Kw,
        activePowerL2Kw: payload.activePowerL2Kw,
        activePowerL3Kw: payload.activePowerL3Kw,
        reactivePowerL1Kvar: payload.reactivePowerL1Kvar,
        reactivePowerL2Kvar: payload.reactivePowerL2Kvar,
        reactivePowerL3Kvar: payload.reactivePowerL3Kvar,
      },
      policy,
      latest.timestamp,
      previous
        ? {
            timestamp: previous.timestamp,
            activePowerTotalKw: previous.activePowerTotalKw,
          }
        : undefined,
    );

    return {
      ...payload,
      policy,
      breaches,
    };
  });
}
