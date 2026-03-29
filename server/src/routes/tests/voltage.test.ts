import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { voltageRoutes } from '../voltage.js';
import prisma from '../../lib/prisma.js';

let app: FastifyInstance;

// Each test gets its own device to avoid conflicts with parallel settings tests
let testDeviceId: number;

beforeAll(async () => {
  app = Fastify();
  app.register(voltageRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

// Create a fresh device before each test so parallel deleteMany() in settings tests can't break us
beforeEach(async () => {
  const device = await prisma.device.create({
    data: { name: 'VoltageTestDevice', pollInterval: 10, isActive: true },
  });
  testDeviceId = device.id;
});

afterEach(async () => {
  // Clean up in correct order; use deleteMany to avoid "not found" errors
  await prisma.anomaly.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.aggregatedData.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.reading.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.device.deleteMany({ where: { id: testDeviceId } });
});

function injectGet(url: string) {
  return app.inject({ method: 'GET', url });
}

describe('GET /api/voltage/latest', () => {
  it('returns 503 when no data exists', async () => {
    const res = await injectGet(`/api/voltage/latest?deviceId=${testDeviceId}`);
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('NO_DATA');
  });

  it('returns latest reading with phase analysis after data is pushed', async () => {
    await prisma.reading.create({
      data: {
        deviceId: testDeviceId,
        timestamp: new Date('2025-06-01T12:00:00Z'),
        voltageL1: 232.5,
        voltageL2: 228.0,
        voltageL3: 241.0,
      },
    });

    const res = await injectGet(`/api/voltage/latest?deviceId=${testDeviceId}`);
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.timestamp).toBe('2025-06-01T12:00:00.000Z');
    expect(body.phases).toHaveLength(3);

    expect(body.phases[0].phase).toBe('L1');
    expect(body.phases[0].inBounds).toBe(true);
    expect(body.phases[0].deviation).toBeCloseTo(2.5);

    expect(body.phases[2].phase).toBe('L3');
    expect(body.phases[2].inBounds).toBe(false);

    expect(body.bounds.nominal).toBe(230);
    expect(body.bounds.min).toBe(220);
    expect(body.bounds.max).toBe(240);
  });
});

describe('GET /api/voltage/history', () => {
  it('returns raw readings within time range', async () => {
    const base = new Date('2025-06-01T12:00:00Z');
    for (let i = 0; i < 10; i++) {
      await prisma.reading.create({
        data: {
          deviceId: testDeviceId,
          timestamp: new Date(base.getTime() + i * 10_000),
          voltageL1: 230 + i * 0.1,
          voltageL2: 230,
          voltageL3: 230,
        },
      });
    }

    const res = await injectGet(
      `/api/voltage/history?deviceId=${testDeviceId}&from=2025-06-01T12:00:00Z&to=2025-06-01T12:02:00Z&interval=raw`
    );
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.interval).toBe('raw');
    expect(body.count).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty('voltage_l1');
    expect(body.data[0]).toHaveProperty('voltage_l2');
    expect(body.data[0]).toHaveProperty('voltage_l3');
    expect(body.data[0]).toHaveProperty('timestamp');
    expect(body.bounds).toBeDefined();
  });

  it('returns 400 for invalid range (from >= to)', async () => {
    const res = await injectGet(
      '/api/voltage/history?from=2025-06-02T00:00:00Z&to=2025-06-01T00:00:00Z'
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_RANGE');
  });

  it('returns 10min aggregated windows', async () => {
    const ws = new Date('2025-06-01T13:00:00Z');
    const we = new Date('2025-06-01T13:10:00Z');

    await prisma.aggregatedData.create({
      data: {
        deviceId: testDeviceId,
        startsAt: ws,
        endsAt: we,
        voltageL1: 231,
        voltageL2: 229,
        voltageL3: 230,
        sampleCount: 60,
        compliantL1: true,
        compliantL2: true,
        compliantL3: true,
        outOfBoundsSecondsL1: 0,
        outOfBoundsSecondsL2: 0,
        outOfBoundsSecondsL3: 0,
      },
    });

    const res = await injectGet(
      `/api/voltage/history?deviceId=${testDeviceId}&from=2025-06-01T13:00:00Z&to=2025-06-01T13:15:00Z&interval=10min`
    );
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.interval).toBe('10min');
    expect(body.count).toBeGreaterThanOrEqual(1);

    const win = body.data[0];
    expect(win).toHaveProperty('voltage_l1');
    expect(win).toHaveProperty('compliant_l1');
    expect(win).toHaveProperty('sampleCount');
  });

  it('respects points parameter for downsampling', async () => {
    const base = new Date('2025-06-01T12:00:00Z');
    for (let i = 0; i < 100; i++) {
      await prisma.reading.create({
        data: {
          deviceId: testDeviceId,
          timestamp: new Date(base.getTime() + i * 10_000),
          voltageL1: 230,
          voltageL2: 230,
          voltageL3: 230,
        },
      });
    }

    const res = await injectGet(
      `/api/voltage/history?deviceId=${testDeviceId}&from=2025-06-01T12:00:00Z&to=2025-06-01T14:00:00Z&points=5`
    );
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.count).toBe(5);
  });
});

describe('GET /api/voltage/anomalies', () => {
  it('returns anomalies list', async () => {
    await prisma.anomaly.create({
      data: {
        deviceId: testDeviceId,
        startsAt: new Date('2025-06-01T15:00:00Z'),
        endsAt: new Date('2025-06-01T15:00:10Z'),
        phase: 'L1',
        type: 'VOLTAGE_DEVIATION',
        severity: 1,
        minVoltage: 250,
        maxVoltage: 250,
        duration: 10,
      },
    });

    const res = await injectGet(`/api/voltage/anomalies?deviceId=${testDeviceId}`);
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.count).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty('type');
    expect(body.data[0]).toHaveProperty('phase');
    expect(body.data[0]).toHaveProperty('startsAt');
  });

  it('filters by type', async () => {
    await prisma.anomaly.create({
      data: {
        deviceId: testDeviceId,
        startsAt: new Date('2025-06-01T15:00:00Z'),
        endsAt: new Date('2025-06-01T15:00:10Z'),
        phase: 'L1',
        type: 'VOLTAGE_DEVIATION',
        severity: 1,
      },
    });

    const res = await injectGet(`/api/voltage/anomalies?deviceId=${testDeviceId}&type=VOLTAGE_DEVIATION`);
    const body = res.json();

    expect(res.statusCode).toBe(200);
    for (const a of body.data) {
      expect(a.type).toBe('VOLTAGE_DEVIATION');
    }
  });

  it('filters by phase', async () => {
    await prisma.anomaly.create({
      data: {
        deviceId: testDeviceId,
        startsAt: new Date('2025-06-01T15:00:00Z'),
        endsAt: new Date('2025-06-01T15:00:10Z'),
        phase: 'L1',
        type: 'VOLTAGE_DEVIATION',
        severity: 1,
      },
    });

    const res = await injectGet(`/api/voltage/anomalies?deviceId=${testDeviceId}&phase=L1`);
    const body = res.json();

    expect(res.statusCode).toBe(200);
    for (const a of body.data) {
      expect(a.phase).toBe('L1');
    }
  });

  it('applies both from and to bounds together', async () => {
    await prisma.anomaly.createMany({
      data: [
        {
          deviceId: testDeviceId,
          startsAt: new Date('2025-06-01T14:59:00Z'),
          endsAt: new Date('2025-06-01T14:59:10Z'),
          phase: 'L1',
          type: 'VOLTAGE_DEVIATION',
          severity: 1,
        },
        {
          deviceId: testDeviceId,
          startsAt: new Date('2025-06-01T15:30:00Z'),
          endsAt: new Date('2025-06-01T15:30:10Z'),
          phase: 'L1',
          type: 'VOLTAGE_DEVIATION',
          severity: 1,
        },
        {
          deviceId: testDeviceId,
          startsAt: new Date('2025-06-01T16:01:00Z'),
          endsAt: new Date('2025-06-01T16:01:10Z'),
          phase: 'L1',
          type: 'VOLTAGE_DEVIATION',
          severity: 1,
        },
      ],
    });

    const res = await injectGet(
      `/api/voltage/anomalies?deviceId=${testDeviceId}&from=2025-06-01T15:00:00Z&to=2025-06-01T16:00:00Z`,
    );
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.count).toBe(1);
    expect(body.data[0].startsAt).toBe('2025-06-01T15:30:00.000Z');
  });
});

describe('GET /api/voltage/anomalies/active', () => {
  it('returns currently active anomalies', async () => {
    const res = await injectGet(`/api/voltage/anomalies/active?deviceId=${testDeviceId}`);
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body).toHaveProperty('count');
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.count).toBe(0);
  });
});

describe('GET /api/voltage/compliance/weekly', () => {
  it('returns weekly compliance report', async () => {
    const res = await injectGet(`/api/voltage/compliance/weekly?deviceId=${testDeviceId}`);
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body).toHaveProperty('weekStart');
    expect(body).toHaveProperty('weekEnd');
    expect(body).toHaveProperty('totalWindows');
    expect(body).toHaveProperty('compliancePctL1');
    expect(body).toHaveProperty('overallCompliant');
    expect(body.eso_threshold_pct).toBe(95);
    expect(body.window_duration_minutes).toBe(10);
  });

  it('accepts date parameter', async () => {
    const res = await injectGet('/api/voltage/compliance/weekly?date=2025-01-15');
    const body = res.json();

    expect(res.statusCode).toBe(200);
    const weekStart = new Date(body.weekStart);
    expect(weekStart.getDay()).toBe(1);
    expect(weekStart.getDate()).toBe(13);
    expect(weekStart.getMonth()).toBe(0);
  });
});

describe('GET /api/voltage/summary', () => {
  it('returns dashboard summary', async () => {
    await prisma.reading.create({
      data: {
        deviceId: testDeviceId,
        timestamp: new Date(),
        voltageL1: 230,
        voltageL2: 230,
        voltageL3: 230,
      },
    });

    const res = await injectGet(`/api/voltage/summary?deviceId=${testDeviceId}`);
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.has_data).toBe(true);
    expect(body).toHaveProperty('stats');
    expect(body.stats).toHaveProperty('totalReadings');
    expect(body.stats).toHaveProperty('totalWindows');
    expect(body.stats).toHaveProperty('totalAnomalies');
    expect(body.stats).toHaveProperty('activeAnomalies');
    expect(body).toHaveProperty('weekly_compliance');
    expect(body).toHaveProperty('bounds');
    expect(body.bounds.nominal).toBe(230);
  });
});