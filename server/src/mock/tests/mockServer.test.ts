import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { SCENARIOS, SCENARIO_NAMES, type ScenarioName } from '../scenarios.js';
import { toP1Response } from '../p1Response.js';

/**
 * Integration tests for the mock server endpoints.
 * Rebuild the routes inline (same logic as mockServer.ts)
 * to avoid starting a real server process.
 */

let app: FastifyInstance;

// Inline state (mirrors mockServer.ts)
let activeScenario = SCENARIOS['normal'];
let tickIndex = 0;
let customOverride: ReturnType<typeof SCENARIOS['normal']['generate']> | null = null;

function getCurrentOutput() {
  if (customOverride) return customOverride;
  const output = activeScenario.generate(tickIndex);
  tickIndex++;
  return output;
}

beforeAll(async () => {
  app = Fastify();
  await app.register(cors, { origin: '*' });

  app.get('/smartmeter/api/read', async () => toP1Response(getCurrentOutput()));

  app.get('/mock/scenarios', async () =>
    SCENARIO_NAMES.map((name) => ({
      name,
      description: SCENARIOS[name].description,
    }))
  );

  app.get('/mock/status', async () => ({
    scenario: activeScenario.name,
    tickIndex,
    hasCustomOverride: customOverride !== null,
  }));

  app.post<{ Body: { scenario: ScenarioName } }>('/mock/scenario', async (req, reply) => {
    const { scenario } = req.body;
    if (!SCENARIOS[scenario]) {
      return reply.code(400).send({ error: 'INVALID_SCENARIO' });
    }
    activeScenario = SCENARIOS[scenario];
    tickIndex = 0;
    customOverride = null;
    return { message: `Switched to ${scenario}` };
  });

  app.post<{ Body: { voltage_l1: number; voltage_l2: number; voltage_l3: number } }>(
    '/mock/custom',
    async (req) => {
      const { voltage_l1, voltage_l2, voltage_l3 } = req.body;
      customOverride = {
        l1: { voltage: voltage_l1, current: 5, powerDelivered: voltage_l1 * 5 / 1000, powerReturned: 0 },
        l2: { voltage: voltage_l2, current: 5, powerDelivered: voltage_l2 * 5 / 1000, powerReturned: 0 },
        l3: { voltage: voltage_l3, current: 5, powerDelivered: voltage_l3 * 5 / 1000, powerReturned: 0 },
        frequency: 50,
      };
      return { message: 'Custom set' };
    }
  );

  app.post('/mock/reset', async () => {
    activeScenario = SCENARIOS['normal'];
    tickIndex = 0;
    customOverride = null;
    return { message: 'Reset' };
  });

  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  // Reset state before each test
  activeScenario = SCENARIOS['normal'];
  tickIndex = 0;
  customOverride = null;
});

function inject(method: 'GET' | 'POST', url: string, body?: object) {
  return app.inject({
    method,
    url,
    ...(body && {
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify(body),
    }),
  });
}

describe('GET /smartmeter/api/read', () => {
  it('returns a valid P1 response with string values', async () => {
    const res = await inject('GET', '/smartmeter/api/read');
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.InstantaneousVoltageL1).toBeDefined();
    expect(body.Voltage_l1).toBeDefined();
    expect(body.Frequency).toBeDefined();
    expect(typeof body.InstantaneousVoltageL1).toBe('string');
  });

  it('increments tick on each call', async () => {
    await inject('GET', '/smartmeter/api/read');
    await inject('GET', '/smartmeter/api/read');
    const statusRes = await inject('GET', '/mock/status');
    expect(statusRes.json().tickIndex).toBe(2);
  });

  it('returns normal voltage values by default', async () => {
    const res = await inject('GET', '/smartmeter/api/read');
    const v = parseFloat(res.json().InstantaneousVoltageL1);
    expect(v).toBeGreaterThan(225);
    expect(v).toBeLessThan(235);
  });
});

describe('GET /mock/scenarios', () => {
  it('lists all available scenarios', async () => {
    const res = await inject('GET', '/mock/scenarios');
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(SCENARIO_NAMES.length);

    const names = body.map((s: { name: string }) => s.name);
    expect(names).toContain('normal');
    expect(names).toContain('voltage-sag');
    expect(names).toContain('long-interruption');
  });
});

describe('POST /mock/scenario', () => {
  it('switches to a valid scenario', async () => {
    const res = await inject('POST', '/mock/scenario', { scenario: 'voltage-sag' });
    expect(res.statusCode).toBe(200);

    const statusRes = await inject('GET', '/mock/status');
    expect(statusRes.json().scenario).toBe('voltage-sag');
  });

  it('resets tick index on switch', async () => {
    // Advance ticks
    await inject('GET', '/smartmeter/api/read');
    await inject('GET', '/smartmeter/api/read');

    // Switch scenario
    await inject('POST', '/mock/scenario', { scenario: 'voltage-swell' });

    const statusRes = await inject('GET', '/mock/status');
    expect(statusRes.json().tickIndex).toBe(0);
  });

  it('rejects invalid scenario', async () => {
    const res = await inject('POST', '/mock/scenario', { scenario: 'nonexistent' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_SCENARIO');
  });

  it('voltage-sag produces low voltage readings', async () => {
    await inject('POST', '/mock/scenario', { scenario: 'voltage-sag' });

    const res = await inject('GET', '/smartmeter/api/read');
    const v = parseFloat(res.json().InstantaneousVoltageL1);
    expect(v).toBeLessThan(220);
  });

  it('long-interruption produces zero voltage', async () => {
    await inject('POST', '/mock/scenario', { scenario: 'long-interruption' });

    const res = await inject('GET', '/smartmeter/api/read');
    const v = parseFloat(res.json().InstantaneousVoltageL1);
    expect(v).toBe(0);
  });
});

describe('POST /mock/custom', () => {
  it('sets custom fixed voltages', async () => {
    await inject('POST', '/mock/custom', {
      voltage_l1: 250,
      voltage_l2: 210,
      voltage_l3: 0,
    });

    const res = await inject('GET', '/smartmeter/api/read');
    const body = res.json();

    expect(parseFloat(body.InstantaneousVoltageL1)).toBe(250);
    expect(parseFloat(body.InstantaneousVoltageL2)).toBe(210);
    expect(parseFloat(body.InstantaneousVoltageL3)).toBe(0);
  });

  it('custom override persists across reads', async () => {
    await inject('POST', '/mock/custom', {
      voltage_l1: 245,
      voltage_l2: 245,
      voltage_l3: 245,
    });

    const r1 = await inject('GET', '/smartmeter/api/read');
    const r2 = await inject('GET', '/smartmeter/api/read');

    expect(parseFloat(r1.json().InstantaneousVoltageL1)).toBe(245);
    expect(parseFloat(r2.json().InstantaneousVoltageL1)).toBe(245);
  });
});

describe('POST /mock/reset', () => {
  it('resets to normal scenario', async () => {
    await inject('POST', '/mock/scenario', { scenario: 'long-interruption' });
    await inject('GET', '/smartmeter/api/read'); // advance tick

    await inject('POST', '/mock/reset');

    const statusRes = await inject('GET', '/mock/status');
    const status = statusRes.json();
    expect(status.scenario).toBe('normal');
    expect(status.tickIndex).toBe(0);
    expect(status.hasCustomOverride).toBe(false);
  });

  it('clears custom override', async () => {
    await inject('POST', '/mock/custom', { voltage_l1: 0, voltage_l2: 0, voltage_l3: 0 });
    await inject('POST', '/mock/reset');

    const res = await inject('GET', '/smartmeter/api/read');
    const v = parseFloat(res.json().InstantaneousVoltageL1);
    expect(v).toBeGreaterThan(200); // back to normal
  });
});
