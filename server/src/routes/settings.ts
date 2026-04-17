import type { FastifyInstance, FastifyError } from 'fastify';
import prisma from '../lib/prisma.js';
import {
  DEFAULT_POWER_PROFILE,
  POWER_PROFILE_PRESET_VALUES,
  type PowerProfilePreset,
} from '../config/powerPolicy.js';
import { devicePoller } from '../services/devicePoller.js';
import {
  listNotificationSettings,
  setNotificationSetting,
} from '../services/notificationSettingsRepository.js';
import {
  NOTIFICATION_EVENT_TYPES,
  type NotificationEventType,
} from '../services/notificationTypes.js';
import {
  clearPowerPolicyCache,
  syncPowerProfileOverride,
} from '../services/powerPolicy.js';
import {
  getActiveBillingPlan,
  getActiveBillingPlansByDeviceIds,
  listBillingPlans,
  saveBillingPlan,
  type BillingPlanPayload,
  type PricingMode,
  type SpotProvider,
  type SpotZone,
} from '../services/billingPlanService.js';
import {
  SPOT_PRICE_PROVIDER_NAMES,
  SPOT_PRICE_ZONES,
} from '../services/spotPriceProvider.js';
// JSON Schemas

const idParamSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'integer' },
  },
} as const;

const deviceBodySchema = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name:                { type: 'string', minLength: 1, pattern: '\\S' },
    deviceIp:            { type: ['string', 'null'] },
    mqttBroker:          { type: ['string', 'null'] },
    mqttPort:            { type: ['integer', 'null'], minimum: 1, maximum: 65535 },
    mqttTopic:           { type: ['string', 'null'] },
    powerProfile:        { type: 'string', enum: [...POWER_PROFILE_PRESET_VALUES] },
    pollInterval:        { type: 'integer', minimum: 1 },
    isActive:            { type: 'boolean' },
    notificationChannel: { type: ['string', 'null'], enum: ['email', 'sms', 'push', 'none', null] },
    notificationTarget:  { type: ['string', 'null'] },
  },
} as const;

const patchBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name:                { type: 'string', minLength: 1, pattern: '\\S' },
    deviceIp:            { type: ['string', 'null'] },
    mqttBroker:          { type: ['string', 'null'] },
    mqttPort:            { type: ['integer', 'null'], minimum: 1, maximum: 65535 },
    mqttTopic:           { type: ['string', 'null'] },
    powerProfile:        { type: 'string', enum: [...POWER_PROFILE_PRESET_VALUES] },
    pollInterval:        { type: 'integer', minimum: 1 },
    isActive:            { type: 'boolean' },
    notificationChannel: { type: ['string', 'null'], enum: ['email', 'sms', 'push', 'none', null] },
    notificationTarget:  { type: ['string', 'null'] },
  },
} as const;

const notificationPatchBodySchema = {
  type: 'object',
  required: ['notificationsEnabled', 'selectedEvents'],
  additionalProperties: false,
  properties: {
    notificationsEnabled: { type: 'boolean' },
    selectedEvents: {
      type: 'array',
      items: {
        type: 'string',
        enum: [...NOTIFICATION_EVENT_TYPES],
      },
      uniqueItems: true,
    },
  },
} as const;

const billingPlanBodySchema = {
  type: 'object',
  required: ['pricingMode', 'effectiveFrom', 'monthlyFixedFeeEur'],
  additionalProperties: false,
  properties: {
    pricingMode: { type: 'string', enum: ['FIXED', 'DYNAMIC'] },
    effectiveFrom: { type: 'string', minLength: 1 },
    fixedRates: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        t1: { type: ['number', 'null'], minimum: 0 },
        t2: { type: ['number', 'null'], minimum: 0 },
        t3: { type: ['number', 'null'], minimum: 0 },
        t4: { type: ['number', 'null'], minimum: 0 },
      },
    },
    dynamic: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['provider', 'zone', 'spotAdderEurPerKwh'],
      properties: {
        provider: { type: 'string', enum: [...SPOT_PRICE_PROVIDER_NAMES] },
        zone: { type: 'string', enum: [...SPOT_PRICE_ZONES] },
        spotAdderEurPerKwh: { type: 'number', minimum: 0 },
      },
    },
    monthlyFixedFeeEur: { type: ['number', 'null'], minimum: 0 },
  },
} as const;

interface NotificationPatchBody {
  notificationsEnabled: boolean;
  selectedEvents: NotificationEventType[];
}

interface BillingPlanBody extends BillingPlanPayload {
  pricingMode: PricingMode;
  dynamic?: {
    provider: SpotProvider;
    zone: SpotZone;
    spotAdderEurPerKwh: number;
  };
}

// Typescript interfaces

interface DeviceBody {
  name: string;
  deviceIp?: string | null;
  mqttBroker?: string | null;
  mqttPort?: number | null;
  mqttTopic?: string | null;
  powerProfile?: PowerProfilePreset;
  pollInterval?: number;
  isActive?: boolean;
  notificationChannel?: 'email' | 'sms' | 'push' | 'none' | null;
  notificationTarget?: string | null;
}

interface IdParam {
  id: number;
}

export async function settingsRoutes(fastify: FastifyInstance): Promise<void> {
  async function syncSelectedPowerProfile(deviceId: number, profile: PowerProfilePreset): Promise<void> {
    await syncPowerProfileOverride(deviceId, profile);
    clearPowerPolicyCache(deviceId);
  }

  // Custom error format so validation errors use our { error, message } shape
  fastify.setErrorHandler((error: FastifyError, _req, reply) => {
    if (error.validation) {
      return reply.code(400).send({
        error: 'VALIDATION',
        message: error.message,
      });
    }
    reply.code(error.statusCode ?? 500).send({
      error: 'INTERNAL',
      message: error.message,
    });
  });

  fastify.get('/api/settings', async (_req, reply) => {
    const devices = await prisma.device.findMany({
      orderBy: { createdAt: 'desc' },
    });
    const billingPlans = await getActiveBillingPlansByDeviceIds(devices.map((device) => device.id));
    return reply.send(devices.map((device) => ({
      ...device,
      billingPlan: billingPlans.get(device.id) ?? null,
    })));
  });

  fastify.get<{ Params: IdParam }>('/api/settings/:id', {
    schema: { params: idParamSchema },
  }, async (req, reply) => {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });

    if (!device) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: `Device ${req.params.id} not found` });
    }

    const billingPlan = await getActiveBillingPlan(device.id);
    return reply.send({
      ...device,
      billingPlan,
    });
  });

  fastify.post<{ Body: DeviceBody }>('/api/settings', {
    schema: { body: deviceBodySchema },
  }, async (req, reply) => {
  const {
    name,
    deviceIp,
    mqttBroker,
    mqttPort,
    mqttTopic,
    powerProfile,
    pollInterval,
    isActive,
    notificationChannel,
    notificationTarget,
  } = req.body;

    const device = await prisma.device.create({
      data: {
        name: name.trim(),
        deviceIp: deviceIp ?? null,
        mqttBroker: mqttBroker ?? null,
        mqttPort: mqttPort ?? null,
        mqttTopic: mqttTopic ?? null,
        powerProfile: powerProfile ?? DEFAULT_POWER_PROFILE,
        pollInterval: pollInterval ?? 10,
        isActive: isActive ?? true,
        notificationChannel: notificationChannel ?? 'email',
        notificationTarget: notificationTarget ?? null,
},
    });

    await syncSelectedPowerProfile(device.id, powerProfile ?? DEFAULT_POWER_PROFILE);

    // Trigger poller to pick up the new device immediately
    devicePoller.syncDevices().catch((err) =>
      req.log.error(err, 'Failed to sync poller after device creation'),
    );

    return reply.code(201).send(device);
  });

  fastify.patch<{ Params: IdParam; Body: Partial<DeviceBody> }>('/api/settings/:id', {
    schema: { params: idParamSchema, body: patchBodySchema },
  }, async (req, reply) => {
    const { id } = req.params;

    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: `Device ${id} not found` });
    }

    const {
      name,
      deviceIp,
      mqttBroker,
      mqttPort,
      mqttTopic,
      powerProfile,
      pollInterval,
      isActive,
      notificationChannel,
      notificationTarget,
    } = req.body;

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name.trim();
    if (deviceIp !== undefined) data.deviceIp = deviceIp;
    if (mqttBroker !== undefined) data.mqttBroker = mqttBroker;
    if (mqttPort !== undefined) data.mqttPort = mqttPort;
    if (mqttTopic !== undefined) data.mqttTopic = mqttTopic;
    if (powerProfile !== undefined) data.powerProfile = powerProfile;
    if (pollInterval !== undefined) data.pollInterval = pollInterval;
    if (isActive !== undefined) data.isActive = isActive;
    if (notificationChannel !== undefined) data.notificationChannel = notificationChannel;
    if (notificationTarget !== undefined) data.notificationTarget = notificationTarget;

    const updated = await prisma.device.update({ where: { id }, data });

    if (powerProfile !== undefined) {
      await syncSelectedPowerProfile(updated.id, powerProfile);
    }

    // Trigger poller to reconcile changes immediately
    devicePoller.syncDevices().catch((err) =>
      req.log.error(err, 'Failed to sync poller after device update'),
    );

    return reply.send(updated);
  });

  fastify.delete<{ Params: IdParam }>('/api/settings/:id', {
    schema: { params: idParamSchema },
  }, async (req, reply) => {
    const { id } = req.params;

    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: `Device ${id} not found` });
    }

    await prisma.device.delete({ where: { id } });

    // Trigger poller to stop polling the deleted device
    devicePoller.syncDevices().catch((err) =>
      req.log.error(err, 'Failed to sync poller after device deletion'),
    );

    return reply.code(204).send();
  });

  fastify.get<{ Params: IdParam }>('/api/settings/:id/notifications', {
  schema: { params: idParamSchema },
}, async (req, reply) => {
  const { id } = req.params;

  const existing = await prisma.device.findUnique({ where: { id } });
  if (!existing) {
    return reply.code(404).send({
      error: 'NOT_FOUND',
      message: `Device ${id} not found`,
    });
  }

  const rows = await listNotificationSettings(id);

  const effectiveMap = new Map<NotificationEventType, boolean>();

  for (const eventType of NOTIFICATION_EVENT_TYPES) {
    effectiveMap.set(eventType, true);
  }

  for (const row of rows) {
    if (!effectiveMap.has(row.eventType)) continue;
    if (row.deviceId === null && !rows.some(r => r.eventType === row.eventType && r.deviceId === id)) {
      effectiveMap.set(row.eventType, row.enabled);
    }
    if (row.deviceId === id) {
      effectiveMap.set(row.eventType, row.enabled);
    }
  }

  const selectedEvents = NOTIFICATION_EVENT_TYPES.filter(
    (eventType) => effectiveMap.get(eventType) === true,
  );

  return reply.send({
    notificationsEnabled: selectedEvents.length > 0,
    selectedEvents,
    availableEvents: NOTIFICATION_EVENT_TYPES,
  });
});

fastify.patch<{ Params: IdParam; Body: NotificationPatchBody }>(
  '/api/settings/:id/notifications',
  {
    schema: {
      params: idParamSchema,
      body: notificationPatchBodySchema,
    },
  },
  async (req, reply) => {
    const { id } = req.params;
    const { notificationsEnabled, selectedEvents } = req.body;

    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({
        error: 'NOT_FOUND',
        message: `Device ${id} not found`,
      });
    }

    const selectedSet = new Set(selectedEvents);

    const saved = await Promise.all(
      NOTIFICATION_EVENT_TYPES.map((eventType) =>
        setNotificationSetting({
          deviceId: id,
          eventType,
          enabled: notificationsEnabled && selectedSet.has(eventType),
        }),
      ),
    );

    return reply.send({
      notificationsEnabled,
      selectedEvents: NOTIFICATION_EVENT_TYPES.filter((eventType) =>
        notificationsEnabled && selectedSet.has(eventType),
      ),
      settings: saved,
    });
  },
);

  fastify.get<{ Params: IdParam }>('/api/settings/:id/billing-plan', {
    schema: { params: idParamSchema },
  }, async (req, reply) => {
    const { id } = req.params;
    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({
        error: 'NOT_FOUND',
        message: `Device ${id} not found`,
      });
    }

    const [activePlan, history] = await Promise.all([
      getActiveBillingPlan(id),
      listBillingPlans(id),
    ]);

    return reply.send({
      activePlan,
      history,
    });
  });

  fastify.put<{ Params: IdParam; Body: BillingPlanBody }>('/api/settings/:id/billing-plan', {
    schema: {
      params: idParamSchema,
      body: billingPlanBodySchema,
    },
  }, async (req, reply) => {
    const { id } = req.params;
    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({
        error: 'NOT_FOUND',
        message: `Device ${id} not found`,
      });
    }

    const effectiveFrom = new Date(req.body.effectiveFrom);
    if (Number.isNaN(effectiveFrom.getTime())) {
      return reply.code(400).send({
        error: 'INVALID_EFFECTIVE_FROM',
        message: 'effectiveFrom must be a valid ISO datetime',
      });
    }

    if (req.body.pricingMode === 'FIXED' && !req.body.fixedRates) {
      return reply.code(400).send({
        error: 'INVALID_BILLING_PLAN',
        message: 'fixedRates are required for FIXED pricing mode',
      });
    }

    if (req.body.pricingMode === 'DYNAMIC' && !req.body.dynamic) {
      return reply.code(400).send({
        error: 'INVALID_BILLING_PLAN',
        message: 'dynamic pricing settings are required for DYNAMIC pricing mode',
      });
    }

    const saved = await saveBillingPlan(id, req.body);
    return reply.send({
      billingPlan: saved,
      activePlan: await getActiveBillingPlan(id),
    });
  });
}
