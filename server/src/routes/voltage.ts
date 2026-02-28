import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ESO } from '../config/eso.js';
import { voltageState } from '../services/voltageState.js';
import { analyseReading } from '../services/voltageAnalysis.js';
import type { Phase, AnomalyType } from '../config/eso.js';

// Query string schemas 

interface TimeRangeQuery {
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

// Helper

function parseDate(val: string | undefined, fallback: Date): Date {
  if (!val) return fallback;
  const d = new Date(val);
  return isNaN(d.getTime()) ? fallback : d;
}

// Plugin

export async function voltageRoutes(fastify: FastifyInstance): Promise<void> {

  //  GET /api/voltage/latest
  //  Real-time: the most recent reading + ESO bounds analysis
  fastify.get('/api/voltage/latest', async (_req, reply) => {
    const reading = voltageState.latest;

    if (!reading) {
      return reply.code(503).send({
        error: 'NO_DATA',
        message: 'No voltage readings received yet',
      });
    }

    const phases = analyseReading(reading);

    return {
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

  //  GET /api/voltage/history?from=&to=&points=&interval=
  //  Time-series data for charts
  //
  //  interval=raw     → individual readings (downsampled to `points`)
  //  interval=10min   → pre-aggregated 10-min RMS windows
  fastify.get<{ Querystring: HistoryQuery }>(
    '/api/voltage/history',
    async (req, reply) => {
      const now = new Date();
      const from = parseDate(req.query.from, new Date(now.getTime() - 3600_000)); // default: last 1h
      const to = parseDate(req.query.to, now);
      const maxPoints = Math.min(parseInt(req.query.points ?? '500', 10) || 500, 5000);
      const interval = req.query.interval ?? 'raw';

      if (from >= to) {
        return reply.code(400).send({
          error: 'INVALID_RANGE',
          message: '"from" must be before "to"',
        });
      }

      if (interval === '10min') {
        const windows = voltageState.getWindows(from, to);
        return {
          interval: '10min',
          from,
          to,
          count: windows.length,
          data: windows.map((w) => ({
            timestamp: w.windowStart,
            windowEnd: w.windowEnd,
            sampleCount: w.sampleCount,
            voltage_l1: w.rmsVoltageL1,
            voltage_l2: w.rmsVoltageL2,
            voltage_l3: w.rmsVoltageL3,
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
      const readings = voltageState.getReadingsDownsampled(from, to, maxPoints);
      return {
        interval: 'raw',
        from,
        to,
        count: readings.length,
        data: readings.map((r) => ({
          timestamp: r.timestamp,
          voltage_l1: r.voltage_l1,
          voltage_l2: r.voltage_l2,
          voltage_l3: r.voltage_l3,
        })),
        bounds: {
          nominal: ESO.NOMINAL_VOLTAGE_1PH,
          min: ESO.VOLTAGE_MIN_1PH,
          max: ESO.VOLTAGE_MAX_1PH,
        },
      };
    },
  );

  //  GET /api/voltage/anomalies?type=&phase=&from=&to=&limit=
  //  Anomaly history
  fastify.get<{ Querystring: AnomalyQuery }>(
    '/api/voltage/anomalies',
    async (req) => {
      const now = new Date();
      const from = req.query.from ? parseDate(req.query.from, new Date(0)) : undefined;
      const to = req.query.to ? parseDate(req.query.to, now) : undefined;
      const limit = Math.min(parseInt(req.query.limit ?? '100', 10) || 100, 1000);

      const anomalies = voltageState.getAnomalies({
        type: req.query.type,
        phase: req.query.phase,
        from,
        to,
      });

      return {
        count: anomalies.length,
        data: anomalies.slice(-limit).reverse(), // newest first
      };
    },
  );

  //  GET /api/voltage/anomalies/active
  //  Currently ongoing anomalies (unresolved)
  fastify.get('/api/voltage/anomalies/active', async () => {
    const active = voltageState.tracker.getActiveAnomalies();
    return {
      count: active.length,
      data: active,
    };
  });

  //  GET /api/voltage/compliance/weekly?date=
  //  ESO weekly 95% compliance report
  fastify.get<{ Querystring: { date?: string } }>(
    '/api/voltage/compliance/weekly',
    async (req) => {
      const date = req.query.date ? parseDate(req.query.date, new Date()) : new Date();
      const report = voltageState.getWeeklyCompliance(date);

      return {
        ...report,
        eso_threshold_pct: ESO.WEEKLY_COMPLIANCE_PCT,
        window_duration_minutes: ESO.WINDOW_MINUTES,
        windows_per_week: ESO.WINDOWS_PER_WEEK,
      };
    },
  );

  //  GET /api/voltage/summary
  //  Dashboard summary stats
  fastify.get('/api/voltage/summary', async () => {
    const latest = voltageState.latest;
    const stats = voltageState.stats;
    const weeklyCompliance = voltageState.getWeeklyCompliance();

    return {
      has_data: latest !== null,
      latest_timestamp: latest?.timestamp ?? null,
      stats,
      weekly_compliance: {
        pct_l1: weeklyCompliance.compliancePctL1,
        pct_l2: weeklyCompliance.compliancePctL2,
        pct_l3: weeklyCompliance.compliancePctL3,
        overall_compliant: weeklyCompliance.overallCompliant,
      },
      bounds: {
        nominal: ESO.NOMINAL_VOLTAGE_1PH,
        min: ESO.VOLTAGE_MIN_1PH,
        max: ESO.VOLTAGE_MAX_1PH,
      },
    };
  });
}