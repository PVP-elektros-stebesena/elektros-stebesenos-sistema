import type { FastifyInstance } from 'fastify';
import {
  getSchedulerStatus,
  startReportScheduler,
  stopReportScheduler,
} from '../../services/reportScheduler.js';

export function registerReportSchedulerRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/reports/scheduler/status', async () => getSchedulerStatus());

  fastify.post('/api/reports/scheduler/start', async () => {
    startReportScheduler();
    return getSchedulerStatus();
  });

  fastify.post('/api/reports/scheduler/stop', async () => {
    stopReportScheduler();
    return { message: 'Scheduler stopped', ...getSchedulerStatus() };
  });
}
