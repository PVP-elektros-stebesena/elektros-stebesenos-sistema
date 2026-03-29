import type { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma.js';
import { analysePowerReading, evaluatePowerPolicyBreaches } from '../services/powerAnalysis.js';
import { resolveEffectivePowerPolicy } from '../services/powerPolicy.js';
import { toPowerReading, type P1ReadingData } from '../services/p1Parser.js';

interface DeviceQuery {
  deviceId?: string;
}

interface TimeRangeQuery extends DeviceQuery {
  from?: string;
  to?: string;
}

interface HistoryQuery extends TimeRangeQuery {
  points?: string;
  interval?: string;
}

interface AnomalyQuery extends TimeRangeQuery {
  type?: string;
  metricName?: string;
  phase?: string;
  limit?: string;
}

function parseDate(val: string | undefined, fallback: Date): Date {
  if (!val) return fallback;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function parseDeviceId(val: string | undefined): number | undefined {
  if (!val) return undefined;
  const parsed = parseInt(val, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function mapReadingToP1ReadingData(row: {
  energyDelivered: number | null;
  energyReturned: number | null;
  reactiveEnergyDelivered: number | null;
  reactiveEnergyReturned: number | null;
  energyDeliveredTariff1: number | null;
  energyDeliveredTariff2: number | null;
  energyDeliveredTariff3: number | null;
  energyDeliveredTariff4: number | null;
  energyReturnedTariff1: number | null;
  energyReturnedTariff2: number | null;
  energyReturnedTariff3: number | null;
  energyReturnedTariff4: number | null;
  reactiveEnergyDeliveredTariff1: number | null;
  reactiveEnergyDeliveredTariff2: number | null;
  reactiveEnergyDeliveredTariff3: number | null;
  reactiveEnergyDeliveredTariff4: number | null;
  reactiveEnergyReturnedTariff1: number | null;
  reactiveEnergyReturnedTariff2: number | null;
  reactiveEnergyReturnedTariff3: number | null;
  reactiveEnergyReturnedTariff4: number | null;
  instantaneousVoltageL1: number | null;
  voltageL1: number | null;
  instantaneousCurrentL1: number | null;
  currentL1: number | null;
  instantaneousVoltageL2: number | null;
  voltageL2: number | null;
  instantaneousCurrentL2: number | null;
  currentL2: number | null;
  instantaneousVoltageL3: number | null;
  voltageL3: number | null;
  instantaneousCurrentL3: number | null;
  currentL3: number | null;
  instantaneousVoltage: number | null;
  instantaneousCurrent: number | null;
  instantaneousCurrentNeutral: number | null;
  currentNeutral: number | null;
  frequency: number | null;
  activeInstantaneousPowerDelivered: number | null;
  activeInstantaneousPowerDeliveredL1: number | null;
  activeInstantaneousPowerDeliveredL2: number | null;
  activeInstantaneousPowerDeliveredL3: number | null;
  activeInstantaneousPowerReturnedL1: number | null;
  activeInstantaneousPowerReturnedL2: number | null;
  activeInstantaneousPowerReturnedL3: number | null;
  reactiveInstantaneousPowerDeliveredL1: number | null;
  reactiveInstantaneousPowerDeliveredL2: number | null;
  reactiveInstantaneousPowerDeliveredL3: number | null;
  reactiveInstantaneousPowerReturnedL1: number | null;
  reactiveInstantaneousPowerReturnedL2: number | null;
  reactiveInstantaneousPowerReturnedL3: number | null;
  apparentInstantaneousPower: number | null;
  apparentInstantaneousPowerL1: number | null;
  apparentInstantaneousPowerL2: number | null;
  apparentInstantaneousPowerL3: number | null;
  powerDeliveredTotal: number | null;
  powerReturnedTotal: number | null;
  reactiveEnergyDeliveredCurrentPeriod: number | null;
  reactiveEnergyReturnedCurrentPeriod: number | null;
  powerDeliveredNetto: number | null;
}): P1ReadingData {
  return { ...row };
}

const RAW_READING_SELECT = {
  deviceId: true,
  timestamp: true,
  energyDelivered: true,
  energyReturned: true,
  reactiveEnergyDelivered: true,
  reactiveEnergyReturned: true,
  energyDeliveredTariff1: true,
  energyDeliveredTariff2: true,
  energyDeliveredTariff3: true,
  energyDeliveredTariff4: true,
  energyReturnedTariff1: true,
  energyReturnedTariff2: true,
  energyReturnedTariff3: true,
  energyReturnedTariff4: true,
  reactiveEnergyDeliveredTariff1: true,
  reactiveEnergyDeliveredTariff2: true,
  reactiveEnergyDeliveredTariff3: true,
  reactiveEnergyDeliveredTariff4: true,
  reactiveEnergyReturnedTariff1: true,
  reactiveEnergyReturnedTariff2: true,
  reactiveEnergyReturnedTariff3: true,
  reactiveEnergyReturnedTariff4: true,
  instantaneousVoltageL1: true,
  voltageL1: true,
  instantaneousCurrentL1: true,
  currentL1: true,
  instantaneousVoltageL2: true,
  voltageL2: true,
  instantaneousCurrentL2: true,
  currentL2: true,
  instantaneousVoltageL3: true,
  voltageL3: true,
  instantaneousCurrentL3: true,
  currentL3: true,
  instantaneousVoltage: true,
  instantaneousCurrent: true,
  instantaneousCurrentNeutral: true,
  currentNeutral: true,
  frequency: true,
  activeInstantaneousPowerDelivered: true,
  activeInstantaneousPowerDeliveredL1: true,
  activeInstantaneousPowerDeliveredL2: true,
  activeInstantaneousPowerDeliveredL3: true,
  activeInstantaneousPowerReturnedL1: true,
  activeInstantaneousPowerReturnedL2: true,
  activeInstantaneousPowerReturnedL3: true,
  reactiveInstantaneousPowerDeliveredL1: true,
  reactiveInstantaneousPowerDeliveredL2: true,
  reactiveInstantaneousPowerDeliveredL3: true,
  reactiveInstantaneousPowerReturnedL1: true,
  reactiveInstantaneousPowerReturnedL2: true,
  reactiveInstantaneousPowerReturnedL3: true,
  apparentInstantaneousPower: true,
  apparentInstantaneousPowerL1: true,
  apparentInstantaneousPowerL2: true,
  apparentInstantaneousPowerL3: true,
  powerDeliveredTotal: true,
  powerReturnedTotal: true,
  reactiveEnergyDeliveredCurrentPeriod: true,
  reactiveEnergyReturnedCurrentPeriod: true,
  powerDeliveredNetto: true,
} as const;

function downsample<T>(items: T[], maxPoints: number): T[] {
  if (items.length <= maxPoints) return items;
  if (maxPoints <= 1) return [items[items.length - 1]!];

  const step = (items.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, index) => (
    items[Math.round(index * step)]!
  ));
}

function toPowerPayload(row: {
  deviceId: number;
  timestamp: Date;
} & P1ReadingData) {
  const powerReading = toPowerReading(mapReadingToP1ReadingData(row), row.timestamp);
  const metrics = analysePowerReading(powerReading);
  return {
    deviceId: row.deviceId,
    timestamp: row.timestamp,
    activePowerTotalKw: metrics.activePowerTotalKw,
    reactivePowerTotalKvar: metrics.reactivePowerTotalKvar,
    apparentPowerTotalKva: metrics.apparentPowerTotalKva,
    powerFactor: metrics.powerFactor,
    phaseImbalancePct: metrics.phaseImbalancePct,
    activePowerL1Kw: metrics.activePowerL1Kw,
    activePowerL2Kw: metrics.activePowerL2Kw,
    activePowerL3Kw: metrics.activePowerL3Kw,
    reactivePowerL1Kvar: metrics.reactivePowerL1Kvar,
    reactivePowerL2Kvar: metrics.reactivePowerL2Kvar,
    reactivePowerL3Kvar: metrics.reactivePowerL3Kvar,
  };
}

export async function powerRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: DeviceQuery }>('/api/power/latest', async (req, reply) => {
    const deviceId = parseDeviceId(req.query.deviceId);

    const latestRows = await prisma.reading.findMany({
      where: deviceId ? { deviceId } : undefined,
      orderBy: { timestamp: 'desc' },
      select: RAW_READING_SELECT,
      take: 2,
    });
    const latest = latestRows[0];

    if (!latest) {
      return reply.code(503).send({
        error: 'NO_DATA',
        message: 'No power readings received yet',
      });
    }

    const payload = toPowerPayload(latest);
    const policy = await resolveEffectivePowerPolicy(latest.deviceId, latest.timestamp);
    const previous = latestRows[1]
      ? toPowerPayload(latestRows[1])
      : null;
    const breaches = evaluatePowerPolicyBreaches(
      {
        activePowerTotalKw: payload.activePowerTotalKw,
        reactivePowerTotalKvar: payload.reactivePowerTotalKvar,
        apparentPowerTotalKva: payload.apparentPowerTotalKva,
        powerFactor: payload.powerFactor,
        phaseImbalancePct: payload.phaseImbalancePct,
        activePowerL1Kw: payload.activePowerL1Kw,
        activePowerL2Kw: payload.activePowerL2Kw,
        activePowerL3Kw: payload.activePowerL3Kw,
        reactivePowerL1Kvar: payload.reactivePowerL1Kvar,
        reactivePowerL2Kvar: payload.reactivePowerL2Kvar,
        reactivePowerL3Kvar: payload.reactivePowerL3Kvar,
      },
      policy,
      latest.timestamp,
      previous ? {
        timestamp: previous.timestamp,
        activePowerTotalKw: previous.activePowerTotalKw,
      } : undefined,
    );

    return {
      ...payload,
      policy,
      breaches,
    };
  });

  fastify.get<{ Querystring: HistoryQuery }>(
    '/api/power/history',
    async (req, reply) => {
      const now = new Date();
      const from = parseDate(req.query.from, new Date(now.getTime() - 3600_000));
      const to = parseDate(req.query.to, now);
      const maxPoints = Math.min(parseInt(req.query.points ?? '500', 10) || 500, 5000);
      const interval = req.query.interval ?? 'raw';
      const deviceId = parseDeviceId(req.query.deviceId);

      if (from >= to) {
        return reply.code(400).send({
          error: 'INVALID_RANGE',
          message: '"from" must be before "to"',
        });
      }

      if (interval === '10min') {
        const windows = await prisma.aggregatedData.findMany({
          where: {
            ...(deviceId ? { deviceId } : {}),
            startsAt: { gte: from },
            endsAt: { lte: to },
          },
          orderBy: { startsAt: 'asc' },
        });

        return {
          interval: '10min',
          from,
          to,
          count: windows.length,
          data: windows.map((w) => ({
            deviceId: w.deviceId,
            timestamp: w.startsAt,
            windowEnd: w.endsAt,
            sampleCount: w.sampleCount,
            activePowerAvgTotal: w.activePowerAvgTotal,
            activePowerMaxTotal: w.activePowerMaxTotal,
            reactivePowerAvgTotal: w.reactivePowerAvgTotal,
            reactivePowerMaxTotal: w.reactivePowerMaxTotal,
            apparentPowerAvgTotal: w.apparentPowerAvgTotal,
            apparentPowerMaxTotal: w.apparentPowerMaxTotal,
            powerFactorAvg: w.powerFactorAvg,
            activePowerAvgL1: w.activePowerAvgL1,
            activePowerAvgL2: w.activePowerAvgL2,
            activePowerAvgL3: w.activePowerAvgL3,
            reactivePowerAvgL1: w.reactivePowerAvgL1,
            reactivePowerAvgL2: w.reactivePowerAvgL2,
            reactivePowerAvgL3: w.reactivePowerAvgL3,
            powerImbalancePct: w.powerImbalancePct,
            powerPolicyBreached: w.powerPolicyBreached,
          })),
        };
      }

      const rows = await prisma.reading.findMany({
        where: {
          ...(deviceId ? { deviceId } : {}),
          timestamp: { gte: from, lte: to },
        },
        orderBy: { timestamp: 'asc' },
        select: RAW_READING_SELECT,
      });

      const data = downsample(rows, maxPoints).map((row) => toPowerPayload(row));

      return {
        interval: 'raw',
        from,
        to,
        count: data.length,
        data,
      };
    },
  );

  fastify.get<{ Querystring: AnomalyQuery }>(
    '/api/power/anomalies',
    async (req) => {
      const now = new Date();
      const from = req.query.from ? parseDate(req.query.from, new Date(0)) : undefined;
      const to = req.query.to ? parseDate(req.query.to, now) : undefined;
      const limit = Math.min(parseInt(req.query.limit ?? '100', 10) || 100, 1000);
      const deviceId = parseDeviceId(req.query.deviceId);

      const anomalies = await prisma.anomaly.findMany({
        where: {
          metricDomain: 'POWER',
          ...(deviceId ? { deviceId } : {}),
          ...(req.query.type ? { type: req.query.type } : {}),
          ...(req.query.metricName ? { metricName: req.query.metricName } : {}),
          ...(req.query.phase ? { phase: req.query.phase } : {}),
          ...((from || to) ? {
            startsAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          } : {}),
        },
        orderBy: { startsAt: 'desc' },
        take: limit,
      });

      return {
        count: anomalies.length,
        data: anomalies,
      };
    },
  );

  fastify.get<{ Querystring: DeviceQuery }>(
    '/api/power/summary',
    async (req) => {
      const deviceId = parseDeviceId(req.query.deviceId);
      const where = deviceId ? { deviceId } : {};

      const [latest, readingCount, windowCount, breachWindowCount, anomalyCount, activeAnomalyCount] =
        await Promise.all([
          prisma.reading.findFirst({
            where,
            orderBy: { timestamp: 'desc' },
            select: RAW_READING_SELECT,
          }),
          prisma.reading.count({ where }),
          prisma.aggregatedData.count({
            where: {
              ...where,
              OR: [
                { activePowerAvgTotal: { not: null } },
                { reactivePowerAvgTotal: { not: null } },
                { apparentPowerAvgTotal: { not: null } },
              ],
            },
          }),
          prisma.aggregatedData.count({
            where: {
              ...where,
              powerPolicyBreached: true,
            },
          }),
          prisma.anomaly.count({
            where: {
              ...where,
              metricDomain: 'POWER',
            },
          }),
          prisma.anomaly.count({
            where: {
              ...where,
              metricDomain: 'POWER',
              endsAt: null,
            },
          }),
        ]);

      const policy = latest
        ? await resolveEffectivePowerPolicy(latest.deviceId, latest.timestamp)
        : null;

      return {
        has_data: latest != null,
        latest_timestamp: latest?.timestamp ?? null,
        latest_metrics: latest ? toPowerPayload(latest) : null,
        stats: {
          totalReadings: readingCount,
          totalPowerWindows: windowCount,
          policyBreachedWindows: breachWindowCount,
          totalPowerAnomalies: anomalyCount,
          activePowerAnomalies: activeAnomalyCount,
        },
        policy,
      };
    },
  );

  fastify.get<{ Querystring: DeviceQuery }>(
    '/api/power/policy',
    async (req, reply) => {
      const deviceId = parseDeviceId(req.query.deviceId);
      if (!deviceId) {
        return reply.code(400).send({
          error: 'MISSING_DEVICE_ID',
          message: 'deviceId query parameter is required',
        });
      }

      const policy = await resolveEffectivePowerPolicy(deviceId);
      return {
        deviceId,
        policy,
      };
    },
  );
}
