import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  authenticateToken,
  hashPassword,
  isSetupRequired,
  login,
  type PublicUser,
  registerUser,
  revokeSession,
  verifyPassword,
} from '../services/authService.js';
import prisma from '../lib/prisma.js';

const credentialsSchema = {
  type: 'object',
  required: ['identifier', 'password'],
  additionalProperties: false,
  properties: {
    identifier: { type: 'string', minLength: 1 },
    password: { type: 'string', minLength: 1 },
  },
} as const;

const setupSchema = {
  type: 'object',
  required: ['email', 'password'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', minLength: 3, pattern: '^\\S+@\\S+\\.\\S+$' },
    username: { type: ['string', 'null'], minLength: 3 },
    displayName: { type: ['string', 'null'] },
    password: { type: 'string', minLength: 8 },
  },
} as const;

interface LoginBody {
  identifier: string;
  password: string;
}

interface SetupBody {
  email: string;
  username?: string | null;
  displayName?: string | null;
  password: string;
}

const updateProfileSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    displayName: { type: ['string', 'null'] },
    username: { type: ['string', 'null'], minLength: 3 },
    email: { type: 'string', minLength: 3, pattern: '^\\S+@\\S+\\.\\S+$' },
  },
} as const;

const changePasswordSchema = {
  type: 'object',
  required: ['currentPassword', 'newPassword'],
  additionalProperties: false,
  properties: {
    currentPassword: { type: 'string', minLength: 1 },
    newPassword: { type: 'string', minLength: 8 },
  },
} as const;

interface UpdateProfileBody {
  displayName?: string | null;
  username?: string | null;
  email?: string;
}

interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}

function isAuthDisabled(): boolean {
  return process.env.DISABLE_AUTH === 'true'
    && process.env.NODE_ENV !== 'production'
    && process.env.NODE_ENV !== 'test';
}

const LOCAL_DEV_EMAIL = 'local-dev@example.com';

function toPublicUser(user: {
  id: number;
  email: string;
  username: string | null;
  displayName: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

async function getLocalDevUser(): Promise<PublicUser> {
  const user = await prisma.$transaction(async (tx) => {
    const localDevUser = await tx.user.upsert({
      where: { email: LOCAL_DEV_EMAIL },
      update: {
        displayName: 'Local Dev',
      },
      create: {
        email: LOCAL_DEV_EMAIL,
        username: null,
        displayName: 'Local Dev',
        passwordHash: 'disabled-auth-local-dev',
      },
    });

    await tx.device.updateMany({
      where: { userId: null },
      data: { userId: localDevUser.id },
    });

    return localDevUser;
  });

  return toPublicUser(user);
}

function getBearerToken(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;

  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

export async function requireAuthentication(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (req.method === 'OPTIONS') return;
  if (!req.url.startsWith('/api/')) return;

  if (isAuthDisabled()) {
    req.authUser = await getLocalDevUser();
    return;
  }

  if (
    req.url.startsWith('/api/auth/status') ||
    req.url.startsWith('/api/auth/setup') ||
    req.url.startsWith('/api/auth/login')
  ) {
    return;
  }

  const user = await authenticateToken(getBearerToken(req));
  if (!user) {
    reply.code(401).send({
      error: 'UNAUTHENTICATED',
      message: 'Log in to access this resource.',
    });
    return;
  }

  req.authUser = user;
}

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/auth/status', async (_req, reply) => {
    if (isAuthDisabled()) {
      return reply.send({
        setupRequired: false,
        authDisabled: true,
      });
    }

    return reply.send({ setupRequired: await isSetupRequired() });
  });

  fastify.post<{ Body: SetupBody }>('/api/auth/setup', {
    schema: { body: setupSchema },
  }, async (req, reply) => {
    try {
      const result = await registerUser({
        ...req.body,
        userAgent: req.headers['user-agent'],
      });
      return reply.code(201).send(result);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
        return reply.code(409).send({
          error: 'EMAIL_OR_USERNAME_TAKEN',
          message: 'Email or username already in use.',
        });
      }
      throw err;
    }
  });

  fastify.post<{ Body: LoginBody }>('/api/auth/login', {
    schema: { body: credentialsSchema },
  }, async (req, reply) => {
    const result = await login({
      ...req.body,
      userAgent: req.headers['user-agent'],
    });

    if (!result) {
      return reply.code(401).send({
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid email, username, or password.',
      });
    }

    return reply.send(result);
  });

  fastify.get('/api/auth/me', async (req, reply) => {
    if (isAuthDisabled()) {
      return reply.send({ user: await getLocalDevUser() });
    }

    const user = await authenticateToken(getBearerToken(req));
    if (!user) {
      return reply.code(401).send({
        error: 'UNAUTHENTICATED',
        message: 'Log in to access this resource.',
      });
    }

    return reply.send({ user });
  });

  fastify.post('/api/auth/logout', async (req, reply) => {
    if (isAuthDisabled()) {
      return reply.code(204).send();
    }

    await revokeSession(getBearerToken(req));
    return reply.code(204).send();
  });

  fastify.get('/api/auth/me/stats', async (req, reply) => {
    const authUser = req.authUser;
    if (!authUser) {
      return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Not authenticated.' });
    }

    const userRecord = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { createdAt: true, lastLoginAt: true },
    });

    const devices = await prisma.device.findMany({
      where: { userId: authUser.id },
      select: { id: true },
    });
    const deviceIds = devices.map((d) => d.id);
    const deviceCount = deviceIds.length;

    const renterCount = await prisma.renter.count({ where: { landlordUserId: authUser.id } });

    if (deviceCount === 0) {
      return reply.send({
        memberSince: userRecord?.createdAt.toISOString() ?? null,
        lastLoginAt: userRecord?.lastLoginAt?.toISOString() ?? null,
        deviceCount: 0,
        totalReadings: 0,
        totalEnergyConsumedKwh: null,
        totalEnergyReturnedKwh: null,
        totalAnomalies: 0,
        activeAnomalies: 0,
        voltageAnomalies: 0,
        powerAnomalies: 0,
        totalReports: 0,
        renterCount,
        oldestReadingAt: null,
        newestReadingAt: null,
      });
    }

    const [readingAgg, anomalyGroups, activeAnomalyCount, reportCount, energyPerDevice] = await Promise.all([
      prisma.reading.aggregate({
        where: { deviceId: { in: deviceIds } },
        _count: { timestamp: true },
        _min: { timestamp: true },
        _max: { timestamp: true },
      }),
      prisma.anomaly.groupBy({
        by: ['metricDomain'],
        where: { deviceId: { in: deviceIds } },
        _count: { id: true },
      }),
      prisma.anomaly.count({ where: { deviceId: { in: deviceIds }, endsAt: null } }),
      prisma.report.count({ where: { deviceId: { in: deviceIds } } }),
      Promise.all(
        deviceIds.map((deviceId) =>
          prisma.reading.aggregate({
            where: { deviceId },
            _max: { energyDelivered: true, energyReturned: true },
            _min: { energyDelivered: true, energyReturned: true },
          }),
        ),
      ),
    ]);

    let totalEnergyConsumedKwh: number | null = null;
    let totalEnergyReturnedKwh: number | null = null;
    for (const agg of energyPerDevice) {
      const maxD = agg._max.energyDelivered;
      const minD = agg._min.energyDelivered;
      const maxR = agg._max.energyReturned;
      const minR = agg._min.energyReturned;
      if (maxD != null && minD != null) totalEnergyConsumedKwh = (totalEnergyConsumedKwh ?? 0) + (maxD - minD);
      if (maxR != null && minR != null) totalEnergyReturnedKwh = (totalEnergyReturnedKwh ?? 0) + (maxR - minR);
    }

    const voltageAnomalies = anomalyGroups.find((g) => g.metricDomain === 'VOLTAGE')?._count.id ?? 0;
    const powerAnomalies = anomalyGroups.find((g) => g.metricDomain === 'POWER')?._count.id ?? 0;
    const totalAnomalies = anomalyGroups.reduce((sum, g) => sum + g._count.id, 0);

    return reply.send({
      memberSince: userRecord?.createdAt.toISOString() ?? null,
      lastLoginAt: userRecord?.lastLoginAt?.toISOString() ?? null,
      deviceCount,
      totalReadings: readingAgg._count.timestamp,
      totalEnergyConsumedKwh,
      totalEnergyReturnedKwh,
      totalAnomalies,
      activeAnomalies: activeAnomalyCount,
      voltageAnomalies,
      powerAnomalies,
      totalReports: reportCount,
      renterCount,
      oldestReadingAt: readingAgg._min.timestamp?.toISOString() ?? null,
      newestReadingAt: readingAgg._max.timestamp?.toISOString() ?? null,
    });
  });

  fastify.patch<{ Body: UpdateProfileBody }>('/api/auth/me', {
    schema: { body: updateProfileSchema },
  }, async (req, reply) => {
    const authUser = req.authUser;
    if (!authUser) {
      return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Not authenticated.' });
    }

    const body = req.body;
    const data: Record<string, unknown> = {};

    if ('displayName' in body) {
      data.displayName = typeof body.displayName === 'string' ? body.displayName.trim() || null : null;
    }
    if ('username' in body) {
      data.username = body.username ? body.username.trim().toLowerCase() : null;
    }
    if ('email' in body && body.email) {
      data.email = body.email.trim().toLowerCase();
    }

    if (Object.keys(data).length === 0) {
      return reply.code(400).send({ error: 'NO_FIELDS', message: 'No fields to update.' });
    }

    try {
      const updatedUser = await prisma.user.update({
        where: { id: authUser.id },
        data,
      });
      return reply.send({ user: toPublicUser(updatedUser) });
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
        return reply.code(409).send({ error: 'CONFLICT', message: 'Email or username already in use.' });
      }
      throw err;
    }
  });

  fastify.patch<{ Body: ChangePasswordBody }>('/api/auth/me/password', {
    schema: { body: changePasswordSchema },
  }, async (req, reply) => {
    if (isAuthDisabled()) {
      return reply.code(403).send({ error: 'AUTH_DISABLED', message: 'Password change is not available when authentication is disabled.' });
    }

    const authUser = req.authUser;
    if (!authUser) {
      return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Not authenticated.' });
    }

    const user = await prisma.user.findUnique({ where: { id: authUser.id } });
    if (!user) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'User not found.' });
    }

    const valid = await verifyPassword(req.body.currentPassword, user.passwordHash);
    if (!valid) {
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: 'Current password is incorrect.' });
    }

    const newHash = await hashPassword(req.body.newPassword);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });

    return reply.code(204).send();
  });
}
