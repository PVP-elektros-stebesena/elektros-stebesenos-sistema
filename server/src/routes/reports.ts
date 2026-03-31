import type { FastifyInstance } from 'fastify';
import { registerAnomalyContextRoute } from './reports/context.js';
import { registerReportCrudRoutes } from './reports/reportCrud.js';
import { registerReportGenerateRoute } from './reports/generate.js';
import { registerReportSchedulerRoutes } from './reports/scheduler.js';

export async function reportRoutes(fastify: FastifyInstance): Promise<void> {
  registerAnomalyContextRoute(fastify);
  registerReportSchedulerRoutes(fastify);
  registerReportCrudRoutes(fastify);
  registerReportGenerateRoute(fastify);
}