import type { FastifyInstance } from 'fastify';
import { ESO } from '../../config/eso.js';
import prisma from '../../lib/prisma.js';
import { ensureAccessibleDevice, ownedDeviceRelationFilter } from '../deviceAccess.js';
import { parseDateOrDefault, parseOptionalDeviceId } from '../queryParsers.js';
import { getWeekBounds, type DeviceQuery } from './shared.js';

export function registerVoltageComplianceRoute(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: DeviceQuery & { date?: string } }>('/api/voltage/compliance/weekly', async (req, reply) => {
    const parsedDate = parseDateOrDefault(req.query.date, new Date(), 'date');
    if (!parsedDate.ok) {
      return reply.code(parsedDate.statusCode).send(parsedDate.body);
    }

    const parsedDeviceId = parseOptionalDeviceId(req.query.deviceId);
    if (!parsedDeviceId.ok) {
      return reply.code(parsedDeviceId.statusCode).send(parsedDeviceId.body);
    }

    const date = parsedDate.value;
    const deviceId = parsedDeviceId.value;
    if (deviceId && !(await ensureAccessibleDevice(deviceId, req, reply))) {
      return;
    }

    const { weekStart, weekEnd } = getWeekBounds(date);

    const windows = await prisma.aggregatedData.findMany({
      where: {
        ...(deviceId ? { deviceId } : {}),
        ...ownedDeviceRelationFilter(req),
        startsAt: { gte: weekStart, lt: weekEnd },
      },
    });

    const total = windows.length;
    const compliantL1 = windows.filter((w) => w.compliantL1).length;
    const compliantL2 = windows.filter((w) => w.compliantL2).length;
    const compliantL3 = windows.filter((w) => w.compliantL3).length;

    const pctL1 = total > 0 ? +((compliantL1 / total) * 100).toFixed(2) : 0;
    const pctL2 = total > 0 ? +((compliantL2 / total) * 100).toFixed(2) : 0;
    const pctL3 = total > 0 ? +((compliantL3 / total) * 100).toFixed(2) : 0;

    return {
      weekStart,
      weekEnd,
      totalWindows: total,
      compliantWindowsL1: compliantL1,
      compliantWindowsL2: compliantL2,
      compliantWindowsL3: compliantL3,
      compliancePctL1: pctL1,
      compliancePctL2: pctL2,
      compliancePctL3: pctL3,
      overallCompliant:
        pctL1 >= ESO.WEEKLY_COMPLIANCE_PCT &&
        pctL2 >= ESO.WEEKLY_COMPLIANCE_PCT &&
        pctL3 >= ESO.WEEKLY_COMPLIANCE_PCT,
      eso_threshold_pct: ESO.WEEKLY_COMPLIANCE_PCT,
      window_duration_minutes: ESO.WINDOW_MINUTES,
      windows_per_week: ESO.WINDOWS_PER_WEEK,
    };
  });
}
