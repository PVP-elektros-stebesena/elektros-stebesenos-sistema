import type { FastifyInstance } from 'fastify';
import {
  NOTIFICATION_EVENT_TYPES,
  type NotificationEventType,
} from '../services/notificationTypes.js';
import {
  listNotificationSettings,
  setNotificationSetting,
} from '../services/notificationSettingsRepository.js';

function parseDeviceId(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return value;
}

function isNotificationEventType(value: string): value is NotificationEventType {
  return (NOTIFICATION_EVENT_TYPES as readonly string[]).includes(value);
}

export async function notificationRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: { deviceId?: string } }>('/api/notifications/events', async (req, reply) => {
    const deviceId = parseDeviceId(req.query.deviceId);
    if (req.query.deviceId && deviceId == null) {
      return reply.code(400).send({
        error: 'INVALID_DEVICE_ID',
        message: 'deviceId must be a positive integer',
      });
    }

    const settings = await listNotificationSettings(deviceId);
    return {
      defaults: NOTIFICATION_EVENT_TYPES.map((eventType) => ({
        eventType,
        enabled: true,
      })),
      overrides: settings,
    };
  });

  fastify.patch<{
    Params: { eventType: string };
    Body: { enabled: boolean; deviceId?: number | null };
  }>('/api/notifications/events/:eventType', async (req, reply) => {
    const { eventType } = req.params;

    if (!isNotificationEventType(eventType)) {
      return reply.code(400).send({
        error: 'INVALID_EVENT_TYPE',
        message: `eventType must be one of: ${NOTIFICATION_EVENT_TYPES.join(', ')}`,
      });
    }

    if (typeof req.body?.enabled !== 'boolean') {
      return reply.code(400).send({
        error: 'INVALID_ENABLED_FLAG',
        message: 'enabled must be a boolean',
      });
    }

    if (req.body.deviceId != null && (!Number.isInteger(req.body.deviceId) || req.body.deviceId <= 0)) {
      return reply.code(400).send({
        error: 'INVALID_DEVICE_ID',
        message: 'deviceId must be a positive integer or null',
      });
    }

    const updated = await setNotificationSetting({
      eventType,
      enabled: req.body.enabled,
      deviceId: req.body.deviceId ?? null,
    });

    return {
      message: 'Notification event toggle updated',
      data: updated,
    };
  });
}
