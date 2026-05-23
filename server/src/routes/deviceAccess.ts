import type { FastifyReply } from 'fastify';
import prisma from '../lib/prisma.js';

type AuthenticatedRequest = {
  authUser?: {
    id: number;
  };
};

export function ownedDeviceFilter(req: AuthenticatedRequest): { userId?: number } {
  return req.authUser ? { userId: req.authUser.id } : {};
}

export function ownedDeviceRelationFilter(req: AuthenticatedRequest): { device?: { userId: number } } {
  return req.authUser ? { device: { userId: req.authUser.id } } : {};
}

export async function findAccessibleDevice(id: number, req: AuthenticatedRequest) {
  return prisma.device.findFirst({
    where: {
      id,
      ...ownedDeviceFilter(req),
    },
    select: { id: true },
  });
}

export async function ensureAccessibleDevice(
  id: number,
  req: AuthenticatedRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const device = await findAccessibleDevice(id, req);
  if (device) return true;

  reply.code(404).send({
    error: 'NOT_FOUND',
    message: `Device ${id} not found`,
  });
  return false;
}
