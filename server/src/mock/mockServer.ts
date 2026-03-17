import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  SCENARIOS,
  SCENARIO_NAMES,
  type ScenarioName,
  type ScenarioConfig,
  type ScenarioOutput,
} from './scenarios.js';
import { toP1ResponseWithTotals } from './p1Response.js';

/**
 * Mock P1 Gateway Server
 *
 * Simulates the SmartGateway REST API so you can test the polling
 * and voltage analysis pipeline without a real smart meter.
 *
 * Endpoints:
 *   GET /smartmeter/api/read       - P1 reading (same as real gateway)
 *   GET /mock/status               - Current scenario & tick info
 *   POST /mock/scenario            - Switch scenario
 *   POST /mock/custom              - Set custom fixed voltages
 *   POST /mock/sequence            - Queue a sequence of scenarios
 *   GET /mock/scenarios            - List all available scenarios
 */

const MOCK_PORT = parseInt(process.env.MOCK_PORT || '3001');
const MOCK_SAMPLE_SECONDS = parseInt(process.env.MOCK_SAMPLE_SECONDS || '10');

// State

let activeScenario: ScenarioConfig = SCENARIOS['normal'];
let tickIndex = 0;
let customOverride: ScenarioOutput | null = null;

/** Queue of scenarios to auto-play in sequence */
let scenarioQueue: { name: ScenarioName; ticks: number }[] = [];
let queueTicksRemaining = 0;
let cumulativeEnergyDeliveredKwh = 0;
let cumulativeEnergyReturnedKwh = 0;

// Tick management

function getCurrentOutput(): ScenarioOutput {
  // Custom override takes priority
  if (customOverride) return customOverride;

  // Check if we should advance the queue
  if (scenarioQueue.length > 0 && queueTicksRemaining <= 0) {
    const next = scenarioQueue.shift()!;
    activeScenario = SCENARIOS[next.name];
    queueTicksRemaining = next.ticks;
    tickIndex = 0;
  }

  const output = activeScenario.generate(tickIndex);
  tickIndex++;

  if (scenarioQueue.length > 0 || queueTicksRemaining > 0) {
    queueTicksRemaining--;
  }

  return output;
}

// Server setup

const app = Fastify({ logger: true });
app.register(cors, { origin: '*' });

// P1 API endpoint (matches real gateway)

app.get('/smartmeter/api/read', async () => {
  const output = getCurrentOutput();
  const totalPowerDelivered = output.l1.powerDelivered + output.l2.powerDelivered + output.l3.powerDelivered;
  const totalPowerReturned = output.l1.powerReturned + output.l2.powerReturned + output.l3.powerReturned;
  const sampleHours = MOCK_SAMPLE_SECONDS / 3600;

  cumulativeEnergyDeliveredKwh += totalPowerDelivered * sampleHours;
  cumulativeEnergyReturnedKwh += totalPowerReturned * sampleHours;

  return toP1ResponseWithTotals(output, {
    energyDeliveredKwh: cumulativeEnergyDeliveredKwh,
    energyReturnedKwh: cumulativeEnergyReturnedKwh,
  });
});

// Mock control: list scenarios

app.get('/mock/scenarios', async () => {
  return SCENARIO_NAMES.map((name) => ({
    name,
    description: SCENARIOS[name].description,
    durationHint: SCENARIOS[name].durationHint,
  }));
});

// Mock control: current status

app.get('/mock/status', async () => {
  return {
    scenario: activeScenario.name,
    description: activeScenario.description,
    tickIndex,
    hasCustomOverride: customOverride !== null,
    queueLength: scenarioQueue.length,
    queueTicksRemaining,
    cumulativeEnergyDeliveredKwh: +cumulativeEnergyDeliveredKwh.toFixed(3),
    cumulativeEnergyReturnedKwh: +cumulativeEnergyReturnedKwh.toFixed(3),
  };
});

// Mock control: switch scenario 

app.post<{ Body: { scenario: ScenarioName } }>('/mock/scenario', async (req, reply) => {
  const { scenario } = req.body;

  if (!SCENARIOS[scenario]) {
    return reply.code(400).send({
      error: 'INVALID_SCENARIO',
      message: `Unknown scenario "${scenario}". Available: ${SCENARIO_NAMES.join(', ')}`,
    });
  }

  activeScenario = SCENARIOS[scenario];
  tickIndex = 0;
  customOverride = null;
  scenarioQueue = [];
  queueTicksRemaining = 0;
  cumulativeEnergyDeliveredKwh = 0;
  cumulativeEnergyReturnedKwh = 0;

  return {
    message: `Switched to scenario: ${scenario}`,
    description: activeScenario.description,
  };
});

// Mock control: set custom fixed voltages

app.post<{
  Body: {
    voltage_l1: number;
    voltage_l2: number;
    voltage_l3: number;
    frequency?: number;
  };
}>('/mock/custom', async (req) => {
  const { voltage_l1, voltage_l2, voltage_l3, frequency = 50 } = req.body;

  customOverride = {
    l1: { voltage: voltage_l1, current: voltage_l1 > 10 ? 5 : 0, powerDelivered: voltage_l1 * 5 / 1000, powerReturned: 0 },
    l2: { voltage: voltage_l2, current: voltage_l2 > 10 ? 5 : 0, powerDelivered: voltage_l2 * 5 / 1000, powerReturned: 0 },
    l3: { voltage: voltage_l3, current: voltage_l3 > 10 ? 5 : 0, powerDelivered: voltage_l3 * 5 / 1000, powerReturned: 0 },
    frequency,
  };

  return {
    message: 'Custom voltages set',
    voltages: { l1: voltage_l1, l2: voltage_l2, l3: voltage_l3 },
  };
});

// Mock control: clear custom override 

app.post('/mock/custom/clear', async () => {
  customOverride = null;
  return { message: 'Custom override cleared, using scenario generator' };
});

// Mock control: queue a sequence of scenarios

app.post<{
  Body: {
    sequence: { scenario: ScenarioName; ticks: number }[];
  };
}>('/mock/sequence', async (req, reply) => {
  const { sequence } = req.body;

  // Validate all scenarios
  for (const step of sequence) {
    if (!SCENARIOS[step.scenario]) {
      return reply.code(400).send({
        error: 'INVALID_SCENARIO',
        message: `Unknown scenario "${step.scenario}" in sequence`,
      });
    }
    if (!step.ticks || step.ticks < 1) {
      return reply.code(400).send({
        error: 'INVALID_TICKS',
        message: `Each step needs ticks >= 1`,
      });
    }
  }

  customOverride = null;
  scenarioQueue = sequence.map((s) => ({ name: s.scenario, ticks: s.ticks }));
  queueTicksRemaining = 0; // Will pick up the first item on next read
  tickIndex = 0;

  return {
    message: `Queued ${sequence.length} scenarios`,
    sequence: sequence.map((s) => `${s.scenario} (${s.ticks} ticks)`),
  };
});

// Mock control: reset to normal

app.post('/mock/reset', async () => {
  activeScenario = SCENARIOS['normal'];
  tickIndex = 0;
  customOverride = null;
  scenarioQueue = [];
  queueTicksRemaining = 0;
  cumulativeEnergyDeliveredKwh = 0;
  cumulativeEnergyReturnedKwh = 0;

  return { message: 'Reset to normal scenario' };
});

// Start 

const start = async () => {
  try {
    await app.listen({ port: MOCK_PORT });
    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║         Mock P1 Gateway Server Running          ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  P1 API:    http://localhost:${MOCK_PORT}/smartmeter/api/read ║`);
    console.log(`║  Control:   http://localhost:${MOCK_PORT}/mock/scenarios     ║`);
    console.log(`║  Scenario:  ${activeScenario.name.padEnd(37)}║`);
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');
    console.log('Usage examples:');
    console.log(`  curl http://localhost:${MOCK_PORT}/smartmeter/api/read`);
    console.log(`  curl -X POST http://localhost:${MOCK_PORT}/mock/scenario -H "Content-Type: application/json" -d "{\\"scenario\\":\\"voltage-sag\\"}"`);
    console.log(`  curl -X POST http://localhost:${MOCK_PORT}/mock/custom -H "Content-Type: application/json" -d "{\\"voltage_l1\\":250,\\"voltage_l2\\":230,\\"voltage_l3\\":210}"`);
    console.log('');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
