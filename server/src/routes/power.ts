import type { FastifyInstance } from 'fastify';
import { registerPowerAnomaliesRoute } from './power/anomalies.js';
import { registerPowerHistoryRoute } from './power/history.js';
import { registerPowerLatestRoute } from './power/latest.js';
import { registerPowerPolicyRoute } from './power/policy.js';
import { registerPowerStandbyRoute } from './power/standby.js';
import { registerPowerSummaryRoute } from './power/summary.js';
import { registerPowerSolarSummaryRoute } from './power/solarSummary.js';

export async function powerRoutes(fastify: FastifyInstance): Promise<void> {
  registerPowerLatestRoute(fastify);
  registerPowerHistoryRoute(fastify);
  registerPowerAnomaliesRoute(fastify);
  registerPowerSummaryRoute(fastify);
  registerPowerStandbyRoute(fastify);
  registerPowerPolicyRoute(fastify);
  registerPowerSolarSummaryRoute(fastify);
}
