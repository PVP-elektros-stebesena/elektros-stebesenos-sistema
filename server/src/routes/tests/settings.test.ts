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
  await prisma.billingPlan.deleteMany();
  await prisma.spotPrice.deleteMany();
  await prisma.device.deleteMany();
  await prisma.$disconnect();
  await app.close();
});

beforeEach(async () => {
  await prisma.anomaly.deleteMany();
  await prisma.aggregatedData.deleteMany();
  await prisma.reading.deleteMany();
  await prisma.powerPolicyOverride.deleteMany();
  await prisma.billingPlan.deleteMany();
  await prisma.spotPrice.deleteMany();
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
      powerProfile: 'COMMERCIAL_3P_30KW',
      pollInterval: 5,
      isActive: false,
      notifySolarExportOpportunity: false,
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
    expect(json.powerProfile).toBe('COMMERCIAL_3P_30KW');
    expect(json.pollInterval).toBe(5);
    expect(json.isActive).toBe(false);
    expect(json.notifySolarExportOpportunity).toBe(false);
    expect(json.createdAt).toBeDefined();

    const override = await prisma.powerPolicyOverride.findFirst({
      where: { deviceId: json.id, enabled: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    expect(override?.policyVersion).toContain('preset-sync:commercial_3p_30kw');
    expect(override?.maxActivePowerKw).toBe(30);
  });

  it('includes solar export opportunity in notification settings', async () => {
    const device = await seedDevice({ name: 'Solar settings device' });

    const settingsRes = await inject('GET', `/api/settings/${device.id}/notifications`);
    expect(settingsRes.statusCode).toBe(200);
    expect(settingsRes.json().availableEvents).toContain('EXPORT_OPPORTUNITY');

    const saveRes = await inject('PATCH', `/api/settings/${device.id}/notifications`, {
      notificationsEnabled: true,
      selectedEvents: ['EXPORT_OPPORTUNITY'],
    });
    expect(saveRes.statusCode).toBe(200);
    expect(saveRes.json().selectedEvents).toEqual(['EXPORT_OPPORTUNITY']);
  });

  it('creates a device with only required field (name)', async () => {
    const res = await inject('POST', '/api/settings', { name: 'Minimal' });
    const json = res.json();

    expect(res.statusCode).toBe(201);
    expect(json.name).toBe('Minimal');
    expect(json.powerProfile).toBe('HOUSE_3P_11KW');
    expect(json.pollInterval).toBe(10); // default
    expect(json.isActive).toBe(true);   // default

    const override = await prisma.powerPolicyOverride.findFirst({
      where: { deviceId: json.id, enabled: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    expect(override?.policyVersion).toContain('preset-sync:house_3p_11kw');
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

  it('returns 400 for invalid powerProfile', async () => {
    const res = await inject('POST', '/api/settings', {
      name: 'X',
      powerProfile: 'INVALID_PROFILE',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION');
  });

  it('rejects commercial profiles below the minimum grid capacity', async () => {
    const res = await inject('POST', '/api/settings', {
      name: 'Commercial too low',
      powerProfile: 'COMMERCIAL_3P_30KW',
      maxGridCapacityKw: 20,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_GRID_CAPACITY');
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
      powerProfile: 'HOUSE_3P_18KW',
      pollInterval: 30,
    });
    const json = res.json();

    expect(res.statusCode).toBe(200);
    expect(json.name).toBe('After');
    expect(json.powerProfile).toBe('HOUSE_3P_18KW');
    expect(json.pollInterval).toBe(30);
    // untouched fields stay the same
    expect(json.isActive).toBe(true);

    const overrides = await prisma.powerPolicyOverride.findMany({
      where: { deviceId: device.id },
      orderBy: { effectiveFrom: 'asc' },
    });
    expect(overrides).toHaveLength(1);
    expect(overrides[0]?.enabled).toBe(true);
    expect(overrides[0]?.policyVersion).toContain('preset-sync:house_3p_18kw');
  });

  it('allows setting nullable fields to null', async () => {
    const device = await seedDevice({ name: 'Dev', mqttBroker: '10.0.0.1' });

    const res = await inject('PATCH', `/api/settings/${device.id}`, { mqttBroker: null });
    expect(res.statusCode).toBe(200);
    expect(res.json().mqttBroker).toBeNull();
  });

  it('disables the previous preset override when the power profile changes', async () => {
    const created = await inject('POST', '/api/settings', {
      name: 'Profile device',
      powerProfile: 'HOUSE_3P_11KW',
    });
    const device = created.json();

    const res = await inject('PATCH', `/api/settings/${device.id}`, {
      powerProfile: 'SOLAR_PROSUMER_3P_22KW',
    });

    expect(res.statusCode).toBe(200);

    const overrides = await prisma.powerPolicyOverride.findMany({
      where: { deviceId: device.id },
      orderBy: { effectiveFrom: 'asc' },
    });

    expect(overrides).toHaveLength(2);
    expect(overrides[0]?.enabled).toBe(false);
    expect(overrides[0]?.effectiveTo).not.toBeNull();
    expect(overrides[1]?.enabled).toBe(true);
    expect(overrides[1]?.policyVersion).toContain('preset-sync:solar_prosumer_3p_22kw');
    expect(overrides[1]?.maxActivePowerKw).toBe(22);
  });

  it('raises an existing custom capacity when switching to commercial profile', async () => {
    const device = await seedDevice({
      name: 'Small custom capacity',
      powerProfile: 'HOUSE_3P_11KW',
      maxGridCapacityKw: 18,
    });

    const res = await inject('PATCH', `/api/settings/${device.id}`, {
      powerProfile: 'COMMERCIAL_3P_30KW',
    });
    const json = res.json();

    expect(res.statusCode).toBe(200);
    expect(json.powerProfile).toBe('COMMERCIAL_3P_30KW');
    expect(json.maxGridCapacityKw).toBe(30);
  });

  it('preserves valid custom capacity when switching profiles', async () => {
    const device = await seedDevice({
      name: 'Large custom capacity',
      powerProfile: 'COMMERCIAL_3P_30KW',
      maxGridCapacityKw: 35,
    });

    const res = await inject('PATCH', `/api/settings/${device.id}`, {
      powerProfile: 'HOUSE_3P_18KW',
    });
    const json = res.json();

    expect(res.statusCode).toBe(200);
    expect(json.powerProfile).toBe('HOUSE_3P_18KW');
    expect(json.maxGridCapacityKw).toBe(35);
  });

  it('rejects commercial capacity updates below the minimum', async () => {
    const device = await seedDevice({
      name: 'Commercial update too low',
      powerProfile: 'COMMERCIAL_3P_30KW',
    });

    const res = await inject('PATCH', `/api/settings/${device.id}`, {
      maxGridCapacityKw: 20,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_GRID_CAPACITY');
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

  it('returns 400 for invalid powerProfile', async () => {
    const device = await seedDevice();

    const res = await inject('PATCH', `/api/settings/${device.id}`, {
      powerProfile: 'NOT_A_PROFILE',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION');
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

describe('billing plan routes', () => {
  it('saves a fixed billing plan and returns it in settings responses', async () => {
    const device = await seedDevice({ name: 'Billing device' });

    const saveRes = await app.inject({
      method: 'PUT',
      url: `/api/settings/${device.id}/billing-plan`,
      payload: {
        pricingMode: 'FIXED',
        effectiveFrom: '2026-04-01T00:00:00.000Z',
        fixedRates: {
          t1: 0.23,
          t2: 0.11,
          t3: null,
          t4: null,
        },
        monthlyFixedFeeEur: 12.5,
      },
    });

    expect(saveRes.statusCode).toBe(200);
    expect(saveRes.json().activePlan.pricingMode).toBe('FIXED');
    expect(saveRes.json().activePlan.fixedRates.t1).toBe(0.23);

    const listRes = await inject('GET', '/api/settings');
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json()[0].billingPlan.pricingMode).toBe('FIXED');

    const detailRes = await inject('GET', `/api/settings/${device.id}/billing-plan`);
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json().activePlan.monthlyFixedFeeEur).toBe(12.5);
    expect(detailRes.json().history).toHaveLength(1);
  });

  it('closes the previous billing plan version when a newer plan is saved', async () => {
    const device = await seedDevice({ name: 'Versioned billing device' });

    await app.inject({
      method: 'PUT',
      url: `/api/settings/${device.id}/billing-plan`,
      payload: {
        pricingMode: 'FIXED',
        effectiveFrom: '2026-04-01T00:00:00.000Z',
        fixedRates: {
          t1: 0.2,
          t2: null,
          t3: null,
          t4: null,
        },
        monthlyFixedFeeEur: null,
      },
    });

    const secondSave = await app.inject({
      method: 'PUT',
      url: `/api/settings/${device.id}/billing-plan`,
      payload: {
        pricingMode: 'DYNAMIC',
        effectiveFrom: '2026-04-15T00:00:00.000Z',
        dynamic: {
          provider: 'ELERING',
          zone: 'LT',
          spotAdderEurPerKwh: 0.04,
        },
        monthlyFixedFeeEur: 8,
      },
    });

    expect(secondSave.statusCode).toBe(200);
    expect(secondSave.json().billingPlan.pricingMode).toBe('DYNAMIC');

    const historyRes = await inject('GET', `/api/settings/${device.id}/billing-plan`);
    const historyJson = historyRes.json();

    expect(historyRes.statusCode).toBe(200);
    expect(historyJson.history).toHaveLength(2);
    expect(historyJson.history[0].pricingMode).toBe('DYNAMIC');
    expect(historyJson.history[1].pricingMode).toBe('FIXED');
    expect(historyJson.history[1].effectiveTo).toBe('2026-04-15T00:00:00.000Z');
  });

  it('rejects negative billing plan values', async () => {
    const device = await seedDevice({ name: 'Billing validation device' });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/settings/${device.id}/billing-plan`,
      payload: {
        pricingMode: 'FIXED',
        effectiveFrom: '2026-04-01T00:00:00.000Z',
        fixedRates: {
          t1: -0.1,
          t2: null,
          t3: null,
          t4: null,
        },
        monthlyFixedFeeEur: -5,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION');
  });
});
