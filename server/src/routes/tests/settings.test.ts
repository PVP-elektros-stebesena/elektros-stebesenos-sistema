import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { settingsRoutes } from '../settings.js';
import prisma from '../../lib/prisma.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.register(settingsRoutes);
  await app.ready();
});

afterAll(async () => {
  await prisma.device.deleteMany();
  await prisma.$disconnect();
  await app.close();
});

beforeEach(async () => {
  await prisma.device.deleteMany();
});

// ── Helpers ────────────────────────────────────────────────

function inject(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    ...(payload ? { payload: payload as Record<string, unknown> } : {}),
  });
}

async function seedDevice(overrides: Record<string, unknown> = {}) {
  return prisma.device.create({
    data: { name: 'Test device', ...overrides },
  });
}

// ── POST /api/settings ────────────────────────────────────

describe('POST /api/settings', () => {
  it('creates a device with all fields', async () => {
    const body = {
      name: 'My meter',
      deviceIp: '192.168.1.100',
      mqttBroker: '192.168.1.10',
      mqttPort: 1883,
      mqttTopic: 'energy/p1',
      pollInterval: 5,
      isActive: false,
    };

    const res = await inject('POST', '/api/settings', body);
    const json = res.json();

    expect(res.statusCode).toBe(201);
    expect(json.id).toBeTypeOf('number');
    expect(json.name).toBe('My meter');
    expect(json.deviceIp).toBe('192.168.1.100');
    expect(json.mqttBroker).toBe('192.168.1.10');
    expect(json.mqttPort).toBe(1883);
    expect(json.mqttTopic).toBe('energy/p1');
    expect(json.pollInterval).toBe(5);
    expect(json.isActive).toBe(false);
    expect(json.createdAt).toBeDefined();
  });

  it('creates a device with only required field (name)', async () => {
    const res = await inject('POST', '/api/settings', { name: 'Minimal' });
    const json = res.json();

    expect(res.statusCode).toBe(201);
    expect(json.name).toBe('Minimal');
    expect(json.pollInterval).toBe(10); // default
    expect(json.isActive).toBe(true);   // default
  });

  it('returns 400 when name is missing', async () => {
    const res = await inject('POST', '/api/settings', {});
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION');
  });

  it('returns 400 when name is empty string', async () => {
    const res = await inject('POST', '/api/settings', { name: '   ' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION');
  });

  it('returns 400 for invalid mqttPort', async () => {
    const res = await inject('POST', '/api/settings', { name: 'X', mqttPort: 99999 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION');
  });

  it('returns 400 for invalid pollInterval', async () => {
    const res = await inject('POST', '/api/settings', { name: 'X', pollInterval: -1 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION');
  });
});

// ── GET /api/settings ─────────────────────────────────────

describe('GET /api/settings', () => {
  it('returns empty array when no devices exist', async () => {
    const res = await inject('GET', '/api/settings');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns all devices ordered by newest first', async () => {
    await seedDevice({ name: 'First' });
    await seedDevice({ name: 'Second' });

    const res = await inject('GET', '/api/settings');
    const json = res.json();

    expect(res.statusCode).toBe(200);
    expect(json).toHaveLength(2);
    expect(json[0].name).toBe('Second');
    expect(json[1].name).toBe('First');
  });
});

// ── GET /api/settings/:id ─────────────────────────────────

describe('GET /api/settings/:id', () => {
  it('returns a device by id', async () => {
    const device = await seedDevice({ name: 'Found' });

    const res = await inject('GET', `/api/settings/${device.id}`);
    const json = res.json();

    expect(res.statusCode).toBe(200);
    expect(json.id).toBe(device.id);
    expect(json.name).toBe('Found');
  });

  it('returns 404 for non-existent id', async () => {
    const res = await inject('GET', '/api/settings/999999');
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NOT_FOUND');
  });

  it('returns 400 for non-numeric id', async () => {
    const res = await inject('GET', '/api/settings/abc');
    expect(res.statusCode).toBe(400);
  });
});

// ── PATCH /api/settings/:id ───────────────────────────────

describe('PATCH /api/settings/:id', () => {
  it('updates only provided fields', async () => {
    const device = await seedDevice({ name: 'Before', pollInterval: 10 });

    const res = await inject('PATCH', `/api/settings/${device.id}`, {
      name: 'After',
      pollInterval: 30,
    });
    const json = res.json();

    expect(res.statusCode).toBe(200);
    expect(json.name).toBe('After');
    expect(json.pollInterval).toBe(30);
    // untouched fields stay the same
    expect(json.isActive).toBe(true);
  });

  it('allows setting nullable fields to null', async () => {
    const device = await seedDevice({ name: 'Dev', mqttBroker: '10.0.0.1' });

    const res = await inject('PATCH', `/api/settings/${device.id}`, { mqttBroker: null });
    expect(res.statusCode).toBe(200);
    expect(res.json().mqttBroker).toBeNull();
  });

  it('returns 404 for non-existent device', async () => {
    const res = await inject('PATCH', '/api/settings/999999', { name: 'Nope' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when no fields to update', async () => {
    const device = await seedDevice();

    const res = await inject('PATCH', `/api/settings/${device.id}`, {});
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION');
  });

  it('returns 400 for invalid name', async () => {
    const device = await seedDevice();

    const res = await inject('PATCH', `/api/settings/${device.id}`, { name: '' });
    expect(res.statusCode).toBe(400);
  });
});

// ── DELETE /api/settings/:id ──────────────────────────────

describe('DELETE /api/settings/:id', () => {
  it('deletes a device and returns 204', async () => {
    const device = await seedDevice();

    const res = await inject('DELETE', `/api/settings/${device.id}`);
    expect(res.statusCode).toBe(204);

    // confirm gone
    const check = await prisma.device.findUnique({ where: { id: device.id } });
    expect(check).toBeNull();
  });

  it('returns 404 for non-existent device', async () => {
    const res = await inject('DELETE', '/api/settings/999999');
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for non-numeric id', async () => {
    const res = await inject('DELETE', '/api/settings/abc');
    expect(res.statusCode).toBe(400);
  });
});
