import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  authenticateToken,
  createFirstUser,
  isSetupRequired,
  login,
  revokeSession,
} from '../services/authService.js';

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

function getBearerToken(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;

  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

export async function requireAuthentication(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (req.method === 'OPTIONS') return;
  if (!req.url.startsWith('/api/')) return;
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
    return reply.send({ setupRequired: await isSetupRequired() });
  });

  fastify.post<{ Body: SetupBody }>('/api/auth/setup', {
    schema: { body: setupSchema },
  }, async (req, reply) => {
    const result = await createFirstUser({
      ...req.body,
      userAgent: req.headers['user-agent'],
    });

    if (!result) {
      return reply.code(409).send({
        error: 'SETUP_COMPLETE',
        message: 'The first user has already been created.',
      });
    }

    return reply.code(201).send(result);
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
    await revokeSession(getBearerToken(req));
    return reply.code(204).send();
  });
}
