import type { FastifyInstance, FastifyError } from 'fastify';
import prisma from '../lib/prisma.js';
import { devicePoller } from '../services/devicePoller.js';

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
    name:         { type: 'string', minLength: 1, pattern: '\\S' },
    deviceIp:     { type: ['string', 'null'] },
    mqttBroker:   { type: ['string', 'null'] },
    mqttPort:     { type: ['integer', 'null'], minimum: 1, maximum: 65535 },
    mqttTopic:    { type: ['string', 'null'] },
    pollInterval: { type: 'integer', minimum: 1 },
    isActive:     { type: 'boolean' },
  },
} as const;

const patchBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name:         { type: 'string', minLength: 1, pattern: '\\S' },
    deviceIp:     { type: ['string', 'null'] },
    mqttBroker:   { type: ['string', 'null'] },
    mqttPort:     { type: ['integer', 'null'], minimum: 1, maximum: 65535 },
    mqttTopic:    { type: ['string', 'null'] },
    pollInterval: { type: 'integer', minimum: 1 },
    isActive:     { type: 'boolean' },
  },
} as const;

// Typescript interfaces

interface DeviceBody {
  name: string;
  deviceIp?: string | null;
  mqttBroker?: string | null;
  mqttPort?: number | null;
  mqttTopic?: string | null;
  pollInterval?: number;
  isActive?: boolean;
}

interface IdParam {
  id: number;
}

export async function settingsRoutes(fastify: FastifyInstance): Promise<void> {

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
    return reply.send(devices);
  });

  fastify.get<{ Params: IdParam }>('/api/settings/:id', {
    schema: { params: idParamSchema },
  }, async (req, reply) => {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });

    if (!device) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: `Device ${req.params.id} not found` });
    }

    return reply.send(device);
  });

  fastify.post<{ Body: DeviceBody }>('/api/settings', {
    schema: { body: deviceBodySchema },
  }, async (req, reply) => {
    const { name, deviceIp, mqttBroker, mqttPort, mqttTopic, pollInterval, isActive } = req.body;

    const device = await prisma.device.create({
      data: {
        name: name.trim(),
        deviceIp: deviceIp ?? null,
        mqttBroker: mqttBroker ?? null,
        mqttPort: mqttPort ?? null,
        mqttTopic: mqttTopic ?? null,
        pollInterval: pollInterval ?? 10,
        isActive: isActive ?? true,
      },
    });

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

    const { name, deviceIp, mqttBroker, mqttPort, mqttTopic, pollInterval, isActive } = req.body;

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name.trim();
    if (deviceIp !== undefined) data.deviceIp = deviceIp;
    if (mqttBroker !== undefined) data.mqttBroker = mqttBroker;
    if (mqttPort !== undefined) data.mqttPort = mqttPort;
    if (mqttTopic !== undefined) data.mqttTopic = mqttTopic;
    if (pollInterval !== undefined) data.pollInterval = pollInterval;
    if (isActive !== undefined) data.isActive = isActive;

    const updated = await prisma.device.update({ where: { id }, data });

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
}
