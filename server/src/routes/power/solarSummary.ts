import type { FastifyInstance } from 'fastify';
import prisma from '../../lib/prisma.js';
import { ensureAccessibleDevice, ownedDeviceRelationFilter } from '../deviceAccess.js';
import { parseOptionalDeviceId } from '../queryParsers.js';
import { RAW_READING_SELECT, type DeviceQuery, toPowerPayload } from './shared.js';

interface SolarSummaryQuery extends DeviceQuery {
  days?: string;
}

interface DailyAccumulator {
  date: string;
  firstDelivered: number | null;
  lastDelivered: number | null;
  firstReturned: number | null;
  lastReturned: number | null;
  sampleCount: number;
}

function round(value: number | null, decimals: number = 4): number | null {
  if (value == null) return null;
  const m = 10 ** decimals;
  return Math.round(value * m) / m;
}

function dateKey(timestamp: Date): string {
  return timestamp.toISOString().slice(0, 10);
}

function ratio(importedKwh: number, exportedKwh: number): number | null {
  const total = importedKwh + exportedKwh;
  if (total <= 0) return null;
  return (importedKwh / total) * 100;
}

export function registerPowerSolarSummaryRoute(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: SolarSummaryQuery }>('/api/power/solar-summary', async (req, reply) => {
    const parsedDeviceId = parseOptionalDeviceId(req.query.deviceId);
    if (!parsedDeviceId.ok) {
      return reply.code(parsedDeviceId.statusCode).send(parsedDeviceId.body);
    }

    const days = Math.max(1, Math.min(parseInt(req.query.days ?? '7', 10) || 7, 31));
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    const deviceId = parsedDeviceId.value;
    if (deviceId && !(await ensureAccessibleDevice(deviceId, req, reply))) {
      return;
    }

    const deviceScope = {
      ...(deviceId ? { deviceId } : {}),
      ...ownedDeviceRelationFilter(req),
    };

    const [readings, latest] = await Promise.all([
      prisma.reading.findMany({
        where: {
          ...deviceScope,
          timestamp: { gte: from, lte: to },
          OR: [
            { energyDelivered: { not: null } },
            { energyReturned: { not: null } },
          ],
        },
        orderBy: { timestamp: 'asc' },
        select: {
          timestamp: true,
          energyDelivered: true,
          energyReturned: true,
        },
      }),
      prisma.reading.findFirst({
        where: deviceScope,
        orderBy: { timestamp: 'desc' },
        select: RAW_READING_SELECT,
      }),
    ]);

    const daily = new Map<string, DailyAccumulator>();
    for (const reading of readings) {
      const key = dateKey(reading.timestamp);
      const item = daily.get(key) ?? {
        date: key,
        firstDelivered: reading.energyDelivered,
        lastDelivered: reading.energyDelivered,
        firstReturned: reading.energyReturned,
        lastReturned: reading.energyReturned,
        sampleCount: 0,
      };

      item.firstDelivered = item.firstDelivered ?? reading.energyDelivered;
      item.firstReturned = item.firstReturned ?? reading.energyReturned;
      item.lastDelivered = reading.energyDelivered ?? item.lastDelivered;
      item.lastReturned = reading.energyReturned ?? item.lastReturned;
      item.sampleCount += 1;
      daily.set(key, item);
    }

    const data = [...daily.values()].map((item) => {
      const importedKwh = item.firstDelivered != null && item.lastDelivered != null
        ? Math.max(0, item.lastDelivered - item.firstDelivered)
        : 0;
      const exportedKwh = item.firstReturned != null && item.lastReturned != null
        ? Math.max(0, item.lastReturned - item.firstReturned)
        : 0;
      const selfConsumptionRatioPct = ratio(importedKwh, exportedKwh);

      return {
        date: item.date,
        importedKwh: round(importedKwh, 3),
        exportedKwh: round(exportedKwh, 3),
        selfConsumptionRatioPct: round(selfConsumptionRatioPct, 1),
        sampleCount: item.sampleCount,
      };
    });

    const totals = data.reduce(
      (acc, item) => ({
        importedKwh: acc.importedKwh + (item.importedKwh ?? 0),
        exportedKwh: acc.exportedKwh + (item.exportedKwh ?? 0),
      }),
      { importedKwh: 0, exportedKwh: 0 },
    );

    const latestPower = latest ? toPowerPayload(latest) : null;
    const currentExportKw = latestPower?.activePowerTotalKw != null && latestPower.activePowerTotalKw < 0
      ? Math.abs(latestPower.activePowerTotalKw)
      : 0;

    return {
      from,
      to,
      count: data.length,
      data,
      totals: {
        importedKwh: round(totals.importedKwh, 3),
        exportedKwh: round(totals.exportedKwh, 3),
        selfConsumptionRatioPct: round(ratio(totals.importedKwh, totals.exportedKwh), 1),
      },
      currentExport: {
        exporting: currentExportKw > 0,
        exportPowerKw: round(currentExportKw, 3),
        thresholdKw: 2.5,
        opportunity: currentExportKw > 2.5,
        latestTimestamp: latestPower?.timestamp ?? null,
      },
    };
  });
}
