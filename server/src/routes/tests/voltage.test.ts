import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { voltageRoutes } from '../voltage.js';
import { voltageState } from '../../services/voltageState.js';
import type { VoltageReading } from '../../services/voltageAnalysis.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.register(voltageRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

function injectGet(url: string) {
  return app.inject({ method: 'GET', url });
}

describe('GET /api/voltage/latest', () => {
  it('returns 503 when no data exists', async () => {
    voltageState.reset();

    const res = await injectGet('/api/voltage/latest');
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('NO_DATA');
  });

  it('returns latest reading with phase analysis after data is pushed', async () => {
    voltageState.reset();

    const reading: VoltageReading = {
      timestamp: new Date('2025-06-01T12:00:00Z'),
      voltage_l1: 232.5,
      voltage_l2: 228.0,
      voltage_l3: 241.0,
    };
    voltageState.pushReading(reading);

    const res = await injectGet('/api/voltage/latest');
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
    voltageState.reset();

    const base = new Date('2025-06-01T12:00:00Z');
    for (let i = 0; i < 10; i++) {
      voltageState.pushReading({
        timestamp: new Date(base.getTime() + i * 10_000),
        voltage_l1: 230 + i * 0.1,
        voltage_l2: 230,
        voltage_l3: 230,
      });
    }

    const res = await injectGet(
      '/api/voltage/history?from=2025-06-01T12:00:00Z&to=2025-06-01T12:02:00Z&interval=raw'
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
    voltageState.reset();

    const ws = new Date('2025-06-01T13:00:00Z');
    for (let i = 0; i < 60; i++) {
      voltageState.pushReading({
        timestamp: new Date(ws.getTime() + i * 10_000),
        voltage_l1: 231,
        voltage_l2: 229,
        voltage_l3: 230,
      });
    }
    // Trigger window close
    voltageState.pushReading({
      timestamp: new Date(ws.getTime() + 600_000),
      voltage_l1: 230,
      voltage_l2: 230,
      voltage_l3: 230,
    });

    const res = await injectGet(
      '/api/voltage/history?from=2025-06-01T13:00:00Z&to=2025-06-01T13:15:00Z&interval=10min'
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
    voltageState.reset();

    const base = new Date('2025-06-01T12:00:00Z');
    for (let i = 0; i < 100; i++) {
      voltageState.pushReading({
        timestamp: new Date(base.getTime() + i * 10_000),
        voltage_l1: 230,
        voltage_l2: 230,
        voltage_l3: 230,
      });
    }

    const res = await injectGet(
      '/api/voltage/history?from=2025-06-01T12:00:00Z&to=2025-06-01T14:00:00Z&points=5'
    );
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.count).toBeLessThanOrEqual(7);
  });
});

describe('GET /api/voltage/anomalies', () => {
  it('returns anomalies list', async () => {
    voltageState.reset();

    voltageState.pushReading({
      timestamp: new Date('2025-06-01T15:00:00Z'),
      voltage_l1: 250,
      voltage_l2: 230,
      voltage_l3: 230,
    });
    voltageState.pushReading({
      timestamp: new Date('2025-06-01T15:00:10Z'),
      voltage_l1: 230,
      voltage_l2: 230,
      voltage_l3: 230,
    });

    const res = await injectGet('/api/voltage/anomalies');
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.count).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty('type');
    expect(body.data[0]).toHaveProperty('phase');
    expect(body.data[0]).toHaveProperty('startedAt');
  });

  it('filters by type', async () => {
    const res = await injectGet('/api/voltage/anomalies?type=VOLTAGE_DEVIATION');
    const body = res.json();

    expect(res.statusCode).toBe(200);
    for (const a of body.data) {
      expect(a.type).toBe('VOLTAGE_DEVIATION');
    }
  });

  it('filters by phase', async () => {
    const res = await injectGet('/api/voltage/anomalies?phase=L1');
    const body = res.json();

    expect(res.statusCode).toBe(200);
    for (const a of body.data) {
      expect(a.phase).toBe('L1');
    }
  });
});

describe('GET /api/voltage/anomalies/active', () => {
  it('returns currently active anomalies', async () => {
    voltageState.reset();

    const res = await injectGet('/api/voltage/anomalies/active');
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
    voltageState.reset();

    const res = await injectGet('/api/voltage/compliance/weekly');
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
    voltageState.reset();

    voltageState.pushReading({
      timestamp: new Date(),
      voltage_l1: 230,
      voltage_l2: 230,
      voltage_l3: 230,
    });

    const res = await injectGet('/api/voltage/summary');
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