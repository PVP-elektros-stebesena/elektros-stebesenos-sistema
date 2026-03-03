import type { FastifyInstance } from 'fastify';
import { ESO } from '../config/eso.js';
import { analyseVoltage } from '../services/voltageAnalysis.js';
import type { Phase, AnomalyType } from '../config/eso.js';
import prisma from '../lib/prisma.js';

// ── Query string schemas ──────────────────────────────────────────

interface DeviceQuery {
  deviceId?: string;
}

interface TimeRangeQuery extends DeviceQuery {
  from?: string;
  to?: string;
}

interface HistoryQuery extends TimeRangeQuery {
  /** Max data points to return (default 500) */
  points?: string;
  /** Aggregation: "raw" | "10min" (default "raw") */
  interval?: string;
}

interface AnomalyQuery extends TimeRangeQuery {
  type?: AnomalyType;
  phase?: Phase;
  limit?: string;
}

// ── Helpers ───────────────────────────────────────────────────────

function parseDate(val: string | undefined, fallback: Date): Date {
  if (!val) return fallback;
  const d = new Date(val);
  return isNaN(d.getTime()) ? fallback : d;
}

function parseDeviceId(val: string | undefined): number | undefined {
  if (!val) return undefined;
  const n = parseInt(val, 10);
  return Number.isNaN(n) ? undefined : n;
}

// ── Plugin ────────────────────────────────────────────────────────

export async function voltageRoutes(fastify: FastifyInstance): Promise<void> {

  //  GET /api/voltage/latest?deviceId=
  //  Real-time: the most recent reading + ESO bounds analysis
  fastify.get<{ Querystring: DeviceQuery }>('/api/voltage/latest', async (req, reply) => {
    const deviceId = parseDeviceId(req.query.deviceId);

    const reading = await prisma.reading.findFirst({
      where: deviceId ? { deviceId } : undefined,
      orderBy: { timestamp: 'desc' },
    });

    if (!reading) {
      return reply.code(503).send({
        error: 'NO_DATA',
        message: 'No voltage readings received yet',
      });
    }

    const vL1 = reading.voltageL1 ?? reading.instantaneousVoltageL1 ?? 0;
    const vL2 = reading.voltageL2 ?? reading.instantaneousVoltageL2 ?? 0;
    const vL3 = reading.voltageL3 ?? reading.instantaneousVoltageL3 ?? 0;

    const phases = [
      analyseVoltage(vL1, 'L1'),
      analyseVoltage(vL2, 'L2'),
      analyseVoltage(vL3, 'L3'),
    ];

    return {
      deviceId: reading.deviceId,
      timestamp: reading.timestamp,
      phases,
      bounds: {
        nominal: ESO.NOMINAL_VOLTAGE_1PH,
        tolerance: ESO.VOLTAGE_TOLERANCE,
        min: ESO.VOLTAGE_MIN_1PH,
        max: ESO.VOLTAGE_MAX_1PH,
      },
    };
  });

  //  GET /api/voltage/history?deviceId=&from=&to=&points=&interval=
  //  Time-series data for charts
  fastify.get<{ Querystring: HistoryQuery }>(
    '/api/voltage/history',
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
            voltage_l1: w.voltageL1,
            voltage_l2: w.voltageL2,
            voltage_l3: w.voltageL3,
            compliant_l1: w.compliantL1,
            compliant_l2: w.compliantL2,
            compliant_l3: w.compliantL3,
            oob_seconds_l1: w.outOfBoundsSecondsL1,
            oob_seconds_l2: w.outOfBoundsSecondsL2,
            oob_seconds_l3: w.outOfBoundsSecondsL3,
          })),
          bounds: {
            nominal: ESO.NOMINAL_VOLTAGE_1PH,
            min: ESO.VOLTAGE_MIN_1PH,
            max: ESO.VOLTAGE_MAX_1PH,
          },
        };
      }

      // Default: raw readings, downsampled
      const readings = await prisma.reading.findMany({
        where: {
          ...(deviceId ? { deviceId } : {}),
          timestamp: { gte: from, lte: to },
        },
        orderBy: { timestamp: 'asc' },
        select: {
          deviceId: true,
          timestamp: true,
          voltageL1: true,
          voltageL2: true,
          voltageL3: true,
          instantaneousVoltageL1: true,
          instantaneousVoltageL2: true,
          instantaneousVoltageL3: true,
        },
      });

      // Downsample if needed
      let data = readings;
      if (readings.length > maxPoints) {
        const step = readings.length / maxPoints;
        const sampled = [];
        for (let i = 0; i < maxPoints; i++) {
          sampled.push(readings[Math.floor(i * step)]);
        }
        if (sampled[sampled.length - 1] !== readings[readings.length - 1]) {
          sampled.push(readings[readings.length - 1]);
        }
        data = sampled;
      }

      return {
        interval: 'raw',
        from,
        to,
        count: data.length,
        data: data.map((r) => ({
          deviceId: r.deviceId,
          timestamp: r.timestamp,
          voltage_l1: r.voltageL1 ?? r.instantaneousVoltageL1 ?? 0,
          voltage_l2: r.voltageL2 ?? r.instantaneousVoltageL2 ?? 0,
          voltage_l3: r.voltageL3 ?? r.instantaneousVoltageL3 ?? 0,
        })),
        bounds: {
          nominal: ESO.NOMINAL_VOLTAGE_1PH,
          min: ESO.VOLTAGE_MIN_1PH,
          max: ESO.VOLTAGE_MAX_1PH,
        },
      };
    },
  );

  //  GET /api/voltage/anomalies?deviceId=&type=&phase=&from=&to=&limit=
  //  Anomaly history
  fastify.get<{ Querystring: AnomalyQuery }>(
    '/api/voltage/anomalies',
    async (req) => {
      const now = new Date();
      const from = req.query.from ? parseDate(req.query.from, new Date(0)) : undefined;
      const to = req.query.to ? parseDate(req.query.to, now) : undefined;
      const limit = Math.min(parseInt(req.query.limit ?? '100', 10) || 100, 1000);
      const deviceId = parseDeviceId(req.query.deviceId);

      const anomalies = await prisma.anomaly.findMany({
        where: {
          ...(deviceId ? { deviceId } : {}),
          ...(req.query.type ? { type: req.query.type } : {}),
          ...(req.query.phase ? { phase: req.query.phase } : {}),
          ...(from ? { startsAt: { gte: from } } : {}),
          ...(to ? { startsAt: { lte: to } } : {}),
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

  //  GET /api/voltage/anomalies/active?deviceId=
  //  Currently ongoing anomalies (endsAt is null)
  fastify.get<{ Querystring: DeviceQuery }>('/api/voltage/anomalies/active', async (req) => {
    const deviceId = parseDeviceId(req.query.deviceId);

    const active = await prisma.anomaly.findMany({
      where: {
        ...(deviceId ? { deviceId } : {}),
        endsAt: null,
      },
      orderBy: { startsAt: 'desc' },
    });

    return {
      count: active.length,
      data: active,
    };
  });

  //  GET /api/voltage/compliance/weekly?deviceId=&date=
  //  ESO weekly 95% compliance report
  fastify.get<{ Querystring: DeviceQuery & { date?: string } }>(
    '/api/voltage/compliance/weekly',
    async (req) => {
      const date = req.query.date ? parseDate(req.query.date, new Date()) : new Date();
      const deviceId = parseDeviceId(req.query.deviceId);

      // Calculate week boundaries (Mon–Sun)
      const day = date.getDay();
      const diff = date.getDate() - day + (day === 0 ? -6 : 1);
      const weekStart = new Date(date);
      weekStart.setDate(diff);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3600_000);

      const windows = await prisma.aggregatedData.findMany({
        where: {
          ...(deviceId ? { deviceId } : {}),
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
    },
  );

  //  GET /api/voltage/summary?deviceId=
  //  Dashboard summary stats
  fastify.get<{ Querystring: DeviceQuery }>('/api/voltage/summary', async (req) => {
    const deviceId = parseDeviceId(req.query.deviceId);
    const where = deviceId ? { deviceId } : {};

    const [latestReading, readingCount, windowCount, anomalyCount, activeAnomalyCount] =
      await Promise.all([
        prisma.reading.findFirst({
          where,
          orderBy: { timestamp: 'desc' },
        }),
        prisma.reading.count({ where }),
        prisma.aggregatedData.count({ where }),
        prisma.anomaly.count({ where }),
        prisma.anomaly.count({ where: { ...where, endsAt: null } }),
      ]);

    // Quick weekly compliance
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const weekStart = new Date(now);
    weekStart.setDate(diff);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3600_000);

    const weekWindows = await prisma.aggregatedData.findMany({
      where: { ...where, startsAt: { gte: weekStart, lt: weekEnd } },
    });

    const total = weekWindows.length;
    const cL1 = weekWindows.filter((w) => w.compliantL1).length;
    const cL2 = weekWindows.filter((w) => w.compliantL2).length;
    const cL3 = weekWindows.filter((w) => w.compliantL3).length;
    const pL1 = total > 0 ? +((cL1 / total) * 100).toFixed(2) : 0;
    const pL2 = total > 0 ? +((cL2 / total) * 100).toFixed(2) : 0;
    const pL3 = total > 0 ? +((cL3 / total) * 100).toFixed(2) : 0;

    return {
      has_data: latestReading !== null,
      latest_timestamp: latestReading?.timestamp ?? null,
      stats: {
        totalReadings: readingCount,
        totalWindows: windowCount,
        totalAnomalies: anomalyCount,
        activeAnomalies: activeAnomalyCount,
      },
      weekly_compliance: {
        pct_l1: pL1,
        pct_l2: pL2,
        pct_l3: pL3,
        overall_compliant:
          pL1 >= ESO.WEEKLY_COMPLIANCE_PCT &&
          pL2 >= ESO.WEEKLY_COMPLIANCE_PCT &&
          pL3 >= ESO.WEEKLY_COMPLIANCE_PCT,
      },
      bounds: {
        nominal: ESO.NOMINAL_VOLTAGE_1PH,
        min: ESO.VOLTAGE_MIN_1PH,
        max: ESO.VOLTAGE_MAX_1PH,
      },
    };
  });
}