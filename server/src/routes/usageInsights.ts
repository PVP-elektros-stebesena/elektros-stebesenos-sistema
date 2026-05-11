import type { FastifyInstance, FastifyReply } from 'fastify';
import prisma from '../lib/prisma.js';
import {
  USAGE_ANOMALY_SCOPE,
  UsageInsightsValidationError,
  usageInsightsService,
  type UsageAnomalySettingsUpdate,
} from '../services/usageInsightsService.js';
import {
  parseOptionalDate,
  parseOptionalDeviceId,
  validateAscendingRange,
} from './queryParsers.js';

const settingsBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    enabled: { type: 'boolean' },
    baselineWeeks: { type: 'integer', minimum: 1, maximum: 8 },
    thresholdPct: { type: 'number', minimum: 5, maximum: 200 },
    sustainedIntervals: { type: 'integer', minimum: 1, maximum: 6 },
    scope: { type: 'string', enum: [USAGE_ANOMALY_SCOPE] },
  },
} as const;

interface UsageAnomalyQuery {
  from?: string;
  to?: string;
  deviceId?: string;
  limit?: string;
}

function requireAuthUserId(req: { authUser?: { id: number } }, reply: FastifyReply): number | null {
  if (!req.authUser?.id) {
    reply.code(401).send({
      error: 'UNAUTHENTICATED',
      message: 'Log in to access this resource.',
    });
    return null;
  }

  return req.authUser.id;
}

async function findAccessibleDevice(id: number, userId: number) {
  return prisma.device.findFirst({
    where: {
      id,
      userId,
    },
    select: {
      id: true,
    },
  });
}

function parseLimit(raw: string | undefined): number {
  if (raw == null || raw.trim() === '') return 100;
  const parsed = parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return 100;
  return Math.min(parsed, 1000);
}

function sendValidationError(reply: FastifyReply, error: unknown): boolean {
  if (!(error instanceof UsageInsightsValidationError)) {
    return false;
  }

  reply.code(400).send({
    error: error.code,
    message: error.message,
  });
  return true;
}

export async function usageInsightsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/usage-insights/settings', async (req, reply) => {
    const userId = requireAuthUserId(req, reply);
    if (userId == null) return;

    const settings = await usageInsightsService.getOrCreateSettings(userId);
    return reply.send(settings);
  });

  fastify.put<{ Body: UsageAnomalySettingsUpdate }>('/api/usage-insights/settings', {
    schema: { body: settingsBodySchema },
  }, async (req, reply) => {
    const userId = requireAuthUserId(req, reply);
    if (userId == null) return;

    try {
      const settings = await usageInsightsService.updateSettings(userId, req.body);
      return reply.send(settings);
    } catch (error) {
      if (sendValidationError(reply, error)) return;
      throw error;
    }
  });

  fastify.get<{ Querystring: UsageAnomalyQuery }>('/api/usage-insights/anomalies', async (req, reply) => {
    const userId = requireAuthUserId(req, reply);
    if (userId == null) return;

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
    const limit = parseLimit(req.query.limit);

    const validRange = validateAscendingRange(from ?? new Date(0), to ?? now);
    if (!validRange.ok) {
      return reply.code(validRange.statusCode).send(validRange.body);
    }

    if (deviceId != null) {
      const device = await findAccessibleDevice(deviceId, userId);
      if (!device) {
        return reply.code(404).send({
          error: 'NOT_FOUND',
          message: `Device ${deviceId} not found`,
        });
      }
    }

    const events = await usageInsightsService.listEvents({
      userId,
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(deviceId ? { deviceId } : {}),
      limit,
    });

    return reply.send({
      count: events.length,
      data: events,
    });
  });
}
