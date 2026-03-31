import type { FastifyInstance } from 'fastify';
import { registerVoltageAnomalyRoutes } from './voltage/anomalies.js';
import { registerVoltageComplianceRoute } from './voltage/compliance.js';
import { registerVoltageHistoryRoute } from './voltage/history.js';
import { registerVoltageLatestRoute } from './voltage/latest.js';
import { registerVoltageLiveRoute } from './voltage/live.js';
import { registerVoltageSummaryRoute } from './voltage/summary.js';

// ── Plugin ────────────────────────────────────────────────────────

export async function voltageRoutes(fastify: FastifyInstance): Promise<void> {
  registerVoltageLatestRoute(fastify);
  registerVoltageHistoryRoute(fastify);
  registerVoltageAnomalyRoutes(fastify);
  registerVoltageComplianceRoute(fastify);
  registerVoltageSummaryRoute(fastify);
  registerVoltageLiveRoute(fastify);
  console.log(fastify.printRoutes());
}
