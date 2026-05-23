import type { FastifyInstance } from 'fastify';
import { resolveEffectivePowerPolicy } from '../../services/powerPolicy.js';
import { ensureAccessibleDevice } from '../deviceAccess.js';
import { parseRequiredDeviceId } from '../queryParsers.js';
import type { DeviceQuery } from './shared.js';

export function registerPowerPolicyRoute(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: DeviceQuery }>('/api/power/policy', async (req, reply) => {
    const parsedDeviceId = parseRequiredDeviceId(req.query.deviceId);
    if (!parsedDeviceId.ok) {
      return reply.code(parsedDeviceId.statusCode).send(parsedDeviceId.body);
    }

    const deviceId = parsedDeviceId.value;
    if (!(await ensureAccessibleDevice(deviceId, req, reply))) {
      return;
    }

    const policy = await resolveEffectivePowerPolicy(deviceId);

    return {
      deviceId,
      policy,
    };
  });
}
