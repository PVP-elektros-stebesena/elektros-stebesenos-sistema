import type { FastifyInstance } from 'fastify';
import prisma from '../../lib/prisma.js';
import {
  CONTEXT_PADDING_MS,
  downsampleContextPoints,
  normalizePhaseVoltages,
  pickTotalPowerKw,
  pickVoltageByPhase,
  type ContextChartPoint,
} from './shared.js';

export function registerAnomalyContextRoute(fastify: FastifyInstance): void {
  fastify.get<{ Params: { id: string } }>('/api/anomalies/:id/context', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'Anomaly ID must be a number' });
    }

    const anomaly = await prisma.anomaly.findUnique({
      where: { id },
      select: {
        id: true,
        deviceId: true,
        metricDomain: true,
        phase: true,
        type: true,
        startsAt: true,
        endsAt: true,
        minVoltage: true,
        maxVoltage: true,
      },
    });

    if (!anomaly) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Anomaly not found' });
    }

    if (anomaly.metricDomain !== 'VOLTAGE') {
      return reply.code(400).send({
        error: 'UNSUPPORTED_ANOMALY_DOMAIN',
        message: 'Only voltage anomalies support context slicing',
      });
    }

    const anomalyEndsAt = anomaly.endsAt ?? anomaly.startsAt;
    const contextStartsAt = new Date(anomaly.startsAt.getTime() - CONTEXT_PADDING_MS);
    const contextEndsAt = new Date(anomalyEndsAt.getTime() + CONTEXT_PADDING_MS);

    const readings = await prisma.reading.findMany({
      where: {
        deviceId: anomaly.deviceId,
        timestamp: {
          gte: contextStartsAt,
          lte: contextEndsAt,
        },
      },
      orderBy: { timestamp: 'asc' },
      select: {
        timestamp: true,
        instantaneousVoltageL1: true,
        instantaneousVoltageL2: true,
        instantaneousVoltageL3: true,
        voltageL1: true,
        voltageL2: true,
        voltageL3: true,
        activeInstantaneousPowerDelivered: true,
        powerDeliveredTotal: true,
        activeInstantaneousPowerDeliveredL1: true,
        activeInstantaneousPowerDeliveredL2: true,
        activeInstantaneousPowerDeliveredL3: true,
      },
    });

    const rawPoints: ContextChartPoint[] = readings.map((row) => {
      const normalizedVoltages = normalizePhaseVoltages(row);
      return {
        timestamp: row.timestamp.toISOString(),
        voltage: pickVoltageByPhase(anomaly.phase, normalizedVoltages),
        voltageL1: normalizedVoltages.voltageL1,
        voltageL2: normalizedVoltages.voltageL2,
        voltageL3: normalizedVoltages.voltageL3,
        powerKw: pickTotalPowerKw(row),
      };
    });

    const points = downsampleContextPoints(rawPoints, anomaly.startsAt, anomalyEndsAt);

    return {
      anomaly: {
        id: anomaly.id,
        deviceId: anomaly.deviceId,
        phase: anomaly.phase,
        type: anomaly.type,
        startsAt: anomaly.startsAt.toISOString(),
        endsAt: anomalyEndsAt.toISOString(),
        minVoltage: anomaly.minVoltage,
        maxVoltage: anomaly.maxVoltage,
      },
      context: {
        startsAt: contextStartsAt.toISOString(),
        endsAt: contextEndsAt.toISOString(),
        rawPointCount: rawPoints.length,
        returnedPointCount: points.length,
        downsampled: points.length < rawPoints.length,
      },
      points,
    };
  });
}
