import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { authRoutes, requireAuthentication } from '../auth.js';
import { settingsRoutes } from '../settings.js';
import prisma from '../../lib/prisma.js';
import { hashPassword } from '../../services/authService.js';

let app: FastifyInstance;
const originalDisableAuth = process.env.DISABLE_AUTH;
const originalNodeEnv = process.env.NODE_ENV;

beforeAll(async () => {
  app = Fastify();
  app.register(authRoutes);
  app.addHook('onRequest', requireAuthentication);
  app.register(settingsRoutes);
  app.get('/api/protected', async () => ({ ok: true }));
  await app.ready();
});

afterAll(async () => {
  process.env.DISABLE_AUTH = originalDisableAuth;
  process.env.NODE_ENV = originalNodeEnv;
  await prisma.authSession.deleteMany();
  await prisma.device.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
  await app.close();
});

beforeEach(async () => {
  process.env.DISABLE_AUTH = 'false';
  process.env.NODE_ENV = 'test';
  await prisma.authSession.deleteMany();
  await prisma.device.deleteMany();
  await prisma.user.deleteMany();
});

describe('authentication routes', () => {
  it('reports setup required when no users exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/status' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ setupRequired: true });
  });

  it('creates the first user with a hashed password and starts a session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: {
        email: 'Admin@Example.com',
        displayName: 'Admin',
        password: 'correct horse battery staple',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().token).toBeTypeOf('string');
    expect(res.json().user.email).toBe('admin@example.com');

    const user = await prisma.user.findUnique({ where: { email: 'admin@example.com' } });
    expect(user?.passwordHash).toContain('scrypt:');
    expect(user?.passwordHash).not.toContain('correct horse battery staple');
  });

  it('rejects invalid credentials', async () => {
    await prisma.user.create({
      data: {
        email: 'admin@example.com',
        passwordHash: await hashPassword('valid-password'),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        identifier: 'admin@example.com',
        password: 'wrong-password',
      },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('INVALID_CREDENTIALS');
  });

  it('allows valid users to access protected routes until logout', async () => {
    await prisma.user.create({
      data: {
        email: 'admin@example.com',
        passwordHash: await hashPassword('valid-password'),
      },
    });

    const denied = await app.inject({ method: 'GET', url: '/api/protected' });
    expect(denied.statusCode).toBe(401);

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        identifier: 'admin@example.com',
        password: 'valid-password',
      },
    });

    expect(loginRes.statusCode).toBe(200);
    const token = loginRes.json().token;

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({ ok: true });

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logout.statusCode).toBe(204);

    const deniedAfterLogout = await app.inject({
      method: 'GET',
      url: '/api/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deniedAfterLogout.statusCode).toBe(401);
  });

  it('links newly created devices to the authenticated user', async () => {
    const user = await prisma.user.create({
      data: {
        email: 'owner@example.com',
        passwordHash: await hashPassword('valid-password'),
      },
    });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        identifier: user.email,
        password: 'valid-password',
      },
    });
    const token = loginRes.json().token;

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Owned meter' },
    });

    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().userId).toBe(user.id);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(listRes.statusCode).toBe(200);
    expect(listRes.json()).toHaveLength(1);
    expect(listRes.json()[0].name).toBe('Owned meter');
  });

  it('claims existing unowned devices when the first user is created', async () => {
    const device = await prisma.device.create({
      data: {
        name: 'Local dev device',
      },
    });

    const setupRes = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: {
        email: 'admin@example.com',
        displayName: 'Admin',
        password: 'correct horse battery staple',
      },
    });

    expect(setupRes.statusCode).toBe(201);
    expect(setupRes.json().user.email).toBe('admin@example.com');

    const updatedDevice = await prisma.device.findUnique({
      where: { id: device.id },
    });

    expect(updatedDevice?.userId).toBe(setupRes.json().user.id);
  });

  it('allows the auth bypass only outside production and test', async () => {
    process.env.NODE_ENV = 'development';
    process.env.DISABLE_AUTH = 'true';

    const statusRes = await app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json()).toEqual({
      setupRequired: false,
      authDisabled: true,
    });

    const allowed = await app.inject({ method: 'GET', url: '/api/protected' });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({ ok: true });

    const meRes = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().user.id).toBeGreaterThan(0);
    expect(meRes.json().user.email).toBe('local-dev@example.com');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/settings',
      payload: { name: 'Bypass-owned meter' },
    });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().userId).toBe(meRes.json().user.id);

    const renterRes = await app.inject({
      method: 'POST',
      url: '/api/settings/renters',
      payload: { name: 'Bypass renter' },
    });
    expect(renterRes.statusCode).toBe(201);
    expect(renterRes.json().landlordUserId).toBe(meRes.json().user.id);
  });

  it('ignores the auth bypass in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DISABLE_AUTH = 'true';

    const denied = await app.inject({ method: 'GET', url: '/api/protected' });
    expect(denied.statusCode).toBe(401);

    const statusRes = await app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json()).toEqual({ setupRequired: true });
  });
});
